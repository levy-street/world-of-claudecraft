// Frost mage (Cryomancy) proc engine: Fingers of Frost, Brain Freeze,
// Winter's Chill, and the Shatter payoff (docs/prd/frost-mage.md when it
// lands; design source: the owner's frost spec, 2026-07-11).
//
// The loop: Rimelance (frostbolt) impacts roll the two procs. Fingers of
// Frost (up to 2 stacks) lets an Ice Lance treat its target as frozen.
// Brain Freeze makes the next Flurry instant and cooldown-free;
// Flurry's impact plants Winter's Chill (2 charges) on the target, and each
// charge lets one compatible spell treat the target as frozen. "Frozen"
// pays off through Shatter's +50% spell crit chance plus Ice Lance's own 3x
// damage.
//
// Determinism contract:
// - rollFrostboltProcs draws EXACTLY two rng chances per frostbolt impact
//   (Fingers first, then Brain Freeze, always both, results discarded when
//   capped/already active) and ONLY for a committed-frost player, so the
//   shared rng stream position is independent of proc state and every
//   existing golden (no scenario commits a mage spec) is untouched.
// - Everything else here is deterministic aura reads/writes: no draws.
//
// `src/sim`-pure: sibling sim modules + the SimContext seam only
// (enforced by tests/architecture.test.ts).

import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import type { AbilityDef, Aura, Entity } from '../types';
import { isRooted } from './cc';

export const FINGERS_OF_FROST_CHANCE = 0.15;
export const FINGERS_OF_FROST_MAX_STACKS = 2;
export const FINGERS_OF_FROST_DURATION = 15;
export const BRAIN_FREEZE_CHANCE = 0.2;
export const BRAIN_FREEZE_DURATION = 15;
export const WINTERS_CHILL_CHARGES = 2;
export const WINTERS_CHILL_DURATION = 5;
// Shatter: additive spell crit chance against a target this cast treats as
// frozen. Stacks with the Coldsnap Break row's critVsRooted on a
// really-frozen target by design.
export const SHATTER_CRIT_BONUS = 0.5;
// Ice Lance "deals 200% more damage" against a frozen-counting target.
export const ICE_LANCE_FROZEN_MULT = 3;

// Spells that may SPEND a Winter's Chill charge on impact (the PDF's
// "compatible spells"). Glacial Spike and Comet Storm join in a later phase.
// Flurry is deliberately absent: it PLANTS the debuff and must never eat the
// charges it just applied. The UI reads this same set for its glow scope.
export const WINTERS_CHILL_SPENDERS: ReadonlySet<string> = new Set(['ice_lance']);

// Blizzard feeds Frozen Orb: each enemy a pulse strikes shaves this off the
// orb's running cooldown, capped per Blizzard cast (owner design 2026-07-11).
export const BLIZZARD_ORB_CDR_PER_ENEMY = 0.5;
export const BLIZZARD_ORB_CDR_CAP = 3;

// Icicles: the frost build-up resource. Rimelance impacts and Frozen Orb pulses
// each bank one, up to ICICLE_MAX; at the cap Glacial Spike is castable
// (requiresAuraStacks) and consumes the whole stack. A long duration so a partial
// stack survives between casts in a real fight, refreshed on each new icicle.
export const ICICLE_MAX = 5;
export const ICICLE_DURATION = 30;

/** Pure aura-list predicate for the action bar (the freeCostAuraActive
 *  idiom): does a worn frost proc empower this ability right now? Ice Lance
 *  glows while Fingers of Frost is banked; Flurry glows while Brain Freeze
 *  is armed. Structural input so the UI drives it with a mirrored aura list
 *  and bar and combat can never disagree on the scope. */
export function frostProcGlowActive(
  auras: readonly { kind: string }[],
  abilityId: string,
): boolean {
  for (const a of auras) {
    if (a.kind === 'fingers_of_frost' && abilityId === 'ice_lance') return true;
    if (a.kind === 'brain_freeze' && abilityId === 'flurry') return true;
  }
  return false;
}

