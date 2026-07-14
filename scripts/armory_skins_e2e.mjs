// Season 1 Armory end-to-end integration: register, credit Claudium (direct
// dev-DB ledger insert; there is deliberately no free-grant API), buy a skin
// through the real /api/claudium/spend proxy, apply/detach it with the
// change_weapon_skin command, and verify a SECOND client sees the skin on the
// wire (terse wsk identity field), ownership is enforced server-side, the
// equipped-weapon-type gate holds, and everything survives a reconnect.
//
// Needs: npm run server (game), the economy service on :8798 with the Season 1
// catalog, and the dev Postgres. Override the game with SERVER_URL=.
import process from 'node:process';
import pg from 'pg';
import WebSocket from 'ws';

process.loadEnvFile?.();
const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`OK   ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${extra}`);
  }
}

async function api(path, opts = {}, token = null) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const DELTA_SELF_KEYS = ['inv', 'equip', 'qlog', 'qdone', 'cds', 'stats', 'weapon', 'cosmetics'];
function mergeSelf(prev, next) {
  if (prev) for (const k of DELTA_SELF_KEYS) if (!(k in next)) next[k] = prev[k];
  return next;
}

const ENTITY_IDENTITY_KEYS = ['k', 'tid', 'nm', 'lv', 'sc', 'c', 'dgn', 'sk', 'mh', 'wsk', 'eq'];
function mergeEnts(prevEnts, snap) {
  const next = new Map();
  for (const w of snap.ents) {
    const prev = prevEnts.get(w.id);
    if (prev && w.k === undefined) {
      for (const key of ENTITY_IDENTITY_KEYS) if (key in prev) w[key] = prev[key];
    }
    next.set(w.id, w);
  }
  for (const id of snap.keep ?? []) {
    const prev = prevEnts.get(id);
    if (prev) next.set(id, prev);
  }
  return next;
}

class Client {
  constructor() {
    this.self = null;
    this.pid = -1;
    this.entities = new Map();
  }

