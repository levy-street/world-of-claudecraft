// The Hearthseeds' footprints drawn as ONE field (heat_seed_field_core.ts),
// a part of HeatFightFx: one grid draped over the floor under every live
// seed's reach, its shader reading every seed (spot, reach, fill) at once:
//  - the union of the reaches with a single outer edge (a softer line in the
//    threat colour, the seeds' falloff reach), the inner edges of reaches
//    lying inside other reaches not drawn;
//  - the union of the hot cores with its own hard edge;
//  - the heat summed over every burst (`(1 - d / reach)^2` each, the sim's
//    falloff): the basalt chars deepest and the cracks burn brightest on each
//    seed and where bursts stack, fading to the outer edge;
//  - each seed's fill sweeping its core to the burst (its reach to half
//    way), the union of the swept parts with one ragged front of fire, the
//    bar's last stretch flaring.
// The same molten paint as every Heat warning (heat_telegraph_glsl.ts: the
// char a multiply, the glow additive, on the fight's telegraph rungs where
// they commute with every other warning), with the looks of `seedReach` and
// `seedCore` (heat_telegraph_core.ts). Shapes and timing on every tier; the
// flow, the fine cracks and the embers shed on the low tier.
//
// Built in the owner's constructor under its gated root (both programs link
// at the gate); one fixed grid re-draped once per wave, no per-frame
// allocation. Noise on yards off the grid's own middle (`vP`), the vertex
// through `modelViewMatrix` on a positioned mesh (camera-relative safe).

import * as THREE from 'three';
import { TELEGRAPH_THREAT_COLORS, telegraphLook } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { HEAT_FIGHT_COLORS as C, SEED_CORE_R } from './heat_fight_fx_core';
import { HEAT_FLOOR } from './heat_floor_ladder_core';
import { HEAT_LAVA_GLSL, HEAT_MOLTEN_GLSL, HEAT_NOISE_GLSL } from './heat_lava_glsl';
import { applyCharBlend } from './heat_molten_decal';
import { SEED_FIELD, type SeedMark, seedFieldBounds } from './heat_seed_field_core';
import { HEAT_TELEGRAPH_LOOKS } from './heat_telegraph_core';

const LOOK = { base: 0, filled: 0, front: 0, rim: 0, warn: 0, detail: 0 };
const _bounds = { x: 0, z: 0, half: 0 };

const VERT = /* glsl */ `
varying vec2 vP;
void main() {
  // Yards from the grid's own middle (the mesh is unrotated and unscaled).
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function frag(seeds: number): string {
  return /* glsl */ `
