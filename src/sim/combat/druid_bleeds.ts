// Wildfang Cat Form bleed kit (the feral bleed rework). Cat Form plays as a
// bleed spec: builders and the stealth opener plant their own bleeds, the
// Old Blood payoff (Redharvest) speeds and lengthens those bleeds instead of
// cashing them out, Gorebite grows with every bleed it finds, and a target
// carrying three or more of them takes less healing. Every hook here is
// gated on a feral druid source, so no other class reaches an rng draw or an
// aura write through this module. A leaf module: it imports no class engine,
// so druid_engines.ts, effect_dispatch.ts and auras.ts can all call into it.
//
// The pieces:
// - Tatter: each landed Rendclaw adds a stack of a short bleed (max 5).
// - Scratch Wound: each landed Scratch swing bleeds the enemy it struck.
// - Throatrake: the Slinkstrike opener bleeds its target.
// - Red Torrent: Redharvest makes the druid's bleeds on its target tick 30%
//   faster for 8 sec, and adds 8 sec to Flense and Bloodrift, up to 16 sec
//   extra each (an inert marker on the druid carrying the target id,
//   the Bruin Rush window precedent).
// - Gorebite: +15% damage for each distinct bleed of yours on the target,
//   and it refreshes Bloodrift to its full duration.
// - Weeping Wounds: three or more of your bleeds on a target cut its healing
//   taken by 20% (a short mortal_wound refreshed by applications and ticks).
// - Bloodscent: your Cat bleeds can critically strike, and each bleed crit
//   restores 3 energy.
// - Lynxblood: bleeds applied while it is up deal 20% more for their whole
//   duration (snapshotted into the tick value at application).
// - Open Veins (row 14, the option id that used to be Blooddrunk): Bloodrift
//   also makes the target take 15% more bleed damage while it lasts.
//
// Every tuning number below is exported so the Monte Carlo harness and the
// tests read the same values the sim applies.

import type { SimContext } from '../sim_context';
import { duelJustEndedBetween } from '../social/duel';
import { abilityScalingPower, dotTickBonus } from '../spell_scaling';
import { resolveTalentHitMult } from '../talent_hit_mult';
import type { Aura, Entity } from '../types';

export const TATTER_ID = 'tatter';
export const TATTER_NAME = 'Tatter';
export const TATTER_TOTAL_PER_STACK = 8;
export const TATTER_DURATION = 8;
export const TATTER_INTERVAL = 2;
export const TATTER_MAX_STACKS = 5;
// Tatter, Scratch Wound: short, constantly refreshed bleeds. The shared
// Attack Power rider is proportional to duration per APPLICATION, so a bleed
// that is reapplied every few seconds would collect it many times over; these
// take a quarter of it.
export const SHORT_BLEED_POWER_SHARE = 0.25;

export const SCRATCH_WOUND_ID = 'scratch_wound';
export const SCRATCH_WOUND_NAME = 'Scratch Wound';
export const SCRATCH_WOUND_TOTAL = 12;
export const SCRATCH_WOUND_DURATION = 6;
export const SCRATCH_WOUND_INTERVAL = 2;

export const THROATRAKE_ID = 'throatrake';
export const THROATRAKE_NAME = 'Throatrake';
export const THROATRAKE_TOTAL = 72;
export const THROATRAKE_DURATION = 12;
export const THROATRAKE_INTERVAL = 3;

export const RED_TORRENT_ID = 'red_torrent';
export const RED_TORRENT_NAME = 'Red Torrent';
export const RED_TORRENT_DURATION = 8;
/** Bleed tick clock speed while Red Torrent covers the target (1.3 = 30% faster).
 *  Monte Carlo pass A1: Redharvest comes up about every 9 sec, so the 8 sec
 *  window is near-permanent and this rate acts as a standing bleed bonus. */
export const RED_TORRENT_TICK_RATE = 1.3;
/** Redharvest's extension of Flense and Bloodrift, per cast (content extendDot rows). */
export const REDHARVEST_EXTEND_SECONDS = 8;
/** The cap on Redharvest's extension per bleed application (extendDot maxBonus). */
export const REDHARVEST_EXTEND_CAP = 16;

