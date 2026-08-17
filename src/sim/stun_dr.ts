import type { CrowdControlDrCategory, Entity } from './types';

// Classic-era stun diminishing returns are NOT one shared bucket. Same-category
// stuns diminish together (full -> half -> quarter -> immune), but stuns split
// into independent categories so a rogue's opener stun does not eat into the
// diminishing chain of a controlled stun:
//   - openerStun:     from-stealth openers (Cheap Shot, Pounce)
//   - controlledStun: deliberate on-demand stuns (Kidney Shot, Hammer of Justice,
//                     Bash, Charge, Feral/Bear Charge)
//   - randomStun:     proc-style stuns (none represented yet; the safe default)
// Keeping these separate preserves the core rogue opener flow: Cheap Shot does
// not diminish the following Kidney Shot, while repeated Kidney Shots (or repeated
// Hammer of Justice) still diminish within their own category.
const OPENER_STUNS = new Set(['cheap_shot', 'pounce']);
const CONTROLLED_STUNS = new Set([
  'kidney_shot',
  'hammer_of_justice',
  'bash',
  'charge',
  'bear_charge',
  'faultline',
  'sun_gods_verdict',
  'storm_bolt',
  'deep_freeze',
  'abyssal_rift',
  'frost_trap',
]);

export function stunDrCategory(abilityId: string): CrowdControlDrCategory {
  if (OPENER_STUNS.has(abilityId)) return 'openerStun';
  if (CONTROLLED_STUNS.has(abilityId)) return 'controlledStun';
  return 'randomStun';
}

// A stun DR category is any of the three stun buckets above; they all share the
// stun DR reset window. Used by the duration resolver to pick the reset timer.
export function isStunDrCategory(category: CrowdControlDrCategory): boolean {
  return category === 'openerStun' || category === 'controlledStun' || category === 'randomStun';
}

// PvP-only diminishing-returns tuning for the resolvers below: the reset
// window per category (how long until a fresh application starts the ladder
// over), the shared 100/50/25/immune multiplier ladder that root, lockout, and
// the three stun buckets walk, the fixed staged durations for polymorph, and
// the fear multipliers that scale each ability's authored duration.
const PVP_ROOT_DR_RESET = 18; // seconds before a repeated PvP root is fresh again
const PVP_STUN_DR_RESET = 18; // stuns share the root-style 100/50/25/immune scheme
const PVP_POLYMORPH_DR_RESET = 60;
const PVP_FEAR_DR_RESET = 60;
const PVP_CC_DR_MULTIPLIERS = [1, 0.5, 0.25] as const;
// Polymorph keeps an ABSOLUTE ladder on purpose: exactly one ability rides it
// (mage polymorph, authored 15s), so the 10s first rung reads as a deliberate PvP
// cap on a longer PvE value rather than an accident.
const PVP_POLYMORPH_DR_DURATIONS = [10, 5, 1] as const;
// Fear is a MULTIPLIER ladder, and must stay one. It was absolute seconds
// ([8, 4, 2, 1]) returned without reading the ability's authored duration, so in
// PvP every fear lasted 8s on first application no matter what its tooltip said:
// Psychic Scream (4s) and Howl of Terror / Death Coil (3s) were all silently
// doubled or better. Five abilities across three classes share this ladder, so an
// absolute table can only ever be right for one of them. These factors reproduce
// the old 8 -> 4 -> 2 -> 1 exactly for an 8s fear.
const PVP_FEAR_DR_MULTIPLIERS = [1, 0.5, 0.25, 0.125] as const;

