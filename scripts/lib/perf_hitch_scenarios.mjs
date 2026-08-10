import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import WebSocket from 'ws';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './loopback_guard.mjs';
import {
  closeHitchBrowser,
  openHitchBrowser,
  runMeasuredWindow,
  sleep,
} from './perf_hitch_browser.mjs';
import {
  assertCrowdResetEvidence,
  buildCrowdInfluxPositions,
  buildCrowdInfluxValidation,
  buildCrowdResetTargets,
  createCrowdCommandLedger,
  crowdResetPlacementSettled,
  HITCH_CROWD_COMBAT_QUIET_MS,
  HITCH_CROWD_INFLUX_MOVE_INTERVAL_MS,
  HITCH_CROWD_INFLUX_MOVE_STEPS,
  HITCH_CROWD_INFLUX_X,
  HITCH_CROWD_INFLUX_Z,
  HITCH_CROWD_PARKING_TOLERANCE,
  observeCrowdResetState,
  paceCrowdResetActions,
  planCrowdMountReadinessActions,
  planCrowdRecoveryActions,
  planCrowdResetActions,
  validateCrowdRecoveryLifeState,
  validateCrowdRecoveryState,
  validateCrowdResetState,
} from './perf_hitch_crowd_reset.mjs';
import {
  buildSoakChurnPlan,
  executeSoakChurnPlan,
  HITCH_SOAK_INSIDE_RADIUS,
  HITCH_SOAK_OUTSIDE_RADIUS,
  resolveSoakAppearance,
} from './perf_hitch_soak.mjs';
import { SCENARIO_SPECS } from './perf_hitch_store.mjs';
import { worldAuthMessage } from './world_auth.mjs';

try {
  process.loadEnvFile?.();
} catch {}

const { Client } = pg;

export const HITCH_ROSTER_SIZE = 36;
export const HITCH_CROWD_SIZE = 24;
export const HITCH_CHURN_SIZE = HITCH_ROSTER_SIZE - HITCH_CROWD_SIZE;
export const HITCH_ROSTER_PAYLOAD_MAX_BYTES = 32 * 1024;
export const HITCH_BOT_CONNECT_CONCURRENCY = 4;
export const HITCH_TAKEOVER_CONCURRENCY = 3;
// Sized for the paced command schedule (perf_hitch_crowd_reset.mjs pacing
// constants): a phase may need the initial issue plus two quiet-window chat
// retries (2 x HITCH_CROWD_CHAT_RETRY_MS = 7 s), a lost mount summon's hold
// plus recast (3 s + 1.5 s), and snapshot acknowledgment latency at the 200 ms
// poll, about 13 s worst case; 20 s leaves headroom without masking a wedged
// reset. The previous 12 s bound predates pacing and could expire before a
// single paced chat retry had landed.
export const HITCH_CROWD_RESET_TIMEOUT_MS = 20_000;
export const HITCH_CROWD_RESET_POLL_MS = 200;
const HITCH_CROWD_MOUNT_RETRY_HOLD_MS = 3_000;

const FIXTURE_PASSWORD_HASH = 'hitch-referee:token-only';
const FIXTURE_LOCK_DIR = path.join(os.tmpdir(), 'woc-hitch-referee.lock');
const CAMERA_ROW = Object.freeze({
  role: 'camera',
  ip: '198.18.0.250',
  username: 'hitch_ref_camera',
  name: 'HrefCamera',
  cls: 'mage',
});
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
const MOUNTS = [
  'reins_valorsteed',
  'reins_grag_bear',
  'reins_stalkglider_snail',
  'reins_shadowjump_toad',
  'reins_stormfeather_griffin',
];
const WEAPON_SKINS = Object.freeze({
  sword: ['guildmark_arming_sword', 'cinderbrand_sword', 'ice_fang_sword', 'solheim_sword'],
  axe: ['brasscap_axe', 'emberbite_axe', 'glaciersplit_axe', 'skyrender_axe'],
  mace: ['tempered_flanged_mace', 'smoulderfall_mace', 'rimecrusher_mace', 'starfall_mace'],
  dagger: ['guildmark_dirk', 'ashspark_dagger', 'frostbite_dagger', 'astravyr_dagger'],
  staff: ['brasscrown_staff', 'forgeheart_staff', 'hoarfrost_vigil_staff', 'cosmarch_staff'],
  bow: ['fletcher_s_guild_bow', 'winterbite', 'encore_bow'],
});
const CLASS_WEAPON_TYPE = Object.freeze({
  warrior: 'sword',
  paladin: 'mace',
  hunter: 'bow',
  rogue: 'dagger',
  priest: 'staff',
  shaman: 'mace',
  mage: 'staff',
  warlock: 'staff',
  druid: 'staff',
});

function lettersFromIndex(index) {
  let value = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (value % 26)) + out;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return out;
}

export function buildHitchFixtureRows() {
  const allSkinIds = Object.values(WEAPON_SKINS).flat();
  return Array.from({ length: HITCH_ROSTER_SIZE }, (_, index) => {
    const crowd = index < HITCH_CROWD_SIZE;
    const localIndex = crowd ? index : index - HITCH_CROWD_SIZE;
    const cls = crowd ? CLASSES[index % CLASSES.length] : 'druid';
    const weaponType = CLASS_WEAPON_TYPE[cls];
    const weaponVariant = cls === 'hunter' ? Math.floor(index / CLASSES.length) : index;
    const weaponSkin = WEAPON_SKINS[weaponType][weaponVariant % WEAPON_SKINS[weaponType].length];
    return {
      index,
      role: crowd ? 'crowd' : 'churn',
      ip: `198.18.0.${index + 10}`,
      username: `hitch_ref_${String(index).padStart(2, '0')}`,
      name: `${crowd ? 'HrefCrowd' : 'HrefChurn'}${lettersFromIndex(localIndex)}`,
      cls,
      skin: index % 8,
      weaponType,
      weaponSkin,
      skinIds: allSkinIds,
      loadout: crowd ? { [weaponType]: weaponSkin } : {},
      mountItem: MOUNTS[index % MOUNTS.length],
    };
  });
}

