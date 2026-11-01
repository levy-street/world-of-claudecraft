// Pure core for the shapeshift form adornments: the pieces a caster form grows
// on the body it keeps. Moonwing Form (the druid's `form_moonkin`) does NOT
// swap to a creature rig; it only tints the base body, so on its own it reads
// as a recolour. The adornments give it a silhouette of its own: the classic
// druid antlers grown back and a crescent between them. (It used to grow a
// pair of moonlit wings on the back too; they were cut.)
//
// Gloamveil (the Shadow priest's `form_shadow`), the other form that keeps its
// body, wears NO adornment: its look is a shader layer on the body itself plus
// a floor and smoke layer (gloam_climb.ts, ../gloam_field.ts), which depend on
// no bone and no body proportion. It used to wear a face veil sized for one
// head; nothing here mounts for it now.
//
// Three-free and DOM-free on purpose (RENDER_PURE_CORES): what a rig wears and
// how the pieces move are decisions a Vitest pins directly, while the THREE
// builder (moonwing_adornment.ts) stays a thin painter over this math.

/** What kind of body a rig is: a composed modular look, a fixed class rig
 *  (a character authored before the creator), or a whole replacement body
 *  (the Combat Mech skin). */
export type AdornmentBody = 'composed' | 'classRig' | 'replacement';

/** Which adornment pieces a character rig wears this frame. */
export interface FormAdornmentPlan {
  /** Crescent: every Moonwing rig (it floats clear of any head). */
  moonwing: boolean;
  /** Antlers: only a composed body. The legacy class rig (`player_druid`,
   *  druid.glb) already wears its antlered hood, and a replacement body has no
   *  druid head to crown. */
  antlers: boolean;
}

/** The plan for one rig, from the form flag the renderer already derives per
 *  frame (the `form_moonkin` aura) and the rig's body kind. */
export function formAdornmentPlan(moonkin: boolean, body: AdornmentBody): FormAdornmentPlan {
  return {
    moonwing: moonkin,
    antlers: moonkin && body === 'composed',
  };
}

/** The per-frame Moonwing pose, in the painter's own units. */
export interface MoonwingPose {
  /** Crescent bob above its rest height, rig units. */
  crescentLift: number;
  /** Crescent sway, radians about the facing axis. */
  crescentSway: number;
}

export function createMoonwingPose(): MoonwingPose {
  return { crescentLift: 0, crescentSway: 0 };
}

/**
 * The Moonwing pose at `elapsed` seconds into the form: the crescent's slow
 * bob and sway. Reduced motion holds it still at rest.
 */
export function moonwingPoseInto(
  elapsed: number,
  reducedMotion: boolean,
  out: MoonwingPose,
): MoonwingPose {
  if (reducedMotion) {
    out.crescentLift = 0;
    out.crescentSway = 0;
  } else {
    out.crescentLift = Math.sin(elapsed * 1.1) * 0.035;
    out.crescentSway = Math.sin(elapsed * 0.7) * 0.06;
  }
  return out;
}
