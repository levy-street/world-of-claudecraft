// Local load-test helper.
//
// Start the game server with dev commands enabled and a high enough per-IP
// WebSocket cap before running this script. Example for 100 local bots:
//   ALLOW_DEV_COMMANDS=1 MAX_WS_PER_IP_HARD=105 npm run server
//
// Then run the bots, for example:
//   BOT_COUNT=100 BOT_LEVEL=18 DURATION_SECONDS=180 CLEANUP=1 node scripts/load_players.mjs
//
// `ALLOW_DEV_COMMANDS=1` is required for dev_level and dev_teleport.
// `MAX_WS_PER_IP_HARD` must be higher than BOT_COUNT plus any browser sessions
// opened from the same machine.

import { randomBytes } from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';

try {
  process.loadEnvFile?.();
} catch {}

const { Pool } = pg;

const SERVER_URL = (
  process.env.SERVER_URL ??
  process.env.GAME_URL ??
  'http://localhost:8787'
).replace(/\/+$/, '');
const WS_URL = `${SERVER_URL.replace(/^http/, 'ws')}/ws`;
const DATABASE_URL = process.env.DATABASE_URL;
const REALM = process.env.REALM_NAME ?? 'Claudemoon';
const BOT_COUNT = boundedInt(process.env.BOT_COUNT, 25, 1, 100);
const BOT_LEVEL = boundedInt(process.env.BOT_LEVEL, 18, 1, 60);
const DURATION_MS = boundedInt(
  process.env.DURATION_MS ?? secondsToMs(process.env.DURATION_SECONDS),
  120_000,
  1_000,
  24 * 60 * 60 * 1000,
);
const CONNECT_CONCURRENCY = boundedInt(process.env.CONNECT_CONCURRENCY, 10, 1, 50);
const TICK_MS = boundedInt(process.env.TICK_MS, 250, 50, 5_000);
const REPORT_MS = boundedInt(process.env.REPORT_MS, 5_000, 1_000, 60_000);
const SPREAD_RADIUS = boundedInt(process.env.SPREAD_RADIUS, 8, 0, 30);
const MOB_SEARCH_RANGE = boundedInt(process.env.MOB_SEARCH_RANGE, 55, 5, 150);
const RUN_ID =
  (process.env.LOAD_RUN_ID ?? randomLetters(5)).replace(/[^A-Za-z]/g, '').slice(0, 8) ||
  randomLetters(5);
const CLEANUP = process.env.CLEANUP === '1';

const CLASSES = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

const SPOTS = [
  { name: 'wolves west', x: -15, z: 55, radius: 22 },
  { name: 'wolves east', x: 20, z: 70, radius: 20 },
  { name: 'boars south', x: 55, z: 12, radius: 22 },
  { name: 'boars ridge', x: 80, z: -15, radius: 18 },
  { name: 'spiders', x: -60, z: 5, radius: 22 },
  { name: 'murlocs', x: -75, z: 57, radius: 14 },
  { name: 'rats', x: -82, z: -62, radius: 20 },
  { name: 'bandits west', x: 65, z: -65, radius: 24 },
  { name: 'bandits east', x: 90, z: -90, radius: 16 },
  { name: 'bones', x: 80, z: 78, radius: 18 },
  { name: 'prowlers west', x: -40, z: 230, radius: 22 },
  { name: 'prowlers east', x: 35, z: 225, radius: 20 },
  { name: 'deepfen west', x: -82, z: 273, radius: 15 },
  { name: 'deepfen north', x: -120, z: 350, radius: 13 },
  { name: 'widows south', x: 70, z: 300, radius: 20 },
  { name: 'widows north', x: 95, z: 340, radius: 16 },
  { name: 'drowned south', x: 90, z: 420, radius: 20 },
  { name: 'drowned north', x: 115, z: 450, radius: 16 },
  { name: 'trolls west', x: -80, z: 420, radius: 22 },
  { name: 'trolls north', x: -105, z: 455, radius: 18 },
  { name: 'gravecallers west', x: 15, z: 470, radius: 20 },
  { name: 'gravecallers east', x: -25, z: 490, radius: 16 },
  { name: 'summoners', x: -5, z: 500, radius: 12 },
  { name: 'menders', x: 18, z: 472, radius: 8 },
  { name: 'bloats south', x: 72, z: 428, radius: 11 },
  { name: 'bloats north', x: 110, z: 440, radius: 11 },
  { name: 'glimmermere west', x: -78, z: 778, radius: 16 },
  { name: 'glimmermere east', x: -56, z: 800, radius: 14 },
  { name: 'votaries west', x: -90, z: 802, radius: 16 },
  { name: 'votaries east', x: -64, z: 814, radius: 12 },
];

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
const ENTITY_IDENTITY_KEYS = ['k', 'tid', 'nm', 'lv', 'sc', 'c', 'dgn'];

