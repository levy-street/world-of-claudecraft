// Professions load rig: the phase 16 / R36 1,000-concurrent baseline capture.
//
// Drives BOTS synthetic professions sessions against a LOCAL dev server:
// gather bots tour real GATHER_NODES positions (dev_teleport + the tool-press
// 'use' command, which self-picks the nearest ready node), fish bots stand at
// discovered fishable shore spots, cast the rod, answer the fishingBite event
// inside the reel window, and recast on every outcome. A sampled subset of
// bots are parsing OBSERVERS that record snapshot sizes, snapshot gaps, and
// the per-snapshot ncd/tslot payload bytes on the arm under measurement;
// every other bot only counts frames and bytes so one rig process can hold
// 1,000 sockets without distorting the server it measures. The rig also
// reports its own driver-loop lag in the artifact (rig.loopLagMs), so a
// saturated rig is VISIBLE in the evidence rather than silent; the lag is
// disclosed, not gated, and client-side gap numbers are same-box-relative.
//
// The verdict (scripts/lib/bench_gate.mjs, evaluateProfessionsLoadRun, pinned
// by tests/bench_gate.test.ts) is a GATE: partial joins fail, a run whose
// observers rode the wrong timer-wire arm fails (STABLE=1 must see the tw
// echo, STABLE=0 must not), an observer that went quiet past the continuity
// ceiling fails, and a hollow run fails (each role must show its own evidence
// at least once per minute of window: non-empty ncd frames for a gather
// observer, fishing outcomes for a fish one). Evidence lands in JSON_OUT
// before the exit code is decided, the gate's own inputs included.
//
// Setup (full recipe: docs/design/player-performance/professions-load-baseline.md):
//   ulimit -n 10240                      # BOTH shells: 1,000 sockets each side
//   ALLOW_DEV_COMMANDS=1 PERF_TICK_LOG=1 PORT=8799 DATABASE_URL=<throwaway pg> \
//     npm run server
//   DATABASE_URL=<same> SERVER_URL=http://127.0.0.1:8799 BOTS=1000 MODE=mixed \
//     STABLE=1 JSON_OUT=tmp/prof-load.json node scripts/load_professions.mjs
//
// Env: SERVER_URL, DATABASE_URL (required, loopback only), REALM_NAME, BOTS,
//      MODE (gather|fish|mixed), STABLE (1 = request the stable timer wire),
//      DURATION_MS, WARMUP_MS, CONNECT_CONCURRENCY, STEP_MS, TOUR_SEC,
//      NODES_PER_BOT, OBSERVERS, BOT_LEVEL, REPORT_MS, RUN_ID, JSON_OUT,
//      CLEANUP=1, METRICS_TOKEN (optional: the server's own METRICS_TOKEN,
//      which lets the rig scrape the db-pool gauges off /metrics; without it
//      the pool readouts stamp null and nothing else changes).
//
// Seeding is direct-to-Postgres like scripts/load_players.mjs (no bcrypt
// register storm ahead of the measurement window); each bot rides its own
// X-Forwarded-For so loopback per-IP caps never throttle the fleet. The pure
// halves live in scripts/lib/ per the module-first rule: prof_load_util.mjs
// (spot discovery, observer aggregation, knob parsing) and loopback_guard.mjs
// (the shared local-only control), both Vitest-pinned.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import pg from 'pg';
import WebSocket from 'ws';
import { evaluateProfessionsLoadRun, gapStats, sampleStats } from './lib/bench_gate.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';
import {
  aggregateObservers,
  boundedEnvInt,
  findFishingSpots,
  ipFor,
  lettersOf,
  mulberry32,
  sanitizeBaseUrl,
  terminalAwareGapMax,
} from './lib/prof_load_util.mjs';
import { worldAuthMessage } from './lib/world_auth.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = (process.env.SERVER_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');

const L = 'abcdefghijklmnopqrstuvwxyz';
function randomLetters(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += L[Math.floor(Math.random() * 26)];
  return s;
}

const BOTS = boundedEnvInt(process.env.BOTS, 100, 1, 1200);
const MODE = ['gather', 'fish', 'mixed'].includes(process.env.MODE ?? '')
  ? process.env.MODE
  : 'mixed';
// 2 is STABLE_TIMER_WIRE_VERSION (src/world_api.ts). A stale constant cannot
// silently measure the wrong arm: the gate fails any STABLE=1 run whose
// observers never see the server's tw echo, and any STABLE=0 run that does.
const STABLE = process.env.STABLE === '1';
const DURATION_MS = boundedEnvInt(process.env.DURATION_MS, 180000, 5000, 24 * 3600 * 1000);
const CONNECT_CONCURRENCY = boundedEnvInt(process.env.CONNECT_CONCURRENCY, 20, 1, 50);
const STEP_MS = boundedEnvInt(process.env.STEP_MS, 250, 50, 5000);
const TOUR_SEC = boundedEnvInt(process.env.TOUR_SEC, 6, 3, 120);
const NODES_PER_BOT = boundedEnvInt(process.env.NODES_PER_BOT, 40, 1, 120);
const OBSERVERS = boundedEnvInt(process.env.OBSERVERS, 32, 1, 128);
const BOT_LEVEL = boundedEnvInt(process.env.BOT_LEVEL, 60, 1, 60);
const WARMUP_MS = boundedEnvInt(process.env.WARMUP_MS, 45000, 2000, 300000);
const REPORT_MS = boundedEnvInt(process.env.REPORT_MS, 10000, 1000, 60000);
const REALM = process.env.REALM_NAME ?? 'Claudemoon';
const METRICS_TOKEN = process.env.METRICS_TOKEN ?? '';
const JSON_OUT = process.env.JSON_OUT ?? '';
const CLEANUP = process.env.CLEANUP === '1';
const RUN_ID = (process.env.RUN_ID ?? '').replace(/[^a-z]/gi, '').slice(0, 8) || randomLetters(5);

