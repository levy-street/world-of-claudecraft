// Per-entity visuals for the Thornhollow Fields battleground ground objects (sim kind
// 'object', templateId 'bg_flag' / 'bg_rune'). Built by renderer.createView's
// bg_ arm with objectPoolKey = null (stateful, never pooled), so views come and
// go with interest churn: every geometry and material here is a module-level
// cache marked shared (shared_resource.ts) so removeView's per-view disposal
// never frees them out from under the next build.
//
// Graphics fairness: a carried flag's position is actionable info, so the flag
// is plainly visible on EVERY tier (unlit pennant + pole), and the carried-state
// dressing (the lean and the team-color carrier ring) is built and driven
// unconditionally. High tiers only boost the pennant color for bloom pop
// (cosmetic); the rune's point light is likewise cosmetic richness on top of
// the always-on additive glow.
//
// Each built group carries `userData.bg` (BgObjectRefs): the per-frame handles
// battleground_fx.ts animates (the flag lean pivot + carrier ring, the rune gem
// spinner). The refs point at child objects the renderer never touches; the
// group's own position/rotation stay renderer-owned.
import * as THREE from 'three';
import { BG_TEAM_COLORS } from '../sim/battleground_layout';
import { type BgRuneType, RUNE_VISUALS } from '../sim/social/battleground';
import { BG_RUNE_BOB_AMP } from './battleground_fx_core';
import { runeModelBody } from './battleground_rune_model';
import { buildRuneVfxKit, type RuneVfxKit } from './battleground_rune_vfx';
import { surfaceMat } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const FLAG_POLE_H = 3.2;
// The pole reads as a WAR STANDARD, not a stick: thick enough to have weight at
// the distance a flag is usually seen from (across a chamber), socketed in a
// stone foot, banded in gold, and finished with a spear point rather than the
// bare ball it used to carry.
const FLAG_POLE_R = 0.075;
const FLAG_FOOT_R = 0.3;
const FLAG_FOOT_H = 0.2;
const FLAG_BAND_R = FLAG_POLE_R * 1.35;
const FLAG_BAND_H = 0.07;
const FLAG_FINIAL_H = 0.42;
const FLAG_FINIAL_R = FLAG_POLE_R * 1.9;
const FLAG_GOLD = 0xd8b34a;
const PENNANT_W = 1.15;
const PENNANT_H = 0.75;
const PENNANT_BLOOM_BOOST = 1.6; // high-tier color multiplier (bloom pop only)
const CARRY_RING_INNER = 0.62;
const CARRY_RING_OUTER = 0.95;
const CARRY_RING_Y = 0.06;
const RUNE_DISC_R = 1.05;
const RUNE_DISC_Y = 0.08;
const RUNE_GEM_SIZE = 0.42;
const RUNE_GEM_Y = 1.15;
// Corner-down diamond orientation for the cube gem; the fx spinner then yaws
// the holder so the tilt never accumulates error.
const RUNE_GEM_TILT_Z = Math.PI / 4;
const RUNE_GEM_TILT_X = Math.atan(Math.SQRT2);
const RUNE_LIGHT_INTENSITY = 1.6;
const RUNE_LIGHT_DISTANCE = 8;

/** Per-frame animation handles battleground_fx.ts reads off `group.userData.bg`. */
export type BgObjectRefs =
  | {
      kind: 'flag';
      team: number; // 0 = Crimson, 1 = Azure (bgInfo.match.flags index)
      color: number;
      lean: THREE.Group; // pole + pennant pivot: yawed to the carrier, tilted while carried
      ring: THREE.Mesh; // team-color carrier ring, visible only while carried
    }
  | {
      kind: 'rune';
      gem: THREE.Group; // the spinner holding the body (custom GLB or fallback)
      gemBaseY: number;
      // The pad's bespoke effect kit (Slipstream / Forge / Aegis), or null on
      // an unrecognized rune color. The fx pass ticks it; nothing else may.
      vfx: RuneVfxKit | null;
    };

let flagPoleGeo: THREE.CylinderGeometry | null = null;
let pennantGeo: THREE.ShapeGeometry | null = null;
let flagFinialGeo: THREE.ConeGeometry | null = null;
let flagFootGeo: THREE.CylinderGeometry | null = null;
let flagBandGeo: THREE.CylinderGeometry | null = null;
let flagCollarGeo: THREE.SphereGeometry | null = null;
let carryRingGeo: THREE.RingGeometry | null = null;
let runeDiscGeo: THREE.CircleGeometry | null = null;
let runeGemGeo: THREE.BoxGeometry | null = null;

