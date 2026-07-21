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
// hands off once it has settled within eps. The grace-then-gentle-glide
// correction remains only as the backstop for a facing the server refuses
// (a corpse) or a genuine misprediction.

import { TURN_SPEED } from '../sim/types';
import { wrapAngle } from './camera_follow';

// Within this of the server facing the display starts SEAMING: the wire
// rounds facing to 0.01 rad, so the mirror can sit ~0.3deg away from the held
// heading forever, and any one-frame jump onto it reads as a tiny end-of-turn
// tick. Inside the seam band the last fraction of a degree is eased at
// SEAM_RATE instead (sub-perceptual, ~0.33deg per 60fps frame).
const HANDOFF_EPS = 0.02; // rad (~1.1 degrees)
const SEAM_RATE = 0.35; // rad/s
// Fully handed off once within this (sub-pixel at any camera distance).
const HANDOFF_DONE_EPS = 0.002; // rad (~0.1 degrees)
// How long a release-time disagreement may stand before we start correcting.
// Sized to cover a generous input echo plus a couple of snapshots, so the
// normal catch-up always wins the race and no correction ever shows.
const RELEASE_GRACE_MS = 350;
// Gentle glide for a persistent residual (tick quantization is at most one
// server tick of turning, ~0.16 rad); a fraction of TURN_SPEED on purpose.
const RELEASE_CORRECT_RATE = 1.5; // rad/s
// Matches the main loop's frame clamp: the heading is authoritative input, so
// every millisecond a key was genuinely held must be credited even through a
// load hitch, or low-framerate hardware would turn slower than everyone else
// (the pre-streaming server-side integration never lost time). A large catch-up
// step renders smoothly anyway: the renderer's facing override is rate-limited.
const MAX_FRAME_DT = 0.25;

export interface KeyboardTurnState {
  facing: number | null; // null = inactive (the server facing owns the display)
  releaseMs: number; // time spent in the release phase
  /**
   * The heading the caller may put on the wire this frame, or null. Only ever
   * carries values DERIVED FROM INPUT (the live turn integration, the constant
   * held heading): never a value derived from the mirrored server facing. The
   * seam/glide corrections move the display TOWARD the mirror, and streaming
   * them back would make the server chase its own delayed echo, a closed
   * feedback loop that at high RTT never converges (the character visibly
   * spins on its own at the glide rate until the player intervenes).
   */
  wireFacing: number | null;
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
    releaseMs: 0,
    wireFacing: null,
    suppressTurnFlags: false,
    wasTurning: false,
  };
}

function approachAngle(current: number, target: number, maxStep: number): number {
  const step = Math.max(0, maxStep);
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= step) return target;
  return current + Math.sign(d) * step;
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
  /** Measured input echo (ms); scales the release grace so a high-RTT link
   *  gets its full round trip of holding before any correction starts. */
  echoMs: number;
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
    state.wireFacing = null;
    return null;
  }
  const dt = Math.min(Math.max(0, args.frameDt), MAX_FRAME_DT);
  if (args.turnAllowed && (args.turnLeft || args.turnRight)) {
    // Turning right DECREASES facing (sim convention: f points along (sin f, cos f)).
    const dir = (args.turnLeft ? 1 : 0) - (args.turnRight ? 1 : 0);
    const base = state.facing ?? args.serverFacing;
    state.facing = wrapAngle(base + dir * TURN_SPEED * dt);
    state.releaseMs = 0;
    state.wireFacing = state.facing; // input-derived: safe to stream
    return state.facing;
  }
  if (state.facing === null) {
    state.wireFacing = null;
    return null;
  }

  // Release phase: hold the local heading until the mirrored server facing
  // settles on it (the caller kept streaming it while we held, so the server
  // is already there; the mirror just needs the last round trip to show it).
  // Eps-arrival only, from either side: no crossing shortcuts, no rewinds.
  const gap = wrapAngle(args.serverFacing - state.facing);
  if (Math.abs(gap) <= HANDOFF_DONE_EPS) {
    state.facing = null;
    state.wireFacing = null;
    return args.serverFacing;
  }
  if (Math.abs(gap) <= HANDOFF_EPS) {
    // Seam band: ease the last fraction of a degree (mostly wire rounding)
    // onto the mirror instead of stepping it in a single frame. Mirror-derived
    // motion: never streamed (see wireFacing).
    state.facing = approachAngle(state.facing, args.serverFacing, SEAM_RATE * dt);
    state.wireFacing = null;
    return state.facing;
  }
  state.releaseMs += dt * 1000;
  // The grace scales with the measured echo: the mirror cannot possibly show
  // the held heading before one full round trip, so correcting earlier on a
  // slow link would fight in-flight state.
  const graceMs = Math.max(RELEASE_GRACE_MS, args.echoMs * 1.5 + 120);
  if (state.releaseMs >= graceMs) {
    // The server never caught up (stun mid-turn, dropped input, quantization):
    // glide the residual out gently instead of snapping at TURN_SPEED. Mirror-
    // derived motion: never streamed.
    state.facing = approachAngle(state.facing, args.serverFacing, RELEASE_CORRECT_RATE * dt);
    state.wireFacing = null;
  } else {
    state.wireFacing = state.facing; // the constant held heading: input-derived
  }
  return state.facing;
}
