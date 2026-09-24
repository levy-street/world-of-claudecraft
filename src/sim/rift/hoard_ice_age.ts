// Hoarfrost's ICE AGE (the Buried Hoard frost boss), the authoritative half:
// when it is cast, where the icicles land, who they crush, who the storm kills,
// and that nothing outlives the fight. The timeline, the placement and the cover
// test are pure and shared with the renderer (hoard_ice_age_core.ts).
//
// State rides HoardBossState.iceAge; the telegraphs ride the ordinary hoard cue
// list (one carrier, one cue per pillar, all with the same life), so views, the
// online mirror and cleanup (clearState drops the whole list and tells every
// client to clear) need nothing new. Draws no rng: a cast's pillars are seeded
// from its cue id.
//
// ORDER AT THE BLAST (never the other way round): the cast completes, every
// living player is tested against the pillars, the exposed take lethal damage,
// and only then do the pillars break. They are cues with a fixed life that ends
// after the blast, so cover cannot vanish before it is judged.

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import { hoardBossKit } from './hoard_boss_kits';
import { HOARD_CAST_ICE_AGE } from './hoard_control_cast_ids';
import {
  ICE_AGE,
  iceAgeSheltered,
  iceAgeTimeline,
  iceAgeTotalSec,
  icePillarCount,
  icePillarOffsets,
  isIceAgeVariant,
} from './hoard_ice_age_core';
import { measureHoardRoom } from './hoard_room';
import { hoardMechanicDamage, hoardPressure } from './hoard_scaling';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const HOARD_ICE_AGE_ABILITY = 'Ice Age';
export const HOARD_ICICLE_ABILITY = 'Falling Icicle';

/** Cadence. A survival beat, not floor pressure: rare enough that each one is an
 *  event, and the hoard's rarity presses it like every other boss's clock. */
export const ICE_AGE_FIRST_SEC = 18;
export const ICE_AGE_EVERY_SEC = 46;

export interface HoardIceAgeState {
  timer: number;
  /** The live cast's beats, each resolved exactly once. */
  carrierId: number;
  impacted: boolean;
  casting: boolean;
  blasted: boolean;
}

