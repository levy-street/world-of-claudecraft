// Instant local facing for keyboard turns online.
//
// Offline, A/D turning mutates the sim facing the same frame. Online the tl/tr
// flags used to be integrated SERVER-side at TURN_SPEED, so the model (and the
// follow camera) waited a full round trip before visibly turning. This module
// integrates the same TURN_SPEED math locally and the result feeds the
// renderer's facing-override chain, the camera follow, AND the wire facing
// channel (see below): keyboard turning is now a facing INPUT source with the
// same client authority mouselook has always had (src/net/CLAUDE.md).
//
// While engaged, the caller STREAMS the returned heading on the wire facing
// channel (the one mouselook streams; the server applies it outright) with
// the turn flags zeroed, so the server never integrates the turn itself: the
// local heading IS the authoritative heading, continuously, and there is no
// client/server disagreement to reconcile at release (server-side tick
// quantization, in-flight overshoot, and every release stutter they caused
// are gone by construction). On release the local facing is HELD while the
// mirrored server facing catches up over the last round trip, and the module
// hands off once it has settled within eps.

import { TURN_SPEED } from '../sim/types';
import { wrapAngle } from './camera_follow';

// Fully handed off once within this (sub-pixel at any camera distance).
export const HANDOFF_DONE_EPS = 0.002; // rad (~0.1 degrees)
// Matches the main loop's frame clamp: the heading is authoritative input, so
// every millisecond a key was genuinely held must be credited even through a
// load hitch, or low-framerate hardware would turn slower than everyone else
// (the pre-streaming server-side integration never lost time). A large catch-up
// step renders smoothly anyway: the renderer's facing override is rate-limited.
const MAX_FRAME_DT = 0.25;

export interface KeyboardTurnState {
  facing: number | null; // null = inactive (the server facing owns the display)
  pendingReleaseCommit: number | null;
  handoffStableMs: number;
  /**
   * The heading the caller may put on the wire this frame, or null. Only ever
   * carries values DERIVED FROM INPUT (the live turn integration, the constant
   * held heading): never a value derived from the mirrored server facing. The
   * fallback glide corrections move the display TOWARD the mirror, and streaming
   * them back would make the server chase its own delayed echo, a closed
   * feedback loop that at high RTT never converges (the character visibly
   * spins on its own at the glide rate until the player intervenes).
   */
  wireFacing: number | null;
  /** True once release correction has incorporated mirrored server state. */
  mirrorDerived: boolean;
  /**
   * True when the caller must ZERO the turn flags on the wire this frame
   * (the streamed heading owns the channel; letting the server integrate
   * tl/tr on top would double the turn). False exactly one frame per engage
   * (the edge), so server behaviors keyed on a manual turn flag, breaking
   * /follow and the anti-AFK activity mark, still fire; the facing streamed
   * alongside overwrites the at most one tick the server may integrate.
   * Known limit: the edge is a TRANSITION, so a /follow issued while the
   * keys are ALREADY held never sees a flag and does not break until the
   * key is re-pressed (the client cannot see follow state; followTargetId
   * is not mirrored).
   */
  suppressTurnFlags: boolean;
  /** Previous frame's "engaged and keys held", for the edge detection. */
  wasTurning: boolean;
}

export function newKeyboardTurnState(): KeyboardTurnState {
  return {
    facing: null,
    pendingReleaseCommit: null,
    handoffStableMs: 0,
    wireFacing: null,
    mirrorDerived: false,
    suppressTurnFlags: false,
    wasTurning: false,
  };
}

/**
 * Keep an already-streamed mouselook release heading on the display until the
 * mirrored server facing reaches it. The wire latch owns the one required send,
 * so this seeded release state stays display-only.
 */
export function seedKeyboardTurnRelease(state: KeyboardTurnState, facing: number): void {
  state.facing = facing;
  state.handoffStableMs = 0;
  state.wireFacing = null;
  state.mirrorDerived = true;
  state.suppressTurnFlags = false;
  state.wasTurning = false;
}