/**
 * Derive the soak churn plan's cosmetic dimensions from the REAL fixture
 * lists, per bot. WEAPON_SKINS is ragged (bow carries 3 server-valid skins,
 * the other types 4), so the plan must size each weapon type's rotation from
 * its actual list instead of assuming a flat variant count; a stale flat
 * count is exactly what scheduled the nonexistent bow variant for bot 11.
 */
export function soakCosmeticInputs(bots) {
  const botWeaponTypes = new Array(bots.length);
  for (const bot of bots) botWeaponTypes[bot.index] = bot.weaponType;
  return {
    botWeaponTypes,
    weaponVariantCounts: Object.fromEntries(
      Object.entries(WEAPON_SKINS).map(([weaponType, skins]) => [weaponType, skins.length]),
    ),
    mountVariantCount: MOUNTS.length,
  };
}

export function assertExactFixtureIds(actualRows, expectedIds, label) {
  const actual = new Set(actualRows.map((row) => Number(row.account_id ?? row.id)));
  const expected = new Set(expectedIds.map(Number));
  if (
    actualRows.length !== expectedIds.length ||
    actual.size !== expected.size ||
    [...expected].some((id) => !actual.has(id))
  ) {
    throw new Error(`${label} returned ${actual.size}/${expected.size} expected fixture ids`);
  }
}

export function acquireHitchFixtureLock(lockDir = FIXTURE_LOCK_DIR) {
  try {
    fs.mkdirSync(lockDir);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`another hitch referee owns the fixture lock at ${lockDir}`);
    }
    throw error;
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    fs.rmSync(lockDir, { recursive: true, force: true });
  };
  process.once('exit', release);
  return release;
}

export function validateHitchFixtureRows(rows) {
  if (!Array.isArray(rows) || rows.length !== HITCH_ROSTER_SIZE || rows.length > 36) {
    throw new Error(`hitch fixture must contain exactly ${HITCH_ROSTER_SIZE} bounded rows`);
  }
  const payloadBytes = Buffer.byteLength(
    JSON.stringify(
      rows.map(({ username, name, cls, skinIds, loadout }) => ({
        username,
        name,
        cls,
        skinIds,
        loadout,
      })),
    ),
  );
  if (payloadBytes > HITCH_ROSTER_PAYLOAD_MAX_BYTES) {
    throw new Error(
      `hitch fixture payload ${payloadBytes} exceeds ${HITCH_ROSTER_PAYLOAD_MAX_BYTES}`,
    );
  }
  return payloadBytes;
}

function dbClient(databaseUrl) {
  return new Client({
    connectionString: databaseUrl,
    application_name: 'woc-hitch-referee',
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 18_000,
  });
}

async function withDbClient(databaseUrl, action) {
  const client = dbClient(databaseUrl);
  await client.connect();
  try {
    await client.query("SET lock_timeout = '5s'");
    await client.query("SET idle_in_transaction_session_timeout = '10s'");
    return await action(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function seedHitchFixtureWithClient(
  client,
  rows,
  realm,
  tokenFactory = () => randomBytes(32).toString('hex'),
) {
  const payloadBytes = validateHitchFixtureRows(rows);
  if (typeof realm !== 'string' || !realm.trim()) throw new Error('game server realm is missing');
  const allRows = [...rows, CAMERA_ROW];
  await client.query('BEGIN');
  try {
    const usernames = allRows.map((row) => row.username);
    const accounts = await client.query(
      `INSERT INTO accounts (username, password_hash)
         SELECT username, $2
         FROM unnest($1::text[]) AS fixture(username)
         ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
           WHERE accounts.password_hash = EXCLUDED.password_hash
         RETURNING id, username`,
      [usernames, FIXTURE_PASSWORD_HASH],
    );
    if (accounts.rows.length !== allRows.length) {
      throw new Error('fixture account name collided with a non-referee account');
    }
    const accountByUsername = new Map(accounts.rows.map((row) => [row.username, Number(row.id)]));
    const accountIds = allRows.map((row) => accountByUsername.get(row.username));
    if (accountIds.some((id) => !Number.isInteger(id))) {
      throw new Error('fixture account insert did not return every account id');
    }
    await client.query('DELETE FROM auth_tokens WHERE account_id = ANY($1::int[])', [accountIds]);
    const tokens = allRows.map(() => tokenFactory());
    const insertedTokens = await client.query(
      `INSERT INTO auth_tokens (token, account_id, expires_at)
         SELECT token, account_id, now() + interval '12 hours'
         FROM unnest($1::text[], $2::int[]) AS fixture(token, account_id)
         RETURNING account_id`,
      [tokens, accountIds],
    );
    assertExactFixtureIds(insertedTokens.rows, accountIds, 'auth token batch');

    await client.query(
      `INSERT INTO characters (account_id, name, class, realm, state)
         SELECT account_id, name, class, $4, NULL
         FROM unnest($1::int[], $2::text[], $3::text[])
              AS fixture(account_id, name, class)
         ON CONFLICT (realm, lower(name)) DO NOTHING`,
      [accountIds, allRows.map((row) => row.name), allRows.map((row) => row.cls), realm],
    );
    const characters = await client.query(
      `SELECT id, account_id, name, class
         FROM characters
         WHERE realm = $1 AND account_id = ANY($2::int[])`,
      [realm, accountIds],
    );
    if (characters.rows.length !== allRows.length) {
      throw new Error(
        `fixture character lookup returned ${characters.rows.length}/${allRows.length}`,
      );
    }
    const characterByAccount = new Map(characters.rows.map((row) => [Number(row.account_id), row]));
    const records = allRows.map((row, index) => {
      const accountId = accountIds[index];
      const character = characterByAccount.get(accountId);
      if (!character || character.name !== row.name || character.class !== row.cls) {
        throw new Error(`fixture character mismatch for ${row.username}`);
      }
      return {
        ...row,
        accountId,
        characterId: Number(character.id),
        token: tokens[index],
      };
    });
    const botRecords = records.filter((record) => record.role !== 'camera');
    const upserted = await client.query(
      `INSERT INTO account_weapon_cosmetics AS cosmetics (account_id, skin_ids, loadout)
         SELECT account_id, skin_ids::jsonb, loadout::jsonb
         FROM unnest($1::int[], $2::text[], $3::text[])
              AS fixture(account_id, skin_ids, loadout)
         ON CONFLICT (account_id) DO UPDATE SET
           skin_ids = EXCLUDED.skin_ids,
           loadout = EXCLUDED.loadout,
           updated_at = now()
         RETURNING account_id`,
      [
        botRecords.map((row) => row.accountId),
        botRecords.map((row) => JSON.stringify(row.skinIds)),
        botRecords.map((row) => JSON.stringify(row.loadout)),
      ],
    );
    assertExactFixtureIds(
      upserted.rows,
      botRecords.map((row) => row.accountId),
      'weapon cosmetic batch',
    );
    await client.query('COMMIT');
    return {
      records: botRecords,
      camera: records.find((record) => record.role === 'camera'),
      payloadBytes,
      cosmeticRows: botRecords.length,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function seedFixture(databaseUrl, rows, realm) {
  return withDbClient(databaseUrl, (client) => seedHitchFixtureWithClient(client, rows, realm));
}

export async function runBounded(values, concurrency, action) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const value = values[next];
      next += 1;
      await action(value);
    }
  });
  await Promise.all(workers);
}

async function post(serverUrl, path, token, ip) {
  const response = await fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Forwarded-For': ip,
    },
    body: '{}',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    throw new Error(`${path} failed with HTTP ${response.status}`);
  }
  return body;
}

