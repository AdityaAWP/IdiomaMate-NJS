#!/bin/bash
# =============================================================================
# Automated Load Testing — Idiomamate Thesis
# Membandingkan NATS vs RabbitMQ sebagai message broker
#
# Usage:
#   ./k6/run-tests.sh nats        # Test NATS saja
#   ./k6/run-tests.sh rabbitmq    # Test RabbitMQ saja
#   ./k6/run-tests.sh all         # Test keduanya berurutan
#
# Prasyarat:
#   - Docker stack sudah up dan healthy
#   - k6 sudah terinstall (k6 version)
#   - users.json sudah ada (node k6/seed.js)
#   - jq sudah terinstall (untuk parse JSON)
# =============================================================================

set -e

# ── Konfigurasi ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$SCRIPT_DIR/results"

API_URL="http://localhost:3000/api"
PROMETHEUS_URL="http://localhost:9090"

VUS_LIST=(100 500 1000 1500)
DURATION="1m"
RUNS_PER_SCENARIO=1          # setiap skenario dijalankan 1 kali
REST_BETWEEN_RUNS=65         # detik jeda antar run (>60s agar Summary window bersih)
REST_BETWEEN_SCENARIOS=70    # detik jeda antar skenario berbeda VU
REST_BEFORE_SWITCH=30        # detik jeda sebelum switch broker

# ── Warna ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helper ───────────────────────────────────────────────────────────────────
print_header() {
    echo ""
    echo -e "${GREEN}${BOLD}============================================================${NC}"
    echo -e "${GREEN}${BOLD}  $1${NC}"
    echo -e "${GREEN}${BOLD}============================================================${NC}"
    echo ""
}

info()    { echo -e "${BLUE}[INFO]${NC}    $1"; }
success() { echo -e "${GREEN}[OK]${NC}      $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}    $1"; }
error()   { echo -e "${RED}[ERROR]${NC}   $1"; }

countdown() {
    local secs=$1
    local msg=$2
    for ((i=secs; i>0; i--)); do
        printf "\r${YELLOW}[WAIT]${NC}    $msg: ${CYAN}%3ds${NC} tersisa..." "$i"
        sleep 1
    done
    printf "\r${GREEN}[OK]${NC}      $msg selesai.                        \n"
}

# ── Validasi prasyarat ────────────────────────────────────────────────────────
check_prerequisites() {
    info "Memeriksa prasyarat..."

    if ! command -v k6 &>/dev/null; then
        error "k6 tidak ditemukan. Install: https://k6.io/docs/get-started/installation/"
        exit 1
    fi

    if ! command -v jq &>/dev/null; then
        error "jq tidak ditemukan. Install: sudo pacman -S jq / sudo apt install jq"
        exit 1
    fi

    if [[ ! -f "$SCRIPT_DIR/users.json" ]]; then
        error "users.json tidak ditemukan. Jalankan dulu: node k6/seed.js"
        exit 1
    fi

    local user_count
    user_count=$(jq 'length' "$SCRIPT_DIR/users.json" 2>/dev/null || echo 0)
    if [[ "$user_count" -lt 1500 ]]; then
        warn "users.json hanya punya $user_count user. Disarankan 2000 untuk 1500 VU."
    fi

    # Cek API reachable
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/auth/login" \
        -X POST -H "Content-Type: application/json" -d '{}' 2>/dev/null || echo "000")
    if [[ "$http_code" == "000" ]]; then
        error "API Service tidak bisa diakses di $API_URL"
        error "Pastikan Docker stack sudah running."
        exit 1
    fi

    # Cek WebSocket Notification Service reachable
    if ! curl -sf --max-time 3 "http://localhost:3002" &>/dev/null && \
       ! curl -sf --max-time 3 "http://localhost:3002/metrics" &>/dev/null; then
        error "Notification Service tidak bisa diakses di localhost:3002"
        error "Pastikan Docker stack sudah running."
        exit 1
    fi

    success "Semua prasyarat terpenuhi."
}

# ── Flush Redis ───────────────────────────────────────────────────────────────
flush_redis() {
    local compose_file=$1
    info "Flush Redis pool matchmaking..."
    docker compose -f "$PROJECT_ROOT/$compose_file" exec -T redis redis-cli FLUSHDB > /dev/null 2>&1 \
        && success "Redis FLUSHDB berhasil." \
        || warn "Redis FLUSHDB gagal — mungkin container belum ready. Lanjut..."
}

