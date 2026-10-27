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

/** The curtain of crystal light: streaks of the vein's light rising out of
 *  the channel through stretched crystal facets, brightest at its foot, its
 *  crown ragged and drifting; sealed it runs faster and a white hem burns
 *  at its foot. The Heart Bridge's braids the four veins across its width
 *  round a white-gold heart. Blended over the scene (so it reads over the
 *  pale Breath and the dark Hearth alike), double sided, no texture. */
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
  float ends = smoothstep(0.0, 0.9, x) * smoothstep(0.0, 0.9, uWidth - x);
  // Streaks of light rising, each its own pace.
  float s1 = vn(vec2(x * 2.1, yy * 0.55 - t * 1.25));
  float s2 = vn(vec2(x * 4.7 + 13.0, yy * 1.1 - t * 2.1));
  float streak = smoothstep(0.42, 0.95, s1 * 0.62 + s2 * 0.48);
  // Crystal facets: tall cells drifting up, their edges catching the light.
  vec2 cp = vec2(x * 1.25, yy * 0.62 - t * 0.32);
  vec2 ci = floor(cp);
  vec2 cf = fract(cp);
  float d1 = 9.0;
  float d2 = 9.0;
  float cell = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 r = o + vec2(h21(ci + o), h21(ci + o + 7.7)) * 0.85 - cf;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; cell = h21(ci + o + 3.1); }
      else if (d < d2) { d2 = d; }
    }
  }
  float edge = 1.0 - smoothstep(0.0, 0.16, sqrt(d2) - sqrt(d1));
  float glint = smoothstep(0.82, 1.0, cell) * (0.5 + 0.5 * sin(uTime * 2.3 + cell * 40.0));
  // The crown: ragged, drifting, standing at the curtain's rise.
  float top = uRise * (0.86 + 0.13 * vn(vec2(x * 0.9, uTime * 0.45)));
  float body = 1.0 - smoothstep(top - 0.16, top, y);
  float hem = exp(-y * 9.0) * step(0.02, uRise);
  float fade = 0.72 + 0.28 * (1.0 - y);
  float a = (0.3 + 0.42 * streak + 0.34 * edge + 0.45 * glint) * body * fade;
  a += hem * (0.55 + 0.4 * uSealed);
  a = min(0.9, a * ends * min(uFilm, 1.0) * (1.0 + 0.25 * max(0.0, uFilm - 1.0)));
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
    tint = mix(uColor, mix(c0, c1, smoothstep(0.35, 0.65, k)), 0.6 + 0.3 * streak);
  }
  // A luminous curtain over the bright veins and the dark alike: its own
  // colour (blended over the scene, never just added to a pale floor), its
  // facets and its foot white-hot, flaring while it is sealed.
  vec3 col = tint * (1.15 + 0.35 * max(0.0, uFilm - 1.0) + 0.25 * streak);
  col = mix(col, vec3(1.0, 0.98, 0.94), clamp(hem * 0.6 + glint * 0.45 + edge * 0.18, 0.0, 0.85));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
const VEIL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), veil);
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
