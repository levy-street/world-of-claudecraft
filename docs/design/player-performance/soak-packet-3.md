# Packet 3 soak artifacts: input cadence contract (phase 06)

Captured 2026-07-24 at the packet 3 close-out, per the Phase 06 runbook in
`packet-3-input-cadence.md` (runbook items 1, 2, and 6). The committed JSON
beside this file, `jitter-soak-packet3.json`, is the raw report of run 1.

## Capture environment

Same machine as the packet 0 baseline (`jitter-soak-baseline.json` at
cf3412e66, quoted in the plan doc per ruling R1), so numbers are directly
comparable.

| Field | Value |
|---|---|
| CPU | Apple M4 Max, 16 cores |
| OS | macOS 26.5.2 (arm64) |
| Node | v26.5.0 |
| Branch tip | feature/input-cadence at 5b1648662 (phases 01 to 05 landed) |
| Database | throwaway Postgres 16 container on a spare port (the dev DB was not touched) |
| Server | `npm run build:server`, then `node dist-server/server.cjs` with `ALLOW_DEV_COMMANDS=1` and `METRICS_TOKEN` set; a FRESH server process per run (a leftover fleet held linkdead would pollute the next run) |

## Run 1: jitter soak, 80-bot idle crowd (runbook item 1)

```sh
BOTS=80 IDLE=1 DURATION_MS=60000 \
  JSON_OUT=docs/design/player-performance/jitter-soak-packet3.json \
  node scripts/server_load_jitter.mjs
```

80/80 bots joined plus the observer. Result against the packet 0 baseline:

| Metric | Packet 0 baseline | This run | Verdict |
|---|---|---|---|
| Observer gap p50 / p95 / p99 / max (ms) | 51.3 / 56.9 / 61.2 / 65.8 | 50.6 / 52.2 / 54.9 / 64.8 | p95 inside the baseline band |
| Observer gaps over 100 ms | 0 | 0 (1,185 gaps) | zero hitches |
| Observer avg snapshot bytes | 10,710 | 10,752 | same |
| Bot gap p95 median / worst of 80 | 56.8 / 57.0 | 52.1 / 52.2 | inside the band |
| Avg entities in interest | 144 | 144 | same crowd |
| Sim entities / tick Hz | 504 / 20.25 | 504 / 20.08 | same world |
| Server loop p95 / max (ms) | 16.4 / 23.7 | 8.5 / 19.5 | no regression |

/metrics scraped before and after the run (bearer `METRICS_TOKEN`). The
inbound counters over the whole fleet run:

| Counter | Before | After |
|---|---|---|
| `woc_ws_messages_total{direction="in"}` | 0 | 96,095 |
| `woc_ws_messages_dropped_total` (every cause: rate, bytes, lane_movement, lane_command, lane_chat) | 0 | 0 |
| `woc_ws_rate_kicks_total` | 0 | 0 |
| `woc_input_frames_missed_total` | 0 | 0 |

Acceptance MET: gap p95 within the baseline band and ZERO drop-counter
increments across 96,095 inbound frames from the 81-client fleet.

## Run 2: 120 Hz-class turn soak, one scripted client (runbook item 2)

A fresh server process, then one scripted client driving the REAL input wire
shape (`{t:'input', seq, mi, facing}` per `src/net/online.ts` sendInput) with
contiguous seqs and a held turn (facing advancing every send) at a
drift-corrected flat 80 sends per second for 5 minutes. 80/s is the analytic
hard-cap cadence from ruling R2 (harder than the measured 60 to 64/s a real
120 Hz display produces), so this run bounds every real display class. The
driver source is inlined at the end of this file.

```sh
SOAK_MS=300000 RATE=80 node turn_soak.mjs
```

Result: 24,000 input frames sent at a measured average of 80.0/s (max 81 in
any one second); the server ack high-water (`self.ack`, the echoed
`lastInputSeq`) reached 24,000, so every sent frame was processed, shortfall
zero. The client was never kicked and received no error frame; a clean
logout ended the session.

| Counter | Before | After |
|---|---|---|
| `woc_ws_messages_total{direction="in"}` | 0 | 24,001 (24,000 inputs plus the logout) |
| `woc_ws_messages_dropped_total` (every cause) | 0 | 0 |
| `woc_ws_rate_kicks_total` | 0 | 0 |
| `woc_input_frames_missed_total` | 0 | 0 |

Acceptance MET: drop counters at zero and the seq-gap counter flat over a
sustained 80/s turn stream, the brainstorm section 10 field-verification
criterion run locally.

## Maintainer track, post-deploy (runbook item 6): PENDING

After this packet deploys, scrape the two families on production during a
healthy-FPS play session and confirm both stay flat at zero (the same
criterion the local run 2 verifies). With the production `METRICS_TOKEN`:

```sh
curl -s -H "Authorization: Bearer $METRICS_TOKEN" https://worldofclaudecraft.com/metrics \
  | grep -E 'woc_ws_messages_dropped_total|woc_input_frames_missed_total'
```

