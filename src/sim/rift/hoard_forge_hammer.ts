// Emberforge's FORGE HAMMER (the Buried Hoard ember boss), the authoritative
// half: when it is cast, where each hammer lands, whom it crushes, whom its ring
// burns, and that nothing outlives the fight. One strike's clock, the ring and
// its gaps are pure and shared with the renderer (hoard_forge_hammer_core.ts).
//
// State rides HoardBossState.forgeHammer; the telegraphs ride the ordinary hoard
// cue list: a carrier (`ember-hammer`, the beat clock; a sweep, so it holds his
// frontal and his fire back while the hammers fall) and one `ember-hammer-strike`
// per hammer, made when its shadow appears so it lands where a player IS, never
// where they were. Draws no rng: placement and gaps are seeded from cue ids.

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import {
  FORGE_HAMMER,
  FORGE_STRIKE_TOTAL_SEC,
  forgeBeatSec,
  forgeCastTotalSec,
  forgeRingBurns,
  forgeRingRadius,
  forgeStrikeCount,
  forgeStrikeScatter,
  isForgeHammerVariant,
} from './hoard_forge_hammer_core';
import {
  HOARD_DOUBLE_MECHANIC_INTENSITY,
  hoardIntensity,
  hoardMechanicDamage,
  hoardPressure,
} from './hoard_scaling';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const HOARD_FORGE_HAMMER_ABILITY = 'Hammer of the Forge';
export const HOARD_FORGE_RING_ABILITY = 'Forgefire Ring';

/** Cadence: it takes turns with his own kit, and the hoard's rarity presses it
 *  like every other boss's clock. */
export const FORGE_HAMMER_FIRST_SEC = 12;
export const FORGE_HAMMER_EVERY_SEC = 34;

export interface HoardForgeHammerState {
  timer: number;
  carrierId: number;
  /** Shadows already begun in the live cast, how many it has in all, and how many
   *  hammers share them (two ALTERNATE at full pressure). */
  beats: number;
  strikes: number;
  hammers: number;
  /** Where the last hammer fell, so the next never falls on the same ground. */
  lastX: number;
  lastZ: number;
  /** Rotates who the hammers fall on, cast to cast. */
  casts: number;
  /** Strikes that have landed, and whom each ring has already burned. */
  landed: Set<number>;
  burned: Map<number, Set<number>>;
  /** Strikes begun while the engine was walking the cue list: they join it (and
   *  reach the clients) from this module's own tick, at their full life, so the
   *  clock a client starts is the clock the sim runs. */
  pending: HoardBossCue[];
}

