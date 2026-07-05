// End-to-end check for the shareable player-card + referral feature against a
// REAL running server + Postgres (no mocks). Live counterpart to the CI unit
// tests in tests/player_card_server.test.ts (which mock pg).
//
// Usage:
//   npm run db:up          # Postgres on :5433
//   npm run server         # game server on :8787 (reads .env / DATABASE_URL)
//   node scripts/player_card_e2e.mjs
//   WOC_E2E_BASE=https://realm.example node scripts/player_card_e2e.mjs
//
// Exercises: publish a card → OG page + card.png → auth gate → register via
// ?ref → referral count reflects it. Exits non-zero on any failure.
const BASE = process.env.WOC_E2E_BASE ?? 'http://127.0.0.1:8787';
const checks = [];
const check = (name, cond) => {
  checks.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
};

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const register = async (u, ref) =>
  (
    await api('/api/register', {
      method: 'POST',
      body: { username: u, password: 'test1234', ref, email: `${u}@example.com` },
    })
  ).data.token;

// A unique letters-only character name (server rule: ^[A-Za-z][A-Za-z' -]{1,15}$).
function randomName() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let s = 'C';
  for (let i = 0; i < 9; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

// A tiny but signature-valid PNG (8-byte magic + filler). The server validates
// the magic, then stores/serves the bytes verbatim.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
]);

async function uploadCard(token, characterId, bytes = PNG) {
  const res = await fetch(`${BASE}/api/card?character=${characterId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` },
    body: bytes,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const stamp = Date.now();
const tokenA = await register('cardA' + stamp);
const name = randomName();
const created = await api('/api/characters', {
  method: 'POST',
  token: tokenA,
  body: { name, class: 'paladin', skin: 0 },
});
check('create character -> 200', created.status === 200);
const characterId = created.data.id;
const slug = name.toLowerCase();

check(
  'unauthenticated card upload -> 401',
  (
    await fetch(`${BASE}/api/card?character=${characterId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PNG,
    })
  ).status === 401,
);

const up = await uploadCard(tokenA, characterId);
check(
  'publish card -> 200 + name slug',
  up.status === 200 && up.data.url === `/p/${slug}` && up.data.ref === slug,
);

check(
  'reject non-PNG body -> 400',
  (await uploadCard(tokenA, characterId, new Uint8Array([1, 2, 3, 4]))).status === 400,
);
check(
  'upload for a foreign character -> 404',
  (await uploadCard(tokenA, 999999999)).status === 404,
);

const pageRes = await fetch(`${BASE}/p/${slug}`);
const pageHtml = await pageRes.text();
check(
  'GET /p/<slug> -> 200 html',
  pageRes.status === 200 && pageRes.headers.get('content-type')?.includes('text/html'),
);
check(
  'OG page references the card image',
  pageHtml.includes(`/p/${slug}/card.png`) && pageHtml.includes('twitter:card'),
);
check('OG page CTA carries the referral', pageHtml.includes(`/?ref=${slug}`));

const imgRes = await fetch(`${BASE}/p/${slug}/card.png`);
const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
check(
  'GET /p/<slug>/card.png -> 200 image/png',
  imgRes.status === 200 && imgRes.headers.get('content-type') === 'image/png',
);
check(
  'card.png round-trips the stored bytes',
  imgBytes.length === PNG.length && imgBytes[0] === 0x89 && imgBytes[1] === 0x50,
);

check(
  'GET /p/<unknown> -> 404',
  (await fetch(`${BASE}/p/this-card-does-not-exist`)).status === 404,
);
check('GET /p/<invalid slug> -> 404', (await fetch(`${BASE}/p/..%2f..%2fetc`)).status === 404);

// Referral capture: a brand-new account that registers via ?ref=<slug>.
const before = await api('/api/referrals', { token: tokenA });
check(
  'referrals start at zero',
  before.status === 200 && before.data.count === 0 && before.data.slug === slug,
);
await register('cardB' + stamp, slug);
const after = await api('/api/referrals', { token: tokenA });
check(
  'referral is captured for the card owner',
  after.data.count === 1 && after.data.slug === slug,
);

// A self-referral must not inflate the count.
const selfBefore = (await api('/api/referrals', { token: tokenA })).data.count;
// (the owner can't re-register, but an unknown ref or self-ref is silently ignored server-side)
await register('cardC' + stamp, 'totally-unknown-slug');
const selfAfter = (await api('/api/referrals', { token: tokenA })).data.count;
check('unknown ref does not credit anyone', selfAfter === selfBefore);

// Realm standing endpoint (drives the card's "Top N%" chip).
const st = await api(`/api/characters/${characterId}/standing`, { token: tokenA });
check(
  'standing -> 200 with rank/total',
  st.status === 200 &&
    typeof st.data.rank === 'number' &&
    st.data.rank >= 1 &&
    typeof st.data.total === 'number' &&
    st.data.total >= 1,
);
check(
  'standing without a token -> 401',
  (await fetch(`${BASE}/api/characters/${characterId}/standing`)).status === 401,
);
check(
  'standing for a foreign/nonexistent character -> 404',
  (await api('/api/characters/999999999/standing', { token: tokenA })).status === 404,
);

// Real two-character slug collision: two distinct names that slugify identically
// (space vs hyphen) — the second must fall back to an id-suffixed slug.
const cbase = 'Clash' + randomName().slice(1, 6); // letters only
const expectClash = `${cbase}-zy`.toLowerCase();
const cx = await api('/api/characters', {
  method: 'POST',
  token: tokenA,
  body: { name: `${cbase} Zy`, class: 'mage', skin: 0 },
});
const cy = await api('/api/characters', {
  method: 'POST',
  token: tokenA,
  body: { name: `${cbase}-Zy`, class: 'rogue', skin: 0 },
});
check('collision chars created', cx.status === 200 && cy.status === 200);
const px = await uploadCard(tokenA, cx.data.id);
const py = await uploadCard(tokenA, cy.data.id);
check('first of a slug collision keeps the clean slug', px.data.ref === expectClash);
check(
  'second of a slug collision gets an id-suffixed slug',
  py.data.ref === `${expectClash}-${cy.data.id}`,
);

const passed = checks.filter((c) => c.ok).length;
console.log(`\n${passed}/${checks.length} checks passed`);
if (passed !== checks.length) process.exit(1);
console.log('PASS player-card e2e passed against', BASE);
