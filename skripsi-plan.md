# Skripsi Plan: NATS vs RabbitMQ for Real-Time Matchmaking

## Thesis Title
**ANALISIS KOMPARASI PERFORMA MESSAGE BROKER NATS DAN RABBITMQ PADA SISTEM MATCHMAKING REAL-TIME APLIKASI LANGUAGE EXCHANGE**

---

## Context

A fair A vs B comparison — NATS and RabbitMQ are both message brokers competing for the same use case. The same matchmaking system is implemented twice, only the broker changes between versions.

**Why this comparison is valid:**
- Both are message brokers (same category, same purpose)
- Both support pub/sub and queue patterns needed for matchmaking
- Code stays nearly identical between versions — only the NestJS transporter config changes
- BullMQ rejected: it is a job queue, not a message broker — unfair comparison

**Why NestJS fits:**
`@nestjs/microservices` has built-in transporters for both NATS and RabbitMQ. Swapping brokers = changing one config block. Application logic is identical.

---

## System Features

This is an Omegle-style language learning platform where users are matched with partners to practice a foreign language via video call.

| # | Feature | Description | Thesis eval? |
|---|---|---|---|
| 1 | **Auth** | Register/login with email+password or Google OAuth. JWT access + refresh token. | No |
| 2 | **Matchmaking** | Join a queue to be paired with another user by same `target_language` + `proficiency`. Pool-based algorithm. | **Yes** |
| 3 | **Video Call** | After match, both users join an Agora video call using generated channel + tokens. | No |
| 4 | **AI TOD** | During a video call, user can request AI-generated Topics of Discussion. Calls external AI model API on demand. | No |
| 5 | **Lobbies** | Public/private group rooms for language practice. Users can join, chat in real-time, and leave. | No |
| 6 | **Friends** | Send, accept, reject friend requests. View friend list. | No |
| 7 | **Direct Messages (DM)** | One-to-one private chat between users. Real-time delivery via WebSocket. | No |
| 8 | **User Profile** | View and update own profile (avatar, target language, proficiency). View other users' public profiles. | No |
| 9 | **User Search** | Search users by username to send friend requests or view profiles. | No |
| 10 | **Room History** | View past video call sessions. | No |

---

## Architecture

### Services written by you (3 Docker containers)

| Service | Port | Responsibility |
|---|---|---|
| API Service | 3000 | HTTP endpoints, auth only — publishes match request to broker |
| Matching Service | 3001 | Pool logic, match decision, publishes match.found + subscribes to match.cancel |
| Notification Service | 3002 | Raw WebSocket server (WsAdapter), registry (userId→{socket,level}), pushes match result to clients |

### Infrastructure (no code needed)

| Service | Version A | Version B |
|---|---|---|
| Message broker | NATS (Core) | RabbitMQ |
| Pool storage | Redis | Redis (same) |
| Database | PostgreSQL | PostgreSQL (same) |
| Load balancer | nginx | nginx (same) |

### Non-thesis features (monolith, separate container)
Lobbies, Friends, DM, Room History, AI TOD — runs in same Docker Compose but **stopped during load test** to avoid resource competition.

---

## Message Flow

```
CLIENT                    API SERVICE      BROKER          MATCHING SERVICE    NOTIFICATION SERVICE
──────                    ───────────      ──────          ────────────────    ────────────────────

click find →
  WS connect ws://host/ws?token=xxx&level=english.beginner ─────────────────────────────────────►
                                                                               register { socket, level }

  HTTP POST /api/match/join { level }
  │
  ▼
                          publish ──────────────────────► receive
                          matchmaking.english.beginner     pool[level] empty?
                                                           YES → add to Redis pool
                                                           NO  → MATCH FOUND
                                                                delete from pool
                                                                generate channelName (UUID)
                                                                generate tokenUser1+tokenUser2
                                                                NO DB write
                                                                publish ─────────────────────►
                                                                match.found                   remove both from registry
                                                                { user1Id, user2Id,           push to registry[user1]
                                                                  channelName,                push to registry[user2]
                                                                  tokenUser1, tokenUser2 }
  ◄─────────────────────────────────────────────────────────────────────────────────────────── { matched: true,
                                                                                                 channelName,
                                                                                                 token }

disconnect before match →
  WS close ────────────────────────────────────────────────────────────────────────────────────►
                                                                               publish ──────►
                                                                               match.cancel   cancelMatch()
                                                                               { userId,      Lua script (no-op
                                                                                 level }      if already matched)
```

