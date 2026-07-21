// E2E smoke: exercises the whole delegation flow - registration, weighted
// routing, metering, settlement idempotency, kill switch, revocation, house
// fallback - against a running stack. DESTRUCTIVE: wipes pool tables first,
// so point it at a scratch database only.
//
//   node scripts/mock_venice.mjs &        # mock upstream on :4567
//   npm run dev                           # with .env pointing at :4567
//   npx tsx scripts/e2e_smoke.mts         # from services/diem-pool/
process.loadEnvFile('.env');

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PrismaClient } from '@prisma/client';

const BASE = 'http://127.0.0.1:3100';
const SECRET = process.env.INTERNAL_SHARED_SECRET!;
const ADMIN = process.env.ADMIN_TOKEN!;
const prisma = new PrismaClient();

// Re-runnable: clear pool state (not pricing) and the settlement outbox.
await prisma.$transaction([
  prisma.usageEvent.deleteMany(),
  prisma.rewardLedger.deleteMany(),
  prisma.providerDailySpend.deleteMany(),
  prisma.providerNonce.deleteMany(),
  prisma.settlementRun.deleteMany(),
  prisma.provider.deleteMany(),
  prisma.systemConfig.deleteMany(),
]);
const { Redis } = await import('ioredis');

/** Reset rate-limit windows (fixed windows persist across smoke runs). */
async function clearRateLimits(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL!);
  const rlKeys = await redis.keys('rl:*');
  if (rlKeys.length) await redis.del(...rlKeys);
  redis.disconnect();
}

