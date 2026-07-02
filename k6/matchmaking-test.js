import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const users = JSON.parse(open('./users.json'));

const joinErrors = new Counter('join_errors');
const matchTimeouts = new Counter('match_timeouts');
const e2eLatency = new Trend('e2e_latency_ms', true);

const API = __ENV.API_URL || 'http://localhost:3000/api';
const WS_URL = __ENV.WS_URL || 'ws://localhost:3002/ws';
const LEVEL = 'english.beginner';
const MATCH_TIMEOUT_MS = 30000;

export const options = {
  vus: 100,
  duration: '1m',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
    join_errors: ['count<10'],
    match_timeouts: ['count<10'],
    e2e_latency_ms: ['p(95)<5000'],
  },
};

export default function () {
  const user = users[(__VU - 1) % users.length];

  let matchReceived = false;
  let joinSentAt = 0;

  const wsResponse = ws.connect(
    `${WS_URL}?token=${user.token}`,
    {},
    function (socket) {
      socket.on('open', () => {
        socket.send(
          JSON.stringify({
            event: 'register',
            data: { level: LEVEL },
          }),
        );
        sleep(0.1);

        joinSentAt = Date.now();
        const joinRes = http.post(
          `${API}/match/join`,
          JSON.stringify({ level: LEVEL, topics: ['food', 'travel'] }),
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${user.token}`,
            },
          },
        );

        const joinOk = check(joinRes, {
          'join: status 202': (r) => r.status === 202,
        });

        if (!joinOk) {
          joinErrors.add(1);
          socket.close();
        }
      });

      socket.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.event === 'match_found') {
            const latency = Date.now() - joinSentAt;
            e2eLatency.add(latency);
            matchReceived = true;
            socket.close();
          }
        } catch {}
      });

      socket.setTimeout(() => {
        if (!matchReceived) {
          matchTimeouts.add(1);
          socket.close();
        }
      }, MATCH_TIMEOUT_MS);

      socket.on('error', () => {
        socket.close();
      });
    },
  );

  check(wsResponse, {
    'ws: connected': (r) => r && r.status === 101,
  });
}
