// Druid v0.29 spec engines. Engine banks are authoritative, visible auras:
// Moongrove fills one Moontide bank toward a CHOSEN payoff (Moonsurge on the
// Moonseed button or Sunwake on the Skyfall button, either spend clears it),
// Wildfang shares Old Blood across Cat and Bruin forms, and Groveheart
// grows Verdance toward Overbloom.

import { DRUID_CHOICE_ROWS } from '../content/choice_rows_classic';
import {
  CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE,
  GROVESPRING_4PC_VERDANCE_BANK,
} from '../content/ignivar_set_bonuses';
import { scalePrimaryHealing } from '../primary_healing';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { duelJustEndedBetween } from '../social/duel';
import { primaryHealingMultiplier } from '../spec_output_tuning';
import { abilityScalingPower, dotTickBonus, hotTickBonus } from '../spell_scaling';
import { resolveTalentHitMult } from '../talent_hit_mult';
import type { Aura, AuraKind, Entity } from '../types';
import { LUNGE_ID, startLunge } from './druid_lunge';
import { wearsSetBonus } from './set_bonus_wearer';

export const MOONTIDE_ID = 'moontide';
export const OLD_BLOOD_ID = 'old_blood';
export const VERDANCE_ID = 'verdance';

export const MOONTIDE_STAGES = 3;
export const OLD_BLOOD_STAGES = 3;
export const VERDANCE_STAGES = 5;
const ENGINE_BACKING_DURATION = 3600;

export const HIGHMOON_TITHE_PCT = 0.15;
export const WILD_APEX_MULT = 1.25;
export const QUICKENING_ENERGY = 5;
export const QUICKENING_RAGE = 3;
export const QUICKENING_MANA_PCT = 0.02;
// Loping Stride: the baseline shift sprint every druid gets on any form shift
// (Wildfang kit pass 2 made it talent-free). buff_speed auras carry a
// 1+fraction multiplier (moveSpeedMult takes the max over 1), so +60% is 1.6;
// a bare 0.6 was silently discarded by the max.
export const LOPING_STRIDE_SPEED = 1.6;
export const LOPING_STRIDE_DURATION = 3;
const LOPING_STRIDE_ICD_KEY = 'dru_loping_stride';
export const LOPING_STRIDE_ICD = 20;

export const DRUID_TALENT_IDS = {
  wildshift: 'dru_r5_improved_wrath',
  longstride: 'dru_r5_ferocity',
  skylark: 'dru_r5_natures_bounty',
  highmoonTithe: 'dru_r14_moonfury',
  blooddrunk: 'dru_r14_savage_fury',
  seedspread: 'dru_r14_empowered_touch',
  naturesFury: 'dru_r20_improved_hurricane',
  wildApex: 'dru_r20_berserk',
  quickening: 'dru_r20_tranquility',
} as const;

export const DRUID_PAYOFF_IDS = new Set([
  'moonlash',
  'sunlance',
  'redharvest',
  'marrowbreak',
  'overbloom',
]);

// Longstride (row 5, mechanic druid_longstride) lengthens the baseline sprint
// and shortens its cooldown. The row option's metrics are the ONE source of
// those two numbers: the engine reads them here so the talent tooltip (which
// tests/talent_tooltip_accuracy.test.ts holds to the same metrics) cannot drift
// from what the sim applies. A missing metric falls back to the baseline value.
// Read lazily on first use and memoised, never at module load: a content
// module that one day imports combat code would otherwise crash at import
// time instead of falling back.
export const LONGSTRIDE_MECHANIC = 'druid_longstride';
export interface LongstrideMetrics {
  duration: number;
  icd: number;
}
let longstrideCache: LongstrideMetrics | null = null;
function readLongstrideMetrics(): LongstrideMetrics {
  for (const row of DRUID_CHOICE_ROWS.rows) {
    for (const option of row.options) {
      const intrinsic = option.effect.intrinsic;
      if (
        option.id !== DRUID_TALENT_IDS.longstride ||
        intrinsic?.mechanic !== LONGSTRIDE_MECHANIC
      ) {
        continue;
      }
      return {
        duration: intrinsic.metrics.duration ?? LOPING_STRIDE_DURATION,
        icd: intrinsic.metrics.icd ?? LOPING_STRIDE_ICD,
      };
    }
  }
  return { duration: LOPING_STRIDE_DURATION, icd: LOPING_STRIDE_ICD };
}
export function longstrideMetrics(): LongstrideMetrics {
  if (longstrideCache === null) longstrideCache = readLongstrideMetrics();
  return longstrideCache;
}

