// Pure helpers for the on-chain activity feed: validate the inbound event body the
// worker POSTs, and render the one-line realm-chat announcement.
//
// The realm-chat line is plain ASCII (no emoji, no em/en dashes, per the repo copy
// rule) and is emitted through broadcastSystem, which is variable-routed and so
// invisible to the S3 i18n guard; the stable verb prefix is matched in
// server_i18n.ts and the numbers/addresses are locale-neutral.

import type { OnchainEvent, OnchainKind, OnchainToken } from './onchain_activity';

const KINDS: readonly OnchainKind[] = ['burn', 'sale', 'claudium'];
const TOKENS: readonly OnchainToken[] = ['WOC', 'SOL', 'USDC'];

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Validate + normalize an inbound on-chain event body. Returns a clean OnchainEvent
 * or null when a required field is missing or malformed (fail-closed: a bad body is
 * dropped, never broadcast). Unknown extra fields are ignored.
 */
export function validateOnchainEvent(body: unknown): OnchainEvent | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  const kind = b.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as OnchainKind)) return null;
  const token = b.token;
  if (typeof token !== 'string' || !TOKENS.includes(token as OnchainToken)) return null;

  const amountUi = finiteNum(b.amountUi);
  if (amountUi === null || amountUi < 0) return null;

  const sig = str(b.sig, 128);
  if (sig.length < 32) return null; // a real Solana signature is 64+ base58 chars

  const usd = finiteNum(b.usd);
  const blockMs = finiteNum(b.blockMs);
  const totalBurnedUi = finiteNum(b.totalBurnedUi);

  return {
    kind: kind as OnchainKind,
    token: token as OnchainToken,
    amountUi,
    usd: usd !== null && usd >= 0 ? usd : null,
    actor: str(b.actor, 64),
    item: typeof b.item === 'string' ? b.item.slice(0, 80) : null,
    sig,
    blockMs: blockMs !== null && blockMs >= 0 ? blockMs : 0,
    network: str(b.network, 16) || 'mainnet',
    totalBurnedUi: totalBurnedUi !== null && totalBurnedUi >= 0 ? totalBurnedUi : null,
  };
}

/** Whole-token amount with thousands separators, no decimals for large values. */
export function formatAmount(n: number): string {
  const rounded = n >= 1000 ? Math.round(n) : Math.round(n * 100) / 100;
  return rounded.toLocaleString('en-US');
}

/** USD to a compact "$1,234.56" (two decimals below 1000, whole above). */
export function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const value = abs >= 1000 ? Math.round(n) : Math.round(n * 100) / 100;
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: abs >= 1000 ? 0 : 2,
    maximumFractionDigits: abs >= 1000 ? 0 : 2,
  })}`;
}

/**
 * The one-line, ASCII, emoji-free realm-chat announcement for an event. The leading
 * "[WOC]" tag is the stable, matchable prefix; everything after it is locale-neutral
 * numbers, symbols, and names.
 */
export function renderRealmLine(evt: OnchainEvent): string {
  const usd = evt.usd !== null ? ` (${formatUsd(evt.usd)})` : '';
  if (evt.kind === 'burn') {
    const total =
      evt.totalBurnedUi !== null ? ` Total burned ${formatAmount(evt.totalBurnedUi)} WOC.` : '';
    return `[WOC] Burned ${formatAmount(evt.amountUi)} WOC${usd}.${total}`;
  }
  if (evt.kind === 'sale') {
    const what = evt.item ? `${evt.item} sold` : 'Item sold';
    return `[WOC] ${what} for ${formatAmount(evt.amountUi)} ${evt.token}${usd}.`;
  }
  // claudium
  const what = evt.item ? `${evt.item}` : 'Claudium';
  return `[WOC] ${what} bought with ${formatAmount(evt.amountUi)} ${evt.token}${usd}.`;
}