async function serverStatus(serverUrl) {
  const response = await fetch(`${serverUrl}/api/status`);
  if (!response.ok) throw new Error(`/api/status returned HTTP ${response.status}`);
  return response.json();
}

async function waitForPlayerBaseline(serverUrl, baseline, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await serverStatus(serverUrl).catch(() => null);
    if (last && Number(last.players_online) <= baseline) {
      await sleep(750);
      return last;
    }
    await sleep(250);
  }
  throw new Error(
    `online player count did not return to baseline ${baseline}; last=${last?.players_online ?? 'unavailable'}`,
  );
}

async function waitForDatabaseQuiet(databaseUrl, timeoutMs = 15_000) {
  return withDbClient(databaseUrl, async (client) => {
    const deadline = Date.now() + timeoutMs;
    let quietSamples = 0;
    let lastActive = null;
    while (Date.now() < deadline) {
      const result = await client.query(
        `SELECT count(*)::int AS active
         FROM pg_stat_activity
         WHERE datname = current_database()
           AND pid <> pg_backend_pid()
           AND state IS DISTINCT FROM 'idle'`,
      );
      lastActive = Number(result.rows[0]?.active ?? 0);
      quietSamples = lastActive === 0 ? quietSamples + 1 : 0;
      if (quietSamples >= 2) return { quietSamples, active: lastActive };
      await sleep(250);
    }
    throw new Error(`database did not become quiet before measurement; active=${lastActive}`);
  });
}

export class HitchBot {
  constructor(
    record,
    wsUrl,
    createWebSocket = (url, options) => new WebSocket(url, options),
    now = Date.now,
  ) {
    Object.assign(this, record);
    this.wsUrl = wsUrl;
    this.createWebSocket = createWebSocket;
    this.ws = null;
    this.pid = -1;
    this.self = null;
    this.selfFrame = null;
    this.entities = new Map();
    this.serverErrors = [];
    this.hitchProfilerInvulnerable = false;
    this.now = now;
    // Fail closed on a fresh connection until the same recent-personal-damage
    // window used by the online HUD has elapsed without another combat event.
    this.lastCombatEventAt = now();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = this.createWebSocket(this.wsUrl, {
        headers: { 'X-Forwarded-For': this.ip },
      });
      this.ws = ws;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) reject(new Error(`${this.name} timed out waiting for world hello`));
        ws.close();
      }, 12_000);
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      ws.on('open', () => ws.send(JSON.stringify(worldAuthMessage(this.token, this.characterId))));
      ws.on('message', (data) => {
        let message;
        try {
          message = JSON.parse(String(data));
        } catch {
          return;
        }
        if (message.t === 'hello') {
          this.pid = Number(message.pid ?? message.id);
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        } else if (message.t === 'snap') {
          this.selfFrame = message.self ?? null;
          this.self = mergeLegacySelfSnapshot(this.self, message.self);
          this.entities = mergeHitchBotEntitySnapshot(this.entities, message.ents, message.keep);
        } else if (message.t === 'events' && Array.isArray(message.list)) {
          for (const event of message.list) {
            if (!event || typeof event !== 'object') continue;
            if (event.type === 'error') {
              const text = String(event.text ?? event.error ?? 'unknown');
              this.serverErrors = appendHitchBotServerError(this.serverErrors, text);
              if (text.toLowerCase().includes('while in combat')) {
                this.lastCombatEventAt = this.now();
              }
            }
            if (
              event.type === 'damage' &&
              (Number(event.sourceId) === this.pid || Number(event.targetId) === this.pid)
            ) {
              this.lastCombatEventAt = this.now();
            }
          }
        } else if (message.t === 'error' || message.t === 'err') {
          // Post-connect server rejections would otherwise vanish (fail() is a
          // no-op once settled); keep a short tail so convergence failures can
          // name the server's actual reason.
          const text = String(message.error ?? message.text ?? 'unknown');
          this.serverErrors = appendHitchBotServerError(this.serverErrors, text);
          fail(new Error(`${this.name} world error: ${text}`));
        }
      });
      ws.on('error', fail);
      ws.on('close', (code) => {
        if (!settled) fail(new Error(`${this.name} closed before hello with code ${code}`));
      });
    });
    const deadline = Date.now() + 8_000;
    while (!this.self && Date.now() < deadline) await sleep(100);
    if (!this.self) throw new Error(`${this.name} did not receive a self snapshot`);
    return this;
  }

  combatActiveAt(nowMs = this.now()) {
    const mobHasAggro = [...this.entities.values()].some(
      (entity) =>
        entity.kind === 'mob' && entity.dead !== true && entity.aggroTargetId === this.pid,
    );
    return mobHasAggro || nowMs - this.lastCombatEventAt <= HITCH_CROWD_COMBAT_QUIET_MS;
  }

  cmd(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'cmd', ...payload }));
      return true;
    }
    return false;
  }

  input(mi, facing) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'input', mi, facing }));
    }
  }

  teleport(x, z) {
    this.cmd({ cmd: 'dev_teleport', x, z });
  }

  async logout() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'logout' }));
      await sleep(40);
    }
    this.ws?.close();
  }
}

