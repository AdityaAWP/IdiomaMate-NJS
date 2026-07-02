#!/usr/bin/env node
/**
 * Ambil CPU dan memori broker dari Prometheus selama window pengujian.
 * Usage: node k6/collect-metrics.js <broker> <output.json> <start_unix> <end_unix>
 * Contoh:
 *   START=$(date +%s) && k6 run ... && END=$(date +%s)
 *   node k6/collect-metrics.js nats output.json $START $END
 */

const fs = require('fs');
const path = require('path');

const PROMETHEUS = 'http://localhost:9090';

async function queryRange(expr, start, end) {
  const params = new URLSearchParams({
    query: expr,
    start,
    end,
    step: '5s',
  });
  const res = await fetch(`${PROMETHEUS}/api/v1/query_range?${params}`);
  const data = await res.json();
  const results = data.data.result;
  if (!results.length) return null;

  // ambil semua value lalu rata-ratakan
  const values = results[0].values.map(([, v]) => parseFloat(v));
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return avg;
}

async function main() {
  const [broker, output, startUnix, endUnix] = process.argv.slice(2);

  if (!broker || !output) {
    console.error(
      'Usage: node k6/collect-metrics.js <broker> <output.json> <start_unix> <end_unix>',
    );
    process.exit(1);
  }

  if (!startUnix || !endUnix) {
    console.error('Error: start_unix dan end_unix wajib diisi.');
    console.error('Contoh:');
    console.error('  START=$(date +%s)');
    console.error('  k6 run --vus 100 --duration 1m ...');
    console.error('  END=$(date +%s)');
    console.error(
      `  node k6/collect-metrics.js ${broker} ${output} $START $END`,
    );
    process.exit(1);
  }

  console.log(
    `Mengambil metrik ${broker} dari ${new Date(startUnix * 1000).toISOString()} → ${new Date(endUnix * 1000).toISOString()}`,
  );

  const cpu = await queryRange(
    `rate(container_cpu_usage_seconds_total{name=~".*${broker}.*"}[60s]) * 100`,
    startUnix,
    endUnix,
  );
  const mem = await queryRange(
    `container_memory_usage_bytes{name=~".*${broker}.*"} / 1048576`,
    startUnix,
    endUnix,
  );

  const result = {
    broker,
    collected_at: new Date().toISOString(),
    test_window: {
      start: new Date(startUnix * 1000).toISOString(),
      end: new Date(endUnix * 1000).toISOString(),
    },
    broker_resources: {
      cpu_percent: cpu !== null ? Math.round(cpu * 10000) / 10000 : null,
      memory_mb: mem !== null ? Math.round(mem * 100) / 100 : null,
    },
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2));

  console.log(`Saved → ${output}`);
  console.log(`  CPU   : ${result.broker_resources.cpu_percent}%`);
  console.log(`  Memori: ${result.broker_resources.memory_mb} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