// This rig seeds token-only accounts straight into the database and drives
// /dev cheats; every target must be loopback (the shared control in
// scripts/lib/loopback_guard.mjs, ?host= override aware on the DATABASE arm).
assertLoopbackUrl(BASE, 'SERVER_URL');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (direct bot seeding)');
assertLoopbackDatabaseUrl(process.env.DATABASE_URL);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tier-3 tools cover every shipped node tier (asserted against the live
// content below) and the tier-3 rod covers every zone's water. The tier-1
// kit wields at proficiency 0, so presses landing before the queued /dev
// gather grants apply still harvest tier-1 nodes instead of denying.
const TOOL_BY_NODE_TYPE = {
  ore: 'mithril_mining_pick',
  wood: 'ironbark_axe',
  herb: 'silverleaf_sickle',
};
const T1_TOOLS = ['copper_mining_pick', 'handaxe', 'gathering_sickle'];
const ROD_ITEM = 'silverstream_fishing_rod';
const GATHER_PROFS = ['mining', 'logging', 'herbalism'];

const SNAP_PREFIX = Buffer.from('{"t":"snap"');
const EVENTS_PREFIX = Buffer.from('{"t":"events"');

// Real sim content, bundled at run time the export_loot_spreadsheet.mjs way
// (scripts never import TS sources raw).
async function loadSimData() {
  const build = await esbuild.build({
    stdin: {
      contents: `
        export { GATHER_NODES } from './src/sim/content/gather_nodes.ts';
        export { zoneAt } from './src/sim/data.ts';
        export { firstFishableSampleAhead } from './src/sim/professions/fishing.ts';
        export { groundHeight, waterLevelAt } from './src/sim/world.ts';
        export { WORLD_SEED } from './src/sim/world_seed.ts';
      `,
      resolveDir: ROOT,
      sourcefile: 'prof-load-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`;
  return import(dataUrl);
}

const LOADTEST_PASSWORD_HASH = 'loadtest:token-only';

// Batched seeding: three multi-row statements for the whole fleet instead of
// three round trips per bot (the review round measured the serial version at
// effective concurrency one), all inside ONE transaction so a collision
// abort leaves zero rows behind. Collision honesty over convenience: the
// friendly name pre-check runs FIRST, the accounts upsert only ever
// overwrites a row THIS harness family minted (the password_hash predicate),
// and the characters insert arbitrates on the REAL uniqueness rule
// (server/social_db.ts: the UNIQUE (realm, lower(name)) expression index; the
// original global name constraint was dropped by that migration), so a clash
// that races past the pre-check suppresses its row and trips the count guard
// instead of half-seeding.
async function seedBots(pool) {
  const usernames = [];
  const names = [];
  const tokens = [];
  for (let i = 0; i < BOTS; i += 1) {
    usernames.push(`prof_${RUN_ID.toLowerCase()}_${String(i).padStart(4, '0')}`);
    names.push(`P${RUN_ID}${lettersOf(i)}`.slice(0, 16));
    tokens.push(randomBytes(32).toString('hex'));
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const nameClash = await client.query(
      `SELECT name FROM characters WHERE realm = $2 AND lower(name) = ANY($1::text[]) LIMIT 3`,
      [names.map((n) => n.toLowerCase()), REALM],
    );
    if (nameClash.rows.length > 0) {
      throw new Error(
        `character seeding would duplicate existing name(s) e.g. "${nameClash.rows[0].name}"; ` +
          'refusing. Use a fresh RUN_ID.',
      );
    }
    const accounts = await client.query(
      `INSERT INTO accounts (username, password_hash)
       SELECT u, $2 FROM unnest($1::text[]) AS u
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
         WHERE accounts.password_hash = EXCLUDED.password_hash
       RETURNING id, username`,
      [usernames, LOADTEST_PASSWORD_HASH],
    );
    if (accounts.rows.length !== BOTS) {
      const returned = new Set(accounts.rows.map((r) => r.username));
      const collided = usernames.filter((u) => !returned.has(u));
      throw new Error(
        `account seeding collided with ${collided.length} existing non-loadtest account(s), ` +
          `e.g. "${collided[0]}"; refusing to overwrite. Use a fresh RUN_ID.`,
      );
    }
    const idByUsername = new Map(accounts.rows.map((r) => [r.username, r.id]));
    const accountIds = usernames.map((u) => idByUsername.get(u));
    await client.query(
      `INSERT INTO auth_tokens (token, account_id, expires_at)
       SELECT t, a, now() + interval '12 hours'
       FROM unnest($1::text[], $2::int[]) AS pairs(t, a)`,
      [tokens, accountIds],
    );
    const characters = await client.query(
      `INSERT INTO characters (account_id, name, class, realm, state)
       SELECT a, n, 'warrior', $3, NULL
       FROM unnest($1::int[], $2::text[]) AS pairs(a, n)
       ON CONFLICT (realm, lower(name)) DO NOTHING
       RETURNING id, account_id`,
      [accountIds, names, REALM],
    );
    if (characters.rows.length !== BOTS) {
      throw new Error(
        `character seeding wrote ${characters.rows.length} of ${BOTS} rows (a name clash raced ` +
          'past the pre-check); aborting the run. Use a fresh RUN_ID.',
      );
    }
    await client.query('COMMIT');
    const charByAccount = new Map(characters.rows.map((r) => [r.account_id, r.id]));
    return accountIds.map((accountId, i) => ({
      token: tokens[i],
      characterId: charByAccount.get(accountId),
      accountId,
    }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Account ids deleted per statement. A single 1,000-id DELETE walks every
// ON DELETE SET NULL referrer of every account inside ONE statement (several
// of those referring columns carry no index), holds its locks for the whole
// walk, and blocks behind any character save still in flight from the fleet
// that just logged out. Chunking keeps each lock window short enough for
// those saves to interleave instead of queueing behind the cleanup.
const CLEANUP_CHUNK = 100;

async function cleanupBots(pool, records) {
  const accountIds = records.map((r) => r.accountId);
  let deleted = 0;
  for (let i = 0; i < accountIds.length; i += CLEANUP_CHUNK) {
    const chunk = accountIds.slice(i, i + CLEANUP_CHUNK);
    try {
      const res = await pool.query('DELETE FROM accounts WHERE id = ANY($1::int[])', [chunk]);
      deleted += res.rowCount ?? 0;
    } catch (err) {
      // A mid-loop throw leaves PART of the fleet seeded, and the operator
      // reusing the container for the next scenario has to know which part:
      // a bare driver error names neither the chunk nor how far cleanup got.
      throw new Error(
        `cleanup failed on chunk ${Math.floor(i / CLEANUP_CHUNK) + 1} of ` +
          `${Math.ceil(accountIds.length / CLEANUP_CHUNK)} (account ids ${chunk[0]} to ` +
          `${chunk.at(-1)}); ${deleted} of ${accountIds.length} accounts were deleted before it`,
        { cause: err },
      );
    }
  }
}

// The db-pool saturation gauges, scraped off the Prometheus exposition at
// window open and close so an artifact says whether the pool was starved
// while the numbers beside it were measured. /metrics is bearer-gated by the
// SERVER's METRICS_TOKEN (server/http/health.ts handleMetricsGate: 404 when
// the server has none, 401 on a wrong credential), which the capture recipe
// does not require, so every failure arm stamps null. This is DISCLOSURE, not
// a gate input: a run without the token is still a valid capture.
let metricsStatusLogged = false;

async function scrapePoolClients() {
  if (!METRICS_TOKEN) return null;
  try {
    const res = await fetch(`${BASE}/metrics`, {
      headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
    });
    if (!res.ok) {
      // A wrong token (401) and a server that has none (404) are otherwise
      // indistinguishable from passing no token at all: every arm just stamps
      // null, so an operator who set METRICS_TOKEN gets silence instead of the
      // gauges. Said ONCE, because the drain below polls this in a loop.
      if (!metricsStatusLogged) {
        metricsStatusLogged = true;
        console.log(
          `[prof-load] /metrics answered HTTP ${res.status}; pool gauges stamp null ` +
            '(401 = the token does not match the server, 404 = the server has none)',
        );
      }
      return null;
    }
    const text = await res.text();
    const out = { waiting: null, total: null, idle: null };
    for (const state of Object.keys(out)) {
      // prom-client renders one line per label set: woc_db_pool_clients{state="idle"} 7
      const m = text.match(
        new RegExp(`^woc_db_pool_clients\\{state="${state}"\\}\\s+(\\S+)$`, 'm'),
      );
      if (m) out[state] = Number(m[1]);
    }
    return out;
  } catch {
    return null;
  }
}

class Bot {
  constructor(index, record, role, isObserver) {
    this.index = index;
    this.token = record.token;
    this.characterId = record.characterId;
    this.role = role; // 'gather' | 'fish'
    this.isObserver = isObserver;
    this.ip = ipFor(index + 1);
    this.pid = -1;
    this.alive = false;
    // fleet-wide cheap counters
    this.bytes = 0;
    this.frames = 0;
    // observer evidence
    this.snapTimes = [];
    this.snapSizes = [];
    this.snapCount = 0;
    this.ncdCount = 0;
    this.ncdBytes = 0;
    this.tslotCount = 0;
    this.tslotBytes = 0;
    this.sawStableTw = false;
    this.ncdFrames = 0;
    this.fishingOutcomes = 0;
    // fish driver state
    this.fishState = 'idle';
    this.nextCastAt = 0;
    this.castStartedAt = 0;
    // gather driver state
    this.route = [];
    this.routeIndex = 0;
    this.nextTourAt = 0;
    this.pressAt = 0;
    this.pendingTool = null;
    // fish spot state
    this.spot = null;
    this.spotRotations = 0;
  }

  async join() {
    const authExtra = STABLE ? { timerWire: 2 } : {};
    await new Promise((resolve, reject) => {
      // The socket is held in a LOCAL as well, and every handler that outlives
      // the handshake is guarded on it: a retry pass replaces this.ws, and a
      // late close or error from the abandoned socket must not mark the new
      // session dead. Unreachable while the retry only ever runs on bots whose
      // join failed, but the guard costs one comparison and removes the class.
      const ws = new WebSocket(`${WS_BASE}/ws`, { headers: { 'X-Forwarded-For': this.ip } });
      this.ws = ws;
      // A rejected join must CLOSE the socket: a hello landing after this
      // timeout would otherwise put an uncounted bot in the world and skew
      // both the join gate and the measurement (seen live: 831 alive of 627
      // joined on the first 1,000-bot attempt).
      const abort = (err) => {
        clearTimeout(to);
        try {
          ws.terminate();
        } catch {
          /* already gone */
        }
        reject(err);
      };
      // Well past the server's own 10 s auth deadline: the server must always
      // decide first. A client-side abort of an in-flight handshake can
      // orphan a zombie session that holds the character lease for minutes
      // (the tail-of-ramp failure shape), so the rig never gives up early.
      const to = setTimeout(() => abort(new Error('join timeout')), 30000);
      ws.on('open', () => {
        ws.send(
          JSON.stringify({ ...worldAuthMessage(this.token, this.characterId), ...authExtra }),
        );
      });
      const onJoinMessage = (data) => {
        // Same guard as close/error below, for the same reason: a retry pass
        // replaces this.ws, and a hello arriving late on the ABANDONED socket
        // must not overwrite the new session's pid or re-seed it.
        if (this.ws !== ws) return;
        let msg;
        try {
          msg = JSON.parse(String(data));
        } catch {
          return;
        }
        if (msg.t === 'hello') {
          this.pid = msg.id ?? msg.pid;
          this.alive = true;
          clearTimeout(to);
          ws.off('message', onJoinMessage);
          // Guarded too: frames from an abandoned socket would otherwise be
          // counted as this bot's measured traffic.
          ws.on('message', (d) => {
            if (this.ws !== ws) return;
            this.onFrame(d);
          });
          this.seedSession();
          resolve();
        } else if (msg.t === 'error') {
          abort(new Error(msg.error ?? 'auth error'));
        }
      };
      ws.on('message', onJoinMessage);
      ws.on('error', (e) => {
        if (this.ws !== ws) return;
        abort(e);
      });
      ws.on('close', () => {
        if (this.ws !== ws) return;
        this.alive = false;
      });
    });
  }

  // Runs the moment THIS bot's hello lands, so the fleet disperses while it
  // is still joining. Fresh characters all spawn on one spawn point; letting
  // hundreds pile up there makes interest quadratic, drags the loop callback
  // past the server's 10 s auth deadline, and starves the remaining joins
  // (the failure shape of the first 1,000-bot attempt). The chat volley
  // stays inside the chat lane's burst of 8.
  seedSession() {
    this.cmd({ cmd: 'dev_level', level: BOT_LEVEL });
    this.cmd({ cmd: 'chat', text: '/dev god' });
    if (this.role === 'gather') {
      for (const prof of GATHER_PROFS) this.cmd({ cmd: 'chat', text: `/dev gather ${prof} 100` });
      for (const item of Object.values(TOOL_BY_NODE_TYPE)) this.cmd({ cmd: 'dev_give', item });
      for (const item of T1_TOOLS) this.cmd({ cmd: 'dev_give', item });
      const first = this.route[0];
      this.cmd({ cmd: 'dev_teleport', x: first.pos.x, z: first.pos.z });
      this.routeIndex = 1;
      this.pendingTool = TOOL_BY_NODE_TYPE[first.type];
    } else {
      this.cmd({ cmd: 'chat', text: '/dev gather fishing 100' });
      this.cmd({ cmd: 'chat', text: '/dev gather fishing 100' });
      this.cmd({ cmd: 'dev_give', item: ROD_ITEM });
      this.cmd({ cmd: 'dev_teleport', x: this.spot.x, z: this.spot.z });
      this.input({}, this.spot.facing);
    }
  }

  // Called once when every join has landed: phase-stagger the fleet so tour
  // teleports and casts spread evenly instead of thundering on one step.
  armDriver(now, fleetSize) {
    if (this.role === 'gather') {
      this.pressAt = now + 500 + Math.floor((this.index / fleetSize) * 2000);
      this.nextTourAt = now + 2500 + Math.floor((this.index / fleetSize) * TOUR_SEC * 1000);
    } else {
      this.nextCastAt = now + Math.floor((this.index / fleetSize) * 2000);
    }
  }

  // A fish bot whose casts never resolve (bad spot, server-side water
  // disagreement) rotates to another discovered spot instead of denying
  // forever; self-healing keeps a 1,000-bot run from failing on one spot.
  rotateSpot(spots) {
    this.spotRotations = (this.spotRotations ?? 0) + 1;
    this.spot = spots[(this.index + this.spotRotations) % spots.length];
    this.cmd({ cmd: 'dev_teleport', x: this.spot.x, z: this.spot.z });
    this.input({}, this.spot.facing);
  }

  // The per-frame hot path for 1,000 sockets: byte and frame counters for
  // everyone; prefix-checked cheap scans for fish drivers; a full parse only
  // on the sampled observers.
  onFrame(data) {
    this.frames += 1;
    this.bytes += data.length;
    const isSnap = data.length > 11 && data.subarray(0, 11).equals(SNAP_PREFIX);
    const isEvents = !isSnap && data.length > 13 && data.subarray(0, 13).equals(EVENTS_PREFIX);
    if (this.role === 'fish' && isEvents) {
      if (data.includes('"fishingBite"')) {
        // the reel: re-press the rod inside the server's reaction window
        this.cmd({ cmd: 'use', item: ROD_ITEM });
        this.fishState = 'reeling';
      }
      if (
        data.includes('"fishingResult"') ||
        data.includes('"fishingGotAway"') ||
        data.includes('"fishingEmptyHook"')
      ) {
        this.fishingOutcomes += 1;
        this.fishState = 'idle';
        this.nextCastAt = Date.now() + 800;
      }
    }
    if (!this.isObserver) return;
    if (isSnap) {
      this.snapTimes.push(performance.now());
      this.snapSizes.push(data.length);
      this.snapCount += 1;
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.tw === 2) this.sawStableTw = true;
      const self = msg.self;
      if (self && self.ncd !== undefined) {
        this.ncdCount += 1;
        this.ncdBytes += JSON.stringify(self.ncd).length;
        if (Object.keys(self.ncd).length > 0) this.ncdFrames += 1;
      }
      if (self && self.tslot !== undefined) {
        this.tslotCount += 1;
        this.tslotBytes += JSON.stringify(self.tslot).length;
      }
    }
  }

  cmd(p) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'cmd', ...p }));
  }
  input(mi, facing) {
    if (this.ws?.readyState === 1)
      this.ws.send(JSON.stringify({ t: 'input', mi, ...(facing !== undefined ? { facing } : {}) }));
  }
  close() {
    try {
      // clean leave (lane-exempt) so a scenario's fleet does not linger as
      // 1,000 linkdead entities under the next scenario's measurement
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'logout' }));
      this.ws?.close();
    } catch {
      /* already closing */
    }
  }

  resetMeasurement() {
    this.bytes = 0;
    this.frames = 0;
    this.snapTimes.length = 0;
    this.snapSizes.length = 0;
    this.snapCount = 0;
    this.ncdCount = 0;
    this.ncdBytes = 0;
    this.tslotCount = 0;
    this.tslotBytes = 0;
    this.fishingOutcomes = 0;
    // WINDOW-scoped evidence: ncdFrames resets with the counters (the review
    // round: a fleet that harvested only during warmup and then stalled for
    // the whole window must fail the hollow-run gate, exactly like the fish
    // arm's outcome count). sawStableTw alone survives: the wire arm is fixed
    // at join and cannot change inside the window.
    this.ncdFrames = 0;
  }
}

