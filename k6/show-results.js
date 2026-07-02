#!/usr/bin/env node
/**
 * show-results.js
 * Tampilkan hasil test dalam format terstruktur untuk demo/sidang.
 *
 * Usage:
 *   node k6/show-results.js                    # semua broker, semua VU
 *   node k6/show-results.js nats               # NATS saja
 *   node k6/show-results.js nats 500           # NATS, 500 VU saja
 */

const fs   = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'results');
const BROKERS     = ['nats', 'rabbitmq'];
const VUS_LIST    = [100, 500, 1000, 1500];
const RUNS        = 1;

// ── Filter dari argumen CLI ───────────────────────────────────────────────────
const argBroker = process.argv[2];
const argVus    = process.argv[3] ? parseInt(process.argv[3]) : null;

const brokers  = argBroker ? [argBroker] : BROKERS;
const vusList  = argVus    ? [argVus]    : VUS_LIST;

// ── Warna terminal ────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  gray:   '\x1b[90m',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val, unit = 'ms') {
  if (val === null || val === undefined || isNaN(parseFloat(val))) return `${C.gray}N/A${C.reset}`;
  return `${C.green}${parseFloat(val).toFixed(2)}${C.reset} ${C.gray}${unit}${C.reset}`;
}

function loadFile(broker, vus, run, filename) {
  const padded = String(vus).padStart(4, '0');
  const file = path.join(RESULTS_DIR, broker, `scenario-${padded}vus`, `run-${run}`, filename);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return null; }
}

function avgField(runs, field) {
  const vals = runs.map(r => parseFloat(r[field])).filter(v => !isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function getE2E(runs) {
  // k6 summary.json: metrics.e2e_latency_ms (no .values wrapper)
  const vals = runs
    .map(r => r?.metrics?.e2e_latency_ms)
    .filter(v => v && typeof v === 'object' && !Array.isArray(v));
  if (!vals.length) return null;
  const avg = (key) => {
    const ns = vals.map(v => parseFloat(v[key])).filter(v => !isNaN(v));
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
  };
  return {
    p50: avg('med'),
    p90: avg('p(90)'),
    p95: avg('p(95)'),
    p99: avg('p(99)'),
  };
}

function getHops(runs) {
  if (!runs.length) return null;
  return {
    hop1: {
      p50: avgField(runs, 'hop1_p50'),
      p95: avgField(runs, 'hop1_p95'),
      p99: avgField(runs, 'hop1_p99'),
    },
    hop2: {
      p50: avgField(runs, 'hop2_p50'),
      p95: avgField(runs, 'hop2_p95'),
      p99: avgField(runs, 'hop2_p99'),
    },
    throughput: avgField(runs, 'throughput_per_second'),
    total:      runs.reduce((s, r) => s + (parseInt(r.total_matches) || 0), 0),
  };
}

function getStatus(summaryRuns) {
  if (!summaryRuns.length) return null;
  const avg = (key, sub) => {
    const vals = summaryRuns
      .map(r => r?.metrics?.[key]?.[sub])
      .filter(v => v !== undefined && v !== null)
      .map(Number)
      .filter(v => !isNaN(v));
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };
  return {
    iterations: avg('iterations', 'count'),
    timeouts:   avg('match_timeouts', 'count'),
    joinErrors: avg('join_errors', 'count'),
  };
}

// ── Print ─────────────────────────────────────────────────────────────────────

function printBrokerHeader(broker) {
  const label = broker === 'nats' ? 'NATS Core' : 'RabbitMQ';
  console.log(`\n${C.bold}${C.cyan}${'═'.repeat(52)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  Broker: ${label}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${'═'.repeat(52)}${C.reset}`);
}

function printScenario(broker, vus) {
  const dbRuns      = [];
  const summaryRuns = [];

  for (let r = 1; r <= RUNS; r++) {
    const db  = loadFile(broker, vus, r, 'db_metrics.json');
    const sum = loadFile(broker, vus, r, 'summary.json');
    if (db  && db.total_matches > 0) dbRuns.push(db);
    if (sum) summaryRuns.push(sum);
  }

  if (!dbRuns.length && !summaryRuns.length) return;

  const hops   = getHops(dbRuns);
  const e2e    = getE2E(summaryRuns);
  const status = getStatus(summaryRuns);

  console.log(`\n  ${C.bold}${C.yellow}▶ ${vus} Virtual User${C.reset}`);
  console.log(`  ${C.gray}${'─'.repeat(44)}${C.reset}`);

  if (e2e) {
    console.log(`  ${C.bold}E2E Latency${C.reset}${C.gray} (client → match_found WebSocket)${C.reset}`);
    console.log(`    P50  : ${fmt(e2e.p50)}`);
    console.log(`    P90  : ${fmt(e2e.p90)}`);
    console.log(`    P95  : ${fmt(e2e.p95)}`);
    console.log(`    P99  : ${fmt(e2e.p99)}`);
  }

  if (hops) {
    console.log(`  ${C.bold}Hop 1${C.reset}${C.gray} (API → Matching Service via broker)${C.reset}`);
    console.log(`    P50  : ${fmt(hops.hop1.p50)}`);
    console.log(`    P95  : ${fmt(hops.hop1.p95)}`);
    console.log(`    P99  : ${fmt(hops.hop1.p99)}`);

    console.log(`  ${C.bold}Hop 2${C.reset}${C.gray} (Matching → Notification Service via broker)${C.reset}`);
    console.log(`    P50  : ${fmt(hops.hop2.p50)}`);
    console.log(`    P95  : ${fmt(hops.hop2.p95)}`);
    console.log(`    P99  : ${fmt(hops.hop2.p99)}`);

    console.log(`  ${C.bold}Throughput${C.reset}`);
    console.log(`    Matches/s : ${fmt(hops.throughput, 'matches/s')}`);
    console.log(`    Total     : ${C.green}${hops.total}${C.reset}${C.gray} pasang (${hops.total * 2} user)${C.reset}`);
  }

  if (status) {
    const failed = status.timeouts + status.joinErrors;
    console.log(`  ${C.bold}Stabilitas${C.reset}`);
    console.log(`    Timeout 30s  : ${status.timeouts > 0 ? C.yellow : C.green}${status.timeouts}${C.reset}`);
    console.log(`    Error join   : ${status.joinErrors > 0 ? C.yellow : C.green}${status.joinErrors}${C.reset}`);
    if (failed === 0) {
      console.log(`    ${C.green}✓ Tidak ada kegagalan${C.reset}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\n${C.bold}HASIL PENGUJIAN — Idiomamate Matchmaking${C.reset}`);
console.log(`${C.gray}Sumber: db_metrics.json (PostgreSQL) + summary.json (k6)${C.reset}`);

let hasData = false;

for (const broker of brokers) {
  const brokerDir = path.join(RESULTS_DIR, broker);
  if (!fs.existsSync(brokerDir)) continue;

  printBrokerHeader(broker);

  for (const vus of vusList) {
    printScenario(broker, vus);
    hasData = true;
  }
}

if (!hasData) {
  console.error(`\nTidak ada data. Jalankan dulu: bash k6/run-tests.sh nats`);
  process.exit(1);
}

console.log(`\n${C.gray}${'─'.repeat(52)}${C.reset}\n`);
