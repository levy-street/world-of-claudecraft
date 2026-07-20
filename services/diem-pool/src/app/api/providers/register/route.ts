import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { registerSchema } from '@/lib/schemas';
import { buildSignMessage, isValidSolanaAddress, verifyWalletSignature } from '@/lib/signature';
import { consumeNonce } from '@/lib/nonce';
import { encryptSecret, last4 } from '@/lib/crypto';
import { clientIp } from '@/lib/auth';
import { checkRateLimit, RedisCounterStore } from '@/lib/ratelimit';
import { getRedis } from '@/lib/redis';
import { invalidatePoolCache } from '@/lib/inference';
import { getAdapter } from '@/lib/vendors';
import { keyShapeError } from '@/lib/vendors/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const env = getEnv();
  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const {
    walletAddress,
    signedMessage,
    nonce,
    vendor,
    veniceApiKey: apiKey,
    displayName,
    declaredDiem,
    dailyBudgetUsd,
  } = parsed.data;

  if (!isValidSolanaAddress(walletAddress)) {
    return NextResponse.json({ error: 'invalid Solana wallet address' }, { status: 400 });
  }

  try {
    const store = new RedisCounterStore(getRedis());
    const [byIp, byWallet] = await Promise.all([
      checkRateLimit(store, `register:ip:${clientIp(req)}`, env.RATE_LIMIT_REGISTER_PER_IP, env.RATE_LIMIT_WINDOW_SECONDS),
      checkRateLimit(store, `register:wallet:${walletAddress}`, env.RATE_LIMIT_REGISTER_PER_WALLET, env.RATE_LIMIT_WINDOW_SECONDS),
    ]);
    if (!byIp.allowed || !byWallet.allowed) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 });
    }
  } catch (err) {
    // Redis down → fail open (signature + nonce still gate), but log it —
    // silent fail-open is invisible in an incident.
    console.error('[ratelimit] redis unavailable, failing open:', (err as Error).message);
  }

  // Nonce is consumed before signature verification so a bad signature still
  // burns it — an attacker can't brute-force signatures against one nonce.
  if (!(await consumeNonce(walletAddress, 'register', nonce))) {
    return NextResponse.json({ error: 'unknown, expired, or already-used nonce' }, { status: 401 });
  }
  // The message binds the vendor: a signature collected for one vendor can't
  // register a key under another.
  const message = buildSignMessage('register', walletAddress, nonce, vendor);
  if (!verifyWalletSignature(walletAddress, message, signedMessage)) {
    return NextResponse.json({ error: 'signature verification failed' }, { status: 401 });
  }

  const shapeProblem = keyShapeError(vendor, apiKey);
  if (shapeProblem) {
    return NextResponse.json({ error: `key rejected: ${shapeProblem}` }, { status: 400 });
  }

  const existing = await prisma.provider.findUnique({
    where: { wallet_vendor: { wallet: walletAddress, vendor } },
  });
  if (existing && (existing.status === 'ACTIVE' || existing.status === 'DEGRADED')) {
    return NextResponse.json(
      { error: `wallet already has an active ${vendor} key — revoke it first` },
      { status: 409 },
    );
  }

  // Validate the key before accepting: ~1-token call on the vendor's cheapest
  // model proves it is real and funded. Never store or log an unvalidated key.
  const validation = await getAdapter(vendor).validateKey(apiKey);
  if (!validation.ok) {
    return NextResponse.json({ error: `${vendor} key rejected: ${validation.reason}` }, { status: 422 });
  }

  // Venice capacity is stake-backed ($1/day per DIEM); BYOK capacity is a
  // self-imposed donation budget, additionally ramp-capped at routing time.
  const dailyCapacityUsd =
    vendor === 'venice'
      ? Math.min(declaredDiem!, env.MAX_DECLARED_DIEM) * env.DIEM_DAILY_USD
      : Math.min(dailyBudgetUsd!, env.MAX_BYOK_DAILY_BUDGET_USD);

  const data = {
    displayName,
    encryptedKey: encryptSecret(apiKey, env.KEY_ENCRYPTION_KEY),
    keyLast4: last4(apiKey),
    dailyCapacityUsd,
    status: 'ACTIVE' as const,
    consecutiveFailures: 0,
    // A replacement key has no track record: restart the trust ramp and the
    // uptime streak (a revoke-and-swap must not inherit TRUSTED routing caps).
    trustTier: 'NEW' as const,
    consecutiveHealthyDays: 0,
  };
  const provider = existing
    ? await prisma.provider.update({ where: { id: existing.id }, data })
    : await prisma.provider.create({ data: { ...data, wallet: walletAddress, vendor } });

  invalidatePoolCache();
  return NextResponse.json({
    id: provider.id,
    wallet: provider.wallet,
    vendor: provider.vendor,
    displayName: provider.displayName,
    keyLast4: provider.keyLast4,
    dailyCapacityUsd: Number(provider.dailyCapacityUsd),
    trustTier: provider.trustTier,
    status: provider.status,
  });
}