// The fleet's logout wave has to LAND before the pool closes and (under
// CLEANUP) the accounts go: at 1,000 sockets the server takes longer than any
// fixed sleep to run every close and save, and deleting accounts out from
// under an in-flight character save is how a teardown poisons the database
// for the next scenario. So the rig polls the server's own liveness count
// instead of sleeping. Capped, because any unrelated local session counts
// toward players_online and must never hang the rig.
const DRAIN_CAP_MS = 30000;
const DRAIN_POLL_MS = 250;
// A single failed /api/status is TRANSIENT, not proof the server is gone: the
// box is saturated and answering the fleet's own logout wave, which is exactly
// when one request gets dropped. Returning on the first null would turn the
// whole drain into a no-op at the only moment it matters. Only a server that
// never answered ONCE (already down, or never up on a mid-seed abort) has no
// fleet left to drain, and waiting out the cap for it just slows teardown.
const DRAIN_MAX_CONSECUTIVE_FAILURES = 5;
// Fixed grace for the save wave when the pool cannot be watched directly.
const SAVE_GRACE_MS = 3000;

// players_online counts the server's live `clients` map, and the leave path
// deletes from it BEFORE awaiting the character save, so the count reaches
// zero with saves still in flight. Under CLEANUP that gap is where a DELETE
// lands under an in-flight save. With METRICS_TOKEN the rig can watch the real
// thing (the db pool going fully idle); without it a fixed grace is the only
// honest option. Shares the caller's deadline, so the cap stays 30 s overall.
async function waitForSaveDrain(deadline) {
  if (!METRICS_TOKEN) {
    await sleep(Math.min(SAVE_GRACE_MS, Math.max(0, deadline - Date.now())));
    return;
  }
  let idleSamples = 0;
  while (Date.now() < deadline) {
    const pool = await scrapePoolClients();
    // idle === total means nothing is checked out, so no save is running.
    // TWO consecutive samples, because one can land in the gap between two
    // saves; the null-field arms are excluded so a missing gauge line cannot
    // read as null === null and pass.
    if (pool && Number.isFinite(pool.idle) && Number.isFinite(pool.total)) {
      idleSamples = pool.idle === pool.total ? idleSamples + 1 : 0;
      if (idleSamples >= 2) return;
    } else {
      // No usable gauges (no token on the server, wrong token, changed
      // exposition): fall back to the fixed grace rather than spinning to the
      // cap on every teardown.
      await sleep(Math.min(SAVE_GRACE_MS, Math.max(0, deadline - Date.now())));
      return;
    }
    await sleep(DRAIN_POLL_MS);
  }
}

