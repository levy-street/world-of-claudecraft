// Chat-log persistence e2e against a running game server and Postgres.
// Verifies accepted channel types are written to chat_logs and rejected chat
// commands are not persisted.
import { Client as PgClient } from 'pg';
import WebSocket from 'ws';

const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

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

class Client {
  constructor() {
    this.events = [];
    this.pid = -1;
  }

  connect(token, characterId) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`);
      const to = setTimeout(() => reject(new Error('connect timeout')), 8000);
      this.ws.on('message', (data) => {
        const msg = JSON.parse(String(data));
        if (msg.t === 'hello') {
          this.pid = msg.pid;
          clearTimeout(to);
          resolve();
        } else if (msg.t === 'events') {
          this.events.push(...msg.list);
        }
      });
      this.ws.on('open', () =>
        this.ws.send(JSON.stringify({ t: 'auth', token, character: characterId })),
      );
      this.ws.on('error', reject);
    });
  }

  cmd(p) {
    this.ws.send(JSON.stringify({ t: 'cmd', ...p }));
  }

  close() {
    this.ws?.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).slice(-6);
const nameA = `Loga${alpha}`;
const nameB = `Logb${alpha}`;

async function main() {
  const pg = new PgClient({ connectionString: DATABASE_URL });
  await pg.connect();

  const r1 = await api('/api/register', {
    username: `clog_${uniq}_a`,
    password: 'hunter22',
    email: `clog_${uniq}_a@example.com`,
  });
  const r2 = await api('/api/register', {
    username: `clog_${uniq}_b`,
    password: 'hunter22',
    email: `clog_${uniq}_b@example.com`,
  });
  check('registered accounts', r1.status === 200 && r2.status === 200);

  const c1 = await api('/api/characters', { name: nameA, class: 'warrior' }, r1.body.token);
  const c2 = await api('/api/characters', { name: nameB, class: 'mage' }, r2.body.token);
  check('created characters', c1.status === 200 && c2.status === 200);

  const a = new Client();
  const b = new Client();
  await a.connect(r1.body.token, c1.body.id);
  await b.connect(r2.body.token, c2.body.id);

  a.cmd({ cmd: 'chat', text: 'log say' });
  a.cmd({ cmd: 'chat', text: '/y log yell' });
  a.cmd({ cmd: 'chat', text: '/g log general' });
  a.cmd({ cmd: 'chat', text: `/w ${nameB} log whisper` });
  a.cmd({ cmd: 'pinvite', id: b.pid });
  await sleep(300);
  b.cmd({ cmd: 'paccept' });
  await sleep(300);
  a.cmd({ cmd: 'chat', text: '/p log party' });
  a.cmd({ cmd: 'chat', text: '/dance log bad command' });
  a.cmd({ cmd: 'chat', text: '/w Nobodyxyz log bad whisper' });

  // The production logger flushes every 5s under normal volume.
  await sleep(6500);

  const rows = await pg.query(
    `SELECT character_name, channel, message
     FROM chat_logs
     WHERE character_name = $1
     ORDER BY id`,
    [nameA],
  );
  const actual = rows.rows.map((r) => ({ channel: r.channel, message: r.message }));
  const expected = [
    { channel: 'say', message: 'log say' },
    { channel: 'yell', message: 'log yell' },
    { channel: 'general', message: 'log general' },
    { channel: 'whisper', message: 'log whisper' },
    { channel: 'party', message: 'log party' },
  ];

  check(
    'persisted accepted channel rows',
    JSON.stringify(actual) === JSON.stringify(expected),
    JSON.stringify(actual),
  );
  check('did not persist bad command text', !actual.some((r) => r.message.includes('bad command')));
  check('did not persist bad whisper text', !actual.some((r) => r.message.includes('bad whisper')));

  a.close();
  b.close();
  await pg.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
