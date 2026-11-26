// The vein crystals: the pure half of vein_crystal.ts (the owner's ask of 2026-11-26). Each
// vein's light river starts in its guardian's arena with a bare square end on the floor
// (LIGHT_RIVERS' first point). A low collar of dark slabs sits over that end from the start,
// and when the guardian dies a small crystal of its element grows up out of the collar: the
// seal's own four crystals (ring_crystal.ts) in small, one element each, so the light that
// runs to the seal visibly springs from a crystal of the same kind.
//
// One GLB carries all four (SMITH_HEART_VEIN_CRYSTALS_URL): per vein a collar node and a
// crystal node, authored with the collar's radius 1 and its underside on the floor, the
// model's front (+z) where the collar's lit seam is. Presentation only: read from the seal's
// view (seconds since each vein lit), whole for a late arrival, on every tier. No collider:
// the collar is floor dressing and the crystal stands where the guardian fell, after its
// fight (a body walks through it; the layout is not touched). Its volume is in the
// sightline pin all the same (`veinCrystalBound`).
//
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic.

import {
  LIGHT_RIVERS,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';

export const SMITH_HEART_VEIN_CRYSTALS_URL = 'models/props/smith_heart_vein_crystals.glb';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** The crystals' sizes and timing (yards, seconds). */
export const VEIN_CRYSTAL = {
  /** The collar's radius: well over the river's half width, so the ribbon's square end
   *  lies under the slabs and the light leaves from under the collar's edge. */
  collarR: 2.2,
  /** The collar's foot sits this far into the floor (no gap on a floor that is not flat). */
  sink: 0.1,
  /** The crystal grows to its full height over this long. */
  grow: 2.2,
  /** It starts this share of its girth (a shard pushing through), filling out as it rises. */
  girthFrom: 0.45,
  /** The overshoot of the rise (a living thing settling, never a slide). */
  overshoot: 1.4,
  /** The birth's flare: added to the glow at the first instant, gone after `flashFall`. */
  flash: 1.6,
  flashFall: 1.1,
  /** The collar's seam while its guardian lives (the seal's dim river beside it). */
  collarAsleep: 0.3,
  /** Seconds for the collar's seam to light once the vein does. */
  collarRise: 0.5,
  /** Past this long after the vein lit nothing moves any more (the painter stops writing). */
  settled: 4,
  /** The authored model's bound in collar radii: no part reaches farther out than
   *  `modelReach`, and the crystal's tip stands under `modelTall` over the collar's foot
   *  (pinned against the shipped GLB; the sightline pin reads them, `veinCrystalBound`). */
  modelReach: 1.1,
  modelTall: 2.4,
} as const;

/** A vein's node names in the GLB. */
export function veinCrystalNodes(vein: SmithHeartVein): { collar: string; crystal: string } {
  const name = vein[0].toUpperCase() + vein.slice(1);
  return { collar: `${name}_Collar`, crystal: `${name}_Crystal` };
}

export interface VeinCrystalSpot {
  vein: SmithHeartVein;
  /** Instance-local yards: the head of the vein's river. */
  x: number;
  z: number;
  /** The yaw that turns the model's front (+z) down the river, so the collar's lit seam
   *  lies on the light leaving it. */
  yaw: number;
}

/** Where a vein's crystal stands: on the first point of its light river, facing the second. */
export function veinCrystalSpot(vein: SmithHeartVein): VeinCrystalSpot {
  const river = LIGHT_RIVERS[vein];
  const a = river[0];
  const b = river[1] ?? a;
  return { vein, x: a.x, z: a.z, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
}

/** Every vein's spot, in the seal's order (SMITH_HEART_VEINS). */
export function planVeinCrystals(): VeinCrystalSpot[] {
  return SMITH_HEART_VEINS.map((v) => veinCrystalSpot(v));
}

export interface VeinCrystalPose {
  /** The crystal is drawn at all (never before its guardian dies). */
  shown: boolean;
  /** Its height as a share of full (over 1 for a breath as it overshoots). */
  rise: number;
  /** Its girth as a share of full. */
  girth: number;
  /** Its own light (1 at rest, more through the birth's flare). */
  glow: number;
  /** The collar's seam (dim while the guardian lives, lit after). */
  collar: number;
}

export function newVeinCrystalPose(): VeinCrystalPose {
  return { shown: false, rise: 0, girth: 0, glow: 0, collar: VEIN_CRYSTAL.collarAsleep };
}

/** A crystal `since` seconds after its vein lit (-1: its guardian lives). A vein first seen
 *  long lit (a late arrival) reads fully grown and at rest. */
export function veinCrystalPoseInto(since: number, out: VeinCrystalPose): VeinCrystalPose {
  const C = VEIN_CRYSTAL;
  if (since < 0) {
    out.shown = false;
    out.rise = 0;
    out.girth = 0;
    out.glow = 0;
    out.collar = C.collarAsleep;
    return out;
  }
  const t = clamp01(since / C.grow);
  // Ease out with a small overshoot (the back curve), exactly 1 at the end.
  const u = t - 1;
  const s = C.overshoot;
  out.shown = true;
  out.rise = Math.max(0.02, 1 + u * u * ((s + 1) * u + s));
  out.girth = C.girthFrom + (1 - C.girthFrom) * smooth(t * 1.3);
  const flare = C.flash * Math.max(0, 1 - since / C.flashFall);
  out.glow = 1 + flare;
  out.collar = C.collarAsleep + (1 - C.collarAsleep) * smooth(since / C.collarRise) + 0.4 * flare;
  return out;
}

/** The grown crystal with its collar as one upright cylinder, in yards: its radius and its
 *  height over the collar's foot, the rise's overshoot included (the sightline pin's
 *  volume, `heart_sightline_core.ts` `veinCrystalSolids`). */
export function veinCrystalBound(): { r: number; h: number } {
  const pose = newVeinCrystalPose();
  let peak = 1;
  for (let i = 0; i <= 64; i++) {
    peak = Math.max(peak, veinCrystalPoseInto((VEIN_CRYSTAL.grow * i) / 64, pose).rise);
  }
  return {
    r: VEIN_CRYSTAL.collarR * VEIN_CRYSTAL.modelReach,
    h: VEIN_CRYSTAL.collarR * VEIN_CRYSTAL.modelTall * peak,
  };
}

/** Nothing about the crystal changes any more this long after its vein lit. */
export function veinCrystalSettled(since: number): boolean {
  return since >= VEIN_CRYSTAL.settled;
}
