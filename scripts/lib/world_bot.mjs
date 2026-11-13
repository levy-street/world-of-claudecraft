// A scripted player over the real server's REST + WebSocket world protocol,
// for raid playtests driven from Node (scripts/heart_council_raid.mjs). It
// logs in (or registers) a reusable account, picks or creates its character,
// authenticates the world socket and keeps a merged mirror of what the server
// sends: the self record, the interest-scoped entities and the event stream.
//
// The merge follows the wire's own rules (server/game.ts broadcast):
//   - heavy self fields ride only when they changed (absent: unchanged);
//   - an entity's identity fields ride only in full records ("lite" records
//     inherit them), ids in `keep` are alive but unchanged, anything absent
//     from both left interest;
//   - on the stable timer wire (the real browser client's handshake) a record
//     without `auras` keeps the auras it had (only a change re-sends them).
//
// Node only (ws). No game logic here: the AI lives in the caller.

import WebSocket from 'ws';
import { chatCommandMessage, worldAuthMessage } from './world_auth.mjs';

// The stable timer wire version the browser client advertises
// (src/net/snapshot_timer_wire.ts STABLE_TIMER_WIRE_VERSION).
const STABLE_TIMER_WIRE = 3;

// Self fields the server sends only when their serialized form changed.
const DELTA_SELF_KEYS = [
  'inv',
  'equip',
  'qlog',
  'qdone',
  'cds',
  'ncd',
  'stats',
  'weapon',
  'offhandWeapon',
  'party',
  'trade',
  'duel',
  'marks',
  'corpse',
  'df',
  'de',
];
const ENTITY_IDENTITY_KEYS = ['k', 'tid', 'nm', 'lv', 'sc', 'c', 'dgn', 'eq', 'cat', 'sk'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Under the chat lane (4 a second) and the chat ladder (a burst of 5, one
// every 3 s after it), with a margin.
const CHAT_GAP_MS = 300;
const CHAT_BURST = 4;
const CHAT_REFILL = 1 / 3.4;

/** Merge one entity record onto the previous one per the wire's rules. */
function mergeRecord(prev, next, stable) {
  if (prev && next.k === undefined) {
    for (const key of ENTITY_IDENTITY_KEYS)
      if (key in prev && !(key in next)) next[key] = prev[key];
  }
  if (stable && prev && !('auras' in next) && prev.auras) next.auras = prev.auras;
  return next;
}

export class WorldBot {
  /**
   * @param {{ base: string, username: string, password: string, name: string,
   *   cls: string, stableTimerWire?: boolean, onFrame?: (raw: string) => void }} o
   */
  constructor(o) {
    this.base = o.base;
    this.wsBase = o.base.replace(/^http/, 'ws');
    this.username = o.username;
    this.password = o.password;
    this.name = o.name;
    this.cls = o.cls;
    this.stable = o.stableTimerWire === true;
    this.onFrame = o.onFrame ?? null;
    this.pid = -1;
    this.self = null;
    this.ents = new Map();
    this.events = [];
    this.errors = [];
    this.snaps = 0;
    this.lastInput = '';
    this.lastInputAt = 0;
    this.closed = false;
    this.chatQueue = [];
    this.chatTimer = null;
    this.chatTokens = CHAT_BURST;
    this.chatRefill = Date.now() / 1000;
  }

  async api(method, path, body) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(this.base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      // The auth routes share a per-IP minute window: wait it out.
      if (res.status === 429) {
        await sleep(8000);
        continue;
      }
      return { status: res.status, body: json };
    }
    throw new Error(`${path}: still rate limited`);
  }

  /** Log in (or register once), then pick this bot's character (create it
   *  the first time). Returns the character's real name. */
  async login() {
    let auth = await this.api('POST', '/api/login', {
      username: this.username,
      password: this.password,
    });
    if (auth.status !== 200 || !auth.body.token) {
      auth = await this.api('POST', '/api/register', {
        username: this.username,
        password: this.password,
        email: `${this.username}@example.com`,
      });
    }
    if (!auth.body.token) throw new Error(`${this.username}: ${JSON.stringify(auth.body)}`);
    this.token = auth.body.token;
    const list = await this.api('GET', '/api/characters');
    const chars = Array.isArray(list.body) ? list.body : (list.body.characters ?? []);
    const mine = chars.find((c) => c.class === this.cls);
    if (mine) {
      this.charId = mine.id;
      this.name = mine.name;
      return this.name;
    }
    for (const suffix of ['', 'a', 'o', 'e', 'yn', 'ar']) {
      const made = await this.api('POST', '/api/characters', {
        name: this.name + suffix,
        class: this.cls,
      });
      if (made.body.id) {
        this.charId = made.body.id;
        this.name = this.name + suffix;
        return this.name;
      }
    }
    throw new Error(`${this.username}: could not create a ${this.cls}`);
  }

  /** Open the world socket and wait for the hello. A character whose last
   *  socket died without a logout stays in the world until the server's
   *  linkdead grace runs out (server/linkdead.ts, five minutes): wait it out. */
  async connect() {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.connectOnce();
        return;
      } catch (err) {
        if (!/already in world/.test(String(err?.message)) || attempt >= 36) throw err;
        if (attempt === 0)
          console.log(`${this.name}: still in the world from an old socket, waiting`);
        await sleep(10000);
      }
    }
  }

  async connectOnce() {
    // The browser client's timer handshake (src/net/world_auth_message.ts):
    // the snapshot then carries auras the way the real client receives them.
    const authExtra = this.stable ? { timerWire: STABLE_TIMER_WIRE } : {};
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${this.wsBase}/ws`);
      const to = setTimeout(() => reject(new Error(`${this.name}: join timeout`)), 15000);
      this.ws.on('open', () =>
        this.ws.send(
          JSON.stringify({ ...worldAuthMessage(this.token, this.charId), ...authExtra }),
        ),
      );
      this.ws.on('message', (data) => {
        const raw = String(data);
        if (this.onFrame) this.onFrame(raw);
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (msg.t === 'hello') {
          this.pid = msg.pid;
          clearTimeout(to);
          resolve();
        } else if (msg.t === 'snap') this.applySnap(msg);
        else if (msg.t === 'events') this.events.push(...msg.list);
        else if (msg.t === 'error' && this.pid < 0) {
          clearTimeout(to);
          this.ws.close();
          reject(new Error(`${this.name}: ${msg.error ?? msg.text ?? 'refused'}`));
        } else if (msg.t === 'error' || msg.t === 'kick') {
          this.errors.push(msg);
          if (msg.t === 'kick') reject(new Error(`${this.name}: kicked ${JSON.stringify(msg)}`));
        }
      });
      this.ws.on('close', () => {
        this.closed = true;
      });
      this.ws.on('error', reject);
    });
  }

  applySnap(msg) {
    this.snaps++;
    const prevSelf = this.self;
    const self = msg.self;
    if (prevSelf) {
      for (const k of DELTA_SELF_KEYS) if (!(k in self) && k in prevSelf) self[k] = prevSelf[k];
      if (this.stable && !('auras' in self) && prevSelf.auras) self.auras = prevSelf.auras;
    }
    this.self = self;
    const next = new Map();
    for (const w of msg.ents) next.set(w.id, mergeRecord(this.ents.get(w.id), w, this.stable));
    for (const id of msg.keep ?? []) {
      const prev = this.ents.get(id);
      if (prev) next.set(id, prev);
    }
    next.set(self.id, self);
    this.ents = next;
  }

  /** Take and clear the events received since the last call. */
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }
  cmd(payload) {
    this.send({ t: 'cmd', ...payload });
  }
  /** Chat (and every /dev line) pays the server's chat ladder
   *  (server/chat_rate_limit.ts: a burst of 5, then one every 3 s, and
   *  repeated overruns lock chat for 20 s): lines are queued and paced under
   *  it so none is dropped. */
  chat(text) {
    this.chatQueue.push(text);
    if (this.chatTimer) return;
    const pump = () => {
      if (this.chatQueue.length === 0) {
        this.chatTimer = null;
        return;
      }
      const now = Date.now() / 1000;
      this.chatTokens = Math.min(
        CHAT_BURST,
        this.chatTokens + (now - this.chatRefill) * CHAT_REFILL,
      );
      this.chatRefill = now;
      if (this.chatTokens < 1) {
        this.chatTimer = setTimeout(
          pump,
          Math.ceil(((1 - this.chatTokens) / CHAT_REFILL) * 1000) + 30,
        );
        return;
      }
      this.chatTokens -= 1;
      this.send(chatCommandMessage(this.chatQueue.shift()));
      this.chatTimer = setTimeout(pump, CHAT_GAP_MS);
    };
    pump();
  }
  /** Resolves once every queued chat line has gone out. */
  async chatFlushed() {
    while (this.chatQueue.length > 0 || this.chatTimer) await sleep(50);
  }
  /** Movement intent. The server drops a held key after 0.75 s without a
   *  frame (server/game.ts STALE_INPUT_SECONDS), so a moving intent is
   *  re-sent every quarter second; an unchanged standing frame is not. */
  input(mi = {}, facing) {
    const key = `${JSON.stringify(mi)}|${facing === undefined ? '' : facing.toFixed(2)}`;
    const moving = Object.keys(mi).length > 0;
    const now = Date.now();
    if (key === this.lastInput && (!moving || now - this.lastInputAt < 250)) return;
    this.lastInput = key;
    this.lastInputAt = now;
    this.send({ t: 'input', mi, ...(facing !== undefined ? { facing } : {}) });
  }
  stop(facing) {
    this.input({}, facing);
  }

  get alive() {
    return !!this.self && !this.self.dead;
  }
  pos() {
    return this.self ? { x: this.self.x, z: this.self.z } : { x: 0, z: 0 };
  }
  dist(o) {
    const p = this.pos();
    return Math.hypot(o.x - p.x, o.z - p.z);
  }
  faceTo(o) {
    const p = this.pos();
    return Math.atan2(o.x - p.x, o.z - p.z);
  }
  hasAura(id, e = this.self) {
    return !!e?.auras?.some((a) => a.id === id);
  }

  close() {
    try {
      this.send({ t: 'logout' });
      this.ws?.close();
    } catch {
      // already gone
    }
  }
}
