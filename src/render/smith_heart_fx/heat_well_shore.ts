// The melee's shore round the Guardian of the Heat's wellspring (pass 4): a
// terrace of dark hexagonal basalt flagstones laid round the lip, embers
// alive in the joints nearest the fire and cooling outward, a carved groove
// and a worn warm edge at its outer rim, so the ring the raid's melee stand
// on to strike the guardian reads as a platform. It is drawn flat on the
// floor (the sim's ground is the floor's: nothing to trip on, and every
// telegraph drapes over it), opaque like the pool and on the pool's own rung
// of the Heat's floor ladder (the two never overlap: the terrace starts past
// the lip), under every mark of the fight; its outer edge dithers out.
// It starts under the lip wall's stumps and reaches past the melee's whole
// band (the guardian's body radius plus the player's BODY_EDGE_MELEE_REACH)
// with a margin: the melee's pedestal, grown with the wall on 2026-11-24. Every tier draws it (cheap: one ring,
// two passes); its embers breathe slowly, never a warning's pulse.
//
// Built once by HeatWellFx under the host's root (one gated attach).

import * as THREE from 'three';
import { BODY_EDGE_MELEE_REACH } from '../../sim/combat/player_attack_reach';
import { HEAT_BODY_R, HEAT_LIP_WALL } from '../../sim/encounters/smith_heart/heat_ids';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { HEAT_FLOOR } from './heat_floor_ladder_core';
import type { HeatFxHost } from './heat_fx_host';
import { HEAT_MOLTEN_GLSL, HEAT_NOISE_GLSL } from './heat_lava_glsl';
import { HEAT_LIP_FRAG_GLSL, HEAT_LIP_VERT_GLSL, heatLipClipUniform } from './heat_lip_clip_core';
import { floorRingGeometry } from './heat_shapes';

/** The terrace (yards from the well's middle): from under the lip wall's
 *  outer stumps out past the melee's reach (the body's edge plus
 *  BODY_EDGE_MELEE_REACH) and two and a half yards of room behind it. */
export const HEAT_SHORE = {
  inner: HEAT_LIP_WALL.outer - 0.3,
  outer: HEAT_BODY_R + BODY_EDGE_MELEE_REACH + 2.5,
} as const;

const VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
${HEAT_LIP_VERT_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // The flagstones in yards off the well's middle (heat_lip_clip_core.ts): world
  // yards a hundred thousand out made the joints and grain shimmer.
  heatLipLocal(wp.xyz);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
/** uv.y 0 at the inner edge, 1 at the outer; the flagstones in yards off the
 *  well's middle. */
const FRAG = /* glsl */ `
uniform float uTime;
uniform float uHeat;
varying vec2 vUv;
${HEAT_LIP_FRAG_GLSL}
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
// Distance to the nearest hex cell's edge (pointy hexes, cell size 1).
vec3 hexCell(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  float edge = 0.5 - max(dot(q, normalize(vec2(1.0, 1.7320508))), q.x);
  return vec3(edge, p - g);
}
void main() {
  float y = vUv.y;
  vec3 hc = hexCell(vLipL / 1.45);
  float joint = 1.0 - smoothstep(0.025, 0.07, hc.x);
  float tone = hh2(floor(hc.yz * 3.0 + 0.5));
  float grain = vn(vLipL * 2.3) * 0.5 + vn(vLipL * 7.0) * 0.5;
  // The flagstones: dark sooted basalt, each its own tone, a lit edge on top.
  vec3 stone = vec3(0.105, 0.085, 0.075) * (0.75 + 0.35 * tone + 0.25 * grain);
  stone *= 1.0 + 0.35 * smoothstep(0.07, 0.16, hc.x) * (1.0 - smoothstep(0.16, 0.3, hc.x));
  // Embers in the joints near the lip, cooling outward, breathing slowly.
  float near = 1.0 - smoothstep(0.05, 0.75, y);
  float breath = 0.75 + 0.25 * sin(uTime * 0.7 + tone * 6.28);
  float ember = joint * near * breath * (0.55 + 0.45 * vn(vLipL * 0.8 + uTime * 0.15));
  vec3 col = mix(stone, vec3(0.03, 0.025, 0.022), joint * (1.0 - near));
  col += molten(0.42 + 0.25 * ember) * ember * 0.8 * uHeat;
  // The carved groove and the worn warm edge at the terrace's rim.
  float groove = smoothstep(0.84, 0.88, y) * (1.0 - smoothstep(0.91, 0.94, y));
  float edge = smoothstep(0.935, 0.955, y) * (1.0 - smoothstep(0.965, 0.985, y));
  col = mix(col, vec3(0.025, 0.02, 0.018), groove * 0.85);
  col += vec3(1.0, 0.62, 0.28) * edge * 0.35;
  // The outer rim dithers into the hall's floor (opaque: no blend to sort).
  float keep = 1.0 - smoothstep(0.975, 1.0, y);
  if (keep < hh2(floor(gl_FragCoord.xy))) discard;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class HeatWellShore {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  private readonly outer: number;

  constructor(host: HeatFxHost) {
    // A unit ring from under the lip wall out to the terrace's rim.
    this.outer = HEAT_SHORE.outer;
    const geo = floorRingGeometry(HEAT_SHORE.inner / this.outer, 128);
    host.geometries.push(geo);
    const mat = new THREE.ShaderMaterial({
      name: 'smithHeartHeatWellShore',
      uniforms: { uTime: host.uTime, uHeat: { value: 1 }, uLipClip: heatLipClipUniform },
      vertexShader: VERT,
      fragmentShader: FRAG,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    host.materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'smithHeartHeatWellShore';
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = floorVfxRenderOrder('encounter', HEAT_FLOOR.wellPool.step);
    this.mesh = mesh;
    this.mat = mat;
    host.root.add(mesh);
  }

  /** Lay the terrace round the well at (x, y, z). */
  place(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y + 0.04, z);
    this.mesh.scale.set(this.outer, 1, this.outer);
    this.mesh.visible = true;
  }

  /** The fight's heat (the pool's): the embers brighten as it deepens. */
  paint(heat: number): void {
    this.mat.uniforms.uHeat.value = heat;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
