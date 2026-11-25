// The Wind Bridge's look (encounters/smith_heart/breath_bridge.ts; pure look:
// breath_bridge_fx_core.ts), a part of BreathIslesFx. Jose's call of
// 2026-11-25: a walkable bridge of packed air over the chasm between the
// climb's landing and the Storm Cornice, gone while the guardian fights.
//
//  - on EVERY tier (the raid acts on it): one mesh, the deck (a flat strip of
//    swirling packed cloud, slightly translucent, denser at its middle, its
//    two edges bound by bright strands of wind running along it) and two
//    side curtains hanging under its edges (the same cloud thinning to
//    nothing below), so it reads as a solid path, never a beam;
//  - its form rides the bridge object's presence: it forms out of the wind
//    over BRIDGE_TUNING.form seconds, and on the pull it breaks up from its
//    edges and its ends inward over `dissolve`; once gone nothing is drawn.
//
// Built in the constructor under the host's local group (its one gated
// attach); one static geometry and one material, no light, no texture, no
// per-frame allocation.

import * as THREE from 'three';
import { BRIDGE_OBJECT } from '../../sim/encounters/smith_heart/breath_bridge_ids';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { BRIDGE_LOOK, bridgeDeck, bridgeShown, stepBridgeForm } from './breath_bridge_fx_core';
import { CORNICE_FLOOR_H } from './breath_fight_fx_core';
import type { BreathIslesHost } from './breath_isles_fx';

const BRIDGE_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
attribute vec3 aDeck;
varying vec3 vDeck;
void main() {
  // aDeck: x along (0..1), y across (-1..1), z down the curtain (0 deck, 1 foot).
  vDeck = aDeck;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;

const BRIDGE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uForm;
uniform float uOpacity;
uniform float uLength;
uniform vec3 uCloud;
uniform vec3 uShade;
uniform vec3 uStrand;
varying vec3 vDeck;
float h21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
    mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float along = vDeck.x * uLength;
  float across = vDeck.y;
  float down = vDeck.z;
  // Packed cloud rolling along the bridge: broad billows, finer curls, and
  // long streaks of wind racing over its top.
  vec2 p = vec2(along * 0.18, across * 1.1 + down * 1.6);
  float billow = vnoise(p + vec2(uTime * 0.28, uTime * 0.09));
  float curl = vnoise(p * 2.7 + vec2(-uTime * 0.55, uTime * 0.25));
  float fine = vnoise(p * 6.1 + vec2(uTime * 0.9, 0.0));
  float n = billow * 0.55 + curl * 0.3 + fine * 0.15;
  float streak = smoothstep(0.62, 0.92,
    vnoise(vec2(along * 0.05 - uTime * 0.7, across * 5.0)));
  // It forms and dissolves from its edges and its ends inward, torn by the
  // noise: the middle of the walk is the last to go and the first to come.
  float edge = max(abs(across), abs(vDeck.x * 2.0 - 1.0));
  float keep = uForm * 1.35 - edge * 0.55 - (n - 0.5) * 0.5;
  if (keep < 0.0) discard;
  float soft = smoothstep(0.0, 0.25, keep);
  // Denser at the middle; the curtains thin to nothing below.
  float body = mix(0.78, 1.0, 1.0 - abs(across)) * (1.0 - smoothstep(0.05, 1.0, down));
  // Deep slate hollows, bright crowns on the billows, the streaks lit.
  vec3 col = mix(uShade, uCloud, smoothstep(0.32, 0.78, n));
  col = mix(col, uCloud * 1.08, streak * 0.6 * step(down, 0.01));
  // The wind's strands running along both edges.
  float strandBand = smoothstep(0.8, 0.97, abs(across)) * step(down, 0.01);
  float strands = strandBand * smoothstep(0.5, 0.95,
    0.5 + 0.5 * sin(along * 0.9 - uTime * 6.0 + across * 3.0));
  col = mix(col, uStrand, max(strands, strandBand * 0.35));
  float a = uOpacity * body * soft * mix(0.65, 1.0, n) + strands * 0.25 * soft;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, min(0.95, a));
  #include <colorspace_fragment>
}
`;

/** The cloud's colours: pale packed mist, its slate hollows, the wind's cyan
 *  strands (the Updrafts' own). */
const BRIDGE_RGB = { cloud: 0xf2f7fb, shade: 0x5d7088, strand: 0x8fe9ff } as const;

export class BreathBridgeFx {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private seenId = -1;
  private found = -1;
  private form = 0;

  constructor(private readonly h: BreathIslesHost) {
    const D = bridgeDeck();
    const L = BRIDGE_LOOK;
    const pos: number[] = [];
    const deck: number[] = [];
    const idx: number[] = [];
    const y = CORNICE_FLOOR_H + 0.06;
    // The deck: a grid along x and across z.
    const grid = (rows: number, cols: number, at: (i: number, j: number) => number[]) => {
      const base = pos.length / 3;
      for (let i = 0; i <= rows; i++)
        for (let j = 0; j <= cols; j++) {
          const v = at(i, j);
          pos.push(v[0], v[1], v[2]);
          deck.push(v[3], v[4], v[5]);
        }
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++) {
          const a = base + i * (cols + 1) + j;
          const b = a + cols + 1;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
    };
    grid(L.along, L.across, (i, j) => {
      const u = i / L.along;
      const w = (j / L.across) * 2 - 1;
      return [D.x - D.length / 2 + u * D.length, y, D.z + (w * D.width) / 2, u, w, 0];
    });
    // The two curtains hanging under the edges.
    for (const side of [-1, 1])
      grid(L.along, 2, (i, j) => {
        const u = i / L.along;
        const d = j / 2;
        return [
          D.x - D.length / 2 + u * D.length,
          y - d * L.curtain,
          D.z + (side * D.width) / 2,
          u,
          side,
          d,
        ];
      });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aDeck', new THREE.Float32BufferAttribute(deck, 3));
    geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathWindBridge',
      uniforms: {
        uTime: h.uTime,
        uForm: { value: 0 },
        uOpacity: { value: L.opacity },
        uLength: { value: D.length },
        uCloud: { value: new THREE.Color(BRIDGE_RGB.cloud) },
        uShade: { value: new THREE.Color(BRIDGE_RGB.shade) },
        uStrand: { value: new THREE.Color(BRIDGE_RGB.strand) },
      },
      vertexShader: BRIDGE_VERT,
      fragmentShader: BRIDGE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'smithHeartBreathWindBridge';
    this.mesh.renderOrder = floorVfxRenderOrder('encounter', 4);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    h.geometries.push(geo);
    h.materials.push(this.mat);
    h.local.add(this.mesh);
  }

  beginScan(): void {
    this.seenId = -1;
  }

  /** The bridge's object is this part's (true). */
  takeObject(e: Entity): boolean {
    if (e.templateId !== BRIDGE_OBJECT) return false;
    this.seenId = e.id;
    return true;
  }

  endScan(_world: IWorld): void {
    this.found = this.seenId;
  }

  update(dt: number): void {
    this.form = stepBridgeForm(this.form, this.found >= 0, dt);
    this.mat.uniforms.uForm.value = this.form;
    this.mesh.visible = bridgeShown(this.form);
  }

  /** The claim is out of view: nothing stands. */
  leave(): void {
    this.found = -1;
    this.form = 0;
    this.mesh.visible = false;
  }
}
