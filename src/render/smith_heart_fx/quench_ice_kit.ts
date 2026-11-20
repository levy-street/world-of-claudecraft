// The Quench's ice kit, shared by her entrance (quench_entrance_fx.ts) and
// her death (quench_death_fx.ts): the floor's frost and the web of cracks
// (a dark fracture with the cold light leaking up through it, laid on the
// lake), the conjured blades of lake ice (their profile's geometry and their
// crystal program), a blade's star of cracks in the ice. Shaders and
// geometry builders only: each painter builds its own meshes and materials
// with them under its own root before its gated attach. No light.

import * as THREE from 'three';
import { HEAT_NOISE_GLSL } from './heat_lava_glsl';
import {
  ENTRANCE_BLADE_PROFILE,
  QUENCH_ENTRANCE_BLADES,
  type WebPoint,
} from './quench_entrance_core';

const B = QUENCH_ENTRANCE_BLADES;

// ---- the floor: frost and the web ------------------------------------------------------------

export const FLOOR_VERT = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Frost creeping over the ice: feathered rime and crazed plates inside a
 *  ragged front (its own yards: the disc's local frame), its front edge a
 *  breath brighter. */
export const FROST_FRAG = /* glsl */ `
  uniform float uReach;
  uniform float uAlpha;
  varying vec2 vLocal;
  ${HEAT_NOISE_GLSL}
  void main() {
    vec2 p = vLocal;
    float r = length(p);
    float n = fbm(p * 0.16);
    float front = uReach * (0.8 + 0.35 * n);
    float inside = 1.0 - smoothstep(front - 3.0, front, r);
    if (inside <= 0.001) discard;
    float plates = 1.0 - smoothstep(0.0, 0.07, cellEdge(p * 0.32));
    float fern = fbm(p * 1.4 + n * 2.5);
    float rim = smoothstep(front - 3.0, front - 0.8, r) * inside;
    // Glints: a point of light in some cells of a fine grid.
    vec2 g = p * 2.2;
    vec2 cell = floor(g);
    vec2 off = vec2(hh2(cell), hh2(cell + 7.1)) * 0.8 + 0.1;
    float gd = length(fract(g) - off);
    float glint = step(0.9, hh2(cell + 3.3)) * (1.0 - smoothstep(0.0, 0.12, gd));
    float a = inside * (0.02 + 0.09 * fern * fern + 0.05 * plates + 0.12 * rim + 0.45 * glint) * uAlpha;
    vec3 col = mix(vec3(0.5, 0.75, 0.98), vec3(0.85, 0.95, 1.0), fern) + rim * 0.1 + glint * 0.4;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.6));
  }
`;

export const STRIP_VERT = /* glsl */ `
  attribute float aReveal;
  attribute float aSide;
  varying float vReveal;
  varying float vSide;
  varying vec2 vLocal;
  void main() {
    vReveal = aReveal;
    vSide = aSide;
    vLocal = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** A crack of the web: a dark fracture (the char pass darkens the ice) with
 *  the cold light leaking up through it (the glow pass), its running tip
 *  brightest; the light breathing on the crack's own yards. */
export const WEB_FRAG = /* glsl */ `
  uniform float uGrow;
  uniform float uGlow;
  uniform float uTime;
  varying float vReveal;
  varying float vSide;
  varying vec2 vLocal;
  ${HEAT_NOISE_GLSL}
  void main() {
    float shown = 1.0 - smoothstep(uGrow - 0.03, uGrow, vReveal);
    if (shown <= 0.001) discard;
    float s = abs(vSide);
    float tq = (uGrow - vReveal) / 0.04;
    float tip = exp(-tq * tq) * (1.0 - step(0.995, uGrow));
    float n = vn(vLocal * 1.3 + vec2(uTime * 0.35, -uTime * 0.25));
    float core = 1.0 - smoothstep(0.0, 0.18 + 0.08 * n, s);
    float halo = 1.0 - smoothstep(0.18, 1.0, s);
    float g = uGlow * (0.7 + 0.5 * n);
    vec3 e = vec3(0.08, 0.38, 1.0) * halo * 0.6 * g
      + vec3(0.4, 0.78, 1.0) * core * 0.95 * g
      + vec3(0.85, 0.97, 1.0) * tip * (core * 2.0 + halo * 0.5);
    // The fracture fades with its light as the scene ends (no dark web left
    // on the lake to pop away).
    float a = clamp(shown * (core * 0.75 + halo * 0.3 * min(g, 1.0)) * min(1.0, uGlow * 1.6), 0.0, 1.0);
    gl_FragColor = vec4(e * shown / max(a, 0.02), a);
  }
`;

// ---- the conjured blades: crystal swords with a burning heart ----------------------------------

export const BLADE_VERT = /* glsl */ `
  attribute float aH;
  attribute float aCore;
  varying vec3 vN;
  varying vec3 vV;
  varying float vH;
  varying float vCore;
  varying vec3 vGlow;
  void main() {
    vH = aH;
    vCore = aCore;
    #ifdef USE_INSTANCING_COLOR
    vGlow = instanceColor;
    #else
    vGlow = vec3(1.0);
    #endif
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

/** A sword of lake ice: deep and clear through its flats, its facets
 *  catching a cold sheen and a play of light inside (a refraction's look:
 *  bands that slide as the view turns over the facets), a burning blue core
 *  down its ridge, its keen edges lit white, its rim pale; the instance's
 *  colour its light. */
export const BLADE_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vV;
  varying float vH;
  varying float vCore;
  varying vec3 vGlow;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vV);
    float nv = abs(dot(n, v));
    float fr = 1.0 - nv;
    float rim = fr * fr;
    float light = vGlow.r;
    float along = sin(vH * 3.14159);
    float inner = 0.5 + 0.5 * sin(dot(n, vec3(11.0, 7.0, 13.0)) * 1.7 + vH * 21.0 - uTime * 1.3);
    inner = inner * inner;
    float core = 1.0 - smoothstep(0.0, 0.32, vCore);
    float edge = smoothstep(0.72, 1.0, vCore);
    // A step deeper and more saturated than it should read: the Quench's
    // grade lifts it to clear blue ice on screen (quench_breath_core.ts).
    vec3 deep = vec3(0.0, 0.03, 0.2);
    vec3 cyan = vec3(0.0, 0.45, 1.0);
    vec3 pale = vec3(0.25, 0.7, 1.0);
    // A saturated deep-blue body, solid enough to stand dark against the
    // pale lake, its ridge burning cyan, its keen edges lit.
    vec3 col = deep * (0.55 + 0.6 * nv);
    col += cyan * core * (0.45 + 0.4 * light) * (0.5 + 0.5 * along);
    col += cyan * edge * (0.35 + 0.35 * light);
    col += pale * rim * 0.28;
    col += cyan * inner * 0.18 * (1.0 - edge);
    float a = clamp(0.93 + 0.07 * rim, 0.0, 0.99);
    gl_FragColor = vec4(col, a);
  }