// Pin, the Bruin Rush to Cat Form rider (Wildfang kit pass 2). Landing Bruin
// Rush opens a short window in which Cat Form costs nothing and Pins the
// Rush target: a 50% slow for 4 sec. The window is an AURA on the druid
// rather than a new Entity field, the Colossal Might cap precedent: it rides
// the ordinary aura wire so the online client's resolvedAbility (the shared
// cost tail in combat/ability_resolution.ts) shows the free cost the server
// will bill, it expires through the aura tick, a death wipes it with every
// other aura, and it adds no field to the parity trace. Its value carries the
// Rush target's entity id, the one piece of state the rider needs.
export const BRUIN_RUSH_WINDOW_ID = 'bruin_rush_window';
export const BRUIN_RUSH_WINDOW_SECONDS = 3;
export const PIN_ID = 'pin';
export const PIN_SLOW_MULT = 0.5;
export const PIN_DURATION = 4;
// The window is opened by this ability and consumed by this shift.
const BRUIN_RUSH_ID = 'bear_charge';
const CAT_FORM_ID = 'cat_form';

// The Rush target's entity id while the window is live, else null. Reads the
// aura list only, so both the Sim and the online client mirror can ask.
export function bruinRushWindowTargetId(actor: Pick<Entity, 'auras'>): number | null {
  for (const aura of actor.auras) {
    if (aura.id === BRUIN_RUSH_WINDOW_ID && aura.kind === 'internal_cd') return aura.value;
  }
  return null;
}

// The cost tail's question: is Cat Form free for this actor right now?
export function bruinRushMakesCatFormFree(
  actor: Pick<Entity, 'auras'>,
  abilityId: string,
): boolean {
  return abilityId === CAT_FORM_ID && bruinRushWindowTargetId(actor) !== null;
}

const ENGINE_AURA_IDS = new Set([MOONTIDE_ID, OLD_BLOOD_ID, VERDANCE_ID, BRUIN_RUSH_WINDOW_ID]);
const FORM_ABILITY_IDS = new Set(['bear_form', 'cat_form', 'travel_form', 'moonkin_form']);
const MOONTIDE_BUILDER_IDS = new Set(['wrath', 'starfire', 'moonseed']);
const OLD_BLOOD_STRIKE_IDS = new Set(['claw', 'rake', 'rip', 'ferocious_bite', 'maul', 'swipe']);
const VERDANCE_SOWING_IDS = new Set(['rejuvenation', 'regrowth']);

function specOf(ctx: SimContext, player: Entity): string | null {
  if (player.kind !== 'player') return null;
  const meta = ctx.players.get(player.id);
  return meta ? ctx.playerMods(meta).spec : null;
}

function selectedRow(ctx: SimContext, player: Entity, optionId: string): boolean {
  if (player.kind !== 'player') return false;
  const meta = ctx.players.get(player.id);
  return meta ? ctx.playerMods(meta).selected[optionId] === true : false;
}

function ownedAura(player: Entity, id: string): Aura | undefined {
  return player.auras.find((aura) => aura.id === id && aura.sourceId === player.id);
}

function removeOwnedAura(ctx: SimContext, player: Entity, id: string): void {
  for (let index = player.auras.length - 1; index >= 0; index--) {
    const aura = player.auras[index];
    if (aura.id !== id || aura.sourceId !== player.id) continue;
    player.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: player.id, name: aura.name, gained: false });
  }
}

