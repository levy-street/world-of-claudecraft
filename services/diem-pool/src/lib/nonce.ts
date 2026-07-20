import { randomBytes } from 'node:crypto';
import { prisma } from './db';
import { buildSignMessage } from './signature';

const NONCE_TTL_MS = 10 * 60 * 1000;

export async function issueNonce(
  wallet: string,
  purpose: 'register' | 'revoke',
): Promise<{ nonce: string; message: string; expiresAt: Date }> {
  const nonce = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await prisma.providerNonce.create({ data: { wallet, nonce, purpose, expiresAt } });
  return { nonce, message: buildSignMessage(purpose, wallet, nonce), expiresAt };
}

/**
 * Single-use consumption: the guarded updateMany flips usedAt exactly once,
 * so a replayed signature (same nonce) fails even under concurrent requests.
 */
export async function consumeNonce(
  wallet: string,
  purpose: 'register' | 'revoke',
  nonce: string,
): Promise<boolean> {
  const res = await prisma.providerNonce.updateMany({
    where: { nonce, wallet, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  return res.count === 1;
}
