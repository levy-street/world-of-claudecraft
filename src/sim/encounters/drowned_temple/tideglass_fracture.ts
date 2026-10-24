// The Tideglass Colossus's Tideglass Fracture (tideglass_colossus.ts calls in):
// the Prism Terrace's floor splits into eight slices of sea-glass round its
// centre, like a pie. A 1.5 s bar while the floor cracks, then three rounds:
// some slices glow red and the rest run clear; a moment later the red ones
// (and the hub under the plinth) detonate. Each round's clear slices were red
// the round before, so the group moves one slice over every round. The
// pattern is the fixed table in ids.ts (FRACTURE_SAFE_PATTERNS) turned by a
// hashed rotation per cast, so every cast differs and every host agrees.
//
// The state rides eight encounter objects (one per slice: its facing the
// slice's middle heading, its scale the reach, its template crack, red or
// safe), so the online client draws exactly what the sim tests. Zero rng
// beyond the damage rolls.

import { kitHash } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { type ColossusFightState, DT, type Entity } from '../../types';
import {
  claimPlayers,
  clearCastOf,
  dropEncounterObject,
  mechanicDamage,
  spawnTempleObject,
  startCast,
} from './claim';
import {
  COLOSSUS_TIDEGLASS_FRACTURE,
  COLOSSUS_TUNING,
  FRACTURE_BURST,
  FRACTURE_REACH,
  FRACTURE_ROUNDS,
  FRACTURE_SLICES,
  FRACTURE_TEMPLATES,
  fractureHits,
  fractureSafeSlices,
  fractureSliceYaw,
  TERRACE,
} from './ids';

const T = COLOSSUS_TUNING;

/** Seconds from a round's colours showing to its detonation. */
export function fractureWarn(heroic: boolean): number {
  return heroic ? T.fractureWarnHeroic : T.fractureWarn;
}

/** The whole planted channel: the cracking bar, then every round. */
export function fractureChannel(heroic: boolean): number {
  return T.fractureCast + FRACTURE_ROUNDS * fractureWarn(heroic);
}

/** The floor cracks: eight slice objects and the long planted channel. */
export function startFracture(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: ColossusFightState,
): boolean {
  if (st.fracture) return false;
  st.fractures++;
  const rot = kitHash(boss.id, st.fractures * 19 + 7) % FRACTURE_SLICES;
  const objectIds: number[] = [];
  for (let i = 0; i < FRACTURE_SLICES; i++) {
    const obj = spawnTempleObject(
      ctx,
      inst,
      FRACTURE_TEMPLATES.crack,
      'Tideglass Fracture',
      TERRACE.x,
      TERRACE.z,
      FRACTURE_REACH,
    );
    obj.facing = fractureSliceYaw(i);
    obj.prevFacing = obj.facing;
    objectIds.push(obj.id);
  }
  const heroic = inst.difficulty === 'heroic';
  startCast(boss, COLOSSUS_TIDEGLASS_FRACTURE, fractureChannel(heroic), null, true);
  st.fracture = { round: -1, timer: T.fractureCast, rot, objectIds };
  return true;
}

/** Paint round `round`'s colours on the slice objects. */
function paintRound(ctx: SimContext, st: ColossusFightState, round: number): void {
  const f = st.fracture;
  if (!f) return;
  const safe = fractureSafeSlices(round, f.rot);
  f.objectIds.forEach((id, i) => {
    const obj = ctx.entities.get(id);
    if (obj) obj.templateId = safe.includes(i) ? FRACTURE_TEMPLATES.safe : FRACTURE_TEMPLATES.red;
  });
}

/** The red slices (and the hub) of round `round` detonate. */
function detonate(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: ColossusFightState,
  round: number,
): void {
  const f = st.fracture;
  if (!f) return;
  const safe = fractureSafeSlices(round, f.rot);
  f.objectIds.forEach((id, i) => {
    if (safe.includes(i)) return;
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: id,
      school: 'arcane',
      fx: 'nova',
      ability: FRACTURE_BURST,
    });
  });
  const o = ctx.instanceOriginOf(inst);
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || !fractureHits(round, f.rot, p.pos.x - o.x, p.pos.z - o.z)) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.fractureMin, T.fractureMax),
      false,
      'arcane',
      'Tideglass Fracture',
      'hit',
      true,
    );
  }
}

/** The slices fade (the channel ran out, or the fight ended). */
export function endFracture(ctx: SimContext, inst: InstanceSlot, st: ColossusFightState): void {
  if (!st.fracture) return;
  for (const id of st.fracture.objectIds) dropEncounterObject(ctx, inst, id);
  st.fracture = null;
}

/** One tick of a running Fracture (its bar is the boss's live channel). */
export function stepFracture(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: ColossusFightState,
): void {
  const f = st.fracture;
  if (!f) {
    clearCastOf(boss, COLOSSUS_TIDEGLASS_FRACTURE);
    return;
  }
  boss.castRemaining = Math.max(0, boss.castRemaining - DT);
  f.timer -= DT;
  if (f.timer > 1e-6) return;
  if (f.round >= 0) detonate(ctx, inst, boss, st, f.round);
  f.round++;
  if (f.round < FRACTURE_ROUNDS) {
    paintRound(ctx, st, f.round);
    f.timer += fractureWarn(inst.difficulty === 'heroic');
    return;
  }
  endFracture(ctx, inst, st);
  clearCastOf(boss, COLOSSUS_TIDEGLASS_FRACTURE);
}