function rewardQuickening(ctx: SimContext, player: Entity): void {
  if (!selectedRow(ctx, player, DRUID_TALENT_IDS.quickening)) return;
  if (player.resourceType === 'energy') {
    player.resource = Math.min(player.maxResource, player.resource + QUICKENING_ENERGY);
  } else if (player.resourceType === 'rage') {
    player.resource = Math.min(player.maxResource, player.resource + QUICKENING_RAGE);
  } else {
    player.resource = Math.min(
      player.maxResource,
      player.resource + Math.round(player.maxResource * QUICKENING_MANA_PCT),
    );
  }
}

function setBank(
  ctx: SimContext,
  player: Entity,
  id: string,
  name: string,
  kind: AuraKind,
  stacks: number,
): void {
  const existing = ownedAura(player, id);
  if (existing) {
    existing.stacks = stacks;
    existing.remaining = ENGINE_BACKING_DURATION;
    existing.duration = ENGINE_BACKING_DURATION;
    return;
  }
  ctx.applyAura(player, {
    id,
    name,
    kind,
    remaining: ENGINE_BACKING_DURATION,
    duration: ENGINE_BACKING_DURATION,
    value: 0,
    sourceId: player.id,
    school: 'nature',
    stacks,
  });
}

function addStage(
  ctx: SimContext,
  player: Entity,
  id: string,
  name: string,
  kind: AuraKind,
  cap: number,
): void {
  const existing = ownedAura(player, id);
  const before = existing?.stacks ?? 0;
  if (before >= cap) return;
  setBank(ctx, player, id, name, kind, before + 1);
  rewardQuickening(ctx, player);
}

function seedNextEngineBank(
  ctx: SimContext,
  player: Entity,
  id: string,
  name: string,
  kind: AuraKind,
): void {
  setBank(
    ctx,
    player,
    id,
    name,
    kind,
    selectedRow(ctx, player, DRUID_TALENT_IDS.naturesFury) ? 1 : 0,
  );
}

function refundMana(player: Entity, fraction: number): void {
  if (player.resourceType !== 'mana') return;
  player.resource = Math.min(
    player.maxResource,
    player.resource + Math.round(player.maxResource * fraction),
  );
}

function inMoonwing(player: Entity): boolean {
  return player.auras.some((aura) => aura.kind === 'form_moonkin');
}

// Strip every breakable root and slow the player wears (an aura stamped
// unbreakableControl stays). Fleet Form runs this on every cast, baseline;
// the other three forms run it only with Wildshift selected. Draws no rng.
// A form button reaches this hook in BOTH directions of the shift: the
// toggle-off press that returns to caster form runs the same
// casting_lifecycle path as the shift in, so a druid rooted while in Fleet
// Form breaks the root on the way out too. Wildshift has always behaved this
// way for every form; the baseline Fleet Form arm inherits it.
function breakMovementControl(ctx: SimContext, player: Entity): void {
  for (let index = player.auras.length - 1; index >= 0; index--) {
    const aura = player.auras[index];
    if ((aura.kind !== 'root' && aura.kind !== 'slow') || aura.unbreakableControl) continue;
    player.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: player.id, name: aura.name, gained: false });
  }
}