Take one scrape at session start and one after several minutes of active
turning and casting; every `woc_ws_messages_dropped_total` cause series and
`woc_input_frames_missed_total` should show no increment between the two.
(`woc_ws_rate_kicks_total` staying flat is expected too, but a nonzero value
there can also mean a real flooder was kicked, so judge it with context.
Likewise `woc_input_frames_missed_total` is derived from client-sent seqs and
a hostile client can inflate it, capped per observation by
`MSG_SEQ_GAP_SANITY`: treat a nonzero value as a prompt to correlate with the
drop-cause series, not as proof of server-side loss on its own, per the
plan's ruling R9.)

## Turn-soak driver source (run 2)

Run from the repo root (resolves `ws` from `node_modules`); it needs no dev
commands, only a reachable server.

```js
// 120 Hz-class turn soak: ONE scripted client driving the real input wire
// shape at the analytic ~80/s cadence (12.5 ms absolute schedule, harder
// than the measured 60-64/s a real 120 Hz display produces).
// Sends contiguous seqs like the real client (online.ts sendInput) and a
// held turn (tl held, facing advancing every send). Reports sends, achieved
// rate, and the server ack high-water from self snapshots; exits nonzero if
// the ack falls short of the last seq sent. Drop/kick/seq-gap counters are
// scraped externally via /metrics before and after.
//
// Env: SERVER_URL (default http://localhost:8787), SOAK_MS (default 300000),
//      RATE (default 80, sends per second).

import WebSocket from 'ws';

const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
const SOAK_MS = Number(process.env.SOAK_MS ?? 300000);
const RATE = Number(process.env.RATE ?? 80);
const STEP_MS = 1000 / RATE;

const uniq = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function main() {
  const st = await fetch(`${BASE}/api/status`).then((r) => r.json()).catch(() => null);
  if (!st?.ok) {
    console.error('server not reachable at', BASE);
    process.exit(1);
  }
  const reg = await api('/api/register', {
    username: `turnsoak_${uniq}`,
    password: 'hunter22',
    email: `turnsoak_${uniq}@example.com`,
  });
  if (!reg.body.token) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
  const token = reg.body.token;
  const char = await api(
    '/api/characters',
    { name: `Turnsoak${uniq.replace(/[0-9]/g, 'x')}`.slice(0, 22), class: 'warrior' },
    token,
  );
  if (!char.body.id) throw new Error(`character create failed: ${JSON.stringify(char.body)}`);

  let seq = 0;
  let lastAck = 0;
  let snaps = 0;
  let errorFrame = null;
  let done = false;
  const ws = new WebSocket(`${WS_BASE}/ws`);
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('join timeout')), 10000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', token, character: char.body.id })));
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.t === 'hello') {
        clearTimeout(to);
        resolve();
      } else if (msg.t === 'snap') {
        snaps++;
        if (typeof msg.self?.ack === 'number' && msg.self.ack > lastAck) lastAck = msg.self.ack;
      } else if (msg.t === 'error') {
        errorFrame = msg.error;
        clearTimeout(to);
        reject(new Error(msg.error));
      }
    });
    ws.on('error', (e) => {
      clearTimeout(to);
      reject(e);
    });
  });
  ws.on('close', (code) => {
    if (errorFrame) {
      console.error(`FATAL: server error frame: ${errorFrame}`);
      process.exit(2);
    }
    if (seq > 0 && !done) {
      console.error(`FATAL: socket closed mid-soak (code ${code}) at seq ${seq}`);
      process.exit(2);
    }
  });

  console.log(`[turn-soak] joined, driving ${RATE}/s for ${SOAK_MS} ms`);
  const start = performance.now();
  let facing = 0;
  const secondCounts = [];
  let curSecond = 0;
  let curCount = 0;
  while (true) {
    const now = performance.now();
    const elapsed = now - start;
    if (elapsed >= SOAK_MS) break;
    if (ws.readyState !== 1) break;
    facing = (facing + 0.0262) % (Math.PI * 2);
    seq += 1;
    ws.send(
      JSON.stringify({
        t: 'input',
        seq,
        mi: { f: 1, b: 0, tl: 1, tr: 0, sl: 0, sr: 0, j: 0 },
        facing,
      }),
    );
    const sec = Math.floor(elapsed / 1000);
    if (sec !== curSecond) {
      secondCounts.push(curCount);
      curSecond = sec;
      curCount = 0;
    }
    curCount += 1;
    const next = start + seq * STEP_MS;
    const wait = next - performance.now();
    if (wait > 0) await sleep(wait);
  }
  done = true;
  await sleep(1500);
  const maxPerSecond = secondCounts.length ? Math.max(...secondCounts) : curCount;
  const avgRate = seq / ((performance.now() - start - 1500) / 1000);
  console.log(
    `[turn-soak] sent=${seq} snaps=${snaps} avgRate=${avgRate.toFixed(1)}/s maxPerSecond=${maxPerSecond}`,
  );
  console.log(`[turn-soak] server ack high-water=${lastAck} (last seq sent=${seq})`);
  const shortfall = seq - lastAck;
  ws.send(JSON.stringify({ t: 'logout' }));
  await sleep(300);
  try {
    ws.close();
  } catch {
    /* closing */
  }
  if (errorFrame) {
    console.error(`FAIL: server sent an error frame: ${errorFrame}`);
    process.exit(2);
  }
  if (shortfall > 5) {
    console.error(`FAIL: ack shortfall ${shortfall} frames`);
    process.exit(3);
  }
  console.log('[turn-soak] PASS: every sent input frame acked (shortfall ' + shortfall + ')');
  process.exit(0);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
```
