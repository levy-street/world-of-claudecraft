// Heroic Grasp of the Grave (docs/design/dungeon-rework/hollow_crypt.md 5.4):
// in every act of Morthen's fight, every few seconds two players (never the
// tank while anyone else stands) get a ring on the floor under them, locked
// where they stood when it appeared; after a short fuse the grave's hands
// erupt inside it: everyone still in the ring is rooted and takes shadow. Not
// persistent (the hands let go with the root), unlike Sexton Marrow's graves;
// in his Last Rites a player rooted in front of the Reap is lost.
//
// Zero rng in the pick (pickMarkTargets hashes the victims); the only draws are
// the eruption's damage rolls, in claim-player order.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import type { MorthenFightState } from './boss_state';
import {
  claimPlayers,
  dropAuraById,
  dropEncounterObject,
  localOf,
  mechanicDamage,
  pickMarkTargets,
  spawnCryptObject,
} from './claim';
import {
  inGraspRing,
  MORTHEN_GRASP_ERUPTS,
  MORTHEN_GRASP_HANDS_TEMPLATE,
  MORTHEN_GRASP_MARK,
  MORTHEN_GRASP_ROOT,
  MORTHEN_GRASP_TEMPLATE,
  MORTHEN_TUNING,
} from './morthen_ids';

const T = MORTHEN_TUNING;

/** Mark the next Grasp of the Grave (the cadence and the dev trigger).
 *  Returns how many rings it laid. */
export function markGrasp(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MorthenFightState,
): number {
  const players = claimPlayers(ctx, inst);
  const busy = new Set<number>();
  // Never two rings on one player at once.
  for (const p of players) if (p.auras.some((a) => a.id === MORTHEN_GRASP_MARK)) busy.add(p.id);
  const marks = pickMarkTargets(boss, players, T.graspTargets, st.casts * 5 + 4, busy);
  st.casts++;
  for (const p of marks) {
    const at = localOf(ctx, inst, p);
    const obj = spawnCryptObject(
      ctx,
      inst,
      MORTHEN_GRASP_TEMPLATE,
      'Grasp of the Grave',
      at.x,
      at.z,
      0,
      T.graspRadius,
    );
    st.grasps.push({ objectId: obj.id, x: at.x, z: at.z, t: 0, erupted: false });
    dropAuraById(p, MORTHEN_GRASP_MARK);
    p.auras.push({
      id: MORTHEN_GRASP_MARK,
      name: 'Grasp of the Grave',
      kind: 'slow',
      remaining: T.graspFuse,
      duration: T.graspFuse,
      value: 1,
      // The ring's reach rides the mark, so every client paints the ring the sim erupts.
      value2: T.graspRadius,
      sourceId: boss.id,
      school: 'shadow',
      undispellable: true,
    });
  }
  return marks.length;
}

/** The hands erupt in one ring: root and shadow on everyone inside. */
function erupt(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  g: MorthenFightState['grasps'][number],
): void {
  g.erupted = true;
  g.t = 0;
  const obj = ctx.entities.get(g.objectId);
  if (obj) obj.templateId = MORTHEN_GRASP_HANDS_TEMPLATE;
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: g.objectId,
    school: 'shadow',
    fx: 'detonate',
    ability: MORTHEN_GRASP_ERUPTS,
  });
  for (const p of claimPlayers(ctx, inst)) {
    const at = localOf(ctx, inst, p);
    if (!inGraspRing(g.x, g.z, at.x, at.z)) continue;
    if (obj && p.pos.y < obj.pos.y - T.floorBand) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.graspMin, T.graspMax),
      false,
      'shadow',
      'Grasp of the Grave',
      'hit',
      true,
    );
    if (p.dead) continue;
    ctx.applyAura(p, {
      id: MORTHEN_GRASP_ROOT,
      name: 'Grasp of the Grave',
      kind: 'root',
      remaining: T.graspRootSeconds,
      duration: T.graspRootSeconds,
      value: 0,
      sourceId: boss.id,
      school: 'shadow',
    });
  }
}

/** One tick of Grasp of the Grave (heroic, every act): the cadence, the fuses,
 *  the hands letting go. */
export function stepGrasp(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MorthenFightState,
): void {
  if (inst.difficulty !== 'heroic') return;
  const keep: MorthenFightState['grasps'] = [];
  for (const g of st.grasps) {
    g.t += DT;
    if (!g.erupted) {
      if (g.t >= T.graspFuse - 1e-6) erupt(ctx, inst, boss, g);
      keep.push(g);
      continue;
    }
    if (g.t >= T.graspRootSeconds - 1e-6) dropEncounterObject(ctx, inst, g.objectId);
    else keep.push(g);
  }
  st.grasps = keep;
  st.graspTimer -= DT;
  if (st.graspTimer > 0) return;
  st.graspTimer = T.graspEvery;
  markGrasp(ctx, inst, boss, st);
}

/** Take every ring and mark away (a reset, the kill). */
export function clearGrasps(ctx: SimContext, inst: InstanceSlot, st: MorthenFightState): void {
  for (const g of st.grasps) dropEncounterObject(ctx, inst, g.objectId);
  st.grasps = [];
  for (const p of claimPlayers(ctx, inst)) dropAuraById(p, MORTHEN_GRASP_MARK);
}