export function druidEngineOnCast(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
  target?: Entity | null,
): void {
  if (player.kind !== 'player') return;
  const meta = ctx.players.get(player.id);
  if (meta?.cls !== 'druid') return;

  if (FORM_ABILITY_IDS.has(abilityId)) {
    // Fleet Form breaks control on its own (the classic travel-form escape:
    // 30 mana, no cooldown, and no abilities while shifted). Cat, Bruin, and
    // Moonwing keep the Wildshift gate, which is what makes the row 5 pick
    // the in-combat option: break the root without leaving your damage form.
    if (abilityId === 'travel_form' || selectedRow(ctx, player, DRUID_TALENT_IDS.wildshift)) {
      breakMovementControl(ctx, player);
    }
    // Loping Stride is baseline: every form shift sprints, no talent check.
    // Longstride only changes the two numbers (duration and cooldown).
    const longstride = selectedRow(ctx, player, DRUID_TALENT_IDS.longstride);
    const strideDuration = longstride ? longstrideMetrics().duration : LOPING_STRIDE_DURATION;
    const strideIcd = longstride ? longstrideMetrics().icd : LOPING_STRIDE_ICD;
    if (!player.procState) player.procState = { counters: {}, icds: {} };
    if (player.procState.icds[LOPING_STRIDE_ICD_KEY] === undefined) {
      player.procState.icds[LOPING_STRIDE_ICD_KEY] = strideIcd;
      ctx.applyAura(player, {
        id: 'loping_stride',
        name: 'Loping Stride',
        kind: 'buff_speed',
        remaining: strideDuration,
        duration: strideDuration,
        value: LOPING_STRIDE_SPEED,
        sourceId: player.id,
        school: 'nature',
      });
    }
  }

  // Bruin Rush opens the Pin window on its target; a Cat Form shift inside
  // the window Pins that target (never the current target) and closes it.
  // Both arms are talent-free and draw no rng.
  if (abilityId === BRUIN_RUSH_ID && target && !target.dead && ctx.isHostileTo(player, target)) {
    removeOwnedAura(ctx, player, BRUIN_RUSH_WINDOW_ID);
    ctx.applyAura(player, {
      id: BRUIN_RUSH_WINDOW_ID,
      name: 'Bruin Rush',
      kind: 'internal_cd',
      remaining: BRUIN_RUSH_WINDOW_SECONDS,
      duration: BRUIN_RUSH_WINDOW_SECONDS,
      value: target.id,
      sourceId: player.id,
      school: 'physical',
    });
  } else if (abilityId === CAT_FORM_ID) {
    const pinTargetId = bruinRushWindowTargetId(player);
    if (pinTargetId !== null) {
      removeOwnedAura(ctx, player, BRUIN_RUSH_WINDOW_ID);
      const pinTarget = ctx.entities.get(pinTargetId);
      if (pinTarget && !pinTarget.dead && ctx.isHostileTo(player, pinTarget)) {
        // Slows carry no diminishing-returns ladder in this sim (the 'slow'
        // arm of combat/effect_dispatch.ts applies Hobbling Cut and every
        // other snare at full duration); Pin rides the same kind and the
        // same rule, so it diminishes exactly as they do: not at all.
        ctx.applyAura(pinTarget, {
          id: PIN_ID,
          name: 'Pin',
          kind: 'slow',
          remaining: PIN_DURATION,
          duration: PIN_DURATION,
          value: PIN_SLOW_MULT,
          sourceId: player.id,
          school: 'physical',
        });
        ctx.enterCombat(player, pinTarget);
      }
    }
  }

  // Lunge parks its strike on the charge route the cast just started
  // (combat/druid_lunge.ts); the route's settle hook lands it on arrival.
  if (abilityId === LUNGE_ID) startLunge(ctx, player, target);

  const spec = specOf(ctx, player);
  if (spec === 'balance') {
    if (!inMoonwing(player)) return;
    // One bank, one loop: every completed Wildbolt, Skyfall, or Moonseed
    // fills the Moontide. At full tide BOTH payoff buttons arm (Moonseed
    // becomes Moonsurge, Skyfall becomes Sunwake) and either press spends.
    if (MOONTIDE_BUILDER_IDS.has(abilityId)) {
      addStage(ctx, player, MOONTIDE_ID, 'Moontide', 'moontide', MOONTIDE_STAGES);
      return;
    }
    if (abilityId === 'moonlash' || abilityId === 'sunlance') {
      // Either chosen payoff spends the whole bank; both buttons revert.
      removeOwnedAura(ctx, player, MOONTIDE_ID);
      seedNextEngineBank(ctx, player, MOONTIDE_ID, 'Moontide', 'moontide');
      if (selectedRow(ctx, player, DRUID_TALENT_IDS.highmoonTithe)) {
        refundMana(player, HIGHMOON_TITHE_PCT);
      }
    }
    return;
  }

  if (spec === 'feral' && (abilityId === 'redharvest' || abilityId === 'marrowbreak')) {
    removeOwnedAura(ctx, player, OLD_BLOOD_ID);
    if (selectedRow(ctx, player, DRUID_TALENT_IDS.naturesFury)) {
      setBank(ctx, player, OLD_BLOOD_ID, 'Old Blood', 'old_blood', 1);
    }
    // Wildfang 4pc: Redharvest plants a fresh Flense on the target. This
    // funnel runs AFTER runEffects (onCastCompleted), so the consumeDot
    // cash-out already paid and removed the old bleed: no double billing.
    // The replant is aura-only: no combo point, and the landed-strike hook
    // never fires, so it banks no Old Blood. Draws no rng.
    if (
      abilityId === 'redharvest' &&
      target &&
      !target.dead &&
      ctx.isHostileTo(player, target) &&
      wearsSetBonus(ctx, player, 'wildfang_emberhide', 4)
    ) {
      replantFlense(ctx, player, target);
    }
    return;
  }
}