/** Pure reader: the banked Icicle count (0..ICICLE_MAX). Exposed for the frost
 *  build-up overlay to render the stack as it fills toward a Glacial Spike, the
 *  same structural-aura idiom as chronoOverlayCharges. */
export function frostIcicleCharges(auras: readonly { kind: string; stacks?: number }[]): number {
  const icicles = auras.find((a) => a.kind === 'icicles');
  return icicles ? (icicles.stacks ?? 1) : 0;
}

/** Cooldown-gate bypass (castAbility): an armed Brain Freeze lets Flurry be
 *  cast straight through its RUNNING cooldown (the proc is the point: a
 *  hard-cast Flurry arms 10s, and the next proc should not sit blocked
 *  behind it). The running timer keeps ticking; applyBrainFreezeOverride
 *  then arms no new one (cooldown: 0). */
export function brainFreezeBypassesCooldown(p: Entity, abilityId: string): boolean {
  return abilityId === 'flurry' && p.auras.some((a) => a.kind === 'brain_freeze');
}

function isCommittedFrost(ctx: SimContext, meta: PlayerMeta): boolean {
  return meta.cls === 'mage' && ctx.playerMods(meta).spec === 'frost';
}

function emitFade(ctx: SimContext, e: Entity, aura: Aura): void {
  ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false, auraKind: aura.kind });
}

/** Grant one Fingers of Frost stack from a frostbolt roll.
 *  At the 2-stack cap the new charge is simply lost, no refresh: the owner's
 *  anti-waste rule, so banking procs is a real rotational mistake. */
export function gainFingersOfFrost(ctx: SimContext, p: Entity): void {
  const existing = p.auras.find((a) => a.kind === 'fingers_of_frost');
  if (existing) {
    if ((existing.stacks ?? 1) >= FINGERS_OF_FROST_MAX_STACKS) return; // wasted proc
    existing.stacks = (existing.stacks ?? 1) + 1;
    existing.remaining = FINGERS_OF_FROST_DURATION;
    existing.duration = FINGERS_OF_FROST_DURATION;
  } else {
    ctx.applyAura(p, {
      id: 'fingers_of_frost',
      name: 'Fingers of Frost',
      kind: 'fingers_of_frost',
      value: 0,
      stacks: 1,
      remaining: FINGERS_OF_FROST_DURATION,
      duration: FINGERS_OF_FROST_DURATION,
      sourceId: p.id,
      school: 'frost',
    });
  }
  // The arming moment (talent_procs' procSurge idiom): the player feels it hit.
  ctx.emit({ type: 'spellfx', sourceId: p.id, targetId: p.id, school: 'frost', fx: 'procSurge' });
}

/** Arm Brain Freeze. While already armed a new proc does nothing (the
 *  owner's anti-waste rule: it cannot re-activate, not even a refresh). */
export function gainBrainFreeze(ctx: SimContext, p: Entity): void {
  if (p.auras.some((a) => a.kind === 'brain_freeze')) return; // wasted proc
  ctx.applyAura(p, {
    id: 'brain_freeze',
    name: 'Brain Freeze',
    kind: 'brain_freeze',
    value: 0,
    remaining: BRAIN_FREEZE_DURATION,
    duration: BRAIN_FREEZE_DURATION,
    sourceId: p.id,
    school: 'frost',
  });
  ctx.emit({ type: 'spellfx', sourceId: p.id, targetId: p.id, school: 'frost', fx: 'procSurge' });
}

/** Bank one Icicle (Rimelance impact or Frozen Orb pulse), up to ICICLE_MAX.
 *  Refreshes the duration on each gain so a partial stack does not decay mid
 *  build-up; at the cap the new icicle is lost (no over-cap), mirroring the
 *  anti-waste rule of the procs. Deterministic aura write, no rng. */
