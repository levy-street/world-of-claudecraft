// Trade + duel over the real wire: two bots trade items/copper atomically,
// then duel to first-blood (1hp), verifying winner/loser and no deaths.
import WebSocket from 'ws';

const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
const uniq = Date.now().toString(36);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).slice(-5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0,
  fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`OK   ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${extra}`);
  }
};

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

// heavy self fields (inventory, quests, party, ...) arrive only when they
// changed; an absent field means "same as the previous snapshot"
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

class Bot {
  constructor(name, cls) {
    this.name = name;
    this.cls = cls;
    this.self = null;
    this.events = [];
  }
  async join() {
    const reg = await api('/api/register', {
      username: `soc_${this.name}_${uniq}`,
      password: 'hunter22',
      email: `soc_${this.name}_${uniq}@example.com`,
    });
    const char = await api(
      '/api/characters',
      { name: this.name + alpha, class: this.cls },
      reg.body.token,
    );
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`);
      const to = setTimeout(() => reject(new Error('timeout')), 8000);
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ t: 'auth', token: reg.body.token, character: char.body.id }));
      });
      this.ws.on('message', (data) => {
        const msg = JSON.parse(String(data));
        if (msg.t === 'hello') {
          this.pid = msg.pid;
          clearTimeout(to);
          resolve();
        } else if (msg.t === 'snap') this.self = mergeSelf(this.self, msg.self);
        else if (msg.t === 'events') this.events.push(...msg.list);
      });
      this.ws.on('error', reject);
    });
  }
  cmd(p) {
    this.ws.send(JSON.stringify({ t: 'cmd', ...p }));
  }
  input(mi, facing) {
    this.ws.send(JSON.stringify({ t: 'input', mi, ...(facing !== undefined ? { facing } : {}) }));
  }
}

async function main() {
  const a = new Bot('Trader', 'warrior');
  const b = new Bot('Buyer', 'mage');
  await a.join();
  await b.join();
  a.cmd({ cmd: 'dev_teleport', x: 0, z: -40 });
  b.cmd({ cmd: 'dev_teleport', x: 3, z: -40 });
  a.cmd({ cmd: 'dev_give', item: 'wolf_fang', count: 3 });
  b.cmd({ cmd: 'dev_give', item: 'baked_bread', count: 2 });
  await sleep(500);

  // ---- trade ----
  a.cmd({ cmd: 'trade_req', id: b.pid });
  await sleep(300);
  check(
    'B received trade request',
    b.events.some((e) => e.type === 'tradeRequest'),
  );
  b.cmd({ cmd: 'trade_accept' });
  await sleep(300);
  check('trade window open on both', a.self?.trade && b.self?.trade);
  a.cmd({ cmd: 'trade_offer', items: [{ itemId: 'wolf_fang', count: 2 }], copper: 0 });
  b.cmd({ cmd: 'trade_offer', items: [{ itemId: 'baked_bread', count: 1 }], copper: 0 });
  await sleep(300);
  check(
    'offers visible to the other side',
    a.self?.trade?.theirOffer?.items?.[0]?.itemId === 'baked_bread' &&
      b.self?.trade?.theirOffer?.items?.[0]?.itemId === 'wolf_fang',
  );
  a.cmd({ cmd: 'trade_confirm' });
  b.cmd({ cmd: 'trade_confirm' });
  await sleep(400);
  const aFangs = a.self?.inv?.find((s) => s.itemId === 'wolf_fang')?.count ?? 0;
  const bFangs = b.self?.inv?.find((s) => s.itemId === 'wolf_fang')?.count ?? 0;
  const aBread = a.self?.inv?.find((s) => s.itemId === 'baked_bread')?.count ?? 0;
  check(
    'items swapped atomically',
    aFangs === 1 && bFangs === 2 && aBread === 1,
    `aFangs=${aFangs} bFangs=${bFangs} aBread=${aBread}`,
  );
  check('trade closed', !a.self?.trade && !b.self?.trade);

  // ---- duel ----
  a.cmd({ cmd: 'duel_req', id: b.pid });
  await sleep(300);
  check(
    'B received duel challenge',
    b.events.some((e) => e.type === 'duelRequest'),
  );
  b.cmd({ cmd: 'duel_accept' });
  await sleep(300);
  check('duel countdown started', a.self?.duel?.state === 'countdown');
  await sleep(3500);
  check('duel active', a.self?.duel?.state === 'active');
  // A beats on B until first blood
  let ended = false;
  for (let i = 0; i < 120 && !ended; i++) {
    const facing = Math.atan2(
      (b.self?.x ?? 0) - (a.self?.x ?? 0),
      (b.self?.z ?? 0) - (a.self?.z ?? 0),
    );
    const d = Math.hypot((b.self?.x ?? 0) - (a.self?.x ?? 0), (b.self?.z ?? 0) - (a.self?.z ?? 0));
    if (d > 4) a.input({ f: 1 }, facing);
    else {
      a.input({}, facing);
      a.cmd({ cmd: 'target', id: b.pid });
      a.cmd({ cmd: 'attack' });
    }
    ended = a.events.some((e) => e.type === 'duelEnd');
    await sleep(250);
  }
  const endEvent = a.events.find((e) => e.type === 'duelEnd');
  check(
    'duel ended with a winner',
    !!endEvent && endEvent.winnerName.startsWith('Trader'),
    JSON.stringify(endEvent),
  );
  check('loser survives at >= 1 hp', (b.self?.hp ?? 0) >= 1 && !b.self?.dead, `hp=${b.self?.hp}`);

  a.ws.close();
  b.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
