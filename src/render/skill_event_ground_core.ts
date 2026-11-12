// The hourly skill event on the ground: the PURE per-frame plans the painter
// (skill_event_ground.ts) draws. The arena circle reuses the King of the Hill
// ring builder, so it is described here as that ring's input: red while the
// event runs (a PvP ground), the hill's faint warning outline before it starts,
// at the live field radius (Footprints in Ash closes it), quantized so the
// draped mesh rebuilds every yard and not every frame. The Footprints in Ash
// marks fade out over the last part of their lifetime; a breath plume rises
// and swells as it fades.
//
// The footprints copy the Stealth Rework prints (PR 4659,
// stealth_footprint_core.ts there): an oval dent with a raised lip, larger
// than a real boot so it reads along the chase camera's shallow pitch, shaded
// by the sun and multiplied onto the ground, fading in four steps.

import type {
  HillInfo,
  SkillEventBolt,
  SkillEventInfo,
  SkillEventMark,
} from '../world_api/world_pvp';

/** The field ring is rebuilt when the radius crosses a whole yard. */
export const SKILL_EVENT_RING_STEP_YARDS = 1;
/** How long a mark stays drawn (the sim's SKILL_EVENT_MARK_LIFETIME, pinned). */
export const SKILL_EVENT_MARK_DRAW_LIFETIME = 3;
/** A mark is fully drawn until this fraction of its life, then fades. */
const FADE_FROM = 0.55;
/** Breath plumes rise this far and grow to this scale over their life. */
const BREATH_RISE = 1.4;
const BREATH_GROW = 1.8;
/** A plume is a light trace, half the strength of a solid puff. */
const BREATH_OPACITY = 0.425;
/** Head height a plume starts at. */
const BREATH_BASE_Y = 1.6;

export type SkillEventRingInput = Pick<
  HillInfo,
  'x' | 'z' | 'radius' | 'phase' | 'holder' | 'challenger'
>;

/** The ring the hill builder draws for the event, or null when none shows. */
export function skillEventRingInput(info: SkillEventInfo | null): SkillEventRingInput | null {
  if (!info) return null;
  const radius = Math.max(
    SKILL_EVENT_RING_STEP_YARDS,
    Math.round(info.fieldRadius / SKILL_EVENT_RING_STEP_YARDS) * SKILL_EVENT_RING_STEP_YARDS,
  );
  return {
    x: info.x,
    z: info.z,
    radius,
    phase: info.phase === 'running' ? 'active' : 'warning',
    // A held-by-others ring is the hostile red: every event is open PvP ground.
    holder: 'other',
    challenger: 'none',
  };
}

export interface SkillEventMarkPose {
  /** 0 to 1: how strongly the mark is drawn. 0 means skip it. */
  alpha: number;
  /** Height above the ground the mark is drawn at. */
  lift: number;
  scale: number;
}

/** Where and how strongly to draw a mark `age` seconds after it was left. */
export function skillEventMarkPose(
  kind: SkillEventMark['kind'],
  age: number,
  out: SkillEventMarkPose,
): SkillEventMarkPose {
  const t = age / SKILL_EVENT_MARK_DRAW_LIFETIME;
  if (t < 0 || t >= 1) {
    out.alpha = 0;
    out.lift = 0;
    out.scale = 1;
    return out;
  }
  const fade = t <= FADE_FROM ? 1 : 1 - (t - FADE_FROM) / (1 - FADE_FROM);
  if (kind === 'breath') {
    out.alpha = fade * BREATH_OPACITY;
    out.lift = BREATH_BASE_Y + BREATH_RISE * t;
    out.scale = 1 + (BREATH_GROW - 1) * t;
  } else {
    out.alpha = fade;
    out.lift = 0;
    out.scale = 1;
  }
  return out;
}

export const SKILL_EVENT_STEP_FADE_BUCKETS = 4;
/** Opacity of each fade step, newest first (the Stealth Rework values). */
export const SKILL_EVENT_STEP_FADE_OPACITY: readonly number[] = [0.6, 0.46, 0.32, 0.18];
/** Half-width and half-length of one print, in yards. */
export const SKILL_EVENT_STEP_HALF_WIDTH = 0.28;
export const SKILL_EVENT_STEP_HALF_LENGTH = 0.42;

/** 0 = the freshest print, SKILL_EVENT_STEP_FADE_BUCKETS - 1 = about to vanish,
 *  -1 = gone. */
export function skillEventStepBucket(age: number): number {
  const t = age / SKILL_EVENT_MARK_DRAW_LIFETIME;
  if (t >= 1) return -1;
  if (!(t > 0)) return 0;
  return Math.min(SKILL_EVENT_STEP_FADE_BUCKETS - 1, Math.floor(t * SKILL_EVENT_STEP_FADE_BUCKETS));
}

/** Depth of the cup, height of the lip, and where the cup ends (as a fraction
 *  of the print's radius), all in yards except the last. */
const CUP_DEPTH = 0.05;
const RIM_HEIGHT = 0.02;
const CUP_RADIUS = 0.72;

/** dHeight/dr of the dent: a bowl down to the cup radius, then a lip that
 *  rises and settles back to flat. */
function craterSlope(r: number): number {
  if (r < CUP_RADIUS) return (2 * CUP_DEPTH * r) / (CUP_RADIUS * CUP_RADIUS);
  if (r >= 1) return 0;
  const span = 1 - CUP_RADIUS;
  return ((RIM_HEIGHT * Math.PI) / span) * Math.cos((Math.PI * (r - CUP_RADIUS)) / span);
}

/** The dent's unit normal at (u, v) of the print (over the half-width and
 *  half-length, so the unit circle is the edge), in the print's own frame:
 *  flat (0, 1, 0) at the centre and outside. */
export function skillEventStepNormalInto(
  out: { x: number; y: number; z: number },
  u: number,
  v: number,
): { x: number; y: number; z: number } {
  const r = Math.hypot(u, v);
  if (r < 1e-6 || r >= 1) {
    out.x = 0;
    out.y = 1;
    out.z = 0;
    return out;
  }
  const slope = craterSlope(r);
  const gx = (slope * (u / r)) / SKILL_EVENT_STEP_HALF_WIDTH;
  const gz = (slope * (v / r)) / SKILL_EVENT_STEP_HALF_LENGTH;
  const len = Math.hypot(gx, 1, gz);
  out.x = -gx / len;
  out.y = 1 / len;
  out.z = -gz / len;
  return out;
}

/** A bolt is extrapolated along its flight at most this long past its last
 *  update, so a stalled stream never sends one sailing across the field. */
export const SKILL_EVENT_BOLT_EXTRAPOLATE_MAX = 0.15;

/** Where to draw a bolt at `now`: its last position carried along its flight. */
export function skillEventBoltPositionInto(
  out: { x: number; z: number },
  bolt: Pick<SkillEventBolt, 'x' | 'z' | 'dx' | 'dz' | 'at'>,
  now: number,
  speed: number,
): { x: number; z: number } {
  const t = Math.min(SKILL_EVENT_BOLT_EXTRAPOLATE_MAX, Math.max(0, now - bolt.at));
  out.x = bolt.x + bolt.dx * speed * t;
  out.z = bolt.z + bolt.dz * speed * t;
  return out;
}