function secondsToMs(value) {
  if (value == null || value === '') return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}

function boundedInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomLetters(length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function charName(index) {
  const prefix = `Load${RUN_ID}`;
  const suffix = lettersFromIndex(index);
  return `${prefix}${suffix}`.replace(/[^A-Za-z]/g, '').slice(0, 16);
}

function lettersFromIndex(index) {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function jitteredSpot(spot, index) {
  const angle = (index * 2.399963229728653) % (Math.PI * 2);
  const radius = Math.min(SPREAD_RADIUS, spot.radius * 0.7) * (0.35 + (index % 7) / 10);
  return {
    ...spot,
    x: Math.round((spot.x + Math.cos(angle) * radius) * 10) / 10,
    z: Math.round((spot.z + Math.sin(angle) * radius) * 10) / 10,
  };
}

function mergeSelf(prev, next) {
  if (!next) return prev;
  if (!prev) return next;
  const merged = { ...next };
  for (const key of DELTA_SELF_KEYS) {
    if (merged[key] === undefined && prev[key] !== undefined) merged[key] = prev[key];
  }
  return merged;
}

function mergeEnts(prevEnts, snap) {
  const next = new Map();
  const keep = Array.isArray(snap.keep) ? new Set(snap.keep) : new Set();
  for (const entity of snap.ents ?? []) {
    const prev = prevEnts.get(entity.id);
    const merged = prev ? { ...prev, ...entity } : entity;
    if (prev) {
      for (const key of ENTITY_IDENTITY_KEYS) {
        if (merged[key] === undefined && prev[key] !== undefined) merged[key] = prev[key];
      }
    }
    next.set(merged.id, merged);
  }
  for (const id of keep) {
    if (!next.has(id) && prevEnts.has(id)) next.set(id, prevEnts.get(id));
  }
  return next;
}

function isAliveMob(entity) {
  return entity?.k === 'mob' && entity.dead !== true && (entity.h ?? 1) > 0;
}

function classRange(cls) {
  return cls === 'warrior' || cls === 'paladin' || cls === 'rogue' ? 4 : 26;
}

function shouldCast(bot, ability, cost, cooldownMs) {
  const now = Date.now();
  if ((bot.self?.gcd ?? 0) > 0 || bot.self?.cast) return false;
  if ((bot.self?.res ?? 0) < cost) return false;
  if (now - bot.lastCastAt < cooldownMs) return false;
  bot.lastCastAt = now;
  bot.cmd({ cmd: 'cast', ability });
  return true;
}

function castForClass(bot) {
  switch (bot.cls) {
    case 'warrior':
      return shouldCast(bot, 'heroic_strike', 15, 1_000);
    case 'paladin':
      if (!(bot.self?.auras ?? []).some((a) => a.kind === 'imbue'))
        return shouldCast(bot, 'seal_of_righteousness', 0, 2_000);
      return shouldCast(bot, 'judgement', 30, 1_000);
    case 'hunter':
      return shouldCast(bot, 'arcane_shot', 25, 1_200);
    case 'rogue':
      return shouldCast(bot, 'sinister_strike', 45, 1_000);
    case 'priest':
      return shouldCast(bot, 'smite', 30, 1_500);
    case 'shaman':
      return shouldCast(bot, 'lightning_bolt', 30, 1_500);
    case 'mage':
      return shouldCast(bot, 'fireball', 30, 1_500);
    case 'warlock':
      return shouldCast(bot, 'shadow_bolt', 30, 1_500);
    case 'druid':
      return shouldCast(bot, 'wrath', 30, 1_500);
    default:
      return false;
  }
}

class LoadBot {
  constructor(record, spot) {
    this.username = record.username;
    this.token = record.token;
    this.characterId = record.characterId;
    this.name = record.name;
    this.cls = record.cls;
    this.spot = spot;
    this.ws = null;
    this.pid = 0;
    this.self = null;
    this.ents = new Map();
    this.events = [];
    this.connected = false;
    this.ready = false;
    this.closed = false;
    this.closeCode = 0;
    this.closeReason = '';
    this.errors = 0;
    this.kills = 0;
    this.lastTargetAt = 0;
    this.lastAttackAt = 0;
    this.lastCastAt = 0;
    this.lastPowerAt = 0;
    this.lastRespawnAt = 0;
    this.lastPatrolTurnAt = 0;
    this.patrolFacing = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      };
      const timeout = setTimeout(() => {
        fail(new Error(`${this.name} timed out waiting for hello`));
        ws.close();
      }, 10_000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'auth', token: this.token, character: this.characterId }));
      });
      ws.on('message', (buf) => {
        let msg;
        try {
          msg = JSON.parse(buf.toString());
        } catch {
          return;
        }
        if (msg.t === 'hello') {
          if (settled) return;
          settled = true;
          this.pid = msg.id;
          this.connected = true;
          clearTimeout(timeout);
          resolve(this);
          return;
        }
        if (msg.t === 'error') {
          const hint =
            msg.error === 'too many connections from your network'
              ? ' Increase MAX_WS_PER_IP_HARD, restart the server, and close extra local sessions.'
              : '';
          fail(
            new Error(`${this.name} auth failed: ${msg.error ?? 'unknown websocket error'}${hint}`),
          );
          ws.close();
          return;
        }
        if (msg.t === 'snap') {
          this.self = mergeSelf(this.self, msg.self);
          this.ents = mergeEnts(this.ents, msg);
          this.events.push(...(msg.events ?? []));
          this.ready = true;
        }
        if (msg.t === 'err') this.errors += 1;
      });
      ws.on('error', (err) => {
        this.errors += 1;
        if (!this.connected) fail(err);
      });
      ws.on('close', (code, reason) => {
        this.closeCode = code;
        this.closeReason = reason.toString();
        this.closed = true;
        this.connected = false;
        if (!settled) {
          fail(
            new Error(
              `${this.name} closed before hello: code=${code} reason="${this.closeReason || 'none'}".`,
            ),
          );
        }
      });
    });
  }

  cmd(payload) {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ t: 'cmd', ...payload }));
  }

  input(mi = {}, facing = undefined) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: 'input', mi, facing }));
  }

  powerUp() {
    const now = Date.now();
    if (now - this.lastPowerAt < 1_500) return;
    this.lastPowerAt = now;
    this.cmd({ cmd: 'dev_level', level: BOT_LEVEL });
    this.cmd({ cmd: 'dev_teleport', x: this.spot.x, z: this.spot.z });
  }

  mobs() {
    return [...this.ents.values()].filter(isAliveMob);
  }

  dist(pos) {
    if (!this.self) return Infinity;
    return Math.hypot((pos.x ?? 0) - this.self.x, (pos.z ?? 0) - this.self.z);
  }

  faceTo(pos) {
    if (!this.self) return 0;
    return Math.atan2((pos.x ?? 0) - this.self.x, (pos.z ?? 0) - this.self.z);
  }

  nearestMob() {
    return (
      this.mobs()
        .map((mob) => ({ mob, dist: this.dist(mob) }))
        .filter((entry) => entry.dist <= MOB_SEARCH_RANGE)
        .sort((a, b) => a.dist - b.dist)[0]?.mob ?? null
    );
  }

  handleEvents() {
    for (const event of this.events) {
      if (event.type === 'death') {
        const dead = this.ents.get(event.entityId);
        if (dead?.k === 'mob') this.kills += 1;
      }
    }
    this.events = [];
  }

  respawnIfNeeded() {
    if (!this.self?.dead) return false;
    const now = Date.now();
    if (now - this.lastRespawnAt < 3_000) return true;
    this.lastRespawnAt = now;
    this.cmd({ cmd: 'release' });
    this.powerUp();
    return true;
  }

  patrol() {
    const now = Date.now();
    if (now - this.lastPatrolTurnAt > 2_500) {
      this.lastPatrolTurnAt = now;
      const anchorFace = this.faceTo(this.spot);
      this.patrolFacing =
        this.dist(this.spot) > 10
          ? anchorFace
          : anchorFace + (((now / 1_000 + this.characterId) % 2) - 1) * 0.9;
    }
    this.input({ f: 1 }, this.patrolFacing);
  }

  step() {
    if (!this.ready || !this.self || this.closed) return;
    this.handleEvents();
    if (this.respawnIfNeeded()) return;

    const target = this.nearestMob();
    if (!target) {
      this.patrol();
      return;
    }

    const now = Date.now();
    const dist = this.dist(target);
    const facing = this.faceTo(target);
    if (dist > classRange(this.cls)) {
      this.input({ f: 1 }, facing);
      return;
    }

    this.input({}, facing);
    if (this.self.target !== target.id && now - this.lastTargetAt > 600) {
      this.lastTargetAt = now;
      this.cmd({ cmd: 'target', id: target.id });
    }
    if (now - this.lastAttackAt > 800) {
      this.lastAttackAt = now;
      this.cmd({ cmd: 'attack' });
    }
    castForClass(this);
  }

  close() {
    this.ws?.close();
  }
}

