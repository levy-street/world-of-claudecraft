// Config for the featured-talent multi-currency checkout (docs/prd/woc/
// talent-checkout.md): the three currencies a buyer may pay in (USDC, SOL,
// $WOC), the 80/20 talent-to-treasury split, the shared treasury address, and
// this feature's flag. Server-only module; no SQL, no client import. Mirrors the
// shape of server/woc_config.ts (which owns the $WOC mint / decimals / RPC the
// token currencies reuse) so a future merge of the commerce surfaces lines up.
//
// The talent program lets a featured creator own wares on the Logol pipeline; a
// buyer pays in their CHOICE of currency and the sale splits 80% to the talent,
// 20% to the treasury, recorded per sale. Payment is verified on-chain through
// the SAME verify path the Logol / rename flows use (server/woc_payment.ts +
// server/solana_tx.ts), never a hand-rolled one.
import { WOC_DECIMALS, WOC_MINT } from './woc_config';

function boolEnv(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

// Ships OFF: the program needs a build-out of the talent onboarding surface and,
// critically, dual legal counsel sign-off before any mainnet sale. Until
// TALENT_PROGRAM_ENABLED is true, every quote and confirm is refused (fail
// closed), mirroring how LOGOL_ENABLED gates the merchant.
export const TALENT_PROGRAM_ENABLED = boolEnv(process.env.TALENT_PROGRAM_ENABLED, false);

// The buyer's currency choice. USDC and $WOC are SPL tokens (verified by token
// balance delta); SOL is native (verified by lamport delta). This union is the
// wire contract between the quote (which currency the buyer picked) and confirm.
export type TalentCurrency = 'usdc' | 'sol' | 'woc';
export const TALENT_CURRENCIES: readonly TalentCurrency[] = ['usdc', 'sol', 'woc'] as const;

export function isTalentCurrency(v: unknown): v is TalentCurrency {
  return typeof v === 'string' && (TALENT_CURRENCIES as readonly string[]).includes(v);
}

// Decimals per currency. SOL is native (9, lamports). USDC is the canonical
// 6-decimal mainnet mint. $WOC reuses the shared WOC_DECIMALS.
export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;

// The canonical mainnet USDC mint (legacy SPL Token program). Overridable for a
// devnet mint. SOL has no mint (native); $WOC uses WOC_MINT.
export const USDC_MINT = (
  process.env.USDC_MINT ??
  process.env.VITE_USDC_MINT ??
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
).trim();

// The treasury address that receives the 20% platform cut in every currency (the
// same wallet across USDC / SOL / $WOC). Unset leaves the feature inert (a quote
// cannot be built without a treasury credit target), which is safe with the flag
// off by default.
export const TALENT_TREASURY = (process.env.TALENT_TREASURY ?? '').trim() || null;

// The split, in basis points to the treasury. 2000 bps = 20% treasury, 80%
// talent. Configurable within a sane band, but never above 50% (a talent must
// always keep the majority) and never zero (the platform always takes a cut).
export const TALENT_TREASURY_BPS = clampInt(process.env.TALENT_TREASURY_BPS, 2000, 1, 5000);

// The featured talents' payout wallets, keyed by talentId (the id used in the
// wares catalog, src/sim/content/talent.ts). Authored via env as a comma list of
// `talentId=pubkey` pairs (e.g. TALENT_WALLETS=logan_golema=5xY...,other=9zP...),
// so no wallet is committed. A ware whose talent has no configured wallet cannot
// be quoted (fail closed). Kept server-side; never sent to the client.
export const TALENT_WALLETS: Record<string, string> = parseWallets(process.env.TALENT_WALLETS);

function parseWallets(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const id = pair.slice(0, eq).trim();
    const pubkey = pair.slice(eq + 1).trim();
    if (id && pubkey) out[id] = pubkey;
  }
  return out;
}

/** The payout wallet for a talent, or null if none is configured. */
export function talentWallet(talentId: string): string | null {
  return TALENT_WALLETS[talentId] ?? null;
}

/** Decimals for a given currency (SOL native, USDC/WOC token). */
export function decimalsFor(currency: TalentCurrency): number {
  if (currency === 'sol') return SOL_DECIMALS;
  if (currency === 'usdc') return USDC_DECIMALS;
  return WOC_DECIMALS;
}

/** The SPL mint for a token currency, or null for native SOL. */
export function mintFor(currency: TalentCurrency): string | null {
  if (currency === 'sol') return null;
  if (currency === 'usdc') return USDC_MINT;
  return WOC_MINT;
}

/**
 * Convert a human-readable amount to integer base units for a currency (rounding
 * to the nearest base unit). Uses a string-scaled parse so a fractional price
 * like 0.15 SOL converts exactly (150000000 lamports) without binary-float drift
 * on the whole part. Returns 0n for a non-finite or negative input.
 */
export function humanToBase(human: number, currency: TalentCurrency): bigint {
  if (!Number.isFinite(human) || human < 0) return 0n;
  const decimals = decimalsFor(currency);
  // Split into integer and fractional parts and scale each with integer math so
  // large whole amounts never lose precision through Number multiplication.
  const [intPart, fracPartRaw = ''] = human.toString().split('.');
  const frac = (fracPartRaw + '0'.repeat(decimals)).slice(0, decimals);
  const scale = 10n ** BigInt(decimals);
  const whole = BigInt(intPart || '0') * scale;
  const fractional = BigInt(frac || '0');
  return whole + fractional;
}

function clampInt(v: string | undefined, dflt: number, lo: number, hi: number): number {
  if (v === undefined) return dflt;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
