#!/bin/bash
# =============================================================================
# Demo Manual — Idiomamate Thesis Sidang
#
# Jalankan SATU skenario pengujian dan hasilkan db_metrics.json + summary.json
#
# Usage:
#   bash k6/demo.sh nats 100
#   bash k6/demo.sh rabbitmq 500
#   bash k6/demo.sh nats 1000
#   bash k6/demo.sh rabbitmq 1500
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

BROKER="${1:-}"
VUS="${2:-}"

# ── Warna ─────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()     { echo -e "${RED}[ERR]${NC}   $1"; }

# ── Validasi argumen ──────────────────────────────────────────────────────────
if [[ -z "$BROKER" || -z "$VUS" ]]; then
    echo "Usage: bash k6/demo.sh [nats|rabbitmq] [100|500|1000|1500]"
    exit 1
fi

if [[ "$BROKER" != "nats" && "$BROKER" != "rabbitmq" ]]; then
    err "Broker tidak valid. Gunakan: nats atau rabbitmq"
    exit 1
fi

if [[ "$BROKER" == "nats" ]]; then
    COMPOSE_FILE="docker-compose.nats.yml"
else
    COMPOSE_FILE="docker-compose.rabbitmq.yml"
fi

# ── Siapkan direktori output ──────────────────────────────────────────────────
PADDED_VUS=$(printf "%04d" "$VUS")
OUTPUT_DIR="$SCRIPT_DIR/results/$BROKER/scenario-${PADDED_VUS}vus/run-1"
mkdir -p "$OUTPUT_DIR"

echo ""
echo -e "${BOLD}${GREEN}============================================================${NC}"
echo -e "${BOLD}${GREEN}  DEMO SIDANG — $BROKER | $VUS VU | 60 detik${NC}"
echo -e "${BOLD}${GREEN}============================================================${NC}"
echo ""
info "Output: $OUTPUT_DIR"
echo ""

# ── 1. Cek prasyarat ──────────────────────────────────────────────────────────
info "Memeriksa prasyarat..."

if ! command -v k6 &>/dev/null; then
    err "k6 tidak ditemukan."
    exit 1
fi

if [[ ! -f "$SCRIPT_DIR/users.json" ]]; then
    err "users.json tidak ditemukan. Jalankan dulu: node k6/seed.js"
    exit 1
fi

ok "k6 dan users.json tersedia."

# ── 2. Flush Redis ────────────────────────────────────────────────────────────
info "Flush Redis matchmaking pool..."
docker compose -f "$PROJECT_ROOT/$COMPOSE_FILE" exec -T redis \
    redis-cli FLUSHDB > /dev/null 2>&1 \
    && ok "Redis FLUSHDB berhasil." \
    || warn "Redis FLUSHDB gagal — lanjut."

# ── 3. Bersihkan data broker ini dari PostgreSQL ──────────────────────────────
info "Menghapus data broker='$BROKER' dari match_measurements..."
docker compose -f "$PROJECT_ROOT/$COMPOSE_FILE" exec -T postgres \
    psql -U idiomamate -d idiomamate -c \
    "DELETE FROM match_measurements WHERE broker = '$BROKER';" \
    > /dev/null 2>&1 \
    && ok "match_measurements broker=$BROKER dibersihkan." \
    || warn "Gagal bersihkan DB — lanjut."

# ── 4. Jalankan k6 ───────────────────────────────────────────────────────────
echo ""
info "Memulai k6: $VUS VU selama 60 detik..."
echo ""

k6 run \
    --vus "$VUS" \
    --duration "1m" \
    --summary-export "$OUTPUT_DIR/summary.json" \
    -e "API_URL=http://localhost:3000/api" \
    -e "WS_URL=ws://localhost:3002/ws" \
    "$SCRIPT_DIR/matchmaking-test.js" \
    2>&1 | tee "$OUTPUT_DIR/test.log"

K6_EXIT=${PIPESTATUS[0]}
echo ""

if [[ $K6_EXIT -eq 0 ]]; then
    ok "k6 selesai — semua threshold terpenuhi."
else
    warn "k6 selesai — ada threshold yang tidak terpenuhi. Data tetap dikumpulkan."
fi

# ── 5. Kumpulkan db_metrics.json dari PostgreSQL ──────────────────────────────
info "Mengambil metrik dari PostgreSQL..."

RESULT=$(docker compose -f "$PROJECT_ROOT/$COMPOSE_FILE" exec -T postgres \
    psql -U idiomamate -d idiomamate -t -A -c "
    SELECT row_to_json(t) FROM (
        SELECT
            broker,
            COUNT(*)                                                                    AS total_matches,
            ROUND((COUNT(*) / 60.0)::numeric, 4)                                       AS throughput_per_second,
            ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY \"hop1Ms\")::numeric, 4) AS hop1_p50,
            ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY \"hop1Ms\")::numeric, 4) AS hop1_p95,
            ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY \"hop1Ms\")::numeric, 4) AS hop1_p99,
            ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY \"hop2Ms\")::numeric, 4) AS hop2_p50,
            ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY \"hop2Ms\")::numeric, 4) AS hop2_p95,
            ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY \"hop2Ms\")::numeric, 4) AS hop2_p99
        FROM match_measurements
        WHERE \"hop2Ms\" IS NOT NULL
          AND broker = '$BROKER'
        GROUP BY broker
    ) t;
    " 2>/dev/null | tr -d '[:space:]')

if [[ -z "$RESULT" || "$RESULT" == "null" ]]; then
    warn "Tidak ada data di PostgreSQL."
    echo "{\"broker\":\"$BROKER\",\"total_matches\":0}" > "$OUTPUT_DIR/db_metrics.json"
else
    echo "$RESULT" > "$OUTPUT_DIR/db_metrics.json"
    ok "db_metrics.json tersimpan."
fi

# ── 6. Tampilkan hasil ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}============================================================${NC}"
echo -e "${BOLD}${CYAN}  HASIL — $BROKER | $VUS VU${NC}"
echo -e "${BOLD}${CYAN}============================================================${NC}"

if command -v node &>/dev/null && [[ -f "$SCRIPT_DIR/show-results.js" ]]; then
    node "$SCRIPT_DIR/show-results.js" "$BROKER" "$VUS" 2>/dev/null || true
else
    echo ""
    cat "$OUTPUT_DIR/db_metrics.json" | python3 -m json.tool 2>/dev/null \
        || cat "$OUTPUT_DIR/db_metrics.json"
fi

echo ""
ok "File tersimpan di: $OUTPUT_DIR"
echo -e "  ${CYAN}summary.json${NC}    → latensi E2E (dari k6)"
echo -e "  ${CYAN}db_metrics.json${NC} → latensi Hop 1, Hop 2, throughput (dari PostgreSQL)"
echo -e "  ${CYAN}test.log${NC}        → output lengkap k6"
echo ""