---

## Broker Comparison

### NATS (Version A)
```typescript
// main.ts
app.connectMicroservice({
  transport: Transport.NATS,
  options: { servers: ['nats://nats:4222'] }
})

// publish
this.client.emit('matchmaking.english.beginner', { userId, level })

// subscribe — NATS wildcard: > matches one or more tokens
@MessagePattern('matchmaking.>')
handleMatch(data: MatchRequestDto) { ... }
```

### RabbitMQ (Version B)
```typescript
// main.ts — Matching Service
app.connectMicroservice({
  transport: Transport.RMQ,
  options: {
    urls: ['amqp://rabbitmq:5672'],
    exchange: 'app_exchange',
    exchangeType: 'topic',
    queue: 'matchmaking_queue',
    routingKey: 'matchmaking.#',   // binds queue to matchmaking.{level} pattern
    queueOptions: { durable: true }
  }
})
// Additional binding for match.cancel done in onModuleInit via amqplib directly

// main.ts — Notification Service
app.connectMicroservice({
  transport: Transport.RMQ,
  options: {
    urls: ['amqp://rabbitmq:5672'],
    exchange: 'app_exchange',
    exchangeType: 'topic',
    queue: 'notification_queue',
    routingKey: 'match.found',
    queueOptions: { durable: true }
  }
})
```

Application code is identical. Only `main.ts` transporter config changes.

### Exchange layout (RabbitMQ)

Single topic exchange `app_exchange` handles all routing:

| Routing Key | Queue | Subscriber |
|---|---|---|
| `matchmaking.#` | matchmaking_queue | Matching Service |
| `match.cancel` | matchmaking_queue | Matching Service |
| `match.found` | notification_queue | Notification Service |

### Messaging patterns (single instance)

Single instance per service — with one subscriber, pub/sub and queue behave identically.

| Topic | NATS | RabbitMQ | Note |
|---|---|---|---|
| `matchmaking.{level}` | Plain subscribe (`matchmaking.>`) | Topic exchange (`matchmaking.#`) | One subscriber = same as queue |
| `match.found` | Plain subscribe | Topic exchange (`match.found`) | One subscriber |
| `match.cancel` | Plain subscribe | Topic exchange (`match.cancel`) | One subscriber |

### Key differences

| Aspect | NATS | RabbitMQ |
|---|---|---|
| Protocol | Custom binary (NATS protocol) | AMQP 0-9-1 |
| Default model | Pub/Sub | Queue (point-to-point) |
| Wildcard routing | Built-in, `>` operator (`matchmaking.>`) | Via Topic exchange, `#` operator (`matchmaking.#`) |
| Config overhead | Minimal — subject only | More explicit (exchange type, binding, routing key, queue) |
| Persistence | Core = no persistence | Durable queues |
| Resource usage | Lightweight (~10MB RAM) | Heavier (~80MB RAM) |

---

## Why Core NATS (not JetStream)

JetStream adds message persistence — subscribers receive messages they missed while offline. This system does not need it:

| Message | If missed | Recovery |
|---|---|---|
| `matchmaking.>` | Matching Service is always running | User clicks again |
| `match.found` | WebSocket is gone if user disconnected | User reconnects + retries |

Redis already handles the only persistence needed (waiting pool). JetStream solves a problem this system does not have.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Language | TypeScript | Type safety, NestJS native |
| Framework | NestJS | Built-in NATS + RabbitMQ transporter support |
| ORM | Prisma | Type-safe DB client, clean schema definition |
| Database | PostgreSQL | Established RDBMS |
| Pool storage | Redis | Persists waiting users across Matching Service restarts |
| Broker A | NATS (Core) | Lightweight, simple, subject-based routing |
| Broker B | RabbitMQ | Feature-rich, exchange-based, AMQP standard |
| WebSocket | Raw WS via WsAdapter (@nestjs/websockets) | Real-time client notifications — k6-compatible, no Socket.IO framing |
| Video Token | Agora SDK (Node.js) | Token generated inside Matching Service at match time |
| Load testing | k6 | Standard for HTTP/WebSocket benchmarking |
| Monitoring | Prometheus + cAdvisor + Grafana | Per-container CPU/Memory metrics |
| Container | Docker Compose | Two separate compose files (NATS and RabbitMQ versions) |

