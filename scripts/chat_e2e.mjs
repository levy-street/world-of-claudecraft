// Chat-channel e2e against a running game server (+ postgres).
// Requires ALLOW_DEV_COMMANDS=1 on the server (dev_teleport positions the
// two clients at exact distances for the range checks).
import WebSocket from 'ws';

const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
let pass = 0,
  fail = 0;

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
  return res.json();
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
        } else if (msg.t === 'events') this.events.push(...msg.list);
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
  chats() {
    return this.events.filter((e) => e.type === 'chat');
  }
  clear() {
    this.events = [];
  }
  close() {
    this.ws?.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).slice(-6);
async function chat(client, text) {
  client.cmd({ cmd: 'chat', text });
  // The live server enforces the production chat bucket even in local dev.
  // Pace scripted assertions so rate limiting never masks routing behavior.
  await sleep(3200);
}

async function main() {
  const r1 = await api('/api/register', {
    username: `chat_${uniq}_a`,
    password: 'hunter22',
    email: `chat_${uniq}_a@example.com`,
  });
  const r2 = await api('/api/register', {
    username: `chat_${uniq}_b`,
    password: 'hunter22',
    email: `chat_${uniq}_b@example.com`,
  });
  const c1 = await api('/api/characters', { name: `Saya${alpha}`, class: 'warrior' }, r1.token);
  const c2 = await api('/api/characters', { name: `Heara${alpha}`, class: 'mage' }, r2.token);
  const a = new Client();
  const b = new Client();
  await a.connect(r1.token, c1.id);
  await b.connect(r2.token, c2.id);

  // co-located: bare text is /say and B hears it (with speaker entity id)
  a.cmd({ cmd: 'dev_teleport', x: 50, z: -40 });
  b.cmd({ cmd: 'dev_teleport', x: 55, z: -40 });
  await sleep(300);
  b.clear();
  a.clear();
  await chat(a, 'hello neighbor');
  let got = b.chats().find((e) => e.text === 'hello neighbor');
  check('say heard in range', !!got && got.channel === 'say' && got.entityId === a.pid);
  check(
    'speaker hears own say',
    a.chats().some((e) => e.text === 'hello neighbor'),
  );

  // B walks out of say range (25) but stays within yell range (100)
  b.cmd({ cmd: 'dev_teleport', x: 110, z: -40 });
  await sleep(300);
  b.clear();
  a.clear();
  await chat(a, 'too far for say');
  await chat(a, '/y YELLING NOW');
  check('say not heard out of range', !b.chats().some((e) => e.text === 'too far for say'));
  got = b.chats().find((e) => e.text === 'YELLING NOW');
  check('yell heard at 60 units', !!got && got.channel === 'yell');

  // B leaves yell range; /general still reaches everyone
  b.cmd({ cmd: 'dev_teleport', x: 60, z: -900 });
  await sleep(300);
  b.clear();
  a.clear();
  await chat(a, '/y nobody hears this');
  await chat(a, '/general world news');
  check('yell not heard across the world', !b.chats().some((e) => e.text === 'nobody hears this'));
  got = b.chats().find((e) => e.text === 'world news');
  check('general reaches everyone', !!got && got.channel === 'general');

  // whisper: routed to the target only, echo to the sender, third parties blind
  b.clear();
  a.clear();
  await chat(a, `/w Heara${alpha} psst`);
  got = b.chats().find((e) => e.channel === 'whisper');
  check(
    'whisper reaches target across the world',
    !!got && got.text === 'psst' && got.from === `Saya${alpha}`,
  );
  const echo = a.chats().find((e) => e.channel === 'whisper');
  check('sender gets whisper echo with to-name', !!echo && echo.to === `Heara${alpha}`);

  // unknown whisper target and unknown command produce errors, not chat
  a.clear();
  await chat(a, '/w Nobodyxyz hi');
  await chat(a, '/definitelynotacommand');
  check(
    'unknown whisper target errors',
    a.events.some((e) => e.type === 'error' && e.text.includes('Nobodyxyz')),
  );
  check(
    'unknown command errors',
    a.events.some((e) => e.type === 'error' && e.text.includes('/definitelynotacommand')),
  );
  check('no chat leaked for bad commands', a.chats().length === 0);

  a.close();
  b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
