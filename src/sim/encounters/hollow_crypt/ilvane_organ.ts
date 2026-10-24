// Cantor Ilvane's Bone Organ (ilvane.ts): she walks to the organ's keys and
// plays; shadow notes gather in lanes down the loft floor from the pipes and
// burst, wave after wave, the second wave filling the first one's gaps. Every
// lane is an encounter object (facing = its yaw, scale = its length) that swaps
// from the gathering mark to the burst, so every client draws the telegraph
// the sim strikes. Crescendo adds a third wave and quickens the gather.
//
// Zero rng: the lanes are fixed, players walked in id order; the only draws
// are the damage rolls.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import type { IlvaneFightState } from './boss_state';
import {
  claimPlayers,
  clearCastIf,
  dropEncounterObject,
  localOf,
  mechanicDamage,
  spawnCryptObject,
  startBar,
} from './claim';
import {
  ILVANE_BONE_ORGAN,
  ILVANE_NOTE_BURST_TEMPLATE,
  ILVANE_NOTE_MARK_TEMPLATE,
  ILVANE_NOTES_BURST,
  ILVANE_TUNING,
  inNoteLane,
  NOTE_LANE_LENGTH,
  NOTE_LANE_START_Z,
  NOTE_LANE_YAW,
  NOTE_WAVES,
  ORGAN_BENCH,
} from './ilvane_ids';

const T = ILVANE_TUNING;
/** A burst lane stays drawn this long before it is gone. */
const BURST_LINGER = 0.6;

function plan(st: IlvaneFightState) {
  return st.crescendo
    ? { waves: T.organWaveAtCrescendo, gather: T.organGatherCrescendo, play: T.organPlayCrescendo }
    : { waves: T.organWaveAt, gather: T.organGather, play: T.organPlay };
}

/** She rises for the organ (the cadence and the dev trigger). */
export function beginOrgan(boss: Entity, st: IlvaneFightState): boolean {
  if (st.organ || boss.castingAbility !== null) return false;
  st.organ = { phase: 'stride', t: 0, waves: 0, lanes: [] };
  st.organTimer = T.organEvery;
  return true;
}

function holdAt(ctx: SimContext, inst: InstanceSlot, boss: Entity, x: number, z: number): void {
  const o = ctx.instanceOriginOf(inst);
  const g = ctx.groundPos(o.x + x, o.z + z);
  boss.pos.x = g.x;
  boss.pos.y = g.y;
  boss.pos.z = g.z;
  boss.swingTimer = Math.max(boss.swingTimer, 0.6);
  ctx.grid.update(boss);
}

/** One tick of the organ: the walk, the playing, the waves. Returns true while
 *  it owns her (she does nothing else meanwhile). */
export function stepOrgan(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: IlvaneFightState,
): boolean {
  const organ = st.organ;
  if (!organ) return false;
  organ.t += DT;
  if (organ.phase === 'stride') {
    const at = localOf(ctx, inst, boss);
    const dx = ORGAN_BENCH.x - at.x;
    const dz = ORGAN_BENCH.z - at.z;
    const d = Math.hypot(dx, dz);
    const step = T.organStrideSpeed * DT;
    if (d > step && organ.t < T.organStrideMax - 1e-6) {
      boss.facing = Math.atan2(dx, dz);
      holdAt(ctx, inst, boss, at.x + (dx / d) * step, at.z + (dz / d) * step);
      return true;
    }
    holdAt(ctx, inst, boss, ORGAN_BENCH.x, ORGAN_BENCH.z);
    organ.phase = 'play';
    organ.t = 0;
    startBar(boss, ILVANE_BONE_ORGAN, plan(st).play, null, true);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'shadow',
      fx: 'windup',
      ability: ILVANE_BONE_ORGAN,
    });
    return true;
  }
  holdAt(ctx, inst, boss, ORGAN_BENCH.x, ORGAN_BENCH.z);
  // Facing the pipes (+z), her back to the loft.
  boss.facing = 0;
  const p = plan(st);
  if (boss.castingAbility === ILVANE_BONE_ORGAN) boss.castRemaining = Math.max(0, p.play - organ.t);
  // Draw the waves as they come due.
  while (organ.waves < p.waves.length && organ.t >= p.waves[organ.waves] - 1e-6) {
    const wave = organ.waves % NOTE_WAVES.length;
    for (const x of NOTE_WAVES[wave]) {
      const obj = spawnCryptObject(
        ctx,
        inst,
        ILVANE_NOTE_MARK_TEMPLATE,
        'Bone Organ',
        x,
        NOTE_LANE_START_Z,
        NOTE_LANE_YAW,
        NOTE_LANE_LENGTH,
      );
      organ.lanes.push({
        objectId: obj.id,
        x,
        wave: organ.waves,
        burstAt: organ.t + p.gather,
        burst: false,
      });
    }
    organ.waves++;
  }
  // Burst the waves whose gather is over.
  const o = ctx.instanceOriginOf(inst);
  const bursting = organ.lanes.filter((l) => !l.burst && organ.t >= l.burstAt - 1e-6);
  if (bursting.length > 0) {
    for (const l of bursting) {
      l.burst = true;
      const e = ctx.entities.get(l.objectId);
      if (e) e.templateId = ILVANE_NOTE_BURST_TEMPLATE;
    }
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: bursting[0].objectId,
      school: 'shadow',
      fx: 'nova',
      ability: ILVANE_NOTES_BURST,
    });
    for (const pl of claimPlayers(ctx, inst)) {
      const lx = pl.pos.x - o.x;
      const lz = pl.pos.z - o.z;
      if (!bursting.some((l) => inNoteLane(l.x, lx, lz))) continue;
      ctx.dealDamage(
        boss,
        pl,
        mechanicDamage(ctx, boss, T.noteMin, T.noteMax),
        false,
        'shadow',
        'Bone Organ',
        'hit',
        true,
      );
    }
  }
  // A burst lane lingers a moment, then it is gone.
  organ.lanes = organ.lanes.filter((l) => {
    if (l.burst && organ.t >= l.burstAt + BURST_LINGER - 1e-6) {
      dropEncounterObject(ctx, inst, l.objectId);
      return false;
    }
    return true;
  });
  if (organ.t < p.play - 1e-6 || organ.lanes.length > 0) return true;
  endOrgan(ctx, inst, boss, st);
  return false;
}

/** The playing ends (or the fight does): the lanes go and she rises from the keys. */
export function endOrgan(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: IlvaneFightState,
): void {
  const organ = st.organ;
  if (!organ) return;
  for (const l of organ.lanes) dropEncounterObject(ctx, inst, l.objectId);
  clearCastIf(boss, ILVANE_BONE_ORGAN);
  st.organ = null;
}
