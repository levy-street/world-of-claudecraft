// Pure core for the shapeshift form adornments: the pieces a caster form grows
// on the body it keeps. Moonwing Form (the druid's `form_moonkin`) and
// Gloamveil (the Shadow priest's `form_shadow`) are the two forms that do NOT
// swap to a creature rig; they only tint the base body, so on their own they
// read as a recolour. The adornments give each form a silhouette of its own:
// Moonwing grows the classic druid antlers back, a crescent between them and a
// pair of moonlit wings; Gloamveil draws a veil of gloom over the face, leaving
// two burning eyes.
//
// Three-free and DOM-free on purpose (RENDER_PURE_CORES): what a rig wears and
// how the pieces move are decisions a Vitest pins directly, while the THREE
// builders (moonwing_adornment.ts, gloamveil_veil.ts) stay thin painters over
// this math.

/** What kind of body a rig is: a composed modular look, a fixed class rig
 *  (a character authored before the creator), or a whole replacement body
 *  (the Combat Mech skin). */
export type AdornmentBody = 'composed' | 'classRig' | 'replacement';

/** Which adornment pieces a character rig wears this frame. */
export interface FormAdornmentPlan {
  /** Crescent and wings: every Moonwing rig (they float clear of any head). */
  moonwing: boolean;
  /** Antlers: only a composed body. The legacy class rig (`player_druid`,
   *  druid.glb) already wears its antlered hood, and a replacement body has no
   *  druid head to crown. */
  antlers: boolean;
  /** The shadow veil over the face: a KayKit head (composed or class rig),
   *  never a replacement body, whose head it was not shaped for. */
  gloamveil: boolean;
}

/** The plan for one rig, from the two form flags the renderer already derives
 *  per frame (`form_moonkin` / `form_shadow` auras) and the rig's body kind. */
export function formAdornmentPlan(
  moonkin: boolean,
  shadowform: boolean,
  body: AdornmentBody,
): FormAdornmentPlan {
  return {
    moonwing: moonkin,
    antlers: moonkin && body === 'composed',
    gloamveil: shadowform && body !== 'replacement',
  };
}

/** The per-frame Moonwing pose, in the painter's own units. */
export interface MoonwingPose {
  /** 0 folded against the back, 1 fully unfurled. Eases in on the shift. */
  unfurl: number;
  /** Slow wingbeat, radians added to the spread. */
  beat: number;
  /** Radians the wings sweep back while moving (negative opens them). */
  sweep: number;
  /** Crescent bob above its rest height, rig units. */
  crescentLift: number;
  /** Crescent sway, radians about the facing axis. */
  crescentSway: number;
}

export function createMoonwingPose(): MoonwingPose {
  return { unfurl: 0, beat: 0, sweep: 0, crescentLift: 0, crescentSway: 0 };
}

/** Seconds the wings take to unfurl after the shift. */
export const MOONWING_UNFURL_SECONDS = 0.45;

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/**
 * The Moonwing pose at `elapsed` seconds into the form. Moving sweeps the wings
 * back; casting opens them. Reduced motion holds the fully unfurled rest pose
 * (no unfurl ease, no beat, no bob), so the form still reads at once.
 */
export function moonwingPoseInto(
  elapsed: number,
  moving: boolean,
  casting: boolean,
  reducedMotion: boolean,
  out: MoonwingPose,
): MoonwingPose {
  if (reducedMotion) {
    out.unfurl = 1;
    out.beat = 0;
    out.crescentLift = 0;
    out.crescentSway = 0;
  } else {
    out.unfurl = smoothstep(elapsed / MOONWING_UNFURL_SECONDS);
    out.beat = Math.sin(elapsed * 1.7) * 0.07;
    out.crescentLift = Math.sin(elapsed * 1.1) * 0.035;
    out.crescentSway = Math.sin(elapsed * 0.7) * 0.06;
  }
  out.sweep = casting ? -0.14 : moving ? 0.22 : 0;
  return out;
}

/** The eye glow scale at `elapsed` seconds into Gloamveil: a slow smoulder,
 *  held steady under reduced motion. */
export function gloamveilEyeGlow(elapsed: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return 0.92 + Math.sin(elapsed * 2.6) * 0.08;
}