// Cached per color + tier arm; marked shared so per-view disposal skips them.
const pennantMats = new Map<string, THREE.MeshBasicMaterial>();
const glowMats = new Map<number, THREE.MeshBasicMaterial>();

function pennantMaterial(color: number, lowGfx: boolean): THREE.MeshBasicMaterial {
  const key = `${color}:${lowGfx ? 'low' : 'high'}`;
  let mat = pennantMats.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    if (!lowGfx) mat.color.multiplyScalar(PENNANT_BLOOM_BOOST);
    markSharedMaterial(mat);
    pennantMats.set(key, mat);
  }
  return mat;
}

function glowMaterial(color: number): THREE.MeshBasicMaterial {
  let mat = glowMats.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      // 0.6, not 0.85: over the bright floor + bloom, higher additive
      // opacity washed every rune color out to white.
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    markSharedMaterial(mat);
    glowMats.set(color, mat);
  }
  return mat;
}

// The gem itself renders SOLID in the rune color (normal blending): additive
// blending washed it to white under bloom, hiding which rune it is.
const gemMats = new Map<number, THREE.MeshBasicMaterial>();
function gemMaterial(color: number): THREE.MeshBasicMaterial {
  let mat = gemMats.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color });
    markSharedMaterial(mat);
    gemMats.set(color, mat);
  }
  return mat;
}

function runeTypeForColor(color: number): keyof typeof RUNE_VISUALS | null {
  for (const type of Object.keys(RUNE_VISUALS) as (keyof typeof RUNE_VISUALS)[]) {
    if (RUNE_VISUALS[type].color === color) return type;
  }
  return null;
}

// The pad's identity lives in the SPINNER SHAPE itself (playtest direction,
// second pass: 2D glyph billboards read as stickers against the low-poly
// world): Sprint spins a lightning bolt, Battle a pair of crossed swords,
// Ward a shield plate, all extruded low-poly solids in the rune color.
//
// These are the FALLBACK bodies. A rune with a custom GLB registered in
// battleground_rune_model.ts spins that instead; everything around the body
// (glow disc, spin/bob, the bespoke effect kit) is identical either way.
let bladeGeo: THREE.ExtrudeGeometry | null = null;
let shieldGeo: THREE.ExtrudeGeometry | null = null;
let boltGeo: THREE.ExtrudeGeometry | null = null;

function runeBoltGeometry(): THREE.ExtrudeGeometry {
  if (boltGeo) return boltGeo;
  const sh = new THREE.Shape();
  sh.moveTo(0.1, 0.8);
  sh.lineTo(0.42, 0.8);
  sh.lineTo(0.08, 0.12);
  sh.lineTo(0.34, 0.12);
  sh.lineTo(-0.42, -0.8);
  sh.lineTo(-0.05, -0.05);
  sh.lineTo(-0.34, -0.05);
  sh.closePath();
  boltGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false });
  boltGeo.translate(0, 0, -0.06);
  markSharedGeometry(boltGeo);
  return boltGeo;
}

function runeBladeGeometry(): THREE.ExtrudeGeometry {
  if (bladeGeo) return bladeGeo;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.85); // point
  sh.lineTo(0.13, 0.55);
  sh.lineTo(0.13, -0.15);
  sh.lineTo(0.34, -0.15); // guard
  sh.lineTo(0.34, -0.28);
  sh.lineTo(0.09, -0.28);
  sh.lineTo(0.09, -0.62); // grip
  sh.lineTo(-0.09, -0.62);
  sh.lineTo(-0.09, -0.28);
  sh.lineTo(-0.34, -0.28);
  sh.lineTo(-0.34, -0.15);
  sh.lineTo(-0.13, -0.15);
  sh.lineTo(-0.13, 0.55);
  sh.closePath();
  bladeGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false });
  bladeGeo.translate(0, 0, -0.06);
  markSharedGeometry(bladeGeo);
  return bladeGeo;
}