/**
 * The PvP diminishing-returns ladder for one crowd-control category: full
 * duration outside hostile player-versus-player combat, a fixed staged
 * schedule for polymorph, the duration-scaled fear ladder, the shared
 * 100/50/25/immune multiplier ladder for root/lockout/stun, and null once that
 * ladder is exhausted (DR-immune, apply nothing). `now` and `isHostileTo` are
 * passed in rather than read off a host: this keeps the resolver a leaf module
 * with no `SimContext` dependency, so a Vitest can import and exercise it
 * directly. It is NOT a pure function of its arguments: three of its exits
 * write the new DR stage to `target.ccDr`.
 *
 * Balance pass (maintainer, 2026-08): player stuns walk the classic-era ladder
 * like every other category, per stun bucket, on the PVP_STUN_DR_RESET window.
 * An earlier pass exempted stuns outright (short flat durations behind real
 * cooldowns), but live PvP disproved the premise: Gut Punch has no cooldown,
 * and once the Cheap Trick row removes its stealth gate a rogue chains it into
 * Low Blow indefinitely. The category split above still protects the
 * sanctioned opener flow (a Gut Punch opener never diminishes the following
 * Low Blow); only repeated same-bucket stuns shrink and then go immune.
 */
export function crowdControlDurationAfterDr(
  now: number,
  isHostileTo: (a: Entity, b: Entity) => boolean,
  source: Entity,
  target: Entity,
  category: CrowdControlDrCategory,
  duration: number,
): number | null {
  if (source.kind !== 'player' || target.kind !== 'player' || !isHostileTo(source, target)) {
    return duration;
  }
  const existing = target.ccDr.get(category);
  const stage = existing && existing.resetAt > now ? existing.stage : 0;
  const reset =
    category === 'polymorph'
      ? PVP_POLYMORPH_DR_RESET
      : category === 'fear'
        ? PVP_FEAR_DR_RESET
        : category === 'lockout'
          ? PVP_STUN_DR_RESET
          : isStunDrCategory(category)
            ? PVP_STUN_DR_RESET
            : PVP_ROOT_DR_RESET;
  if (category === 'polymorph') {
    target.ccDr.set(category, { stage: stage + 1, resetAt: now + reset });
    return PVP_POLYMORPH_DR_DURATIONS[Math.min(stage, PVP_POLYMORPH_DR_DURATIONS.length - 1)];
  }
  if (category === 'fear') {
    target.ccDr.set(category, { stage: stage + 1, resetAt: now + reset });
    return duration * PVP_FEAR_DR_MULTIPLIERS[Math.min(stage, PVP_FEAR_DR_MULTIPLIERS.length - 1)];
  }
  if (stage >= PVP_CC_DR_MULTIPLIERS.length) return null;
  target.ccDr.set(category, { stage: stage + 1, resetAt: now + reset });
  return duration * PVP_CC_DR_MULTIPLIERS[stage];
}

/**
 * The one funnel every PLAYER-sourced crowd-control application passes
 * through: the diminishing-returns ladder above, then the item-set duration
 * reduction on top of it.
 *
 * The two are layered rather than fused because they are separate mechanisms.
 * The ladder has several distinct exits inside its hostile branch (the staged
 * polymorph schedule, the fear multipliers, the shared root/lockout/stun
 * ladder) and a DR-immune target returns null, which means "apply nothing" and
 * must pass through untouched rather than being multiplied. Applying the
 * reduction here once, over whatever the ladder decided, keeps every exit
 * covered without threading it through each arm.
 *
 * The player/hostile gate is duplicated from the inner function on purpose: it
 * is three cheap reads, it leaves the ladder's shape byte-identical to what
 * shipped, and it makes the PvE-untouched property readable at one glance.
 */
export function diminishedCrowdControlDuration(
  now: number,
  isHostileTo: (a: Entity, b: Entity) => boolean,
  source: Entity,
  target: Entity,
  category: CrowdControlDrCategory,
  duration: number,
): number | null {
  const base = crowdControlDurationAfterDr(now, isHostileTo, source, target, category, duration);
  if (base === null) return null; // already DR-immune: apply nothing at all
  if (source.kind !== 'player' || target.kind !== 'player') return base;
  if (!isHostileTo(source, target)) return base;
  const reduction = target.ccDurationReduction ?? 0;
  return reduction > 0 ? base * (1 - reduction) : base;
}
