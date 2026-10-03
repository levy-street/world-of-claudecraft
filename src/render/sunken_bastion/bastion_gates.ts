// The Sunken Bastion's gates and seals as structures: the barnacled iron
// portcullises (the Sea Gate, the Rampart Door, the Gaol Grate and the Keep
// Stair Chain), the Bailey Drawbridge that crashes down over the ditch, and
// Vael's fog walls (the Postern and the Beacon Ward) that part when their
// guardians fall.
//
// Each gate reads its on-screen state from the shared gate memory
// (../hollow_crypt/crypt_gate_state_core.ts, fed by the mirrored gate
// entities through ../gate_objects.ts) in an onBeforeRender hook, so a state
// swap plays as a reveal (a grille grinding up, a bridge falling, fog parting)
// and costs nothing off screen. A sealed gate (a boss engaged) flares.

import * as THREE from 'three';
import { SUNKEN_BASTION_GATES } from '../../sim/content/sunken_bastion';
import type { DungeonGateDef } from '../../sim/types';
import { GFX, sharedUniforms } from '../gfx';
import { gateMemoryKey, gateView } from '../hollow_crypt/crypt_gate_state_core';

interface GateRig {
  root: THREE.Group;
  /** Called every rendered frame with the gate's openness and seal pulse. */
  apply(openness: number, seal: number): void;
}

function ironMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x2c2d2b,
    roughness: 0.62,
    metalness: 0.55,
    emissive: 0x000000,
    flatShading: true,
    name: 'sunkenBastionGateIron',
  });
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

/** A heavy iron portcullis the width of the passage, rising 8.4 yd into its arch. */
function portcullis(width: number, height: number): GateRig {
  const parts: THREE.BufferGeometry[] = [];
  for (let x = -width / 2 + 0.55; x <= width / 2 - 0.45; x += 0.95) {
    parts.push(box(0.2, height, 0.2, x, height / 2, 0));
    // Barbed feet that bite into the stone.
    parts.push(new THREE.ConeGeometry(0.2, 0.8, 4).rotateX(Math.PI).translate(x, -0.35, 0));
  }
  for (let y = 1.0; y < height; y += 1.35) parts.push(box(width - 0.6, 0.22, 0.3, 0, y, 0));
  // Barnacle crust on the lowest band (the grille drowns at every tide).
  for (let x = -width / 2 + 0.8; x < width / 2 - 0.6; x += 1.7)
    parts.push(new THREE.DodecahedronGeometry(0.22, 0).translate(x + 0.4, 1.1, 0.16));
  const material = ironMaterial();
  const grid = new THREE.Mesh(mergeGeometries(parts), material);
  grid.castShadow = !!GFX.standardMaterials;
  const root = new THREE.Group();
  root.add(grid);
  return {
    root,
    apply(openness, seal) {
      grid.position.y = openness * (height - 0.6);
      material.emissive.setRGB(0.25 * seal, 0.55 * seal, 0.42 * seal);
    },
  };
}

/** The drawbridge: a timber deck hinged at the gatehouse, raised against the
 *  arch until the bailey is clear, then crashing down across the ditch. */
function drawbridge(gate: DungeonGateDef): GateRig {
  // Gate-local: x across the passage, +z along it toward the gatehouse (north).
  const deckLength = 20;
  const width = gate.hw * 2 - 1.2;
  const wood = new THREE.MeshStandardMaterial({
    color: 0x5a4632,
    roughness: 0.9,
    flatShading: true,
    name: 'sunkenBastionDrawbridgeWood',
  });
  const iron = ironMaterial();
  const planks: THREE.BufferGeometry[] = [];
  for (let z = 0.4; z < deckLength; z += 0.62) {
    planks.push(box(width - (z % 1.24 < 0.62 ? 0 : 0.3), 0.35, 0.56, 0, 0, -z));
  }
  const bands: THREE.BufferGeometry[] = [];
  for (const x of [-width / 2 + 0.4, width / 2 - 0.4])
    bands.push(box(0.35, 0.5, deckLength, x, 0.1, -deckLength / 2));
  for (let z = 2; z < deckLength; z += 5) bands.push(box(width + 0.2, 0.42, 0.28, 0, 0.05, -z));
  // The chains run from the deck's far corners up to the gatehouse.
  const chains: THREE.BufferGeometry[] = [];
  for (const x of [-width / 2 + 0.3, width / 2 - 0.3]) {
    for (let k = 0; k < 16; k++) {
      const t = k / 16;
      chains.push(
        new THREE.TorusGeometry(0.2, 0.06, 4, 6)
          .rotateY(k % 2 ? Math.PI / 2 : 0)
          .translate(x, 0.3 + t * 0.2, -deckLength * (1 - t)),
      );
    }
  }
  const deck = new THREE.Group();
  const wooden = new THREE.Mesh(mergeGeometries(planks), wood);
  const metal = new THREE.Mesh(mergeGeometries([...bands, ...chains]), iron);
  wooden.castShadow = metal.castShadow = true;
  deck.add(wooden, metal);
  // The hinge sits at the gatehouse lip (14 yd north of the gate point).
  const hinge = new THREE.Group();
  // Planks are 0.35 thick round the deck origin: their tops lie a hair over
  // the walked bridge height once lowered, so feet stand ON the timber.
  hinge.position.set(0, -0.12, 14);
  hinge.add(deck);
  const root = new THREE.Group();
  root.add(hinge);
  return {
    root,
    apply(openness, seal) {
      // Raised: the deck stands up against the arch (+90 deg); lowered: flat.
      // A heavy fall: slow start, a bounce as it slams onto the bailey lip.
      const k = openness;
      const bounce = k > 0.85 ? Math.sin(((k - 0.85) / 0.15) * Math.PI) * 0.04 : 0;
      hinge.rotation.x = (1 - k) * (Math.PI / 2) - bounce;
      iron.emissive.setRGB(0.2 * seal, 0.45 * seal, 0.35 * seal);
    },
  };
}