async function seedBots(pool) {
  const records = [];
  for (let i = 0; i < BOT_COUNT; i += 1) {
    const username = `load_${RUN_ID.toLowerCase()}_${String(i).padStart(3, '0')}`;
    const name = charName(i);
    const cls = CLASSES[i % CLASSES.length];
    const token = randomBytes(32).toString('hex');
    const account = await pool.query(
      `INSERT INTO accounts (username, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [username, 'loadtest:token-only'],
    );
    const accountId = account.rows[0].id;
    await pool.query(
      `INSERT INTO auth_tokens (token, account_id, expires_at)
       VALUES ($1, $2, now() + interval '12 hours')`,
      [token, accountId],
    );
    const character = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, state)
       VALUES ($1, $2, $3, $4, NULL)
       RETURNING id`,
      [accountId, name, cls, REALM],
    );
    records.push({ username, token, characterId: character.rows[0].id, name, cls, accountId });
  }
  return records;
}

async function cleanupBots(pool, records) {
  const accountIds = records.map((record) => record.accountId);
  if (accountIds.length === 0) return;
  await pool.query('DELETE FROM accounts WHERE id = ANY($1::int[])', [accountIds]);
}

async function connectAll(records) {
  const bots = records.map((record, index) => {
    const spot = jitteredSpot(SPOTS[index % SPOTS.length], index);
    return new LoadBot(record, spot);
  });
  let next = 0;
  async function worker() {
    while (next < bots.length) {
      const bot = bots[next];
      next += 1;
      try {
        await bot.connect();
        bot.powerUp();
        console.log(
          `[load-players] connected ${bot.name} ${bot.cls} at ${bot.spot.name} (${bot.spot.x}, ${bot.spot.z})`,
        );
        await sleep(100);
      } catch (err) {
        const connected = bots.filter((candidate) => candidate.connected).length;
        throw new Error(
          `failed while connecting ${bot.name} after ${connected}/${bots.length} clients: ${err.message}`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONNECT_CONCURRENCY, bots.length) }, worker));
  return bots;
}