type Emit = (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void;
type SweepCue = Extract<HoardBossCue, { kind: 'sweep' }>;

export function isIceAgeCue(cue: HoardBossCue): boolean {
  return isIceAgeVariant(cue.variant);
}

function iceAgeState(state: HoardBossState): HoardIceAgeState {
  state.iceAge ??= {
    timer: ICE_AGE_FIRST_SEC,
    carrierId: -1,
    impacted: false,
    casting: false,
    blasted: false,
  };
  return state.iceAge;
}

function clearCast(boss: Entity | undefined): void {
  if (!boss || boss.castingAbility !== HOARD_CAST_ICE_AGE) return;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
}

function startIceAge(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  living: number,
  emit: Emit,
): void {
  const ice = iceAgeState(state);
  const pressure = hoardPressure(inst.vault);
  const total = iceAgeTotalSec(pressure.speed);
  const room = measureHoardRoom(
    inst,
    boss,
    ICE_AGE.pillarRadius + ICE_AGE.wallMargin,
    ICE_AGE.pillarMaxBossDistance + ICE_AGE.wallMargin,
  );
  const carrier: SweepCue = {
    id: state.nextCueId++,
    kind: 'sweep',
    variant: 'frost-iceage',
    x: boss.pos.x,
    z: boss.pos.z,
    facing: boss.facing,
    radius: ICE_AGE.stormReach,
    halfAngle: Math.PI,
    remaining: total,
    total,
  };
  ice.carrierId = carrier.id;
  ice.impacted = false;
  ice.casting = false;
  ice.blasted = false;
  state.cues.push(carrier);
  emit(ctx, inst, carrier);
  const offsets = icePillarOffsets(
    icePillarCount(living, pressure.extra),
    carrier.id,
    room.halfWidth,
    room.clearDepth,
  );
  for (const offset of offsets) {
    const pillar: HoardBossCue = {
      id: state.nextCueId++,
      kind: 'mark',
      variant: 'frost-pillar',
      // Never rewritten: the renderer and the sim both read the beat off the
      // shared clock, so an offline view and an online mirror can never disagree.
      phase: 'warning',
      x: boss.pos.x + offset.x,
      z: boss.pos.z + room.forwardSign * offset.f,
      radius: ICE_AGE.pillarRadius,
      remaining: total,
      total,
    };
    state.cues.push(pillar);
    emit(ctx, inst, pillar);
  }
  ctx.emit({
    type: 'log',
    text: `${boss.name} tears great icicles from the ceiling. Get clear of the shadows!`,
    color: '#a8e6ff',
    entityId: boss.id,
  });
}

/** One tick of the frost kit's own clock. Called only while Hoarfrost is engaged. */
export function tickHoardIceAge(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: Emit,
): void {
  const ice = iceAgeState(state);
  ice.timer -= DT;
  if (ice.timer > 0) return;
  const living = players.filter((p) => !p.dead).length;
  if (living === 0) return;
  // Only into a room clear of HIS OWN mechanics: no gust mid-swing, no ice or
  // blizzard left on the floor. Reaching cover is the whole challenge. The clock
  // keeps running while it waits (and through the cast itself), so it fires on
  // the first clean tick; the rarity cadence is applied once, at the reset below.
  if (state.cues.length > 0) return;
  startIceAge(ctx, inst, boss, state, living, emit);
  ice.timer = ICE_AGE_EVERY_SEC * hoardPressure(inst.vault).cadence;
}

function landIcicles(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
): void {
  for (const cue of state.cues) {
    if (cue.variant !== 'frost-pillar' || cue.kind !== 'mark') continue;
    ctx.emit({
      type: 'spellfxAt',
      x: cue.x,
      z: cue.z,
      school: 'frost',
      fx: 'burst',
      ability: HOARD_ICICLE_ABILITY,
      radius: ICE_AGE.impactRadius,
      sourceId: boss.id,
    });
    for (const player of players) {
      if (player.dead) continue;
      if (Math.hypot(player.pos.x - cue.x, player.pos.z - cue.z) > ICE_AGE.impactRadius) continue;
      ctx.dealDamage(
        boss,
        player,
        hoardMechanicDamage(inst, ICE_AGE.impactDamageFraction),
        false,
        'frost',
        HOARD_ICICLE_ABILITY,
        'hit',
        true,
      );
      // Thrown clear of where the pillar now stands. applyKnockback reads only
      // its source's `pos`, so the boss standing at the pillar is all it needs.
      ctx.applyKnockback(
        { ...boss, pos: { ...boss.pos, x: cue.x, z: cue.z } },
        player,
        ICE_AGE.impactKnockback,
      );
    }
  }
}

function blast(
  ctx: SimContext,
  boss: Entity,
  carrier: SweepCue,
  state: HoardBossState,
  players: readonly Entity[],
): void {
  const pillars: Array<{ x: number; z: number }> = [];
  for (const cue of state.cues) {
    if (cue.variant === 'frost-pillar' && cue.remaining > 0) pillars.push(cue);
  }
  for (const player of players) {
    if (player.dead) continue;
    if (iceAgeSheltered(carrier.x, carrier.z, pillars, player.pos.x, player.pos.z)) continue;
    ctx.emit({
      type: 'spellfxAt',
      x: player.pos.x,
      z: player.pos.z,
      school: 'frost',
      fx: 'burst',
      ability: HOARD_ICE_AGE_ABILITY,
      radius: 2.2,
      sourceId: boss.id,
    });
    ctx.dealDamage(
      boss,
      player,
      Math.round(player.maxHp * ICE_AGE.lethalHealthMultiplier),
      false,
      'frost',
      HOARD_ICE_AGE_ABILITY,
      'hit',
      true,
    );
  }
}

/** One Ice Age cue's tick. Returns false once it is spent. The carrier owns every
 *  beat; a pillar cue only stands there until its life (the same life) runs out. */
export function tickHoardIceAgeCue(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  cue: HoardBossCue,
  players: readonly Entity[],
): boolean {
  if (cue.variant !== 'frost-iceage' || cue.kind !== 'sweep') return cue.remaining > 1e-8;
  const ice = iceAgeState(state);
  if (ice.carrierId !== cue.id) return cue.remaining > 1e-8;
  const line = iceAgeTimeline(cue.total);
  // Decimal second timers must fire on their exact fixed-step boundary.
  const elapsed = cue.total - cue.remaining + 1e-8;
  if (!ice.impacted && elapsed >= line.impactAt) {
    ice.impacted = true;
    landIcicles(ctx, inst, boss, state, players);
  }
  if (!ice.casting && !ice.blasted && elapsed >= line.castAt) {
    ice.casting = true;
    boss.castingAbility = HOARD_CAST_ICE_AGE;
    boss.castTotal = line.castSec;
    boss.castTargetId = null;
    ctx.emit({
      type: 'log',
      text: `${boss.name} begins to cast Ice Age. Get behind an ice pillar!`,
      color: '#a8e6ff',
      entityId: boss.id,
    });
  }
  // Only while the bar is still his Ice Age: never onto a cast something else set.
  if (ice.casting && boss.castingAbility === HOARD_CAST_ICE_AGE)
    boss.castRemaining = Math.max(0, line.blastAt - elapsed);
  if (!ice.blasted && elapsed >= line.blastAt) {
    ice.blasted = true;
    ice.casting = false;
    clearCast(boss);
    blast(ctx, boss, cue, state, players);
  }
  return cue.remaining > 1e-8;
}

/** Hoarfrost stands where he cast for the whole sequence: the storm blows from
 *  that spot, so the lee the players read off the floor must not move. He holds
 *  his swings while he channels. Scoped to the hoard boss, after normal target
 *  and leash checks. */
export function holdHoardIceAge(ctx: SimContext, mob: Entity): boolean {
  if (hoardBossKit(mob.templateId) !== 'frost') return false;
  const inst = ctx.riftInstances.find(
    (entry) => entry.vault && entry.partyKey !== null && entry.bossId === mob.id,
  );
  const cues = inst?.hoardBoss?.cues;
  if (!cues) return false;
  for (const cue of cues) {
    if (cue.remaining <= 0 || cue.variant !== 'frost-iceage') continue;
    mob.pos.x = cue.x;
    mob.pos.z = cue.z;
    if (mob.castingAbility === HOARD_CAST_ICE_AGE) mob.swingTimer = Math.max(mob.swingTimer, 0.5);
    return true;
  }
  return false;
}

/** The fight reset or ended: the cast bar goes with it (the cues already went). */
export function clearHoardIceAge(boss: Entity | undefined, state: HoardBossState): void {
  clearCast(boss);
  delete state.iceAge;
}