function runeShieldGeometry(): THREE.ExtrudeGeometry {
  if (shieldGeo) return shieldGeo;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.52);
  sh.lineTo(0.42, 0.4);
  sh.lineTo(0.42, 0.05);
  sh.quadraticCurveTo(0.42, -0.34, 0, -0.58);
  sh.quadraticCurveTo(-0.42, -0.34, -0.42, 0.05);
  sh.lineTo(-0.42, 0.4);
  sh.closePath();
  shieldGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: false });
  shieldGeo.translate(0, 0, -0.07);
  markSharedGeometry(shieldGeo);
  return shieldGeo;
}

/**
 * The procedural spinner body for a rune pad: the shape that spins when no
 * custom GLB is registered for that rune (and for an unrecognized rune color,
 * which falls through to the corner-down gem cube).
 */
function proceduralRuneBody(runeType: BgRuneType | null, color: number): THREE.Object3D[] {
  if (runeType === 'damage') {
    // CROSSED swords: two blades in an X, the war-room trophy silhouette.
    return [-0.5, 0.5].map((lean) => {
      const blade = new THREE.Mesh(runeBladeGeometry(), gemMaterial(color));
      blade.rotation.z = lean;
      blade.position.y = 0.3; // grips clear the pad at the bob's low point
      return blade;
    });
  }
  if (runeType === 'defense') return [new THREE.Mesh(runeShieldGeometry(), gemMaterial(color))];
  if (runeType === 'sprint') return [new THREE.Mesh(runeBoltGeometry(), gemMaterial(color))];
  runeGemGeo ??= markSharedGeometry(
    new THREE.BoxGeometry(RUNE_GEM_SIZE, RUNE_GEM_SIZE, RUNE_GEM_SIZE),
  );
  const gemMesh = new THREE.Mesh(runeGemGeo, gemMaterial(color));
  gemMesh.rotation.z = RUNE_GEM_TILT_Z;
  gemMesh.rotation.x = RUNE_GEM_TILT_X;
  return [gemMesh];
}

/**
 * Build the view body for one battleground ground object. `color` is the sim
 * entity's color (team color for a flag, gold for a rune); `height` feeds the
 * renderer's nameplate anchor.
 */
