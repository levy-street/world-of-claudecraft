// ---------------------------------------------------------------------------
// $WOC holder travel mounts — shared, host-agnostic data.
//
// Holding a share of the $WOC supply unlocks a rideable travel mount. Unlike the
// purely-cosmetic holder-tier nameplate flair (src/ui/holder_tier.ts), a mount is
// a REAL gameplay perk: a classic ground-mount move-speed boost. Eligibility is
// dynamic — it tracks the wallet's live balance, so selling below a rung removes
// access (the server dismounts you on the next balance refresh).
//
// This module lives in sim/ so it carries no DOM/render/net imports and runs
// unchanged on the server, offline, and headless. The authoritative Sim reads
// `speedMult`/`tier` for the gameplay rule; the server maps a balance to a tier
// via mountTierForBalance(); the client HUD reads names/thresholds for the mount
// window. The procedural mount VISUAL recipe lives in the renderer
// (src/render/characters/mount.ts), keyed by these ids — gameplay data here,
// presentation there.
//
// Supply basis: thresholds are absolute whole-$WOC amounts, fixed against the
// 1,000,000,000 max supply (the same basis src/ui/holder_tier.ts uses). The sim
// cannot import that UI constant (sim/ depends on nothing else in src/), so the
// amounts are written out and the supply share is documented per rung.
// ---------------------------------------------------------------------------

/** $WOC max supply the percentage rungs are taken against (1,000,000,000). */
export const MOUNT_SUPPLY_BASIS = 1_000_000_000;

/** Classic ground-mount speed multipliers (multiply base RUN_SPEED). The two
 *  canonical vanilla ground speeds — +60% (normal) and +100% (epic). The 0.1%
 *  entry rung rides the normal mount; every rung from 1% up to 4% rides the epic.
 *  From 5% of supply the steeds take flight (see MOUNT_FLIGHT_SPEED). */
export const MOUNT_SPEED_NORMAL = 1.6;
export const MOUNT_SPEED_EPIC = 2.0;

/** The first rung (5% of supply) that flies, and the top rung (10%). Flight
 *  speed scales by tier from MOUNT_FLIGHT_SPEED_MIN at the 5% rung up to
 *  MOUNT_FLIGHT_SPEED_MAX (250% of base) at the 10% Sovereign. */
export const FIRST_FLYING_TIER = 6;
export const MOUNT_FLIGHT_SPEED_MIN = 2.1;
export const MOUNT_FLIGHT_SPEED_MAX = 2.5;

export interface MountDef {
  /** Stable machine id (wire value, render-recipe key, dev-command target). */
  id: string;
  /** 1-based rung: 1 = the 0.1% mount … 11 = the 10% mount. */
  tier: number;
  /** Display name (proper noun; plain English, mirroring holder_tier.ts names). */
  name: string;
  /** Short hype line shown in the mount window (plain English, like holder flavor). */
  flavor: string;
  /** Minimum whole-$WOC balance to unlock this mount. */
  threshold: number;
  /** This rung's share of MOUNT_SUPPLY_BASIS, as a fraction in [0, 1]. */
  supplyShare: number;
  /** Base-run-speed multiplier applied while mounted and out of combat. */
  speedMult: number;
  /** Whether this steed flies: it lifts off the ground and soars over terrain and
   *  water (the sim runs a distinct flight movement branch). The 5%-of-supply rung
   *  and up fly; lower rungs are ground mounts. */
  flying: boolean;
  /** Accent colour (hex) for the mount window swatch + a hint to the renderer. */
  tint: number;
}

// Per-tier flight speed: the six flying rungs (tiers 6-11) ramp from
// MOUNT_FLIGHT_SPEED_MIN to MOUNT_FLIGHT_SPEED_MAX so the 10% Sovereign is the
// fastest thing in the sky. Ground rungs ignore this.
function flightSpeedForTier(tier: number): number {
  const flyers = 11 - FIRST_FLYING_TIER; // span of flying rungs above the first
  const step = (MOUNT_FLIGHT_SPEED_MAX - MOUNT_FLIGHT_SPEED_MIN) / flyers;
  return Math.round((MOUNT_FLIGHT_SPEED_MIN + (tier - FIRST_FLYING_TIER) * step) * 100) / 100;
}

