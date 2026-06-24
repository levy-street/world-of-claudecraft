// HTTP handler layer for the engagement endpoints. Pure orchestration over
// EngagementService: validate the request, evaluate eligibility, verify the burn,
// and shape a { status, body } result. The transport (main.ts route table,
// bearer auth, the concrete balance/antibot/burn lookups) injects its results as
// deps, so every handler is unit-testable against the in-memory service with no
// server, RPC, or DB. The handlers never touch the network or SQL directly.
import type { EngagementService } from './engagement_service';
import type { EngagementConfig, PackPowerPolicy } from './engagement_config';
import { evaluateEligibility, IneligibleReason } from './engagement_eligibility';
import { PACKS_BY_ID, oddsForPolicy } from './packs';

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/;
const MAX_CLIENT_SEED = 128;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validate a spin-claim body: an optional-but-typed player client seed. */
export function parseSpinClaim(body: unknown): Parsed<{ clientSeed: string }> {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'bad_body' };
  const cs = (body as { clientSeed?: unknown }).clientSeed;
  if (typeof cs !== 'string') return { ok: false, error: 'client_seed_required' };
  if (cs.length > MAX_CLIENT_SEED) return { ok: false, error: 'client_seed_too_long' };
  return { ok: true, value: { clientSeed: cs } };
}

/** Validate a pack-redeem body: a known pack id and a base58 burn signature. */
export function parsePackRedeem(body: unknown): Parsed<{ packId: string; txSig: string }> {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'bad_body' };
  const packId = (body as { packId?: unknown }).packId;
  const txSig = (body as { txSig?: unknown }).txSig;
  if (typeof packId !== 'string' || !(packId in PACKS_BY_ID)) return { ok: false, error: 'unknown_pack' };
  if (typeof txSig !== 'string' || !BASE58_SIG.test(txSig)) return { ok: false, error: 'bad_signature' };
  return { ok: true, value: { packId, txSig } };
}

/** The burn memo binding a $WOC burn to this account + pack (no quote table needed). */
export function packBurnMemo(accountId: number, packId: string): string {
  return `pack:${accountId}:${packId}`;
}

/** Inputs the transport resolves for an eligibility decision. */
export interface SpinDeps {
  walletLinked: boolean;
  balanceWoc: number | null;
  holderTier: number;
  antibotPassed: boolean;
}

/** Inputs the transport resolves for a pack redeem. */
export interface PackDeps {
  payerPubkey: string;
  policy: PackPowerPolicy;
  verifyBurn: (txSig: string, payer: string, priceWoc: number, memo: string) => Promise<{ ok: boolean; reason?: string }>;
}

function eligibility(svcDay: { alreadySpun: boolean }, cfg: EngagementConfig, deps: SpinDeps) {
  return evaluateEligibility(
    {
      walletLinked: deps.walletLinked,
      balanceWoc: deps.balanceWoc,
      minWoc: cfg.spinMinWoc,
      antibotPassed: deps.antibotPassed,
      alreadySpunToday: svcDay.alreadySpun,
    },
    cfg.spinEnabled,
  );
}

function httpStatusForReason(reason: IneligibleReason): number {
  switch (reason) {
    case 'spin_disabled':
    case 'balance_unknown':
      return 503; // transient / not-serving; the client may retry
    case 'already_spun':
      return 409;
    case 'no_wallet':
    case 'below_min':
    case 'antibot':
      return 403;
  }
}

/** GET /api/spin/status: eligibility + the day's public commit. */
export async function handleSpinStatus(svc: EngagementService, cfg: EngagementConfig, accountId: number, deps: SpinDeps): Promise<ApiResult> {
  const status = await svc.spinStatus(accountId);
  const fairness = await svc.publicFairness(status.utcDay);
  const elig = eligibility(status, cfg, deps);
  return {
    status: 200,
    body: {
      eligible: elig.ok,
      reason: elig.ok ? null : elig.reason,
      alreadySpunToday: status.alreadySpun,
      utcDay: status.utcDay,
      minWoc: cfg.spinMinWoc,
      balanceWoc: deps.balanceWoc,
      dailyCommit: fairness.commitHash,
    },
  };
}

/** POST /api/spin: gate, then claim the daily spin (pending until the keeper settles). */
export async function handleSpinClaim(
  svc: EngagementService,
  cfg: EngagementConfig,
  accountId: number,
  deps: SpinDeps,
  body: unknown,
): Promise<ApiResult> {
  const parsed = parseSpinClaim(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const status = await svc.spinStatus(accountId);
  const elig = eligibility(status, cfg, deps);
  if (!elig.ok) return { status: httpStatusForReason(elig.reason!), body: { error: elig.reason } };
  const claim = await svc.claimSpin({ accountId, clientSeed: parsed.value.clientSeed, holderTier: deps.holderTier });
  return {
    status: 200,
    body: {
      spinId: claim.spin.id,
      prize: claim.prize.key,
      lamports: claim.spin.lamports.toString(),
      settled: false,
    },
  };
}

/** GET /api/spin/fairness/:utcDay: the public commit and, once closed, the revealed seed. */
export async function handleFairness(svc: EngagementService, utcDay: number): Promise<ApiResult> {
  const f = await svc.publicFairness(utcDay);
  return { status: 200, body: { utcDay: f.utcDay, commit: f.commitHash, seed: f.revealedSeed } };
}

/** GET /api/packs: the catalog with the realm's published per-reward odds. */
export function handlePackCatalog(cfg: EngagementConfig): ApiResult {
  const policy = cfg.packPowerPolicy;
  const packs = Object.values(PACKS_BY_ID).map((p) => ({
    id: p.id,
    name: p.name,
    priceWoc: p.priceWoc,
    rolls: p.rolls,
    odds: oddsForPolicy(p, policy).map((o) => ({ kind: o.reward.kind, ref: o.reward.ref, rarity: o.rarity, probability: o.probability })),
  }));
  return { status: 200, body: { policy, packs } };
}

/** POST /api/packs/redeem: verify the $WOC burn, then rip the pack (fair, replay-guarded). */
export async function handlePackRedeem(
  svc: EngagementService,
  cfg: EngagementConfig,
  accountId: number,
  deps: PackDeps,
  body: unknown,
): Promise<ApiResult> {
  if (!cfg.packsEnabled) return { status: 503, body: { error: 'packs_disabled' } };
  const parsed = parsePackRedeem(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const pack = PACKS_BY_ID[parsed.value.packId];
  const memo = packBurnMemo(accountId, parsed.value.packId);
  const burn = await deps.verifyBurn(parsed.value.txSig, deps.payerPubkey, pack.priceWoc, memo);
  if (!burn.ok) return { status: 402, body: { error: burn.reason ?? 'burn_unverified' } };
  const opened = await svc.openPackFair({ accountId, packId: parsed.value.packId, txSig: parsed.value.txSig, policy: deps.policy });
  return { status: 200, body: { openingId: opened.openingId, rewards: opened.result.rewards } };
}
