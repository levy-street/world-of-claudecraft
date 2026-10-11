// Broodmother Vysska's COCOON (the Buried Hoard brood boss), the authoritative
// half: when she spins, whom she wraps (never the whole party, never her own
// target while anyone else will do), that the wrapped are helpless and the
// cocoon is a real mob their allies can kill, what her feeding costs and heals,
// what happens when nobody cuts them out, the lone player's brood cocoon, and
// that nothing (no stun, no cocoon) outlives the fight. The numbers are pure and
// shared with the renderer (hoard_cocoon_core.ts).
//
// State rides HoardBossState.cocoon; the telegraphs ride the ordinary hoard cue
// list (the variants are listed in the core). A cocoon's cue is a WARNING mark
// for its whole life, so the boss engine's busy gate holds her venom back while
// anyone is wrapped: the party is asked one thing at a time. Draws no rng of its
// own; a brood cocoon that HATCHES spawns her hatchlings through the shared boss
// add spawner, which rolls each one's level exactly as her egg hatch does.

import { MOBS } from '../data';
import { createMob } from '../entity';
import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import {
  BROOD_COCOON_TOTAL_SEC,
  broodCocoonHealth,
  broodHatchlings,
  COCOON,
  COCOON_TOTAL_SEC,
  cocoonCount,
  cocoonHealth,
  HOARD_BROOD_COCOON_TEMPLATE,
  HOARD_COCOONED_AURA_ID,
  HOARD_SILK_COCOON_TEMPLATE,
  isCocoonVariant,
} from './hoard_cocoon_core';
import {
  HOARD_DOUBLE_MECHANIC_INTENSITY,
  hoardIntensity,
  hoardMechanicDamage,
  hoardPressure,
} from './hoard_scaling';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const HOARD_COCOON_ABILITY = 'Cocoon';
export const HOARD_COCOON_DRAIN_ABILITY = 'Draining Silk';

/** Cadence, counted from when the last cocoon is dealt with. The hoard's rarity
 *  presses it like every other boss's clock. */
export const COCOON_FIRST_SEC = 20;
export const COCOON_EVERY_SEC = 30;

interface Cocoon {
  cueId: number;
  /** The wrapped player (null: a brood cocoon). */
  targetId: number | null;
  entityId: number | null;
  x: number;
  z: number;
  /** Free players when it was spun: what its health is scaled to. */
  free: number;
  wrapped: boolean;
  drainIn: number;
  over: boolean;
}

export interface HoardCocoonState {
  timer: number;
  cocoons: Cocoon[];
  /** Rotates whom she wraps, cast to cast. */
  casts: number;
}

type Emit = (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void;
type MarkCue = Extract<HoardBossCue, { kind: 'mark' }>;

export function isCocoonCue(cue: HoardBossCue): boolean {
  return isCocoonVariant(cue.variant);
}

function cocoonState(state: HoardBossState): HoardCocoonState {
  state.cocoon ??= { timer: COCOON_FIRST_SEC, cocoons: [], casts: 0 };
  return state.cocoon;
}

function findCue(state: HoardBossState, id: number): HoardBossCue | undefined {
  for (const cue of state.cues) if (cue.id === id) return cue;
  return undefined;
}

function release(player: Entity | undefined): void {
  if (!player) return;
  player.auras = player.auras.filter((aura) => aura.id !== HOARD_COCOONED_AURA_ID);
}

function dropCocoonEntity(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity | undefined,
  cocoon: Cocoon,
): void {
  if (cocoon.entityId === null) return;
  const id = cocoon.entityId;
  cocoon.entityId = null;
  // Whoever was attacking it is left targeting nothing, never a removed entity
  // (the convention of freeRiftFloorEntities in runs.ts).
  for (const meta of ctx.players.values()) {
    const player = ctx.entities.get(meta.entityId);
    if (player && player.targetId === id) player.targetId = null;
  }
  if (ctx.entities.has(id)) ctx.dropEntity(id);
  inst.mobIds = inst.mobIds.filter((entry) => entry !== id);
  if (boss) boss.summonedIds = boss.summonedIds.filter((entry) => entry !== id);
}

function begin(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  living: readonly Entity[],
  emit: Emit,
): void {
  const held = cocoonState(state);
  held.casts++;
  held.cocoons = [];
  const double = hoardIntensity(inst.vault, living.length) >= HOARD_DOUBLE_MECHANIC_INTENSITY;
  const count = cocoonCount(living.length, double);
  const spin = (x: number, z: number, target: Entity | null, free: number): void => {
    const total = target ? COCOON_TOTAL_SEC : BROOD_COCOON_TOTAL_SEC;
    const cue: MarkCue = {
      id: state.nextCueId++,
      kind: 'mark',
      variant: 'brood-cocoon',
      // Never rewritten: both sides read the beat off the shared clock.
      phase: 'warning',
      x,
      z,
      radius: COCOON.cocoonRadius,
      innerRadius: target ? 0 : 1,
      targetId: target?.id,
      remaining: total,
      total,
    };
    state.cues.push(cue);
    emit(ctx, inst, cue);
    held.cocoons.push({
      cueId: cue.id,
      targetId: target?.id ?? null,
      entityId: null,
      x,
      z,
      free,
      wrapped: false,
      drainIn: COCOON.drainEverySec,
      over: false,
    });
  };
  if (count === 0) {
    // Alone: nobody could cut them out, so she spins a brood cocoon between them.
    const player = living[0];
    const dx = boss.pos.x - player.pos.x;
    const dz = boss.pos.z - player.pos.z;
    const range = Math.max(1e-6, Math.hypot(dx, dz));
    const reach = Math.min(COCOON.broodDistance, range * 0.6);
    const at = ctx.groundPos(
      player.pos.x + (dx / range) * reach,
      player.pos.z + (dz / range) * reach,
    );
    spin(at.x, at.z, null, 1);
  } else {
    // Never her own target while anyone else will do: the fight keeps its tank.
    const others = living.filter((player) => player.id !== boss.aggroTargetId);
    const pool = others.length >= count ? others : living;
    // `living` is id-sorted (instancePlayers sorts); the turn walks round it.
    for (let n = 0; n < count; n++) {
      const target = pool[(held.casts + n) % pool.length];
      spin(target.pos.x, target.pos.z, target, living.length - count);
    }
  }
  held.timer = COCOON_EVERY_SEC * hoardPressure(inst.vault).cadence;
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'nature',
    fx: 'windup',
    ability: HOARD_COCOON_ABILITY,
  });
  ctx.emit({
    type: 'log',
    text:
      count === 0
        ? `${boss.name} spins a brood cocoon. Destroy it before it hatches!`
        : `${boss.name} spins her silk round a player. Cut them out before she feeds!`,
    color: '#c9e08a',
    entityId: boss.id,
  });
}

