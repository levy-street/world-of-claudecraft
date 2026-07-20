// E2E smoke: exercises the whole delegation flow — registration, weighted
// routing, metering, settlement idempotency, kill switch, revocation, house
// fallback — against a running stack. DESTRUCTIVE: wipes pool tables first,
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
{
  const { Queue } = await import('bullmq');
  const q = new Queue('settlement-events', { connection: { url: process.env.REDIS_URL } as any });
  await q.obliterate({ force: true }).catch(() => {});
  await q.close();
  // Reset rate-limit windows so back-to-back smoke runs don't trip them.
  const { Redis } = await import('ioredis');
  const redis = new Redis(process.env.REDIS_URL!);
  const rlKeys = await redis.keys('rl:*');
  if (rlKeys.length) await redis.del(...rlKeys);
  redis.disconnect();
}

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`, detail ?? '');
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

async function signNonce(wallet: string, secretKey: Uint8Array, purpose: 'register' | 'revoke') {
  const n = await api('/api/providers/nonce', {
    method: 'POST',
    body: JSON.stringify({ walletAddress: wallet, purpose }),
  });
  check(`nonce issued (${purpose})`, n.status === 200, n.body);
  const sig = nacl.sign.detached(new TextEncoder().encode(n.body.message), secretKey);
  return { nonce: n.body.nonce as string, signedMessage: bs58.encode(sig) };
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

console.log('— registration —');
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

console.log('— inference routing & metering —');
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
  Math.abs(stats.body.todayConsumedUsd - served[beta.id] * 0.00021) < 1e-9,
  stats.body,
);
check('no key material in stats', JSON.stringify(stats.body).includes('vn_beta') === false);

const lb = await api('/api/leaderboard');
check('leaderboard has 2 truncated-wallet entries',
  lb.body.leaderboard.length === 2 && lb.body.leaderboard.every((r: any) => r.wallet.includes('…')),
  lb.body);

console.log('— settlement (run as if the day ended) —');
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

console.log('— kill switch —');
await api('/api/admin/killswitch', { method: 'POST', headers: { 'x-admin-token': ADMIN }, body: JSON.stringify({ paused: true }) });
check('paused routing returns 503', (await infer()).status === 503);
await api('/api/admin/killswitch', { method: 'POST', headers: { 'x-admin-token': ADMIN }, body: JSON.stringify({ paused: false }) });
check('resumed routing returns 200', (await infer()).status === 200);
check('admin without token rejected', (await api('/api/admin/overview')).status === 401);

console.log('— revocation & house fallback —');
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

await prisma.$disconnect();
console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
