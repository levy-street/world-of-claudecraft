// The Hollow Crypt's gates and seals as structures: the Undercroft Grille's
// gatehouse and portcullis, the bone barriers, the frost-web curtains, the
// warded arches of the Twin Seals and the choir door, and the Unquiet Ward over
// the ring.
//
// Every moving part is driven by ONE shader patch reading a per-gate `uOpen`
// uniform (0 closed, 1 open) and a per-vertex `aSeq` stagger, updated from the
// gate memory (crypt_gate_state_core.ts) in an onBeforeRender hook: uniforms
// upload after that hook, so the reveal is frame-exact and costs nothing when
// the gate is off screen. A sealed gate (a boss engaged) flares violet.

import * as THREE from 'three';
import { HOLLOW_CRYPT_GATES } from '../../sim/content/hollow_crypt';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { GFX, sharedUniforms } from '../gfx';
import { gateMemoryKey, gateView } from './crypt_gate_state_core';

type OpenUniforms = {
  uOpen: { value: number };
  uSeal: { value: number };
  uClosedOffset: { value: THREE.Vector3 };
  uOpenOffset: { value: THREE.Vector3 };
  uStagger: { value: number };
};

function openUniforms(closed: THREE.Vector3, open: THREE.Vector3, stagger = 0): OpenUniforms {
  return {
    uOpen: { value: 0 },
    uSeal: { value: 0 },
    uClosedOffset: { value: closed },
    uOpenOffset: { value: open },
    uStagger: { value: stagger },
  };
}

const OPEN_PATCH_KEY = 'hollowCryptGateOpen:v1';

/** A lit material whose vertices slide from their closed to their open offset. */
function openableMaterial(
  color: number,
  u: OpenUniforms,
  opts: { rough?: number; metal?: number; emissive?: number } = {},
): THREE.Material {
  const material = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        color,
        roughness: opts.rough ?? 0.85,
        metalness: opts.metal ?? 0,
        emissive: opts.emissive ?? 0x000000,
        flatShading: true,
      })
    : new THREE.MeshLambertMaterial({
        color,
        emissive: opts.emissive ?? 0x000000,
        flatShading: true,
      });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aSeq;
uniform float uOpen;
uniform float uStagger;
uniform vec3 uClosedOffset;
uniform vec3 uOpenOffset;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float gateLocal = clamp(uOpen * (1.0 + uStagger) - aSeq * uStagger, 0.0, 1.0);
transformed += mix(uClosedOffset, uOpenOffset, gateLocal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSeal;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uSeal * vec3(0.42, 0.16, 0.85);',
      );
  };
  material.customProgramCacheKey = () => OPEN_PATCH_KEY;
  return material;
}

/** A ward membrane: a shimmering veil that fades as it opens and flares sealed. */
function wardMaterial(color: number, u: OpenUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'hollowCryptWard',
    vertexShader: /* glsl */ `${CAMERA_RELATIVE_GLSL}
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * wocCamRelView(w.xyz);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      varying vec3 vWorld;
      uniform float uTime;
      uniform float uOpen;
      uniform float uSeal;
      uniform vec3 uColor;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
        float runes = noise(vUv * vec2(18.0, 10.0) + vec2(0.0, uTime * 0.6));
        float sheet = 0.18 + 0.55 * pow(max(runes, 0.0), 3.0) + 0.25 * sin(vUv.y * 40.0 - uTime * 3.0) * 0.5;
        // Opening shatters it upward from the floor.
        float gone = smoothstep(vUv.y - 0.15, vUv.y + 0.05, uOpen * 1.2 + noise(vUv * 9.0) * 0.2 - 0.1);
        float a = edge * sheet * (1.0 - gone) * (0.7 + 0.5 * uSeal);
        vec3 col = mix(uColor, vec3(0.75, 0.35, 1.0), uSeal);
        gl_FragColor = vec4(col * a * 1.4, a);
        #include <colorspace_fragment>
      }
    `,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uOpen: u.uOpen,
      uSeal: u.uSeal,
      uColor: { value: new THREE.Color(color) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function withSeq(
  geo: THREE.BufferGeometry,
  seq: number | ((x: number, y: number, z: number) => number),
): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const arr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    arr[i] = typeof seq === 'number' ? seq : seq(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  geo.setAttribute('aSeq', new THREE.BufferAttribute(arr, 1));
  return geo;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Small local merge (position, normal, aSeq; non-indexed) to keep draw calls low.
  const nonIndexed = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of nonIndexed) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const seq = new Float32Array(count);
  let o = 0;
  for (const g of nonIndexed) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    const s = g.attributes.aSeq?.array as Float32Array | undefined;
    if (s) seq.set(s, o);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('aSeq', new THREE.BufferAttribute(seq, 1));
  out.computeBoundingSphere();
  return out;
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rot = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(rot);
  g.translate(x, y, z);
  return g;
}

function cone(
  r: number,
  h: number,
  x: number,
  y: number,
  z: number,
  tiltX = 0,
  tiltZ = 0,
): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, 5);
  g.translate(0, h / 2, 0);
  g.rotateX(tiltX);
  g.rotateZ(tiltZ);
  g.translate(x, y, z);
  return g;
}

