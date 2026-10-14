// A ship at her moorings: the hull rocks on the harbour swell, sails breathe
// against their bolt ropes, pennants snap at the mastheads - and all of it goes
// perfectly still when nobody is near.
//
// Same machinery as tree_sway.ts, and for the same reason: ONE onBeforeCompile
// patch on the SHARED template material (placed_assets.ts attaches it as the
// GLB parses, so every placement of the asset and every instanced batch rides
// one program), the renderer's existing per-frame `uTime` and `uSwayPlayer`
// uniforms, and an in-shader gate on the mesh's WORLD base position. No
// per-frame JS, no animation mixers, no extra draws or materials: past
// SHIP_WIND_OFF yards the gate is exactly zero and the ship rests, which is
// the whole point - a harbour full of ships must not animate over the horizon.
//
// THE ROCK (every `ship_*` material of a template that has a hull): a small
// roll about the bow axis, a slower pitch about the beam, and a heave, all
// about the waterline, applied in the mesh's own frame AFTER the canvas has
// moved so the sails ride the hull. Deliberately faint (SPACEY: "super low
// key"): a third of a degree of roll is a hand's width at the rail and a yard
// at the truck of a mast eighty yards up, which is what a moored ship does.
// Collision does not move with it - at these angles the deck under a player's
// feet shifts by less than a plank's thickness, and a ladder or landing stays
// where the sim thinks it is.
//
// The per-vertex weight for the canvas is the mesh's own UV, which the Blender
// builds author for exactly this (scripts/assets/deepglass/dg_galleon.py):
//   SAIL  u across the canvas, v down from the yard, so sin(pi u) sin(pi v) is
//         zero along all four bolt ropes and one mid-canvas: the sail bellies
//         without tearing off its yard. The swell is ONE-SIDED and along the
//         model's +X (the bow): a square sail is drawn forward of its mast and
//         bellies leeward, so it breathes instead of flapping through its own
//         pole. Fore-and-aft sails (spanker, jibs) lie in that plane, so the
//         same term only slides along their own surface: no clipping there
//         either.
//   FLAG  u from the hoist (0) to the fly (1), squared, so the pennant is
//         pinned at the truck and ripples at its tip; v is that pennant's own
//         phase seed, because all three fly from ONE object and would
//         otherwise snap in perfect unison. Displaced in the model's
//         own frame (a pennant's two skins must move TOGETHER, which a normal
//         displacement would not do since their normals oppose), and drawn
//         BACK toward the hoist as it swings, so the cloth keeps its length
//         instead of stretching out into a banner.
// A cloth mesh with no UVs at all (an untextured material loses TEXCOORD_0 in
// the glTF export) falls back to a flat, smaller whole-strip flutter.
//
// Frames: the shipped GLB is quantized, so a mesh's vertices sit in a unit
// cube and the node carries the scale (x24 for the galleon) and an offset;
// `transformed` in the shader is in THAT frame. Anything authored in yards
// (the waterline, the heave) is converted through the mesh's transform at
// attach time and baked into the GLSL as a constant. The mesh frame is assumed
// axis-aligned with the model (+X bow, +Y up), which the exporter keeps.

import * as THREE from 'three';
import { GFX, sharedUniforms } from './gfx';
import { treeSwayUniforms } from './tree_sway';

/** Full motion within this many yards of the player... */
export const SHIP_WIND_FULL = 70;
/** ...easing to nothing here. Nothing on a ship animates past this. */
export const SHIP_WIND_OFF = 100;

export type ShipWindKind = 'sail' | 'flag';

/**
 * Which wind a material's canvas takes, by the kit's material names
 * (`ship_sail`, `ship_sail_crest`, `ship_cloth`, `wharf_cloth`). Deliberately
 * scoped to the Warden kit's prefixes: a catalogue GLB that happens to call a
 * material "sail" keeps its own look.
 */
export function shipWindKindForMaterial(name: string | undefined): ShipWindKind | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (!n.startsWith('ship_') && !n.startsWith('wharf_')) return null;
  if (n.includes('sail')) return 'sail';
  if (n.includes('cloth')) return 'flag';
  return null;
}

/** Is this material part of a ship's fabric (hull, decks, rig, canvas)? The
 *  dock kit (`wharf_*`) never rocks, whatever it is made of. */
export function shipRockMaterial(name: string | undefined): boolean {
  return !!name && name.toLowerCase().startsWith('ship_');
}

/** The material that makes a template a SHIP: only an object wearing it rocks.
 *  The gangplank shares the ship's timber and rope but has no hull, and a
 *  gangplank that rocked would saw at the pier. */
export const SHIP_HULL_MATERIAL = 'ship_hull';

