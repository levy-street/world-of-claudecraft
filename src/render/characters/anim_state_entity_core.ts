/** Entity-state overrides on a derived AnimState.
 *
 * The renderer's per-entity sync loop fills an AnimState from DISPLAYED motion
 * (speed, gait, airborne, water depth). A few facts about the entity itself then
 * override what that motion implies, and they are collected here rather than
 * inline in the coordinator: it is one nameable job, it is pure, and buried in
 * the sync loop none of it could be tested directly.
 *
 * Node-only (RENDER_PURE_CORES): no three.js, no DOM.
 */
import type { AnimState } from './anim_state';

/** The entity facts the overrides read. A structural subset of sim `Entity`, so
 *  the live entity satisfies it directly and a test can pass a literal. */
export interface AnimOverrideFacts {
  /** The mob's live aggro target, or null. Present on both hosts: the sim sets
   *  it, the server wires it as `aggro`, and ClientWorld mirrors it. */
  aggroTargetId: number | null;
  /** Rift ice-slide in progress (the sim glides the body at speed). Optional to
   *  match `Entity`, where it is only set on a sliding player. */
  riftSliding?: boolean;
}

/** Mutates `st` in place. Called once per entity per frame, so it allocates
 *  nothing and takes the facts by reference rather than cloning the state. */
export function applyEntityAnimOverrides(
  st: AnimState,
  e: AnimOverrideFacts,
  visuallyDead: boolean,
): void {
  // Engaged with someone: a rig that ships a battle stance holds it between
  // swings instead of relaxing into its idle. Reading the aggro target (rather
  // than `inCombat`, which is server-only: net/online.ts stubs it false) keeps
  // this identical on both hosts with no new wire traffic, so peers brace the
  // same way. Players have no stance clip today, and they carry their selection
  // in targetId rather than aggroTargetId, so they are unaffected either way.
  st.combat = e.aggroTargetId !== null && !visuallyDead;
  // Ice slide: the sim glides the player at speed but they should read as FROZEN
  // (gliding stiff on the ice), not sprinting. Suppress locomotion + airborne so
  // the state machine holds a static pose while they slide. Last, so it also
  // wins over the engagement flag above: a warlord shoved onto the ice slides
  // stiff rather than sliding in his fighting stance.
  if (e.riftSliding && !visuallyDead) {
    st.moving = false;
    st.running = false;
    st.airborne = false;
    st.combat = false;
  }
}