precision highp float;
#define SEEDS ${seeds}
uniform vec4 uSeeds[SEEDS];
uniform float uCount;
uniform float uCoreR;
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uTime;
uniform float uWarn;
uniform float uFrontR;
uniform float uFrontC;
uniform float uRim;
uniform float uDetail;
uniform float uFadeR;
uniform float uCharR;
uniform float uCharC;
uniform float uCellsR;
uniform float uCellsC;
uniform float uCrackR;
uniform float uCrackC;
uniform float uRimR;
uniform float uRimC;
uniform float uBodyC;
varying vec2 vP;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
${HEAT_LAVA_GLSL}
void main() {
  // The field (seedFieldAt): the unions' signed edges, the swept fronts and
  // the summed falloff.
  float re = 1e4;
  float ce = 1e4;
  float rf = 1e4;
  float cf = 1e4;
  float heat = 0.0;
  for (int i = 0; i < SEEDS; i++) {
    if (float(i) >= uCount) break;
    vec4 s = uSeeds[i];
    float d = length(vP - s.xy);
    re = min(re, d - s.z);
    ce = min(ce, d - uCoreR);
    rf = min(rf, d - 0.5 * s.w * s.z);
    cf = min(cf, d - s.w * uCoreR);
    float k = max(0.0, 1.0 - d / max(s.z, 1e-3));
    heat += k * k;
  }
  if (re > 0.0) discard;
  float edgeR = -re;
  float edgeC = -ce;
  float inCore = step(ce, 0.0);
  // The fronts are ragged lines of cracks, not rulers (under a yard).
  float jag = (vn(vP * 0.8) - 0.5) * 0.9 + (vn(vP * 2.3 + 4.1) - 0.5) * 0.35;
  float aheadR = rf + jag;
  float aheadC = cf + jag;
  float sweptR = 1.0 - smoothstep(-0.12, 0.12, aheadR);
  float sweptC = (1.0 - smoothstep(-0.12, 0.12, aheadC)) * inCore;
  float swept = max(sweptR, sweptC);
  // The summed burst (seedFieldHeatWeight): a quarter at the outer edge,
  // full on a lone seed, brighter where bursts stack; a core burns full.
  float hw = 0.25 + 0.75 * min(heat, 1.0) + 0.3 * clamp(heat - 1.0, 0.0, 1.0);
  hw = mix(hw, max(hw, 1.0), inCore);
  float cells = mix(uCellsR, uCellsC, inCore);
  float joint = 1.0 - smoothstep(0.0, 0.075, cellEdge(vP * cells + 11.3));
#ifdef HEAT_CHAR
  float cR = uCharR * (0.45 + 0.4 * sweptR) * uFadeR;
  float cC = uCharC * (0.45 + 0.4 * sweptC + 0.15 * uWarn) * inCore;
  float c = max(cR, cC) * hw;
  c *= 0.82 + 0.18 * vn(vP * 0.6) + 0.25 * joint;
  // Soft just inside the outer edge: the glow's hot line carries it.
  c *= smoothstep(-0.02, 0.35, edgeR);
  c = clamp(c, 0.0, 0.9);
  gl_FragColor = vec4(vec3(1.0 - c), 1.0);
#else
  vec3 hot = vec3(1.0, 0.93, 0.8);
  // The union's ONE outer edge (the reach, softer) and the cores' (hard).
  float rimCoreR = 1.0 - smoothstep(0.05, 0.17, edgeR);
  float rimSoftR = 1.0 - smoothstep(0.0, 1.1, edgeR);
  vec3 col = (uColor * rimSoftR * 0.28 + mix(uColor * 1.25, hot, 0.35) * rimCoreR) * uRim * uRimR;
  float rimCoreC = (1.0 - smoothstep(0.05, 0.17, edgeC)) * inCore;
  float rimSoftC = (1.0 - smoothstep(0.0, 1.1, edgeC)) * inCore;
  col += (uColor * rimSoftC * 0.28 + mix(uColor * 1.25, hot, 0.35) * rimCoreC * (1.0 + 0.6 * uWarn)) * uRim * uRimC;
  // The cracks: dim embers ahead of the front, molten behind it, hottest
  // where the bursts stack.
  float crack = joint * mix(uCrackR, uCrackC, inCore);
  if (uDetail > 0.0) {
    float fine = 1.0 - smoothstep(0.0, 0.05, cellEdge(vP * cells * 2.6 + 3.7));
    crack = max(crack, fine * 0.55 * swept * mix(uCrackR, uCrackC, inCore));
  }
  float ripple = 0.75 + 0.25 * sin(min(rf, cf) * 1.3 - uTime * 4.0);
  float crackHeat = mix(0.22, 0.72 + 0.28 * uWarn * inCore, swept);
  // (Squared: the cracks die toward the outer edge, burn on the seeds.)
  col += molten(crackHeat) * crack * (0.26 + 0.6 * swept) * ripple * hw * hw;
  // The swept part: a faint wash of the threat, the molten flow in the cores.
  col += uColor * swept * 0.07 * hw;
  if (uDetail > 0.0 && uBodyC > 0.0) {
    float lvl = lavaLevel(vP, vec2(0.0), uTime, 1.0);
    col += molten(lvl * 0.8) * lvl * uBodyC * sweptC * 0.3 * hw;
  }
  // The fronts: one ragged line of fire round the union of the swept parts.
  float flick = 0.8 + 0.2 * vn(vP * 1.7 + vec2(uTime * 3.0, 0.0));
  float seamR = (1.0 - smoothstep(0.0, 0.2, abs(aheadR))) * uFrontR * (1.0 - sweptC);
  float seamC = (1.0 - smoothstep(0.0, 0.2, abs(aheadC))) * uFrontC * inCore;
  float lickR = (1.0 - smoothstep(0.0, 0.9, aheadR)) * step(0.0, aheadR) * uFrontR;
  float lickC = (1.0 - smoothstep(0.0, 0.9, aheadC)) * step(0.0, aheadC) * uFrontC * inCore;
  col += molten(0.8) * max(seamR, seamC) * 0.5 * flick + molten(0.5) * max(lickR, lickC) * 0.3 * flick;
  // The bar's last stretch: the cores flare with the warning.
  col += (uColor * 0.35 + hot * 0.12) * uWarn * sweptC * hw;
  // Embers glinting over it (cosmetic).
  if (uDetail > 0.0) {
    vec2 g = vP * 1.1 + vec2(0.0, -uTime * 0.7);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hh2(id);
    vec2 o = vec2(hh2(id + 3.1), hh2(id + 7.3)) - 0.5;
    float mote = (1.0 - smoothstep(0.0, 0.09, length(f - o * 0.6))) * step(0.8, h);
    col += uAccent * mote * (0.35 + 0.35 * sin(uTime * 5.0 + h * 40.0)) * (0.3 + 0.7 * swept);
  }
  // The reach faint at first, brighter to the burst; a core at full.
  gl_FragColor = vec4(col * mix(uFadeR, 1.0, inCore), 1.0);
#endif
}
`;
}

/** The seeds' one field: `layout` once per wave, `paint` every frame. */
export class HeatSeedField {
  private readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly seedU: THREE.Vector4[];
  /** The grid's unit layout (x, z in -0.5..0.5) for the drape. */
  private readonly unit: Float32Array;

  constructor(
    root: THREE.Object3D,
    private readonly capacity: number,
    detail: boolean,
    uTime: { value: number },
    geometries: THREE.BufferGeometry[],
    materials: THREE.Material[],
  ) {
    const n = SEED_FIELD.grid;
    this.geometry = new THREE.PlaneGeometry(1, 1, n, n).rotateX(-Math.PI / 2);
    this.geometry.deleteAttribute('uv');
    this.geometry.deleteAttribute('normal');
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setUsage(THREE.DynamicDrawUsage);
    this.unit = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      this.unit[i * 2] = pos.getX(i);
      this.unit[i * 2 + 1] = pos.getZ(i);
    }
    geometries.push(this.geometry);
    this.seedU = Array.from({ length: capacity }, () => new THREE.Vector4(0, 0, 1, 0));
    const R = HEAT_TELEGRAPH_LOOKS.seedReach;
    const K = HEAT_TELEGRAPH_LOOKS.seedCore;
    this.uniforms = {
      uSeeds: { value: this.seedU },
      uCount: { value: 0 },
      uCoreR: { value: SEED_CORE_R },
      uColor: { value: new THREE.Color(TELEGRAPH_THREAT_COLORS.danger) },
      uAccent: { value: new THREE.Color(C.accent) },
      uTime,
      uWarn: { value: 0 },
      uFrontR: { value: 0 },
      uFrontC: { value: 0 },
      uRim: { value: 0.9 },
      uDetail: { value: detail ? 1 : 0 },
      uFadeR: { value: 1 },
      uCharR: { value: R.char },
      uCharC: { value: K.char },
      uCellsR: { value: R.cells },
      uCellsC: { value: K.cells },
      uCrackR: { value: R.crack },
      uCrackC: { value: K.crack },
      uRimR: { value: R.rim },
      uRimC: { value: K.rim },
      uBodyC: { value: K.body },
    };
    const common = {
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: frag(capacity),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    };
    const charMat = new THREE.ShaderMaterial({
      ...common,
      name: 'smithHeartHeatSeedFieldChar',
      defines: { HEAT_CHAR: '' },
    });
    applyCharBlend(charMat);
    const glowMat = new THREE.ShaderMaterial({
      ...common,
      name: 'smithHeartHeatSeedFieldGlow',
      blending: THREE.AdditiveBlending,
    });
    materials.push(charMat, glowMat);
    this.mesh = new THREE.Mesh(this.geometry, charMat);
    this.mesh.name = 'smithHeartHeatSeedField';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = floorVfxRenderOrder('encounter', HEAT_FLOOR.fightTelegraphChar.step);
    const glow = new THREE.Mesh(this.geometry, glowMat);
    glow.name = 'smithHeartHeatSeedFieldGlow';
    glow.frustumCulled = false;
    glow.renderOrder = floorVfxRenderOrder('encounter', HEAT_FLOOR.fightTelegraphGlow.step);
    this.mesh.add(glow);
    root.add(this.mesh);
  }

  /** Lay the grid over the first `n` seeds' reaches and drape it on the
   *  floor (once per change of the set, never per frame). */
  layout(seeds: readonly SeedMark[], n: number, groundY: (x: number, z: number) => number): void {
    const count = Math.min(n, this.capacity);
    if (count <= 0) {
      this.hide();
      return;
    }
    const b = seedFieldBounds(seeds, count, SEED_FIELD.pad, _bounds);
    const y = groundY(b.x, b.z);
    this.mesh.position.set(b.x, y + SEED_FIELD.lift, b.z);
    const side = b.half * 2;
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const lx = this.unit[i * 2] * side;
      const lz = this.unit[i * 2 + 1] * side;
      pos.setXYZ(i, lx, groundY(b.x + lx, b.z + lz) - y, lz);
    }
    pos.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    for (let i = 0; i < this.capacity; i++) {
      const v = this.seedU[i];
      if (i < count) v.set(seeds[i].x - b.x, seeds[i].z - b.z, seeds[i].reach, seeds[i].fill);
      else v.set(0, 0, 1, 0);
    }
    this.uniforms.uCount.value = count;
    this.mesh.visible = true;
  }

  /** One frame: each laid seed's fill (in `layout`'s order) and the timing
   *  looks off the kit's own clock (the cores' warning, the fronts). */
  paint(seeds: readonly SeedMark[], n: number, clock: number): void {
    if (!this.mesh.visible) return;
    const count = Math.min(n, this.uniforms.uCount.value as number);
    let fill = 0;
    for (let i = 0; i < count; i++) {
      this.seedU[i].w = seeds[i].fill;
      fill = Math.max(fill, seeds[i].fill);
    }
    const detail = (this.uniforms.uDetail.value as number) > 0;
    const core = telegraphLook(fill, clock, detail, LOOK);
    this.uniforms.uWarn.value = core.warn;
    this.uniforms.uFrontC.value = core.front;
    this.uniforms.uRim.value = core.rim;
    // The reach sweeps to half way, faint at first and brighter to the burst.
    this.uniforms.uFrontR.value = fill > 0 ? 0.75 : 0;
    this.uniforms.uFadeR.value = 0.35 + 0.45 * fill;
  }

  hide(): void {
    this.mesh.visible = false;
    this.uniforms.uCount.value = 0;
  }
}
