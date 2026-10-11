// Moonwing Form's adornments, the THREE half of form_adornment_core.ts: the
// classic druid antlers (the antlered hood druid.glb always wore, which the
// composed body has no piece for), a crescent moon between them, and a pair of
// moonlit feather wings on the back.
//
// Everything is parented to the rig's own bones (`head`, `chest`), so it rides
// every clip, mount seat and far-LOD hide the body does with no plumbing of its
// own. Geometry and materials are module-level kits shared by every Moonwing on
// screen and never disposed (the halo.ts doctrine); a rig only adds and removes
// its meshes. The glow materials follow the shared rig_fx.ts recipe. The kit
// is registered in ABILITY_MATERIAL_SOURCES (ability_material_prewarm.ts)
// through `buildMoonwingStandIn`, so the boot manifest links its programs and
// uploads its maps; where that entry is deferred (a constrained device), the
// first mount on a rig still waits behind the compile gate (form_adornments.ts)
// instead of linking in a live frame.
//
// Units are raw KayKit bone space (the halo's). Placement was measured against
// the modular head (x +-0.45, crown ~0.81, hair to ~1.04, face at +z) and the
// druid kit's back piece (chest space z down to -0.61), then tuned by capture
// (scripts/form_adornment_shot.mjs).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceMat } from '../gfx';
import { markSharedGeometry } from '../shared_resource';
import type { MoonwingPose } from './form_adornment_core';
import { crescentTexture, wingTexture } from './form_adornment_textures';
import { markRigFx, rigGlowMaterial, tagStandInForTextureUpload } from './rig_fx';

/** Moonlit violet on the wings, a shade under the moonkin_form cast VFX
 *  colour so the additive layer reads violet over the tinted body. */
const WING_COLOR = 0xa47cf0;
/** Warm moonlight on the crescent: the moonkin star motes' pale gold. */
const CRESCENT_COLOR = 0xfff2c0;
/** Bone antlers, with a faint violet moonglow so they belong to the form. */
const ANTLER_COLOR = 0xeee2c6;
const ANTLER_GLOW = 0x6b4fd0;
const ANTLER_GLOW_INTENSITY = 0.28;
/** The leather wrap the classic antlers wear near the base. */
const WRAP_COLOR = 0x6e4a2c;

/** Crescent rest point between the antlers, head-bone space. */
export const CRESCENT_REST = { y: 1.24, z: -0.05, size: 0.4 } as const;
/** Wing root on the back, chest-bone space (x mirrors per side). */
export const WING_ROOT = { x: 0.14, y: 0.12, z: -0.62 } as const;
/** Wing swing about the spine, radians: folded along the back vs unfurled. */
const WING_FOLDED = 1.25;
const WING_OPEN = 0.42;
/** Resting lift of the wingtips, radians. */
const WING_LIFT = 0.1;

type Point = readonly [x: number, y: number, z: number, radius: number];

/** The right antler (x > 0), head-bone space: a chunky main beam rooted in
 *  the skull (the Moonwing tint leaves hair nearly clear, so an antler planted
 *  only in the hair reads as floating), arcing out and up, with two blunt tines rising off it (the
 *  KayKit druid's stubby, round-tipped antlers). Each polyline is
 *  [x, y, z, radius]; the last point's sphere is the rounded tip. */
const ANTLER_BEAM: readonly Point[] = [
  [0.18, 0.54, -0.04, 0.074],
  [0.29, 0.83, -0.07, 0.068],
  [0.44, 0.99, -0.09, 0.06],
  [0.61, 1.09, -0.09, 0.052],
  [0.71, 1.23, -0.07, 0.044],
  [0.74, 1.35, -0.05, 0.036],
];
const ANTLER_TINES: readonly (readonly Point[])[] = [
  [
    [0.32, 0.89, -0.075, 0.054],
    [0.31, 1.05, -0.06, 0.048],
    [0.33, 1.19, -0.04, 0.04],
  ],
  [
    [0.52, 1.04, -0.09, 0.05],
    [0.54, 1.19, -0.08, 0.044],
    [0.56, 1.31, -0.06, 0.036],
  ],
];
/** The wrap band: where on the beam's first segment it sits (just where the
 *  antler leaves the skull), and its size. */
const WRAP = { t: 0.82, radius: 0.084, length: 0.08 } as const;

/** One wing's plane, chest-bone units. The wing texture puts its root at
 *  WING_TEXTURE_ROOT (uv), which the geometry moves onto the pivot. */
const WING_SIZE = { width: 1.2, height: 1.08 } as const;
const WING_TEXTURE_ROOT = 0.06;

const UP = new THREE.Vector3(0, 1, 0);