const FOG_WALL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FOG_WALL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vWorld;
uniform float uTime;
uniform float uOpen;
uniform float uSeal;
uniform float uLayer;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { s += noise(p) * a; p *= 2.1; a *= 0.5; }
  return s;
}
void main() {
  vec2 p = vUv * vec2(4.0, 3.0) + vec2(uTime * 0.12 + uLayer * 3.1, -uTime * 0.07);
  float m = fbm(p + fbm(p * 0.7 + uTime * 0.05) * 1.4);
  // The wall parts from its middle outward as it opens.
  float gap = abs(vUv.x - 0.5) * 2.0;
  float part = smoothstep(uOpen * 1.15 - 0.15, uOpen * 1.15 + 0.1, gap + (m - 0.5) * 0.35);
  float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(1.0, 0.55, vUv.y);
  float base = smoothstep(0.0, 0.1, vUv.y);
  float a = smoothstep(0.25, 0.75, m) * edge * base * part * (0.75 + 0.35 * uSeal);
  vec3 col = mix(vec3(0.55, 0.66, 0.62), vec3(0.62, 0.95, 0.72), 0.35 + 0.65 * uSeal);
  // Glints of Vael's green in the churn.
  col += vec3(0.3, 0.9, 0.55) * smoothstep(0.72, 0.9, m) * (0.4 + uSeal);
  gl_FragColor = vec4(col * 0.75, a * 0.62);
  #include <colorspace_fragment>
}
`;

/** A wall of Vael's fog across the passage (three churning sheets). */
function fogWall(width: number): GateRig {
  const uniforms = {
    uTime: sharedUniforms.uTime,
    uOpen: { value: 0 },
    uSeal: { value: 0 },
  };
  const root = new THREE.Group();
  const height = 11;
  for (let i = 0; i < 3; i++) {
    const material = new THREE.ShaderMaterial({
      name: 'sunkenBastionFogWall',
      vertexShader: FOG_WALL_VERT,
      fragmentShader: FOG_WALL_FRAG,
      uniforms: { ...uniforms, uLayer: { value: i } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(width + 3, height, 1, 1), material);
    sheet.position.set(0, height / 2 - 0.3, (i - 1) * 0.9);
    sheet.renderOrder = 9;
    root.add(sheet);
  }
  return {
    root,
    apply(openness, seal) {
      uniforms.uOpen.value = openness;
      uniforms.uSeal.value = seal;
    },
  };
}

/**
 * Every gate structure of one slot, driven by the gate memory of the slot
 * anchored at (ox, oz). Returns the group (instance-local frame).
 */
export function buildBastionGates(
  ox: number,
  oz: number,
  ground: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sunkenBastionGates';
  for (const gate of SUNKEN_BASTION_GATES) {
    const key = gateMemoryKey(ox, oz, gate.id);
    const width = gate.hw * 2;
    const rig =
      gate.kind === 'drawbridge'
        ? drawbridge(gate)
        : gate.kind === 'fog_wall'
          ? fogWall(width)
          : portcullis(width, gate.id === 'keep_chain' ? 7 : 9);
    const holder = new THREE.Group();
    holder.name = `gate:${gate.id}`;
    holder.position.set(gate.x, ground(gate.x, gate.z), gate.z);
    holder.rotation.y = gate.rot;
    holder.add(rig.root);
    const refresh = () => {
      const view = gateView(key, sharedUniforms.uTime.value);
      const seal =
        view.state === 'sealed' ? 0.7 + 0.3 * Math.sin(sharedUniforms.uTime.value * 5) : 0;
      rig.apply(view.openness, seal);
    };
    holder.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).onBeforeRender = refresh;
    });
    group.add(holder);
  }
  return group;
}
