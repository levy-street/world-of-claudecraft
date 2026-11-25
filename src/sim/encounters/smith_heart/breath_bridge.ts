// The Wind Bridge over the chasm (Jose's call of 2026-11-25, in place of the
// Gale Crossing's pads and rides): the Storm Cornice stands a chasm forward
// of the climb's landing (content/smith_heart_layout.ts CORNICE_LANDING,
// CORNICE_WEST_CUT), and a walkable strip of packed air spans it
// (CORNICE_BRIDGE, the field's hidden `cornice_bridge` surface). Walked both
// ways on foot or mounted, by the living and by spirits.
//
//   Up            while the guardian is not fighting: its object
//                 (BRIDGE_OBJECT) stands in the claim, so every client draws
//                 it (render/smith_heart_fx/breath_bridge_fx.ts forms it over
//                 BRIDGE_TUNING.form seconds), and its strip is floor.
//   The pull      the object goes (the look dissolves over `dissolve`
//                 seconds). Any body on the strip meanwhile is carried off it
//                 to an end, gently (a slide under the shipped Riding the
//                 Gale hold, breath_shove.ts: the online client draws the
//                 server's motion): to the Cornice when it was heading there
//                 or stood nearer it, else back to the landing. Never killed
//                 by the bridge going.
//   The fight     once dissolved its strip is the void's: a living body that
//                 steps (or is blown) onto it falls (breath_void.ts
//                 fallIntoVoid, its body laid back at the strip's nearer
//                 end); a spirit is set back on the landing, where it waits
//                 like any other. The landing stays out of the fight as
//                 before (breath_void.ts tetherGuardian).
//   Back          a wipe's reset or the kill: the object returns (the look
//                 forms again) and the strip is floor at once.
//
// Ticked every tick of the claim by breath.ts tickBreathGuardian, before the
// fight's own step. Zero rng: bodies in entity-id order. Every visible state
// rides existing fields (the bridge object, the hold aura, the slide): no
// wire or IWorld change.

export { BRIDGE_OBJECT, BRIDGE_TUNING } from './breath_bridge_ids';

import { CORNICE_BRIDGE, SMITH_HEART_FIELD } from '../../content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../../instances/authored_field';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { BRIDGE_OBJECT, BRIDGE_TUNING } from './breath_bridge_ids';
import { ISLE_AURAS, ISLE_NAMES } from './breath_isle_ids';
import { corniceListeners } from './breath_scope';
import { beginShove, clearShoves, type ShoveScope, stepShoves } from './breath_shove';
import type { BreathFightState } from './breath_state';
import { fallIntoVoid, layOnFloor } from './breath_void';
import { dropFightObject, spawnFightObject } from './fight_kit';

/** The bridge's own surface id in the field (its strip over the chasm). */
const BRIDGE_SURFACE = 'cornice_bridge';

/** Is instance-local (x, z) on the bridge's strip over the chasm (not the
 *  landing's or the Cornice's floor at its ends)? Pure. */
export function onBridgeStrip(x: number, z: number): boolean {
  return authoredFieldSurfaceAt(SMITH_HEART_FIELD, x, z)?.id === BRIDGE_SURFACE;
}

/** The bridge's two floor ends a body is carried to or laid back at: just
 *  inside the landing (west) and the Cornice (east). */
export const BRIDGE_ENDS = {
  landing: { x: CORNICE_BRIDGE.from.x + 1, z: CORNICE_BRIDGE.from.z },
  cornice: { x: CORNICE_BRIDGE.to.x - 1, z: CORNICE_BRIDGE.to.z },
} as const;

/** Where a body on the strip at instance-local x, facing `facing` (sim
 *  radians: toward (sin f, cos f)), is carried: the Cornice when it heads
 *  that way or stands nearer it, else the landing. Pure. */
export function bridgeCarryEnd(x: number, facing: number): 'landing' | 'cornice' {
  const heading = Math.sin(facing);
  if (heading > 0.3) return 'cornice';
  if (heading < -0.3) return 'landing';
  const E = BRIDGE_ENDS;
  return Math.abs(E.cornice.x - x) <= Math.abs(x - E.landing.x) ? 'cornice' : 'landing';
}

/** The claim's bridge object, or null. */
function bridgeObject(ctx: SimContext, inst: InstanceSlot): Entity | null {
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (e?.templateId === BRIDGE_OBJECT) return e;
  }
  return null;
}

/** Is the claim's bridge standing (its object up)? */
export function bridgeUp(ctx: SimContext, inst: InstanceSlot): boolean {
  return bridgeObject(ctx, inst) !== null;
}

/**
 * One tick of the claim's bridge. `st` is the guardian's fight state while it
 * FIGHTS (null otherwise: the bridge stands). Returns how many raiders its
 * vanished strip took this tick (for the encounter feat).
 */
export function stepBridge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity | null,
  st: BreathFightState | null,
): number {
  const obj = bridgeObject(ctx, inst);
  if (!st || !boss) {
    if (!obj) {
      const B = CORNICE_BRIDGE;
      const mid = { x: (B.from.x + B.to.x) / 2, z: (B.from.z + B.to.z) / 2 };
      spawnFightObject(ctx, inst, BRIDGE_OBJECT, '', mid.x, mid.z, 1);
    }
    return 0;
  }
  if (obj) dropFightObject(ctx, inst, obj.id);
  const players = corniceListeners(ctx, inst);
  const scope: ShoveScope = { ctx, inst, boss, players } as ShoveScope;
  if (st.bridgeShoves.length > 0) stepShoves(scope, st.bridgeShoves);
  const dissolving = st.bridgeGone < BRIDGE_TUNING.dissolve;
  st.bridgeGone += DT;
  const o = ctx.instanceOriginOf(inst);
  let fell = 0;
  for (const p of players) {
    if (p.carriedBy !== undefined || (p.dead && !p.ghost)) continue;
    const lx = p.pos.x - o.x;
    const lz = p.pos.z - o.z;
    if (!onBridgeStrip(lx, lz)) continue;
    if (st.bridgeShoves.some((sl) => sl.id === p.id)) continue;
    if (p.ghost) {
      // A spirit waits on the landing while the fight runs.
      const L = BRIDGE_ENDS.landing;
      layOnFloor(ctx, p, o.x + L.x, o.z + L.z);
      continue;
    }
    const end = bridgeCarryEnd(lx, p.facing);
    const at = BRIDGE_ENDS[end];
    if (dissolving) {
      const ux = Math.sign(at.x - lx) || 1;
      const yards = Math.abs(at.x - lx) + 0.5;
      const shove = beginShove(
        scope,
        p,
        ux,
        0,
        yards,
        Math.max(0.4, yards / BRIDGE_TUNING.carryPace),
        'out',
        ISLE_AURAS.riding,
        ISLE_NAMES.riding,
      );
      if (shove) {
        st.bridgeShoves.push(shove);
        continue;
      }
    }
    // Gone: the strip is the void's.
    if (fallIntoVoid(ctx, p, o.x + at.x, o.z + at.z)) fell++;
  }
  return fell;
}

/** Let go of every carry (a reset). */
export function clearBridge(ctx: SimContext, st: BreathFightState): void {
  clearShoves({ ctx }, st.bridgeShoves);
}