---

## Research Variables

| Type | Variable | Detail |
|---|---|---|
| Independent | Message Broker | NATS (Core) vs RabbitMQ |
| Independent | Load Level | 100 / 500 / 1000 / 5000 Virtual Users |
| Dependent | Latency | p50, p95, p99 end-to-end (click → match notification) |
| Dependent | Throughput | Successful matches per second |
| Dependent | CPU + Memory | Broker container resource usage |
| Control | Application code | Identical between versions |
| Control | Services | Same API, Matching, Notification service code |
| Control | Redis | Same pool storage |
| Control | Hardware | Same VM specs |
| Control | Test scenarios | Same VU patterns and durations |

---

## Matchmaking Pool Logic

Pool lives in Redis (persists across Matching Service restarts).

```
new user arrives (userId, level)
  │
  ├── Redis pool[level] has someone?
  │     YES → match them, delete from pool, publish match.found
  │     NO  → add userId to pool, wait
  │
  └── user disconnects before match?
        → delete from pool (cancel)
```

**Pool example:**
```
findMatch("alice", "english.beginner")
  pool = {}                               → nobody waiting → add alice
  pool = { "english.beginner": "alice" }

findMatch("bob", "english.beginner")
  pool = { "english.beginner": "alice" }  → alice waiting → MATCH
  pool = {}                               → both removed → notify both
```

**Redis pool operations (safe version — Lua script):**
```typescript
async findMatch(userId: string, level: string) {
  // Lua script runs atomically in Redis — no other command executes between HGET and HDEL
  const script = `
    local waiting = redis.call('HGET', 'pool', KEYS[1])
    if waiting then
      redis.call('HDEL', 'pool', KEYS[1])
      return waiting
    end
    redis.call('HSET', 'pool', KEYS[1], ARGV[1])
    return nil
  `
  const partner = await this.redis.eval(script, 1, level, userId)
  if (partner) return { matched: true, partner }
  return { matched: false }
}

async cancelMatch(userId: string, level: string) {
  const script = `
    local waiting = redis.call('HGET', 'pool', KEYS[1])
    if waiting == ARGV[1] then
      redis.call('HDEL', 'pool', KEYS[1])
    end
    return nil
  `
  await this.redis.eval(script, 1, level, userId)
}
```

---

## Race Condition

**The problem:**
Node.js is single-threaded but Redis calls are async. Under high load, two concurrent match requests can interleave:

```
request 1: await redis.hget('pool', level)  → reads "alice"
           [event loop switches to request 2]
request 2: await redis.hget('pool', level)  → also reads "alice"
request 1: await redis.hdel('pool', level)  → deletes alice
request 2: await redis.hdel('pool', level)  → alice already gone, but match was triggered twice
→ alice ends up in two rooms
```

**Why broker-level race condition doesn't apply here:**
Only 1 Matching Service instance using pub/sub — only one consumer receives each message, so no duplicate processing at the broker level.

**Fix — Redis Lua script:**
Lua scripts execute atomically inside Redis. No other command can run between `HGET` and `HDEL`. The unsafe separate `hget` + `hdel` calls are replaced with a single atomic script (see code above).

**In thesis (BAB III):**
> "Redis Lua script digunakan untuk memastikan operasi pool bersifat atomik dan mencegah race condition yang dapat terjadi akibat sifat asinkron Node.js event loop."

---

## Test Scenarios

| Level | Virtual Users | Duration | Representation |
|---|---|---|---|
| Ringan | 100 | 2 minutes | Minimal load |
| Moderat | 500 | 3 minutes | Typical usage |
| Intensif | 1000 | 3 minutes | Peak condition |
| Ekstrem | 5000 | 3 minutes | Stress condition |

Each scenario run 3× and averaged for statistical validity.

**Before running load test:**
```bash
docker compose stop monolith   # remove non-thesis resource competition
```

---

## Metrics