function tubeSegment(a: Point, b: Point, radial: number): THREE.BufferGeometry {
  const from = new THREE.Vector3(a[0], a[1], a[2]);
  const to = new THREE.Vector3(b[0], b[1], b[2]);
  const dir = to.clone().sub(from);
  const length = dir.length();
  // CylinderGeometry runs along +Y: its top (+Y) end gets b's radius.
  const geo = new THREE.CylinderGeometry(b[3], a[3], length, radial, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  geo.applyMatrix4(
    new THREE.Matrix4().compose(from.clone().lerp(to, 0.5), q, new THREE.Vector3(1, 1, 1)),
  );
  return geo;
}

function joint(p: Point, radial: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(p[3], radial, Math.max(4, radial - 2));
  geo.translate(p[0], p[1], p[2]);
  return geo;
}

/** A smooth tapered polyline: open tubes between points, a sphere at every
 *  point so the bends and the tip read rounded. */
function tube(points: readonly Point[], radial: number, parts: THREE.BufferGeometry[]): void {
  for (let i = 0; i < points.length; i++) {
    parts.push(joint(points[i], radial));
    if (i > 0) parts.push(tubeSegment(points[i - 1], points[i], radial));
  }
}

function mirror(points: readonly Point[], side: 1 | -1): Point[] {
  return points.map(([x, y, z, r]) => [x * side, y, z, r] as const);
}

function mergedOrThrow(parts: THREE.BufferGeometry[], what: string): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`moonwing ${what} merge failed`);
  merged.computeBoundingSphere();
  return merged;
}

function buildAntlers(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1] as const) {
    tube(mirror(ANTLER_BEAM, side), 8, parts);
    for (const tine of ANTLER_TINES) tube(mirror(tine, side), 7, parts);
  }
  return mergedOrThrow(parts, 'antler');
}