// Model-yard amplitudes at scale 1 (they ride the placement's scale, like the
// geometry, so a ship placed three times over still moves in proportion).
// Kept SMALL on purpose: canvas breathes, it does not wobble. A sail's belly
// only ever deepens by SAIL_AMP, and the pennant's tip swings a hand's width.
const SAIL_AMP = 0.09;
const FLAG_AMP_SIDE = 0.2;
const FLAG_AMP_LIFT = 0.07;
// How hard the pennant is pulled back toward its hoist as it swings: cloth in
// a wave is SHORTER end to end than cloth at rest.
const FLAG_SHORTEN = 0.11;
// Whole-strip flutter for cloth that reached us without UVs: small, because
// every vertex moves together and the hoist would otherwise leave its mast.
const FLAG_FLAT_WEIGHT = 0.22;

// The rock, in the model's yards and radians (heave and waterline are converted
// into the mesh frame at attach time). Two roll terms at unrelated periods so
// the motion never reads as a metronome; the pitch and heave slower still.
/** Roll about the bow axis: 0.32 degrees, plus a 0.1 degree ripple. */
export const SHIP_ROLL_RAD = 0.0056;
const SHIP_ROLL_RIPPLE_RAD = 0.0018;
/** Pitch about the beam: 0.14 degrees. */
export const SHIP_PITCH_RAD = 0.0025;
/** Heave, in model yards (at SPACEY's ~2.2x vertical scale, about 5 cm). */
export const SHIP_HEAVE_YD = 0.025;
/** The galleon's waterline in model yards (editor/float_on_water_core.ts
 *  seats the ship by the same number): the axis the hull rolls about. */
export const SHIP_WATERLINE_YD = 1.72;
const f = (n: number): string => n.toFixed(4);
const f5 = (n: number): string => n.toFixed(5);

/** The gate + phase preamble every kind shares. */
function gateGlsl(): string {
  return `
    #ifdef USE_INSTANCING
      vec4 wocShipBase4 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    #else
      vec4 wocShipBase4 = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    #endif
    vec2 wocShipBase = wocShipBase4.xz;
    float wocShipGate =
      1.0 - smoothstep(${f(SHIP_WIND_FULL)}, ${f(SHIP_WIND_OFF)}, distance(wocShipBase, uSwayPlayer));
    float wocShipPh = wocShipBase.x * 0.11 + wocShipBase.y * 0.13;
    // the same slow gust that rolls across the groves, so canvas and foliage
    // breathe on one wind instead of two metronomes
    float wocShipGust = 0.72 + 0.28 * sin(uTime * 0.23 - (wocShipBase.x + wocShipBase.y) * 0.021);
  `;
}

function windGlsl(kind: ShipWindKind, hasUv: boolean): string {
  if (kind === 'sail') {
    return `
      vec2 wocSailUv = clamp(uv, 0.0, 1.0);
      float wocSailW = sin(PI * wocSailUv.x) * sin(PI * wocSailUv.y);
      // 0..1, never negative: the belly only ever DEEPENS, so the canvas
      // cannot swing back through the mast behind it
      float wocSailWave = 0.55 + 0.45 * sin(uTime * 0.6 + wocShipPh + wocSailUv.y * 1.9)
        + 0.18 * sin(uTime * 1.05 + wocShipPh * 1.3 + wocSailUv.x * 2.4);
      transformed.x += max(wocSailWave, 0.0)
        * ${f(SAIL_AMP)} * wocSailW * wocShipGust * wocShipGate;
    `;
  }
  const weight = hasUv
    ? 'float wocFlagW = clamp(uv.x, 0.0, 1.0); wocFlagW *= wocFlagW;'
    : `float wocFlagW = ${f(FLAG_FLAT_WEIGHT)};`;
  // The hoist-to-fly pull-back needs to know which way the cloth runs; only
  // the UV-weighted pennants (the ship's, which stream aft along -X) get it.
  const shorten = hasUv
    ? `transformed.x += wocFlagSnap * wocFlagSnap * ${f(FLAG_SHORTEN)} * wocFlagW * wocShipGate;`
    : '';
  return `
    ${weight}
    // SNAPPED to sixteenths: every vertex of one pennant must get the exact
    // same seed. Read raw, the hoist and fly edges of a flag differ by a hair
    // (and mesh quantization adds more), which gave the two edges slightly
    // different RATES - they drift apart over minutes and wring the cloth out
    // of shape. The authored seeds sit on sixteenths, so this is exact.
    float wocFlagSeed = ${hasUv ? 'floor(uv.y * 16.0 + 0.5) / 16.0' : '0.0'};
    // each pennant gets its own offset AND its own rate off that seed, so the
    // three at a ship's mastheads never snap in unison
    float wocFlagPh = uTime * (1.9 + 0.9 * fract(wocFlagSeed * 7.7))
      + wocShipPh + fract(wocFlagSeed * 17.3) * 6.2831
      - ${hasUv ? 'uv.x' : '0.0'} * 4.4;
    float wocFlagSnap = sin(wocFlagPh) + 0.35 * sin(wocFlagPh * 1.9 + 1.1);
    transformed.y += wocFlagSnap * ${f(FLAG_AMP_SIDE)} * wocFlagW * wocShipGust * wocShipGate;
    transformed.z += cos(wocFlagPh * 1.2) * ${f(FLAG_AMP_LIFT)} * wocFlagW * wocShipGate;
    ${shorten}
  `;
}

