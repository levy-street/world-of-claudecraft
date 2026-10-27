// The Hammer Council's safe shadows (plan: council_fx_core.ts coverShadow,
// docs/design/raid/smith_heart.md 5.18), a part of CouncilFx: while Mountain's
// Wrath's bar or a soul pillar's Echo of Wrath runs, the REAL shadow behind
// every pillar that covers from it (between the two tangents from the source,
// from the pillar's far face out to the blast's reach, drawn a hair inside the
// sim's own cover: SHELTER_PAD), so a player at ground level reads exactly
// where they are safe:
//   - a strong dark wedge on the floor (the blast's red ring around it stays
//     bright: the safe floor is the dark), its two edges and its foot lined
//     with a bright pale rim;
//   - a faint curtain of light standing along its two edges, so the line is
//     read from a third-person camera behind a player, never only from above.
// Every tier draws the wedge and its rim (a safe zone is actionable); the low
// tier sheds the curtains and the hatch's drift. Built in the constructor under
// the host's root (one gated attach), fixed pools, no light, no per-frame
// allocation.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  type CoverShadow,
  coverShadow,
  ECHO_SPEC,
  COUNCIL_FX_POOLS as POOLS,
  SHELTER_PAD,
  shadowPoint,
} from './council_fx_core';
import type { CouncilFxHost, CouncilPillarsFx } from './council_pillars_fx';

/** Which blast a set of shelters is for. */
export type ShelterKind = 'wrath' | 'echo';

/** Stations across a wedge (tangent to tangent) and along it. */
const ACROSS = 16;
const ALONG = 6;
/** Stations along a curtain, and its height (yards). */
const CURTAIN_SEG = 10;
const CURTAIN_H = 2.6;