export interface KeyboardTurnArgs {
  turnLeft: boolean;
  turnRight: boolean;
  /** False while turning is blocked (stun family / corpse): hold, then correct. */
  turnAllowed: boolean;
  /**
   * The facing the client streams to the server this frame (mouselook,
   * click-move, mouselook-release latch). Non-null means that path owns the
   * heading and the server applies it immediately: clear and yield.
   */
  sentFacing: number | null;
  /** Interpolated prev->server facing (alpha capped at 1), the handoff target. */
  serverFacing: number;
  /** Whether the server acknowledged the pending final keyboard heading. */
  releaseCommitAcknowledged: boolean;
  /** Current measured interval between authoritative snapshots. */
  snapshotIntervalMs: number;
  frameDt: number;
}

/**
 * Advance the local keyboard-turn display facing one frame. Returns the facing
 * to show (and to follow with the camera) while engaged or waiting for the
 * server to catch up, or null once the server facing owns the display again.
 */
export function stepKeyboardTurnFacing(
  state: KeyboardTurnState,
  args: KeyboardTurnArgs,
): number | null {
  const facing = stepFacing(state, args);
  // Wire turn-flag gating (see suppressTurnFlags): zero the flags while a
  // local heading owns the display, except the one engage-edge frame.
  const turning = facing !== null && (args.turnLeft || args.turnRight);
  state.suppressTurnFlags = facing !== null && !(turning && !state.wasTurning);
  state.wasTurning = turning;
  return facing;
}

function stepFacing(state: KeyboardTurnState, args: KeyboardTurnArgs): number | null {
  if (args.sentFacing !== null) {
    // A foreign path (mouselook, click-move) owns the heading and streams it
    // itself; yield.
    state.facing = null;
    state.pendingReleaseCommit = null;
    state.handoffStableMs = 0;
    state.wireFacing = null;
    state.mirrorDerived = false;
    return null;
  }
  const dt = Math.min(Math.max(0, args.frameDt), MAX_FRAME_DT);
  if (args.turnAllowed && (args.turnLeft || args.turnRight)) {
    // Turning right DECREASES facing (sim convention: f points along (sin f, cos f)).
    const dir = (args.turnLeft ? 1 : 0) - (args.turnRight ? 1 : 0);
    const base = state.facing ?? args.serverFacing;
    state.facing = wrapAngle(base + dir * TURN_SPEED * dt);
    state.pendingReleaseCommit = null;
    state.handoffStableMs = 0;
    state.wireFacing = state.facing; // input-derived: safe to stream
    state.mirrorDerived = false;
    return state.facing;
  }
  if (state.facing === null) {
    state.handoffStableMs = 0;
    state.wireFacing = null;
    state.mirrorDerived = false;
    return null;
  }

  if (state.wasTurning && !args.turnLeft && !args.turnRight) {
    state.pendingReleaseCommit = state.facing;
    state.wireFacing = state.facing;
  }

  let releaseCommitJustAcknowledged = false;
  if (state.pendingReleaseCommit !== null) {
    if (!args.releaseCommitAcknowledged) {
      state.wireFacing = state.facing;
      return state.facing;
    }
    state.pendingReleaseCommit = null;
    releaseCommitJustAcknowledged = true;
  }

  // Release phase: hold the local heading until the mirrored server facing
  // settles on it (the caller kept streaming it while we held, so the server
  // is already there; the mirror just needs the last round trip to show it).
  // Eps-arrival only, from either side: no crossing shortcuts, no rewinds.
  const gap = wrapAngle(args.serverFacing - state.facing);
  if (releaseCommitJustAcknowledged && Math.abs(gap) <= HANDOFF_DONE_EPS) {
    state.facing = null;
    state.wireFacing = null;
    state.mirrorDerived = false;
    state.handoffStableMs = 0;
    return args.serverFacing;
  }
  if (Math.abs(gap) <= HANDOFF_DONE_EPS) {
    state.handoffStableMs += dt * 1000;
    state.wireFacing = state.mirrorDerived ? null : state.facing;
    if (state.handoffStableMs < Math.max(0, args.snapshotIntervalMs)) return state.facing;
    state.facing = null;
    state.wireFacing = null;
    state.mirrorDerived = false;
    return args.serverFacing;
  }
  state.handoffStableMs = 0;
  state.wireFacing = state.mirrorDerived ? null : state.facing;
  return state.facing;
}