  connect(token, characterId) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`);
      const timeout = setTimeout(() => reject(new Error('connect timeout')), 8000);
      this.ws.on('open', () => {
        this.send({ t: 'auth', token, character: characterId });
      });
      this.ws.on('message', (data) => {
        const msg = JSON.parse(String(data));
        if (msg.t === 'hello') {
          this.pid = msg.pid;
          clearTimeout(timeout);
          resolve(msg);
        } else if (msg.t === 'snap') {
          this.self = mergeSelf(this.self, msg.self);
          this.entities = mergeEnts(this.entities, msg);
        } else if (msg.t === 'error') {
          clearTimeout(timeout);
          reject(new Error(msg.error));
        }
      });
      this.ws.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  cmd(payload) {
    this.send({ t: 'cmd', ...payload });
  }
  close() {
    this.ws?.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000, step = 150) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(step);
  }
  return fn();
}

const uniq = Date.now().toString(36);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).slice(-6);

async function main() {
  const status = await api('/api/status');
  check('server status', status.status === 200 && status.body.ok);

  // Accounts + characters (warrior starts holding worn_sword).
  const u1 = `armorya_${uniq}`;
  const u2 = `armoryb_${uniq}`;
  const r1 = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username: u1, password: 'hunter22', email: `${u1}@example.com` }),
  });
  const r2 = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username: u2, password: 'hunter22', email: `${u2}@example.com` }),
  });
  check('register accounts', r1.status === 200 && r2.status === 200);
  const t1 = r1.body.token;
  const t2 = r2.body.token;
  const c1 = await api(
    '/api/characters',
    { method: 'POST', body: JSON.stringify({ name: `Solha${alpha}`, class: 'warrior' }) },
    t1,
  );
  const c2 = await api(
    '/api/characters',
    { method: 'POST', body: JSON.stringify({ name: `Watchb${alpha}`, class: 'warrior' }) },
    t2,
  );
  check('create characters', c1.status === 200 && c2.status === 200);

  // Dev-only Claudium credit: append a positive ledger row directly (the
  // service computes balance as SUM(delta); there is no free-grant endpoint).
  const accountA = r1.body.accountId ?? r1.body.account?.id ?? null;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let accId = accountA;
  if (!accId) {
    const row = await db.query('SELECT id FROM accounts WHERE username = $1', [u1]);
    accId = row.rows[0]?.id;
  }
  check('resolved account id', Number.isInteger(accId), String(accId));
  await db.query(
    `INSERT INTO claudium_ledger (account_id, delta, reason, ref, idempotency_key, at_ms)
     VALUES ($1, 10000, 'purchase', 'e2e-credit', $2, $3)`,
    [accId, `e2e-credit-${uniq}`, Date.now()],
  );

  // Store + balance through the game proxy.
  const bal = await api('/api/claudium/balance', {}, t1);
  check('balance shows the credit', bal.body.balance === 10000, JSON.stringify(bal.body));
  const store = await api('/api/claudium/store', {}, t1);
  const items = store.body.items ?? [];
  check('store lists 39 SKUs', items.length === 39, `got ${items.length}`);
  const ice = items.find((i) => i.itemId === 'ice_fang_sword');
  check('Ice Fang SKU (skin, 3000)', ice?.kind === 'skin' && ice?.costClaudium === 3000);

  // Buy two skins: a sword (matches the warrior's worn_sword) and an axe.
  const spend1 = await api(
    '/api/claudium/spend',
    {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'ice_fang_sword',
        kind: 'skin',
        idempotencyKey: `k1-${uniq}`,
      }),
    },
    t1,
  );
  check('buy ice_fang_sword', spend1.body.granted === true, JSON.stringify(spend1.body));
  const replay = await api(
    '/api/claudium/spend',
    {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'ice_fang_sword',
        kind: 'skin',
        idempotencyKey: `k1-${uniq}`,
      }),
    },
    t1,
  );
  check(
    'idempotent replay never double-debits',
    replay.body.balance === spend1.body.balance,
    JSON.stringify(replay.body),
  );
  const spend2 = await api(
    '/api/claudium/spend',
    {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'glaciersplit_axe',
        kind: 'skin',
        idempotencyKey: `k2-${uniq}`,
      }),
    },
    t1,
  );
  check('buy glaciersplit_axe', spend2.body.granted === true, JSON.stringify(spend2.body));
  const store2 = await api('/api/claudium/store', {}, t1);
  check(
    'store marks both owned',
    ['ice_fang_sword', 'glaciersplit_axe'].every(
      (id) => store2.body.items?.find((i) => i.itemId === id)?.owned === true,
    ),
  );

  // Enter the world; ownership must arrive in the self cosmetics snapshot.
  const a = new Client();
  await a.connect(t1, c1.body.id);
  const ownedInSnap = await until(
    () =>
      a.self?.cosmetics?.weaponSkinIds?.includes('ice_fang_sword') &&
      a.self?.cosmetics?.weaponSkinIds?.includes('glaciersplit_axe'),
  );
  check('account cosmetics reach the client', !!ownedInSnap, JSON.stringify(a.self?.cosmetics));

  const b = new Client();
  await b.connect(t2, c2.body.id);
  const seesA = await until(() => [...b.entities.values()].find((e) => e.id === a.pid));
  check('client B sees A', !!seesA);

  // Apply the sword skin: B must see wsk on A's entity.
  a.cmd({ cmd: 'change_weapon_skin', skin: 'ice_fang_sword', wtype: 'sword' });
  const wskOnB = await until(() => b.entities.get(a.pid)?.wsk === 'ice_fang_sword');
  check('B sees A wearing Ice Fang (wire wsk)', !!wskOnB, String(b.entities.get(a.pid)?.wsk));
  const loadoutInSnap = await until(
    () => a.self?.cosmetics?.weaponSkinLoadout?.sword === 'ice_fang_sword',
  );
  check('loadout persists to account cosmetics', !!loadoutInSnap);

  // Equipped-type gate: the axe skin cannot apply while holding a sword.
  a.cmd({ cmd: 'change_weapon_skin', skin: 'glaciersplit_axe', wtype: 'axe' });
  await sleep(800);
  check(
    'axe skin refused while a sword is equipped',
    b.entities.get(a.pid)?.wsk === 'ice_fang_sword' &&
      a.self?.cosmetics?.weaponSkinLoadout?.axe === undefined,
  );

  // Ownership gate: B owns nothing, a forged apply must no-op.
  b.cmd({ cmd: 'change_weapon_skin', skin: 'solheim_sword', wtype: 'sword' });
  await sleep(800);
  const bEntityOnA = a.entities.get(b.pid);
  check(
    'forged apply without ownership no-ops',
    (bEntityOnA?.wsk ?? null) === null &&
      (b.self?.cosmetics?.weaponSkinLoadout?.sword ?? null) === null,
  );

  // Detach: wsk leaves the wire.
  a.cmd({ cmd: 'change_weapon_skin', skin: null, wtype: 'sword' });
  const detached = await until(() => (b.entities.get(a.pid)?.wsk ?? null) === null);
  check('detach clears the wire', !!detached, String(b.entities.get(a.pid)?.wsk));

  // Re-apply, then reconnect: the applied skin must come back from the account.
  a.cmd({ cmd: 'change_weapon_skin', skin: 'ice_fang_sword', wtype: 'sword' });
  await until(() => b.entities.get(a.pid)?.wsk === 'ice_fang_sword');
  a.close();
  await sleep(1200);
  const a2 = new Client();
  await a2.connect(t1, c1.body.id);
  const backOnB = await until(() => b.entities.get(a2.pid)?.wsk === 'ice_fang_sword', 9000);
  check('applied skin survives reconnect (account-wide seed)', !!backOnB);

  a2.close();
  b.close();
  await db.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E crashed:', err);
  process.exit(1);
});