function report(bots, startedAt) {
  const alive = bots.filter((bot) => bot.connected && !bot.closed && !bot.self?.dead).length;
  const dead = bots.filter((bot) => bot.self?.dead).length;
  const ready = bots.filter((bot) => bot.ready).length;
  const mobs = bots.reduce((sum, bot) => sum + bot.mobs().length, 0);
  const kills = bots.reduce((sum, bot) => sum + bot.kills, 0);
  const errors = bots.reduce((sum, bot) => sum + bot.errors, 0);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(
    `[load-players] t=${elapsed}s ready=${ready}/${bots.length} alive=${alive} dead=${dead} mobsSeen=${mobs} kills=${kills} errors=${errors}`,
  );
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required so the script can create disposable load-test accounts.',
    );
  }
  if (BOT_COUNT > 20) {
    console.log(
      `[load-players] start the server with MAX_WS_PER_IP_HARD=${BOT_COUNT + 5} or higher for ${BOT_COUNT} local clients`,
    );
  }
  console.log(
    '[load-players] server must have ALLOW_DEV_COMMANDS=1 for dev_level and dev_teleport',
  );
  console.log(
    `[load-players] run=${RUN_ID} count=${BOT_COUNT} level=${BOT_LEVEL} durationMs=${DURATION_MS} realm=${REALM} url=${SERVER_URL}`,
  );

  const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
  let records = [];
  let bots = [];
  let tickTimer = null;
  let reportTimer = null;
  let stopping = false;

  async function stop() {
    if (stopping) return;
    stopping = true;
    if (tickTimer) clearInterval(tickTimer);
    if (reportTimer) clearInterval(reportTimer);
    for (const bot of bots) bot.close();
    await sleep(250);
    if (CLEANUP) {
      console.log('[load-players] cleanup enabled, deleting seeded accounts');
      await cleanupBots(pool, records);
    }
    await pool.end();
  }

  process.once('SIGINT', () => {
    stop()
      .then(() => process.exit(130))
      .catch((err) => {
        console.error('[load-players] stop failed:', err);
        process.exit(1);
      });
  });

  try {
    records = await seedBots(pool);
    bots = await connectAll(records);
    const startedAt = Date.now();
    tickTimer = setInterval(() => {
      for (const bot of bots) bot.step();
    }, TICK_MS);
    reportTimer = setInterval(() => report(bots, startedAt), REPORT_MS);
    await sleep(DURATION_MS);
    report(bots, startedAt);
  } finally {
    await stop();
  }
}

main().catch((err) => {
  console.error('[load-players] failed:', err);
  process.exit(1);
});
