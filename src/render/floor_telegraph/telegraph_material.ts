// The shared floor-telegraph shaders (look: telegraph_look_core.ts).
//
// The FLOOR material draws the whole footprint in one pass, in layers: a dim
// tint of the threat colour over the shape, the swept part behind the fill
// front brighter, the fill front itself as a hot band moving out from the
// caster (the timing), a crisp outline measured in yards (so a big cone and a
// small ring have the same edge), a warning pulse over the bar's last stretch,
// and, cosmetic only, bands flowing in toward the caster and glinting motes in
// the element's accent colour. A kick glyph (`sigil`) is a rune ring whose arc
// sweeps round as the kickable cast runs.
//
// The CURTAIN material is the cosmetic glow standing on the edge: a short
// additive wall fading upward, streaked and with motes rising off it.
//
// Every uniform object is owned by the material; painters write values only
// (no per-frame allocation). Built once per slot and attached through the
// owner's compile gate.

import * as THREE from 'three';

const FLOOR_VERT = /* glsl */ `
uniform float uShape;
uniform vec2 uDir;
uniform float uLen;
uniform float uHalf;
varying vec2 vLocal;
void main() {
  if (uShape > 0.5) {
    vec2 p = position.xz;
    vLocal = vec2(dot(p, vec2(uDir.y, -uDir.x)) / max(uHalf, 1e-3), dot(p, uDir) / max(uLen, 1e-3));
  } else {
    vLocal = position.xz;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FLOOR_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uShape;
uniform float uSigil;
uniform float uFill;
uniform float uTime;
uniform float uRange;
uniform float uHalfArc;
uniform float uLen;
uniform float uHalf;
uniform float uBase;
uniform float uFilled;
uniform float uFront;
uniform float uRim;
uniform float uWarn;
uniform float uDetail;
uniform float uFade;
varying vec2 vLocal;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float radial;
  float edge;
  float yards;
  float span;
  vec2 grid;
  if (uShape > 0.5) {
    radial = clamp(vLocal.y, 0.0, 1.0);
    span = uLen;
    edge = min((1.0 - abs(vLocal.x)) * uHalf, min(vLocal.y, 1.0 - vLocal.y) * uLen);
    grid = vec2(vLocal.x * uHalf, radial * uLen);
  } else {
    float r = length(vLocal);
    radial = r;
    span = uRange;
    float ang = abs(atan(vLocal.x, vLocal.y));
    float flank = uHalfArc > 3.1 ? 1e3 : (uHalfArc - ang) * r * uRange;
    edge = min((1.0 - r) * uRange, flank);
    grid = vLocal * uRange;
  }
  yards = radial * span;
  float rimSoft = 1.0 - smoothstep(0.0, 0.55, edge);
  float rimCore = 1.0 - smoothstep(0.05, 0.16, edge);
  float a;
  vec3 col;
  if (uSigil > 0.5) {
    // The kick glyph: an outer rune ring, six runes, an arc sweeping round.
    float ring = smoothstep(0.66, 0.7, radial) * (1.0 - smoothstep(0.96, 1.0, radial));
    float ang = atan(vLocal.x, vLocal.y) / 6.2831853 + 0.5;
    float runes = step(0.55, fract(ang * 6.0)) * smoothstep(0.74, 0.78, radial) * (1.0 - smoothstep(0.9, 0.94, radial));
    float swept = step(ang, uFill) * ring;
    float core = 1.0 - smoothstep(0.18, 0.24, radial);
    float spokes = (1.0 - smoothstep(0.0, 0.03, abs(fract(ang * 3.0) - 0.5) * radial)) * step(radial, 0.66) * 0.5;
    a = ring * 0.35 + runes * 0.5 + swept * 0.55 + core * 0.35 + spokes * 0.4 + rimCore * uRim;
    col = uColor * (0.9 + swept * 0.5) + uAccent * runes * 0.3;
  } else {
    float fillYards = uFill * span;
    float inside = 1.0 - smoothstep(fillYards - 0.05, fillYards + 0.05, yards);
    float front = (1.0 - smoothstep(0.0, 0.5, abs(yards - fillYards))) * uFront;
    a = uBase + inside * uFilled + front + rimSoft * 0.28 + rimCore * uRim;
    a += uWarn * (0.1 + inside * 0.12);
    col = uColor * (0.8 + 0.35 * inside + 0.45 * rimCore) + uAccent * front * 0.55;
    if (uDetail > 0.0) {
      // Bands flowing in toward the caster, over the unfilled part mostly.
      float band = fract(yards * 0.7 + uTime * 1.3);
      float bands = smoothstep(0.0, 0.1, band) * (1.0 - smoothstep(0.18, 0.34, band));
      a += bands * 0.07 * (1.0 - inside * 0.6) * uDetail;
      // Motes: glints in the accent colour drifting out across the floor.
      vec2 g = grid * 1.15 + vec2(0.0, -uTime * 0.8);
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float h = hash(id);
      vec2 o = vec2(hash(id + 3.1), hash(id + 7.3)) - 0.5;
      float mote = (1.0 - smoothstep(0.0, 0.1, length(f - o * 0.6))) * step(0.74, h);
      mote *= 0.55 + 0.45 * sin(uTime * 5.0 + h * 40.0);
      a += mote * 0.4 * uDetail;
      col += uAccent * mote * 0.8 * uDetail;
    }
  }
  col += vec3(1.0) * uWarn * 0.12;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uFade);
}
`;