function buildWraps(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1] as const) {
    const [a, b] = mirror(ANTLER_BEAM.slice(0, 2), side);
    const at = new THREE.Vector3(
      a[0] + (b[0] - a[0]) * WRAP.t,
      a[1] + (b[1] - a[1]) * WRAP.t,
      a[2] + (b[2] - a[2]) * WRAP.t,
    );
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    // Closed caps: the band is a short solid ring around the beam, a hair
    // narrower at its top edge as the beam tapers.
    const geo = new THREE.CylinderGeometry(WRAP.radius * 0.94, WRAP.radius, WRAP.length, 10);
    geo.applyMatrix4(
      new THREE.Matrix4().compose(
        at,
        new THREE.Quaternion().setFromUnitVectors(UP, dir),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    parts.push(geo);
  }
  return mergedOrThrow(parts, 'wrap');
}

/** One wing (side +1 = right), in its own pivot space: a single plane lying
 *  in the XY plane, its textured root on the origin and the wing reaching out
 *  and up. The left wing is the right one mirrored (double-sided material). */
function buildWing(side: 1 | -1): THREE.BufferGeometry {
  const { width, height } = WING_SIZE;
  const geo = new THREE.PlaneGeometry(width, height);
  geo.translate(width * (0.5 - WING_TEXTURE_ROOT), height * (0.5 - WING_TEXTURE_ROOT), 0);
  if (side < 0) geo.scale(-1, 1, 1);
  geo.computeBoundingSphere();
  return geo;
}

interface MoonwingKit {
  wing: THREE.MeshBasicMaterial;
  crescent: THREE.MeshBasicMaterial;
  antlerGeometry: THREE.BufferGeometry;
  wrapGeometry: THREE.BufferGeometry;
  crescentGeometry: THREE.PlaneGeometry;
  leftWingGeometry: THREE.BufferGeometry;
  rightWingGeometry: THREE.BufferGeometry;
}

let kit: MoonwingKit | null = null;

function moonwingKit(): MoonwingKit {
  kit ??= {
    wing: rigGlowMaterial('moonwing_adornment:wing-glow', wingTexture(), WING_COLOR),
    crescent: rigGlowMaterial(
      'moonwing_adornment:crescent-glow',
      crescentTexture(),
      CRESCENT_COLOR,
    ),
    antlerGeometry: markSharedGeometry(buildAntlers()),
    wrapGeometry: markSharedGeometry(buildWraps()),
    crescentGeometry: markSharedGeometry(
      new THREE.PlaneGeometry(CRESCENT_REST.size, CRESCENT_REST.size),
    ),
    leftWingGeometry: markSharedGeometry(buildWing(-1)),
    rightWingGeometry: markSharedGeometry(buildWing(1)),
  };
  return kit;
}

/** The lit antler materials: surfaceMat's shared props program (Lambert on the
 *  low tier), resolved per build so a graphics-profile change is honoured. */
function antlerMaterials(): { bone: THREE.Material; wrap: THREE.Material } {
  return {
    bone: surfaceMat({
      color: ANTLER_COLOR,
      emissive: ANTLER_GLOW,
      emissiveIntensity: ANTLER_GLOW_INTENSITY,
      roughness: 0.7,
    }),
    wrap: surfaceMat({ color: WRAP_COLOR, roughness: 0.95 }),
  };
}

/** Every material a Moonwing rig can draw, for the prewarm registration. */
export function moonwingMaterials(): THREE.Material[] {
  const { wing, crescent } = moonwingKit();
  const { bone, wrap } = antlerMaterials();
  return [wing, crescent, bone, wrap];
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  renderOrder = 0,
): THREE.Mesh {
  const out = markRigFx(new THREE.Mesh(geometry, material));
  out.name = name;
  out.renderOrder = renderOrder;
  return out;
}

/** One rig's Moonwing pieces, attached to its bones until disposed. */
export class MoonwingAdornment {
  readonly head: THREE.Group | null = null;
  readonly crescent: THREE.Mesh | null = null;
  readonly leftWing: THREE.Group | null = null;
  readonly rightWing: THREE.Group | null = null;
  /** Every group this set parented into the rig (form_adornments.ts holds
   *  them hidden until their programs link, and hides them under a ghost). */
  readonly roots: readonly THREE.Object3D[];

  /** `model` is the rig subtree holding the `head` and `chest` bones; a rig
   *  missing one simply goes without those pieces. */
  constructor(model: THREE.Object3D, antlers: boolean) {
    const k = moonwingKit();
    const headBone = model.getObjectByName('head');
    if (headBone) {
      const head = markRigFx(new THREE.Group());
      head.name = 'moonwing_head';
      if (antlers) {
        const lit = antlerMaterials();
        head.add(mesh(k.antlerGeometry, lit.bone, 'moonwing_antlers'));
        head.add(mesh(k.wrapGeometry, lit.wrap, 'moonwing_antler_wraps'));
      }
      const crescent = mesh(k.crescentGeometry, k.crescent, 'moonwing_crescent', 2);
      crescent.position.set(0, CRESCENT_REST.y, CRESCENT_REST.z);
      head.add(crescent);
      headBone.add(head);
      this.head = head;
      this.crescent = crescent;
    }
    const chestBone = model.getObjectByName('chest');
    if (chestBone) {
      this.leftWing = this.attachWing(chestBone, -1, k.leftWingGeometry, k.wing);
      this.rightWing = this.attachWing(chestBone, 1, k.rightWingGeometry, k.wing);
    }
    this.roots = [this.head, this.leftWing, this.rightWing].filter(
      (root): root is THREE.Group => root !== null,
    );
  }

  private attachWing(
    chest: THREE.Object3D,
    side: 1 | -1,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ): THREE.Group {
    const pivot = markRigFx(new THREE.Group());
    pivot.name = side > 0 ? 'moonwing_wing_right' : 'moonwing_wing_left';
    pivot.position.set(WING_ROOT.x * side, WING_ROOT.y, WING_ROOT.z);
    pivot.add(mesh(geometry, material, `${pivot.name}_feathers`, 1));
    chest.add(pivot);
    return pivot;
  }

  /** Pose the pieces for this frame (form_adornment_core.moonwingPoseInto). */
  apply(pose: MoonwingPose): void {
    const swing = WING_FOLDED + (WING_OPEN - WING_FOLDED) * pose.unfurl + pose.sweep;
    const lift = (WING_LIFT + pose.beat) * pose.unfurl;
    this.rightWing?.rotation.set(0, swing, lift);
    this.leftWing?.rotation.set(0, -swing, -lift);
    if (this.crescent) {
      this.crescent.position.y = CRESCENT_REST.y + pose.crescentLift;
      this.crescent.rotation.z = 0.35 + pose.crescentSway;
    }
  }

  /** Detach from the rig. The kits are shared and stay alive. */
  dispose(): void {
    for (const root of this.roots) root.removeFromParent();
  }
}

/** The hidden prewarm stand-in: a bare `head` + `chest` pair wearing the full
 *  set (antlers included), so the compile lane links every program a live
 *  Moonwing draws. Its meshes carry the `vfx` render category, which is what
 *  the ability-primitives manifest entry walks to upload textures, so the
 *  painted maps are resident before the first shift too (the live pieces keep
 *  the character's category). */
export function buildMoonwingStandIn(): THREE.Group {
  const root = new THREE.Group();
  const chest = new THREE.Group();
  chest.name = 'chest';
  const head = new THREE.Group();
  head.name = 'head';
  chest.add(head);
  root.add(chest);
  new MoonwingAdornment(root, true).apply({
    unfurl: 1,
    beat: 0,
    sweep: 0,
    crescentLift: 0,
    crescentSway: 0,
  });
  tagStandInForTextureUpload(root);
  return root;
}
