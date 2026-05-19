/**
 * k6 Load Test — Matchmaking
 *
 * Desain:
 *   - Setiap VU kirim POST /match/join → sleep 1 detik → loop
 *   - Semua VU pakai level english.beginner → pairing instan
 *   - Tidak ada cancel — Redis dibersihkan manual sebelum tiap skenario
 *   - VU count dan duration diatur dari CLI (--vus, --duration)
 *
 * Metrik yang diukur k6:
 *   - http_req_duration: response time POST /match/join
 *   - http_req_failed: error rate
 *   - join_errors: custom counter gagal join
 *
 * Metrik thesis (diukur Prometheus, bukan k6):
 *   - broker_hop1_transit_ms: API → Matching (via broker)
 *   - broker_hop2_transit_ms: Matching → Notification (via broker)
 *
 * Cara menjalankan (per skenario):
 *   docker compose exec redis redis-cli FLUSHDB
 *   k6 run --vus 100  --duration 1m k6/matchmaking-test.js   # Skenario 1
 *   k6 run --vus 500  --duration 1m k6/matchmaking-test.js   # Skenario 2
 *   k6 run --vus 1000 --duration 1m k6/matchmaking-test.js   # Skenario 3
 *   k6 run --vus 1500 --duration 1m k6/matchmaking-test.js   # Skenario 4
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const users = JSON.parse(open('./users.json'));
const joinErrors = new Counter('join_errors');

const API = __ENV.API_URL || 'http://localhost:3000/api';
const LEVEL = 'english.beginner';

export const options = {
  vus: 100,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    join_errors: ['count<10'],
  },
};

export default function () {
  const user = users[(__VU - 1) % users.length];

  const joinRes = http.post(
    `${API}/match/join`,
    JSON.stringify({ level: LEVEL, topics: ['food', 'travel'] }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.token}`,
      },
    }
  );

  const joinOk = check(joinRes, {
    'join: status 202': (r) => r.status === 202,
  });

  if (!joinOk) joinErrors.add(1);

  sleep(1);
}
