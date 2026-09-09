// Live-server E2E for the operator KICK-then-CLEAR-then-RETRY flow: the
// stamped-legendary-name remediation runbook in DEPLOY.md, driven end to end
// against a real server, a real Postgres, and the real audited endpoint
// POST /admin/api/moderation/characters/:id/clear-item-name.
//
// WHY THIS EXISTS. The semantics are already modelled twice, and neither model
// runs the flow. tests/server/clear_item_name.test.ts drives the pure core over
// hand-written ports; tests/server/admin.test.ts drives the RouteDef with a
// stubbed runtime; tests/character_save_statement_pg_integration.test.ts drives
// the unleased fence against real Postgres with no server above it. What none of
// them exercises is the sequence an operator actually performs, where the
// refusals are produced by a live session and the retry lands because a real
// kick released a real lease. That handoff (kick -> session leaves -> lease
// releases -> the fenced UPDATE finally touches a row) is the part with moving
// pieces, and it is the part with no coverage.
//
// WHAT IT ASSERTS, in the operator's own order:
//   1. CLEAR BEFORE KICK is refused, by the online check, before any audit write
//      ('character is online on this realm; disconnect them first').
//   2. The permission is superadmin-only: a moderator-role token is refused at
//      the central gate, never by the handler.
//   3. KICK through the real moderation surface (the dashboard sanction the
//      runbook names), which revokes tokens and disconnects the live session.
//   4. RETRY lands. The first retry may still answer the lease line
//      ('character holds a live session lease; kick them (or wait out the lease)
//      and retry') because the kicked session releases its lease only after its
//      leave flush; that answer is the documented retry line, not a failure, so
//      the script retries and requires a landing within the bound.
//   5. The strip is audited (the endpoint reports ok + a cleared count).
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - the dev Postgres up (npm run db:up)
//   - a server on SERVER_URL (e.g. PORT=8791 npm run server)
//
// Usage:
//   SERVER_URL=http://127.0.0.1:8791 node scripts/kick_clear_retry_e2e.mjs
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import WebSocket from 'ws';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';
import { worldAuthMessage } from './lib/world_auth.mjs';

const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8791';
const WS_BASE = SERVER_URL.replace(/^http/, 'ws');

// This script registers accounts and grants a STAFF role, so every target it
// touches must be loopback (the mob_stall_repro.mjs policy): the HTTP server it
// sanctions accounts through AND the database grant_admin.mjs connects to.
assertLoopbackUrl(SERVER_URL, 'SERVER_URL');
try {
  process.loadEnvFile?.();
} catch {
  // .env is optional; the guard below still sees a directly-passed value.
}
assertLoopbackDatabaseUrl(process.env.DATABASE_URL);

// The exact operator-facing lines, pinned as literals here rather than imported:
// this is a black-box E2E over HTTP, so importing the server's own constant
// would let a reworded refusal pass while the operator's runbook went stale.
const ONLINE_REFUSAL = 'character is online on this realm; disconnect them first';
const LEASE_RETRY_LINE =
  'character holds a live session lease; kick them (or wait out the lease) and retry';
const RACE_RETRY_LINE = 'character came online before the strip landed; kick them and retry';
const PERMISSION_REFUSAL = 'you do not have permission to do this';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const check = (name, condition, extra = '') => {
  if (condition) {
    console.log(`ok   ${name}`);
    return true;
  }
  failures.push(name);
  console.error(`FAIL ${name}${extra ? ` -- ${extra}` : ''}`);
  return false;
};

