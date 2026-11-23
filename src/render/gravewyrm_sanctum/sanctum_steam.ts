// The Gravewyrm Sanctum's steam and smoke, and ONLY over the cult's works
// (design section 8: "steam only over the Thaw Works and the vault"): sooty
// pitch smoke rolling up off the Thaw Works' soul pyres, white steam rising
// off the melt channel and the slush of the sledge park, and the vault's three
// meltwater pools steaming in the cold. Everywhere else the air stays clear.
//
// Each kind is ONE instanced draw of camera-facing puffs whose whole life
// (rise, swell, drift on the cold air, fade) runs in the vertex shader on the
// shared clock from its seed; the CPU never touches them after the build.
// Cosmetic only: the card count sheds with the effects tier (`density`), and
// the puffs stay thin and draw under every floor telegraph's band.

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import { markSharedMaterial } from '../shared_resource';
import {
  planSteamSources,
  type SteamSource,
  sanctumGround,
  sanctumHash,
} from './sanctum_plan_core';

export interface SanctumSteamOptions {
  lowGfx: boolean;
  /** 0..1 cosmetic density (0.35 low, 0.6 medium, 1 high and up). */
  density: number;
}

const VERT = /* glsl */ `
attribute vec3 aBase;
attribute vec4 aSeed; // seed, spread radius, climb height, soot
uniform float uTime;
varying vec2 vUv;
varying float vLife;
varying float vSeed;
varying float vSoot;
#include <fog_pars_vertex>
float h11(float p) { return fract(sin(p * 78.233) * 43758.5453); }
void main() {
  float seed = aSeed.x;
  float spread = aSeed.y;
  float climb = aSeed.z;
  vSoot = aSeed.w;
  // Smoke pours steadily and climbs higher; steam rises in slower breaths.
  float rate = mix(0.075, 0.11, vSoot) * (0.8 + 0.4 * h11(seed * 2.9));
  float life = fract(uTime * rate + h11(seed * 7.1));
  vLife = life;
  vSeed = seed;
  float ang = h11(seed * 3.7) * 6.2831853;
  float r = spread * sqrt(h11(seed * 5.3));
  vec3 p = aBase + vec3(cos(ang) * r, 0.0, sin(ang) * r);
  // Rise, easing off as it cools; drift on the cold air down the cirque.
  float rise = (1.0 - pow(max(1.0 - life, 0.0), 1.7)) * climb;
  p.y += rise;
  p.x += life * life * climb * 0.35 + sin(uTime * 0.3 + seed) * 0.4 * life;
  p.z += life * climb * 0.12;
  float size = mix(0.9, 3.4, pow(max(life, 0.0), 0.7)) * mix(1.0, 1.35, vSoot) * (0.75 + 0.5 * h11(seed));
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  // A slow turn per puff so no two cards share their billow's grain.
  float rot = seed * 3.1 + uTime * 0.05 * (h11(seed * 9.1) - 0.5);
  vec2 q = position.xy;
  q = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
  mvPosition.xy += q * size;
  vUv = position.xy + 0.5;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vLife;
varying float vSeed;
varying float vSoot;
uniform float uTime;
uniform float uOpacity;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 c = vUv - 0.5;
  float d = length(c) * 2.0;
  float t = uTime * 0.12 + vSeed;
  float n = noise(c * 3.2 + vec2(vSeed * 1.3, -t)) * 0.6 + noise(c * 7.0 - vec2(t * 0.7, vSeed)) * 0.4;
  // A soft billow: the edge eaten by the noise, never a card's square.
  float body = smoothstep(1.0, 0.25, d + (n - 0.5) * 0.55);
  float fade = smoothstep(0.0, 0.18, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife));
  float a = body * fade * (0.45 + 0.55 * n) * uOpacity;
  if (a < 0.004) discard;
  // Steam: white with a cold blue in its shadowed lobes. Smoke: soot black at
  // the pyre, thinning to a cold grey as it climbs.
  vec3 steam = mix(vec3(0.55, 0.64, 0.76), vec3(0.9, 0.93, 0.96), n);
  vec3 smoke = mix(vec3(0.03, 0.03, 0.035), vec3(0.22, 0.24, 0.29), smoothstep(0.0, 0.8, vLife) * (0.5 + 0.5 * n));
  vec3 col = mix(steam, smoke, smoothstep(0.2, 0.8, vSoot));
  gl_FragColor = vec4(col, a * mix(0.55, 0.75, vSoot));
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

const materials = new Map<'steam' | 'smoke', THREE.ShaderMaterial>();

function puffMaterial(kind: 'steam' | 'smoke'): THREE.ShaderMaterial {
  let m = materials.get(kind);
  if (!m) {
    m = new THREE.ShaderMaterial({
      name: kind === 'steam' ? 'gravewyrmSanctumSteam' : 'gravewyrmSanctumSmoke',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: sharedUniforms.uTime,
        uOpacity: { value: kind === 'steam' ? 0.42 : 0.6 },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    markSharedMaterial(m);
    materials.set(kind, m);
  }
  return m;
}

/** Where a source's puffs are born and how high they climb: a pyre's smoke
 *  leaves from above its flames, steam from the water or the slush. */
function sourceBase(s: SteamSource): { y: number; climb: number } {
  const gy = sanctumGround(s.x, s.z);
  return s.soot >= 0.5 ? { y: gy + 4.4, climb: 22 } : { y: gy + 0.3, climb: 9 };
}

/** The puffs of one kind as one instanced draw, or null when none. */
function buildPuffs(
  list: readonly SteamSource[],
  kind: 'steam' | 'smoke',
  density: number,
): THREE.Mesh | null {
  const counts = list.map((s) => Math.max(1, Math.round(s.cards * density)));
  const n = counts.reduce((a, b) => a + b, 0);
  if (n === 0) return null;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const base = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  let i = 0;
  list.forEach((s, si) => {
    const b = sourceBase(s);
    for (let k = 0; k < counts[si]; k++) {
      base.set([s.x, b.y, s.z], i * 3);
      seed.set([si * 17.3 + k * 2.71 + sanctumHash(si, k) * 9, s.r, b.climb, s.soot], i * 4);
      i++;
    }
    box.expandByPoint(v.set(s.x - s.r - 4, b.y, s.z - s.r - 4));
    box.expandByPoint(v.set(s.x + s.r + b.climb * 0.4 + 4, b.y + b.climb + 4, s.z + s.r + 4));
  });
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = n;
  geo.boundingBox = box;
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  quad.dispose();
  const mesh = new THREE.Mesh(geo, puffMaterial(kind));
  mesh.name = kind === 'steam' ? 'gravewyrmSanctumSteam' : 'gravewyrmSanctumSmoke';
  return mesh;
}

/** Every steam and smoke source of the Sanctum: one draw per kind. */
export function buildSanctumSteam(opts: SanctumSteamOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gravewyrmSanctumSteam';
  const density = Math.max(
    0.2,
    Math.min(1, opts.lowGfx ? Math.min(opts.density, 0.35) : opts.density),
  );
  const sources = planSteamSources();
  const smoke = buildPuffs(
    sources.filter((s) => s.soot >= 0.5),
    'smoke',
    density,
  );
  const steam = buildPuffs(
    sources.filter((s) => s.soot < 0.5),
    'steam',
    density,
  );
  if (smoke) group.add(smoke);
  if (steam) group.add(steam);
  return group;
}
