// The breath before Vael's Fog Veil: at the threshold he does not simply
// vanish. He stands still and speaks the warning that teaches the fight (the
// beacon's light is the only thing that finds him), while the fog gathers on
// the crown (the Gathering Fog bar, 2.4 s; untouchable, Shrouded), then he
// sinks into the roof (the Vanish sink, 0.8 s), and only then do the four
// figures rise out of it (vael.ts startFogVeil). Zero rng.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type VaelFightState } from '../../types';
import { clearCastIf, dropAuraById, localOf, startBar } from './claim';
import { VAEL_MIST_SURGE, VAEL_SHROUDED, VAEL_SINK, VAEL_TUNING, VAEL_VEIL_GATHER } from './ids';
import { VAEL_VEIL_LINES, vaelSay } from './vael_lines';

const T = VAEL_TUNING;

function hold(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  x: number,
  z: number,
  yaw: number,
): void {
  const o = ctx.instanceOriginOf(inst);
  const g = ctx.groundPos(o.x + x, o.z + z);
  boss.pos.x = g.x;
  boss.pos.y = g.y;
  boss.pos.z = g.z;
  boss.prevPos = { ...boss.pos };
  boss.facing = yaw;
  boss.prevFacing = yaw;
  boss.swingTimer = Math.max(boss.swingTimer, 1);
  ctx.grid.update(boss);
}

/** The fog begins to gather: he stills, speaks the warning, untouchable. */
export function startVeilGather(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VaelFightState,
): void {
  clearCastIf(boss, VAEL_MIST_SURGE);
  const at = localOf(ctx, inst, boss);
  st.gather = { elapsed: 0, sinking: false, x: at.x, z: at.z, yaw: boss.facing };
  startBar(boss, VAEL_VEIL_GATHER, T.veilGatherSeconds, null);
  ctx.applyAura(boss, {
    id: VAEL_SHROUDED,
    name: 'Shrouded',
    kind: 'buff_dr',
    remaining: T.veilGatherSeconds + T.vanishSeconds,
    duration: T.veilGatherSeconds + T.vanishSeconds,
    value: 0,
    sourceId: boss.id,
    school: 'shadow',
    undispellable: true,
  });
  boss.damageImmune = true;
  vaelSay(ctx, boss, VAEL_VEIL_LINES[Math.min(st.veils, VAEL_VEIL_LINES.length - 1)]);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'frost',
    fx: 'windup',
    ability: VAEL_VEIL_GATHER,
  });
}

/** One tick of the gathering. True on the tick the fog has him (the veil
 *  falls now: the caller starts it). */
export function stepVeilGather(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VaelFightState,
): boolean {
  const g = st.gather;
  if (!g) return false;
  g.elapsed += DT;
  hold(ctx, inst, boss, g.x, g.z, g.yaw);
  if (!g.sinking) {
    if (boss.castingAbility === VAEL_VEIL_GATHER)
      boss.castRemaining = Math.max(0, T.veilGatherSeconds - g.elapsed);
    if (g.elapsed < T.veilGatherSeconds) return false;
    clearCastIf(boss, VAEL_VEIL_GATHER);
    g.sinking = true;
    startBar(boss, VAEL_SINK, T.vanishSeconds, null);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'shadow',
      fx: 'nova',
      ability: VAEL_SINK,
    });
    return false;
  }
  if (boss.castingAbility === VAEL_SINK)
    boss.castRemaining = Math.max(0, T.veilGatherSeconds + T.vanishSeconds - g.elapsed);
  if (g.elapsed < T.veilGatherSeconds + T.vanishSeconds) return false;
  endVeilGather(boss, st);
  return true;
}

/** Drop the gathering (the veil falls, or the fight ended mid-gather). */
export function endVeilGather(boss: Entity, st: VaelFightState): void {
  if (!st.gather) return;
  st.gather = null;
  clearCastIf(boss, VAEL_VEIL_GATHER, VAEL_SINK);
  dropAuraById(boss, VAEL_SHROUDED);
  boss.damageImmune = false;
}
