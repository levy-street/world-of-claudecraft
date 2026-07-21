import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { revokeSchema } from '@/lib/schemas';
import { buildSignMessage, verifyWalletSignature } from '@/lib/signature';
import { consumeNonce } from '@/lib/nonce';
import { invalidatePoolCache, voidPendingRewards } from '@/lib/inference';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Non-custodial revocation: wallet-signed request wipes the encrypted key
 * immediately. (Providers can also revoke server-side on Venice; this removes
 * our copy and stops routing.)
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = revokeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await params;
  const provider = await prisma.provider.findUnique({ where: { id } });
  if (!provider) return NextResponse.json({ error: 'provider not found' }, { status: 404 });

  const { signedMessage, nonce } = parsed.data;
  if (!(await consumeNonce(provider.wallet, 'revoke', nonce))) {
    return NextResponse.json({ error: 'unknown, expired, or already-used nonce' }, { status: 401 });
  }
  const message = buildSignMessage('revoke', provider.wallet, nonce);
  if (!verifyWalletSignature(provider.wallet, message, signedMessage)) {
    return NextResponse.json({ error: 'signature verification failed' }, { status: 401 });
  }

  await prisma.provider.update({
    where: { id: provider.id },
    data: { encryptedKey: null, keyLast4: null, status: 'REVOKED' },
  });
  // Unvested BYOK rewards die with the key (fraud window - see BYOK plan §6).
  await voidPendingRewards(provider.id, 'key revoked by provider');
  invalidatePoolCache();

  return NextResponse.json({ id: provider.id, status: 'REVOKED' });
}
