/**
 * Seed script — run ONCE before load tests.
 * Creates N test users and saves their JWT tokens to users.json.
 *
 * Usage:
 *   node k6/seed.js
 *
 * Requires: node-fetch or axios. Run with Node.js 18+.
 */

const API = 'http://localhost:3000/api';
const TOTAL_USERS = 2000; // must be even — VUs pair up
const OUTPUT = './k6/users.json';
const fs = require('fs');

async function register(i) {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `testuser${i}@idiomamate.test`,
      username: `testuser${i}`,
      password: 'Test1234!',
    }),
  });
  if (!res.ok) {
    // already exists — login instead
    const login = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `testuser${i}@idiomamate.test`,
        password: 'Test1234!',
      }),
    });
    return (await login.json()).accessToken;
  }
  return (await res.json()).accessToken;
}

async function main() {
  console.log(`Seeding ${TOTAL_USERS} users...`);
  const users = [];
  const batch = 50;

  for (let i = 0; i < TOTAL_USERS; i += batch) {
    const promises = Array.from({ length: Math.min(batch, TOTAL_USERS - i) }, (_, j) =>
      register(i + j + 1).then(token => ({ id: i + j + 1, token }))
    );
    const results = await Promise.all(promises);
    users.push(...results);
    console.log(`  ${users.length}/${TOTAL_USERS}`);
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(users, null, 2));
  console.log(`Saved to ${OUTPUT}`);
}

main().catch(console.error);