const CURTAIN_VERT = /* glsl */ `
attribute float aAlong;
attribute float aH;
varying float vAlong;
varying float vH;
void main() {
  vAlong = aAlong;
  vH = aH;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CURTAIN_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uTime;
uniform float uScale;
uniform float uStrength;
uniform float uFade;
varying float vAlong;
varying float vH;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float yards = vAlong * uScale;
  float fall = pow(max(1.0 - vH, 0.0), 1.7);
  float streak = 0.55 + 0.45 * sin(yards * 2.3 + uTime * 3.1 + vH * 3.0) * sin(yards * 0.9 - uTime * 1.7);
  vec2 g = vec2(yards * 2.2, vH * 3.0 - uTime * 1.6);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash(id);
  float mote = (1.0 - smoothstep(0.0, 0.14, length(f - (vec2(hash(id + 1.7), 0.0) - 0.5) * 0.5))) * step(0.7, h);
  float a = fall * (0.35 + 0.45 * streak) + mote * (1.0 - vH) * 0.8;
  vec3 col = mix(uColor, uAccent, 0.35 + 0.3 * mote) * 1.3;
  gl_FragColor = vec4(col * a * uStrength * uFade, 1.0);
}
`;

export interface TelegraphFloorUniforms {
  uColor: { value: THREE.Color };
  uAccent: { value: THREE.Color };
  uShape: { value: number };
  uSigil: { value: number };
  uFill: { value: number };
  uTime: { value: number };
  uRange: { value: number };
  uHalfArc: { value: number };
  uDir: { value: THREE.Vector2 };
  uLen: { value: number };
  uHalf: { value: number };
  uBase: { value: number };
  uFilled: { value: number };
  uFront: { value: number };
  uRim: { value: number };
  uWarn: { value: number };
  uDetail: { value: number };
  uFade: { value: number };
}

export type TelegraphFloorMaterial = THREE.ShaderMaterial & { uniforms: TelegraphFloorUniforms };

/** The floor footprint material: `lane` measures along uDir, a fan radially. */
export function createTelegraphFloorMaterial(lane: boolean): TelegraphFloorMaterial {
  const uniforms: TelegraphFloorUniforms = {
    uColor: { value: new THREE.Color(0xffffff) },
    uAccent: { value: new THREE.Color(0xffffff) },
    uShape: { value: lane ? 1 : 0 },
    uSigil: { value: 0 },
    uFill: { value: 0 },
    uTime: { value: 0 },
    uRange: { value: 1 },
    uHalfArc: { value: Math.PI },
    uDir: { value: new THREE.Vector2(0, 1) },
    uLen: { value: 1 },
    uHalf: { value: 1 },
    uBase: { value: 0.14 },
    uFilled: { value: 0.22 },
    uFront: { value: 0.7 },
    uRim: { value: 0.9 },
    uWarn: { value: 0 },
    uDetail: { value: 1 },
    uFade: { value: 1 },
  };
  const m = new THREE.ShaderMaterial({
    name: lane ? 'floorTelegraphLane' : 'floorTelegraphFan',
    vertexShader: FLOOR_VERT,
    fragmentShader: FLOOR_FRAG,
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return m as TelegraphFloorMaterial;
}

export interface TelegraphCurtainUniforms {
  uColor: { value: THREE.Color };
  uAccent: { value: THREE.Color };
  uTime: { value: number };
  uScale: { value: number };
  uStrength: { value: number };
  uFade: { value: number };
}

export type TelegraphCurtainMaterial = THREE.ShaderMaterial & {
  uniforms: TelegraphCurtainUniforms;
};

/** The cosmetic edge curtain material (additive, fading upward). */
export function createTelegraphCurtainMaterial(): TelegraphCurtainMaterial {
  const uniforms: TelegraphCurtainUniforms = {
    uColor: { value: new THREE.Color(0xffffff) },
    uAccent: { value: new THREE.Color(0xffffff) },
    uTime: { value: 0 },
    uScale: { value: 1 },
    uStrength: { value: 0.5 },
    uFade: { value: 1 },
  };
  const m = new THREE.ShaderMaterial({
    name: 'floorTelegraphCurtain',
    vertexShader: CURTAIN_VERT,
    fragmentShader: CURTAIN_FRAG,
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return m as TelegraphCurtainMaterial;
}
