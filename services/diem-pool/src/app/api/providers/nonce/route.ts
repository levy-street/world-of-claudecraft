import { NextRequest, NextResponse } from 'next/server';
import { nonceRequestSchema } from '@/lib/schemas';
import { isValidSolanaAddress } from '@/lib/signature';
import { issueNonce } from '@/lib/nonce';
import { clientIp } from '@/lib/auth';
import { checkRateLimit, RedisCounterStore } from '@/lib/ratelimit';
import { getRedis } from '@/lib/redis';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const parsed = nonceRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const { walletAddress, purpose, vendor } = parsed.data;
  if (!isValidSolanaAddress(walletAddress)) {
    return NextResponse.json({ error: 'invalid Solana wallet address' }, { status: 400 });
  }

  // Nonce issuance is cheap but unauthenticated — keep a loose per-IP lid on it.
  const env = getEnv();
  try {
    const rl = await checkRateLimit(
      new RedisCounterStore(getRedis()),
      `nonce:ip:${clientIp(req)}`,
      env.RATE_LIMIT_REGISTER_PER_IP * 4,
      env.RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!rl.allowed) return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  } catch (err) {
    // Redis unavailable → fail open (signature auth still protects
    // mutations), but say so — silent fail-open is invisible in an incident.
    console.error('[ratelimit] redis unavailable, failing open:', (err as Error).message);
  }

  const { nonce, message, expiresAt } = await issueNonce(walletAddress, purpose, vendor);
  return NextResponse.json({ nonce, message, expiresAt });
}
