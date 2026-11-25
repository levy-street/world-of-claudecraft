// The Wind Bridge's look (encounters/smith_heart/breath_bridge.ts; pure look:
// breath_bridge_fx_core.ts), a part of BreathIslesFx. Jose's call of
// 2026-11-25: a walkable bridge of packed air over the chasm between the
// climb's landing and the Storm Cornice, gone while the guardian fights.
//
//  - on EVERY tier (the raid acts on it): one mesh and one draw, a volume of
//    packed cloud: stacked translucent sheets drifting at their own slow
//    paces (the deck reads thick, never a plane), a puffy billowing rim,
//    torn wisps of wind streaming past the walkable edge (the drop reads
//    there) and two side curtains hanging under the edges;
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
import {
  BRIDGE_LOOK,
  bridgeDeck,
  bridgeLayer,
  bridgeShown,
  stepBridgeForm,
} from './breath_bridge_fx_core';
import { CORNICE_FLOOR_H } from './breath_fight_fx_core';
import type { BreathIslesHost } from './breath_isles_fx';

const BRIDGE_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
attribute vec4 aDeck;
varying vec4 vDeck;
void main() {
  // aDeck: x along (0..1), y across (-1..1 the walkable width, past it the
  // wisps), z down the curtain (0 a sheet, 1 its foot), w the sheet's
  // opacity share (1 the top).
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
uniform float uWisp;
uniform vec3 uCloud;
uniform vec3 uShade;
uniform vec3 uStrand;
varying vec4 vDeck;
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
  float sheet = vDeck.w;
  float top = step(0.99, sheet);
  float deep = 1.0 - sheet;
  float side = abs(across);
  // Each sheet drifts at its own slow pace (parallax: the deck reads deep).
  float drift = uTime * (0.22 + deep * 0.12);
  vec2 p = vec2(along * 0.16 + deep * 3.7, across * 1.2 + down * 1.6 + deep * 1.9);
  float billow = vnoise(p + vec2(drift, uTime * 0.06));
  float curl = vnoise(p * 2.6 + vec2(-drift * 1.6, uTime * 0.21));
  float fine = vnoise(p * 6.0 + vec2(drift * 2.8, 0.0));
  float n = billow * 0.55 + curl * 0.3 + fine * 0.15;
  // Formed or dissolved from the edges and the ends inward, torn by the noise.
  float edge = max(min(side, 1.0), abs(vDeck.x * 2.0 - 1.0));
  float keep = uForm * 1.35 - edge * 0.55 - (n - 0.5) * 0.5;
  if (keep < 0.0) discard;
  float soft = smoothstep(0.0, 0.25, keep);
  // A puffy rim: the cloud's own edge billows in and out along the bridge.
  float rim = 1.0 + (billow - 0.5) * 0.28 - deep * 0.06;
  float body = (1.0 - smoothstep(rim - 0.16, rim + 0.02, side)) * (1.0 - smoothstep(0.05, 1.0, down));
  // Torn wisps streaming past the walkable edge on the top sheet: the drop.
  float wispZone = smoothstep(0.9, 1.0, side) * (1.0 - smoothstep(1.0, 1.0 + uWisp, side));
  float wisp = wispZone * top * step(down, 0.01)
    * smoothstep(0.48, 0.86, vnoise(vec2(along * 0.11 - uTime * 1.5, across * 9.0)));
  // Light: bright crowns on top, slate hollows, a darker underside.
  float lit = smoothstep(0.3, 0.8, n) * (1.0 - deep * 0.6) * (1.0 - down * 0.6);
  vec3 col = mix(uShade, uCloud, lit);
  // Long streaks of wind racing over the top sheet.
  float streak = smoothstep(0.64, 0.92, vnoise(vec2(along * 0.05 - uTime * 0.8, across * 5.0)))
    * top * step(down, 0.01);
  col = mix(col, uCloud * 1.08, streak * 0.55);
  // The edge's cold light, and the wisps.
  col = mix(col, uStrand, clamp(smoothstep(0.78, 0.98, side) * 0.45 * body + wisp * 0.9, 0.0, 1.0));
  float a = (uOpacity * sheet * body * mix(0.6, 1.0, n) + wisp * 0.7) * soft;
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
          deck.push(v[3], v[4], v[5], v[6]);
        }
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++) {
          const a = base + i * (cols + 1) + j;
          const b = a + cols + 1;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
    };
    const x0 = D.x - D.length / 2;
    const half = D.width / 2;
    // The stacked sheets, the top one reaching past the walkable edge into
    // its wisps, each lower one narrower and thinner (bridgeLayer).
    for (let k = 0; k < L.layers; k++) {
      const { reach, alpha } = bridgeLayer(k);
      grid(L.along, L.across, (i, j) => {
        const u = i / L.along;
        const w = ((j / L.across) * 2 - 1) * reach;
        return [x0 + u * D.length, y - k * L.layerStep, D.z + w * half, u, w, 0, alpha];
      });
    }
    // The two curtains hanging under the edges, the volume's sides.
    for (const side of [-1, 1])
      grid(L.along, 3, (i, j) => {
        const u = i / L.along;
        const d = j / 3;
        return [
          x0 + u * D.length,
          y - d * L.curtain,
          D.z + side * half * 0.97,
          u,
          side * 0.97,
          d,
          0.4,
        ];
      });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aDeck', new THREE.Float32BufferAttribute(deck, 4));
    geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathWindBridge',
      uniforms: {
        uTime: h.uTime,
        uForm: { value: 0 },
        uOpacity: { value: L.opacity },
        uLength: { value: D.length },
        uWisp: { value: L.wisp },
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
