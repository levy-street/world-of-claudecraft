// Phase A: mint the accounts, characters, guilds and STOCKED guild banks.
// The server loads every guild bank ONCE at boot (GameServer.loadGuildBanks), so
// a guild seeded into a running server has no live book and its pane never
// mounts. Seed here, restart the server, then measure.
import fs from 'node:fs';
import pg from 'pg';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';

const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8787';
// This tool mints accounts and characters and writes guild rows straight into
// Postgres, so it is a LOCAL dev instrument only: refuse anything but a
// loopback target before a single request or query goes out.
assertLoopbackUrl(SERVER_URL, 'SERVER_URL');
assertLoopbackDatabaseUrl(process.env.DATABASE_URL);
const uniq = Date.now()
  .toString(36)
  .replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)])
  .slice(-6);
async function api(path, body, token) {
  const res = await fetch(SERVER_URL + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const out = [];
for (const [tag, w] of [
  ['a', 740],
  ['b', 844],
]) {
  const user = `gp${uniq}${tag}`;
  const charName = `G${tag}${uniq}`.slice(0, 12);
  const reg = await api('/api/register', {
    username: user,
    password: 'hunter22',
    email: `${user}@example.com`,
  });
  if (!reg.body.token) throw new Error(`register: ${JSON.stringify(reg.body)}`);
  const ch = await api('/api/characters', { name: charName, class: 'warrior' }, reg.body.token);
  if (!ch.body.id) throw new Error(`character: ${JSON.stringify(ch.body)}`);
  const realm =
    (await pool.query('SELECT realm FROM characters WHERE id=$1', [ch.body.id])).rows[0]?.realm ??
    'Claudemoon';
  const gname = `Bank QA ${tag === 'a' ? 'Alpha' : 'Beta'} ${uniq}`;
  const g = await pool.query('INSERT INTO guilds (name, realm) VALUES ($1,$2) RETURNING id', [
    gname,
    realm,
  ]);
  const guildId = g.rows[0].id;
  await pool.query(
    `INSERT INTO guild_members (character_id, guild_id, rank) VALUES ($1,$2,'leader')
    ON CONFLICT (character_id) DO UPDATE SET guild_id=EXCLUDED.guild_id, rank='leader'`,
    [ch.body.id, guildId],
  );
  const inventory = [
    ['wolf_fang', 12],
    ['iron_ore', 40],
    ['linen_cloth', 30],
    ['copper_ore', 25],
    ['boar_hide', 18],
    ['ashwood_log', 22],
    ['bone_fragments', 15],
    ['arcane_dust', 9],
    ['iron_sword', 1],
    ['baked_bread', 20],
    ['amber_hide', 14],
    ['blessed_wax', 7],
    ['chunk_of_ore', 33],
    ['duskwisp_essence', 5],
    ['canopy_silk_hank', 11],
  ].map(([itemId, count]) => ({ itemId, count }));
  await pool.query('INSERT INTO guild_banks (guild_id, realm, data) VALUES ($1,$2,$3)', [
    guildId,
    realm,
    JSON.stringify({ treasury: 987654, purchasedSlots: 90, inventory }),
  ]);
  out.push({
    tag,
    width: w,
    user,
    charName,
    guildId,
    guildName: gname,
    characterId: ch.body.id,
    realm,
  });
  console.log(
    `seeded ${user} / ${charName} -> guild ${guildId} (${gname}) with ${inventory.length} stacks`,
  );
}
await pool.end();
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync('tmp/bank_guild_pane_state.json', JSON.stringify(out, null, 2));
console.log('wrote tmp/bank_guild_pane_state.json; RESTART the server, then measure');