export function mergeLegacySelfSnapshot(previous, frame) {
  if (!frame || typeof frame !== 'object') return previous ?? null;
  return {
    ...(previous ?? {}),
    ...frame,
    // worldAuthMessage negotiates legacy online snapshots. In that mode the
    // server omits an empty aura list, so omission clears rather than retains.
    auras: Array.isArray(frame.auras) ? [...frame.auras] : [],
  };
}

export function mergeHitchBotEntitySnapshot(previous, frames, keep) {
  const prior = previous instanceof Map ? previous : new Map();
  const next = new Map();
  if (Array.isArray(keep)) {
    for (const rawId of keep) {
      const id = Number(rawId);
      const entity = Number.isFinite(id) ? prior.get(id) : undefined;
      if (entity) next.set(id, entity);
    }
  }
  if (!Array.isArray(frames)) return next;
  for (const frame of frames) {
    if (!frame || typeof frame !== 'object') continue;
    const id = Number(frame.id);
    if (!Number.isFinite(id)) continue;
    const previousEntity = prior.get(id);
    next.set(id, {
      id,
      kind: typeof frame.k === 'string' ? frame.k : (previousEntity?.kind ?? null),
      // Every full or lite entity record carries the complete dynamic fields.
      // Their omission therefore clears these presence-only values, while a
      // bare keep id retains the previous record unchanged.
      dead: frame.dead === 1,
      aggroTargetId: Number.isFinite(Number(frame.aggro)) ? Number(frame.aggro) : null,
    });
  }
  return next;
}

export function appendHitchBotServerError(previous, message) {
  return [...previous, String(message)].slice(-10);
}

function armProfilerInvulnerability(bot) {
  const sent = bot.cmd({ cmd: 'dev_profiler_invulnerable' });
  if (sent === false) {
    throw new Error(`crowd bot ${bot.index} could not arm profiler invulnerability`);
  }
  bot.hitchProfilerInvulnerable = true;
}

export class HitchRoster {
  constructor({
    serverUrl,
    databaseUrl = process.env.DATABASE_URL,
    fixtureLock = acquireHitchFixtureLock,
    getServerStatus = serverStatus,
    seed = seedFixture,
    waitDbQuiet = waitForDatabaseQuiet,
    delay = sleep,
    createBot = (record, wsUrl) => new HitchBot(record, wsUrl),
  }) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.wsUrl = `${this.serverUrl.replace(/^http/, 'ws')}/ws`;
    this.databaseUrl = databaseUrl;
    this.records = [];
    this.camera = null;
    this.baselinePlayers = 0;
    this.seedEvidence = null;
    this.releaseFixtureLock = null;
    this.activeBots = new Set();
    this.createBot = createBot;
    this.prepareDeps = { fixtureLock, getServerStatus, seed, waitDbQuiet, delay };
  }

  async prepare() {
    assertLoopbackUrl(this.serverUrl, 'hitch game server');
    assertLoopbackDatabaseUrl(this.databaseUrl);
    const { fixtureLock, getServerStatus, seed, waitDbQuiet, delay } = this.prepareDeps;
    this.releaseFixtureLock = fixtureLock();
    try {
      const status = await getServerStatus(this.serverUrl);
      const fixture = await seed(this.databaseUrl, buildHitchFixtureRows(), status.realm);
      this.records = fixture.records;
      this.camera = fixture.camera;
      this.seedEvidence = {
        rosterSize: this.records.length,
        payloadBytes: fixture.payloadBytes,
        cosmeticRows: fixture.cosmeticRows,
      };
      await this.takeover([...this.records, this.camera]);
      await delay(750);
      this.baselinePlayers = Number((await getServerStatus(this.serverUrl)).players_online ?? 0);
      await waitDbQuiet(this.databaseUrl);
      return this;
    } catch (error) {
      this.release();
      throw error;
    }
  }

  release() {
    this.releaseFixtureLock?.();
    this.releaseFixtureLock = null;
  }

  cameraFixture() {
    if (!this.camera) throw new Error('hitch camera fixture was not prepared');
    return {
      username: this.camera.username,
      token: this.camera.token,
      characterName: this.camera.name,
    };
  }

  async takeover(records) {
    await runBounded(records, HITCH_TAKEOVER_CONCURRENCY, (record) =>
      post(
        this.serverUrl,
        `/api/characters/${record.characterId}/takeover`,
        record.token,
        record.ip,
      ),
    );
  }

  async connect(role = 'all') {
    const records =
      role === 'all' ? this.records : this.records.filter((record) => record.role === role);
    await this.takeover(records);
    const bots = records.map((record) => this.createBot(record, this.wsUrl));
    try {
      await runBounded(bots, HITCH_BOT_CONNECT_CONCURRENCY, async (bot) => {
        await bot.connect();
        armProfilerInvulnerability(bot);
        this.activeBots.add(bot);
        await this.prepareDeps.delay(75);
      });
      return bots;
    } catch (error) {
      await this.closeBots(bots);
      throw error;
    }
  }

  async closeBots(bots) {
    const closing = bots ?? [];
    await runBounded(closing, HITCH_TAKEOVER_CONCURRENCY, (bot) => bot.logout().catch(() => {}));
    if (closing.length) await this.takeover(closing);
    for (const bot of closing) this.activeBots.delete(bot);
  }

  async quietBarrier() {
    const db = await waitForDatabaseQuiet(this.databaseUrl);
    return {
      ...db,
      playersOnline: Number((await serverStatus(this.serverUrl)).players_online ?? 0),
    };
  }

  async drain() {
    const status = await waitForPlayerBaseline(this.serverUrl, this.baselinePlayers);
    await sleep(3_000);
    const db = await waitForDatabaseQuiet(this.databaseUrl);
    return { playersOnline: Number(status.players_online ?? 0), ...db };
  }

  async emergencyCleanup() {
    let firstError = null;
    try {
      await this.closeBots([...this.activeBots]);
    } catch (error) {
      firstError = error;
    }
    try {
      if (this.records.length) await this.takeover([...this.records, this.camera].filter(Boolean));
    } catch (error) {
      firstError ??= error;
    }
    try {
      if (this.seedEvidence) await this.drain();
    } catch (error) {
      firstError ??= error;
    } finally {
      this.release();
    }
    if (firstError) throw firstError;
  }
}