/** The mesh-frame numbers the rock needs: where the waterline sits and how
 *  far a yard of heave is, in the (quantized) vertex units. */
export interface ShipRockFrame {
  pivotY: number;
  heave: number;
}

/** Derive the rock's frame from a mesh's transform inside its template. */
export function shipRockFrame(mesh: THREE.Object3D): ShipRockFrame {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mesh.matrixWorld.decompose(pos, quat, scale);
  const s = scale.y || 1;
  return { pivotY: (SHIP_WATERLINE_YD - pos.y) / s, heave: SHIP_HEAVE_YD / s };
}

function rockGlsl(frame: ShipRockFrame): string {
  return `
    // the hull rocks: roll about the bow axis (+X), a slower pitch about the
    // beam (+Z) and a heave, all about the waterline, all gated
    float wocRockRoll = (sin(uTime * 0.74 + wocShipPh) * ${f(SHIP_ROLL_RAD)}
      + sin(uTime * 1.21 + wocShipPh * 1.9 + 0.7) * ${f(SHIP_ROLL_RIPPLE_RAD)}) * wocShipGate;
    float wocRockPitch = sin(uTime * 0.53 + wocShipPh + 2.1) * ${f(SHIP_PITCH_RAD)} * wocShipGate;
    float wocRockHeave = sin(uTime * 0.61 + wocShipPh + 1.1) * ${f5(frame.heave)} * wocShipGate;
    vec3 wocRockP = transformed - vec3(0.0, ${f(frame.pivotY)}, 0.0);
    float wocRockCr = cos(wocRockRoll), wocRockSr = sin(wocRockRoll);
    wocRockP.yz = vec2(wocRockP.y * wocRockCr - wocRockP.z * wocRockSr,
                       wocRockP.y * wocRockSr + wocRockP.z * wocRockCr);
    float wocRockCp = cos(wocRockPitch), wocRockSp = sin(wocRockPitch);
    wocRockP.xy = vec2(wocRockP.x * wocRockCp - wocRockP.y * wocRockSp,
                       wocRockP.x * wocRockSp + wocRockP.y * wocRockCp);
    transformed = wocRockP + vec3(0.0, ${f(frame.pivotY)} + wocRockHeave, 0.0);
  `;
}

interface Plan {
  wind: ShipWindKind | null;
  hasUv: boolean;
  rock: ShipRockFrame | null;
}

/**
 * Attach the ship's motion to every material under `object` (a freshly parsed
 * GLB template): wind on its canvas, and the rock on all of it if it has a
 * hull. Idempotent per material, like the tree sway: the parsed glTF is cached
 * for the session, so a second view attaching to the same template must not
 * stack patches.
 */
export function attachShipMotion(object: THREE.Object3D): void {
  if (!GFX.windSway) return;
  object.updateMatrixWorld(true);
  // Only a template with a hull is a ship. Decide that first: the plan for a
  // ship's timber differs from the same-named timber on a gangplank.
  let isShip = false;
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats.some((m) => m?.name === SHIP_HULL_MATERIAL)) isShip = true;
  });
  // A material can be shared by several meshes; it only gets the UV-weighted
  // wind if EVERY mesh wearing it actually carries UVs.
  const plans = new Map<THREE.Material, Plan>();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const hasUv = !!mesh.geometry?.getAttribute?.('uv');
    for (const mat of mats) {
      if (!mat) continue;
      const wind = shipWindKindForMaterial(mat.name);
      const rock = isShip && shipRockMaterial(mat.name) ? shipRockFrame(mesh) : null;
      if (!wind && !rock) continue;
      const seen = plans.get(mat);
      if (seen) seen.hasUv &&= hasUv;
      else plans.set(mat, { wind, hasUv, rock });
    }
  });
  for (const [mat, plan] of plans) {
    if (mat.userData.wocShipMotion) continue;
    mat.userData.wocShipMotion = true;
    // the canvas moves first, then the whole ship carries it
    const block = [
      gateGlsl(),
      plan.wind ? windGlsl(plan.wind, plan.hasUv) : '',
      plan.rock ? rockGlsl(plan.rock) : '',
    ].join('\n');
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = sharedUniforms.uTime;
      sh.uniforms.uSwayPlayer = treeSwayUniforms.uSwayPlayer;
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform vec2 uSwayPlayer;`,
        )
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${block}`);
    };
    // Keyed by the patch's CONTENT, not the material: two materials that
    // three would already share a program for (same maps, same flags) keep
    // sharing it when they wear the same patch. The rock's baked frame is
    // part of that content.
    const rockKey = plan.rock ? `rock@${f(plan.rock.pivotY)}/${f5(plan.rock.heave)}` : 'still';
    mat.customProgramCacheKey = () =>
      `woc-ship-motion:${plan.wind ?? 'none'}${plan.hasUv ? '' : '-flat'}:${rockKey}`;
    // Force a recompile: on a re-attach (a maker toggling sway back on) the
    // material is already built against the unpatched program.
    mat.needsUpdate = true;
  }
}
