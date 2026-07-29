// Pure camera-framing constants for the shared CharacterPreview turntable.
//
// Kept out of preview.ts (which imports three) so a Node test can pin the exact
// framings without a WebGL context. The self character sheet frames the model
// close and face-on (the classic character-screen pose); the inspect window pulls
// the camera back and a touch higher so a tall silhouette (a pointed hat, a
// staff) stays inside the frame. CharacterPreview.setFraming() applies one of
// these; the numbers here are the single source of truth for both.
//
// Every number is an ABSOLUTE world-unit distance from the model's feet, composed
// by hand around a body of a known height. So they scale with the body: the base
// numbers below were tuned against a stock 2.6 rig, and PLAYER_HEIGHT_SCALE lifts
// the eye and pulls the camera back by the same factor the player bodies grew. A
// uniform scale about the origin keeps the composition pixel-identical instead of
// leaving the crown against the frame edge and the feet cropped.

import { PLAYER_HEIGHT_SCALE } from './player_scale';

/** One camera framing: the eye height (y) and distance (z) on the view axis, and
 *  the height the camera aims at (lookY). x is fixed (the model is centered). */
export interface PreviewFraming {
  y: number;
  z: number;
  lookY: number;
}

/** The framings as tuned against a stock 2.6-tall rig, before the player-scale lift. */
const BASE_FRAMING = {
  // Self character sheet: the classic close, face-on framing.
  sheet: { y: 1.45, z: 5.1, lookY: 1.3 },
  // Inspect another player: pulled back / raised so tall silhouettes stay framed.
  inspect: { y: 1.5, z: 6.6, lookY: 1.3 },
} as const satisfies Record<string, PreviewFraming>;

/** Rounded to 4dp so the framings stay readable, pinnable numbers instead of
 *  binary-float noise (1.5 * 1.2 is 1.7999999999999998). Far below the precision
 *  any of this composition depends on. */
const lift = (v: number): number => Math.round(v * PLAYER_HEIGHT_SCALE * 1e4) / 1e4;

const scaleFraming = (f: PreviewFraming): PreviewFraming => ({
  y: lift(f.y),
  z: lift(f.z),
  lookY: lift(f.lookY),
});

export const PREVIEW_FRAMING: Record<keyof typeof BASE_FRAMING, PreviewFraming> = {
  sheet: scaleFraming(BASE_FRAMING.sheet),
  inspect: scaleFraming(BASE_FRAMING.inspect),
};

export type PreviewFramingName = keyof typeof PREVIEW_FRAMING;