# ── Kumpulkan metrik dari Prometheus ─────────────────────────────────────────
collect_metrics() {
    local output_file=$1
    local broker=$2

    info "Mengambil metrik dari Prometheus..."

    # Prometheus instant query (nilai saat ini = akhir test)
    query_prom() {
        local q=$1
        local encoded
        encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$q'))" 2>/dev/null \
            || python -c "import urllib.parse; print(urllib.parse.quote('$q'))" 2>/dev/null \
            || echo "$q")
        curl -sf "${PROMETHEUS_URL}/api/v1/query?query=${encoded}" 2>/dev/null \
            | jq -r '.data.result[0].value[1] // "null"' 2>/dev/null || echo "null"
    }

    local BROKER_PATTERN
    if [[ "$broker" == "nats" ]]; then
        BROKER_PATTERN=".*nats.*"
    else
        BROKER_PATTERN=".*rabbitmq.*"
    fi

    local hop1_p50 hop1_p90 hop1_p95 hop1_p99
    local hop2_p50 hop2_p90 hop2_p95 hop2_p99
    local throughput match_requests
    local cpu_raw memory_raw

    hop1_p50=$(query_prom "broker_hop1_transit_ms{quantile=\"0.5\",broker=\"$broker\"}")
    hop1_p90=$(query_prom "broker_hop1_transit_ms{quantile=\"0.9\",broker=\"$broker\"}")
    hop1_p95=$(query_prom "broker_hop1_transit_ms{quantile=\"0.95\",broker=\"$broker\"}")
    hop1_p99=$(query_prom "broker_hop1_transit_ms{quantile=\"0.99\",broker=\"$broker\"}")

    hop2_p50=$(query_prom "broker_hop2_transit_ms{quantile=\"0.5\",broker=\"$broker\"}")
    hop2_p90=$(query_prom "broker_hop2_transit_ms{quantile=\"0.9\",broker=\"$broker\"}")
    hop2_p95=$(query_prom "broker_hop2_transit_ms{quantile=\"0.95\",broker=\"$broker\"}")
    hop2_p99=$(query_prom "broker_hop2_transit_ms{quantile=\"0.99\",broker=\"$broker\"}")

    throughput=$(query_prom "rate(matches_total{broker=\"$broker\"}[1m])")
    match_requests=$(query_prom "rate(match_requests_total{broker=\"$broker\"}[1m])")

    cpu_raw=$(query_prom "rate(container_cpu_usage_seconds_total{name=~\"$BROKER_PATTERN\"}[1m]) * 100")
    memory_raw=$(query_prom "container_memory_usage_bytes{name=~\"$BROKER_PATTERN\"}")

    # Convert memory bytes → MB
    local memory_mb="null"
    if [[ "$memory_raw" != "null" && -n "$memory_raw" ]]; then
        memory_mb=$(echo "$memory_raw" | awk '{printf "%.2f", $1/1024/1024}')
    fi

    cat > "$output_file" << EOF
{
  "broker": "$broker",
  "collected_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "hop1_latency_ms": {
    "p50": $hop1_p50,
    "p90": $hop1_p90,
    "p95": $hop1_p95,
    "p99": $hop1_p99
  },
  "hop2_latency_ms": {
    "p50": $hop2_p50,
    "p90": $hop2_p90,
    "p95": $hop2_p95,
    "p99": $hop2_p99
  },
  "throughput": {
    "matches_per_second": $throughput,
    "join_requests_per_second": $match_requests
  },
  "broker_resources": {
    "cpu_percent": $cpu_raw,
    "memory_mb": $memory_mb
  }
}
EOF

    success "Metrik disimpan ke: $output_file"
}

