const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('fs');
const path = require('path');

// ── Konfigurasi ───────────────────────────────────────────────────────────────

const RESULTS_DIR = path.join(__dirname, 'results');
const CHARTS_DIR = path.join(__dirname, 'charts');
const VUS_LIST = [100, 500, 1000, 1500];
const BROKERS = ['nats', 'rabbitmq'];
const RUNS = 1;

const WIDTH = 900;
const HEIGHT = 500;
const TABLE_EXTRA = 85;
const COLORS = {
  nats: { bg: 'rgba(54, 162, 235, 0.75)', border: 'rgb(54, 162, 235)' },
  rabbitmq: { bg: 'rgba(255, 159, 64, 0.75)', border: 'rgb(255, 159, 64)' },
};

const renderer = new ChartJSNodeCanvas({
  width: WIDTH,
  height: HEIGHT,
  backgroundColour: 'white',
});

const rendererWithTable = new ChartJSNodeCanvas({
  width: WIDTH,
  height: HEIGHT + TABLE_EXTRA,
  backgroundColour: 'white',
});

// ── Helpers: load summary.json (k6 E2E) ──────────────────────────────────────

function loadSummary(broker, vus, run) {
  const padded = String(vus).padStart(4, '0');
  const file = path.join(
    RESULTS_DIR,
    broker,
    `scenario-${padded}vus`,
    `run-${run}`,
    'summary.json',
  );
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function averageE2E(broker, vus) {
  const runs = [];
  for (let r = 1; r <= RUNS; r++) {
    const s = loadSummary(broker, vus, r);
    const e = s?.metrics?.e2e_latency_ms;
    if (e && typeof e === 'object') runs.push(e);
  }
  if (!runs.length) return null;
  const avg = (key) => {
    const vals = runs.map((v) => parseFloat(v[key])).filter((v) => !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    e2e_p50: avg('med'),
    e2e_p90: avg('p(90)'),
    e2e_p95: avg('p(95)'),
    e2e_p99: avg('p(99)'),
  };
}

// ── Helpers: load db_metrics.json (PostgreSQL) ───────────────────────────────

function loadDbMetrics(broker, vus, run) {
  const padded = String(vus).padStart(4, '0');
  const file = path.join(
    RESULTS_DIR,
    broker,
    `scenario-${padded}vus`,
    `run-${run}`,
    'db_metrics.json',
  );
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function averageDbRuns(broker, vus) {
  const runs = [];
  for (let r = 1; r <= RUNS; r++) {
    const m = loadDbMetrics(broker, vus, r);
    if (m && m.total_matches > 0) runs.push(m);
  }
  if (runs.length === 0) return null;

  const avgField = (field) => {
    const vals = runs.map((m) => parseFloat(m[field])).filter((v) => !isNaN(v));
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  return {
    hop1_p50: avgField('hop1_p50'),
    hop1_p90: avgField('hop1_p90'),
    hop1_p95: avgField('hop1_p95'),
    hop1_p99: avgField('hop1_p99'),
    hop2_p50: avgField('hop2_p50'),
    hop2_p90: avgField('hop2_p90'),
    hop2_p95: avgField('hop2_p95'),
    hop2_p99: avgField('hop2_p99'),
    throughput: avgField('throughput_per_second'),
    cpu: null,
    memory_mb: null,
  };
}

// ── Helpers: load & rata-rata metrics.json (Prometheus, fallback) ─────────────

function loadMetrics(broker, vus, run) {
  const padded = String(vus).padStart(4, '0');
  const file = path.join(
    RESULTS_DIR,
    broker,
    `scenario-${padded}vus`,
    `run-${run}`,
    'metrics.json',
  );
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function getNum(obj, ...keys) {
  let v = obj;
  for (const k of keys) v = v?.[k];
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function averagePrometheusRuns(broker, vus) {
  const runs = [];
  for (let r = 1; r <= RUNS; r++) {
    const m = loadMetrics(broker, vus, r);
    if (m) runs.push(m);
  }
  if (runs.length === 0) return null;

  const avg = (...keys) => {
    const vals = runs.map((m) => getNum(m, ...keys)).filter((v) => v !== null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  return {
    hop1_p50: avg('hop1_latency_ms', 'p50'),
    hop1_p90: avg('hop1_latency_ms', 'p90'),
    hop1_p95: avg('hop1_latency_ms', 'p95'),
    hop1_p99: avg('hop1_latency_ms', 'p99'),
    hop2_p50: avg('hop2_latency_ms', 'p50'),
    hop2_p90: avg('hop2_latency_ms', 'p90'),
    hop2_p95: avg('hop2_latency_ms', 'p95'),
    hop2_p99: avg('hop2_latency_ms', 'p99'),
    throughput: avg('throughput', 'matches_per_second'),
    cpu: avg('broker_resources', 'cpu_percent'),
    memory_mb: avg('broker_resources', 'memory_mb'),
  };
}

// Gabungkan: DB (hop1/hop2/throughput) + Prometheus (cpu/memory) + k6 (e2e)
function averageRuns(broker, vus) {
  const db = averageDbRuns(broker, vus);
  const prom = averagePrometheusRuns(broker, vus);
  const e2e = averageE2E(broker, vus);

  const base = db || prom;
  if (!base && !e2e) return null;

  return {
    ...(base || {}),
    cpu: prom?.cpu ?? null,
    memory_mb: prom?.memory_mb ?? null,
    e2e_p50: e2e?.e2e_p50 ?? null,
    e2e_p90: e2e?.e2e_p90 ?? null,
    e2e_p95: e2e?.e2e_p95 ?? null,
    e2e_p99: e2e?.e2e_p99 ?? null,
  };
}

// ── Helpers: load & parse timeseries.json ─────────────────────────────────────

function loadTimeseries(broker, vus, run) {
  const padded = String(vus).padStart(4, '0');
  const file = path.join(
    RESULTS_DIR,
    broker,
    `scenario-${padded}vus`,
    `run-${run}`,
    'timeseries.json',
  );
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function toXY(values) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const start = values[0][0];
  return values.map(([ts, v]) => ({ x: ts - start, y: parseFloat(v) || null }));
}

// ── Chart builders ────────────────────────────────────────────────────────────

async function saveChart(config, filename, rdr = renderer) {
  const buffer = await rdr.renderToBuffer(config);
  fs.writeFileSync(path.join(CHARTS_DIR, filename), buffer);
  console.log(`  ✓  ${filename}`);
}

async function saveChartToDir(config, dir, filename, rdr = renderer) {
  const buffer = await rdr.renderToBuffer(config);
  fs.writeFileSync(path.join(dir, filename), buffer);
  console.log(`  ✓  ${path.relative(CHARTS_DIR, dir)}/${filename}`);
}

function makeTablePlugin(datasets, colLabels, unit) {
  return {
    id: 'dataTable',
    afterDraw(chart) {
      const { ctx, chartArea } = chart;

      const TABLE_TOP = chartArea.bottom + 18;
      const ROW_H = 28;
      const LABEL_W = 110;
      const colW = (WIDTH - LABEL_W) / colLabels.length;

      ctx.save();

      // background tabel
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(0, TABLE_TOP - 4, WIDTH, ROW_H * (datasets.length + 1) + 8);

      // border atas tabel
      ctx.strokeStyle = '#ccc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, TABLE_TOP - 4);
      ctx.lineTo(WIDTH, TABLE_TOP - 4);
      ctx.stroke();

      // header kolom
      ctx.font = 'bold 12px Arial';
      ctx.fillStyle = '#444';
      ctx.textAlign = 'center';
      colLabels.forEach((lbl, i) => {
        ctx.fillText(lbl, LABEL_W + i * colW + colW / 2, TABLE_TOP + 16);
      });

      // garis pemisah header
      ctx.strokeStyle = '#ccc';
      ctx.beginPath();
      ctx.moveTo(0, TABLE_TOP + ROW_H - 4);
      ctx.lineTo(WIDTH, TABLE_TOP + ROW_H - 4);
      ctx.stroke();

      // garis vertikal setelah kolom label
      ctx.beginPath();
      ctx.moveTo(LABEL_W, TABLE_TOP - 4);
      ctx.lineTo(LABEL_W, TABLE_TOP + ROW_H * (datasets.length + 1) + 4);
      ctx.stroke();

      // baris data
      datasets.forEach((ds, row) => {
        const y = TABLE_TOP + (row + 1) * ROW_H + 15;

        // nama broker (warna sesuai bar)
        ctx.font = 'bold 12px Arial';
        ctx.fillStyle = ds.borderColor;
        ctx.textAlign = 'left';
        ctx.fillText(ds.label, 8, y);

        // nilai per kolom
        ctx.font = '12px Arial';
        ctx.fillStyle = '#222';
        ctx.textAlign = 'center';
        ds.data.forEach((val, col) => {
          const x = LABEL_W + col * colW + colW / 2;
          const txt =
            val === null || val === undefined || val === 0.01
              ? 'N/A'
              : parseFloat(val).toFixed(2);
          ctx.fillText(txt, x, y);
        });
      });

      // label unit di pojok kiri
      ctx.font = '10px Arial';
      ctx.fillStyle = '#888';
      ctx.textAlign = 'left';
      ctx.fillText(`(${unit})`, 8, TABLE_TOP + 16);

      ctx.restore();
    },
  };
}

/**
 * Bar chart: satu broker saja, per VU count — dengan tabel data di bawah
 */
async function makeSingleBrokerChart({
  broker,
  title,
  yLabel,
  unit,
  getter,
  filename,
}) {
  const colLabels = VUS_LIST.map((v) => `${v} VU`);
  const dir = path.join(CHARTS_DIR, broker);

  const dataset = {
    label: broker === 'nats' ? 'NATS' : 'RabbitMQ',
    data: VUS_LIST.map((vus) => {
      const m = averageRuns(broker, vus);
      const v = m ? getter(m) : null;
      return v !== null && v <= 0 ? 0.01 : v;
    }),
    backgroundColor: COLORS[broker].bg,
    borderColor: COLORS[broker].border,
    borderWidth: 1.5,
  };

  const tablePlugin = makeTablePlugin([dataset], colLabels, unit);

  await saveChartToDir(
    {
      type: 'bar',
      data: { labels: colLabels, datasets: [dataset] },
      options: {
        layout: { padding: { bottom: TABLE_EXTRA } },
        plugins: {
          title: { display: true, text: title, font: { size: 15 } },
          legend: { position: 'top' },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: `${yLabel} (${unit})` },
            ticks: { maxTicksLimit: 6 },
          },
          x: { title: { display: true, text: 'Jumlah Virtual User (VU)' } },
        },
      },
      plugins: [tablePlugin],
    },
    dir,
    filename,
    rendererWithTable,
  );
}

/**
 * Bar chart: NATS vs RabbitMQ, per VU count — dengan tabel data di bawah
 */
async function makeBarChart({ title, yLabel, unit, getter, filename }) {
  const colLabels = VUS_LIST.map((v) => `${v} VU`);

  const datasets = BROKERS.map((broker) => ({
    label: broker === 'nats' ? 'NATS' : 'RabbitMQ',
    data: VUS_LIST.map((vus) => {
      const m = averageRuns(broker, vus);
      const v = m ? getter(m) : null;
      return v !== null && v <= 0 ? 0.01 : v;
    }),
    backgroundColor: COLORS[broker].bg,
    borderColor: COLORS[broker].border,
    borderWidth: 1.5,
  }));

  const tablePlugin = makeTablePlugin(datasets, colLabels, unit);

  await saveChart(
    {
      type: 'bar',
      data: { labels: colLabels, datasets },
      options: {
        layout: { padding: { bottom: TABLE_EXTRA } },
        plugins: {
          title: { display: true, text: title, font: { size: 15 } },
          legend: { position: 'top' },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: `${yLabel} (${unit})` },
            ticks: { maxTicksLimit: 6 },
          },
          x: { title: { display: true, text: 'Jumlah Virtual User (VU)' } },
        },
      },
      plugins: [tablePlugin],
    },
    filename,
    rendererWithTable,
  );
}

/**
 * Line chart: progression metrik selama 1 menit test
 * Menggunakan run-2 (tengah) sebagai run representatif
 */
async function makeTimeseriesChart({
  title,
  yLabel,
  unit,
  vus,
  valueGetter,
  filename,
}) {
  const datasets = [];

  for (const broker of BROKERS) {
    const ts = loadTimeseries(broker, vus, 2) || loadTimeseries(broker, vus, 1);
    if (!ts) continue;

    const rawValues = valueGetter(ts);
    const points = toXY(rawValues);
    if (points.length === 0) continue;

    datasets.push({
      label: broker === 'nats' ? 'NATS' : 'RabbitMQ',
      data: points,
      borderColor: COLORS[broker].border,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.2,
    });
  }

  if (datasets.length === 0) {
    console.warn(`  ⚠  Tidak ada data timeseries untuk ${filename} — skip.`);
    return;
  }

  await saveChart(
    {
      type: 'line',
      data: { datasets },
      options: {
        parsing: false,
        plugins: {
          title: { display: true, text: title, font: { size: 15 } },
          legend: { position: 'top' },
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Waktu (detik sejak test mulai)' },
          },
          y: {
            title: { display: true, text: `${yLabel} (${unit})` },
          },
        },
      },
    },
    filename,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Cek apakah ada data sama sekali
  const hasAnyData = BROKERS.some((b) =>
    VUS_LIST.some(
      (vus) =>
        loadDbMetrics(b, vus, 1) !== null || loadMetrics(b, vus, 1) !== null,
    ),
  );
  if (!hasAnyData) {
    console.error(
      'Tidak ada data di k6/results/. Jalankan dulu: bash k6/run-tests.sh nats',
    );
    process.exit(1);
  }

  // Info sumber data
  const usingDb = BROKERS.some((b) =>
    VUS_LIST.some((vus) => loadDbMetrics(b, vus, 1) !== null),
  );
  console.log(
    `Sumber data: ${usingDb ? 'PostgreSQL (db_metrics.json)' : 'Prometheus (metrics.json — fallback)'}\n`,
  );

  fs.mkdirSync(CHARTS_DIR, { recursive: true });
  fs.mkdirSync(path.join(CHARTS_DIR, 'nats'), { recursive: true });
  fs.mkdirSync(path.join(CHARTS_DIR, 'rabbitmq'), { recursive: true });
  console.log('Generating charts...\n');

  // ── Single-broker charts: untuk 4.1.2 (NATS) dan 4.1.3 (RabbitMQ) ─────────

  const SINGLE_BROKER_METRICS = [
    {
      key: 'hop1_p50',
      title: 'Hop 1 (API → Matching) — p50',
      yLabel: 'Latency',
      unit: 'ms',
      filename: 'hop1_p50.png',
    },
    {
      key: 'hop1_p95',
      title: 'Hop 1 (API → Matching) — p95',
      yLabel: 'Latency',
      unit: 'ms',
      filename: 'hop1_p95.png',
    },
    {
      key: 'hop1_p99',
      title: 'Hop 1 (API → Matching) — p99',
      yLabel: 'Latency',
      unit: 'ms',
      filename: 'hop1_p99.png',
    },
    {
      key: 'hop2_p50',
      title: 'Hop 2 (Matching → Notification) — p50',
      yLabel: 'Latency',
      unit: 'ms',
      filename: 'hop2_p50.png',
    },
    {
      key: 'hop2_p95',
      title: 'Hop 2 (Matching → Notification) — p95',
      yLabel: 'Latency',
      unit: 'ms',
      filename: 'hop2_p95.png',
    },
    {
      key: 'hop2_p99',
      title: 'Hop 2 (Matching → Notification) — p99',
      yLabel: 'Latency',
      unit: 'ms',
      filename: 'hop2_p99.png',
    },
    {
      key: 'throughput',
      title: 'Throughput — Match Berhasil per Detik',
      yLabel: 'Throughput',
      unit: 'matches/s',
      filename: 'throughput.png',
    },
    {
      key: 'cpu',
      title: 'Penggunaan CPU',
      yLabel: 'CPU',
      unit: '%',
      filename: 'cpu.png',
    },
    {
      key: 'memory_mb',
      title: 'Penggunaan Memori',
      yLabel: 'Memory',
      unit: 'MB',
      filename: 'memory.png',
    },
    {
      key: 'e2e_p50',
      title: 'Latensi End-to-End — p50',
      yLabel: 'Latency',
      unit: 'ms',
      filename: 'e2e_p50.png',
    },
    {
      key: 'e2e_p95',
      title: 'Latensi End-to-End — p95',
      yLabel: 'Latency',
      unit: 'ms',
      filename: 'e2e_p95.png',
    },
    {
      key: 'e2e_p99',
      title: 'Latensi End-to-End — p99',
      yLabel: 'Latency',
      unit: 'ms',
      filename: 'e2e_p99.png',
    },
  ];

  console.log(
    '── NATS charts ────────────────────────────────────────────────',
  );
  for (const m of SINGLE_BROKER_METRICS) {
    await makeSingleBrokerChart({
      broker: 'nats',
      getter: (x) => x[m.key],
      ...m,
    });
  }

  console.log(
    '\n── RabbitMQ charts ────────────────────────────────────────────',
  );
  for (const m of SINGLE_BROKER_METRICS) {
    await makeSingleBrokerChart({
      broker: 'rabbitmq',
      getter: (x) => x[m.key],
      ...m,
    });
  }

  console.log(
    '\n── Bar charts: perbandingan NATS vs RabbitMQ ──────────────────',
  );

  await makeBarChart({
    title: 'Latency Hop 1 (API → Matching) — p50',
    yLabel: 'Latency',
    unit: 'ms',
    getter: (m) => m.hop1_p50,
    filename: 'hop1_latency_p50.png',
  });

  await makeBarChart({
    title: 'Latency Hop 1 (API → Matching) — p90',
    yLabel: 'Latency',
    unit: 'ms',
    getter: (m) => m.hop1_p90,
    filename: 'hop1_latency_p90.png',
  });

  await makeBarChart({
    title: 'Latency Hop 1 (API → Matching) — p95',
    yLabel: 'Latency',
    unit: 'ms',
    getter: (m) => m.hop1_p95,
    filename: 'hop1_latency_p95.png',
  });

  await makeBarChart({
    title: 'Latency Hop 1 (API → Matching) — p99',
    yLabel: 'Latency',
    unit: 'ms',
    getter: (m) => m.hop1_p99,
    filename: 'hop1_latency_p99.png',
  });

  await makeBarChart({
    title: 'Latency Hop 2 (Matching → Notification) — p50',
    yLabel: 'Latency',
    unit: 'ms',
    getter: (m) => m.hop2_p50,
    filename: 'hop2_latency_p50.png',
  });

  await makeBarChart({
    title: 'Latency Hop 2 (Matching → Notification) — p90',
    yLabel: 'Latency',
    unit: 'ms',
    getter: (m) => m.hop2_p90,
    filename: 'hop2_latency_p90.png',
  });

  await makeBarChart({
    title: 'Latency Hop 2 (Matching → Notification) — p95',
    yLabel: 'Latency',
    unit: 'ms',
    getter: (m) => m.hop2_p95,
    filename: 'hop2_latency_p95.png',
  });

  await makeBarChart({
    title: 'Latency Hop 2 (Matching → Notification) — p99',
    yLabel: 'Latency',
    unit: 'ms',
    getter: (m) => m.hop2_p99,
    filename: 'hop2_latency_p99.png',
  });

  await makeBarChart({
    title: 'Throughput — Match Berhasil per Detik',
    yLabel: 'Throughput',
    unit: 'matches/s',
    getter: (m) => m.throughput,
    filename: 'throughput.png',
  });

  await makeBarChart({
    title: 'E2E Latency (Client → match_found WebSocket) — p50',
    yLabel: 'Latency',
    unit: 'ms',
    getter: (m) => m.e2e_p50,
    filename: 'e2e_latency_p50.png',
  });

  await makeBarChart({
    title: 'E2E Latency (Client → match_found WebSocket) — p90',
    yLabel: 'Latency',
    unit: 'ms',
    getter: (m) => m.e2e_p90,
    filename: 'e2e_latency_p90.png',
  });

  await makeBarChart({
    title: 'E2E Latency (Client → match_found WebSocket) — p95',
    yLabel: 'Latency',
    unit: 'ms',
    getter: (m) => m.e2e_p95,
    filename: 'e2e_latency_p95.png',
  });

  await makeBarChart({
    title: 'E2E Latency (Client → match_found WebSocket) — p99',
    yLabel: 'Latency',
    unit: 'ms',
    getter: (m) => m.e2e_p99,
    filename: 'e2e_latency_p99.png',
  });

  await makeBarChart({
    title: 'Penggunaan CPU Broker',
    yLabel: 'CPU',
    unit: '%',
    getter: (m) => m.cpu,
    filename: 'cpu_usage.png',
  });

  await makeBarChart({
    title: 'Penggunaan Memory Broker',
    yLabel: 'Memory',
    unit: 'MB',
    getter: (m) => m.memory_mb,
    filename: 'memory_usage.png',
  });

  // ── Line charts: progression selama test (skenario 1500 VU, run 2) ─────────

  await makeTimeseriesChart({
    title: 'Hop 1 p95 — Progression selama Test (1500 VU)',
    yLabel: 'Latency',
    unit: 'ms',
    vus: 1500,
    valueGetter: (ts) => ts.hop1_latency_ms?.p95,
    filename: 'hop1_timeseries_1500vu.png',
  });

  await makeTimeseriesChart({
    title: 'Hop 2 p95 — Progression selama Test (1500 VU)',
    yLabel: 'Latency',
    unit: 'ms',
    vus: 1500,
    valueGetter: (ts) => ts.hop2_latency_ms?.p95,
    filename: 'hop2_timeseries_1500vu.png',
  });

  await makeTimeseriesChart({
    title: 'Throughput — Progression selama Test (1500 VU)',
    yLabel: 'Throughput',
    unit: 'matches/s',
    vus: 1500,
    valueGetter: (ts) => ts.throughput_per_second,
    filename: 'throughput_timeseries_1500vu.png',
  });

  console.log(`\nSelesai! ${CHARTS_DIR}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
