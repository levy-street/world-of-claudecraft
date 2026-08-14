// Local-only online roster for GPU-hitch experiments. It creates disposable
// accounts with deterministic authored appearances and varied equipped weapon
// skins, then keeps their world sockets alive for the duration of a capture.

import { randomBytes } from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from '../lib/loopback_guard.mjs';
import { worldAuthMessage } from '../lib/world_auth.mjs';
import { gearedArrivalBotFixture, gearedArrivalFixtureSha256 } from './geared_arrival_fixture.mjs';

export const GEARED_ARRIVAL_OBSERVER = Object.freeze({ x: 0, z: 0 });
export const GEARED_ARRIVAL_PEN = Object.freeze({ x: -150, z: 150 });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DB_TIMEOUT_MS = 15_000;

function letters(value) {
  return String(value)
    .replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)])
    .replace(/[^a-z]/gi, 'a')
    .toLowerCase();
}

export function gearedArrivalPosition(index, center = GEARED_ARRIVAL_OBSERVER) {
  const angle = index * 2.39996;
  const radius = 4 + 5 * Math.sqrt((index % 25) / 25);
  return {
    x: center.x + Math.cos(angle) * radius,
    z: center.z + Math.sin(angle) * radius,
  };
}

async function post(serverUrl, pathname, body, token, xff) {
  const response = await fetch(serverUrl + pathname, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(xff ? { 'X-Forwarded-For': xff } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

class GearedArrivalBot {
  constructor({ index, runId, serverUrl, wsUrl }) {
    this.index = index;
    this.runId = runId;
    this.serverUrl = serverUrl;
    this.wsUrl = wsUrl;
    this.fixture = gearedArrivalBotFixture(index);
    // Spread registrations across private /24s. Keeping every bot in one /24
    // trips the server's subnet-abuse reporter and pollutes a performance run
    // with unrelated COUNT/report work once the roster reaches 20 players.
    this.ip = `172.${16 + (index % 16)}.${Math.floor(index / 16)}.${(index % 250) + 1}`;
    this.username = `gpu_hitch_${runId}_${index}`;
    this.name = `Gh${letters(runId).slice(-8)}${letters(index)}`;
  }

  async register(db) {
    // Provision the local fixture directly. Driving /api/register would add
    // email and anti-abuse reporting work to the very window whose GPU cost we
    // are trying to isolate.
    const account = await db.query(
      `INSERT INTO accounts (username, password_hash)
       VALUES ($1, $2)
       RETURNING id`,
      [this.username, 'loadtest:token-only'],
    );
    const accountId = account.rows[0]?.id;
    if (!Number.isInteger(accountId)) throw new Error(`no account id for geared bot ${this.index}`);
    this.accountId = accountId;
    this.token = randomBytes(32).toString('hex');
    await db.query(
      `INSERT INTO auth_tokens (token, account_id, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [this.token, accountId],
    );
    await db.query(
      `INSERT INTO account_weapon_cosmetics (account_id, skin_ids)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (account_id) DO UPDATE SET skin_ids = EXCLUDED.skin_ids`,
      [accountId, JSON.stringify(this.fixture.skins)],
    );

    const character = await db.query(
      `INSERT INTO characters (account_id, name, class, state, appearance)
       VALUES ($1, $2, $3, NULL, $4::jsonb)
       RETURNING id`,
      [accountId, this.name, this.fixture.cls, JSON.stringify(this.fixture.appearance)],
    );
    this.characterId = character.rows[0]?.id;
    if (!this.characterId) throw new Error(`character create failed for geared bot ${this.index}`);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.wsUrl, { headers: { 'X-Forwarded-For': this.ip } });
      this.socket = socket;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(
        () => finish(new Error(`join timeout for geared bot ${this.index}`)),
        15_000,
      );
      socket.on('open', () =>
        socket.send(JSON.stringify(worldAuthMessage(this.token, this.characterId))),
      );
      socket.on('message', (data) => {
        const message = JSON.parse(String(data));
        if (message.t === 'hello') finish();
        else if (message.t === 'error') finish(new Error(message.error ?? 'world auth failed'));
      });
      socket.on('error', finish);
      socket.on('close', () => finish(new Error(`geared bot ${this.index} closed before hello`)));
    });
  }

  command(payload) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ t: 'cmd', ...payload }));
    }
  }

  async equip() {
    this.command({ cmd: 'dev_level', level: 20 });
    await sleep(150);
    this.socket.send(JSON.stringify({ t: 'chat', text: `/dev give ${this.fixture.weapon}` }));
    await sleep(250);
    this.command({ cmd: 'equip', item: this.fixture.weapon });
    await sleep(250);
    this.command({ cmd: 'change_weapon_skin', skin: this.fixture.skin });
    await sleep(150);
    this.command({ cmd: 'set_helm', hidden: this.fixture.helmHidden });
    await sleep(100);
  }

  place(center) {
    const position = gearedArrivalPosition(this.index, center);
    this.command({ cmd: 'dev_teleport', ...position });
  }

  async close() {
    const socket = this.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        socket.close();
        resolve();
      }, 1_000);
      socket.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ t: 'logout' }));
        } else {
          socket.close();
        }
      } catch {
        clearTimeout(timeout);
        resolve();
      }
    });
  }
}

export class GearedArrivalRoster {
  constructor({ serverUrl, databaseUrl, count = 20, runId = null }) {
    assertLoopbackUrl(serverUrl, 'SERVER_URL');
    assertLoopbackDatabaseUrl(databaseUrl);
    if (!Number.isInteger(count) || count <= 0 || count > 40)
      throw new Error('geared arrival roster count must be an integer from 1 to 40');
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.databaseUrl = databaseUrl;
    this.count = count;
    this.runId = letters(runId ?? `${Date.now().toString(36)}${process.pid.toString(36)}`).slice(
      -12,
    );
    this.fixtureSha256 = gearedArrivalFixtureSha256(count);
    this.observerUsername = `gpu_cam_${this.runId.slice(-10)}`;
    // Overwritten by prepare/placeAll with the spot actually used.
    this.center = GEARED_ARRIVAL_OBSERVER;
    const wsUrl = `${this.serverUrl.replace(/^http/, 'ws')}/ws`;
    this.bots = Array.from(
      { length: count },
      (_, index) =>
        new GearedArrivalBot({ index, runId: this.runId, serverUrl: this.serverUrl, wsUrl }),
    );
  }

  async prepare({ center = GEARED_ARRIVAL_OBSERVER } = {}) {
    this.center = center;
    this.db = new pg.Client({
      connectionString: this.databaseUrl,
      connectionTimeoutMillis: 5_000,
      query_timeout: DB_TIMEOUT_MS,
      statement_timeout: DB_TIMEOUT_MS,
      options: '-c lock_timeout=5000',
      application_name: 'woc_gpu_hitch_roster',
    });
    await this.db.connect();
    for (const bot of this.bots) {
      await bot.register(this.db);
      await bot.connect();
      await bot.equip();
      bot.place(center);
    }
    await sleep(2_000);
    return this;
  }

  placeAll(center = GEARED_ARRIVAL_OBSERVER) {
    this.center = center;
    for (const bot of this.bots) bot.place(center);
  }

  async close() {
    await Promise.all(this.bots.map((bot) => bot.close()));
    if (!this.db) return;
    try {
      // Accounts are deliberately unique per leg so browser/server caches do
      // not leak between A/B arms. Delete only this roster's exact identities;
      // account-owned characters, tokens, cosmetics and metrics cascade.
      const usernames = [...this.bots.map((bot) => bot.username), this.observerUsername];
      await this.db.query('DELETE FROM accounts WHERE username = ANY($1::text[])', [usernames]);
    } finally {
      await this.db.end();
    }
  }

  evidence() {
    return {
      kind: 'geared-arrival-v1',
      count: this.count,
      fixtureSha256: this.fixtureSha256,
      // The center the crowd was actually placed around, not the default: a
      // capture at --observer X,Z streams different content, and fixture
      // evidence that always named the default spot would describe a crowd
      // that is not the one measured.
      center: this.center,
    };
  }
}

export async function createGearedObserverFixture(serverUrl, runId) {
  assertLoopbackUrl(serverUrl, 'SERVER_URL');
  const token = letters(runId ?? `${Date.now().toString(36)}${process.pid.toString(36)}`).slice(
    -10,
  );
  const username = `gpu_cam_${token}`;
  const registration = await post(
    serverUrl.replace(/\/+$/, ''),
    '/api/register',
    { username, password: 'hunter22', email: `${username}@example.com` },
    undefined,
    '172.19.31.1',
  );
  if (!registration.body.token) throw new Error('geared observer registration failed');
  return {
    username,
    token: registration.body.token,
    characterName: `Gcam${token}`,
  };
}
