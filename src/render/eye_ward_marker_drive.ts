// Deciding which creature wears the Shardpike reticle this frame, and what it says.
//
// A thin driver so `renderer.ts` gains a call and not a decision: the state ladder is in
// `eye_ward_marker_core.ts` and the meshes are in `characters/eye_ward_marker.ts`, and this
// is the only piece that needs BOTH the world's entity list and the local viewer's state.
//
// Imports `LANCE_THRUST_RANGE` from the pure `sim/lance_balance_core` leaf rather than from
// `sim/lance_trial`, which is a SimContext consumer: src/render may reach for deterministic
// sim leaves and must never reach for a sim system module (src/CLAUDE.md).

import { LANCE_THRUST_RANGE } from '../sim/lance_balance_core';
import { SHARDPIKE_ITEM_ID } from '../ui/hud/shardpike/shardpike_bar_view';
import { type EyeWardMarkerPlan, eyeWardMarkerPlan, eyeWardStateOf } from './eye_ward_marker_core';

/** The shape this driver needs off an entity; a structural subset of the wire entity. */
export interface EyeWardCandidate {
  auras?: readonly { id?: string }[];
  pos: { x: number; z: number };
  /** In bed (mob/slumber.ts): neutral and unattackable, so there is no window to read. */
  asleep?: boolean;
}

/**
 * The slice of the world the driver reads.
 *
 * Structural rather than `IWorld` so a Vitest can drive it with two fields instead of a
 * whole world, and so the renderer's call site stays one statement.
 */
export interface EyeWardWorld {
  equipment: { mainhand?: string | null };
  lanceGuidance: { sealRemaining: number } | null;
}

/**
 * The plan for one candidate, or null to draw nothing.
 *
 * EVERY viewer gets a plan for a warded boss, and that is a deliberate reversal: this used to
 * return null without the pike in hand, which correctly suppressed the aim instruction and
 * incorrectly suppressed the vulnerability state along with it. The twenty players doing the
 * damage are exactly the ones who need to know the ward is down. So the role decides what the
 * drawing SAYS (see `EyeWardMarkerRole`) rather than whether it exists.
 *
 * The seal has no aura of its own, deliberately: it is a refractory timestamp, not a state
 * the boss advertises. So it is read from the wielder's own guidance view, which is the same
 * place the HUD prompt reads it from, and the ring and the line therefore cannot disagree.
 */
export function eyeWardPlanFor(
  world: EyeWardWorld,
  viewerPos: { x: number; z: number },
  candidate: EyeWardCandidate,
): EyeWardMarkerPlan | null {
  // A sleeping boss cannot be attacked at all (Sim.isHostileTo), so a badge saying "his
  // ward is open, your damage lands" over him would be a lie the whole raid can see.
  if (candidate.asleep) return null;
  const ward = eyeWardStateOf(candidate.auras);
  if (!ward) return null;
  const wielding = world.equipment.mainhand === SHARDPIKE_ITEM_ID;
  // The seal is read from the wielder's guidance view, which only a wielder has. A viewer
  // without one cannot tell sealed from pryable, and that is fine: to them both mean
  // "shielded, keep hitting", and the state they DO need (the ward being down) is an aura
  // they can see. Never guess the seal from a missing view: reporting "pryable" to someone
  // who cannot check it is how the ring and the prompt would start disagreeing.
  const sealed = wielding && (world.lanceGuidance?.sealRemaining ?? 0) > 0;
  const dx = candidate.pos.x - viewerPos.x;
  const dz = candidate.pos.z - viewerPos.z;
  const inReach = dx * dx + dz * dz <= LANCE_THRUST_RANGE * LANCE_THRUST_RANGE;
  return eyeWardMarkerPlan(wielding ? 'aim' : 'state', ward, sealed, inReach);
}