/** Over, one way or the other: its cue becomes the end (`fed`: nobody got there
 *  in time), the wrapped player is let go and the mob leaves the world. */
function finish(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  cocoon: Cocoon,
  fed: boolean,
  emit: Emit,
): void {
  cocoon.over = true;
  release(ctx.entities.get(cocoon.targetId ?? -1));
  dropCocoonEntity(ctx, inst, boss, cocoon);
  const cue = findCue(state, cocoon.cueId);
  if (cue && cue.kind === 'mark') {
    cue.variant = 'brood-cocoon-end';
    cue.x = cocoon.x;
    cue.z = cocoon.z;
    cue.innerRadius = fed ? 1 : 0;
    cue.targetId = undefined;
    cue.remaining = COCOON.endSec;
    cue.total = COCOON.endSec;
    emit(ctx, inst, cue);
  }
  ctx.emit({
    type: 'spellfxAt',
    x: cocoon.x,
    z: cocoon.z,
    school: 'nature',
    fx: 'burst',
    ability: HOARD_COCOON_ABILITY,
    radius: COCOON.cocoonRadius * 1.6,
    sourceId: boss.id,
  });
}

function spawnCocoon(ctx: SimContext, inst: RiftInstance, boss: Entity, cocoon: Cocoon): boolean {
  const brood = cocoon.targetId === null;
  const template = MOBS[brood ? HOARD_BROOD_COCOON_TEMPLATE : HOARD_SILK_COCOON_TEMPLATE];
  if (!template) return false;
  const mob = createMob(ctx.nextId++, template, boss.level, ctx.groundPos(cocoon.x, cocoon.z));
  mob.maxHp = brood ? broodCocoonHealth(boss.maxHp) : cocoonHealth(boss.maxHp, cocoon.free);
  mob.hp = mob.maxHp;
  mob.summonedAdd = true;
  mob.facing = Math.atan2(boss.pos.x - cocoon.x, boss.pos.z - cocoon.z);
  mob.prevFacing = mob.facing;
  ctx.addEntity(mob);
  boss.summonedIds.push(mob.id);
  inst.mobIds.push(mob.id);
  cocoon.entityId = mob.id;
  return true;
}

function feed(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  victim: Entity,
  fraction: number,
  healFloor: number,
): void {
  const before = victim.hp;
  // A wrapped player can do nothing about it, so her feeding alone never kills:
  // it takes them to a sliver and no further. What it costs the party is her
  // healing, and a player one stray hit from dead.
  const amount = Math.min(hoardMechanicDamage(inst, fraction), Math.floor(victim.hp) - 1);
  if (amount > 0)
    ctx.dealDamage(boss, victim, amount, false, 'nature', HOARD_COCOON_DRAIN_ABILITY, 'hit', true);
  const drunk = Math.max(0, before - victim.hp);
  const heal = Math.max(healFloor, Math.round(drunk * COCOON.drainHealShare));
  if (heal > 0 && !boss.dead)
    ctx.applyHeal(boss, boss, heal, HOARD_COCOON_DRAIN_ABILITY, null, false, false, false);
}

