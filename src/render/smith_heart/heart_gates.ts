// The Smith's Heart's gates as structures (heart_gates_core.ts): the stone
// slabs that split and sink, and the forge seals: the Smith's carved
// threshold of granite with crystal growing in a channel down its top, a
// standing stone with a crystal crown at each end (the gate kit,
// public/models/props/smith_heart_gate_kit.glb, from
// docs/design/raid/kit/build_smith_heart_gate_kit.py), and a curtain of
// crystal light rising out of the channel in the gate's vein colour (the
// Heart Bridge's braids all four) that burns shut, flares and beats while a
// guardian holds it sealed, and drains into its channel as the threshold
// sinks away. Each reads its on-screen state from the shared gate memory
// (../hollow_crypt/crypt_gate_state_core.ts, fed by the mirrored gate
// entities through ../gate_objects.ts); the interior's frame driver calls
// `update` once per drawn frame, and a gate writes its pose only while it
// moves. Drawn whole on every tier: a gate is what blocks the raid.
//
// GPU preparation: every material here is built with the interior (the
// compile gate links it); the crystal's tinted glow is the kit glow's own
// program (a basic vertex-colour material, its colour the gate's tint), and
// the curtain one small shader with no texture.

import * as THREE from 'three';
import { SMITH_HEART_GATES } from '../../sim/content/smith_heart';
import { SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';
import { sharedUniforms, surfaceMat } from '../gfx';
import { gateMemoryKey, gateView } from '../hollow_crypt/crypt_gate_state_core';
import { markSharedGeometry } from '../shared_resource';
import {
  type HeartGatePart,
  type HeartGateRig,
  heartGatePartPose,
  heartGateParts,
  heartGateRig,
  heartGateTint,
  heartGateVein,
  heartSealGatePose,
} from './heart_gates_core';
import {
  heartKitMeshes,
  heartKitPiece,
  SMITH_HEART_GATE_KIT_URL,
  SMITH_HEART_HAMMER_KIT_URL,
} from './heart_kit';
import { HEART_PALETTE } from './heart_plan_core';

/** The gate kit's threshold spans this many yards at stretch 1 (the width
 *  every forge seal gate shares). */
const KIT_SILL_WIDTH = 15.2;

let unitBox: THREE.BufferGeometry | null = null;

function box(): THREE.BufferGeometry {
  unitBox ??= markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
  return unitBox;
}

function stoneMaterial(): THREE.Material {
  return surfaceMat({ color: HEART_PALETTE.stone, roughness: 0.92, flatShading: true });
}

function seamMaterial(): THREE.Material {
  return surfaceMat({
    color: 0x2a2018,
    emissive: SMITH_HEART_VEIN_COLORS.hammer,
    emissiveIntensity: 1.2,
    flatShading: true,
  });
}

/** The curtain of crystal light: an aurora rising out of the channel, soft
 *  folds of the vein's light climbing and thinning to nothing, with no edge
 *  anywhere (the foot melts into the channel's glow, the crown into the air,
 *  the ends into the standing stones' shade); sealed it runs faster, brighter
 *  and beats. The Heart Bridge's braids the four veins across its width round
 *  a white-gold heart. Blended over the scene (so it reads over the pale
 *  Breath and the dark Hearth alike), double sided, no texture. The sheet
 *  itself hangs in folds (`VEIL_VERT`), so it never reads as a flat pane. */
const VEIL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFilm;
uniform float uRise;
uniform float uSealed;
uniform float uWidth;
uniform float uHeight;
uniform float uFour;
uniform vec3 uColor;
uniform vec3 uVeins[4];
varying vec2 vUv;
varying float vFold;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float x = vUv.x * uWidth;
  float y = vUv.y;
  float yy = y * uHeight;
  float t = uTime * (1.0 + 0.9 * uSealed);
  // Its ends fade into the standing stones' shade.
  float ends = smoothstep(0.0, 2.2, x) * smoothstep(0.0, 2.2, uWidth - x);
  // Long soft folds of light climbing, each its own pace, swaying as they
  // rise; never a pattern, only value drifting across the sheet.
  float sway = 0.7 * sin(yy * 0.9 - t * 0.5 + x * 0.21);
  float f1 = vn(vec2((x + sway) * 0.85, yy * 0.16 - t * 0.34));
  float f2 = vn(vec2((x - sway) * 2.3 + 13.0, yy * 0.34 - t * 0.62));
  float f3 = vn(vec2(x * 5.5 + 31.0, yy * 0.7 - t * 1.1));
  float folds = f1 * 0.58 + f2 * 0.3 + f3 * 0.12;
  folds = smoothstep(0.26, 0.76, folds);
  // Where the sheet turns from the eye its light gathers.
  float gather = 0.72 + 0.5 * vFold;
  // The crown: thins out unevenly, each fold reaching its own height.
  float reach = uRise * (0.5 + 0.5 * vn(vec2(x * 0.62, uTime * 0.16)) + 0.2 * (folds - 0.5));
  float crown = 1.0 - smoothstep(reach * 0.25, reach, y);
  // The foot: no line, the light only gathers as it leaves the channel.
  float foot = smoothstep(0.0, 0.2, y);
  float a = (0.2 + 0.62 * folds) * gather * crown * foot;
  a *= ends * min(uFilm, 1.0) * (1.0 + 0.3 * max(0.0, uFilm - 1.0));
  a = min(0.78, a);
  if (a <= 0.004) discard;
  vec3 tint = uColor;
  if (uFour > 0.5) {
    // The Heart Bridge: the four veins braided across it, slowly turning,
    // round a white-gold heart.
    float u = fract(vUv.x * 2.0 + yy * 0.05 - uTime * 0.04) * 4.0;
    float k = fract(u);
    int b = int(floor(u));
    vec3 c0 = b == 0 ? uVeins[0] : b == 1 ? uVeins[1] : b == 2 ? uVeins[2] : uVeins[3];
    vec3 c1 = b == 0 ? uVeins[1] : b == 1 ? uVeins[2] : b == 2 ? uVeins[3] : uVeins[0];
    tint = mix(uColor, mix(c0, c1, smoothstep(0.2, 0.8, k)), 0.3 + 0.4 * folds);
  }
  // A luminous curtain over the bright veins and the dark alike: its own
  // colour (blended over the scene, never just added to a pale floor), hotter
  // low down and in the folds' hearts, flaring while it is sealed.
  vec3 col = tint * (1.05 + 0.35 * max(0.0, uFilm - 1.0) + 0.3 * folds);
  col = mix(col, vec3(1.0, 0.97, 0.9), clamp((1.0 - y) * (1.0 - y) * 0.42 * folds + 0.12 * uSealed, 0.0, 0.6));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
const VEIL_VERT = /* glsl */ `
uniform float uTime;
uniform float uWidth;
varying vec2 vUv;
varying float vFold;
void main() {
  vUv = uv;
  // The sheet hangs in slow folds (yards, along its depth), pinned at both
  // ends and at its foot in the channel.
  float x = uv.x * uWidth;
  float pin = smoothstep(0.0, 1.5, x) * smoothstep(0.0, 1.5, uWidth - x);
  float s = sin(x * 1.05 + uTime * 0.42) + 0.6 * sin(x * 2.3 - uTime * 0.31);
  vFold = 0.5 + 0.5 * cos(x * 1.05 + uTime * 0.42);
  vec3 p = position;
  p.z += s * 0.16 * pin * smoothstep(0.0, 0.5, uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

function veilMaterial(gateId: string, width: number, height: number): THREE.ShaderMaterial {
  const four = heartGateVein(gateId) === 'heart';
  return new THREE.ShaderMaterial({
    name: 'smithHeartGateVeil',
    vertexShader: VEIL_VERT,
    fragmentShader: VEIL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uFilm: { value: 1 },
      uRise: { value: 1 },
      uSealed: { value: 0 },
      uWidth: { value: width },
      uHeight: { value: height },
      uFour: { value: four ? 1 : 0 },
      uColor: { value: new THREE.Color(heartGateTint(gateId)) },
      uVeins: {
        value: [
          new THREE.Color(SMITH_HEART_VEIN_COLORS.hammer),
          new THREE.Color(SMITH_HEART_VEIN_COLORS.breath),
          new THREE.Color(SMITH_HEART_VEIN_COLORS.quench),
          new THREE.Color(SMITH_HEART_VEIN_COLORS.heat),
        ],
      },
    },
  });
}

/** The crystal's glow, tinted by its gate (the kit glow's program: a basic
 *  vertex-colour material; the fallback boxes take a plain one). */
function crystalGlow(tint: number, vertexColors: boolean): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: tint,
    vertexColors,
    toneMapped: false,
    name: vertexColors ? 'SmithHeartKitGlow' : 'smithHeartGateCrystal',
  });
}

interface GateRig {
  root: THREE.Group;
  apply(openness: number, sealed: boolean, t: number): void;
}

/** One gate: a mesh per planned part, posed from the plan (the kit's carved
 *  threshold and stones once the gate kit has landed). */
function buildRig(rig: HeartGateRig, width: number, gateId: string): GateRig {
  const root = new THREE.Group();
  const meshes: { part: HeartGatePart; mesh: THREE.Object3D; kit: boolean }[] = [];
  if (rig === 'slab') {
    for (const part of heartGateParts(rig, width)) {
      // The Slab's halves are the Hammer kit's carved halves once it has
      // landed (both in the shut slab's frame: its base centre); the box
      // stand-ins and the seam otherwise.
      const kit =
        part.role === 'half'
          ? heartKitMeshes(
              SMITH_HEART_HAMMER_KIT_URL,
              (part.side ?? 1) < 0 ? 'Kit_SlabHalfL' : 'Kit_SlabHalfR',
            )
          : null;
      if (kit) {
        root.add(kit);
        meshes.push({ part, mesh: kit, kit: true });
        continue;
      }
      if (part.role === 'crack' && heartKitPiece(SMITH_HEART_HAMMER_KIT_URL, 'Kit_SlabHalfL'))
        continue;
      const mesh = new THREE.Mesh(box(), part.role === 'half' ? stoneMaterial() : seamMaterial());
      mesh.scale.set(part.w, part.h, part.d);
      mesh.position.set(part.x, part.y, part.z);
      root.add(mesh);
      meshes.push({ part, mesh, kit: false });
    }
    let lastK = -1;
    return {
      root,
      apply(k) {
        if (k === lastK) return;
        lastK = k;
        for (const { part, mesh, kit } of meshes) {
          const pose = heartGatePartPose(part, rig, k);
          // A kit half stands on the slab's base centre: it moves by the
          // pose's offset from the box half's own shut centre.
          if (kit) mesh.position.set(pose.x - part.x, pose.y - part.y, pose.z - part.z);
          else mesh.position.set(pose.x, pose.y, pose.z);
          mesh.visible = pose.shown;
        }
      },
    };
  }
  // ---- the forge seal ------------------------------------------------------------------
  const tint = new THREE.Color(heartGateTint(gateId));
  const parts = heartGateParts(rig, width);
  const haveKit =
    heartKitPiece(SMITH_HEART_GATE_KIT_URL, 'Kit_GateSill') !== null &&
    heartKitPiece(SMITH_HEART_GATE_KIT_URL, 'Kit_GateStone') !== null;
  // The threshold's crystal and the stones' crowns: their own tinted glow
  // (the stones' stays lit, a breath, when the gate stands open).
  const sillGlow = crystalGlow(tint.getHex(), haveKit);
  const stoneGlow = crystalGlow(tint.getHex(), haveKit);
  const sinking = new THREE.Group();
  sinking.name = 'smithHeartGateSill';
  root.add(sinking);
  let veil: THREE.ShaderMaterial | null = null;
  for (const part of parts) {
    if (part.role === 'veil') {
      veil = veilMaterial(gateId, part.w, part.h + 0.15);
      // Enough columns for the sheet's folds (`VEIL_VERT`).
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 40, 2), veil);
      plane.name = 'smithHeartGateVeil';
      plane.scale.set(part.w, part.h + 0.15, 1);
      plane.position.set(part.x, part.y - 0.075, part.z);
      sinking.add(plane);
      continue;
    }
    if (haveKit && (part.role === 'sill' || part.role === 'crystal' || part.role === 'seam')) {
      // The kit's threshold carries its own crystal and channel.
      if (part.role !== 'sill') continue;
      const kit = heartKitMeshes(SMITH_HEART_GATE_KIT_URL, 'Kit_GateSill');
      if (kit) {
        kit.scale.x = width / KIT_SILL_WIDTH;
        for (const m of kit.children)
          if (m instanceof THREE.Mesh && m.name.endsWith(':glow')) m.material = sillGlow;
        sinking.add(kit);
      }
      continue;
    }
    if (part.role === 'post') {
      const kit = haveKit ? heartKitMeshes(SMITH_HEART_GATE_KIT_URL, 'Kit_GateStone') : null;
      if (kit) {
        // The stone's inner face (its +X) toward the passage.
        kit.position.set(part.x, 0, part.z);
        if ((part.side ?? 1) > 0) kit.rotation.y = Math.PI;
        for (const m of kit.children)
          if (m instanceof THREE.Mesh && m.name.endsWith(':glow')) m.material = stoneGlow;
        root.add(kit);
        continue;
      }
    }
    const mesh = new THREE.Mesh(
      box(),
      part.role === 'crystal' || part.role === 'seam' ? sillGlow : stoneMaterial(),
    );
    mesh.scale.set(part.w, part.h, part.d);
    mesh.position.set(part.x, part.y, part.z);
    if (part.role === 'post') root.add(mesh);
    else sinking.add(mesh);
  }
  let lastK = -1;
  let lastFilm = -1;
  return {
    root,
    apply(k, sealed, t) {
      const pose = heartSealGatePose(k, sealed, t);
      if (k !== lastK) {
        lastK = k;
        sinking.position.y = -pose.sink;
        sinking.visible = pose.shown;
      }
      const f = Math.round(pose.film * 50) / 50;
      if (veil) {
        veil.uniforms.uRise.value = pose.rise;
        veil.uniforms.uSealed.value = sealed ? 1 : 0;
      }
      if (f === lastFilm) return;
      lastFilm = f;
      if (veil) veil.uniforms.uFilm.value = Math.max(0, f);
      // Shut, the crystal burns its vein's colour; sealed, it flares.
      sillGlow.color.copy(tint).multiplyScalar(0.25 + 0.75 * Math.max(0, f));
      stoneGlow.color.copy(tint).multiplyScalar(0.4 + 0.6 * Math.max(0, f));
    },
  };
}

export interface HeartGates {
  group: THREE.Group;
  update(): void;
}

/**
 * Every gate structure of the slot anchored at (ox, oz), driven by its gate
 * memory. Returns the group (instance-local frame).
 */
export function buildHeartGates(
  ox: number,
  oz: number,
  ground: (x: number, z: number) => number,
): HeartGates {
  const group = new THREE.Group();
  group.name = 'smithHeartGates';
  const rigs: { key: string; rig: GateRig }[] = [];
  for (const gate of SMITH_HEART_GATES) {
    const kind = heartGateRig(gate.kind);
    if (!kind) continue;
    const rig = buildRig(kind, gate.hw * 2, gate.id);
    const holder = new THREE.Group();
    holder.name = `gate:${gate.id}`;
    holder.position.set(gate.x, ground(gate.x, gate.z), gate.z);
    holder.rotation.y = gate.rot;
    holder.add(rig.root);
    // Paint the shut pose before the first frame (the compile gate links
    // every part as it stands).
    rig.apply(0, false, 0);
    group.add(holder);
    rigs.push({ key: gateMemoryKey(ox, oz, gate.id), rig });
  }
  return {
    group,
    update() {
      const now = sharedUniforms.uTime.value;
      for (const { key, rig } of rigs) {
        const view = gateView(key, now);
        rig.apply(view.openness, view.state === 'sealed', now);
      }
    },
  };
}
