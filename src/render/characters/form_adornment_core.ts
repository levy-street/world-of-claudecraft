// Pure core for the shapeshift form adornments: the pieces a caster form grows
// on the body it keeps. Moonwing Form (the druid's `form_moonkin`) does NOT
// swap to a creature rig; it only tints the base body, so on its own it reads
// as a recolour. The adornments give it a silhouette of its own: the classic
// druid antlers grown back, a crescent between them and a pair of moonlit
// wings.
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

/** What kind of body a rig is: a composed modular look, a WOC body (the
 *  realistic-proportion player body every class draws since the equipment
 *  sets), a fixed class rig (a character authored before the creator), or a
 *  whole replacement body (the Combat Mech skin). */
export type AdornmentBody = 'composed' | 'woc' | 'classRig' | 'replacement';

/** The body kind of a rig, from what its visual already knows: whether its
 *  def is a WOC character, whether it composed a modular look, and its key.
 *  The WOC test comes first: the skeleton decides the fit, and a WOC druid has
 *  no composed look, so without it the rig would pass for a legacy class rig
 *  (KayKit offsets, no antlers). */
export function formAdornmentBody(composed: boolean, woc: boolean, key: string): AdornmentBody {
  if (woc) return 'woc';
  if (composed) return 'composed';
  return key === 'player_mech' ? 'replacement' : 'classRig';
}

/** Which adornment pieces a character rig wears this frame. */
export interface FormAdornmentPlan {
  /** Crescent and wings: every Moonwing rig (they float clear of any head). */
  moonwing: boolean;
  /** Antlers: a composed body and a WOC body, whose heads are bare. The
   *  legacy class rig (druid.glb) already wears its antlered hood, and a
   *  replacement body has no druid head to crown. */
  antlers: boolean;
}

/** The plan for one rig, from the form flag the renderer already derives per
 *  frame (the `form_moonkin` aura) and the rig's body kind. */
export function formAdornmentPlan(moonkin: boolean, body: AdornmentBody): FormAdornmentPlan {
  return {
    moonwing: moonkin,
    antlers: moonkin && (body === 'composed' || body === 'woc'),
  };
}

/** Where the Moonwing pieces sit on one body kind, and how large. The pieces
 *  are authored once, in KayKit bone units (moonwing_adornment.ts); a fit
 *  moves and uniformly scales them onto a body of other proportions. */
export interface MoonwingFit {
  /** The head group (antlers and crescent): its origin in head-bone space and
   *  its uniform scale. */
  readonly head: { readonly y: number; readonly z: number; readonly scale: number };
  /** A wing's root in chest-bone space (x mirrors per side) and its uniform
   *  scale. */
  readonly wing: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly scale: number;
  };
}

/** The authoring fit: the KayKit Rig_Medium bodies (the composed look, the
 *  legacy class rigs, the Combat Mech) the pieces were measured against. */
export const MOONWING_KAYKIT_FIT: MoonwingFit = {
  head: { y: 0, z: 0, scale: 1 },
  wing: { x: 0.14, y: 0.12, z: -0.62, scale: 1 },
};

/** The WOC body, male and female fit alike. Its skeleton keeps the KayKit bone
 *  names and axes but the body is about half the KayKit size in rig units
 *  with a realistic small head, so the KayKit offsets leave the wings and the
 *  crescent floating far off it at twice the size. Measured on the live rigs
 *  (base_male.glb / base_female.glb with their heads): the back plate sits
 *  about 0.09 behind the chest bone, the skull is 0.11 wide with its crown
 *  0.15 above the head bone and its centre 0.04 ahead of it. */
export const MOONWING_WOC_FIT: MoonwingFit = {
  head: { y: -0.035, z: 0.045, scale: 0.25 },
  wing: { x: 0.035, y: 0.07, z: -0.1, scale: 0.48 },
};

/** The fit a body kind wears the Moonwing pieces at. */
export function moonwingFit(body: AdornmentBody): MoonwingFit {
  return body === 'woc' ? MOONWING_WOC_FIT : MOONWING_KAYKIT_FIT;
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
