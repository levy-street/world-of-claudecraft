// End-to-end proof of the Devs-portal contribution-XP write-back against a LIVE
// WOC server: register -> create character -> join/leave (persist state) -> write
// an out-of-game XP grant -> join (server awards it through the sim on load) ->
// leave (persist) -> assert lifetime XP rose by the grant, and a re-join does not
// double-apply. Mirrors how the Devs portal grants contribution XP.
//
//   BASE=http://localhost:8787 DB=postgres://eastbrook:eastbrook@127.0.0.1:5436/eastbrook \
//     node scripts/e2e-devs-character-grant.mjs
import WebSocket from 'ws';
import pg from 'pg';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const WS_URL = `${BASE.replace(/^http/, 'ws')}/ws`;
const DB = process.env.DB ?? process.env.DATABASE_URL ?? 'postgres://eastbrook:eastbrook@127.0.0.1:5436/eastbrook';
const GRANT_XP = Number(process.env.GRANT_XP ?? 750);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
}

// Join, wait for `hello`, hold briefly so the server applies pending grants, then
// close (which persists state via leave()).
function playSession(token, characterId, holdMs = 1200) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { origin: BASE } });
    const fail = (e) => { try { ws.close(); } catch {} reject(e); };
    const timer = setTimeout(() => fail(new Error('ws join timeout')), 10_000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', token, character: characterId })));
    ws.once('message', (data) => {
      clearTimeout(timer);
      const msg = JSON.parse(String(data));
      if (msg.t === 'error') return fail(new Error(`join rejected: ${msg.error}`));
      setTimeout(() => ws.close(), holdMs); // joined; hold so grants apply, then leave saves
    });
    ws.on('close', () => resolve());
    ws.on('error', fail);
  });
}

const db = new pg.Client({ connectionString: DB });
async function lifetimeXp(characterId) {
  const r = await db.query(`SELECT COALESCE((state->>'lifetimeXp')::bigint, 0) AS lxp FROM characters WHERE id = $1`, [characterId]);
  return Number(r.rows[0]?.lxp ?? 0);
}

async function main() {
  await db.connect();
  const suffix = String(Date.now()).slice(-7);
  const username = `wbtest_${suffix}`;
  const charName = `Wb${suffix.split('').map((d) => 'abcdefghij'[Number(d)]).join('')}`;

  console.log(`1. register ${username}`);
  const { token } = await api('/api/register', { method: 'POST', body: JSON.stringify({ username, password: 'test-password' }) });

  console.log(`2. create mage "${charName}"`);
  const character = await api('/api/characters', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ name: charName, class: 'mage' }) });
  const charId = character.id;
  const acct = await db.query('SELECT account_id FROM characters WHERE id = $1', [charId]);
  const accountId = acct.rows[0].account_id;

  console.log('3. join + leave to persist initial state');
  await playSession(token, charId, 400);
  await sleep(400);
  const xp0 = await lifetimeXp(charId);
  console.log(`   xp0 = ${xp0}`);

  console.log(`4. write a ${GRANT_XP}-XP grant (as the Devs portal would)`);
  await db.query(`INSERT INTO character_grants (account_id, character_id, kind, amount, reason) VALUES ($1, $2, 'xp', $3, 'e2e:devs-contribution')`, [accountId, charId, GRANT_XP]);

  console.log('5. join -> server awards the grant through the sim -> leave persists');
  await playSession(token, charId);
  await sleep(500);
  const xp1 = await lifetimeXp(charId);
  const applied = await db.query(`SELECT applied_at FROM character_grants WHERE character_id = $1 ORDER BY id DESC LIMIT 1`, [charId]);
  console.log(`   xp1 = ${xp1} (applied_at=${applied.rows[0]?.applied_at ? 'set' : 'NULL'})`);

  console.log('6. idempotency: re-join must not double-apply');
  await playSession(token, charId);
  await sleep(500);
  const xp2 = await lifetimeXp(charId);

  const grew = xp1 - xp0;
  const pass = grew === GRANT_XP && xp2 === xp1 && !!applied.rows[0]?.applied_at;
  console.log('\n--- RESULT ---');
  console.log(`xp0=${xp0}  +grant ${GRANT_XP}  -> xp1=${xp1}  (Δ=${grew}, expected ${GRANT_XP})`);
  console.log(`re-join xp2=${xp2} (no double-apply)`);
  console.log(pass ? 'PASS ✓ — contribution XP applied in-game via the sim, idempotent' : 'FAIL ✗');
  await db.end();
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => { console.error('E2E ERROR:', e.message); await db.end().catch(() => {}); process.exit(1); });