function ringPoint(center, index, total, radius = 9) {
  const angle = (index / total) * Math.PI * 2;
  return { x: center.x + Math.sin(angle) * radius, z: center.z + Math.cos(angle) * radius, angle };
}

async function browserPlayerPos(page) {
  return page.evaluate(() => {
    const pos = window.__game?.world?.player?.pos;
    if (!pos) throw new Error('measured player position is unavailable');
    return { x: pos.x, z: pos.z };
  });
}

export async function stageCrowdInfluxArena(profiler, readPlayerPos = browserPlayerPos) {
  await profiler.teleport(HITCH_CROWD_INFLUX_X, HITCH_CROWD_INFLUX_Z, 0);
  const center = await readPlayerPos(profiler.page);
  if (
    !Number.isFinite(center?.x) ||
    !Number.isFinite(center?.z) ||
    Math.hypot(center.x - HITCH_CROWD_INFLUX_X, center.z - HITCH_CROWD_INFLUX_Z) >
      HITCH_CROWD_PARKING_TOLERANCE
  ) {
    throw new Error(
      `crowd-influx camera did not reach aggro-free arena ${HITCH_CROWD_INFLUX_X},${HITCH_CROWD_INFLUX_Z}`,
    );
  }
  return center;
}

async function visibleCosmeticEvidence(page) {
  return page.evaluate(() => {
    const ownId = window.__game?.world?.player?.id;
    const players = [...(window.__game?.world?.entities?.values?.() ?? [])].filter(
      (entity) => entity.kind === 'player' && entity.id !== ownId,
    );
    return {
      players: players.length,
      skins: new Set(players.map((entity) => entity.skin)).size,
      weaponSkins: new Set(players.map((entity) => entity.weaponSkinId).filter(Boolean)).size,
      mounts: new Set(players.map((entity) => entity.mountKey).filter(Boolean)).size,
    };
  });
}

async function waitForVisibleBots(page, minimum) {
  await page.waitForFunction(
    (count) => {
      const ownId = window.__game?.world?.player?.id;
      return (
        [...(window.__game?.world?.entities?.values?.() ?? [])].filter(
          (entity) => entity.kind === 'player' && entity.id !== ownId,
        ).length >= count
      );
    },
    { timeout: 12_000, polling: 100 },
    minimum,
  );
}

async function grantMounts(bots, wait = sleep) {
  for (const bot of bots) {
    const sent = bot.cmd({ cmd: 'chat', text: '/dev mounts' });
    if (sent === false) throw new Error(`crowd bot ${bot.index} could not request mount grants`);
  }
  await wait(1_000);
}

function botInventory(bot) {
  if (Array.isArray(bot.selfFrame?.inv)) return bot.selfFrame.inv;
  return Array.isArray(bot.self?.inv) ? bot.self.inv : [];
}

function observeCrowdBots(bots, nowMs = Date.now()) {
  return bots.map((bot) => {
    const frame = bot.selfFrame ?? bot.self;
    const ridingTrained =
      bot.selfFrame?.mntRtd === undefined
        ? bot.self?.mntRtd === true
        : bot.selfFrame.mntRtd === true;
    return observeCrowdResetState({
      botIndex: bot.index,
      frame,
      profilerInvulnerable: bot.hitchProfilerInvulnerable === true,
      ridingTrained,
      inventory: botInventory(bot),
      inCombat: typeof bot.combatActiveAt === 'function' ? bot.combatActiveAt(nowMs) : false,
    });
  });
}

function applyCrowdResetActions(bots, actions) {
  const botByIndex = new Map(bots.map((bot) => [bot.index, bot]));
  for (const action of actions) {
    const bot = botByIndex.get(action.botIndex);
    if (!bot) throw new Error(`crowd reset bot ${action.botIndex} is unavailable`);
    if (action.kind === 'input') bot.input(action.move, action.facing);
    else bot.cmd(action.payload);
  }
}

async function convergeCrowdResetPhase(
  bots,
  targets,
  phase,
  { wait = sleep, now = Date.now, ledger = createCrowdCommandLedger() } = {},
) {
  const deadline = now() + HITCH_CROWD_RESET_TIMEOUT_MS;
  const presentedAlignedBotIds = new Set();
  const presentedAlignmentPendingBotIds = new Set();
  const mountRetryHoldUntilByBot = new Map();
  let attempts = 0;
  while (true) {
    const observedAt = now();
    const states = observeCrowdBots(bots, observedAt);
    const verdict = validateCrowdResetState(targets, states, phase);
    if (verdict.ok) return { ...verdict, attempts };
    if (observedAt >= deadline) {
      const errorTails = bots
        .filter((bot) => bot.serverErrors?.length)
        .slice(0, 6)
        .map((bot) => `bot ${bot.index} server said: ${bot.serverErrors.join(' | ')}`);
      throw new Error(
        `crowd reset ${phase} did not converge: ${verdict.failures.slice(0, 6).join('; ')}` +
          (errorTails.length ? ` [${errorTails.join(' / ')}]` : ''),
      );
    }

    if (phase === 'presented') {
      const stateByBot = new Map(states.map((state) => [state.botIndex, state]));
      for (const target of targets) {
        const state = stateByBot.get(target.botIndex);
        if (!state) continue;
        const expectedSummonInFlight =
          state.mountCastRemaining > 0 && state.mountCastKey === target.mountKey;
        if (expectedSummonInFlight) {
          presentedAlignmentPendingBotIds.delete(target.botIndex);
          continue;
        }
        if (state.mountKey === target.mountKey) {
          mountRetryHoldUntilByBot.delete(target.botIndex);
        }
        if (presentedAlignmentPendingBotIds.delete(target.botIndex)) {
          if (crowdResetPlacementSettled(target, state)) {
            presentedAlignedBotIds.add(target.botIndex);
          }
        }
        if (
          presentedAlignedBotIds.has(target.botIndex) &&
          !crowdResetPlacementSettled(target, state)
        ) {
          presentedAlignedBotIds.delete(target.botIndex);
        }
      }
    }

    // The pacing ledger owns re-sends: a planned command goes out once and is
    // repeated only after its quiet window, so an unconverged bot can never
    // out-send the server's per-connection chat ladder or command lane.
    const actions = paceCrowdResetActions(
      ledger,
      planCrowdResetActions(targets, states, phase, {
        nowMs: observedAt,
        presentedAlignedBotIds,
        mountRetryHoldUntilByBot,
      }),
      observedAt,
    );
    if (actions.length > 0) applyCrowdResetActions(bots, actions);
    if (phase === 'presented') {
      for (const action of actions) {
        if (action.kind === 'input') {
          const hasMove = Object.values(action.move).some((value) => value !== 0);
          if (hasMove) {
            presentedAlignedBotIds.delete(action.botIndex);
            presentedAlignmentPendingBotIds.delete(action.botIndex);
          } else {
            presentedAlignmentPendingBotIds.add(action.botIndex);
          }
        } else if (action.payload.cmd === 'use') {
          mountRetryHoldUntilByBot.set(
            action.botIndex,
            observedAt + HITCH_CROWD_MOUNT_RETRY_HOLD_MS,
          );
        }
      }
    }
    attempts += 1;
    await wait(HITCH_CROWD_RESET_POLL_MS);
  }
}

