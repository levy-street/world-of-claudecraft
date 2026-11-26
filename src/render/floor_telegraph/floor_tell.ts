// The shared soak / avoid tell's painter (the plan: floor_tell_core.ts): a
// fixed pool laid over an owner's footprints. A `share` slot draws the shared
// soak marker (soak_marker.ts: the element's vortex, the crisp rim, rings
// converging on the middle, inward chevrons, wisps rising, and a pip round
// its rim for every player the soak needs, lit one per player inside; it
// blooms in and is drawn back into the middle as it goes: owners call
// `settle` every frame); an `avoid` disc draws chevrons pointing out, rings
// growing to the rim and a throbbing rim. Built once by the OWNER in its constructor under its gated
// root (no GPU work after boot), one program for the pool, no light, no
// per-frame allocation. Every tier draws it whole (it is the mechanic's
// information); reduced motion holds its motion still.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  FLOOR_TELL,
  FLOOR_TELL_PIPS,
  type FloorTellKind,
  type FloorTellLook,
  floorTellLook,
  soakPips,
} from './floor_tell_core';
import { buildSoakMarkerGeometry, SoakMarker } from './soak_marker';
import type { SoakElement } from './soak_marker_core';

const VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Mirrors floor_tell_core.ts tellBand: the band coordinate and its stroke. */
const FRAG = /* glsl */ `
uniform float uDir;
uniform float uPhase;
uniform float uBands;
uniform float uSpokes;
uniform float uSlope;
uniform float uAlpha;
uniform float uRim;
uniform float uRimOn;
uniform float uNeed;
uniform float uLit;
uniform float uPipAt;
uniform float uPipSize;
uniform float uRadius;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec2 vXZ;
void main() {
  float r = length(vXZ);
  if (r > 1.0) discard;
  float t = fract(atan(vXZ.x, vXZ.y) / 6.2831853 + 0.5);
  // The chevrons: one per spoke, its tip toward the middle (share) or the
  // rim (avoid), the bands running the same way.
  float u = fract(t * uSpokes) - 0.5;
  float v = r + uDir * abs(u) * uSlope;
  float x = fract(v * uBands - uDir * uPhase);
  float aa = fwidth(x) * 1.5 + 0.01;
  float stroke = smoothstep(0.0, aa, x) * (1.0 - smoothstep(0.2, 0.2 + aa, x));
  // Kept off the very middle and the rim (the rim is its own line).
  float field = smoothstep(0.16, 0.3, r) * (1.0 - smoothstep(0.86, 0.92, r));
  float chev = stroke * field;
  // The rim: a crisp line, its throb pushing it out (avoid) or steady (share).
  float rw = fwidth(r) * 1.5 + 0.012;
  float rimLine = smoothstep(0.955 - rw, 0.955, r) * (1.0 - smoothstep(1.0 - rw, 1.0, r)) * uRimOn;
  float halo = smoothstep(0.86, 1.0, r) * (0.25 + 0.75 * uRim) * 0.45 * uRimOn;
  // The pips: uNeed of them round the rim, the first uLit bright.
  float pip = 0.0;
  float lit = 0.0;
  if (uNeed > 0.5) {
    float k = floor(t * uNeed);
    float local = (fract(t * uNeed) - 0.5) * 6.2831853 * uPipAt / uNeed;
    float d = length(vec2(local, r - uPipAt));
    float pw = fwidth(d) * 1.5 + 0.006;
    pip = 1.0 - smoothstep(uPipSize - pw, uPipSize, d);
    float ring = smoothstep(uPipSize * 0.62 - pw, uPipSize * 0.62, d) * pip;
    lit = step(k + 0.5, uLit);
    // An unlit pip is a hollow socket, a lit one a full bright gem.
    pip = mix(ring, pip, lit);
  }
  vec3 col = uColor * (0.85 + 0.7 * chev) + uHot * (rimLine * 0.6 + lit * pip);
  col = mix(col, uColor * 0.45, (1.0 - lit) * pip * 0.5);
  float a = uAlpha * (0.1 + 0.85 * chev + rimLine + halo) + pip * min(1.0, uAlpha + 0.35);
  gl_FragColor = vec4(col, min(1.0, a));
  #include <colorspace_fragment>
}
`;

interface TellSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  /** The share look (null in an avoid-only pool). */
  soak: SoakMarker | null;
}

export interface FloorTellPaint {
  kind: FloorTellKind;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** avoid: the threat colour and its hot highlight (a share takes its
   *  palette from `element`). */
  color: number;
  hot?: number;
  /** The mark's fill (0 laid, 1 landing). */
  fill: number;
  clock: number;
  reduced: boolean;
  /** share: the players it needs and how many stand inside. */
  need?: number;
  have?: number;
  /** Draw the tell's own rim line (off where the owner already draws one,
   *  the rock's countdown rim). Default on. */
  rim?: boolean;
  /** share: the soak's element (its marker's palette). Default earth. */
  element?: SoakElement;
  /** share: the tier's detail (0 low .. 1 full): the wisps' count only. */
  detail?: number;
  /** share: a countdown arc, the bar's progress (0..1), or none. */
  timer?: number | null;
  /** share: where the pips sit (a share of the radius; default the rim's). */
  pipAt?: number;
}

const _look: FloorTellLook = { phase: 0, rim: 0, alpha: 0 };