// ---- per-kind builders (gate-local frame: x across the passage, z along it) ------

function portcullis(u: OpenUniforms, width: number): THREE.Object3D[] {
  const bars: THREE.BufferGeometry[] = [];
  const h = 9;
  for (let x = -width / 2 + 0.6; x <= width / 2 - 0.5; x += 1.1) {
    bars.push(withSeq(box(0.22, h, 0.22, x, h / 2, 0), 0));
    bars.push(withSeq(cone(0.18, 0.7, x, -0.7, 0, Math.PI), 0));
  }
  for (let y = 1.4; y < h; y += 1.6) bars.push(withSeq(box(width - 0.8, 0.2, 0.26, 0, y, 0), 0));
  const grid = new THREE.Mesh(
    merge(bars),
    openableMaterial(0x2b2a30, u, { rough: 0.55, metal: 0.6 }),
  );
  grid.castShadow = true;
  // The gatehouse: two towers and a lintel the grille rises into.
  const stone = new THREE.MeshStandardMaterial({
    color: 0x4f4a48,
    roughness: 0.95,
    flatShading: true,
  });
  const house = new THREE.Group();
  for (const side of [-1, 1]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(4.4, 16, 4.6), stone);
    tower.position.set(side * (width / 2 + 2.2), 8, 0);
    tower.castShadow = true;
    house.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.4, 5, 4), stone);
    cap.position.set(side * (width / 2 + 2.2), 18.5, 0);
    cap.rotation.y = Math.PI / 4;
    house.add(cap);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(width + 1, 4.5, 3.2), stone);
  lintel.position.set(0, 12.2, 0);
  lintel.castShadow = true;
  house.add(lintel);
  return [grid, house];
}

function boneBarrier(u: OpenUniforms, width: number): THREE.Object3D[] {
  const parts: THREE.BufferGeometry[] = [];
  let k = 0;
  for (let x = -width / 2 + 0.5; x <= width / 2 - 0.4; x += 0.9) {
    k++;
    const h = 3.5 + ((k * 37) % 7) * 0.45;
    const lean = (((k * 13) % 5) - 2) * 0.12;
    parts.push(withSeq(cone(0.32, h, x, 0, (k % 2) * 0.6 - 0.3, lean, lean * 0.6), 0));
  }
  // Rib arches crossing the spikes.
  for (let i = 0; i < 5; i++) {
    const g = new THREE.TorusGeometry(width / 2 - 1, 0.18, 5, 18, Math.PI);
    g.scale(1, 0.55 + i * 0.05, 1);
    g.translate(0, 0.2, -0.8 + i * 0.4);
    parts.push(withSeq(g, 0));
  }
  const mesh = new THREE.Mesh(merge(parts), openableMaterial(0xd9d0bc, u, { rough: 0.8 }));
  mesh.castShadow = true;
  return [mesh];
}

let webTexture: THREE.CanvasTexture | null = null;

function webCanvasTexture(): THREE.CanvasTexture {
  if (webTexture) return webTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('web texture canvas unavailable');
  ctx.clearRect(0, 0, 512, 512);
  ctx.strokeStyle = 'rgba(235,245,255,0.95)';
  ctx.lineWidth = 2;
  const cx = 256;
  const cy = 250;
  const spokes = 22;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + (i % 3) * 0.03;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * 360, cy + Math.sin(a) * 360);
    ctx.stroke();
  }
  ctx.lineWidth = 1.4;
  for (let r = 14; r < 330; r += 12 + r * 0.05) {
    ctx.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const rr = r * (0.94 + 0.06 * Math.sin(i * 1.7 + r));
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr + (i % 2) * 2;
      if (i === 0) ctx.moveTo(x, y);
      else
        ctx.quadraticCurveTo(
          cx + Math.cos(a - 0.14) * rr * 0.96,
          cy + Math.sin(a - 0.14) * rr * 0.96,
          x,
          y,
        );
    }
    ctx.stroke();
  }
  webTexture = new THREE.CanvasTexture(c);
  webTexture.colorSpace = THREE.SRGBColorSpace;
  return webTexture;
}

