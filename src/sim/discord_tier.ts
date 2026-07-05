// Shared Discord status-tier ladder and swag catalog.
//
// The simulation does not apply Discord status as gameplay rules (determinism
// stays intact). This pure, host-agnostic module exists so the server, the HUD
// presentation code, and the Discord bot can all agree on the cosmetic status
// index and the claimable-swag catalog without importing across host
// boundaries. It mirrors src/sim/holder_tier.ts in shape.
//
// "Points" are an authored, account-wide reward currency the server owns (unlike
// the chain-sourced $WOC balance). Status is derived from LIFETIME points so a
// rung is never lost when current points are spent on swag.

export interface DiscordStatusTierCore {
  /** 1-based rung (1 = Initiate, 8 = Mythic). 0 means "linked but no rung yet". */
  index: number;
  /** Stable machine key used for CSS hooks, Discord role mapping, and lookup. */
  key: string;
  /** Minimum lifetime reward points to reach this rung. */
  threshold: number;
}

// Eight evocative status rungs. Thresholds climb so early progress is visible
// and the top rungs are a real flex. The bot maps each rung to a Discord role of
// the same key; the HUD renders the localized display name via t().
export const DISCORD_STATUS_DEFS = [
  { index: 1, key: 'initiate', threshold: 0 },
  { index: 2, key: 'squire', threshold: 100 },
  { index: 3, key: 'footman', threshold: 500 },
  { index: 4, key: 'knight', threshold: 2_000 },
  { index: 5, key: 'champion', threshold: 5_000 },
  { index: 6, key: 'warlord', threshold: 15_000 },
  { index: 7, key: 'legend', threshold: 50_000 },
  { index: 8, key: 'mythic', threshold: 150_000 },
] as const satisfies readonly DiscordStatusTierCore[];

export type DiscordStatusKey = (typeof DISCORD_STATUS_DEFS)[number]['key'];

/** Highest rung a lifetime-points total qualifies for (never null for >= 0). */
export function discordStatusForPoints(lifetimePoints: number): DiscordStatusTierCore {
  const pts = Number.isFinite(lifetimePoints) ? Math.max(0, lifetimePoints) : 0;
  let tier: DiscordStatusTierCore = DISCORD_STATUS_DEFS[0];
  for (const t of DISCORD_STATUS_DEFS) {
    if (pts >= t.threshold) tier = t;
    else break;
  }
  return tier;
}

/** The 1-based rung index for a lifetime-points total (1-8). */
export function discordStatusIndexForPoints(lifetimePoints: number): number {
  return discordStatusForPoints(lifetimePoints).index;
}

/** The rung at a 1-based index (1-8), or undefined for 0/out-of-range. */
export function discordStatusByIndex(index: number): DiscordStatusTierCore | undefined {
  return Number.isInteger(index) && index >= 1 && index <= DISCORD_STATUS_DEFS.length
    ? DISCORD_STATUS_DEFS[index - 1]
    : undefined;
}

/** Points still needed to reach the next rung, or null when already at the top. */
export function pointsToNextStatus(lifetimePoints: number): number | null {
  const current = discordStatusForPoints(lifetimePoints);
  const next = discordStatusByIndex(current.index + 1);
  if (!next) return null;
  return Math.max(0, next.threshold - Math.max(0, lifetimePoints));
}

// ── Reward sources ─────────────────────────────────────────────────────────
// Server-authoritative point grants. Reasons are stable keys (the ledger stores
// them) so the same award is never double-credited and the UI/bot can localize.
export const DISCORD_REWARD_GRANTS = {
  /** One-time grant the first time an account links Discord. */
  link: { reason: 'link', points: 250 },
  /** One-time grant when the linked user is verified as a guild member. */
  guildMember: { reason: 'guild_member', points: 250 },
  /** One-time grant when the linked user is a Nitro booster of the server. */
  booster: { reason: 'booster', points: 1_000 },
  /** Daily grant for being active in the Discord (bot-driven, idempotent per day). */
  dailyActive: { reason: 'daily_active', points: 50 },
} as const satisfies Record<string, { reason: string; points: number }>;

export type DiscordRewardGrantKey = keyof typeof DISCORD_REWARD_GRANTS;

// ── Swag catalog ─────────────────────────────────────────────────────────────
// Claimable rewards. A claim is recorded idempotently server-side (one per
// account per swag id). `kind` tells the renderer/bot how to fulfil it:
//  - 'title'   grants an account-wide cosmetic title shown in-world,
//  - 'cosmetic' grants an account cosmetic (skin/chroma) id,
//  - 'physical' queues a real-world swag fulfilment (sticker pack, tee, ...).
export interface SwagItem {
  id: string;
  /** Stable display-name key (HUD resolves via t(), bot via its copy table). */
  key: string;
  kind: 'title' | 'cosmetic' | 'physical';
  /** Current-point cost to claim (deducted from spendable points). */
  cost: number;
  /** Minimum status rung index required before this can be claimed. */
  minTier: number;
  /** Payload the server applies on claim (title id / cosmetic id / sku). */
  grantId: string;
}

// Cosmetic-only rewards unlocked by status tier (no physical/real-world swag): a
// title or chroma you earn as you climb the points ladder.
export const DISCORD_SWAG: readonly SwagItem[] = [
  {
    id: 'title_discordian',
    key: 'titleDiscordian',
    kind: 'title',
    cost: 0,
    minTier: 1,
    grantId: 'discordian',
  },
  {
    id: 'title_squire',
    key: 'titleSquire',
    kind: 'title',
    cost: 200,
    minTier: 2,
    grantId: 'squire_of_the_realm',
  },
  {
    id: 'chroma_blurple',
    key: 'chromaBlurple',
    kind: 'cosmetic',
    cost: 1_000,
    minTier: 3,
    grantId: 'vanguard_azure',
  },
  {
    id: 'title_champion',
    key: 'titleChampion',
    kind: 'title',
    cost: 2_500,
    minTier: 5,
    grantId: 'champion_of_claudemoon',
  },
] as const;

export function swagById(id: string): SwagItem | undefined {
  return DISCORD_SWAG.find((s) => s.id === id);
}

/**
 * Whether an account can claim a swag item right now, given its spendable points,
 * status rung, and the set of swag ids it has already claimed. Pure so both the
 * server (authoritative check) and the HUD (button enablement) share one rule.
 */
export function canClaimSwag(opts: {
  swag: SwagItem;
  spendablePoints: number;
  statusTier: number;
  claimedIds: readonly string[];
}): { ok: boolean; reason: 'ok' | 'claimed' | 'tier' | 'points' } {
  const { swag, spendablePoints, statusTier, claimedIds } = opts;
  if (claimedIds.includes(swag.id)) return { ok: false, reason: 'claimed' };
  if (statusTier < swag.minTier) return { ok: false, reason: 'tier' };
  if (spendablePoints < swag.cost) return { ok: false, reason: 'points' };
  return { ok: true, reason: 'ok' };
}