const FLOOR_VERT = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUv;
varying vec2 vXZ;
void main() {
  vUv = aUv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
/** The safe floor: dark and still (the blast cannot see here), a pale rim
 *  along both edges and the foot, a slow hatch only where the tier allows,
 *  fading out toward the blast's reach. */
const FLOOR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uDrift;
uniform vec3 uDark;
uniform vec3 uRim;
varying vec2 vUv;
varying vec2 vXZ;
void main() {
  float side = min(vUv.x, 1.0 - vUv.x);
  float edgeW = fwidth(vUv.x) * 2.5 + 0.035;
  float rimSide = 1.0 - smoothstep(0.0, edgeW, side);
  float rimFoot = 1.0 - smoothstep(0.0, fwidth(vUv.y) * 2.5 + 0.02, vUv.y);
  float rim = max(rimSide, rimFoot * 0.85);
  float hatch = step(0.5, fract((vXZ.x + vXZ.y) * 0.55 - uTime * 0.3 * uDrift));
  float fade = 1.0 - smoothstep(0.86, 1.0, vUv.y);
  vec3 col = mix(uDark, uRim, rim);
  float a = uAlpha * fade * mix(0.82 + 0.06 * hatch, 1.0, rim);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

const CURTAIN_VERT = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A curtain of pale light rising off a shelter's edge: brightest at the
 *  floor, gone a head over a player, thinning toward the blast's reach. */
const CURTAIN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uRim;
varying vec2 vUv;
void main() {
  float up = pow(1.0 - vUv.y, 1.8);
  float along = 1.0 - smoothstep(0.55, 1.0, vUv.x);
  float shimmer = 0.75 + 0.25 * sin(vUv.x * 40.0 - uTime * 2.6 + vUv.y * 3.0);
  gl_FragColor = vec4(uRim, uAlpha * up * along * shimmer * 0.42);
  #include <colorspace_fragment>
}
`;

interface Wedge {
  floor: THREE.Mesh;
  floorPos: THREE.BufferAttribute;
  curtain: THREE.Mesh;
  curtainPos: THREE.BufferAttribute;
}

interface ShelterSet {
  wedges: Wedge[];
  floorMat: THREE.ShaderMaterial;
  curtainMat: THREE.ShaderMaterial;
  used: number;
}

const _sh: CoverShadow = { sx: 0, sz: 0, px: 0, pz: 0, r: 0, reach: 0, yaw: 0, half: 0 };
const _pt = { x: 0, z: 0 };
const _covers: { x: number; z: number; r: number }[] = [];

export class CouncilShelters {
  private readonly sets: Record<ShelterKind, ShelterSet>;

  constructor(
    private readonly h: CouncilFxHost,
    private readonly pillars: CouncilPillarsFx,
  ) {
    this.sets = { wrath: this.makeSet('wrath'), echo: this.makeSet('echo') };
  }

  private makeSet(kind: ShelterKind): ShelterSet {
    const floorMat = new THREE.ShaderMaterial({
      name: `smithHeartShelterFloor:${kind}`,
      uniforms: {
        uTime: this.h.uTime,
        uAlpha: { value: 0 },
        uDrift: { value: this.h.detail ? 1 : 0 },
        uDark: { value: new THREE.Color(ECHO_SPEC.shelter) },
        uRim: { value: new THREE.Color(ECHO_SPEC.shelterRim) },
      },
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const curtainMat = new THREE.ShaderMaterial({
      name: `smithHeartShelterCurtain:${kind}`,
      uniforms: {
        uTime: this.h.uTime,
        uAlpha: { value: 0 },
        uRim: { value: new THREE.Color(ECHO_SPEC.shelterRim) },
      },
      vertexShader: CURTAIN_VERT,
      fragmentShader: CURTAIN_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.h.materials.push(floorMat, curtainMat);
    const wedges: Wedge[] = [];
    for (let i = 0; i < POOLS.wedges; i++) {
      // The floor: ACROSS + 1 columns of ALONG + 1 stations.
      const fg = new THREE.BufferGeometry();
      const fn = (ACROSS + 1) * (ALONG + 1);
      const floorPos = new THREE.BufferAttribute(new Float32Array(fn * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      );
      const fuv = new Float32Array(fn * 2);
      const fidx: number[] = [];
      for (let a = 0; a <= ACROSS; a++)
        for (let b = 0; b <= ALONG; b++) {
          const v = a * (ALONG + 1) + b;
          fuv[v * 2] = a / ACROSS;
          fuv[v * 2 + 1] = b / ALONG;
          if (a < ACROSS && b < ALONG) {
            const n = v + ALONG + 1;
            fidx.push(v, n, v + 1, n, n + 1, v + 1);
          }
        }
      fg.setAttribute('position', floorPos);
      fg.setAttribute('aUv', new THREE.BufferAttribute(fuv, 2));
      fg.setIndex(fidx);
      const floor = new THREE.Mesh(fg, floorMat);
      floor.name = `smithHeartShelter:${kind}`;
      floor.renderOrder = floorVfxRenderOrder('encounter', 25);
      floor.frustumCulled = false;
      floor.visible = false;
      this.h.root.add(floor);
      // The curtains: two edges of CURTAIN_SEG + 1 stations, foot and top.
      const cg = new THREE.BufferGeometry();
      const cn = 2 * (CURTAIN_SEG + 1) * 2;
      const curtainPos = new THREE.BufferAttribute(new Float32Array(cn * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      );
      const cuv = new Float32Array(cn * 2);
      const cidx: number[] = [];
      for (let e = 0; e < 2; e++)
        for (let k = 0; k <= CURTAIN_SEG; k++) {
          const v = (e * (CURTAIN_SEG + 1) + k) * 2;
          cuv[v * 2] = k / CURTAIN_SEG;
          cuv[v * 2 + 1] = 0;
          cuv[(v + 1) * 2] = k / CURTAIN_SEG;
          cuv[(v + 1) * 2 + 1] = 1;
          if (k < CURTAIN_SEG) cidx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
      cg.setAttribute('position', curtainPos);
      cg.setAttribute('aUv', new THREE.BufferAttribute(cuv, 2));
      cg.setIndex(cidx);
      const curtain = new THREE.Mesh(cg, curtainMat);
      curtain.name = `smithHeartShelterCurtain:${kind}`;
      curtain.frustumCulled = false;
      curtain.visible = false;
      this.h.root.add(curtain);
      this.h.geometries.push(fg, cg);
      wedges.push({ floor, floorPos, curtain, curtainPos });
    }
    return { wedges, floorMat, curtainMat, used: 0 };
  }

  /** Lay `kind`'s shelters from a blast at (sx, sz) reaching `reach`: one
   *  behind every soulless standing pillar it reaches. Returns how many. */
  lay(kind: ShelterKind, sx: number, sz: number, reach: number): number {
    const set = this.sets[kind];
    this.hideWedges(set);
    const n = this.pillars.shelters(_covers);
    const pad = SHELTER_PAD[kind];
    const curtains = this.h.density > 0.5;
    let k = 0;
    for (let i = 0; i < n && k < set.wedges.length; i++) {
      const c = _covers[i];
      // shelters() hands the Echo's cover (the wall plus the sight breath);
      // the drawn edge is this blast's own cover, a hair inside.
      const r = c.r - 0.35 + pad;
      if (!coverShadow(sx, sz, c.x, c.z, r, reach, _sh)) continue;
      const w = set.wedges[k++];
      for (let a = 0; a <= ACROSS; a++)
        for (let b = 0; b <= ALONG; b++) {
          shadowPoint(_sh, a / ACROSS, b / ALONG, _pt);
          w.floorPos.setXYZ(a * (ALONG + 1) + b, _pt.x, this.h.groundY(_pt.x, _pt.z) + 0.1, _pt.z);
        }
      w.floorPos.needsUpdate = true;
      w.floor.visible = true;
      if (curtains) {
        for (let e = 0; e < 2; e++)
          for (let s = 0; s <= CURTAIN_SEG; s++) {
            shadowPoint(_sh, e, s / CURTAIN_SEG, _pt);
            const y = this.h.groundY(_pt.x, _pt.z);
            const v = (e * (CURTAIN_SEG + 1) + s) * 2;
            w.curtainPos.setXYZ(v, _pt.x, y + 0.05, _pt.z);
            w.curtainPos.setXYZ(v + 1, _pt.x, y + CURTAIN_H, _pt.z);
          }
        w.curtainPos.needsUpdate = true;
        w.curtain.visible = true;
      }
    }
    set.used = k;
    return k;
  }

  /** The shelters' strength (0 hides nothing: the wedges stay laid). */
  paint(kind: ShelterKind, alpha: number): void {
    const set = this.sets[kind];
    set.floorMat.uniforms.uAlpha.value = alpha;
    set.curtainMat.uniforms.uAlpha.value = alpha;
  }

  hide(kind: ShelterKind): void {
    this.hideWedges(this.sets[kind]);
  }

  private hideWedges(set: ShelterSet): void {
    for (let i = 0; i < set.used; i++) {
      set.wedges[i].floor.visible = false;
      set.wedges[i].curtain.visible = false;
    }
    set.used = 0;
  }

  /** Laid wedges of a kind (the tests read it). */
  count(kind: ShelterKind): number {
    return this.sets[kind].used;
  }
}