function crowdRecoveryTimeoutError(bots, verdict) {
  const errorTails = bots
    .filter((bot) => bot.serverErrors?.length)
    .slice(0, 6)
    .map((bot) => `bot ${bot.index} server said: ${bot.serverErrors.join(' | ')}`);
  return new Error(
    `crowd reset recovery did not converge: ${verdict.failures.slice(0, 6).join('; ')}` +
      (errorTails.length ? ` [${errorTails.join(' / ')}]` : ''),
  );
}

async function convergeCrowdRecoveryPhase(
  bots,
  targets,
  { wait = sleep, now = Date.now, ledger = createCrowdCommandLedger() } = {},
) {
  const deadline = now() + HITCH_CROWD_RESET_TIMEOUT_MS;
  const recoveryPendingBotIds = new Set();
  let attempts = 0;

  for (const bot of bots) {
    armProfilerInvulnerability(bot);
    bot.input({}, 0);
  }

  while (true) {
    let states = observeCrowdBots(bots);
    const botByIndex = new Map(bots.map((bot) => [bot.index, bot]));
    for (const state of states) {
      const bot = botByIndex.get(state.botIndex);
      if (!bot) continue;
      if (state.dead || state.ghost) {
        bot.hitchProfilerInvulnerable = false;
        recoveryPendingBotIds.add(state.botIndex);
      } else if (recoveryPendingBotIds.delete(state.botIndex)) {
        armProfilerInvulnerability(bot);
      }
    }
    states = observeCrowdBots(bots);
    const verdict = validateCrowdRecoveryLifeState(targets, states);
    if (verdict.ok) break;
    if (verdict.failures.some((failure) => failure.includes('recovery sickness remained'))) {
      throw new Error(`crowd reset recovery cannot normalize: ${verdict.failures.join('; ')}`);
    }
    if (now() >= deadline) throw crowdRecoveryTimeoutError(bots, verdict);

    const actions = paceCrowdResetActions(ledger, planCrowdRecoveryActions(targets, states), now());
    if (actions.length > 0) applyCrowdResetActions(bots, actions);
    attempts += 1;
    await wait(HITCH_CROWD_RESET_POLL_MS);
  }

  // The riding grant is deliberately sequenced after every resurrection and
  // level restoration. Its mntRtd readback is the authoritative proof that a
  // recovered bot can use the reins the same dev command grants to fresh bots,
  // and the dev_give reins fallback follows the grant's readback window. The
  // pacing ledger owns every re-send, so a lost grant retries after the chat
  // quiet window instead of flooding the server's per-connection chat ladder.
  while (true) {
    const states = observeCrowdBots(bots);
    const verdict = validateCrowdRecoveryState(targets, states);
    if (verdict.ok) return { ...verdict, attempts };
    if (verdict.failures.some((failure) => failure.includes('recovery sickness remained'))) {
      throw new Error(`crowd reset recovery cannot normalize: ${verdict.failures.join('; ')}`);
    }
    if (now() >= deadline) throw crowdRecoveryTimeoutError(bots, verdict);

    const actions = paceCrowdResetActions(
      ledger,
      planCrowdMountReadinessActions(targets, states, ledger, now()),
      now(),
    );
    if (actions.length > 0) applyCrowdResetActions(bots, actions);
    attempts += 1;
    await wait(HITCH_CROWD_RESET_POLL_MS);
  }
}

export async function recoverCrowdBots(bots, deps = {}) {
  const targets = deps.targets ?? buildCrowdResetTargets(bots);
  return convergeCrowdRecoveryPhase(bots, targets, {
    wait: deps.wait ?? sleep,
    now: deps.now ?? Date.now,
    ledger: deps.ledger ?? createCrowdCommandLedger(),
  });
}

export async function prepareCrowdBots(bots, deps = {}) {
  const wait = deps.wait ?? sleep;
  const now = deps.now ?? Date.now;
  // One ledger spans all three phases so the per-bot chat spacing holds across
  // phase boundaries, not only inside one phase.
  const ledger = deps.ledger ?? createCrowdCommandLedger();
  const targets = buildCrowdResetTargets(bots);
  const recovery = await recoverCrowdBots(bots, { targets, wait, now, ledger });
  const neutral = await convergeCrowdResetPhase(bots, targets, 'neutral', { wait, now, ledger });
  const presented = await convergeCrowdResetPhase(bots, targets, 'presented', {
    wait,
    now,
    ledger,
  });
  return { bots: targets.length, recovery, neutral, presented };
}

export async function prepareSoakBots(bots, wait = sleep) {
  await grantMounts(bots, wait);
  for (const bot of bots) {
    bot.input({}, 0);
    bot.cmd({ cmd: 'change_skin', skin: 0 });
    bot.cmd({ cmd: 'change_weapon_skin', skin: null, wtype: bot.weaponType });
    if (bot.self?.mnt) bot.cmd({ cmd: 'mount_toggle' });
    bot.hitchMountItem = null;
  }
  await wait(1_200);
}

