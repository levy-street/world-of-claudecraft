// Server load + snapshot-jitter benchmark.
//
// Spawns N bot players that cluster at a mob camp and continuously move, fight,
// and cast (the "lots of people doing things in one place" case that makes the
// 20 Hz world loop stutter), plus one roaming OBSERVER that walks through the
// crowd and records the wall-clock gap between the snapshots it receives. The
// server broadcasts once per loop (~50 ms); a gap well above that is a visible
// "tirón" (hitch): the loop stalled. Percentiles of those gaps are the
// player-facing measure of the stutter.
//
// Requires the server running with ALLOW_DEV_COMMANDS=1 (dev_level/dev_teleport).
// Each bot is given a unique X-Forwarded-For so the per-IP register limit and WS
// session caps don't throttle a local fleet (loopback is a trusted XFF source).
//
//   ALLOW_DEV_COMMANDS=1 npm run server          # in one terminal
//   BOTS=60 DURATION_MS=30000 node scripts/server_load_jitter.mjs
//
// Env: BOTS, DURATION_MS, LEVEL, CLUSTER_X, CLUSTER_Z, CLUSTER_R, RAMP_MS,
//      SERVER_URL, OBSERVER (0 to disable), JSON_OUT.

import fs from 'node:fs';
import WebSocket from 'ws';

const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
const BOTS = Number(process.env.BOTS ?? 40);
const DURATION_MS = Number(process.env.DURATION_MS ?? 30000);
const LEVEL = Number(process.env.LEVEL ?? 12);
const CLUSTER_X = Number(process.env.CLUSTER_X ?? -2); // Wolf Run camp (zone1 POI)
const CLUSTER_Z = Number(process.env.CLUSTER_Z ?? 70);
const CLUSTER_R = Number(process.env.CLUSTER_R ?? 12); // tight: everyone in each other's interest area
const RAMP_MS = Number(process.env.RAMP_MS ?? 40);
const WANT_OBSERVER = process.env.OBSERVER !== '0';
// IDLE=1: a social/city crowd, bots cluster and walk but don't fight. This is
// the case where snapshot cost is pure overhead (player state barely changes),
// vs the default farming crowd where loot/level/quest churn is unavoidable.
const IDLE = process.env.IDLE === '1';
const JSON_OUT = process.env.JSON_OUT ?? '';

const uniq = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// classic names are letters only; map an index to a short letters-only suffix
const L = 'abcdefghijklmnopqrstuvwxyz';
const lettersOf = (n) =>
  n === 0
    ? 'a'
    : (() => {
        let s = '';
        let x = n;
        while (x > 0) {
          s = L[x % 26] + s;
          x = Math.floor(x / 26);
        }
        return s;
      })();
// a distinct public-looking IP per client → distinct rate-limit + WS-cap bucket
const ipFor = (n) => `9.${(n >> 8) & 255}.${n & 255}.7`;
const CLASSES = [
  'warrior',
  'mage',
  'hunter',
  'rogue',
  'priest',
  'paladin',
  'warlock',
  'druid',
  'shaman',
];

async function api(path, body, token, ip) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const DELTA_SELF_KEYS = [
  'inv',
  'equip',
  'qlog',
  'qdone',
  'cds',
  'stats',
  'weapon',
  'party',
  'trade',
  'duel',
];
function mergeSelf(prev, next) {
  if (prev) for (const k of DELTA_SELF_KEYS) if (!(k in next)) next[k] = prev[k];
  return next;
}
const ENTITY_IDENTITY_KEYS = ['k', 'tid', 'nm', 'lv', 'sc', 'c', 'dgn'];
function mergeEnts(prevEnts, snap) {
  const next = new Map();
  for (const w of snap.ents) {
    const prev = prevEnts.get(w.id);
    if (prev && w.k === undefined)
      for (const key of ENTITY_IDENTITY_KEYS) if (key in prev) w[key] = prev[key];
    next.set(w.id, w);
  }
  for (const id of snap.keep ?? []) {
    const prev = prevEnts.get(id);
    if (prev) next.set(id, prev);
  }
  return next;
}

class Client {
  constructor(index, cls, label) {
    this.index = index;
    this.cls = cls;
    this.label = label;
    this.ip = ipFor(index);
    this.pid = -1;
    this.self = null;
    this.ents = new Map();
    this.events = [];
    this.snapTimes = [];
    this.snapBytes = 0;
    this.snapCount = 0;
  }