/** A fixed pool of soak / avoid tells. */
export class FloorTellPool {
  private readonly slots: TellSlot[] = [];

  /** `rung`: the owner's floor ladder rung (over its footprint's fill);
   *  `share`: build the soak marker too (off for an avoid-only pool). */
  constructor(
    root: THREE.Object3D,
    size: number,
    geometries: THREE.BufferGeometry[],
    materials: THREE.Material[],
    rung = 26,
    share = true,
  ) {
    const geo = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2);
    geometries.push(geo);
    const soakGeo = share ? buildSoakMarkerGeometry(geometries) : null;
    for (let i = 0; i < size; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'floorTell',
        uniforms: {
          uDir: { value: -1 },
          uPhase: { value: 0 },
          uBands: { value: FLOOR_TELL.share.bands },
          uSpokes: { value: FLOOR_TELL.share.spokes },
          uSlope: { value: FLOOR_TELL.share.slope },
          uAlpha: { value: 0 },
          uRim: { value: 0 },
          uRimOn: { value: 1 },
          uNeed: { value: 0 },
          uLit: { value: 0 },
          uPipAt: { value: FLOOR_TELL_PIPS.at },
          uPipSize: { value: FLOOR_TELL_PIPS.size },
          uRadius: { value: 1 },
          uColor: { value: new THREE.Color(0xffffff) },
          uHot: { value: new THREE.Color(0xffffff) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'floorTell';
      mesh.renderOrder = floorVfxRenderOrder('encounter', rung);
      mesh.visible = false;
      mesh.frustumCulled = false;
      root.add(mesh);
      materials.push(mat);
      let soak: SoakMarker | null = null;
      if (soakGeo) {
        soak = new SoakMarker(soakGeo, materials, rung, 'floorTellSoak');
        root.add(soak.group);
      }
      this.slots.push({ mesh, mat, soak });
    }
  }

  get size(): number {
    return this.slots.length;
  }

  /** Lay tell `i` (call every frame it shows). */
  paint(i: number, p: FloorTellPaint): void {
    const s = this.slots[i];
    if (!s) return;
    if (p.kind === 'share' && s.soak) {
      if (s.mesh.visible) s.mesh.visible = false;
      s.soak.paint({
        x: p.x,
        y: p.y,
        z: p.z,
        radius: p.radius,
        element: p.element ?? 'earth',
        fill: p.fill,
        clock: p.clock,
        reduced: p.reduced,
        need: p.need,
        have: p.have,
        rim: p.rim,
        detail: p.detail,
        timer: p.timer,
        pipAt: p.pipAt,
      });
      return;
    }
    s.soak?.hide();
    const spec = FLOOR_TELL[p.kind];
    floorTellLook(p.kind, p.clock, p.fill, p.reduced, _look);
    const u = s.mat.uniforms;
    u.uDir.value = spec.dir;
    u.uPhase.value = _look.phase;
    u.uBands.value = spec.bands;
    u.uSpokes.value = spec.spokes;
    u.uSlope.value = spec.slope;
    u.uAlpha.value = _look.alpha;
    u.uRim.value = _look.rim;
    u.uRimOn.value = p.rim === false ? 0 : 1;
    u.uRadius.value = p.radius;
    const pips = p.kind === 'share' ? soakPips(p.need ?? 0, p.have ?? 0) : { need: 0, lit: 0 };
    u.uNeed.value = pips.need;
    u.uLit.value = pips.lit;
    (u.uColor.value as THREE.Color).setHex(p.color);
    (u.uHot.value as THREE.Color).setHex(p.hot ?? 0xfff4d8);
    // A throbbing avoid rim swells a hair past the footprint and back; the
    // drawn circle never shrinks inside the sim's own radius.
    const swell = p.kind === 'avoid' && !p.reduced ? 1 + 0.035 * _look.rim : 1;
    s.mesh.position.set(p.x, p.y + 0.14, p.z);
    s.mesh.scale.setScalar(p.radius * swell);
    s.mesh.visible = true;
  }

  /** Tell `i`'s mark is gone: an avoid disc goes at once, a share marker
   *  plays its decay (advanced by `settle`). */
  hide(i: number): void {
    const s = this.slots[i];
    if (!s) return;
    if (s.mesh.visible) s.mesh.visible = false;
    s.soak?.release();
  }

  /** Advance the share markers' decays (owners call it every frame). */
  settle(clock: number): void {
    for (const s of this.slots) s.soak?.settle(clock);
  }

  /** Hide every tell at once, no decay (a wipe, the fight's end). */
  hideAll(): void {
    for (const s of this.slots) {
      if (s.mesh.visible) s.mesh.visible = false;
      s.soak?.hide();
    }
  }

  /** Is tell `i` showing (the tests read it)? A decaying marker still is. */
  shown(i: number): boolean {
    const s = this.slots[i];
    return (s?.mesh.visible ?? false) || (s?.soak?.shown ?? false);
  }

  /** Its uniforms (the tests read the count and the way it points): the
   *  share marker's disc while it shows, else the avoid disc's. */
  uniformsOf(i: number): Record<string, THREE.IUniform> | null {
    const s = this.slots[i];
    if (!s) return null;
    return s.soak?.shown ? s.soak.discMat.uniforms : s.mat.uniforms;
  }
}