export const GOREBITE_PER_BLEED_PCT = 0.15;
export const BLOODRIFT_ID = 'rip';
export const BLOODRIFT_DURATION = 24;

export const WEEPING_WOUNDS_ID = 'weeping_wounds';
export const WEEPING_WOUNDS_NAME = 'Weeping Wounds';
export const WEEPING_WOUNDS_HEAL_CUT = 0.2;
export const WEEPING_WOUNDS_MIN_BLEEDS = 3;
// Slightly longer than the slowest bleed interval (3 sec), so a target that
// keeps three bleeds never flickers out between ticks, and one that drops
// below three loses the debuff within a tick.
export const WEEPING_WOUNDS_DURATION = 3.5;

export const BLOODSCENT_ENERGY = 3;

export const LYNXBLOOD_AURA_ID = 'tigers_fury';
export const LYNXBLOOD_BLEED_MULT = 1.2;

export const OPEN_VEINS_ID = 'open_veins';
export const OPEN_VEINS_NAME = 'Open Veins';
export const OPEN_VEINS_BLEED_VULN = 0.15;
// Row 14 keeps the Blooddrunk option id so saved allocations still resolve.
export const OPEN_VEINS_TALENT_ID = 'dru_r14_savage_fury';

/** Every Cat Form bleed this kit owns (aura ids). Tatter counts once however
 *  many stacks it carries. */
export const FERAL_BLEED_IDS: ReadonlySet<string> = new Set([
  'rake',
  BLOODRIFT_ID,
  TATTER_ID,
  SCRATCH_WOUND_ID,
  THROATRAKE_ID,
]);

function feralMeta(ctx: SimContext, source: Entity | null | undefined) {
  if (source?.kind !== 'player') return null;
  const meta = ctx.players.get(source.id);
  if (meta?.cls !== 'druid') return null;
  return ctx.playerMods(meta).spec === 'feral' ? meta : null;
}

export function isFeralDruid(ctx: SimContext, source: Entity | null | undefined): boolean {
  return feralMeta(ctx, source) !== null;
}

function inCatForm(entity: Entity): boolean {
  return entity.auras.some((aura) => aura.kind === 'form_cat');
}

function isOwnFeralBleed(aura: Aura, sourceId: number): boolean {
  return aura.kind === 'dot' && aura.sourceId === sourceId && FERAL_BLEED_IDS.has(aura.id);
}

/** Distinct Cat Form bleeds `source` has on `target`. */
export function feralBleedCount(source: Pick<Entity, 'id'>, target: Pick<Entity, 'auras'>): number {
  let count = 0;
  for (const aura of target.auras) if (isOwnFeralBleed(aura, source.id)) count++;
  return count;
}

/** Lynxblood's snapshot: the multiplier a feral bleed applied right now keeps
 *  for its whole duration. 1 for every other source and every other aura. */
export function feralBleedApplyMult(ctx: SimContext, source: Entity, dotId: string): number {
  if (!FERAL_BLEED_IDS.has(dotId) || !isFeralDruid(ctx, source)) return 1;
  return source.auras.some((aura) => aura.id === LYNXBLOOD_AURA_ID && aura.sourceId === source.id)
    ? LYNXBLOOD_BLEED_MULT
    : 1;
}

/** Gorebite's damage multiplier: +15% per distinct bleed of yours on the target. */
export function gorebiteBleedMult(
  ctx: SimContext,
  source: Entity,
  target: Entity | null | undefined,
  abilityId: string,
): number {
  if (abilityId !== 'ferocious_bite' || !target || !isFeralDruid(ctx, source)) return 1;
  return 1 + GOREBITE_PER_BLEED_PCT * feralBleedCount(source, target);
}