`;

/** A blade's own crack in the ice where it broke out: a star of cracks
 *  running out with cold light in them (the instance's colour: red its
 *  reveal, green its strength). */
export const STAR_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vK;
  void main() {
    vUv = uv;
    #ifdef USE_INSTANCING_COLOR
    vK = instanceColor.rg;
    #else
    vK = vec2(1.0);
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
export const STAR_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vK;
  ${HEAT_NOISE_GLSL}
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0 || r < 0.0001 || vK.y <= 0.001) discard;
    float a = atan(p.y, p.x);
    float jag = vn(vec2(a * 3.0, r * 6.0)) - 0.5;
    float spokes = abs(sin(a * 4.5 + jag * 1.6 + r * 1.3));
    float line = 1.0 - smoothstep(0.0, 0.09 + 0.05 * (1.0 - r), spokes);
    float ringy = 1.0 - smoothstep(0.0, 0.05, abs(r - 0.45 + jag * 0.1));
    float shown = 1.0 - smoothstep(vK.x - 0.08, vK.x, r);
    float k = max(line, ringy * 0.6) * shown * (1.0 - r * 0.6);
    vec3 col = mix(vec3(0.2, 0.6, 1.0), vec3(0.85, 0.97, 1.0), line * (1.0 - r));
    gl_FragColor = vec4(col * k * vK.y, 1.0);
  }
`;

