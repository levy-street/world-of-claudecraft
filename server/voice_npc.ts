// "Burn $WOC for an NPC with your own voice" (docs/prd/woc/voice-npc.md). A
// quote/confirm two-step flow over $WOC burn verification, modeled directly on
// server/identity.ts: the client uploads a consented voice sample, prices it,
// burns $WOC with the quote id as memo, and the server independently verifies
// the finalized burn before moving the grant past payment. Cloning + line
// synthesis happen out-of-band in voice_npc_keeper.ts; this module only owns
// the sample upload + the quote/confirm/status HTTP surface.

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import {
  createWocQuote,
  deleteWocQuote,
  getWocQuote,
  pruneWocQuotes,
  recordWocPayment,
  walletForAccount,
} from './db';
import { json, readBinaryBody, readBody } from './http_util';
import {
  createOrGetGrant,
  grantForAccount,
  markPendingClone,
  recordConsentAndSample,
} from './voice_npc_db';
import {
  VOICE_NPC_ENABLED,
  WOC_DECIMALS,
  WOC_MINT,
  wocPriceVoiceNpcBase,
  wocPriceVoiceNpcHuman,
} from './woc_config';
import { verifyWocPayment } from './woc_payment';

const QUOTE_TTL_MINUTES = 15;
const QUOTE_KIND = 'voice_npc';

// Server-local sample storage. NOT under public/: a voice sample is raw
// biometric-adjacent input, never served back to any client, only read by the
// keeper for cloning. TODO(legal): confirm retention/deletion policy once the
// consent/ToS copy is signed off (see the PRD); samples currently persist
// indefinitely once uploaded.
const SAMPLE_ROOT = path.join(process.cwd(), 'data', 'voice_npc_samples');
const MAX_SAMPLE_BYTES = 8 * 1024 * 1024; // 8 MB cap on the recorded clip
const MAX_DISPLAY_NAME_LEN = 32;

function samplePathFor(accountId: number): string {
  return path.join(SAMPLE_ROOT, `${accountId}.webm`);
}

// GET /api/voice-npc/info (public): lets the client show price/availability
// before the player commits to recording anything.
export function handleVoiceNpcInfo(res: http.ServerResponse): void {
  json(res, 200, {
    enabled: VOICE_NPC_ENABLED,
    priceWoc: wocPriceVoiceNpcHuman(),
    mint: WOC_MINT,
    decimals: WOC_DECIMALS,
  });
}

// POST /api/voice-npc/sample (authed): multipart-free raw binary upload. The
// client sends the recorded clip as the raw request body and the metadata
// (displayName, consent) as query params, mirroring readBinaryBody's existing
// player-card precedent of keeping the binary path separate from JSON bodies.
export async function handleVoiceNpcSample(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!VOICE_NPC_ENABLED)
    return json(res, 503, { error: 'voice npc unlocking is not enabled yet' });

  const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const consent = params.get('consent') === 'true';
  const displayName = (params.get('displayName') ?? '').trim().slice(0, MAX_DISPLAY_NAME_LEN);
  // Consent must be explicit and affirmative; absence (or anything other than
  // the literal "true") never implies consent.
  if (!consent)
    return json(res, 400, {
      error: 'explicit consent is required before recording a voice sample',
    });
  if (!displayName) return json(res, 400, { error: 'displayName is required' });

  let sample: Buffer;
  try {
    sample = await readBinaryBody(req, MAX_SAMPLE_BYTES);
  } catch {
    return json(res, 413, { error: 'voice sample too large (8 MB max)' });
  }
  if (sample.length === 0) return json(res, 400, { error: 'empty voice sample' });

  await mkdir(SAMPLE_ROOT, { recursive: true });
  const dest = samplePathFor(accountId);
  await writeFile(dest, sample);
  const grant = await recordConsentAndSample(accountId, dest, displayName);
  return json(res, 200, { status: grant.status, npcDisplayName: grant.npc_display_name });
}

// POST /api/voice-npc/quote (authed, wallet-required): prices the unlock and
// issues a single-use $WOC burn quote, exactly like identity.ts's quote flow.
export async function handleVoiceNpcQuote(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!VOICE_NPC_ENABLED)
    return json(res, 503, { error: 'voice npc unlocking is not enabled yet' });
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });

  const grant = await grantForAccount(accountId);
  if (!grant || grant.status !== 'pending_sample' || !grant.sample_path) {
    return json(res, 400, {
      error: 'record and consent to a voice sample before requesting a quote',
    });
  }

  const priceBase = wocPriceVoiceNpcBase();
  await pruneWocQuotes();
  const quoteId = randomBytes(16).toString('hex');
  await createWocQuote({
    quoteId,
    accountId,
    kind: QUOTE_KIND,
    payload: {},
    priceBase,
    mint: WOC_MINT,
    ttlMinutes: QUOTE_TTL_MINUTES,
  });

  return json(res, 200, {
    quoteId,
    memo: quoteId,
    mint: WOC_MINT,
    decimals: WOC_DECIMALS,
    amountBase: priceBase.toString(),
    burnBase: priceBase.toString(),
    treasuryBase: '0',
    treasury: null,
    priceWoc: wocPriceVoiceNpcHuman(),
    payer: wallet.pubkey,
    expiresAt: Date.now() + QUOTE_TTL_MINUTES * 60_000,
  });
}

// POST /api/voice-npc/confirm (authed): verifies the finalized burn, replay-
// guards on tx_sig, then hands the grant to the async keeper (pending_clone)
// rather than applying anything synchronously, cloning/synthesis happen out of
// band in voice_npc_keeper.ts.
export async function handleVoiceNpcConfirm(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  if (!VOICE_NPC_ENABLED)
    return json(res, 503, { error: 'voice npc unlocking is not enabled yet' });
  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link a Solana wallet first' });

  const body = await readBody(req);
  const quoteId = typeof body.quoteId === 'string' ? body.quoteId.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  if (!quoteId || !signature)
    return json(res, 400, { error: 'quoteId and signature are required' });

  const quote = await getWocQuote(quoteId, accountId);
  if (!quote || quote.kind !== QUOTE_KIND) {
    return json(res, 400, { error: 'quote expired or already used, request a new one' });
  }

  const priceBase = BigInt(quote.price_base);
  const payment = await verifyWocPayment(signature, wallet.pubkey, priceBase, quoteId);
  if (!payment.ok) {
    const status = payment.reason === 'not_finalized' ? 409 : 400;
    return json(res, status, {
      error: `payment not verified (${payment.reason})`,
      reason: payment.reason,
    });
  }

  const rec = await recordWocPayment({
    accountId,
    txSig: signature,
    amountBase: payment.spentBase,
    burnedBase: payment.burnedBase,
    mint: quote.mint,
    reference: `${quote.kind}:${quoteId}`,
  });
  if (!rec) return json(res, 409, { error: 'this payment was already used' });

  await markPendingClone(accountId);
  await deleteWocQuote(quoteId).catch(() => {});
  const grant = await grantForAccount(accountId);
  return json(res, 200, { status: grant?.status ?? 'pending_clone' });
}

// GET /api/voice-npc/status (authed): lets the client poll the grant while the
// keeper clones the voice and synthesizes lines.
export async function handleVoiceNpcStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const grant = await createOrGetGrant(accountId);
  return json(res, 200, {
    status: grant.status,
    npcDisplayName: grant.npc_display_name,
    lines: grant.lines,
    error: grant.error,
  });
}
