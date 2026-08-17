// Contact-blob grounding: the per-body plan for the soft ground shadow the
// renderer draws under every nearby character on the tiers that cast NO dynamic
// shadow (GFX.dynamicShadows false: the low tier and every constrained/iOS
// profile). Without it a body on those tiers has no contact cue at all and
// reads as floating just above the terrain, which is precisely the device class
// most casual players are on.
//
// Cosmetic only, and deliberately so: the blob sits under a body that is
// already drawn, so it conveys nothing a player reacts to (it cannot reveal a
// position, a debuff, a cast, or a health state). It is a parallel layer to the
// real shadow plumbing (CharacterVisual.setShadow / setProxyShadow), never a
// second arm of it: the renderer builds this painter ONLY when the real one is
// off, so the two can never both draw under one body.
// See docs/design/graphics-settings-fairness.md.
//
// Pure: no three, no DOM. The painter (blob_shadows.ts) owns the InstancedMesh,
// the shared texture and the fixed opacity; this module owns only the numbers,
// and fills a caller-owned slot so a crowd costs no allocation per frame (the
// nameplatePlanInto contract).
import { GRAVITY, JUMP_VELOCITY } from '../sim/player_motion';

/** One instance's worth of plan, owned by the caller and rewritten in place. */
export interface BlobShadowSlot {
  x: number;
  y: number;
  z: number;
  /**
   * Uniform world scale for the instance, in yards of footprint radius. Zero is
   * the HIDE mechanism (a scale-collapsed instance draws no pixels), so the
   * painter needs no per-instance opacity and the pool stays one draw.
   */
  scale: number;
  visible: boolean;
}

export function createBlobShadowSlot(): BlobShadowSlot {
  return { x: 0, y: 0, z: 0, scale: 0, visible: false };
}

/**
 * Lift above the ground reference, in yards. Matches the renderer's other
 * ground decals (the aoe ring's 0.06); the painter also carries a polygon
 * offset, because a flat plane over a sloped hillside z-fights well before a
 * lift big enough to hide it stops reading as a hovering sticker.
 */
export const BLOB_GROUND_LIFT = 0.06;

/**
 * A plain hop's apex, straight off the movement kernel's own numbers
 * (v^2 / 2g, about 1.125 yd) rather than a hand-picked height, so the fade
 * below cannot drift away from the arc it is drawn against.
 */
export const JUMP_APEX = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);

/**
 * Height above the ground at which the blob has collapsed completely, at TWICE
 * that apex (~2.25 yd). The consequences of the choice, in the cases that
 * actually occur: a plain hop keeps a half-sized blob at its apex (the body is
 * still visibly near the ground, and a blob that vanished on every jump would
 * flicker), a mounted hop (~1.76 yd) leaves about a fifth, and a knockup,
 * a knockback arc or a swimmer over a lake bed clears it entirely.
 */
export const BLOB_FADE_HEIGHT = JUMP_APEX * 2;

/**
 * Footprint radius per yard of body height, and its clamps. The waterline
 * contact ring in the entity loop uses 0.16 of height for a much tighter
 * contact POINT; a standing body's shadow covers its stance, so it is wider.
 * The clamps keep a critter from losing its blob entirely and a boss-scale rig
 * from painting a car park.
 */
export const BLOB_RADIUS_PER_HEIGHT = 0.3;
export const BLOB_RADIUS_MIN = 0.35;
export const BLOB_RADIUS_MAX = 3;

/**
 * Fraction of the range at which the distance ease-out starts, so a blob
 * shrinks away over the last quarter of the band instead of popping out at the
 * edge (the mobGlowStrength ease, same job, same shape).
 */
export const BLOB_FADE_START_FRACTION = 0.75;

/**
 * Below this world scale a blob is at most a pixel or two of dark haze, so the
 * instance is dropped rather than drawn. Also the floor that turns the two
 * fades above into a clean disappearance instead of an infinitely small speck.
 */
export const BLOB_MIN_SCALE = 0.05;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Footprint radius in yards for a body of `height` yards at `scale`. */
export function blobBaseRadius(height: number, scale: number): number {
  const radius = height * scale * BLOB_RADIUS_PER_HEIGHT;
  if (!(radius > BLOB_RADIUS_MIN)) return BLOB_RADIUS_MIN;
  return radius > BLOB_RADIUS_MAX ? BLOB_RADIUS_MAX : radius;
}

/**
 * 1 on the ground, easing linearly to 0 at BLOB_FADE_HEIGHT. Linear in the
 * SCALE means the painted area falls off quadratically with height, which is
 * what reads as a contact shadow letting go of a body that jumps.
 * A body below its ground reference (a stale sample on a fast descent) keeps
 * the full blob rather than inverting.
 */
export function blobHeightFade(heightAboveGround: number): number {
  if (heightAboveGround <= 0) return 1;
  if (heightAboveGround >= BLOB_FADE_HEIGHT) return 0;
  return 1 - heightAboveGround / BLOB_FADE_HEIGHT;
}

/**
 * 1 out to the fade start, easing to 0 at the range edge. Takes SQUARED
 * distances because the entity loop already has one and a square root per
 * character per frame buys nothing.
 */
export function blobDistanceFade(distanceSq: number, rangeSq: number): number {
  if (!(rangeSq > 0) || distanceSq >= rangeSq) return 0;
  const startSq = rangeSq * BLOB_FADE_START_FRACTION * BLOB_FADE_START_FRACTION;
  if (distanceSq <= startSq) return 1;
  return 1 - smoothstep((distanceSq - startSq) / (rangeSq - startSq));
}

/**
 * Fill `out` with one body's blob for this frame. `drawnY` is the body's DRAWN
 * feet height and `groundY` the surface under it (the caller passes the drawn
 * height itself while the body is on a surface, so a blob stays flush with a
 * dock, a crate top or a step the height smoother is still easing).
 *
 * `bodyDrawn` is the caller's own "this body is actually being painted this
 * frame" answer (view visible, rig active, inside the frustum): a blob must
 * never outlive the body it belongs to, and it must never be the thing that
 * shows an off-screen or not-yet-compiled body.
 */
export function blobShadowPlanInto(
  out: BlobShadowSlot,
  x: number,
  drawnY: number,
  z: number,
  groundY: number,
  baseRadius: number,
  distanceSq: number,
  rangeSq: number,
  bodyDrawn: boolean,
): BlobShadowSlot {
  out.x = x;
  out.y = groundY + BLOB_GROUND_LIFT;
  out.z = z;
  out.scale = 0;
  out.visible = false;
  if (!bodyDrawn || !(baseRadius > 0)) return out;
  const distanceFade = blobDistanceFade(distanceSq, rangeSq);
  if (distanceFade <= 0) return out;
  const heightFade = blobHeightFade(drawnY - groundY);
  if (heightFade <= 0) return out;
  const scale = baseRadius * heightFade * distanceFade;
  if (scale < BLOB_MIN_SCALE) return out;
  out.scale = scale;
  out.visible = true;
  return out;
}