/** A strip pair per point of each line (`aReveal`, `aSide`), its places laid
 *  on the floor at the placing (layWeb). */
export function webGeometry(
  lines: readonly (readonly WebPoint[])[],
  count: number,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const reveal = new Float32Array(count);
  const side = new Float32Array(count);
  const index: number[] = [];
  let v = 0;
  for (const line of lines) {
    for (let k = 0; k < line.length; k++) {
      reveal[v] = line[k].reveal;
      reveal[v + 1] = line[k].reveal;
      side[v] = -1;
      side[v + 1] = 1;
      if (k > 0) index.push(v - 2, v - 1, v, v - 1, v + 1, v);
      v += 2;
    }
  }
  geo.setAttribute('aReveal', new THREE.BufferAttribute(reveal, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setIndex(index);
  return geo;
}

/** A conjured blade: the profile's rings as flat-diamond sections joined
 *  facet to facet (flat shaded), `aH` its height share for the light. */
export function bladeGeometry(): THREE.BufferGeometry {
  const prof = ENTRANCE_BLADE_PROFILE;
  const L = B.length;
  const pos: number[] = [];
  const h: number[] = [];
  const core: number[] = [];
  // Eight corners a ring: the keen edges, the bevels, the raised ridge down
  // each face (a fuller in crystal), so every facet catches the light. Each
  // corner's share out from the ridge (0) to the edge (1).
  const SHARE = [1, 0.62, 0, 0.62, 1, 0.62, 0, 0.62];
  const ring = (r: (typeof prof)[number]): [number, number, number][] => [
    [r.w, r.y, 0],
    [r.w * 0.55, r.y, r.d * 0.62],
    [0, r.y, r.d],
    [-r.w * 0.55, r.y, r.d * 0.62],
    [-r.w, r.y, 0],
    [-r.w * 0.55, r.y, -r.d * 0.62],
    [0, r.y, -r.d],
    [r.w * 0.55, r.y, -r.d * 0.62],
  ];
  const TRI: readonly [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
    [1, 1],
    [0, 1],
  ];
  for (let i = 1; i < prof.length; i++) {
    const a = ring(prof[i - 1]);
    const b = ring(prof[i]);
    for (let k = 0; k < 8; k++) {
      for (const [row, step] of TRI) {
        const c = (k + step) % 8;
        const p = row === 0 ? a[c] : b[c];
        pos.push(p[0], p[1], p[2]);
        h.push(p[1] / L);
        core.push(SHARE[c]);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aH', new THREE.Float32BufferAttribute(h, 1));
  geo.setAttribute('aCore', new THREE.Float32BufferAttribute(core, 1));
  geo.computeVertexNormals();
  return geo;
}

/** Lay a web's strips (built by webGeometry) on the floor in its owner's
 *  frame: each point's pair either side of its line, `half` wide, a breath
 *  over the floor `floorAt` gives. */
export function layWebStrips(
  geo: THREE.BufferGeometry,
  lines: readonly (readonly WebPoint[])[],
  floorAt: (x: number, z: number) => number,
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  let v = 0;
  for (const line of lines) {
    for (let k = 0; k < line.length; k++) {
      const a = line[Math.max(0, k - 1)];
      const b = line[Math.min(line.length - 1, k + 1)];
      let nx = -(b.z - a.z);
      let nz = b.x - a.x;
      const m = Math.hypot(nx, nz) || 1;
      nx /= m;
      nz /= m;
      const p = line[k];
      const w = p.half * 1.9;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const x = p.x + nx * w * sgn;
        const z = p.z + nz * w * sgn;
        pos.setXYZ(v++, x, floorAt(x, z) + 0.06, z);
      }
    }
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
}