function webCurtain(u: OpenUniforms, width: number): THREE.Object3D[] {
  const tex = webCanvasTexture();
  const material = new THREE.MeshBasicMaterial({
    map: tex,
    color: 0xcfe3f0,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
    name: 'hollowCryptWebCurtain',
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOpen;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.y -= uOpen * uOpen * 14.0;\ntransformed.x *= 1.0 + uOpen * 0.6;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uOpen;\nuniform float uSeal;')
      // After the texel and vertex colour, before the basic shading reads
      // diffuseColor.rgb: a seal tint written any later never reaches the
      // pixel, and the stock final write (with its NaN guard) stays untouched.
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a *= (1.0 - uOpen);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.55, 1.0), uSeal * 0.6);',
      );
  };
  material.customProgramCacheKey = () => 'hollowCryptWebCurtain:v1';
  const out: THREE.Object3D[] = [];
  for (let layer = 0; layer < 2; layer++) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width + 2, 11), material);
    plane.position.set(layer * 0.3, 5.3, layer * 0.4 - 0.2);
    plane.rotation.z = layer * 0.35;
    out.push(plane);
  }
  return out;
}

function wardedArch(u: OpenUniforms, width: number, color: number): THREE.Object3D[] {
  const stone = new THREE.MeshStandardMaterial({
    color: 0x5a5350,
    roughness: 0.92,
    flatShading: true,
  });
  const arch = new THREE.Group();
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(2.2, 11, 2.6), stone);
    post.position.set(side * (width / 2 + 1.1), 5.5, 0);
    post.castShadow = true;
    arch.add(post);
    // The sigil disc on each post: bright while the seal holds.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), wardMaterial(color, u));
    disc.position.set(side * (width / 2 + 1.1), 7.5, 1.35);
    arch.add(disc);
  }
  const curve = new THREE.Mesh(
    new THREE.TorusGeometry(width / 2 + 1.1, 1.1, 6, 20, Math.PI),
    stone,
  );
  curve.position.set(0, 11, 0);
  curve.castShadow = true;
  arch.add(curve);
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(width, 14), wardMaterial(color, u));
  veil.position.set(0, 7, 0);
  return [arch, veil];
}

function riteWard(u: OpenUniforms, width: number): THREE.Object3D[] {
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(width, 12), wardMaterial(0x6fd6a8, u));
  veil.position.set(0, 6, 0);
  return [veil];
}

/**
 * Every gate structure of one slot, driven by the gate memory of the slot
 * anchored at (ox, oz). Returns the group (instance-local frame).
 */
export function buildCryptGates(
  ox: number,
  oz: number,
  ground: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hollowCryptGates';
  for (const gate of HOLLOW_CRYPT_GATES) {
    const key = gateMemoryKey(ox, oz, gate.id);
    const width = gate.hw * 2;
    let u: OpenUniforms;
    let parts: THREE.Object3D[];
    switch (gate.kind) {
      case 'portcullis':
        u = openUniforms(new THREE.Vector3(), new THREE.Vector3(0, 8.6, 0));
        parts = portcullis(u, width);
        break;
      case 'bone_barrier':
        u = openUniforms(new THREE.Vector3(), new THREE.Vector3(0, -7.5, 0));
        parts = boneBarrier(u, width);
        break;
      case 'web_curtain':
        u = openUniforms(new THREE.Vector3(), new THREE.Vector3());
        parts = webCurtain(u, width);
        break;
      case 'warded_arch':
        u = openUniforms(new THREE.Vector3(), new THREE.Vector3());
        parts = wardedArch(u, width, 0xb28cff);
        break;
      default:
        u = openUniforms(new THREE.Vector3(), new THREE.Vector3());
        parts = riteWard(u, width);
        break;
    }
    const holder = new THREE.Group();
    holder.name = `gate:${gate.id}`;
    holder.position.set(gate.x, ground(gate.x, gate.z), gate.z);
    holder.rotation.y = gate.rot;
    const fieldSpace = new THREE.Group();
    for (const part of parts) {
      if (part.userData.fieldSpace) fieldSpace.add(part);
      else holder.add(part);
    }
    // One hook per gate: every mesh of the gate refreshes the shared uniforms.
    const refresh = () => {
      const view = gateView(key, sharedUniforms.uTime.value);
      u.uOpen.value = view.openness;
      u.uSeal.value =
        view.state === 'sealed' ? 0.75 + 0.25 * Math.sin(sharedUniforms.uTime.value * 5) : 0;
    };
    for (const root of [holder, fieldSpace]) {
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).onBeforeRender = refresh;
      });
    }
    group.add(holder, fieldSpace);
  }
  return group;
}
