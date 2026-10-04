// When the Graveyard Shift's grave whispers to the player: as they come within
// GRAVE_WHISPER_RADIUS of it, and again each time they come back after walking
// past GRAVE_WHISPER_REARM_RADIUS (so a missed bubble is not lost for the
// session), never twice inside GRAVE_WHISPER_COOLDOWN_MS. The grave only exists
// for an eligible player (the sim spawns it that way), so this needs no
// eligibility rule of its own. Pure: positions, the caller-owned state and the
// caller's clock in, a verdict out.
import { GRAVE_WHISPER_RADIUS } from '../sim/graveyard_shift/grave_entry';

type Pos = { readonly x: number; readonly z: number };

export const GRAVE_WHISPER_REARM_RADIUS = 20;
export const GRAVE_WHISPER_COOLDOWN_MS = 30_000;

export interface GraveWhisperState {
  armed: boolean;
  lastAtMs: number;
}

export function freshGraveWhisperState(): GraveWhisperState {
  return { armed: true, lastAtMs: Number.NEGATIVE_INFINITY };
}

/** Advances `state` for this frame; true when the grave whispers now. */
export function graveWhisperDue(
  gravePos: Pos | null | undefined,
  playerPos: Pos,
  state: GraveWhisperState,
  nowMs: number,
): boolean {
  if (!gravePos) return false;
  const d = Math.hypot(playerPos.x - gravePos.x, playerPos.z - gravePos.z);
  if (d > GRAVE_WHISPER_REARM_RADIUS) {
    state.armed = true;
    return false;
  }
  if (!state.armed || d > GRAVE_WHISPER_RADIUS) return false;
  if (nowMs - state.lastAtMs < GRAVE_WHISPER_COOLDOWN_MS) return false;
  state.armed = false;
  state.lastAtMs = nowMs;
  return true;
}
