// Regression check: an oversized pre-auth ws frame must NOT crash the server.
import WebSocket from 'ws';

const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');

const before = await fetch(BASE + '/api/status')
  .then((r) => r.ok)
  .catch(() => false);
if (!before) {
  console.log('FAIL server not up before test');
  process.exit(1);
}

// connect and immediately send a >16KB frame as the very first message
await new Promise((resolve) => {
  const ws = new WebSocket(`${WS_BASE}/ws`);
  ws.on('open', () => {
    ws.send('x'.repeat(64 * 1024));
    setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve();
    }, 600);
  });
  ws.on('error', () => resolve()); // server closing us is fine
  ws.on('close', () => resolve());
});

await new Promise((r) => setTimeout(r, 500));
const after = await fetch(BASE + '/api/status')
  .then((r) => r.ok)
  .catch(() => false);
console.log(
  after
    ? 'OK   server survived oversized pre-auth frame'
    : 'FAIL server crashed on oversized frame',
);

// and a normal client can still connect afterwards
const dosUser = 'dos_' + Date.now().toString(36);
const r = await fetch(BASE + '/api/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: dosUser,
    password: 'hunter22',
    email: `${dosUser}@example.com`,
  }),
})
  .then((x) => x.json())
  .catch(() => ({}));
console.log(
  r.token ? 'OK   server still serving requests' : 'FAIL server unresponsive after attack',
);
process.exit(after && r.token ? 0 : 1);