function tickCocoon(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  cocoon: Cocoon,
  emit: Emit,
): void {
  const cue = findCue(state, cocoon.cueId);
  if (!cue || cocoon.over) return;
  // Decimal second timers must fire on their exact fixed-step boundary.
  const elapsed = cue.total - cue.remaining + 1e-8;
  const brood = cocoon.targetId === null;
  const victim = brood ? undefined : ctx.entities.get(cocoon.targetId ?? -1);
  if (!cocoon.wrapped) {
    if (elapsed < COCOON.warningSec) return;
    if (!brood) {
      if (!victim || victim.dead) {
        // Whoever she marked died first: there is nobody to wrap.
        finish(ctx, inst, boss, state, cocoon, false, emit);
        return;
      }
      // The silk closes where they ARE, never where they were marked.
      cocoon.x = victim.pos.x;
      cocoon.z = victim.pos.z;
      cue.x = victim.pos.x;
      cue.z = victim.pos.z;
    }
    if (!spawnCocoon(ctx, inst, boss, cocoon)) {
      // No cocoon to cut means nobody may be held: never wrapped without one.
      finish(ctx, inst, boss, state, cocoon, false, emit);
      return;
    }
    cocoon.wrapped = true;
    if (victim) {
      const left = cue.remaining + 0.5;
      ctx.applyAura(victim, {
        id: HOARD_COCOONED_AURA_ID,
        name: 'Cocooned',
        kind: 'stun',
        remaining: left,
        duration: left,
        value: 0,
        sourceId: boss.id,
        school: 'nature',
        unbreakableControl: true,
      });
    }
    return;
  }
  const mob = cocoon.entityId === null ? undefined : ctx.entities.get(cocoon.entityId);
  if (!mob || mob.dead || mob.hp <= 0) {
    finish(ctx, inst, boss, state, cocoon, false, emit);
    ctx.emit({
      type: 'log',
      text: brood ? 'The brood cocoon is destroyed.' : 'The cocoon is cut open!',
      color: '#a8e6a0',
      entityId: boss.id,
    });
    return;
  }
  if (!brood && (!victim || victim.dead)) {
    finish(ctx, inst, boss, state, cocoon, true, emit);
    return;
  }
  // The engine drops a spent cue before this runs: its last live tick IS the end.
  if (cue.remaining <= DT + 1e-8) {
    if (victim) {
      feed(
        ctx,
        inst,
        boss,
        victim,
        COCOON.devourDamageFraction,
        Math.round(boss.maxHp * COCOON.devourHealFraction),
      );
    } else {
      ctx.spawnBossAdds(
        boss,
        'hoard_brood_hatchling',
        broodHatchlings(hoardPressure(inst.vault).extra),
      );
    }
    finish(ctx, inst, boss, state, cocoon, true, emit);
    ctx.emit({
      type: 'log',
      text: victim ? `${boss.name} feeds, and is healed.` : 'The brood cocoon hatches!',
      color: '#ff9a9a',
      entityId: boss.id,
    });
    return;
  }
  if (!victim) return;
  cocoon.drainIn -= DT;
  if (cocoon.drainIn > 1e-8) return;
  cocoon.drainIn += COCOON.drainEverySec;
  feed(ctx, inst, boss, victim, COCOON.drainDamageFraction, 0);
}

/** One tick of the brood kit's cocoon clock. Called only while she is engaged. */
export function tickHoardCocoon(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: Emit,
): void {
  const held = cocoonState(state);
  if (held.cocoons.length === 0) {
    held.timer -= DT;
    if (held.timer > 0) return;
    const living = players.filter((p) => !p.dead);
    if (living.length === 0) return;
    // Only into a clean room: never on top of her venom.
    if (state.cues.length > 0) return;
    begin(ctx, inst, boss, state, living, emit);
    return;
  }
  let open = 0;
  for (const cocoon of held.cocoons) {
    tickCocoon(ctx, inst, boss, state, cocoon, emit);
    if (findCue(state, cocoon.cueId)) open++;
  }
  if (open > 0) return;
  // Every cocoon is dealt with (or its cue was cleared from under it).
  for (const cocoon of held.cocoons) {
    release(ctx.entities.get(cocoon.targetId ?? -1));
    dropCocoonEntity(ctx, inst, boss, cocoon);
  }
  held.cocoons = [];
}

/** A cocoon cue's tick. The module above owns every beat; a cue only has to say
 *  whether it still lives. */
export function tickHoardCocoonCue(cue: HoardBossCue): boolean {
  return cue.remaining > 1e-8;
}

/** The fight reset or ended: nobody stays wrapped and no cocoon stays in the
 *  world (the cues already went). */
export function clearHoardCocoon(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity | undefined,
  state: HoardBossState,
): void {
  const held = state.cocoon;
  if (held) {
    for (const cocoon of held.cocoons) {
      release(ctx.entities.get(cocoon.targetId ?? -1));
      dropCocoonEntity(ctx, inst, boss, cocoon);
    }
  }
  delete state.cocoon;
}