// The eleven rungs the operator chose: the 0.1% line, then every whole percent
// from 1% to 10%. Ordered low → high; index in MOUNT_LIST is tier-1. Tiers 1-5
// are ground mounts; tiers 6-11 (5% of supply and up) fly.
export const MOUNT_LIST: readonly MountDef[] = [
  { id: 'ashmane', tier: 1, name: 'Ashmane Courser', flavor: 'The deep parts when you ride — 0.1% of supply.', threshold: 1_000_000, supplyShare: 0.001, speedMult: MOUNT_SPEED_NORMAL, flying: false, tint: 0x8a7766 },
  { id: 'emberhoof', tier: 2, name: 'Emberhoof Charger', flavor: 'Hooves that strike sparks — 1% of supply.', threshold: 10_000_000, supplyShare: 0.01, speedMult: MOUNT_SPEED_EPIC, flying: false, tint: 0xc2542a },
  { id: 'bronzeflank', tier: 3, name: 'Bronzeflank Destrier', flavor: 'Barded in beaten bronze — 2% of supply.', threshold: 20_000_000, supplyShare: 0.02, speedMult: MOUNT_SPEED_EPIC, flying: false, tint: 0xb87333 },
  { id: 'silvermane', tier: 4, name: 'Silvermane Stallion', flavor: 'A mane like cold moonlight — 3% of supply.', threshold: 30_000_000, supplyShare: 0.03, speedMult: MOUNT_SPEED_EPIC, flying: false, tint: 0xcbd6e2 },
  { id: 'stormhoof', tier: 5, name: 'Stormhoof Charger', flavor: 'It runs ahead of the thunder — 4% of supply.', threshold: 40_000_000, supplyShare: 0.04, speedMult: MOUNT_SPEED_EPIC, flying: false, tint: 0x5b7fa6 },
  { id: 'goldcrest', tier: 6, name: 'Goldcrest Skystrider', flavor: 'Winged and gilded — it takes to the air at 5% of supply.', threshold: 50_000_000, supplyShare: 0.05, speedMult: flightSpeedForTier(6), flying: true, tint: 0xffd24a },
  { id: 'verdant', tier: 7, name: 'Verdant Wildwing', flavor: 'A living gale of the deep wood — 6% of supply.', threshold: 60_000_000, supplyShare: 0.06, speedMult: flightSpeedForTier(7), flying: true, tint: 0x57e0b9 },
  { id: 'voidstrider', tier: 8, name: 'Voidwing Strider', flavor: 'It leaves smoke where the sky was — 7% of supply.', threshold: 70_000_000, supplyShare: 0.07, speedMult: flightSpeedForTier(8), flying: true, tint: 0x9b6cff },
  { id: 'celestial', tier: 9, name: 'Celestial Seraph', flavor: 'Star-shod, winged in light — 8% of supply.', threshold: 80_000_000, supplyShare: 0.08, speedMult: flightSpeedForTier(9), flying: true, tint: 0xff5c8a },
  { id: 'worldbearer', tier: 10, name: "Worldbearer's Roc", flavor: 'It carries a piece of the sky — 9% of supply.', threshold: 90_000_000, supplyShare: 0.09, speedMult: flightSpeedForTier(10), flying: true, tint: 0xff8a4c },
  { id: 'sovereign', tier: 11, name: 'Sovereign Dreadwyrm', flavor: 'The realm bends the knee — the dragon of the 10%.', threshold: 100_000_000, supplyShare: 0.1, speedMult: flightSpeedForTier(11), flying: true, tint: 0xffe27a },
] as const;

/** Id → def, for O(1) lookups by the sim (speed) and wire decode (render). */
export const MOUNTS: Readonly<Record<string, MountDef>> = Object.fromEntries(
  MOUNT_LIST.map((m) => [m.id, m]),
);

/** The highest mount tier a balance qualifies for: 0 = none (no wallet, or below
 *  the 0.1% line), 1-11 otherwise. A null balance (no connected wallet) is 0. */
export function mountTierForBalance(balance: number | null): number {
  if (balance === null || !Number.isFinite(balance) || balance < MOUNT_LIST[0].threshold) return 0;
  let tier = 0;
  for (const m of MOUNT_LIST) {
    if (balance >= m.threshold) tier = m.tier;
    else break;
  }
  return tier;
}

/** The def at a 1-based tier (1-11), or undefined for 0 / out-of-range. */
export function mountForTier(tier: number): MountDef | undefined {
  return tier >= 1 && tier <= MOUNT_LIST.length ? MOUNT_LIST[tier - 1] : undefined;
}

/** The def for a mount id, or undefined if the id is unknown. */
export function mountDef(id: string | null | undefined): MountDef | undefined {
  return id ? MOUNTS[id] : undefined;
}

/** Whether an eligibility tier (0-11) is allowed to ride the mount with id. The
 *  authoritative gate: you may summon any mount whose rung is at or below the
 *  highest you currently qualify for. */
export function mountUnlockedAtTier(id: string, eligibleTier: number): boolean {
  const def = MOUNTS[id];
  return def !== undefined && eligibleTier >= def.tier;
}

/** Whether the steed with this id flies (lifts off + soars). Unknown id ⇒ false. */
export function isFlyingMount(id: string | null | undefined): boolean {
  return id !== null && id !== undefined && MOUNTS[id]?.flying === true;
}

/** Two-track summon gate: a mount is rideable if the wallet's holdings cover its
 *  rung (holder track) OR it's been permanently earned via a Charter (earned
 *  track). The single authority the Sim consults. */
export function canSummonMount(id: string, holderTier: number, earned: ReadonlySet<string>): boolean {
  return mountUnlockedAtTier(id, holderTier) || earned.has(id);
}

/** Whether a mount may be sold as a Mount Charter (and thus earned by non-$WOC
 *  players). Everything but the tier-11 dragon — the ultimate holder-only flex. */
export function isCharterEligible(id: string): boolean {
  const def = MOUNTS[id];
  return def !== undefined && def.tier < MOUNT_LIST.length;
}
