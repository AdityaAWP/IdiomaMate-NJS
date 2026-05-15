/**
 * k6 Load Test — Matchmaking (HTTP only)
 *
 * What this measures:
 *   - HTTP response time of POST /match/join (should always be ~instant, 202)
 *   - HTTP response time of POST /match/cancel
 *   - HTTP error rate
 *
 * The REAL thesis measurement is inside the services via Prometheus histograms:
 *   - broker_hop1_transit_ms  (API → Matching)
 *   - broker_hop2_transit_ms  (Matching → Notification)
 * Those are scraped by Prometheus and visualized in Grafana.
 *
 * Usage:
 *   k6 run k6/matchmaking-test.js
 *
 * Run stages individually:
 *   k6 run --stage 0:100/30s,100:100/60s k6/matchmaking-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const users = JSON.parse(open('./users.json'));
const joinErrors = new Counter('join_errors');
const cancelErrors = new Counter('cancel_errors');

const API = __ENV.API_URL || 'http://localhost:3000/api';
const LEVEL = 'english.beginner';
const CANCEL_AFTER_MS = 5000; // cancel if no match after 5s (simulates timeout)

export const options = {
  scenarios: {
    matchmaking: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },   // ramp to 100 VUs
        { duration: '60s', target: 100 },   // hold 100 VUs (light load)
        { duration: '30s', target: 500 },   // ramp to 500 VUs
        { duration: '60s', target: 500 },   // hold 500 VUs (medium load)
        { duration: '30s', target: 1000 },  // ramp to 1000 VUs
        { duration: '120s', target: 1000 }, // hold 1000 VUs (peak load)
        { duration: '30s', target: 0 },     // ramp down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],    // less than 1% errors
    join_errors: ['count<10'],
  },
};

export default function () {
  // Each VU gets its own user token (cycling if VUs > user count)
  const user = users[(__VU - 1) % users.length];
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${user.token}`,
  };

  // POST /match/join
  const joinRes = http.post(
    `${API}/match/join`,
    JSON.stringify({
      level: LEVEL,
      topics: ['food', 'travel'],
    }),
    { headers }
  );

  const joinOk = check(joinRes, {
    'join: status 202': (r) => r.status === 202,
  });

  if (!joinOk) {
    joinErrors.add(1);
    return;
  }

  // Wait — in a real test the user would wait for WS match_found
  // Here we just wait CANCEL_AFTER_MS then cancel (simulates worst case)
  sleep(CANCEL_AFTER_MS / 1000);

  // POST /match/cancel
  const cancelRes = http.post(
    `${API}/match/cancel`,
    JSON.stringify({ level: LEVEL }),
    { headers }
  );

  const cancelOk = check(cancelRes, {
    'cancel: status 200': (r) => r.status === 200,
  });

  if (!cancelOk) cancelErrors.add(1);

  sleep(0.5);
}