async function api(path, body, token, method = 'POST') {
  const res = await fetch(SERVER_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const uniq = Date.now().toString(36).slice(-6);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);

// ---------------------------------------------------------------------------
// The account under remediation, with one character to strip.
// ---------------------------------------------------------------------------
const targetUser = `kcrtarget${uniq}`;
const reg = await api('/api/register', {
  username: targetUser,
  password: 'hunter22',
  email: `${targetUser}@example.com`,
});
if (!reg.body.token) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
const char = await api(
  '/api/characters',
  { name: `Kcr${alpha}`.slice(0, 12), class: 'warrior' },
  reg.body.token,
);
if (!char.body.id) throw new Error(`character create failed: ${JSON.stringify(char.body)}`);
const characterId = char.body.id;
const accountId = reg.body.accountId ?? reg.body.account?.id ?? null;

// ---------------------------------------------------------------------------
// Stage the thing being remediated: one bagged copy carrying a stamped
// ItemInstancePayload.name. Seeded straight into the persisted blob, the way
// admin_guild_bank_shot.mjs seeds its stuck book, because the real route to a
// stamped name is a deed-earned Perfecting promotion and this E2E is about the
// OPERATOR flow, not about earning one. The strip reads the persisted blob
// (loadCharacter -> stripLegendaryNames walks state.inventory[].instance), so a
// seeded name is the same input a promoted copy leaves behind.
//
// Seeded BEFORE the character joins: a live session would overwrite the blob on
// its next autosave, which is the very doctrine the endpoint's offline rule
// exists to protect.
// ---------------------------------------------------------------------------
const STAMPED_NAME = 'E2E Remediation Target';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
{
  const read = await pool.query('SELECT state FROM characters WHERE id = $1', [characterId]);
  const state = read.rows[0]?.state;
  if (!state) throw new Error(`character ${characterId} has no persisted state to seed`);
  const inventory = Array.isArray(state.inventory) ? [...state.inventory] : [];
  inventory[0] = {
    itemId: 'sword_iron',
    count: 1,
    instance: { name: STAMPED_NAME, perfected: true, boundTo: characterId },
  };
  await pool.query('UPDATE characters SET state = $2 WHERE id = $1', [
    characterId,
    { ...state, inventory },
  ]);
  console.log(`seeded a stamped name on character ${characterId} bag slot 0`);
}

// ---------------------------------------------------------------------------
// Two operators: a superadmin (holds moderation.clearItemName) and a moderator
// (must NOT), so arm 2 proves the gate rather than assuming it.
// ---------------------------------------------------------------------------
async function makeOperator(username, roles) {
  await api('/api/register', {
    username,
    password: 'hunter22-op',
    email: `${username}@example.com`,
  });
  execFileSync(
    'node',
    ['scripts/grant_admin.mjs', username, ...(roles ? ['--roles', roles] : [])],
    { stdio: 'inherit' },
  );
  const login = await api('/admin/api/login', { username, password: 'hunter22-op' });
  const token = login.body?.data?.token;
  if (!token) throw new Error(`admin login failed for ${username}: ${JSON.stringify(login.body)}`);
  return token;
}
const superToken = await makeOperator(`kcrsuper${uniq}`, null);
const modToken = await makeOperator(`kcrmod${uniq}`, 'moderator');

const clearItemName = (token, body) =>
  api(`/admin/api/moderation/characters/${characterId}/clear-item-name`, body, token);

// ---------------------------------------------------------------------------
// Bring the character ONLINE: this is what makes arm 1 a real refusal rather
// than a hand-set flag, and what makes the lease in arm 4 a real lease.
// ---------------------------------------------------------------------------
const ws = new WebSocket(`${WS_BASE}/ws`);
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('ws join timeout')), 20000);
  ws.on('open', () => ws.send(JSON.stringify(worldAuthMessage(reg.body.token, characterId))));
  ws.on('message', (data) => {
    if (JSON.parse(String(data)).t === 'hello') {
      clearTimeout(to);
      resolve();
    }
  });
  ws.on('error', reject);
});
let socketClosed = false;
ws.on('close', () => {
  socketClosed = true;
});
console.log(`character ${characterId} joined the world`);
await sleep(600); // let join register the session on the online map

// ---------------------------------------------------------------------------
// ARM 1: CLEAR BEFORE KICK is refused.
// ---------------------------------------------------------------------------
const online = await clearItemName(superToken, { all: true, reason: 'e2e: clear before kick' });
check(
  'arm 1: clear is refused while the character is online',
  online.status === 400 && online.body?.error === ONLINE_REFUSAL,
  `status=${online.status} body=${JSON.stringify(online.body)}`,
);

// ---------------------------------------------------------------------------
// ARM 2: the permission is superadmin-only, refused at the central gate.
// A moderator token must be refused for the PERMISSION, not for the online
// state, so this asserts the gate's own line rather than any 4xx.
// ---------------------------------------------------------------------------
const gated = await clearItemName(modToken, { all: true, reason: 'e2e: moderator attempt' });
check(
  'arm 2: a moderator-role token is refused by the permission gate',
  gated.status === 403 && String(gated.body?.error ?? '').includes(PERMISSION_REFUSAL),
  `status=${gated.status} body=${JSON.stringify(gated.body)}`,
);