export function gainIcicle(ctx: SimContext, p: Entity): void {
  const existing = p.auras.find((a) => a.kind === 'icicles');
  if (existing) {
    existing.remaining = ICICLE_DURATION;
    existing.duration = ICICLE_DURATION;
    if ((existing.stacks ?? 1) >= ICICLE_MAX) return; // at the cap, the new icicle is lost
    existing.stacks = (existing.stacks ?? 1) + 1;
    return;
  }
  ctx.applyAura(p, {
    id: 'icicles',
    name: 'Icicles',
    kind: 'icicles',
    value: 0,
    stacks: 1,
    remaining: ICICLE_DURATION,
    duration: ICICLE_DURATION,
    sourceId: p.id,
    school: 'frost',
  });
}

/** Roll the two frostbolt-impact procs. Exactly two draws, Fingers first then
 *  Brain Freeze, both ALWAYS drawn (a capped/active proc discards its result)
 *  so the stream position never depends on proc state; only a committed-frost
 *  player reaches the rng at all, so every existing golden stays byte-stable. */
export function rollFrostboltProcs(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (!isCommittedFrost(ctx, meta)) return;
  const fingers = ctx.rng.chance(FINGERS_OF_FROST_CHANCE);
  const brain = ctx.rng.chance(BRAIN_FREEZE_CHANCE);
  if (fingers) gainFingersOfFrost(ctx, p);
  if (brain) gainBrainFreeze(ctx, p);
}

/** Plant Winter's Chill (2 charges, 5s) on the target: Flurry's impact rider.
 *  applyAura's refresh-by-id keeps one debuff per target (a re-plant restores
 *  it to full charges). */
export function applyWintersChill(ctx: SimContext, p: Entity, target: Entity): void {
  const existing = target.auras.find((a) => a.id === 'winters_chill');
  if (existing) {
    existing.charges = WINTERS_CHILL_CHARGES;
    existing.remaining = WINTERS_CHILL_DURATION;
    existing.duration = WINTERS_CHILL_DURATION;
    existing.sourceId = p.id;
    return;
  }
  ctx.applyAura(target, {
    id: 'winters_chill',
    name: "Winter's Chill",
    kind: 'winters_chill',
    value: 0,
    charges: WINTERS_CHILL_CHARGES,
    remaining: WINTERS_CHILL_DURATION,
    duration: WINTERS_CHILL_DURATION,
    sourceId: p.id,
    school: 'frost',
  });
}

function consumeFingersCharge(ctx: SimContext, p: Entity): boolean {
  const idx = p.auras.findIndex((a) => a.kind === 'fingers_of_frost');
  if (idx < 0) return false;
  const aura = p.auras[idx];
  const left = (aura.stacks ?? 1) - 1;
  if (left <= 0) {
    p.auras.splice(idx, 1);
    emitFade(ctx, p, aura);
  } else {
    aura.stacks = left;
  }
  return true;
}

function consumeWintersChillCharge(ctx: SimContext, target: Entity): boolean {
  const idx = target.auras.findIndex((a) => a.kind === 'winters_chill');
  if (idx < 0) return false;
  const aura = target.auras[idx];
  const left = (aura.charges ?? 1) - 1;
  if (left <= 0) {
    target.auras.splice(idx, 1);
    emitFade(ctx, target, aura);
  } else {
    aura.charges = left;
  }
  return true;
}

/** Per-cast frozen resolution, computed ONCE at the top of runEffects (the
 *  sure_crit idiom: a multi-hit cast like Flurry shares one resolution). */
export interface FrozenCastState {
  treatAsFrozen: boolean;
  // Ice Lance's 3x against a frozen-counting target; 1 for everything else.
  damageMult: number;
}

export const INERT_FROZEN: FrozenCastState = { treatAsFrozen: false, damageMult: 1 };

/** Resolve whether this cast treats its target as frozen, spending at most
 *  one enabling state in the owner's order:
 *    1. really frozen (a root aura): spends NOTHING,
 *    2. Fingers of Frost (Ice Lance only): spends one stack,
 *    3. Winter's Chill (compatible spells): spends one charge.
 *  A really-frozen target Shatters EVERY spell (the Nova window); the proc
 *  states only empower their own spenders. Deterministic reads, no rng. */