| Metric | Unit | Tool | Description |
|---|---|---|---|
| Latency p50/p95/p99 | ms | k6 | End-to-end: match request → match notification received |
| Throughput | matches/sec | k6 | Successful matches completed per second |
| CPU Usage | % | cAdvisor + Prometheus | Broker container only |
| Memory Usage | MB | cAdvisor + Prometheus | Broker container only |

---

## Database Schema

### users
```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  username      VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  google_id     VARCHAR(255) UNIQUE,
  target_language VARCHAR(10) NOT NULL,
  proficiency   VARCHAR(20) NOT NULL,   -- BEGINNER | INTERMEDIATE | ADVANCED
  avatar_url    VARCHAR(500),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### rooms
```sql
CREATE TABLE rooms (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id            UUID NOT NULL REFERENCES users(id),
  user2_id            UUID NOT NULL REFERENCES users(id),
  agora_channel_name  VARCHAR(255) NOT NULL,
  agora_token_user1   TEXT,
  agora_token_user2   TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at            TIMESTAMP
);
```

### refresh_tokens
```sql
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  expires_at  TIMESTAMP NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### lobbies, lobby_members, lobby_messages, friendships, friend_requests, conversations, messages
Same as before — handled by monolith service, not part of thesis evaluation.

**Note:** No `matchmaking_queue` table — pool lives in Redis, not PostgreSQL.

---

## Project Folder Structure

NestJS monorepo (`nest-cli.json` with multiple apps):

```
skripsi-matchmaking/
├── apps/
│   ├── api/                        ← API Service (port 3000)
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── auth/               ← JWT, Google OAuth
│   │       └── match/              ← POST /match/join
│   │
│   ├── matching/                   ← Matching Service (port 3001)
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       └── matching/
│   │           ├── matching.controller.ts  ← @MessagePattern('matchmaking.>'), @MessagePattern('match.cancel')
│   │           ├── matching.service.ts     ← pool logic + Agora token generation
│   │           ├── pool.service.ts         ← Redis pool operations
│   │           └── agora.service.ts        ← generate channelName + tokenUser1 + tokenUser2
│   │
│   ├── notification/               ← Notification Service (port 3002)
│   │   └── src/
│   │       ├── main.ts             ← WsAdapter (raw WS, not Socket.IO)
│   │       ├── app.module.ts
│   │       └── notification/
│   │           ├── gateway/
│   │           │   └── ws.gateway.ts           ← @WebSocketGateway(), onConnect(?token&level), onDisconnect→publish match.cancel
│   │           ├── notification.controller.ts  ← @MessagePattern('match.found')
│   │           ├── notification.service.ts     ← push to WS registry, publish match.cancel
│   │           └── registry.service.ts         ← userId → { socket, level }
│   │
│   └── monolith/                   ← Non-thesis features (stopped during load test)
│       └── src/
│           ├── main.ts
│           ├── lobbies/
│           ├── friends/
│           ├── messages/
│           └── rooms/              ← room history (optional, not used during load test)
│
├── libs/
│   └── shared/
│       └── src/
│           ├── events/
│           │   └── index.ts        ← MatchRequestEvent, MatchFoundEvent, MatchCancelEvent
│           └── dto/
│               └── index.ts        ← shared DTOs
│
├── prisma/
│   ├── schema.prisma               ← single schema for all apps
│   └── migrations/
│
├── docker/
│   ├── docker-compose.nats.yml     ← Version A
│   ├── docker-compose.rabbitmq.yml ← Version B
│   └── nginx/
│       └── nginx.conf
│
├── k6/
│   ├── matchmaking.js
│   └── scenarios/
│       ├── light.json              ← 100 VU
│       ├── moderate.json           ← 500 VU
│       ├── intensive.json          ← 1000 VU
│       └── extreme.json            ← 5000 VU
│
├── monitoring/
│   ├── prometheus/
│   │   └── prometheus.yml
│   └── grafana/
│       └── dashboards/
│           ├── nats.json
│           └── rabbitmq.json
│
├── nest-cli.json
├── package.json
├── tsconfig.json
└── .env
```

---

## Docker Compose Strategy