# ── Kumpulkan time-series dari Prometheus ─────────────────────────────────────
collect_timeseries() {
    local output_file=$1
    local broker=$2
    local start_ts=$3
    local end_ts=$4

    info "Mengambil time-series dari Prometheus (${start_ts} → ${end_ts})..."

    query_range_prom() {
        local q=$1
        local encoded
        encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$q'))" 2>/dev/null \
            || python -c "import urllib.parse; print(urllib.parse.quote('$q'))" 2>/dev/null \
            || echo "$q")
        curl -sf "${PROMETHEUS_URL}/api/v1/query_range?query=${encoded}&start=${start_ts}&end=${end_ts}&step=2s" 2>/dev/null \
            | jq -c '.data.result[0].values // []' 2>/dev/null || echo "[]"
    }

    local BROKER_PATTERN
    if [[ "$broker" == "nats" ]]; then
        BROKER_PATTERN=".*nats.*"
    else
        BROKER_PATTERN=".*rabbitmq.*"
    fi

    local hop1_p50 hop1_p95 hop1_p99
    local hop2_p50 hop2_p95 hop2_p99
    local throughput cpu memory

    hop1_p50=$(query_range_prom "broker_hop1_transit_ms{quantile=\"0.5\",broker=\"$broker\"}")
    hop1_p95=$(query_range_prom "broker_hop1_transit_ms{quantile=\"0.95\",broker=\"$broker\"}")
    hop1_p99=$(query_range_prom "broker_hop1_transit_ms{quantile=\"0.99\",broker=\"$broker\"}")

    hop2_p50=$(query_range_prom "broker_hop2_transit_ms{quantile=\"0.5\",broker=\"$broker\"}")
    hop2_p95=$(query_range_prom "broker_hop2_transit_ms{quantile=\"0.95\",broker=\"$broker\"}")
    hop2_p99=$(query_range_prom "broker_hop2_transit_ms{quantile=\"0.99\",broker=\"$broker\"}")

    throughput=$(query_range_prom "rate(matches_total{broker=\"$broker\"}[1m])")
    cpu=$(query_range_prom "rate(container_cpu_usage_seconds_total{name=~\"$BROKER_PATTERN\"}[1m]) * 100")
    memory=$(query_range_prom "container_memory_usage_bytes{name=~\"$BROKER_PATTERN\"}")

    cat > "$output_file" << EOF
{
  "broker": "$broker",
  "test_start": $start_ts,
  "test_end": $end_ts,
  "step_seconds": 2,
  "hop1_latency_ms": {
    "p50": $hop1_p50,
    "p95": $hop1_p95,
    "p99": $hop1_p99
  },
  "hop2_latency_ms": {
    "p50": $hop2_p50,
    "p95": $hop2_p95,
    "p99": $hop2_p99
  },
  "throughput_per_second": $throughput,
  "broker_resources": {
    "cpu_percent": $cpu,
    "memory_bytes": $memory
  }
}
EOF

    success "Time-series disimpan ke: $output_file"
}