function moveBots(bots, center, step) {
  for (const bot of bots) {
    const point = ringPoint(center, bot.index, bots.length, 8 + (bot.index % 3) * 2);
    const facing = point.angle + step * 0.08;
    bot.input({ f: 1, sl: step % 4 < 2 ? 1 : 0, sr: step % 4 < 2 ? 0 : 1 }, facing);
  }
}

async function offlineScenario(session, spec) {
  const { profiler } = session;
  if (spec.name === 'cold-zone-entry') {
    await profiler.teleport(0, 60, 0);
    return runMeasuredWindow(session, spec, async () => {
      await profiler.teleport(0, 660, 0);
      await profiler.lookSweep({ yaw: 1, frames: 45, dx: 20 });
      await profiler.lookSweep({ yaw: -1, frames: 45, dx: 20 });
    });
  }
  if (spec.name === 'sky-crossing') {
    await profiler.teleport(0, 515, 0);
    return runMeasuredWindow(session, spec, async () => {
      await profiler.setMove({ forward: true });
      await Promise.all([
        sleep(Math.max(0, spec.measureMs - 800)),
        profiler.lookSweep({ yaw: 1, frames: 120, dx: 8 }),
      ]);
      await profiler.stopMove();
    });
  }
  if (spec.name === 'combat-vfx-burst') {
    await profiler.teleport(30, 90, 0);
    return runMeasuredWindow(session, spec, async () => {
      await Promise.all([
        profiler.combat({ ms: Math.max(1_000, spec.measureMs - 1_000), keys: '1234567890' }),
        profiler.lookSweep({ yaw: 1, frames: 90, dx: 5 }),
      ]);
    });
  }
  throw new Error(`offline scenario is not implemented: ${spec.name}`);
}

export async function crowdInflux(session, spec, roster, bots, reset, deps = {}) {
  const stageArena = deps.stageArena ?? stageCrowdInfluxArena;
  const delay = deps.delay ?? sleep;
  const measure = deps.measure ?? runMeasuredWindow;
  const waitForVisible = deps.waitForVisible ?? waitForVisibleBots;
  const readCosmetics = deps.cosmetics ?? visibleCosmeticEvidence;
  const startInterval = deps.setInterval ?? setInterval;
  const stopInterval = deps.clearInterval ?? clearInterval;
  assertCrowdResetEvidence(reset, bots.length);
  const center = await stageArena(session.profiler);
  await delay(700);
  const quiet = await roster.quietBarrier();
  const influxPositions = buildCrowdInfluxPositions(bots.length);
  const pointByBotIndex = new Map(bots.map((bot, index) => [bot.index, influxPositions[index]]));
  const raw = await measure(session, spec, async () => {
    for (let start = 0; start < bots.length; start += 4) {
      for (const bot of bots.slice(start, start + 4)) {
        const point = pointByBotIndex.get(bot.index);
        if (!point) throw new Error(`crowd-influx position missing for bot ${bot.index}`);
        bot.teleport(point.x, point.z);
      }
      await delay(220);
    }
    await waitForVisible(session.profiler.page, Math.floor(bots.length * 0.8));
    let movementStep = 0;
    const mover = startInterval(() => {
      if (movementStep >= HITCH_CROWD_INFLUX_MOVE_STEPS) {
        stopInterval(mover);
        for (const bot of bots) bot.input({}, 0);
        return;
      }
      moveBots(bots, center, movementStep);
      movementStep += 1;
    }, HITCH_CROWD_INFLUX_MOVE_INTERVAL_MS);
    try {
      await session.profiler.lookSweep({ yaw: 1, frames: 150, dx: 6 });
    } finally {
      stopInterval(mover);
      for (const bot of bots) bot.input({}, 0);
    }
  });
  const cosmetics = await readCosmetics(session.profiler.page);
  // Per-bot server error tails ride the raw dump as evidence; the validation
  // fails closed on any rate-limiter text among them (a referee self-harm
  // signal), while other transient reset-time refusals remain visible data.
  const serverErrors = bots
    .filter((bot) => Array.isArray(bot.serverErrors) && bot.serverErrors.length > 0)
    .map((bot) => ({ botIndex: bot.index, errors: [...bot.serverErrors] }));
  const validation = buildCrowdInfluxValidation({
    cosmetics,
    quiet,
    reset,
    botCount: bots.length,
    serverErrors,
  });
  return { ...raw, validation };
}

async function cosmeticChurn(session, spec, roster, bots) {
  const center = await browserPlayerPos(session.profiler.page);
  await grantMounts(bots);
  for (const bot of bots) {
    bot.cmd({ cmd: 'change_skin', skin: 0 });
    bot.cmd({ cmd: 'change_weapon_skin', skin: null, wtype: 'staff' });
    if (bot.self?.mnt) bot.cmd({ cmd: 'mount_toggle' });
    const point = ringPoint(center, bot.index - HITCH_CROWD_SIZE, bots.length, 8);
    bot.teleport(point.x, point.z);
  }
  await sleep(2_000);
  await waitForVisibleBots(session.profiler.page, Math.floor(bots.length * 0.8));
  const quiet = await roster.quietBarrier();
  const forms = ['bear_form', 'cat_form', 'travel_form'];
  const raw = await runMeasuredWindow(session, spec, async () => {
    for (const bot of bots) bot.cmd({ cmd: 'change_skin', skin: bot.skin || 1 });
    await sleep(700);
    for (const bot of bots) bot.cmd({ cmd: 'change_weapon_skin', skin: bot.weaponSkin });
    await sleep(900);
    for (let phase = 0; phase < 3; phase += 1) {
      for (const bot of bots)
        bot.cmd({ cmd: 'cast', ability: forms[(bot.index + phase) % forms.length] });
      await sleep(1_400);
    }
    for (const bot of bots) bot.cmd({ cmd: 'use', item: bot.mountItem });
    await sleep(2_200);
    for (const bot of bots) bot.cmd({ cmd: 'cast', ability: forms[bot.index % forms.length] });
    await session.profiler.lookSweep({ yaw: -1, frames: 160, dx: 6 });
  });
  const validation = await visibleCosmeticEvidence(session.profiler.page);
  if (validation.players < Math.floor(bots.length * 0.8)) {
    throw new Error(`cosmetic-churn rendered only ${validation.players}/${bots.length} bots`);
  }
  return { ...raw, validation: { ...validation, quiet, phases: 7 } };
}