```yaml
# docker-compose.nats.yml (Version A)
services:
  api:      { build: ./apps/api }
  matching: { build: ./apps/matching }
  notification: { build: ./apps/notification }
  monolith: { build: ./apps/monolith }
  nats:     { image: nats:latest }
  redis:    { image: redis:alpine }
  postgres: { image: postgres:16 }
  nginx:    { build: ./docker/nginx }

# docker-compose.rabbitmq.yml (Version B)
# same, but replace:
  rabbitmq: { image: rabbitmq:3-management }
# remove:
  nats
```

---

## Environment Variables

```env
# shared
DATABASE_URL=postgresql://user:pass@postgres:5432/skripsi
REDIS_URL=redis://redis:6379
JWT_SECRET=your_secret
AGORA_APP_ID=xxx
AGORA_APP_CERT=xxx
AI_API_KEY=xxx
AI_API_URL=xxx
AI_MODEL=gpt-4o-mini

# Version A only
NATS_URL=nats://nats:4222

# Version B only
RABBITMQ_URL=amqp://rabbitmq:5672
```

---

## Shared Event Types (`libs/shared/src/events/index.ts`)

```typescript
export class MatchRequestEvent {
  userId: string
  level: string   // e.g. "english.beginner"
}

export class MatchFoundEvent {
  user1Id: string
  user2Id: string
  channelName: string
  tokenUser1: string
  tokenUser2: string
  // Note: no DB write during match flow — tokens travel in payload only
}

export class MatchCancelEvent {
  userId: string
  level: string
}
```

---

## k6 Script Pattern

```javascript
import ws from 'k6/ws'
import http from 'k6/http'
import { Trend } from 'k6/metrics'

const matchLatency = new Trend('match_latency')
const users = JSON.parse(open('./users.json'))  // pre-seeded { token, level }[]

export default function () {
  const { token, level } = users[__VU - 1]

  ws.connect(`${WS_URL}/ws?token=${token}&level=${level}`, {}, (socket) => {
    let t1

    socket.on('open', () => {
      t1 = Date.now()
      http.post(`${BASE_URL}/api/match/join`, JSON.stringify({ level }), {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      })
    })

    socket.on('message', (data) => {
      const msg = JSON.parse(data)
      if (msg.event === 'match.found') {
        matchLatency.add(Date.now() - t1)
        socket.close()
      }
    })

    socket.setTimeout(() => socket.close(), 30000)
  })
}
```

`t1` is set just before the HTTP POST. `http` is synchronous — blocks until 202 response. WS `on('message')` fires when `match.found` arrives. `Date.now() - t1` = end-to-end broker latency (HTTP ACK + broker round-trip + push).

**Pre-seeding (run once before any test):**
```bash
npx ts-node k6/seed-users.ts  # inserts 5000 users to DB, writes k6/users.json with tokens
```

## How to Run Experiments

```bash
# Version A — NATS
docker compose -f docker/docker-compose.nats.yml up -d
docker compose -f docker/docker-compose.nats.yml stop monolith
k6 run --config k6/scenarios/light.json k6/matchmaking.js
# collect Grafana metrics, tear down

# Version B — RabbitMQ
docker compose -f docker/docker-compose.rabbitmq.yml up -d
docker compose -f docker/docker-compose.rabbitmq.yml stop monolith
k6 run --config k6/scenarios/light.json k6/matchmaking.js
# collect Grafana metrics, tear down

# Repeat for moderate, intensive, extreme
# Run each 3× and average
```

---

## Citation Strategy

- NestJS official docs + `@nestjs/microservices` documentation
- NATS official docs (nats.io)
- RabbitMQ official docs + AMQP spec
- Prisma documentation
- k6, Prometheus, Grafana, cAdvisor citations
- Find 1-2 Indonesian skripsi or papers comparing message brokers for context/gap analysis

---

## What Changed from Previous Plan

| Aspect | Previous | This Plan |
|---|---|---|
| Comparison | API-Driven vs Event-Driven | NATS vs RabbitMQ |
| Broker | NATS JetStream only | NATS Core vs RabbitMQ |
| Stack | Go + Gin + GORM + Viper | NestJS + TypeScript + Prisma |
| Services | 4 (gateway, match, room, notification) | 3 (api, matching, notification) + monolith |
| Pool storage | PostgreSQL queue table | Redis |
| Metrics | 7 | 3 (latency, throughput, CPU+Memory) |
| Difficulty | Higher | Lower — better for beginner |