// The tick value a kit bleed carries, scaled like Flense's own bleed (the
// 'rake' scaling ability: its talent multiplier and the spec's bleed bonus):
// the authored base per tick plus the
// shared Attack Power rider (dotTickBonus, the dot arm's arithmetic) scaled
// by `powerShare`, all under the scaling ability's talent multiplier, the
// spec's bleed bonus, and the Lynxblood snapshot.
function bleedTickValue(
  ctx: SimContext,
  source: Entity,
  scalingAbilityId: string,
  dotId: string,
  total: number,
  duration: number,
  interval: number,
  powerShare: number,
): number | null {
  const meta = feralMeta(ctx, source);
  const resolved = ctx.resolvedAbility(scalingAbilityId, source.id);
  if (!meta || !resolved) return null;
  const mods = ctx.playerMods(meta);
  const mult = resolveTalentHitMult(resolved.def, mods).dmgMult * (1 + mods.global.dotDmgPct);
  const base = (total / (duration / interval)) * mult;
  const rider =
    dotTickBonus(
      abilityScalingPower(source, resolved.def),
      resolved.def,
      duration,
      interval,
      mult,
    ) * powerShare;
  return Math.max(1, Math.round((base + rider) * feralBleedApplyMult(ctx, source, dotId)));
}

function plantBleed(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  aura: Omit<Aura, 'remaining' | 'tickTimer' | 'sourceId' | 'school' | 'kind'>,
): void {
  // A refresh keeps the running tick clock: Tatter and Scratch Wound are
  // reapplied by spammable builders, and a clock reset on every press would
  // stop a bleed refreshed faster than its interval from ever ticking.
  const live = target.auras.find(
    (existing) =>
      existing.id === aura.id && existing.sourceId === source.id && existing.kind === 'dot',
  );
  ctx.applyAura(target, {
    ...aura,
    kind: 'dot',
    remaining: aura.duration,
    tickTimer: live?.tickTimer ?? aura.tickInterval,
    sourceId: source.id,
    school: 'physical',
  });
  ctx.enterCombat(source, target);
  onFeralBleedApplied(ctx, source, target, aura.id);
}

function canBleed(ctx: SimContext, source: Entity, target: Entity | null | undefined): boolean {
  return (
    !!target &&
    !target.dead &&
    !source.dead &&
    ctx.isHostileTo(source, target) &&
    !duelJustEndedBetween(ctx, target, source) &&
    isFeralDruid(ctx, source)
  );
}

/** A landed Rendclaw adds a Tatter stack (max 5) and refreshes the stack's
 *  duration; a landed Scratch swing bleeds the enemy it struck. */
export function feralBleedOnLandedStrike(
  ctx: SimContext,
  source: Entity,
  abilityId: string,
  target: Entity | null | undefined,
): void {
  if (abilityId === 'ferocious_bite') {
    if (target && isFeralDruid(ctx, source)) refreshBloodrift(source, target);
    return;
  }
  if (abilityId !== 'claw' && abilityId !== 'scratch') return;
  if (!target || !canBleed(ctx, source, target)) return;
  if (abilityId === 'claw') {
    const perStack = bleedTickValue(
      ctx,
      source,
      'rake',
      TATTER_ID,
      TATTER_TOTAL_PER_STACK,
      TATTER_DURATION,
      TATTER_INTERVAL,
      SHORT_BLEED_POWER_SHARE,
    );
    if (perStack === null) return;
    const existing = target.auras.find(
      (aura) => aura.id === TATTER_ID && aura.sourceId === source.id,
    );
    const stacks = Math.min(TATTER_MAX_STACKS, (existing?.stacks ?? 0) + 1);
    plantBleed(ctx, source, target, {
      id: TATTER_ID,
      name: TATTER_NAME,
      duration: TATTER_DURATION,
      value: perStack * stacks,
      tickInterval: TATTER_INTERVAL,
      stacks,
    });
    return;
  }
  const tick = bleedTickValue(
    ctx,
    source,
    'rake',
    SCRATCH_WOUND_ID,
    SCRATCH_WOUND_TOTAL,
    SCRATCH_WOUND_DURATION,
    SCRATCH_WOUND_INTERVAL,
    SHORT_BLEED_POWER_SHARE,
  );
  if (tick === null) return;
  plantBleed(ctx, source, target, {
    id: SCRATCH_WOUND_ID,
    name: SCRATCH_WOUND_NAME,
    duration: SCRATCH_WOUND_DURATION,
    value: tick,
    tickInterval: SCRATCH_WOUND_INTERVAL,
  });
}