  async join() {
    const name =
      `${this.label}${lettersOf(this.index)}${uniq.replace(/[0-9]/g, (d) => L[Number(d)])}`.slice(
        0,
        22,
      );
    const reg = await api(
      '/api/register',
      { username: `load_${this.index}_${uniq}`, password: 'hunter22' },
      null,
      this.ip,
    );
    if (!reg.body.token)
      throw new Error(`register failed (${reg.status}): ${JSON.stringify(reg.body)}`);
    this.token = reg.body.token;
    const char = await api('/api/characters', { name, class: this.cls }, this.token, this.ip);
    if (!char.body.id)
      throw new Error(`character create failed (${char.status}): ${JSON.stringify(char.body)}`);
    this.charId = char.body.id;
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`, { headers: { 'X-Forwarded-For': this.ip } });
      const to = setTimeout(() => reject(new Error('join timeout')), 10000);
      this.ws.on('open', () =>
        this.ws.send(JSON.stringify({ t: 'auth', token: this.token, character: this.charId })),
      );
      this.ws.on('message', (data) => {
        const raw = String(data);
        const msg = JSON.parse(raw);
        if (msg.t === 'hello') {
          this.pid = msg.pid;
          clearTimeout(to);
          resolve();
        } else if (msg.t === 'snap') {
          this.snapTimes.push(performance.now());
          this.snapBytes += raw.length;
          this.snapCount++;
          this.self = mergeSelf(this.self, msg.self);
          this.ents = mergeEnts(this.ents, msg);
          if (this.self) this.ents.set(this.self.id, this.self);
        } else if (msg.t === 'events') this.events.push(...msg.list);
        else if (msg.t === 'error') {
          clearTimeout(to);
          reject(new Error(msg.error));
        }
      });
      this.ws.on('error', (e) => {
        clearTimeout(to);
        reject(e);
      });
    });
  }

  cmd(p) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'cmd', ...p }));
  }
  input(mi, facing) {
    if (this.ws?.readyState === 1)
      this.ws.send(JSON.stringify({ t: 'input', mi, ...(facing !== undefined ? { facing } : {}) }));
  }
  pos() {
    return this.self ? { x: this.self.x, z: this.self.z } : { x: 0, z: 0 };
  }
  mobs() {
    return [...this.ents.values()].filter((e) => e.k === 'mob' && !e.dead && e.h);
  }
  close() {
    try {
      this.ws?.close();
    } catch {
      /* already closing */
    }
  }
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function gapStats(snapTimes) {
  const gaps = [];
  for (let i = 1; i < snapTimes.length; i++) gaps.push(snapTimes[i] - snapTimes[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const over = (t) => gaps.filter((g) => g > t).length;
  return {
    snapshots: snapTimes.length,
    gaps: gaps.length,
    p50: +pct(sorted, 50).toFixed(1),
    p95: +pct(sorted, 95).toFixed(1),
    p99: +pct(sorted, 99).toFixed(1),
    max: +(sorted.at(-1) ?? 0).toFixed(1),
    over100: over(100),
    over150: over(150),
    over250: over(250),
    over500: over(500),
  };
}

async function main() {
  console.log(
    `[load] target=${BASE} bots=${BOTS} duration=${DURATION_MS}ms level=${LEVEL} cluster=(${CLUSTER_X},${CLUSTER_Z}) r=${CLUSTER_R}`,
  );
  const st = await fetch(`${BASE}/api/status`)
    .then((r) => r.json())
    .catch(() => null);
  if (!st?.ok) {
    console.error('server not reachable / not ok at', BASE);
    process.exit(1);
  }

  const bots = [];
  for (let i = 0; i < BOTS; i++) bots.push(new Client(i + 1, CLASSES[i % CLASSES.length], 'Ldr'));
  const observer = WANT_OBSERVER ? new Client(50000, 'mage', 'Obs') : null;

  // ---- join (staggered so the WS upgrade flood doesn't trip anything) ----
  let joined = 0;
  for (const b of bots) {
    try {
      await b.join();
      joined++;
    } catch (e) {
      console.error(`bot ${b.index} join failed:`, e.message);
    }
    await sleep(RAMP_MS);
  }
  if (observer) {
    try {
      await observer.join();
    } catch (e) {
      console.error('observer join failed:', e.message);
    }
  }
  console.log(`[load] joined ${joined}/${BOTS} bots${observer ? ' + observer' : ''}`);
  if (joined === 0) process.exit(1);

  // ---- power up + cluster at the camp ----
  for (const b of bots) {
    b.cmd({ cmd: 'dev_level', level: LEVEL });
    const a = (b.index / Math.max(1, joined)) * Math.PI * 2;
    b.cmd({
      cmd: 'dev_teleport',
      x: CLUSTER_X + Math.cos(a) * CLUSTER_R,
      z: CLUSTER_Z + Math.sin(a) * CLUSTER_R,
    });
  }
  if (observer) {
    observer.cmd({ cmd: 'dev_level', level: LEVEL });
    observer.cmd({ cmd: 'dev_teleport', x: CLUSTER_X, z: CLUSTER_Z });
  }
  await sleep(800);

  // reset jitter measurement so the teleport/level burst isn't counted
  for (const b of bots) b.snapTimes.length = 0;
  if (observer) {
    observer.snapTimes.length = 0;
    observer.snapBytes = 0;
    observer.snapCount = 0;
  }

  // ---- run: every bot circles, jumps, and fights whatever's near ----
  const ATTACK_ABILITY = {
    warrior: 'heroic_strike',
    mage: 'fireball',
    hunter: 'arcane_shot',
    rogue: 'sinister_strike',
    priest: 'smite',
    paladin: 'judgement',
    warlock: 'shadow_bolt',
    druid: 'wrath',
    shaman: 'lightning_bolt',
  };
  const start = performance.now();
  let step = 0;
  while (performance.now() - start < DURATION_MS) {
    step++;
    const t = (performance.now() - start) / 1000;
    for (const b of bots) {
      if (!b.self || b.self.dead) {
        if (b.self?.dead) b.cmd({ cmd: 'release' });
        continue;
      }
      // constant motion: circle-strafe so position + facing churn every tick
      const facing = (b.index * 0.7 + t * 1.5) % (Math.PI * 2);
      const mi = { f: 1, sl: step % 4 < 2 ? 1 : 0, sr: step % 4 < 2 ? 0 : 1 };
      if (step % 12 === 0) mi.j = 1; // periodic jump
      b.input(mi, facing);
      if (IDLE) continue; // social crowd: move only, no combat
      // fight: target nearest hostile, attack + nuke; otherwise self-cast for aura churn
      const near = b
        .mobs()
        .sort(
          (m, n) =>
            Math.hypot(m.x - b.self.x, m.z - b.self.z) - Math.hypot(n.x - b.self.x, n.z - b.self.z),
        )[0];
      if (near) {
        if (b.self.target !== near.id) b.cmd({ cmd: 'target', id: near.id });
        b.cmd({ cmd: 'attack' });
        if ((b.self.gcd ?? 0) <= 0 && !b.self.cast)
          b.cmd({ cmd: 'cast', ability: ATTACK_ABILITY[b.cls] });
      } else if (step % 8 === 0) {
        b.cmd({ cmd: 'targetNearest' });
      }
    }
    // observer roams a wide circle through/around the crowd
    if (observer?.self && !observer.self.dead) {
      const of = (t * 0.8) % (Math.PI * 2);
      observer.input({ f: 1 }, of);
      if (step % 40 === 0)
        observer.cmd({
          cmd: 'dev_teleport',
          x: CLUSTER_X + Math.cos(t) * 30,
          z: CLUSTER_Z + Math.sin(t) * 30,
        });
    }
    await sleep(50);
  }

  // ---- report ----
  const perf = await fetch(`${BASE}/api/perf`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const aliveBots = bots.filter((b) => b.pid > 0);
  const interestSizes = aliveBots.map((b) => b.ents.size);
  const avgInterest = interestSizes.length
    ? Math.round(interestSizes.reduce((a, c) => a + c, 0) / interestSizes.length)
    : 0;
  const botGapP95 = aliveBots.map((b) => gapStats(b.snapTimes).p95).sort((a, b) => a - b);
  const report = {
    base: BASE,
    bots: joined,
    durationMs: DURATION_MS,
    level: LEVEL,
    cluster: { x: CLUSTER_X, z: CLUSTER_Z, r: CLUSTER_R },
    avgEntitiesInInterest: avgInterest,
    botSnapGapP95Median: +pct(botGapP95, 50).toFixed(1),
    botSnapGapP95Worst: +(botGapP95.at(-1) ?? 0).toFixed(1),
    observer:
      observer && observer.pid > 0
        ? {
            ...gapStats(observer.snapTimes),
            avgSnapBytes: observer.snapCount
              ? Math.round(observer.snapBytes / observer.snapCount)
              : 0,
          }
        : null,
    serverPerf: perf,
  };

  console.log('\n===== RESULT =====');
  console.log(
    `bots active: ${report.bots}, avg entities in interest: ${report.avgEntitiesInInterest}`,
  );
  console.log(
    `bot snapshot-gap p95: median ${report.botSnapGapP95Median}ms, worst ${report.botSnapGapP95Worst}ms`,
  );
  if (report.observer) {
    const o = report.observer;
    console.log(`OBSERVER snapshot gaps (ms): p50=${o.p50} p95=${o.p95} p99=${o.p99} max=${o.max}`);
    console.log(
      `OBSERVER hitches: >100ms=${o.over100} >150ms=${o.over150} >250ms=${o.over250} >500ms=${o.over500}  (snaps=${o.snapshots}, avgBytes=${o.avgSnapBytes})`,
    );
  }
  if (perf?.phases) {
    const ph = perf.phases;
    const cols = ['total', 'tick', 'broadcast', 'bcastSelf', 'bcastGrid', 'events', 'social'];
    console.log(
      `SERVER tick p95/max (ms): ${cols.map((n) => `${n}=${ph[n]?.p95 ?? 0}/${ph[n]?.max ?? 0}`).join(' ')} (samples=${perf.samples}, ents=${perf.simEntities})`,
    );
  }
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + '\n');
    console.log(`wrote ${JSON_OUT}`);
  }

  for (const b of bots) b.close();
  observer?.close();
  await sleep(300);
  process.exit(0);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