export function buildBattlegroundObject(
  templateId: string,
  color: number,
  lowGfx: boolean,
): { group: THREE.Group; height: number } {
  const group = new THREE.Group();

  if (templateId === 'bg_rune') {
    runeDiscGeo ??= markSharedGeometry(new THREE.CircleGeometry(RUNE_DISC_R, 24));
    const glow = glowMaterial(color);
    const disc = new THREE.Mesh(runeDiscGeo, glow);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = RUNE_DISC_Y;
    group.add(disc);
    // The spinner: the pad's body inside a group the fx pass yaws and bobs
    // (battleground_fx_core runeGemPose). A registered custom GLB wins; without
    // one the procedural per-type solid keeps the pad's PURPOSE readable from
    // the shape before the color.
    const gem = new THREE.Group();
    gem.position.y = RUNE_GEM_Y;
    const runeType = runeTypeForColor(color);
    const model = runeType ? runeModelBody(runeType) : null;
    if (model) gem.add(model);
    else for (const part of proceduralRuneBody(runeType, color)) gem.add(part);
    group.add(gem);
    // The bespoke effect kit owns the pad's pulsing point light, so an
    // unrecognized rune color (no kit) still gets the plain light it always had.
    const vfx = runeType ? buildRuneVfxKit(runeType, color, lowGfx) : null;
    if (vfx) {
      group.add(vfx.group);
    } else if (!lowGfx) {
      const light = new THREE.PointLight(color, RUNE_LIGHT_INTENSITY, RUNE_LIGHT_DISTANCE, 2);
      light.position.y = RUNE_GEM_Y;
      group.add(light);
    }
    group.userData.bg = { kind: 'rune', gem, gemBaseY: RUNE_GEM_Y, vfx } satisfies BgObjectRefs;
    // Nameplate anchor clears the tallest spinner (the blade's raised point)
    // at the top of its hover (bob amplitude from battleground_fx_core).
    return { group, height: RUNE_GEM_Y + BG_RUNE_BOB_AMP + 1.1 + 0.25 };
  }

  // bg_flag (and any future bg_ object defaults to the flag body): pole +
  // team-color pennant, bright at every tier. The pole and pennant live on a
  // lean pivot the fx pass tips over the carrier's shoulder while carried; the
  // ring under it flags the carrier at a glance from any angle.
  flagPoleGeo ??= markSharedGeometry(
    new THREE.CylinderGeometry(FLAG_POLE_R * 0.85, FLAG_POLE_R * 1.15, FLAG_POLE_H, 10),
  );
  flagFootGeo ??= markSharedGeometry(
    new THREE.CylinderGeometry(FLAG_FOOT_R * 0.78, FLAG_FOOT_R, FLAG_FOOT_H, 12),
  );
  flagBandGeo ??= markSharedGeometry(
    new THREE.CylinderGeometry(FLAG_BAND_R, FLAG_BAND_R, FLAG_BAND_H, 10),
  );
  flagCollarGeo ??= markSharedGeometry(new THREE.SphereGeometry(FLAG_POLE_R * 1.5, 10, 8));
  if (!pennantGeo) {
    // A swallowtail pennant (hoist at the pole, V notch on the fly), not the
    // old bare rectangle: the flag itself should read as a war banner.
    const shape = new THREE.Shape();
    shape.moveTo(0, PENNANT_H / 2);
    shape.lineTo(PENNANT_W, PENNANT_H / 2);
    shape.lineTo(PENNANT_W - 0.4, 0);
    shape.lineTo(PENNANT_W, -PENNANT_H / 2);
    shape.lineTo(0, -PENNANT_H / 2);
    shape.closePath();
    pennantGeo = markSharedGeometry(new THREE.ShapeGeometry(shape));
  }
  // A spear point, not a bead: the silhouette that makes it read as a standard.
  flagFinialGeo ??= markSharedGeometry(new THREE.ConeGeometry(FLAG_FINIAL_R, FLAG_FINIAL_H, 10));
  carryRingGeo ??= markSharedGeometry(
    new THREE.RingGeometry(CARRY_RING_INNER, CARRY_RING_OUTER, 24),
  );
  const lean = new THREE.Group();
  lean.rotation.order = 'YXZ'; // yaw to the carrier first, then tilt back
  const pole = new THREE.Mesh(flagPoleGeo, surfaceMat({ color: 0x4a3728, roughness: 0.85 }));
  pole.position.y = FLAG_POLE_H / 2;
  lean.add(pole);
  // The socketed stone foot sits OUTSIDE the lean pivot: the pole tips over a
  // carrier's shoulder, but the plinth it was pulled out of does not travel.
  const foot = new THREE.Mesh(flagFootGeo, surfaceMat({ color: 0x6c6357, roughness: 0.95 }));
  foot.position.y = FLAG_FOOT_H / 2;
  group.add(foot);
  // Two gold ferrules banding the shaft, the detail that sells the weight.
  for (const y of [FLAG_POLE_H * 0.28, FLAG_POLE_H * 0.62]) {
    const band = new THREE.Mesh(flagBandGeo, gemMaterial(FLAG_GOLD));
    band.position.y = y;
    lean.add(band);
  }
  const pennant = new THREE.Mesh(pennantGeo, pennantMaterial(color, lowGfx));
  pennant.position.set(FLAG_POLE_R, FLAG_POLE_H - PENNANT_H / 2 - 0.1, 0);
  lean.add(pennant);
  const collar = new THREE.Mesh(flagCollarGeo, gemMaterial(FLAG_GOLD));
  collar.position.y = FLAG_POLE_H + 0.02;
  lean.add(collar);
  const finial = new THREE.Mesh(flagFinialGeo, gemMaterial(FLAG_GOLD));
  finial.position.y = FLAG_POLE_H + FLAG_FINIAL_H / 2 + 0.08;
  lean.add(finial);
  group.add(lean);
  const ring = new THREE.Mesh(carryRingGeo, glowMaterial(color));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = CARRY_RING_Y;
  ring.visible = false; // battleground_fx shows it only while carried
  group.add(ring);
  // Explicit team mapping, never a fallback: an unknown color gets NO fx refs
  // (static upright flag) rather than silently riding the wrong flag's state.
  const team = color === BG_TEAM_COLORS[0] ? 0 : color === BG_TEAM_COLORS[1] ? 1 : null;
  if (team !== null) {
    group.userData.bg = { kind: 'flag', team, color, lean, ring } satisfies BgObjectRefs;
  }
  return { group, height: FLAG_POLE_H + FLAG_FINIAL_H + 0.2 };
}
