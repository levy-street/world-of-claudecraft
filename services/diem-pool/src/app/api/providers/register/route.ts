import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { registerSchema } from '@/lib/schemas';
import { buildSignMessage, isValidSolanaAddress, verifyWalletSignature } from '@/lib/signature';
import { consumeNonce } from '@/lib/nonce';
import { encryptSecret, last4 } from '@/lib/crypto';
import { validateKey } from '@/lib/venice';
import { clientIp } from '@/lib/auth';
import { checkRateLimit, RedisCounterStore } from '@/lib/ratelimit';
import { getRedis } from '@/lib/redis';
import { invalidatePoolCache } from '@/lib/inference';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const env = getEnv();
  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const { walletAddress, signedMessage, nonce, veniceApiKey, displayName, declaredDiem } =
    parsed.data;

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
  } catch {
    // Redis down → fail open; the signature + nonce checks below still gate.
  }

  // Nonce is consumed before signature verification so a bad signature still
  // burns it — an attacker can't brute-force signatures against one nonce.
  if (!(await consumeNonce(walletAddress, 'register', nonce))) {
    return NextResponse.json({ error: 'unknown, expired, or already-used nonce' }, { status: 401 });
  }
  const message = buildSignMessage('register', walletAddress, nonce);
  if (!verifyWalletSignature(walletAddress, message, signedMessage)) {
    return NextResponse.json({ error: 'signature verification failed' }, { status: 401 });
  }

  const existing = await prisma.provider.findUnique({ where: { wallet: walletAddress } });
  if (existing && (existing.status === 'ACTIVE' || existing.status === 'DEGRADED')) {
    return NextResponse.json(
      { error: 'wallet already registered — revoke the current key first' },
      { status: 409 },
    );
  }

  // Validate the key before accepting: ~1-token call on the cheapest model
  // proves it is real and funded. Never store or log an unvalidated key.
  const validation = await validateKey(veniceApiKey, env.VENICE_VALIDATION_MODEL, {
    baseUrl: env.VENICE_BASE_URL,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: `Venice key rejected: ${validation.reason}` }, { status: 422 });
  }

  const dailyCapacityUsd = Math.min(declaredDiem, env.MAX_DECLARED_DIEM) * env.DIEM_DAILY_USD;
  const data = {
    displayName,
    encryptedKey: encryptSecret(veniceApiKey, env.KEY_ENCRYPTION_KEY),
    keyLast4: last4(veniceApiKey),
    dailyCapacityUsd,
    status: 'ACTIVE' as const,
    consecutiveFailures: 0,
  };
  const provider = existing
    ? await prisma.provider.update({ where: { id: existing.id }, data })
    : await prisma.provider.create({ data: { ...data, wallet: walletAddress } });

  invalidatePoolCache();
  return NextResponse.json({
    id: provider.id,
    wallet: provider.wallet,
    displayName: provider.displayName,
    keyLast4: provider.keyLast4,
    dailyCapacityUsd: Number(provider.dailyCapacityUsd),
    status: provider.status,
  });
}