export function druidEngineOnHotPlanted(ctx: SimContext, player: Entity, abilityId: string): void {
  if (!VERDANCE_SOWING_IDS.has(abilityId)) return;
  const meta = player.kind === 'player' ? ctx.players.get(player.id) : undefined;
  if (meta?.cls !== 'druid' || specOf(ctx, player) !== 'restoration') return;
  addStage(ctx, player, VERDANCE_ID, 'Verdance', 'verdance', VERDANCE_STAGES);
}

export function druidMarrowbreakUsesGuard(player: Entity, belowFrac: number): boolean {
  return player.hp < player.maxHp * belowFrac;
}

export function druidEngineOnLandedStrike(
  ctx: SimContext,
  player: Entity,
  abilityId?: string,
): void {
  if (!abilityId || !OLD_BLOOD_STRIKE_IDS.has(abilityId)) return;
  const meta = player.kind === 'player' ? ctx.players.get(player.id) : undefined;
  if (meta?.cls !== 'druid' || specOf(ctx, player) !== 'feral') return;
  addStage(ctx, player, OLD_BLOOD_ID, 'Old Blood', 'old_blood', OLD_BLOOD_STAGES);
  // Cinderbark 2pc: a landed Sweeping Claws has a 30 percent chance to bank
  // an ADDITIONAL Old Blood (one roll per landed cast: the aoe arm reports
  // here once per cast that struck anything). WEARER-ONLY rng draw, disclosed
  // by the set doc: the roll is flag-gated, so a non-wearer's stream stays
  // byte-identical. The 3-stack cap holds through addStage.
  if (
    abilityId === 'swipe' &&
    wearsSetBonus(ctx, player, 'cinderbark', 2) &&
    ctx.rng.chance(CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE)
  ) {
    addStage(ctx, player, OLD_BLOOD_ID, 'Old Blood', 'old_blood', OLD_BLOOD_STAGES);
  }
}

export function druidEngineOnBleedTick(ctx: SimContext, source: Entity | null, aura: Aura): void {
  if (
    !source ||
    source.dead ||
    aura.school !== 'physical' ||
    (aura.id !== 'rake' && aura.id !== 'rip') ||
    specOf(ctx, source) !== 'feral' ||
    !selectedRow(ctx, source, DRUID_TALENT_IDS.blooddrunk)
  ) {
    return;
  }
  addStage(ctx, source, OLD_BLOOD_ID, 'Old Blood', 'old_blood', OLD_BLOOD_STAGES);
}