/** Slinkstrike's Throatrake: the opener bleeds its target (full Attack Power
 *  rider, it lands once per engagement). Called where the stun lands. */
export function feralBleedOnOpener(
  ctx: SimContext,
  source: Entity,
  abilityId: string,
  target: Entity | null | undefined,
): void {
  if (abilityId !== 'pounce' || !target || !canBleed(ctx, source, target)) return;
  const tick = bleedTickValue(
    ctx,
    source,
    'rake',
    THROATRAKE_ID,
    THROATRAKE_TOTAL,
    THROATRAKE_DURATION,
    THROATRAKE_INTERVAL,
    1,
  );
  if (tick === null) return;
  plantBleed(ctx, source, target, {
    id: THROATRAKE_ID,
    name: THROATRAKE_NAME,
    duration: THROATRAKE_DURATION,
    value: tick,
    tickInterval: THROATRAKE_INTERVAL,
  });
}

// Gorebite keeps Bloodrift rolling: a bleed with less than its full 24 sec
// left goes back to 24 (its snapshotted tick value is kept). A Bloodrift that
// Redharvest pushed past 24 is left alone.
function refreshBloodrift(source: Entity, target: Entity): void {
  const rip = target.auras.find(
    (aura) => aura.kind === 'dot' && aura.id === BLOODRIFT_ID && aura.sourceId === source.id,
  );
  if (!rip || rip.remaining >= BLOODRIFT_DURATION) return;
  rip.remaining = BLOODRIFT_DURATION;
  rip.duration = BLOODRIFT_DURATION;
  rip.extendedBy = 0;
}

/** After any feral bleed lands: Open Veins rides Bloodrift, and Weeping
 *  Wounds checks the bleed count. */
export function onFeralBleedApplied(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  dotId: string,
): void {
  if (!FERAL_BLEED_IDS.has(dotId) || target.dead || !isFeralDruid(ctx, source)) return;
  if (dotId === BLOODRIFT_ID && selectedRow(ctx, source, OPEN_VEINS_TALENT_ID)) {
    const rip = target.auras.find(
      (aura) => aura.kind === 'dot' && aura.id === BLOODRIFT_ID && aura.sourceId === source.id,
    );
    if (rip) {
      ctx.applyAura(target, {
        id: OPEN_VEINS_ID,
        name: OPEN_VEINS_NAME,
        kind: 'bleed_vuln',
        remaining: rip.remaining,
        duration: rip.remaining,
        value: OPEN_VEINS_BLEED_VULN,
        sourceId: source.id,
        school: 'physical',
      });
    }
  }
  refreshWeepingWounds(ctx, source, target);
}

/** Bleed tick side: refresh Weeping Wounds while the count holds. */
export function feralBleedOnTick(ctx: SimContext, source: Entity | null, victim: Entity): void {
  if (!source || source.dead || victim.dead || !isFeralDruid(ctx, source)) return;
  refreshWeepingWounds(ctx, source, victim);
}

function refreshWeepingWounds(ctx: SimContext, source: Entity, target: Entity): void {
  if (feralBleedCount(source, target) < WEEPING_WOUNDS_MIN_BLEEDS) return;
  const existing = target.auras.find(
    (aura) => aura.id === WEEPING_WOUNDS_ID && aura.sourceId === source.id,
  );
  if (existing) {
    // Refresh in place: no aura churn (and no gained/faded log spam) every tick.
    existing.remaining = WEEPING_WOUNDS_DURATION;
    existing.duration = WEEPING_WOUNDS_DURATION;
    return;
  }
  ctx.applyAura(target, {
    id: WEEPING_WOUNDS_ID,
    name: WEEPING_WOUNDS_NAME,
    kind: 'mortal_wound',
    remaining: WEEPING_WOUNDS_DURATION,
    duration: WEEPING_WOUNDS_DURATION,
    value: WEEPING_WOUNDS_HEAL_CUT,
    sourceId: source.id,
    school: 'physical',
  });
}