async function soakScenario(session, spec, roster, bots) {
  const center = await browserPlayerPos(session.profiler.page);
  const plan = buildSoakChurnPlan({
    botCount: bots.length,
    measureMs: spec.measureMs,
    ...soakCosmeticInputs(bots),
  });
  const botsByIndex = new Map(bots.map((bot) => [bot.index, bot]));
  const initialVisible = new Set(plan.initialVisibleBotIndexes);
  const botFor = (botIndex) => {
    const bot = botsByIndex.get(botIndex);
    if (!bot) throw new Error(`soak schedule references missing bot ${botIndex}`);
    return bot;
  };
  const positionBot = (bot, visible) => {
    const baseRadius = visible ? HITCH_SOAK_INSIDE_RADIUS : HITCH_SOAK_OUTSIDE_RADIUS;
    const radius = baseRadius + (bot.index % 4) * 2;
    const point = ringPoint(center, bot.index, bots.length, radius);
    bot.teleport(point.x, point.z);
  };
  const applyAppearance = (entry) =>
    applySoakAppearance(botFor(entry.botIndex), entry, (bot) => positionBot(bot, true));
  for (const bot of bots) {
    bot.input({}, 0);
    positionBot(bot, initialVisible.has(bot.index));
  }
  await sleep(2_000);
  await waitForVisibleBots(
    session.profiler.page,
    Math.floor(plan.initialVisibleBotIndexes.length * 0.8),
  );
  const quiet = await roster.quietBarrier();
  const raw = await runMeasuredWindow(session, spec, async () => {
    await executeSoakChurnPlan(plan, {
      now: () => performance.now(),
      wait: sleep,
      moveOutside: (botIndex) => positionBot(botFor(botIndex), false),
      applyIncoming: applyAppearance,
    });
  });
  const validation = await visibleCosmeticEvidence(session.profiler.page);
  if (validation.players < Math.floor(plan.initialVisibleBotIndexes.length * 0.8)) {
    throw new Error(
      `soak rendered only ${validation.players}/${plan.initialVisibleBotIndexes.length} bots`,
    );
  }
  return {
    ...raw,
    validation: {
      ...validation,
      quiet,
      intendedBots: plan.initialVisibleBotIndexes.length,
      churnSeed: plan.seed,
      churnSteps: plan.steps.length,
      churnCohortSize: plan.cohortSize,
      churnIntervalMs: plan.intervalMs,
      churnUniqueCombinations: plan.uniqueCombinationCount,
    },
  };
}

export function applySoakAppearance(bot, entry, positionVisible) {
  const { skin, weaponSkin, mountItem } = resolveSoakAppearance(
    entry,
    bot.weaponType,
    WEAPON_SKINS,
    MOUNTS,
  );
  bot.cmd({ cmd: 'change_skin', skin });
  bot.cmd({ cmd: 'change_weapon_skin', skin: weaponSkin });
  if (bot.hitchMountItem !== mountItem) {
    bot.cmd({ cmd: 'use', item: mountItem });
    bot.hitchMountItem = mountItem;
  }
  positionVisible(bot);
}

export async function runHitchScenario(
  { name, preset, offlineUrl, serverUrl, roster, measureMs },
  deps = {},
) {
  const openBrowser = deps.openBrowser ?? openHitchBrowser;
  const closeBrowser = deps.closeBrowser ?? closeHitchBrowser;
  const runCrowd = deps.crowd ?? crowdInflux;
  const resetCrowd = deps.prepareCrowd ?? prepareCrowdBots;
  const runChurn = deps.churn ?? cosmeticChurn;
  const runSoak = deps.soak ?? soakScenario;
  const runOffline = deps.offline ?? offlineScenario;
  const frozen = SCENARIO_SPECS[name];
  if (!frozen) throw new Error(`unknown hitch scenario: ${name}`);
  const spec = { ...frozen, name, measureMs: measureMs ?? frozen.measureMs };
  let session = null;
  let bots = [];
  let crowdReset = null;
  try {
    let raw;
    if (frozen.mode === 'online') {
      if (!roster) throw new Error(`${name} requires a prepared local hitch roster`);
      bots = await roster.connect(name === 'cosmetic-churn' ? 'churn' : 'all');
      if (name === 'crowd-influx') {
        crowdReset = await resetCrowd(bots, {
          wait: deps.wait ?? sleep,
          now: deps.now ?? Date.now,
        });
      }
      if (name === 'soak') await prepareSoakBots(bots, deps.wait ?? sleep);
      await roster.takeover([roster.camera]);
      session = await openBrowser({
        mode: 'online',
        preset,
        gameUrl: serverUrl,
        serverUrl,
        onlineFixture: roster.cameraFixture(),
      });
      if (name === 'crowd-influx') {
        raw = await runCrowd(session, spec, roster, bots, crowdReset);
      } else if (name === 'cosmetic-churn') raw = await runChurn(session, spec, roster, bots);
      else if (name === 'soak') raw = await runSoak(session, spec, roster, bots);
      return {
        ...raw,
        browserVersion: session.browserVersion,
        browserFlags: [...session.browserFlags],
        freshProfile: session.freshProfile,
        seedEvidence: roster.seedEvidence,
      };
    }
    session = await openBrowser({
      mode: 'offline',
      preset,
      gameUrl: offlineUrl,
      serverUrl,
    });
    raw = await runOffline(session, spec);
    return {
      ...raw,
      browserVersion: session.browserVersion,
      browserFlags: [...session.browserFlags],
      freshProfile: session.freshProfile,
    };
  } finally {
    await closeBrowser(session).catch(() => {});
    await roster?.closeBots(bots).catch(() => {});
    if (frozen.mode === 'online') {
      if (roster?.camera) await roster.takeover([roster.camera]);
      await roster?.drain();
    }
  }
}
