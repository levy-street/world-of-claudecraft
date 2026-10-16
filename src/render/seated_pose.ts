// The renderer's hook for bodies sitting on seats (the pure state machine is
// seated_pose_core.ts; the seats are src/sim/seat_anchor.ts). Two calls per drawn body per
// frame, both no-ops for a body nowhere near a seat:
//  - applySeatedPose (from deck_frame.ts entityRenderPose): moves the drawn pose onto the
//    seat, or along the walk in and out, keyed by the renderer's view object;
//  - applySeatAnim (from the renderer's animation-state fill): the seat facts for the
//    clip choice (AnimState.seat), the walk while stepping in or out, and the rig root's
//    lift onto the seat surface (applied to the rig root, not the view group, so the
//    group's step smoothing never sees a seat as a kerb to ease over).
// The seats of the active world come from src/sim/seat_registry.ts, the same list the sim
// checks occupancy against, so what is drawn is what the server holds.

import type { Object3D } from 'three';
import { TAVERN_PATRONS } from '../sim/content/mirefen_tavern_patrons';
import { activeSeats } from '../sim/seat_registry';
import type { Entity } from '../sim/types';
import type { AnimState } from './characters/anim_state';
import {
  createSeatViewState,
  heldSeatForDraw,
  type SeatIdleKind,
  type SeatViewState,
  stepSeatView,
} from './seated_pose_core';

interface SeatViewSlot {
  state: SeatViewState;
  lastMs: number;
  /** The capes hidden while this body sits (and the rig they belong to). */
  capes: { root: Object3D; nodes: Object3D[] } | null;
}

/** A cape or a back piece: rigid, it would pass through the seat behind a seated body
 *  (the class rigs' `*_Cape`, the composed body's `Armor_<set>_Back` parts). */
const CAPE_NODE = /^Armor_[A-Za-z]+_Back\d*$|_Cape$/;

/** Hide a seated body's capes (only those showing), or show again the ones it hid. */
function setCapesHidden(slot: SeatViewSlot, root: Object3D, hidden: boolean): void {
  if (slot.capes && slot.capes.root !== root) slot.capes = null; // the rig was rebuilt
  if (hidden) {
    if (slot.capes) return;
    const nodes: Object3D[] = [];
    root.traverse((o) => {
      if (o.visible && CAPE_NODE.test(o.name)) nodes.push(o);
    });
    for (const o of nodes) o.visible = false;
    slot.capes = { root, nodes };
  } else if (slot.capes) {
    for (const o of slot.capes.nodes) o.visible = true;
    slot.capes = null;
  }
}

const slots = new WeakMap<object, SeatViewSlot>();
/** A frame gap longer than this (a hidden tab, a hitch) is not animated through. */
const MAX_STEP_SECONDS = 0.25;

const PATRON_IDLE: ReadonlyMap<string, SeatIdleKind> = new Map(
  TAVERN_PATRONS.map((p) => [p.npcId, p.idle]),
);

function isSeated(e: Entity): boolean {
  return e.sitting || e.eating !== null || e.drinking !== null;
}

function idleOf(e: Entity): SeatIdleKind {
  if (e.kind === 'npc') return PATRON_IDLE.get(e.templateId) ?? 'rest';
  return e.eating !== null || e.drinking !== null ? 'drink' : 'rest';
}

/** Move one body's drawn pose (`out`, in place) onto or round its seat this frame. */
export function applySeatedPose(
  view: object,
  e: Entity,
  out: { x: number; y: number; z: number; facing: number },
  nowMs: number,
): void {
  if (e.kind !== 'player' && e.kind !== 'npc') return;
  const seats = activeSeats();
  if (seats.length === 0) return;
  let slot = slots.get(view);
  if (!slot) {
    slot = { state: createSeatViewState(), lastMs: nowMs, capes: null };
    slots.set(view, slot);
  }
  const s = slot.state;
  const dt = Math.min(MAX_STEP_SECONDS, Math.max(0, (nowMs - slot.lastMs) / 1000));
  slot.lastMs = nowMs;
  // a standing body away from any seat costs this one check
  const held = isSeated(e) ? heldSeatForDraw(seats, true, e.dead, e.pos.x, e.pos.y, e.pos.z) : null;
  if (!held && s.phase === 'none') {
    // seen standing: a later sit walks in rather than popping into the seat
    s.seen = true;
    return;
  }
  stepSeatView(s, { held, x: out.x, y: out.y, z: out.z, facing: out.facing, idle: idleOf(e) }, dt);
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.facing = s.facing;
}

/** Fill the seat half of a body's animation state (replacing the plain sit rule while a
 *  seat is being drawn) and lift its rig root onto the seat. */
export function applySeatAnim(
  st: AnimState,
  view: object,
  e: Entity,
  riderMounted: boolean,
  rigRoot: Object3D,
): void {
  const slot = slots.get(view);
  const s = slot?.state;
  if (slot) setCapesHidden(slot, rigRoot, !!s && s.anim !== null && !e.dead);
  if (s && s.phase !== 'none' && !e.dead) {
    rigRoot.position.y = s.lift;
    st.seat = s.anim;
    st.sitting = s.anim !== null;
    if (s.anim === null && s.moving) {
      st.moving = true;
      st.running = false;
      st.speed = s.speed;
    }
    return;
  }
  st.seat = null;
  st.sitting = e.kind === 'player' && (isSeated(e) || riderMounted);
}