type Emit = (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void;
type SweepCue = Extract<HoardBossCue, { kind: 'sweep' }>;
type MarkCue = Extract<HoardBossCue, { kind: 'mark' }>;

export function isForgeHammerCue(cue: HoardBossCue): boolean {
  return isForgeHammerVariant(cue.variant);
}

function hammerState(state: HoardBossState): HoardForgeHammerState {
  state.forgeHammer ??= {
    timer: FORGE_HAMMER_FIRST_SEC,
    carrierId: -1,
    beats: 0,
    strikes: 0,
    hammers: 1,
    lastX: Number.NaN,
    lastZ: Number.NaN,
    casts: 0,
    landed: new Set(),
    burned: new Map(),
    pending: [],
  };
  return state.forgeHammer;
}

/** One tick of the ember kit's own clock. Called only while he is engaged. */
export function tickHoardForgeHammer(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: Emit,
): void {
  const hammer = hammerState(state);
  for (const strike of hammer.pending) {
    state.cues.push(strike);
    emit(ctx, inst, strike);
  }
  hammer.pending.length = 0;
  hammer.timer -= DT;
  if (hammer.timer > 0) return;
  const living = players.filter((p) => !p.dead).length;
  if (living === 0) return;
  // Only into a room clear of his own mechanics: a ring to thread is enough to
  // ask of anyone, without his fire already on the floor.
  if (state.cues.length > 0) return;
  const pressure = hoardPressure(inst.vault);
  // Enough players in a rare enough hoard, and a SECOND hammer joins: the two
  // alternate, so a new shadow appears while the last ring is still spreading.
  hammer.hammers = hoardIntensity(inst.vault, living) >= HOARD_DOUBLE_MECHANIC_INTENSITY ? 2 : 1;
  hammer.strikes = forgeStrikeCount(pressure.extra, living) * hammer.hammers;
  hammer.beats = 0;
  hammer.lastX = Number.NaN;
  hammer.lastZ = Number.NaN;
  hammer.casts++;
  hammer.landed.clear();
  hammer.burned.clear();
  const total = forgeCastTotalSec(hammer.strikes / hammer.hammers, hammer.hammers);
  const carrier: SweepCue = {
    id: state.nextCueId++,
    kind: 'sweep',
    variant: 'ember-hammer',
    x: boss.pos.x,
    z: boss.pos.z,
    facing: boss.facing,
    radius: FORGE_HAMMER.ringMaxRadius,
    halfAngle: Math.PI,
    remaining: total,
    total,
  };
  hammer.carrierId = carrier.id;
  state.cues.push(carrier);
  emit(ctx, inst, carrier);
  hammer.timer = FORGE_HAMMER_EVERY_SEC * pressure.cadence;
  ctx.emit({
    type: 'spellfxAt',
    x: boss.pos.x,
    z: boss.pos.z,
    school: 'fire',
    fx: 'burst',
    ability: HOARD_FORGE_HAMMER_ABILITY,
    duration: FORGE_HAMMER.warningSec,
    sourceId: boss.id,
  });
  ctx.emit({
    type: 'log',
    text: `${boss.name} calls the forge hammer down. Step through the gaps in its fire!`,
    color: '#ffb36b',
    entityId: boss.id,
  });
}

/** A beat begins: a shadow appears under a player, never on the ground the last
 *  hammer struck (its ring is still spreading from there, and a player may have
 *  just stepped through a door beside it). */
function beginBeat(
  ctx: SimContext,
  inst: RiftInstance,
  state: HoardBossState,
  hammer: HoardForgeHammerState,
  living: readonly Entity[],
  emit: Emit,
): void {
  if (living.length === 0) return;
  // `living` is id-sorted (instancePlayers sorts); the turn walks round it.
  const target = living[(hammer.casts + hammer.beats) % living.length];
  const id = state.nextCueId++;
  const off = forgeStrikeScatter(id);
  let x = target.pos.x + off.x;
  let z = target.pos.z + off.z;
  if (!Number.isNaN(hammer.lastX)) {
    const dx = x - hammer.lastX;
    const dz = z - hammer.lastZ;
    const d = Math.hypot(dx, dz);
    if (d < FORGE_HAMMER.minStrikeSpacing) {
      // Pushed out along the same bearing (or a seeded one, if dead on top).
      const bearing = d > 1e-6 ? Math.atan2(dx, dz) : (id * 2.399963) % (Math.PI * 2);
      x = hammer.lastX + Math.sin(bearing) * FORGE_HAMMER.minStrikeSpacing;
      z = hammer.lastZ + Math.cos(bearing) * FORGE_HAMMER.minStrikeSpacing;
    }
  }
  const at = ctx.groundPos(x, z);
  hammer.lastX = at.x;
  hammer.lastZ = at.z;
  const strike: MarkCue = {
    id,
    kind: 'mark',
    variant: 'ember-hammer-strike',
    // Never rewritten: both sides read the beat off the shared clock.
    phase: 'warning',
    x: at.x,
    z: at.z,
    radius: FORGE_HAMMER.impactRadius,
    // Which of the alternating hammers this is: the renderer keeps them apart.
    innerRadius: hammer.beats % hammer.hammers,
    remaining: FORGE_STRIKE_TOTAL_SEC,
    total: FORGE_STRIKE_TOTAL_SEC,
  };
  hammer.pending.push(strike);
}

function land(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  cue: MarkCue,
  players: readonly Entity[],
  crushed: Set<number>,
): void {
  ctx.emit({
    type: 'spellfxAt',
    x: cue.x,
    z: cue.z,
    school: 'fire',
    fx: 'burst',
    ability: HOARD_FORGE_HAMMER_ABILITY,
    radius: FORGE_HAMMER.impactRadius,
    sourceId: boss.id,
  });
  for (const player of players) {
    if (player.dead) continue;
    if (Math.hypot(player.pos.x - cue.x, player.pos.z - cue.z) > FORGE_HAMMER.impactRadius)
      continue;
    // Crushed is punished enough: the ring this hammer throws passes them by,
    // even though the blow has thrown them into its path.
    crushed.add(player.id);
    ctx.dealDamage(
      boss,
      player,
      hoardMechanicDamage(inst, FORGE_HAMMER.impactDamageFraction),
      false,
      'fire',
      HOARD_FORGE_HAMMER_ABILITY,
      'hit',
      true,
    );
    // Thrown clear of the head. applyKnockback reads only its source's `pos`.
    ctx.applyKnockback(
      { ...boss, pos: { ...boss.pos, x: cue.x, z: cue.z } },
      player,
      FORGE_HAMMER.impactKnockback,
    );
  }
}

/** One forge-hammer cue's tick. Returns false once it is spent. */
export function tickHoardForgeHammerCue(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  cue: HoardBossCue,
  players: readonly Entity[],
  emit: Emit,
): boolean {
  const hammer = hammerState(state);
  // Decimal second timers must fire on their exact fixed-step boundary.
  const elapsed = cue.total - cue.remaining + 1e-8;
  if (cue.kind === 'sweep') {
    if (cue.id !== hammer.carrierId) return cue.remaining > 1e-8;
    const living = players.filter((p) => !p.dead);
    const beat = forgeBeatSec(hammer.hammers);
    while (hammer.beats < hammer.strikes && elapsed >= hammer.beats * beat) {
      beginBeat(ctx, inst, state, hammer, living, emit);
      hammer.beats++;
    }
    return cue.remaining > 1e-8;
  }
  if (elapsed >= FORGE_HAMMER.warningSec) {
    if (!hammer.landed.has(cue.id)) {
      hammer.landed.add(cue.id);
      const crushed = new Set<number>();
      hammer.burned.set(cue.id, crushed);
      land(ctx, inst, boss, cue, players, crushed);
    }
    const since = elapsed - FORGE_HAMMER.warningSec;
    const now = forgeRingRadius(since);
    const before = forgeRingRadius(since - DT);
    // Always a real ledger: a missing one would burn every tick, never skip.
    let burned = hammer.burned.get(cue.id);
    if (!burned) {
      burned = new Set();
      hammer.burned.set(cue.id, burned);
    }
    for (const player of players) {
      if (player.dead || burned.has(player.id)) continue;
      if (!forgeRingBurns(cue.id, cue.x, cue.z, before, now, player.pos.x, player.pos.z)) continue;
      // Once per ring: a ring that catches you has passed you.
      burned.add(player.id);
      ctx.dealDamage(
        boss,
        player,
        hoardMechanicDamage(inst, FORGE_HAMMER.ringDamageFraction),
        false,
        'fire',
        HOARD_FORGE_RING_ABILITY,
        'hit',
        true,
      );
    }
  }
  if (cue.remaining > 1e-8) return true;
  hammer.landed.delete(cue.id);
  hammer.burned.delete(cue.id);
  return false;
}

/** The fight reset or ended (the cues already went). */
export function clearHoardForgeHammer(state: HoardBossState): void {
  delete state.forgeHammer;
}
