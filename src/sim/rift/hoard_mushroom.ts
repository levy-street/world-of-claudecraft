// The Mother of Mushrooms (a common/rare Buried Hoard cave boss), the
// authoritative half: when she lays her spore clouds and where, when her
// sporelings come, and her Bloated Cap on a rare map (a real mob to cut down
// before its fuse runs out, or it bursts across the room and leaves a cloud).
// The numbers are pure and shared with the renderer (hoard_mushroom_core.ts).
//
// State rides HoardBossState.mushroom; the telegraphs ride the ordinary hoard cue
// list. A spore cloud is an ordinary mark (warning, then hazard) that the boss
// engine ticks like any other; the Bloated Cap's cue is a WARNING for its whole
// fuse, so the engine's busy gate holds her back while it swells unless the
// hoard is pressing hard enough to double her mechanics. Draws no rng of its
// own: sporelings come through the shared boss add spawner.

import { MOBS } from '../data';
import { createMob } from '../entity';
import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import { riftFx } from './fx';
import {
  bloatHealth,
  bloatSwell,
  HOARD_BLOAT_CAP_TEMPLATE,
  HOARD_SPORELING_TEMPLATE,
  isMushroomLifeVariant,
  MUSHROOM,
  sporeCloudCount,
  sporeCloudPoints,
} from './hoard_mushroom_core';
import {
  HOARD_DOUBLE_MECHANIC_INTENSITY,
  hoardIntensity,
  hoardMechanicDamage,
  hoardPressure,
} from './hoard_scaling';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const HOARD_SPORE_ABILITY = 'Spore Cloud';
export const HOARD_BLOAT_ABILITY = 'Bloated Cap';

interface Bloat {
  cueId: number;
  entityId: number | null;
}

export interface HoardMushroomState {
  sporeTimer: number;
  sporelingTimer: number;
  bloatTimer: number;
  /** Casts so far: turns the spore ring and rotates whom the clouds find. */
  casts: number;
  bloat: Bloat | null;
}