// ---------------------------------------------------------------------------
// ARM 3: the KICK, through the real moderation surface.
// ---------------------------------------------------------------------------
if (accountId === null) {
  console.error('FAIL arm 3: register did not report an account id to sanction');
  failures.push('arm 3: account id');
} else {
  // A suspension needs a future expiry (server/moderation_db.ts moderateAccount);
  // an hour is plenty to hold the session off while the strip lands, and this is
  // a disposable local account.
  const suspend = await api(
    `/admin/api/moderation/accounts/${accountId}/suspend`,
    {
      reason: 'e2e: kick before clear',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    superToken,
  );
  check(
    'arm 3: the moderation sanction is accepted',
    suspend.status === 200,
    `status=${suspend.status} body=${JSON.stringify(suspend.body)}`,
  );
  // The sanction revokes tokens AND disconnects the live session; wait for the
  // socket to actually close rather than assuming the push landed, so a silent
  // no-op kick fails here instead of being read as a lease problem later.
  for (let i = 0; i < 40 && !socketClosed; i++) await sleep(250);
  check('arm 3: the live session was disconnected by the sanction', socketClosed);
}

// ---------------------------------------------------------------------------
// ARM 4 + 5: the RETRY lands, and the lease line is the only answer allowed
// while it has not.
// ---------------------------------------------------------------------------
let landed = null;
let sawRetryLine = false;
let lastAnswer = null;
for (let attempt = 1; attempt <= 40; attempt++) {
  const res = await clearItemName(superToken, { all: true, reason: 'e2e: clear after kick' });
  lastAnswer = res;
  if (res.status === 200 && res.body?.data?.ok === true) {
    landed = { attempt, cleared: res.body.data.cleared };
    break;
  }
  const error = String(res.body?.error ?? '');
  // Only the two documented retry lines may stand between the kick and the
  // landing. Anything else (still ONLINE after a kick, a not-found, a schema
  // rejection) is a real defect and must not be waited out.
  if (error === LEASE_RETRY_LINE || error === RACE_RETRY_LINE) {
    sawRetryLine = true;
    await sleep(500);
    continue;
  }
  break;
}
check(
  'arm 4: the clear lands after the kick',
  landed !== null,
  `last answer status=${lastAnswer?.status} body=${JSON.stringify(lastAnswer?.body)}`,
);
if (landed) {
  console.log(
    `clear landed on attempt ${landed.attempt} (cleared=${landed.cleared}` +
      `${sawRetryLine ? ', after the documented lease retry line' : ', first try'})`,
  );
  check(
    'arm 5: the endpoint reports the seeded copy as cleared',
    landed.cleared === 1,
    `cleared=${JSON.stringify(landed.cleared)} (one seeded name was staged)`,
  );
}

// The endpoint's word is not the proof: read the persisted blob back and require
// the stamped name to be gone. This is what separates a strip that LANDED from a
// strip the fence silently swallowed while the endpoint still answered ok.
if (landed) {
  const after = await pool.query('SELECT state FROM characters WHERE id = $1', [characterId]);
  const blob = JSON.stringify(after.rows[0]?.state ?? {});
  check(
    'arm 5: the stamped name is gone from the persisted blob',
    !blob.includes(STAMPED_NAME),
    'the endpoint reported a landing but the name is still persisted',
  );
  // The promotion itself must survive: the endpoint deletes ONLY the name.
  check(
    'arm 5: the strip left the promotion itself intact',
    blob.includes('"perfected":true'),
    'the strip removed more than the name',
  );
}

// A repeated clear after the strip answers "nothing matched" rather than a
// second success. That distinction is what lets an operator who is unsure the
// step landed re-run it and read the answer, so it is pinned rather than
// assumed to be idempotent-silent.
if (landed) {
  const again = await clearItemName(superToken, { all: true, reason: 'e2e: repeat after strip' });
  check(
    'arm 5: a repeated clear reports that nothing matched',
    again.status === 400 && again.body?.error === 'no named copy matched that target',
    `status=${again.status} body=${JSON.stringify(again.body)}`,
  );
}

await pool.end();

try {
  ws.close();
} catch {
  // Already closed by the sanction; nothing to do.
}

console.log(`\n${failures.length} failure(s).`);
if (failures.length) {
  for (const name of failures) console.error(`  - ${name}`);
}
process.exit(failures.length > 0 ? 1 : 0);