# ── Kumpulkan metrik dari PostgreSQL ─────────────────────────────────────────
collect_db_metrics() {
    local output_file=$1
    local broker=$2
    local start_ts=$3
    local end_ts=$4
    local compose_file=$5

    info "Mengambil metrik dari PostgreSQL..."

    local result
    result=$(docker compose -f "$PROJECT_ROOT/$compose_file" exec -T postgres \
        psql -U idiomamate -d idiomamate -t -A -c "
        SELECT row_to_json(t) FROM (
            SELECT
                broker,
                COUNT(*) AS total_matches,
                ROUND((COUNT(*) / 60.0)::numeric, 4) AS throughput_per_second,
                ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY \"hop1Ms\")::numeric, 4) AS hop1_p50,
                ROUND(percentile_cont(0.90) WITHIN GROUP (ORDER BY \"hop1Ms\")::numeric, 4) AS hop1_p90,
                ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY \"hop1Ms\")::numeric, 4) AS hop1_p95,
                ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY \"hop1Ms\")::numeric, 4) AS hop1_p99,
                ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY \"hop2Ms\")::numeric, 4) AS hop2_p50,
                ROUND(percentile_cont(0.90) WITHIN GROUP (ORDER BY \"hop2Ms\")::numeric, 4) AS hop2_p90,
                ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY \"hop2Ms\")::numeric, 4) AS hop2_p95,
                ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY \"hop2Ms\")::numeric, 4) AS hop2_p99
            FROM match_measurements
            WHERE \"hop2Ms\" IS NOT NULL
              AND broker = '$broker'
              AND \"createdAt\" >= to_timestamp($start_ts)
              AND \"createdAt\" <= to_timestamp($end_ts)
            GROUP BY broker
        ) t;
        " 2>/dev/null | tr -d '[:space:]')

    if [[ -z "$result" || "$result" == "null" ]]; then
        warn "Tidak ada data di PostgreSQL untuk rentang waktu ini."
        echo '{"broker":"'"$broker"'","total_matches":0,"throughput_per_second":null,"hop1_p50":null,"hop1_p90":null,"hop1_p95":null,"hop1_p99":null,"hop2_p50":null,"hop2_p90":null,"hop2_p95":null,"hop2_p99":null}' > "$output_file"
    else
        echo "$result" > "$output_file"
        success "DB metrik disimpan ke: $output_file"
    fi
}

# ── Jalankan satu run k6 ──────────────────────────────────────────────────────
run_single() {
    local broker=$1
    local vus=$2
    local run_num=$3
    local compose_file=$4

    local padded_vus
    padded_vus=$(printf "%04d" "$vus")
    local output_dir="$RESULTS_DIR/$broker/scenario-${padded_vus}vus/run-$run_num"
    mkdir -p "$output_dir"

    # Flush Redis sebelum tiap run
    flush_redis "$compose_file"

    info "Mulai k6: broker=$broker, VU=$vus, run=$run_num/$RUNS_PER_SCENARIO"
    info "Output: $output_dir"

    # Catat waktu mulai test (Unix timestamp)
    local test_start
    test_start=$(date +%s)

    # Jalankan k6
    k6 run \
        --vus "$vus" \
        --duration "$DURATION" \
        --summary-export "$output_dir/summary.json" \
        -e "API_URL=$API_URL" \
        -e "WS_URL=ws://localhost:3002/ws" \
        "$SCRIPT_DIR/matchmaking-test.js" \
        2>&1 | tee "$output_dir/test.log"

    local k6_exit=${PIPESTATUS[0]}

    # Catat waktu selesai test
    local test_end
    test_end=$(date +%s)

    # Tunggu sebentar agar Prometheus sempat scrape hasil akhir
    sleep 5

    # Kumpulkan metrik Prometheus (snapshot nilai akhir)
    collect_metrics "$output_dir/metrics.json" "$broker"

    # Kumpulkan time-series Prometheus (data per 2 detik selama test)
    collect_timeseries "$output_dir/timeseries.json" "$broker" "$test_start" "$test_end"

    # Kumpulkan metrik dari PostgreSQL (data final, akurat)
    collect_db_metrics "$output_dir/db_metrics.json" "$broker" "$test_start" "$test_end" "$compose_file"

    if [[ $k6_exit -eq 0 ]]; then
        success "Run $run_num selesai — threshold terpenuhi."
    else
        warn "Run $run_num selesai — ada threshold yang tidak terpenuhi (exit=$k6_exit). Data tetap disimpan."
    fi
}

# ── Jalankan semua skenario untuk satu broker ────────────────────────────────
run_broker() {
    local broker=$1
    local compose_file

    if [[ "$broker" == "nats" ]]; then
        compose_file="docker-compose.nats.yml"
    else
        compose_file="docker-compose.rabbitmq.yml"
    fi

    print_header "MULAI PENGUJIAN BROKER: $(echo $broker | tr '[:lower:]' '[:upper:]')"

    # Verifikasi stack sesuai broker sedang berjalan
    info "Memverifikasi stack $broker berjalan..."
    if ! docker compose -f "$PROJECT_ROOT/$compose_file" ps --quiet 2>/dev/null | grep -q .; then
        error "Stack $broker tidak running. Jalankan dulu:"
        error "  docker compose -f $compose_file up -d"
        exit 1
    fi
    success "Stack $broker terdeteksi."

    local scenario_num=0
    local total_scenarios=${#VUS_LIST[@]}

    for vus in "${VUS_LIST[@]}"; do
        scenario_num=$(( scenario_num + 1 ))

        print_header "SKENARIO $scenario_num/$total_scenarios — $vus VU (broker: $broker)"

        for run in $(seq 1 $RUNS_PER_SCENARIO); do
            info "--- Run $run dari $RUNS_PER_SCENARIO ---"
            run_single "$broker" "$vus" "$run" "$compose_file"

            # Jeda antar run (kecuali run terakhir di skenario ini)
            if [[ $run -lt $RUNS_PER_SCENARIO ]]; then
                countdown $REST_BETWEEN_RUNS "Jeda antar run (Summary window clear)"
            fi
        done

        success "Skenario $vus VU selesai — $RUNS_PER_SCENARIO run tersimpan."

        # Jeda antar skenario (kecuali skenario terakhir)
        if [[ $scenario_num -lt $total_scenarios ]]; then
            countdown $REST_BETWEEN_SCENARIOS "Jeda antar skenario"
        fi
    done

    print_header "SEMUA SKENARIO $broker SELESAI"
    success "Hasil tersimpan di: $RESULTS_DIR/$broker/"
}

# ── Ringkasan hasil ───────────────────────────────────────────────────────────
print_summary() {
    local broker=$1
    print_header "RINGKASAN HASIL — $broker"

    for vus in "${VUS_LIST[@]}"; do
        local padded_vus
        padded_vus=$(printf "%04d" "$vus")
        local scenario_dir="$RESULTS_DIR/$broker/scenario-${padded_vus}vus"

        echo -e "${CYAN}VU: $vus${NC}"

        for run in $(seq 1 $RUNS_PER_SCENARIO); do
            local db_file="$scenario_dir/run-$run/db_metrics.json"
            if [[ -f "$db_file" ]]; then
                local hop1_p95 hop2_p95 throughput total
                hop1_p95=$(jq -r '.hop1_p95 // "N/A"' "$db_file")
                hop2_p95=$(jq -r '.hop2_p95 // "N/A"' "$db_file")
                throughput=$(jq -r '.throughput_per_second // "N/A"' "$db_file")
                total=$(jq -r '.total_matches // "N/A"' "$db_file")
                printf "  Run %d — Hop1 p95: %s ms | Hop2 p95: %s ms | Throughput: %s matches/s | Total: %s matches\n" \
                    "$run" "$hop1_p95" "$hop2_p95" "$throughput" "$total"
            else
                printf "  Run %d — db_metrics.json tidak ditemukan\n" "$run"
            fi
        done
        echo ""
    done
}

# ── Entry point ───────────────────────────────────────────────────────────────
BROKER_ARG="${1:-}"

if [[ -z "$BROKER_ARG" ]]; then
    echo "Usage: $0 [nats|rabbitmq|all]"
    exit 1
fi

if [[ "$BROKER_ARG" != "nats" && "$BROKER_ARG" != "rabbitmq" && "$BROKER_ARG" != "all" ]]; then
    error "Argumen tidak valid: $BROKER_ARG"
    echo "Usage: $0 [nats|rabbitmq|all]"
    exit 1
fi

mkdir -p "$RESULTS_DIR"

check_prerequisites

START_TIME=$(date +%s)

if [[ "$BROKER_ARG" == "nats" || "$BROKER_ARG" == "all" ]]; then
    run_broker "nats"
fi

if [[ "$BROKER_ARG" == "all" ]]; then
    print_header "SWITCH KE RABBITMQ"
    echo -e "${YELLOW}Matikan stack NATS dulu, lalu jalankan stack RabbitMQ:${NC}"
    echo ""
    echo "  docker compose -f docker-compose.nats.yml down"
    echo "  docker compose -f docker-compose.rabbitmq.yml up -d --build"
    echo ""
    countdown $REST_BEFORE_SWITCH "Menunggu konfirmasi switch (pastikan stack RabbitMQ sudah up)"
fi

if [[ "$BROKER_ARG" == "rabbitmq" || "$BROKER_ARG" == "all" ]]; then
    run_broker "rabbitmq"
fi

END_TIME=$(date +%s)
ELAPSED=$(( END_TIME - START_TIME ))
HOURS=$(( ELAPSED / 3600 ))
MINS=$(( (ELAPSED % 3600) / 60 ))
SECS=$(( ELAPSED % 60 ))

print_header "PENGUJIAN SELESAI"
echo -e "  Broker diuji  : $BROKER_ARG"
echo -e "  Total waktu   : ${HOURS}j ${MINS}m ${SECS}d"
echo -e "  Hasil tersimpan: $RESULTS_DIR"
echo ""

# Tampilkan ringkasan hasil terstruktur
if command -v node &>/dev/null && [[ -f "$SCRIPT_DIR/show-results.js" ]]; then
    node "$SCRIPT_DIR/show-results.js" "$BROKER_ARG" 2>/dev/null || true
fi

success "Done!"