type Emit = (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void;
type MarkCue = Extract<HoardBossCue, { kind: 'mark' }>;

/** Cues this module keeps alive itself (the cap's fuse and its end). */
export function isMushroomCue(cue: HoardBossCue): boolean {
  return isMushroomLifeVariant(cue.variant);
}

function mushroomState(state: HoardBossState): HoardMushroomState {
  state.mushroom ??= {
    sporeTimer: MUSHROOM.sporeFirstSec,
    sporelingTimer: MUSHROOM.sporelingFirstSec,
    bloatTimer: MUSHROOM.bloatFirstSec,
    casts: 0,
    bloat: null,
  };
  return state.mushroom;
}

function findCue(state: HoardBossState, id: number): MarkCue | undefined {
  for (const cue of state.cues) if (cue.id === id && cue.kind === 'mark') return cue;
  return undefined;
}

function dropBloatEntity(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity | undefined,
  bloat: Bloat,
): void {
  if (bloat.entityId === null) return;
  const id = bloat.entityId;
  bloat.entityId = null;
  // Whoever was attacking it is left targeting nothing, never a removed entity.
  for (const meta of ctx.players.values()) {
    const player = ctx.entities.get(meta.entityId);
    if (player && player.targetId === id) player.targetId = null;
  }
  if (ctx.entities.has(id)) ctx.dropEntity(id);
  inst.mobIds = inst.mobIds.filter((entry) => entry !== id);
  if (boss) boss.summonedIds = boss.summonedIds.filter((entry) => entry !== id);
}

function laySpores(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  held: HoardMushroomState,
  living: readonly Entity[],
  emit: Emit,
): void {
  const rare = inst.vault?.rarity !== 'common';
  const count = sporeCloudCount(rare, living.length);
  // Everyone takes a turn under a cloud: rotate the order by the cast count.
  const start = living.length > 0 ? held.casts % living.length : 0;
  const order = living.map((_, i) => living[(start + i) % living.length].pos);
  const points = sporeCloudPoints(count, boss.pos, order, held.casts);
  held.casts++;
  for (const point of points) {
    const cue: MarkCue = {
      id: state.nextCueId++,
      kind: 'mark',
      variant: 'mushroom-spore',
      phase: 'warning',
      x: point.x,
      z: point.z,
      radius: MUSHROOM.sporeRadius,
      remaining: MUSHROOM.sporeWarningSec,
      total: MUSHROOM.sporeWarningSec,
    };
    state.cues.push(cue);
    emit(ctx, inst, cue);
  }
  ctx.emit({
    type: 'spellfxAt',
    x: boss.pos.x,
    z: boss.pos.z,
    school: 'nature',
    fx: 'burst',
    ability: HOARD_SPORE_ABILITY,
    radius: 3,
    sourceId: boss.id,
  });
}

function growBloat(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  held: HoardMushroomState,
  living: readonly Entity[],
  double: boolean,
  emit: Emit,
): void {
  const template = MOBS[HOARD_BLOAT_CAP_TEMPLATE];
  if (!template) return;
  // To her side, alternating: never behind her against the wall.
  const side = held.casts % 2 === 0 ? 1 : -1;
  const angle = boss.facing + (Math.PI / 2) * side;
  const pos = ctx.groundPos(
    boss.pos.x + Math.sin(angle) * MUSHROOM.bloatDistance,
    boss.pos.z + Math.cos(angle) * MUSHROOM.bloatDistance,
  );
  const cap = createMob(ctx.nextId++, template, boss.level, pos);
  cap.maxHp = bloatHealth(boss.maxHp, living.length);
  cap.hp = cap.maxHp;
  cap.summonedAdd = true;
  cap.facing = angle + Math.PI;
  cap.prevFacing = cap.facing;
  ctx.addEntity(cap);
  boss.summonedIds.push(cap.id);
  inst.mobIds.push(cap.id);
  const fuse = double ? MUSHROOM.bloatDoubleFuseSec : MUSHROOM.bloatFuseSec;
  const cue: MarkCue = {
    id: state.nextCueId++,
    kind: 'mark',
    variant: 'mushroom-bloat',
    // Never rewritten: both sides read the swell off the shared clock.
    phase: 'warning',
    x: cap.pos.x,
    z: cap.pos.z,
    radius: MUSHROOM.bloatRadius,
    targetId: cap.id,
    remaining: fuse,
    total: fuse,
  };
  state.cues.push(cue);
  emit(ctx, inst, cue);
  held.bloat = { cueId: cue.id, entityId: cap.id };
  riftFx(ctx, cap.pos.x, cap.pos.z, 'nature', 'burst');
}

function endBloat(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  held: HoardMushroomState,
  cue: MarkCue,
  cutDown: boolean,
  players: readonly Entity[],
  emit: Emit,
): void {
  const bloat = held.bloat;
  held.bloat = null;
  // A breath before the next cloud: never a burst and a fresh cast at once.
  held.sporeTimer = Math.max(held.sporeTimer, MUSHROOM.bloatRespiteSec);
  if (bloat) dropBloatEntity(ctx, inst, boss, bloat);
  if (!cutDown) {
    for (const player of players) {
      if (player.dead) continue;
      const dx = player.pos.x - cue.x;
      const dz = player.pos.z - cue.z;
      if (dx * dx + dz * dz > cue.radius * cue.radius) continue;
      ctx.dealDamage(
        boss,
        player,
        hoardMechanicDamage(inst, MUSHROOM.bloatDamageFraction),
        false,
        'nature',
        HOARD_BLOAT_ABILITY,
        'hit',
        true,
      );
    }
    riftFx(ctx, cue.x, cue.z, 'nature', 'nova');
    // What it leaves: a cloud where it stood.
    const cloud: MarkCue = {
      id: state.nextCueId++,
      kind: 'mark',
      variant: 'mushroom-spore',
      phase: 'hazard',
      x: cue.x,
      z: cue.z,
      radius: MUSHROOM.bloatCloudRadius,
      remaining: MUSHROOM.sporeHazardSec,
      total: MUSHROOM.sporeHazardSec,
      pulseTimer: MUSHROOM.sporePulseEverySec,
    };
    state.cues.push(cloud);
    emit(ctx, inst, cloud);
  } else {
    riftFx(ctx, cue.x, cue.z, 'nature', 'burst');
  }
  cue.variant = 'mushroom-burst';
  cue.innerRadius = cutDown ? 1 : 0;
  cue.remaining = MUSHROOM.burstEndSec;
  cue.total = MUSHROOM.burstEndSec;
  emit(ctx, inst, cue);
}

/** Per tick while she is engaged (hoard_boss.ts tickSpecialKit). */
export function tickHoardMushroom(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: Emit,
): void {
  const held = mushroomState(state);
  const living = players.filter((player) => !player.dead);
  const rare = inst.vault?.rarity !== undefined && inst.vault.rarity !== 'common';
  const double = hoardIntensity(inst.vault, living.length) >= HOARD_DOUBLE_MECHANIC_INTENSITY;

  // The cap first: its fuse, or its end.
  if (held.bloat) {
    const cue = findCue(state, held.bloat.cueId);
    const cap = held.bloat.entityId === null ? undefined : ctx.entities.get(held.bloat.entityId);
    if (!cue) {
      dropBloatEntity(ctx, inst, boss, held.bloat);
      held.bloat = null;
    } else if (!cap || cap.dead || cap.hp <= 0) {
      endBloat(ctx, inst, boss, state, held, cue, true, players, emit);
    } else if (cue.remaining <= 1e-8) {
      endBloat(ctx, inst, boss, state, held, cue, false, players, emit);
    } else {
      // It swells toward the burst: the size every client draws is its own scale.
      const base = MOBS[HOARD_BLOAT_CAP_TEMPLATE]?.scale ?? 1;
      cap.scale = base * (1 + MUSHROOM.bloatSwellGrowth * bloatSwell(cue.remaining, cue.total));
    }
  }

  // Her clocks: the hoard's rarity presses them like every other boss's.
  const step = DT / hoardPressure(inst.vault).cadence;
  const enraged = boss.hp / Math.max(1, boss.maxHp) <= MUSHROOM.enrageHp;
  held.sporeTimer -= step;
  held.sporelingTimer -= step;
  if (rare && !held.bloat) held.bloatTimer -= step;

  // One thing asked at a time: a cloud still warning, or the cap swelling (unless
  // the hoard presses hard enough to let her overlap them).
  const warning = state.cues.some(
    (cue) => cue.kind === 'mark' && cue.phase === 'warning' && cue.variant === 'mushroom-spore',
  );
  if (warning || (held.bloat && !double) || living.length === 0) return;

  if (rare && !held.bloat && held.bloatTimer <= 0) {
    growBloat(ctx, inst, boss, state, held, living, double, emit);
    held.bloatTimer = MUSHROOM.bloatEverySec;
    return;
  }
  if (held.sporeTimer <= 0) {
    laySpores(ctx, inst, boss, state, held, living, emit);
    held.sporeTimer = MUSHROOM.sporeEverySec;
    return;
  }
  if (held.sporelingTimer <= 0) {
    const standing = boss.summonedIds.filter((id) => {
      const add = ctx.entities.get(id);
      return add && !add.dead && add.templateId === HOARD_SPORELING_TEMPLATE;
    }).length;
    if (standing < MUSHROOM.sporelingCap) {
      const count = double ? MUSHROOM.sporelingDoubleCount : MUSHROOM.sporelingCount;
      ctx.spawnBossAdds(
        boss,
        HOARD_SPORELING_TEMPLATE,
        Math.min(count, MUSHROOM.sporelingCap - standing),
      );
    }
    held.sporelingTimer = enraged ? MUSHROOM.sporelingEnragedEverySec : MUSHROOM.sporelingEverySec;
  }
}

/** The boss engine asks whether one of this module's cues lives on. */
export function tickHoardMushroomCue(cue: HoardBossCue): boolean {
  // The fuse is ended by the module (it reads the clock), never by the engine.
  if (cue.variant === 'mushroom-bloat') return true;
  return cue.remaining > 1e-8;
}

/** Nothing of hers outlives the fight (hoard_boss.ts clearState). */
export function clearHoardMushroom(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity | undefined,
  state: HoardBossState,
): void {
  const held = state.mushroom;
  if (!held?.bloat) return;
  dropBloatEntity(ctx, inst, boss, held.bloat);
  held.bloat = null;
}