export function druidEngineCombatState(ctx: SimContext, player: Entity): void {
  if (player.inCombat) return;
  if (ownedAura(player, OLD_BLOOD_ID)) removeOwnedAura(ctx, player, OLD_BLOOD_ID);
  // The Pin window is an engage tool: leaving combat closes it.
  if (ownedAura(player, BRUIN_RUSH_WINDOW_ID)) removeOwnedAura(ctx, player, BRUIN_RUSH_WINDOW_ID);
}

export function druidApexPayoffMult(ctx: SimContext, player: Entity, abilityId: string): number {
  if (!DRUID_PAYOFF_IDS.has(abilityId)) return 1;
  return selectedRow(ctx, player, DRUID_TALENT_IDS.wildApex) ? WILD_APEX_MULT : 1;
}

export function druidSeedspreadSelected(ctx: SimContext, player: Entity): boolean {
  return selectedRow(ctx, player, DRUID_TALENT_IDS.seedspread);
}

function remainingTicks(aura: Aura): number {
  const interval = aura.tickInterval ?? 1;
  const untilNextTick = aura.tickTimer ?? interval;
  return untilNextTick <= aura.remaining
    ? 1 + Math.max(0, Math.floor((aura.remaining - untilNextTick) / interval))
    : 0;
}

function replantWildbloom(ctx: SimContext, player: Entity, target: Entity): void {
  const resolved = ctx.resolvedAbility('rejuvenation', player.id);
  const hot = resolved?.effects.find((effect) => effect.type === 'hot');
  if (!resolved || !hot || hot.type !== 'hot') return;
  const meta = player.kind === 'player' ? ctx.players.get(player.id) : undefined;
  if (!meta) return;
  const mods = ctx.playerMods(meta);
  // The replant historically passed no talent/HoT multiplier on its Healing
  // Power rider, unlike a real Rejuvenation cast (effect_dispatch.ts 'hot'
  // case). Resolve the same multiplier here so the two applications agree,
  // then scale the complete tick once for the Groveheart primary factor.
  const talentHealMult = resolveTalentHitMult(resolved.def, mods).healMult;
  const hotBase = Math.max(1, Math.round(hot.total / (hot.duration / hot.interval)));
  const hotSp = hotTickBonus(
    player.healPower,
    hot.duration,
    hot.interval,
    talentHealMult * (1 + mods.global.hotHealPct),
  );
  const tickValue = scalePrimaryHealing(
    hotBase + hotSp,
    primaryHealingMultiplier(meta.cls, mods.spec),
  );
  ctx.applyAura(target, {
    id: 'rejuvenation',
    name: resolved.def.name,
    kind: 'hot',
    remaining: hot.duration,
    duration: hot.duration,
    value: tickValue,
    tickInterval: hot.interval,
    tickTimer: hot.interval,
    sourceId: player.id,
    school: resolved.def.school,
  });
}

// Wildfang 4pc: the aura-only Flense replant. Mirrors the dot arm's value
// arithmetic (effect_dispatch.ts 'dot' case) for the resolved Flense bleed:
// the authored total is already talent-baked, and the Attack Power rider is
// the same dotTickBonus the real application pays (Flense's weaponStrike is
// not a hybrid-suppressing nuke, so its bleed carries the rider). The
// equivalence is pinned by the wave's test against a REAL Flense cast on the
// same actor, so the two computations cannot drift silently. No combo award,
// no landed-strike bank, no rng.
function replantFlense(ctx: SimContext, player: Entity, target: Entity): void {
  // Mirror the dot arm's duel-end clamp (effect_dispatch 'dot'): this replant
  // runs at onCastCompleted, strictly AFTER a same-tick duel end has stripped
  // everything the caster inflicted, so without the guard it would stamp a
  // fresh hostile bleed the clear can no longer catch.
  if (duelJustEndedBetween(ctx, target, player)) return;
  const meta = player.kind === 'player' ? ctx.players.get(player.id) : undefined;
  if (!meta) return;
  const resolved = ctx.resolvedAbility('rake', player.id);
  const dot = resolved?.effects.find((effect) => effect.type === 'dot');
  if (!resolved || !dot || dot.type !== 'dot') return;
  const mods = ctx.playerMods(meta);
  const dotBase = Math.max(1, Math.round(dot.total / (dot.duration / dot.interval)));
  const dotSp = dotTickBonus(
    abilityScalingPower(player, resolved.def),
    resolved.def,
    dot.duration,
    dot.interval,
    resolveTalentHitMult(resolved.def, mods).dmgMult * (1 + mods.global.dotDmgPct),
  );
  ctx.applyAura(target, {
    id: 'rake',
    name: resolved.def.name,
    kind: 'dot',
    remaining: dot.duration,
    duration: dot.duration,
    value: dotBase + dotSp,
    tickInterval: dot.interval,
    tickTimer: dot.interval,
    sourceId: player.id,
    school: dot.school ?? resolved.def.school,
  });
  ctx.enterCombat(player, target);
}

