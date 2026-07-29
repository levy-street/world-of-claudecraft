// Pure camera-framing constants for the shared CharacterPreview turntable.
//
// Kept out of preview.ts (which imports three) so a Node test can pin the exact
// framings without a WebGL context. The self character sheet frames the model
// close and face-on (the classic character-screen pose); the inspect window pulls
// the camera back and a touch higher so a tall silhouette (a pointed hat, a
// staff) stays inside the frame. CharacterPreview.setFraming() applies one of
// these; the numbers here are the single source of truth for both.

/** One camera framing: the eye height (y) and distance (z) on the view axis, and
 *  the height the camera aims at (lookY). x is fixed (the model is centered). */
export interface PreviewFraming {
  y: number;
  z: number;
  lookY: number;
}

export const PREVIEW_FRAMING = {
  // Self character sheet: the classic close, face-on framing.
  sheet: { y: 1.45, z: 5.1, lookY: 1.3 },
  // Inspect another player: pulled back / raised so tall silhouettes stay framed.
  inspect: { y: 1.5, z: 6.6, lookY: 1.3 },
} as const satisfies Record<string, PreviewFraming>;

export type PreviewFramingName = keyof typeof PREVIEW_FRAMING;
