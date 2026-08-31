// Whether the display-only self extrapolation (src/render/self_motion.ts) may
// drive the local player this frame. Pure, so a headless latency harness can
// answer the same question the render loop does without a DOM.
//
// Off while spectating, corpse-frozen, or CC'd (playerImmobilized covers
// stun/root/incapacitate/polymorph, and fear is a fear_incap incapacitate aura;
// the fear steer and the charge/follow modes run server-side only), and inside a
// delve (the portcullis door clamps are not mirrored client-side).

import { isDelvePos, isRiftPos } from '../sim/data';
import type { Aura } from '../sim/types';
import type { RiftFloorView } from '../world_api/dungeons';

// Aura kinds that stop the player from moving (mirrors the sim's isRooted/isStunned):
// while one of these is up, click-to-move can't make progress, so the destination
// marker shows a "held" state instead of looking like a stuck game.
const IMMOBILE_AURA_KINDS = new Set(['stun', 'root', 'incapacitate', 'polymorph']);

// The player can't move toward a click-to-move destination while rooted/stunned
// surface that on the marker so the freeze reads as crowd control, not a bug.
export function isPlayerImmobilized(auras: readonly Aura[]): boolean {
  return auras.some((a) => IMMOBILE_AURA_KINDS.has(a.kind));
}

// A released spirit (ghost) moves, turns, and drives the camera like the living; only
// a corpse that has not yet released its spirit is frozen. Combat stays gated by
// `dead` (and re-validated server-side), so this only unlocks locomotion for ghosts.
export function isMovementFrozen(player: { dead: boolean; ghost: boolean }): boolean {
  return player.dead && !player.ghost;
}

export interface SelfMotionGateArgs {
  /** Live-ops kill switch (?nopredict); the URL read stays with the client shell. */
  disabled: boolean;
  spectating: string | null;
  movementFrozen: boolean;
  playerImmobilized: boolean;
  posX: number;
  climbing: boolean | undefined;
  riftFloor?: RiftFloorView | null;
}

export function selfMotionPredictionEnabled(args: SelfMotionGateArgs): boolean {
  return (
    !args.disabled &&
    args.spectating === null &&
    !args.movementFrozen &&
    !args.playerImmobilized &&
    !isDelvePos(args.posX) &&
    // A resumed ClientWorld starts with riftFloor null until the server replays
    // riftState. Once present, the client has the raised-floor descriptor and
    // colliders needed by the shared motion kernel.
    (!isRiftPos(args.posX) || args.riftFloor != null) &&
    // A ledge climb is a server-owned scripted move the client does
    // not re-simulate: predicting a fall through it would fight the
    // authoritative pull-up and show the correction as a stutter.
    args.climbing !== true
  );
}