export function resolveDruidOverbloom(
  ctx: SimContext,
  player: Entity,
  castTarget: Entity,
  harvestPct: number,
): void {
  const harvested = new Map<number, Entity>();
  for (const ally of ctx.entities.values()) {
    if (ally.dead || (ally.id !== player.id && !ctx.isFriendlyTo(player, ally))) {
      continue;
    }
    let remainingHealing = 0;
    for (let index = ally.auras.length - 1; index >= 0; index--) {
      const aura = ally.auras[index];
      if (aura.kind !== 'hot' || aura.sourceId !== player.id) continue;
      remainingHealing += aura.value * remainingTicks(aura);
      ally.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: ally.id, name: aura.name, gained: false });
    }
    if (remainingHealing <= 0) continue;
    harvested.set(ally.id, ally);
    ctx.applyHeal(
      player,
      ally,
      Math.round(remainingHealing * harvestPct * druidApexPayoffMult(ctx, player, 'overbloom')),
      'Overbloom',
      'overbloom',
      false,
      false,
    );
  }
  replantWildbloom(ctx, player, castTarget);
  if (druidSeedspreadSelected(ctx, player)) {
    for (const ally of harvested.values()) {
      if (ally.id !== castTarget.id) replantWildbloom(ctx, player, ally);
    }
  }
  if (selectedRow(ctx, player, DRUID_TALENT_IDS.naturesFury)) {
    setBank(ctx, player, VERDANCE_ID, 'Verdance', 'verdance', 1);
  }
  // Grovespring 4pc: bank 1 Verdance after the harvest resolves, placed
  // AFTER the Nature's Fury seed so the two are additive beside each other.
  // setBank(current + 1) DIRECTLY, never addStage: addStage would silently
  // pay Quickening's per-stage reward on top of the promised bank. The
  // replants above go through ctx.applyAura, never the hot-planted hook, so
  // neither Seedspread nor this bank can self-arm. Draws no rng.
  if (wearsSetBonus(ctx, player, 'grovespring', 4)) {
    const current = ownedAura(player, VERDANCE_ID)?.stacks ?? 0;
    setBank(
      ctx,
      player,
      VERDANCE_ID,
      'Verdance',
      'verdance',
      Math.min(VERDANCE_STAGES, current + GROVESPRING_4PC_VERDANCE_BANK),
    );
  }
}

export function cleanDruidEngineState(
  ctx: SimContext,
  player: Entity,
  _previousSpec: string | null,
  _nextSpec: string | null,
): void {
  for (let index = player.auras.length - 1; index >= 0; index--) {
    const aura = player.auras[index];
    if (aura.sourceId !== player.id || !ENGINE_AURA_IDS.has(aura.id)) continue;
    player.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: player.id, name: aura.name, gained: false });
  }
  if (player.procState) delete player.procState.icds[LOPING_STRIDE_ICD_KEY];
}

export type DruidEngineMeta = PlayerMeta;