async function waitForFleetDrain() {
  const deadline = Date.now() + DRAIN_CAP_MS;
  // One settle first: the close frames need a moment to reach the server
  // before its own count means anything.
  await sleep(DRAIN_POLL_MS);
  let answers = 0;
  let consecutiveFailures = 0;
  for (;;) {
    const st = await fetch(`${BASE}/api/status`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (st) {
      answers += 1;
      consecutiveFailures = 0;
      if (!(st.players_online > 0)) break;
    } else {
      consecutiveFailures += 1;
      if (answers === 0 && consecutiveFailures >= DRAIN_MAX_CONSECUTIVE_FAILURES) return;
    }
    if (Date.now() >= deadline) {
      console.log(
        st
          ? `[prof-load] ${st.players_online} still online after ${DRAIN_CAP_MS}ms; proceeding with teardown`
          : `[prof-load] /api/status unanswered at the ${DRAIN_CAP_MS}ms drain cap; proceeding with teardown`,
      );
      return;
    }
    await sleep(DRAIN_POLL_MS);
  }
  await waitForSaveDrain(deadline);
}

// The documented recipe writes JSON_OUT into the artifact directory beside the
// baseline doc, so scenario 1 dirties the tree by the rig's OWN doing and
// scenarios 2 to 4 inherit that dirt: an unfiltered `git status --porcelain`
// stamps gitDirty true on every honest run of the recipe, which is a flag that
// cries wolf rather than evidence. Only paths OUTSIDE the artifact directory
// bear on whether a capture is reproducible from gitHead.
const ARTIFACT_DIR = 'docs/design/player-performance/';

function isArtifactPath(porcelainLine) {
  // `XY <path>`, or `XY <old> -> <new>` for a rename; git quotes a path with
  // unusual bytes, and the quote is not part of the path.
  const path = porcelainLine.slice(3).split(' -> ').at(-1).replace(/^"|"$/g, '');
  return path.startsWith(ARTIFACT_DIR);
}

// Set inside main once the fleet exists, so the fatal-error path can still
// log the fleet out (see main().catch at the bottom).
let teardown = null;

async function main() {
  const startIso = new Date().toISOString();
  let gitHead = 'unknown';
  let gitDirty = false;
  try {
    gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
    gitDirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT })
      .toString()
      .split('\n')
      .filter((line) => line.trim() !== '')
      .some((line) => !isArtifactPath(line));
  } catch {
    /* not a git checkout */
  }
  // Echoed through sanitizeBaseUrl on both arms: a basic-auth SERVER_URL must
  // not reach the console any more than it may reach the committed artifact.
  console.log(
    `[prof-load] target=${sanitizeBaseUrl(BASE)} bots=${BOTS} mode=${MODE} stable=${STABLE ? 1 : 0} duration=${DURATION_MS}ms run=${RUN_ID}`,
  );
  const st = await fetch(`${BASE}/api/status`)
    .then((r) => r.json())
    .catch(() => null);
  if (!st?.ok) {
    console.error('server not reachable / not ok at', sanitizeBaseUrl(BASE));
    process.exit(1);
  }

  const sim = await loadSimData();
  const maxNodeTier = Math.max(...sim.GATHER_NODES.map((n) => n.tier));
  if (maxNodeTier > 3) {
    throw new Error(
      `content grew a tier-${maxNodeTier} node; the rig's tier-3 tool kit no longer covers every node`,
    );
  }

  const fishCount = MODE === 'fish' ? BOTS : MODE === 'mixed' ? Math.floor(BOTS / 2) : 0;
  const spots = fishCount > 0 ? findFishingSpots(sim, Math.min(64, Math.max(8, fishCount))) : [];
  if (fishCount > 0 && spots.length === 0) throw new Error('no fishable shore spots discovered');
  if (spots.length) {
    const zones = [...new Set(spots.map((s) => s.zoneId))];
    console.log(`[prof-load] ${spots.length} fishing spots across ${zones.length} zones`);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

  // Teardown that ALWAYS runs (the load_players.mjs shape), armed BEFORE
  // seeding so even a mid-seed throw ends the pool and honors CLEANUP
  // (records and bots are captured by reference and start empty): a throw or
  // a Ctrl-C mid-run must still log the fleet out (a lingering fleet's
  // leases and linkdead entities are exactly what breaks the NEXT scenario's
  // ramp).
  let records = [];
  let bots = [];
  // Idempotent AND awaitable. SIGINT, the fatal-error path, and the normal end
  // of main can all reach stop(); a second caller must await the SAME teardown
  // rather than return immediately (an early return let process.exit race the
  // account delete that the first call was still running).
  let stopPromise = null;
  async function runStop() {
    for (const b of bots) b.close();
    await waitForFleetDrain();
    if (CLEANUP) {
      console.log('[prof-load] cleanup enabled, deleting seeded accounts');
      await cleanupBots(pool, records);
    }
    await pool.end();
  }
  function stop() {
    stopPromise ??= runStop();
    return stopPromise;
  }
  teardown = stop;
  process.once('SIGINT', () => {
    stop()
      .then(() => process.exit(130))
      .catch((err) => {
        console.error('[prof-load] stop failed:', err);
        process.exit(1);
      });
  });

  console.log(`[prof-load] seeding ${BOTS} bots (direct DB, run id ${RUN_ID})`);
  records = await seedBots(pool);

  // roles and observers: fish bots first so a mixed fleet interleaves both
  // roles across the observer stride. Routes and spots are assigned BEFORE
  // the join so seedSession can disperse each bot the moment it lands.
  bots = records.map((record, i) => {
    const role = i < fishCount ? 'fish' : 'gather';
    const bot = new Bot(i, record, role, false);
    if (role === 'gather') {
      const rng = mulberry32(0xbeef + i);
      bot.route = [...sim.GATHER_NODES].sort(() => rng() - 0.5).slice(0, NODES_PER_BOT);
    } else {
      bot.spot = spots[i % spots.length];
    }
    return bot;
  });
  const stride = Math.max(1, Math.floor(BOTS / OBSERVERS));
  let observersPicked = 0;
  for (let i = 0; i < bots.length && observersPicked < OBSERVERS; i += stride) {
    bots[i].isObserver = true;
    observersPicked += 1;
  }
  // a mixed run must observe BOTH roles: force one of each if the stride missed
  for (const role of MODE === 'mixed' ? ['gather', 'fish'] : []) {
    if (!bots.some((b) => b.isObserver && b.role === role)) {
      const candidate = bots.find((b) => b.role === role);
      if (candidate) candidate.isObserver = true;
    }
  }

  // ---- join (CONNECT_CONCURRENCY at a time). Joined bots stand GEARED and
  // DISPERSED but idle: driving the workload during the ramp saturates the
  // loop callback and starves later handshakes past the server's 10 s auth
  // deadline (observed live: 604 of 1,000). The workload starts when the
  // last join lands, runs a staggered WARMUP_MS, then the window opens. ----
  let joined = 0;
  let cursor = 0;
  let joinsDone = false;
  const failures = [];
  const failedBots = [];
  // The ramp TAPERS: most workers retire once 70 percent of the fleet is in,
  // so the tail joins at concurrency 5. With hundreds already online every
  // callback is slow and twenty concurrent handshakes starve each other past
  // the server's 10 s auth deadline; the server's deadline rejection can race
  // a completing join and orphan a lease-holding zombie session (minutes to
  // reap), which is what made the last few joins of a 1,000-bot ramp
  // unrecoverable. Fewer concurrent handshakes at the tail keeps every one
  // comfortably inside the deadline instead.
  const TAIL_CONCURRENCY = 5;
  const taperAt = Math.floor(bots.length * 0.7);
  const joinPromise = Promise.all(
    Array.from({ length: CONNECT_CONCURRENCY }, async (_, worker) => {
      while (cursor < bots.length) {
        if (worker >= TAIL_CONCURRENCY && joined >= taperAt) break;
        const bot = bots[cursor];
        cursor += 1;
        try {
          await bot.join();
          joined += 1;
        } catch (e) {
          failures.push(`bot ${bot.index}: ${e.message}`);
          failedBots.push(bot);
        }
      }
    }),
  )
    .then(async () => {
      // Bounded retry passes at low concurrency: the tail of a 1,000-bot ramp
      // sits on a busy loop where a handshake can wait out the server's 10 s
      // auth deadline or catch an autosave wave holding the pool; a later
      // attempt normally lands (a real client retries too). The gate judges
      // the FINAL count, and a fleet with a broken join path (more than 10
      // percent failed) is never retried into a false pass. The delays
      // ESCALATE because a client-side abort can orphan the server-side
      // character lease: every quick retry then refuses until the lease
      // expires (the ~90 s lockout), so the late passes must wait it out.
      const retryDelaysMs = [5000, 15000, 30000, 60000, 90000];
      for (let pass = 1; pass <= retryDelaysMs.length && failedBots.length > 0; pass++) {
        if (failedBots.length > Math.max(50, BOTS / 10)) break;
        const retrying = failedBots.splice(0);
        console.log(`[prof-load] retry pass ${pass}: ${retrying.length} bots`);
        await sleep(retryDelaysMs[pass - 1]);
        let rcursor = 0;
        await Promise.all(
          Array.from({ length: 5 }, async () => {
            while (rcursor < retrying.length) {
              const bot = retrying[rcursor];
              rcursor += 1;
              try {
                await bot.join();
                joined += 1;
              } catch (e) {
                failures.push(`bot ${bot.index} (retry ${pass}): ${e.message}`);
                failedBots.push(bot);
              }
            }
          }),
        );
        if (failedBots.length > 0) {
          console.log(
            `[prof-load] retry pass ${pass} left ${failedBots.length} (last: ${failures.at(-1)})`,
          );
        }
      }
    })
    .then(() => {
      joinsDone = true;
      console.log(`[prof-load] joined ${joined}/${BOTS}`);
      for (const f of failures.slice(0, 5)) console.error(`  join failure: ${f}`);
    })
    // A throw ESCAPING the retry machinery (each bot.join is individually
    // caught, so this is a harness bug, not a bot failure) must not become an
    // unhandled rejection: record it, unblock the driver loop, and let the
    // join gate fail the run with the evidence written.
    .catch((err) => {
      failures.push(`join machinery: ${err?.message ?? err}`);
      console.error('[prof-load] join machinery failed:', err);
      joinsDone = true;
    });

  // ---- warmup + measurement driver ----
  const perfMid = [];
  const loopLag = [];
  // One input frame per bot per second at the DEFAULT step; the stagger key
  // must use the SAME modulus as the cadence (the review round: a literal
  // % 4 silently dropped most bots' inputs at any non-default STEP_MS).
  const inputModulus = Math.max(1, Math.round(1000 / STEP_MS));
  let serverPerfAtWindowOpen = null;
  let poolAtWindowOpen = null;
  // The periodic mid-window scrape is FIRE-AND-FORGET. Awaiting it inside the
  // driver loop charged its round trip to that step's loop-lag sample (18 of
  // the first capture's 720 samples), and on a saturated box one round trip is
  // the size of a whole loop callback, so the rig's own instrument overstated
  // itself. Overlap-guarded: a scrape slower than REPORT_MS skips the next
  // turn instead of queueing round trips against the server it measures. The
  // console line reads the LATEST landed sample, so it can be one report
  // behind; the artifact's serverPerfMid rows carry their own atMs.
  let perfScrapeInFlight = false;
  let lastPerfSample = null;
  function scrapeServerPerf() {
    if (perfScrapeInFlight) return;
    perfScrapeInFlight = true;
    // Stamped at REQUEST time, and the window membership with it: a scrape
    // fired during warmup must never land in perfMid with a window-relative
    // offset it was not taken at.
    const atMs = Math.round(performance.now() - start);
    const inWindow = measuring;
    // Deadlined, and the flag cleared in a finally: a scrape that never
    // answers would otherwise strand the overlap guard set and silence every
    // later scrape for the rest of the run, leaving serverPerfMid short with
    // nothing in the artifact saying why.
    fetch(`${BASE}/api/perf`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((perf) => {
        if (!perf) return;
        lastPerfSample = perf;
        // The window is re-checked at RESOLUTION as well as at request time: a
        // slow scrape fired inside the window can land after it closed, and
        // its reading then describes a server the window never measured.
        if (inWindow && measuring) {
          perfMid.push({ atMs, online: perf.online, tickHz: perf.tickHz });
        }
      })
      .finally(() => {
        perfScrapeInFlight = false;
      });
  }
  let driving = false;
  let measuring = false;
  let settleAt = Number.POSITIVE_INFINITY;
  let start = performance.now();
  // Window-relative close mark, stamped at the BREAK below: the close scrapes
  // and the joinPromise await that follow take real time, and charging that to
  // every observer's terminal gap would fabricate a stall in the evidence.
  let windowCloseAtMs = 0;
  let lastReport = performance.now();
  let step = 0;
  let expectedAt = performance.now() + STEP_MS;
  for (;;) {
    await sleep(Math.max(0, expectedAt - performance.now()));
    if (measuring) loopLag.push(Math.max(0, performance.now() - expectedAt));
    expectedAt += STEP_MS;
    step += 1;
    const now = Date.now();
    if (!driving && joinsDone) {
      driving = true;
      settleAt = now + WARMUP_MS;
      for (const b of bots) if (b.alive) b.armDriver(now, bots.length);
      console.log(`[prof-load] workload armed, warmup ${WARMUP_MS}ms`);
    }
    if (driving) {
      for (const b of bots) {
        if (!b.alive) continue;
        if (b.role === 'gather') {
          if (now >= b.nextTourAt) {
            const node = b.route[b.routeIndex % b.route.length];
            b.routeIndex += 1;
            b.nextTourAt = now + TOUR_SEC * 1000;
            b.cmd({ cmd: 'dev_teleport', x: node.pos.x, z: node.pos.z });
            b.pressAt = now + 500;
            b.pendingTool = TOOL_BY_NODE_TYPE[node.type];
          } else if (b.pressAt && now >= b.pressAt) {
            b.cmd({ cmd: 'use', item: b.pendingTool });
            b.pressAt = 0;
          }
        } else {
          if (b.fishState === 'idle' && now >= b.nextCastAt) {
            b.cmd({ cmd: 'use', item: ROD_ITEM });
            b.fishState = 'casting';
            b.castStartedAt = now;
          } else if (b.fishState !== 'idle' && now - b.castStartedAt > 12000) {
            // With the TIER-3 rod the rig hands out, a successful cast always
            // resolves within about 9.3 s: bite at most 8 - 1.5 x 2 = 5 s
            // after the cast, plus the ~4.25 s reel window (fishing.ts
            // FISH_BITE_DELAY_* and fishReelWindowSecFor at tier 3,
            // uncommon). castStartedAt is deliberately NOT re-armed at the
            // bite, so 12 s covers cast-to-outcome with wire slack; silence
            // past it means the cast never started (facing denial,
            // combat-camped shore, swim edge). The spot is bad for this bot:
            // rotate to another discovered spot (which also teleport-drops
            // any camping mob) and recast.
            b.fishState = 'idle';
            b.nextCastAt = now + 400;
            b.rotateSpot(spots);
          }
        }
        if (step % inputModulus === b.index % inputModulus) {
          b.input({}, b.role === 'fish' ? b.spot.facing : 0);
        }
      }
    }
    if (!measuring) {
      if (now >= settleAt) {
        // The /api/perf profile is a rolling 1200-CALLBACK ring, far wider
        // than the window at shed cadence; snapshotting it at open lets a
        // reader bound the ring's pre-window drift against the close scrape.
        // Fetched BEFORE the clocks re-arm so its round trip is never
        // charged to the first measured step's loop lag.
        serverPerfAtWindowOpen = await fetch(`${BASE}/api/perf`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        poolAtWindowOpen = await scrapePoolClients();
        for (const b of bots) b.resetMeasurement();
        measuring = true;
        start = performance.now();
        expectedAt = performance.now() + STEP_MS;
        console.log('[prof-load] measurement window open');
      }
    } else if (performance.now() - start >= DURATION_MS) {
      windowCloseAtMs = performance.now() - start;
      break;
    }
    if (performance.now() - lastReport >= REPORT_MS) {
      lastReport = performance.now();
      const alive = bots.filter((b) => b.alive).length;
      const mb = bots.reduce((a, b) => a + b.bytes, 0) / 1e6;
      scrapeServerPerf();
      console.log(
        `[prof-load] ${measuring ? 't=' + Math.round((performance.now() - start) / 1000) + 's' : 'warmup'} alive=${alive} joined=${joined} rx=${mb.toFixed(1)}MB tickHz=${lastPerfSample?.tickHz ?? '?'}`,
      );
    }
  }
  await joinPromise;
  const live = bots.filter((b) => b.alive);

  // ---- report ----
  const perf = await fetch(`${BASE}/api/perf`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const aliveAtEnd = bots.filter((b) => b.alive).length;
  // Approximate normalization only: bytes accumulate over `live` while the
  // divisor is the window-close liveness (a bled fleet FAILS the gate anyway,
  // so the two populations only diverge on runs that already fail), and the
  // loop overshoots DURATION_MS by up to one lagged step (under one percent).
  const seconds = DURATION_MS / 1000;
  // EVERY staged observer reaches the verdict, dead or alive: a died
  // observer's short gap count must fail the sample floor with its label
  // rather than silently vanishing from the evidence.
  const observers = bots.filter((b) => b.isObserver);
  const observerRows = observers.map((o) => {
    const gaps = gapStats(o.snapTimes);
    // Window-relative, and undefined when the observer received nothing at
    // all, which is what makes the terminal gap span the whole window.
    const lastSnapAtMs = o.snapCount > 0 ? o.snapTimes.at(-1) - start : undefined;
    return {
      label: `obs-${o.index}`,
      role: o.role,
      gaps: gaps.gaps,
      // The WORST gap, which the gate's continuity arm reads: a mid-window
      // stall the p95 averages away has to be visible to the verdict AND to
      // whoever reads the artifact later. The TERMINAL gap counts too:
      // gapStats only sees spans BETWEEN snapshots, so an observer that went
      // silent for the last minute of the window otherwise reports the tidy
      // gaps it had before dying and rides the ceiling to a false pass.
      gapMaxMs: terminalAwareGapMax(gaps.max, lastSnapAtMs, windowCloseAtMs),
      sawStableTw: o.sawStableTw,
      ncdFrames: o.ncdFrames,
      fishingOutcomes: o.fishingOutcomes,
    };
  });
  const poolAtWindowClose = await scrapePoolClients();
  const report = {
    base: sanitizeBaseUrl(BASE),
    runId: RUN_ID,
    gitHead,
    // A capture taken on a dirty tree is not reproducible from gitHead alone,
    // and the artifact is the only place that fact survives the run.
    gitDirty,
    startIso,
    bots: joined,
    aliveAtEnd,
    mode: MODE,
    stable: STABLE,
    durationMs: DURATION_MS,
    warmupMs: WARMUP_MS,
    connectConcurrency: CONNECT_CONCURRENCY,
    botLevel: BOT_LEVEL,
    tourSec: TOUR_SEC,
    nodesPerBot: NODES_PER_BOT,
    stepMs: STEP_MS,
    // The scrape cadence in force, so serverPerfMid's row count is readable
    // against the window instead of against the default nobody may have run.
    reportMs: REPORT_MS,
    fishSpots: spots.length,
    fishSpotRotations: bots.reduce((a, b) => a + b.spotRotations, 0),
    observersRequested: OBSERVERS,
    observerCount: observers.length,
    fleet: {
      rxBytesPerSecondPerBot: aliveAtEnd
        ? Math.round(live.reduce((a, b) => a + b.bytes, 0) / seconds / aliveAtEnd)
        : 0,
      rxFramesPerSecondPerBot: aliveAtEnd
        ? +(live.reduce((a, b) => a + b.frames, 0) / seconds / aliveAtEnd).toFixed(1)
        : 0,
    },
    roles: aggregateObservers(observers, { gapStats, sampleStats }),
    // The gate's OWN inputs, stamped verbatim: a reader can re-judge a
    // committed artifact instead of trusting the verdict line beside it.
    observerEvidence: observerRows,
    rig: { loopLagMs: sampleStats(loopLag) },
    serverPerfAtWindowOpen,
    serverPerfMid: perfMid,
    serverPerf: perf,
    // null when the server ran without METRICS_TOKEN (the endpoint is
    // feature-off) or the rig was started without it: disclosure, not a gate.
    poolAtWindowOpen,
    poolAtWindowClose,
  };
  const verdict = evaluateProfessionsLoadRun({
    joined,
    expected: BOTS,
    aliveAtEnd,
    mode: MODE,
    stable: STABLE,
    durationMs: DURATION_MS,
    observers: observerRows,
  });
  report.verdict = verdict;

  console.log('\n===== RESULT =====');
  console.log(
    `bots: ${report.bots} joined, ${report.aliveAtEnd} alive at end; fleet rx ${report.fleet.rxBytesPerSecondPerBot} B/s/bot`,
  );
  for (const [role, r] of Object.entries(report.roles)) {
    console.log(
      `${role}: snapBytes p50/p95/p99/max=${r.snapBytes.p50}/${r.snapBytes.p95}/${r.snapBytes.p99}/${r.snapBytes.max} ncd ratio=${r.ncd.presenceRatio} perSnap=${r.ncd.bytesPerSnapshot}B tslot ratio=${r.tslot.presenceRatio}`,
    );
  }
  if (perf?.phases) {
    const cols = ['total', 'tick', 'broadcast', 'bcastSelf', 'bcastGrid', 'events', 'social'];
    console.log(
      `SERVER p50/p95/max (ms): ${cols
        .map(
          (n) =>
            `${n}=${perf.phases[n]?.p50 ?? 0}/${perf.phases[n]?.p95 ?? 0}/${perf.phases[n]?.max ?? 0}`,
        )
        .join(
          ' ',
        )} (samples=${perf.samples}, ents=${perf.simEntities}, tickHz=${perf.tickHz ?? 'n/a'})`,
    );
  }
  console.log(`rig loop lag p95=${report.rig.loopLagMs.p95}ms max=${report.rig.loopLagMs.max}ms`);
  if (poolAtWindowClose) {
    console.log(
      `db pool at close: waiting=${poolAtWindowClose.waiting} total=${poolAtWindowClose.total} idle=${poolAtWindowClose.idle}`,
    );
  }
  for (const f of verdict.failures) console.error(`GATE FAIL: ${f}`);
  console.log(`verdict: ${verdict.ok ? 'PASS' : 'FAIL'}`);
  if (JSON_OUT) {
    // Guarded: a bad path must cost the artifact, never the teardown or the
    // verdict's exit code. Written to a sibling temp file and RENAMED into
    // place (rename is atomic within a filesystem), so a write that dies
    // midway leaves the previous artifact intact rather than truncating a
    // capture nobody can re-run cheaply.
    const tmpOut = `${JSON_OUT}.tmp`;
    try {
      fs.writeFileSync(tmpOut, `${JSON.stringify(report, null, 2)}\n`);
      fs.renameSync(tmpOut, JSON_OUT);
      console.log(`wrote ${JSON_OUT}`);
    } catch (err) {
      console.error(`[prof-load] failed to write ${JSON_OUT}:`, err);
      try {
        fs.rmSync(tmpOut, { force: true });
      } catch {
        /* nothing to clean up */
      }
    }
  }

  await stop();
  process.exit(verdict.ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('fatal:', err);
  try {
    await teardown?.();
  } catch (stopErr) {
    console.error('[prof-load] teardown after fatal error also failed:', stopErr);
  }
  process.exit(1);
});