/** Redharvest's Red Torrent: the druid's bleeds on `target` tick faster for
 *  8 sec. An inert marker on the druid whose value is the target's id. */
export function openRedTorrent(ctx: SimContext, source: Entity, target: Entity): void {
  for (let index = source.auras.length - 1; index >= 0; index--) {
    const aura = source.auras[index];
    if (aura.id !== RED_TORRENT_ID || aura.sourceId !== source.id) continue;
    source.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: source.id, name: aura.name, gained: false });
  }
  ctx.applyAura(source, {
    id: RED_TORRENT_ID,
    name: RED_TORRENT_NAME,
    kind: 'internal_cd',
    remaining: RED_TORRENT_DURATION,
    duration: RED_TORRENT_DURATION,
    value: target.id,
    sourceId: source.id,
    school: 'physical',
  });
}

/** How fast this aura's tick clock runs this sim tick: Red Torrent's rate for a
 *  feral bleed whose owner has the window open on this victim, else 1. Pure
 *  aura reads, no rng. */
export function feralBleedTickRate(ctx: SimContext, victim: Entity, aura: Aura): number {
  if (aura.kind !== 'dot' || !FERAL_BLEED_IDS.has(aura.id)) return 1;
  const source = ctx.entities.get(aura.sourceId);
  if (!source) return 1;
  for (const marker of source.auras) {
    if (
      marker.id === RED_TORRENT_ID &&
      marker.kind === 'internal_cd' &&
      marker.value === victim.id
    ) {
      return RED_TORRENT_TICK_RATE;
    }
  }
  return 1;
}

/** Bloodscent: a feral druid's Cat bleed tick rolls the druid's melee crit
 *  (one rng draw, only for those ticks); a crit doubles the tick like a melee
 *  crit and restores 3 energy. Every other tick passes through untouched and
 *  draws nothing. */
export function feralBleedPeriodicHit(
  ctx: SimContext,
  source: Entity | null,
  aura: Aura,
  amount: number,
): { amount: number; crit: boolean } {
  if (
    !source ||
    source.dead ||
    aura.kind !== 'dot' ||
    !FERAL_BLEED_IDS.has(aura.id) ||
    !isFeralDruid(ctx, source)
  ) {
    return { amount, crit: false };
  }
  if (!ctx.rng.chance(source.critChance)) return { amount, crit: false };
  if (source.resourceType === 'energy' && inCatForm(source)) {
    source.resource = Math.min(source.maxResource, source.resource + BLOODSCENT_ENERGY);
  }
  return { amount: Math.round(amount * (2 + source.critDmgPhysBonus)), crit: true };
}

function selectedRow(ctx: SimContext, player: Entity, optionId: string): boolean {
  if (player.kind !== 'player') return false;
  const meta = ctx.players.get(player.id);
  return meta ? ctx.playerMods(meta).selected[optionId] === true : false;
}

/** Old Blood from bleeds: Cat Form banks from its own bleed ticks, at most
 *  once per this many seconds (shared across all its bleeds). */
export const OLD_BLOOD_BLEED_ICD = 3;
export const OLD_BLOOD_BLEED_ICD_KEY = 'dru_old_blood_bleed';

/** Whether this tick banks an Old Blood (and, if so, starts the ICD). */
export function feralBleedTickBanksOldBlood(source: Entity, aura: Aura): boolean {
  if (aura.kind !== 'dot' || !FERAL_BLEED_IDS.has(aura.id) || aura.sourceId !== source.id) {
    return false;
  }
  if (!inCatForm(source)) return false;
  if (!source.procState) source.procState = { counters: {}, icds: {} };
  if (source.procState.icds[OLD_BLOOD_BLEED_ICD_KEY] !== undefined) return false;
  source.procState.icds[OLD_BLOOD_BLEED_ICD_KEY] = OLD_BLOOD_BLEED_ICD;
  return true;
}
