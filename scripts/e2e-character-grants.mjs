// End-to-end test of the character_grants enabler against a LIVE World of
// Claudecraft server: register -> create character -> join (persist state) ->
// write a grant -> join again -> assert the grant applied to the character's XP.
//
// Drives the real REST + WebSocket API and reads the real Postgres. The grant
// is written by the same idempotent SQL the companion dashboard uses, so this
// exercises the full out-of-game -> in-game write-back path.
//
//   BASE=http://localhost:8787 DB=postgres://eastbrook:eastbrook@127.0.0.1:5436/eastbrook \
//     node scripts/e2e-character-grants.mjs
import WebSocket from "ws";
import pg from "pg";

const BASE = process.env.BASE ?? "http://localhost:8787";
const WS_URL = `${BASE.replace(/^http/, "ws")}/ws`;
// Same database the server uses; override with DB=... for a non-default setup.
const DB = process.env.DATABASE_URL ?? process.env.DB ?? "postgres://eastbrook:eastbrook@127.0.0.1:5433/eastbrook";
const GRANT_XP = Number(process.env.GRANT_XP ?? 40);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
}

// Connect, authenticate, wait until the server confirms the join (first frame
// after auth is `hello`), then disconnect. The server applies pending grants
// during auth (before `hello`) and persists state on close.
function playSession(token, characterId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const fail = (e) => { try { ws.close(); } catch {} reject(e); };
    const timer = setTimeout(() => fail(new Error("ws join timeout")), 10_000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "auth", token, character: characterId })));
    ws.once("message", (data) => {
      clearTimeout(timer);
      const msg = JSON.parse(String(data));
      if (msg.t === "error") return fail(new Error(`join rejected: ${msg.error}`));
      // joined (msg.t === 'hello'); close to trigger the server-side save
      ws.close();
    });
    ws.on("close", () => resolve());
    ws.on("error", fail);
  });
}

async function waitFor(fn, label, attempts = 30, gapMs = 200) {
  for (let i = 0; i < attempts; i++) {
    const v = await fn();
    if (v !== null && v !== undefined) return v;
    await sleep(gapMs);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const db = new pg.Client({ connectionString: DB });

async function charXp(characterId) {
  const r = await db.query(`SELECT (state->>'xp')::bigint AS xp, state IS NOT NULL AS has_state FROM characters WHERE id = $1`, [characterId]);
  return r.rows[0] ?? null;
}

async function main() {
  await db.connect();
  const suffix = String(Date.now()).slice(-7);
  const username = `grant_e2e_${suffix}`;
  // Character names are letters-only (validCharName); map the unique digits to letters.
  const letters = suffix.split("").map((d) => "abcdefghij"[Number(d)]).join("");
  const charName = `Grant${letters}`; // e.g. "Grantgdcijhc", <= 16 chars

  console.log(`1. register ${username}`);
  const { token } = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "test-password" }),
  });

  console.log(`2. create mage "${charName}"`);
  const character = await api("/api/characters", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: charName, class: "mage" }),
  });
  const charId = character.id;
  const acct = await db.query(`SELECT account_id FROM characters WHERE id = $1`, [charId]);
  const accountId = acct.rows[0].account_id;
  console.log(`   characterId=${charId} accountId=${accountId}`);

  console.log("3. join + leave to persist initial state");
  await playSession(token, charId);
  const before = await waitFor(async () => {
    const row = await charXp(charId);
    return row?.has_state ? row : null;
  }, "initial state persisted");
  const xp0 = Number(before.xp ?? 0);
  console.log(`   persisted xp0 = ${xp0}`);

  console.log(`4. write a ${GRANT_XP}-XP grant (idempotent on source_key)`);
  const sourceKey = `e2e:${suffix}`;
  const ins = await db.query(
    `INSERT INTO character_grants (account_id, character_id, kind, amount, reason, source_key)
     VALUES ($1, $2, 'xp', $3, $4, $5)
     ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [accountId, charId, GRANT_XP, "e2e contribution reward", sourceKey],
  );
  console.log(`   grant rows written: ${ins.rowCount}`);

  console.log("5. log in again -> server applies the grant on join");
  await playSession(token, charId);
  const applied = await waitFor(async () => {
    const r = await db.query(`SELECT applied_at FROM character_grants WHERE source_key = $1`, [sourceKey]);
    return r.rows[0]?.applied_at ? r.rows[0] : null;
  }, "grant applied_at stamped");

  const after = await charXp(charId);
  const xp1 = Number(after.xp ?? 0);
  console.log(`   applied xp1 = ${xp1} (applied_at=${applied.applied_at.toISOString?.() ?? applied.applied_at})`);

  console.log("6. idempotency: re-applying must not double-credit");
  await playSession(token, charId);
  const xp2 = Number((await charXp(charId)).xp ?? 0);

  const expected = xp0 + GRANT_XP;
  const pass = xp1 === expected && xp2 === expected;
  console.log("\n--- RESULT ---");
  console.log(`xp0=${xp0}  +grant ${GRANT_XP}  -> xp1=${xp1}  (expected ${expected})`);
  console.log(`re-login xp2=${xp2} (no double-credit)`);
  console.log(pass ? "PASS ✓ — grant applied in-game, idempotent" : "FAIL ✗");

  await db.end();
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => {
  console.error("E2E ERROR:", e.message);
  await db.end().catch(() => {});
  process.exit(1);
});