{
  const { Queue } = await import('bullmq');
  const q = new Queue('settlement-events', { connection: { url: process.env.REDIS_URL } as any });
  await q.obliterate({ force: true }).catch(() => {});
  await q.close();
  await clearRateLimits();
}

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  [ok] ${name}`);
  else {
    failures++;
    console.error(`  [fail] ${name}`, detail ?? '');
  }
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

function makeWallet() {
  const kp = nacl.sign.keyPair();
  return { wallet: bs58.encode(kp.publicKey), secretKey: kp.secretKey };
}

async function signNonce(
  wallet: string,
  secretKey: Uint8Array,
  purpose: 'register' | 'revoke',
  vendor?: string,
) {
  const n = await api('/api/providers/nonce', {
    method: 'POST',
    body: JSON.stringify({ walletAddress: wallet, purpose, ...(vendor ? { vendor } : {}) }),
  });
  check(`nonce issued (${purpose})`, n.status === 200, n.body);
  const sig = nacl.sign.detached(new TextEncoder().encode(n.body.message), secretKey);
  return { nonce: n.body.nonce as string, signedMessage: bs58.encode(sig) };
}

/** Register a key for any vendor, on fresh or existing wallet creds. */
async function registerWith(
  creds: { wallet: string; secretKey: Uint8Array } | null,
  name: string,
  vendor: string,
  apiKey: string,
  budget: { declaredDiem?: number; dailyBudgetUsd?: number },
) {
  const c = creds ?? makeWallet();
  const { nonce, signedMessage } = await signNonce(c.wallet, c.secretKey, 'register', vendor);
  const res = await api('/api/providers/register', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress: c.wallet,
      signedMessage,
      nonce,
      vendor,
      veniceApiKey: apiKey,
      displayName: name,
      ...budget,
    }),
  });
  check(
    `${name} (${vendor}) registered`,
    res.status === 200 && res.body.vendor === vendor && res.body.keyLast4 === apiKey.slice(-4),
    res.body,
  );
  return { wallet: c.wallet, secretKey: c.secretKey, id: res.body.id as string, body: res.body };
}

async function register(name: string, diem: number, apiKey: string) {
  const { wallet, secretKey } = makeWallet();
  const { nonce, signedMessage } = await signNonce(wallet, secretKey, 'register');
  const res = await api('/api/providers/register', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress: wallet,
      signedMessage,
      nonce,
      veniceApiKey: apiKey,
      displayName: name,
      declaredDiem: diem,
    }),
  });
  check(`${name} registered`, res.status === 200 && res.body.keyLast4 === apiKey.slice(-4), res.body);
  return { wallet, secretKey, id: res.body.id as string };
}

async function infer(extra: Record<string, unknown> = {}) {
  return api('/api/internal/inference', {
    method: 'POST',
    headers: { 'x-internal-secret': SECRET },
    body: JSON.stringify({
      purpose: 'npc_dialogue',
      gameAccountId: 'acct_hero_1',
      payload: {
        model: 'llama-3.3-70b',
        messages: [{ role: 'user', content: 'Greet the traveler.' }],
        max_tokens: 128,
      },
      ...extra,
    }),
  });
}

console.log('- health endpoint -');
{
  const h = await api('/api/health');
  check('health: 200 with db+redis ok on a clean stack', h.status === 200 && h.body.db.ok && h.body.redis.ok, h.body);
}

console.log('- registration -');
const alpha = await register('Alpha Provider', 10, 'vn_alpha_key_0123456789abcdefgh');
const beta = await register('Beta Provider', 40, 'vn_beta_key_0123456789abcdefghi');

// Replay: reusing alpha's consumed nonce must fail.
{
  const { nonce, signedMessage } = await signNonce(alpha.wallet, alpha.secretKey, 'register');
  const first = await api('/api/providers/register', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress: alpha.wallet, signedMessage, nonce,
      veniceApiKey: 'vn_alpha_key_0123456789abcdefgh', displayName: 'Alpha Again', declaredDiem: 1,
    }),
  });
  check('re-register while ACTIVE rejected (409)', first.status === 409, first.body);
  const replay = await api('/api/providers/register', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress: alpha.wallet, signedMessage, nonce,
      veniceApiKey: 'vn_alpha_key_0123456789abcdefgh', displayName: 'Alpha Again', declaredDiem: 1,
    }),
  });
  check('nonce replay rejected (401)', replay.status === 401, replay.body);
}

// Invalid/unfunded keys must be rejected at registration.
{
  const { wallet, secretKey } = makeWallet();
  const { nonce, signedMessage } = await signNonce(wallet, secretKey, 'register');
  const res = await api('/api/providers/register', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress: wallet, signedMessage, nonce,
      veniceApiKey: 'vn_bad_key_0123456789abcdefghij', displayName: 'Sketchy', declaredDiem: 5,
    }),
  });
  check('invalid Venice key rejected (422)', res.status === 422, res.body);
}

console.log('- inference routing & metering -');
check('missing shared secret rejected', (await api('/api/internal/inference', { method: 'POST', body: '{}' })).status === 401);

const served: Record<string, number> = {};
for (let i = 0; i < 10; i++) {
  const res = await infer();
  check(`inference ${i} ok`, res.status === 200 && !!res.body?.choices, res.body);
  const pid = res.headers.get('x-pool-provider-id') ?? 'none';
  served[pid] = (served[pid] ?? 0) + 1;
}
check('both providers served traffic', (served[alpha.id] ?? 0) > 0 && (served[beta.id] ?? 0) > 0, served);
check('beta (4x capacity) served more', (served[beta.id] ?? 0) > (served[alpha.id] ?? 0), served);

// cost per call: 100 prompt @ $0.70/M + 50 completion @ $2.80/M = $0.00021
const stats = await api(`/api/providers/by-wallet/${beta.wallet}`);
check(
  'metering: beta todayConsumedUsd = calls × $0.00021',
  Math.abs(stats.body.keys?.[0]?.todayConsumedUsd - served[beta.id] * 0.00021) < 1e-9,
  stats.body,
);
check('no key material in stats', JSON.stringify(stats.body).includes('vn_beta') === false);

const lb = await api('/api/leaderboard');
check('leaderboard has 2 truncated-wallet entries',
  lb.body.leaderboard.length === 2 && lb.body.leaderboard.every((r: any) => r.wallet.includes('…')),
  lb.body);

console.log('- settlement (run as if the day ended) -');
const { runDailySettlement } = await import('../src/workers/settle');
const fakeTomorrow = new Date(Date.now() + 86_400_000);
await runDailySettlement(fakeTomorrow);
const ledger1 = await prisma.rewardLedger.findMany({ orderBy: { providerId: 'asc' } });
check('ledger rows written for both providers', ledger1.length === 2, ledger1.length);
check('rewards are positive Claudium', ledger1.every((r) => r.totalClaudium > 0));
check('streaks bumped', (await prisma.provider.count({ where: { consecutiveHealthyDays: 1 } })) === 2);

await runDailySettlement(fakeTomorrow); // idempotent re-run
const ledger2 = await prisma.rewardLedger.findMany({ orderBy: { providerId: 'asc' } });
check('re-run: no duplicate ledger rows', ledger2.length === 2);
check('re-run: totals unchanged',
  JSON.stringify(ledger2.map((r) => r.totalClaudium)) === JSON.stringify(ledger1.map((r) => r.totalClaudium)));
check('re-run: streaks NOT double-bumped', (await prisma.provider.count({ where: { consecutiveHealthyDays: 1 } })) === 2);

const { Queue } = await import('bullmq');
const q = new Queue('settlement-events', { connection: { url: process.env.REDIS_URL } as any });
const counts = await q.getJobCounts('waiting', 'completed', 'delayed');
check('settlement events emitted once per provider (deduped)', counts.waiting + counts.completed === 2, counts);
await q.close();

console.log('- kill switch -');
await api('/api/admin/killswitch', { method: 'POST', headers: { 'x-admin-token': ADMIN }, body: JSON.stringify({ paused: true }) });
check('paused routing returns 503', (await infer()).status === 503);
await api('/api/admin/killswitch', { method: 'POST', headers: { 'x-admin-token': ADMIN }, body: JSON.stringify({ paused: false }) });
check('resumed routing returns 200', (await infer()).status === 200);
check('admin without token rejected', (await api('/api/admin/overview')).status === 401);

console.log('- revocation & house fallback -');
{
  const { nonce, signedMessage } = await signNonce(alpha.wallet, alpha.secretKey, 'revoke');
  const res = await api(`/api/providers/${alpha.id}/key`, {
    method: 'DELETE',
    body: JSON.stringify({ signedMessage, nonce }),
  });
  check('alpha revoked', res.status === 200 && res.body.status === 'REVOKED', res.body);
  const row = await prisma.provider.findUnique({ where: { id: alpha.id } });
  check('alpha key wiped from DB', row?.encryptedKey === null && row?.keyLast4 === null);
}
{
  const { nonce, signedMessage } = await signNonce(beta.wallet, beta.secretKey, 'revoke');
  await api(`/api/providers/${beta.id}/key`, { method: 'DELETE', body: JSON.stringify({ signedMessage, nonce }) });
}
{
  const res = await infer();
  check('empty pool falls back to house key', res.status === 200 && res.headers.get('x-pool-house') === 'true', {
    status: res.status, house: res.headers.get('x-pool-house') });
  const houseEvents = await prisma.usageEvent.count({ where: { house: true } });
  check('house usage metered and tagged', houseEvents === 1, houseEvents);
}

const overview = await api('/api/admin/overview', { headers: { 'x-admin-token': ADMIN } });
check('admin overview reflects revocations', overview.body.statusCounts.REVOKED === 2, overview.body.statusCounts);

console.log('- failover & DEGRADED -');
await clearRateLimits();
// Flaky passes registration's 1-token validation, then 500s on real traffic.
// 10x capacity makes it the certain first pick for the next requests.
const good = await register('Good Provider', 10, 'vn_good_key_0123456789abcdefghi');
const flaky = await register('Flaky Provider', 100, 'vn_flaky_key_0123456789abcdefg');
for (const label of ['first', 'second'] as const) {
  const res = await infer();
  check(
    `${label} request survives flaky upstream via failover to good`,
    res.status === 200 && res.headers.get('x-pool-provider-id') === good.id,
    { status: res.status, provider: res.headers.get('x-pool-provider-id') },
  );
}
{
  const row = await prisma.provider.findUnique({ where: { id: flaky.id } });
  check(
    'flaky DEGRADED after 2 consecutive hard failures',
    row?.status === 'DEGRADED' && row.consecutiveFailures >= 2,
    { status: row?.status, failures: row?.consecutiveFailures },
  );
}

console.log('- concurrent metering exactness -');
const { utcDay } = await import('../src/lib/settlement');
const spendKey = { providerId_date: { providerId: good.id, date: utcDay(new Date()) } };
const spendBefore = await prisma.providerDailySpend.findUnique({ where: spendKey });
const burst = await Promise.all(Array.from({ length: 20 }, () => infer()));
check('all 20 concurrent requests succeeded', burst.every((r) => r.status === 200));
check(
  'all 20 routed to the sole ACTIVE provider',
  burst.every((r) => r.headers.get('x-pool-provider-id') === good.id),
);
{
  const spendAfter = await prisma.providerDailySpend.findUnique({ where: spendKey });
  const deltaUsd = Number(spendAfter!.spentUsd) - Number(spendBefore?.spentUsd ?? 0);
  const deltaReqs = (spendAfter?.requests ?? 0) - (spendBefore?.requests ?? 0);
  check('spend delta is exactly 20 × $0.00021 (atomic upsert)', Math.abs(deltaUsd - 20 * 0.00021) < 1e-9, deltaUsd);
  check('request counter delta is exactly 20', deltaReqs === 20, deltaReqs);
}

console.log('- multi-vendor (BYOK) registration -');
await clearRateLimits();
const oai = await registerWith(null, 'OpenAI Rig', 'openai', 'sk-oai-good-0123456789abcdefghij', { dailyBudgetUsd: 40 });
const anth = await registerWith(null, 'Anthropic Rig', 'anthropic', 'sk-ant-good-0123456789abcdefgh', { dailyBudgetUsd: 30 });
const kim = await registerWith(null, 'Kimi Rig', 'kimi', 'sk-kimi-good-0123456789abcdefg', { dailyBudgetUsd: 20 });
check('BYOK keys start at trust tier NEW', [oai, anth, kim].every((p) => p.body.trustTier === 'NEW'));
check(
  'wrong key shape rejected before validation (anthropic without sk-ant-)',
  (
    await (async () => {
      const c = makeWallet();
      const { nonce, signedMessage } = await signNonce(c.wallet, c.secretKey, 'register', 'anthropic');
      return api('/api/providers/register', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress: c.wallet, signedMessage, nonce, vendor: 'anthropic',
          veniceApiKey: 'sk-oai-shaped-0123456789abcdef', displayName: 'Wrong Shape', dailyBudgetUsd: 5,
        }),
      });
    })()
  ).status === 400,
);
await registerWith({ wallet: oai.wallet, secretKey: oai.secretKey }, 'OpenAI Rig Venice', 'venice', 'vn_oai_wallet_venice_0123456789', { declaredDiem: 3 });
{
  const multi = await api(`/api/providers/by-wallet/${oai.wallet}`);
  check('wallet holds one key per vendor', multi.body.keys?.length === 2, multi.body.keys?.length);
}

console.log('- model-class routing across vendors -');
const FAST_MODELS: Record<string, string> = {
  venice: 'llama-3.2-3b',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  kimi: 'moonshot-v1-8k',
};
{
  const vendorCounts: Record<string, number> = {};
  let modelsMatch = true;
  for (let i = 0; i < 30; i++) {
    const res = await infer({
      modelClass: 'fast',
      payload: { messages: [{ role: 'user', content: 'Greet the traveler.' }], max_tokens: 64 },
    });
    check(`fast-class inference ${i} ok`, res.status === 200, res.body);
    const vendor = res.headers.get('x-pool-vendor') ?? '';
    vendorCounts[vendor] = (vendorCounts[vendor] ?? 0) + 1;
    if ((res.body as { model?: string }).model !== FAST_MODELS[vendor]) modelsMatch = false;
  }
  check(
    'all four vendors served fast-class traffic',
    ['venice', 'openai', 'anthropic', 'kimi'].every((v) => (vendorCounts[v] ?? 0) >= 1),
    vendorCounts,
  );
  check('each vendor used its class-mapped concrete model', modelsMatch, vendorCounts);
}
{
  let pinnedOk = true;
  for (let i = 0; i < 6; i++) {
    const res = await infer({
      payload: { model: 'openai:gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    });
    if (res.status !== 200 || res.headers.get('x-pool-vendor') !== 'openai') pinnedOk = false;
  }
  check('"vendor:model" pins routing to that vendor', pinnedOk);
  const legacy = await infer({
    payload: { model: 'llama-3.3-70b', messages: [{ role: 'user', content: 'hi' }] },
  });
  check(
    'legacy bare model still routes to venice',
    legacy.status === 200 && legacy.headers.get('x-pool-vendor') === 'venice',
  );
}
{
  const res = await infer({
    payload: {
      model: 'anthropic:claude-sonnet-4-5',
      messages: [
        { role: 'system', content: 'You are the dungeon master.' },
        { role: 'user', content: 'Narrate the crypt.' },
      ],
    },
  });
  const body = res.body as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number } };
  check(
    'anthropic translation round-trips to OpenAI shape',
    res.status === 200 &&
      typeof body.choices?.[0]?.message?.content === 'string' &&
      body.choices[0].message.content.length > 0 &&
      body.usage?.prompt_tokens === 100,
    res.body,
  );
}

console.log('- BYOK quota exhaustion -');
await clearRateLimits();
const oaiQuota = await registerWith(null, 'Quota Rig', 'openai', 'sk-oai-quota-later-0123456789ab', { dailyBudgetUsd: 40 });
{
  let allOk = true;
  for (let i = 0; i < 6; i++) {
    const res = await infer({
      payload: { model: 'openai:gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    });
    if (res.status !== 200 || res.headers.get('x-pool-vendor') !== 'openai') allOk = false;
  }
  check('requests survive a quota-exhausted key via failover', allOk);
  const row = await prisma.provider.findUnique({ where: { id: oaiQuota.id } });
  const spend = await api(`/api/providers/by-wallet/${oaiQuota.wallet}`);
  check(
    'quota exhaustion pins spend to the trust-capped budget, status stays ACTIVE',
    row?.status === 'ACTIVE' && spend.body.keys?.[0]?.todayConsumedUsd === 2,
    { status: row?.status, spend: spend.body.keys?.[0]?.todayConsumedUsd },
  );
}

console.log('- per-vendor kill switch -');
{
  await api('/api/admin/vendors', {
    method: 'PUT',
    headers: { 'x-admin-token': ADMIN },
    body: JSON.stringify({ vendor: 'kimi', enabled: false }),
  });
  let kimiServed = 0;
  for (let i = 0; i < 10; i++) {
    const res = await infer({
      modelClass: 'fast',
      payload: { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
    });
    if (res.headers.get('x-pool-vendor') === 'kimi') kimiServed++;
  }
  check('disabled vendor receives no traffic', kimiServed === 0, kimiServed);
  const put = await api('/api/admin/vendors', {
    method: 'PUT',
    headers: { 'x-admin-token': ADMIN },
    body: JSON.stringify({ vendor: 'kimi', enabled: true }),
  });
  check('vendor re-enabled via admin API', put.status === 200 && put.body.enabled === true, put.body);
}

console.log('- vesting lifecycle & voiding -');
{
  const { runDailySettlement: settleAgain, runVesting } = await import('../src/workers/settle');
  const { Queue } = await import('bullmq');
  const evq = new Queue('settlement-events', { connection: { url: process.env.REDIS_URL } as any });
  const settleDay = utcDay(fakeTomorrow, 1);
  const dayStr = settleDay.toISOString().slice(0, 10);

  // The earlier section already settled today with venice-only providers;
  // clear that run so today's BYOK usage settles too (smoke owns this DB).
  await prisma.rewardLedger.deleteMany({ where: { date: settleDay } });
  await prisma.settlementRun.deleteMany({ where: { date: settleDay } });
  await settleAgain(fakeTomorrow);

  const byok = await prisma.rewardLedger.findMany({
    where: { date: settleDay, providerId: { in: [oai.id, anth.id, kim.id] } },
  });
  check(
    'BYOK rewards settle as PENDING with a 7-day vest date',
    byok.length === 3 &&
      byok.every((r) => r.status === 'PENDING' && r.vestAt !== null && r.totalClaudium > 0),
    byok.map((r) => ({ status: r.status, vestAt: r.vestAt })),
  );
  const veniceRows = await prisma.rewardLedger.findMany({
    where: { date: settleDay, providerId: good.id },
  });
  check('venice rewards vest instantly', veniceRows.every((r) => r.status === 'VESTED'));
  check(
    'pending rewards are not emitted to the game',
    (await evq.getJob(`settlement:${oai.id}:${dayStr}`)) == null,
  );

  await runVesting(new Date());
  check(
    'vesting before the window elapses is a no-op',
    (await prisma.rewardLedger.findFirst({ where: { id: byok[0].id } }))?.status === 'PENDING',
  );

  // Revoke the anthropic key while its reward is still pending → VOIDED.
  {
    const { nonce, signedMessage } = await signNonce(anth.wallet, anth.secretKey, 'revoke');
    await api(`/api/providers/${anth.id}/key`, {
      method: 'DELETE',
      body: JSON.stringify({ signedMessage, nonce }),
    });
    const voided = await prisma.rewardLedger.findFirst({
      where: { providerId: anth.id, date: settleDay },
    });
    check('revoking a key voids its pending rewards', voided?.status === 'VOIDED', voided?.status);
  }

  await runVesting(new Date(Date.now() + 8 * 86_400_000));
  const after = await prisma.rewardLedger.findMany({
    where: { date: settleDay, providerId: { in: [oai.id, kim.id, anth.id] } },
  });
  check(
    'matured rewards vest; voided rewards stay voided',
    after.filter((r) => r.providerId !== anth.id).every((r) => r.status === 'VESTED') &&
      after.find((r) => r.providerId === anth.id)?.status === 'VOIDED',
    after.map((r) => r.status),
  );
  check(
    'vested rewards emit exactly one credit event',
    (await evq.getJob(`settlement:${oai.id}:${dayStr}`)) != null &&
      (await evq.getJob(`settlement:${anth.id}:${dayStr}`)) == null,
  );
  const wallets = await api(`/api/providers/by-wallet/${oai.wallet}`);
  check(
    'dashboard shows vested Claudium after the window',
    wallets.body.totals?.claudiumVested > 0 && wallets.body.totals?.claudiumPending === 0,
    wallets.body.totals,
  );
  await evq.close();
}

console.log('- stolen-key simulation (health probe INVALID voids pending) -');
{
  await clearRateLimits();
  // A key that validated fine at registration, then got killed upstream -
  // the signature of a stolen key once the victim notices.
  const dying = await registerWith(null, 'Dying Rig', 'openai', 'sk-oai-dies-later-0123456789abc', {
    dailyBudgetUsd: 10,
  });
  // Pending reward from an earlier day, as if it had served compute already.
  await prisma.rewardLedger.create({
    data: {
      providerId: dying.id,
      date: utcDay(new Date(), 2),
      consumedUsd: 1,
      baseClaudium: 100,
      multiplier: 1,
      standbyClaudium: 0,
      capped: false,
      totalClaudium: 100,
      status: 'PENDING',
      vestAt: new Date(Date.now() + 5 * 86_400_000),
    },
  });

  const { runHealthProbes } = await import('../src/workers/health');
  await runHealthProbes();

  const row = await prisma.provider.findUnique({ where: { id: dying.id } });
  check('health probe marks the upstream-revoked key INVALID', row?.status === 'INVALID', row?.status);
  const ledger = await prisma.rewardLedger.findFirst({ where: { providerId: dying.id } });
  check('going INVALID voids the pending rewards', ledger?.status === 'VOIDED', ledger?.status);
}

console.log('- admin pricing editor -');
{
  const put = await api('/api/admin/pricing', {
    method: 'PUT',
    headers: { 'x-admin-token': ADMIN },
    body: JSON.stringify({ model: 'test-model-x', inputUsdPerMTokens: 1.25, outputUsdPerMTokens: 5, active: true }),
  });
  check('pricing PUT accepted', put.status === 200, put.body);
  const list = await api('/api/admin/pricing', { headers: { 'x-admin-token': ADMIN } });
  const row = list.body.pricing.find((r: any) => r.model === 'test-model-x');
  check('pricing GET round-trips the new rates', row?.inputUsdPerMTokens === 1.25 && row?.outputUsdPerMTokens === 5, row);
  const noAuth = await api('/api/admin/pricing', {
    method: 'PUT',
    body: JSON.stringify({ model: 'x', inputUsdPerMTokens: 0, outputUsdPerMTokens: 0 }),
  });
  check('pricing PUT without token rejected', noAuth.status === 401);
}

console.log('- input validation -');
check('unknown purpose rejected (400)', (await infer({ purpose: 'crypto_mining' })).status === 400);
check(
  'payload without messages rejected (400)',
  (await infer({ payload: { model: 'llama-3.3-70b' } })).status === 400,
);
check('unknown wallet stats 404', (await api('/api/providers/by-wallet/NoSuchWallet1111111111111111111111')).status === 404);
check('malformed JSON body rejected (400)', (
  await api('/api/providers/register', { method: 'POST', body: 'not-json{' })
).status === 400);

console.log('- rate limiting -');
await clearRateLimits();
{
  const codes: number[] = [];
  for (let i = 0; i < 25; i++) {
    const res = await api('/api/providers/nonce', {
      method: 'POST',
      body: JSON.stringify({ walletAddress: alpha.wallet, purpose: 'register' }),
    });
    codes.push(res.status);
  }
  // Nonce limit is RATE_LIMIT_REGISTER_PER_IP × 4 = 20 per window per IP.
  check(
    'nonce issuance: first 20 pass, then 429',
    codes.slice(0, 20).every((c) => c === 200) && codes.slice(20).every((c) => c === 429),
    codes.join(','),
  );
}

console.log('- health endpoint (post-settlement) -');
{
  const h = await api('/api/health');
  check(
    'health: settlement recorded and stack still ok',
    h.status === 200 && h.body.settlement.lastSettledDate !== null && !h.body.routingPaused,
    h.body,
  );
}

await prisma.$disconnect();
console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