export function resolveFrozenCast(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  ability: AbilityDef,
  target: Entity | null,
): FrozenCastState {
  if (!target || ability.school === 'physical') return INERT_FROZEN;
  if (!isCommittedFrost(ctx, meta)) return INERT_FROZEN;
  const lanceMult = ability.id === 'ice_lance' ? ICE_LANCE_FROZEN_MULT : 1;
  if (isRooted(target)) return { treatAsFrozen: true, damageMult: lanceMult };
  if (ability.id === 'ice_lance' && consumeFingersCharge(ctx, p)) {
    return { treatAsFrozen: true, damageMult: lanceMult };
  }
  if (WINTERS_CHILL_SPENDERS.has(ability.id) && consumeWintersChillCharge(ctx, target)) {
    return { treatAsFrozen: true, damageMult: lanceMult };
  }
  return INERT_FROZEN;
}

/** Post-impact rider, called once at the end of runEffects: frostbolt rolls
 *  its two procs; Flurry plants Winter's Chill on its (surviving) target.
 *  Inert for anything that is not a committed-frost mage cast. */
export function frostMageAfterCast(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  ability: AbilityDef,
  target: Entity | null,
): void {
  if (ability.class !== 'mage' || p.kind !== 'player') return;
  if (ability.id === 'frostbolt') {
    rollFrostboltProcs(ctx, p, meta);
    // Each Rimelance impact also banks an Icicle toward Glacial Spike.
    if (isCommittedFrost(ctx, meta)) gainIcicle(ctx, p);
  } else if (ability.id === 'flurry' && isCommittedFrost(ctx, meta)) {
    if (target && !target.dead) applyWintersChill(ctx, p, target);
  }
}

/** Channel-start hook (casting_lifecycle's channel block): a fresh Blizzard
 *  gets a fresh Frozen Orb refund budget. Inert for every other channel. */
export function frostMageChannelStart(p: Entity, abilityId: string): void {
  if (abilityId === 'blizzard') p.blizzardOrbCdr = 0;
}

/** Position-channel pulse hook: every enemy a Blizzard pulse struck shaves
 *  BLIZZARD_ORB_CDR_PER_ENEMY off Frozen Orb's RUNNING cooldown, at most
 *  BLIZZARD_ORB_CDR_CAP per cast (the budget frostMageChannelStart reset).
 *  Deterministic tick math, no rng; a no-op without a running orb cooldown. */
export function frostMageChannelPulse(
  ctx: SimContext,
  p: Entity,
  abilityId: string,
  struck: number,
): void {
  if (abilityId !== 'blizzard' || struck <= 0) return;
  const spent = p.blizzardOrbCdr ?? 0;
  const refund = Math.min(struck * BLIZZARD_ORB_CDR_PER_ENEMY, BLIZZARD_ORB_CDR_CAP - spent);
  if (refund <= 0) return;
  p.blizzardOrbCdr = spent + refund;
  const cur = p.cooldowns.get('frozen_orb');
  if (cur === undefined) return;
  if (cur <= refund) p.cooldowns.delete('frozen_orb');
  else p.cooldowns.set('frozen_orb', cur - refund);
}

/** Brain Freeze's cast-time override, applied in castAbility AFTER every
 *  validation gate (so a blocked cast never eats the proc) and BEFORE the
 *  cast-time/cooldown/cost reads: an armed Flurry goes instant and skips its
 *  cooldown entirely without adding another damage multiplier. */
export function applyBrainFreezeOverride(
  ctx: SimContext,
  p: Entity,
  res: ResolvedAbility,
): ResolvedAbility {
  if (res.def.id !== 'flurry') return res;
  const idx = p.auras.findIndex((a) => a.kind === 'brain_freeze');
  if (idx < 0) return res;
  const [aura] = p.auras.splice(idx, 1);
  emitFade(ctx, p, aura);
  return {
    ...res,
    castTime: 0,
    cooldown: 0,
  };
}
