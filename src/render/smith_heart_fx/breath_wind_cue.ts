// The Guardian of the Breath's wind-direction cue (a part of BreathFightFx;
// look: breath_fight_fx_core.ts WIND_CUE, stormWallLook, stormWallWeight,
// turnArrowAlpha). The redesign of 2026-11-25 (Jose's approval, in the manner
// of the great wind fights of the genre): the floor's grid of chevrons
// cluttered the Cornice and hid the other telegraphs, so the way the wind
// blows now reads off two things.
//
//   The storm wall   a band of churning storm cloud standing on the UPWIND
//                    edge of the Cornice, rising out of the void past the
//                    floor: the side the wind blows FROM. A storm at your
//                    back pushes you forward. It swings round with each turn
//                    of the wind (its direction eased, never snapped) and
//                    fades in the calm.
//   The turn arrows  on each turn of the wind, a few small arrows on the
//                    floor down the Cornice's two sides (the edges parallel
//                    to the wind), lit one after another down the flow for
//                    about two seconds, then gone. Nothing in the middle,
//                    where the raid fights (Jose's look of 2026-11-25: the
//                    one big centre arrow was too big).
//
// Both look the same on EVERY tier: the wind's way is information a player
// acts on (docs/design/graphics-settings-fairness.md). Reduced motion stills
// the clouds (the wall still stands). Two draws, built in the constructor
// under the fight's local group so the compile gate links them with the rest
// before the first blow; no light, no texture, no per-frame allocation.

import * as THREE from 'three';
import { BREATH } from '../../sim/content/smith_heart_layout';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  type TurnArrowSpot,
  turnArrowAlphaAt,
  turnArrowSpots,
  WIND_CUE,
} from './breath_fight_fx_core';

/** The most turn arrows (both sides' rows). */
const ARROW_MAX = WIND_CUE.arrowPerSide * 2;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

/** Columns round the wall's ring. */
const WALL_SEGMENTS = 96;

const WALL_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
uniform vec2 uDir;
attribute vec2 aNormal;
attribute vec2 aWall;
varying vec2 vWall;
varying float vUp;
void main() {
  vWall = aWall;
  // Whole on the side the wind blows FROM, gone on the side it blows to
  // (breath_fight_fx_core.ts stormWallWeight, the same curve).
  float up = -dot(aNormal, uDir);
  float k = clamp((up - 0.2) / 0.7, 0.0, 1.0);
  vUp = k * k * (3.0 - 2.0 * k);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;

const WALL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform vec3 uDark;
uniform vec3 uLight;
uniform vec3 uGlow;
varying vec2 vWall;
varying float vUp;
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
  if (vUp < 0.01) discard;
  // vWall.x round the ring (yards), vWall.y up the wall (0 bottom, 1 top).
  vec2 p = vec2(vWall.x * 0.09, vWall.y * 2.2);
  // Churning: two layers rolling up and along at their own paces.
  float n = vnoise(p + vec2(uTime * 0.05, -uTime * 0.18)) * 0.55
    + vnoise(p * 2.3 + vec2(-uTime * 0.11, -uTime * 0.31)) * 0.3
    + vnoise(p * 5.1 + vec2(uTime * 0.2, -uTime * 0.5)) * 0.15;
  float y = vWall.y;
  // Thick low, torn and thinning toward the top; soft at the foot.
  float body = smoothstep(0.0, 0.18, y) * (1.0 - smoothstep(0.45, 1.0, y + (n - 0.5) * 0.5));
  float cloud = smoothstep(0.28, 0.72, n);
  float a = uStrength * vUp * body * mix(0.6, 1.0, cloud);
  if (a < 0.01) discard;
  // Pale storm mist over the dark rock behind it: grey hollows, bright
  // billows, a cold glow along the floor's line where the wind leaves it.
  vec3 col = mix(uDark, uLight, smoothstep(0.3, 0.85, n));
  col += uGlow * (1.0 - smoothstep(0.3, 0.5, y)) * 0.45;
  gl_FragColor = vec4(col, min(0.92, a));
  #include <colorspace_fragment>
}
`;

const ARROW_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  #ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  #else
  vec4 wp = modelMatrix * vec4(position, 1.0);
  #endif
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;

/** One broad arrow in its quad's uv: u across (0..1), v along (0 tail, 1
 *  point): a shaft and a head, a dark rim round a bright core. */
const ARROW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uEdge;
varying vec2 vUv;
varying float vAlpha;
float arrowMask(vec2 uv, float grow) {
  float x = abs(uv.x - 0.5) * 2.0;
  float shaft = step(x, 0.3 + grow) * step(0.02 - grow, uv.y) * step(uv.y, 0.6);
  float head = step(0.55 - grow, uv.y) * step(x, (1.0 - uv.y) / 0.45 + grow) * step(uv.y, 1.0 + grow);
  return max(shaft, head);
}
void main() {
  float outer = arrowMask(vUv, 0.05);
  if (outer < 0.5 || vAlpha < 0.01) discard;
  float core = arrowMask(vUv, 0.0);
  // A white-hot spine down the middle of the cyan body.
  float spine = 1.0 - smoothstep(0.0, 0.35, abs(vUv.x - 0.5) * 2.0);
  vec3 col = mix(uEdge, mix(uColor, vec3(1.0), spine * 0.35) * 1.15, core);
  gl_FragColor = vec4(col, vAlpha * mix(0.95, 0.85, core));
  #include <colorspace_fragment>
}
`;

/** The cue's colours: storm slate, its lit billows, the wind's cold cyan
 *  (the Updrafts' own) for the foot's glow and the arrow, a storm-dark rim. */
const CUE_RGB = {
  dark: 0x7d8fa3,
  light: 0xf2f7fb,
  glow: 0x8fe6ff,
  arrow: 0x9ff2ff,
  arrowEdge: 0x0d2a3a,
} as const;

/** The storm wall and the turn arrows over the Storm Cornice. */
export class BreathWindCue {
  readonly wall: THREE.Mesh;
  readonly arrow: THREE.InstancedMesh;
  private readonly wallGeo: THREE.BufferGeometry;
  private readonly wallMat: THREE.ShaderMaterial;
  private readonly arrowGeo: THREE.PlaneGeometry;
  private readonly arrowMat: THREE.ShaderMaterial;
  private readonly arrowAlpha: THREE.InstancedBufferAttribute;
  /** The row's spots for the bearing it was laid for. */
  private spots: TurnArrowSpot[] = [];
  private readonly spotDir = { x: Number.NaN, z: Number.NaN };
  private time = 0;

  /** Under `parent` (instance-local coordinates), round the Cornice whose
   *  floor stands at `floorY`. */
  constructor(parent: THREE.Object3D, floorY: number) {
    const C = BREATH.cornice;
    const W = WIND_CUE;
    const rx = C.rx * W.wallOut;
    const rz = C.rz * W.wallOut;
    const pos: number[] = [];
    const nrm: number[] = [];
    const wall: number[] = [];
    const idx: number[] = [];
    let run = 0;
    let px: number = C.x;
    let pz: number = C.z + rz;
    for (let i = 0; i <= WALL_SEGMENTS; i++) {
      const a = (i / WALL_SEGMENTS) * Math.PI * 2;
      const x = C.x + Math.sin(a) * rx;
      const z = C.z + Math.cos(a) * rz;
      run += Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
      // The ellipse's outward normal.
      const nx = Math.sin(a) / rx;
      const nz = Math.cos(a) / rz;
      const nl = Math.hypot(nx, nz);
      for (const [y, v] of [
        [-W.wallDrop, 0],
        [W.wallHeight, 1],
      ] as const) {
        pos.push(x, y, z);
        nrm.push(nx / nl, nz / nl);
        wall.push(run, v);
      }
      if (i < WALL_SEGMENTS) {
        const b = i * 2;
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    }
    this.wallGeo = new THREE.BufferGeometry();
    this.wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.wallGeo.setAttribute('aNormal', new THREE.Float32BufferAttribute(nrm, 2));
    this.wallGeo.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 2));
    this.wallGeo.setIndex(idx);
    this.wallMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathStormWall',
      uniforms: {
        uDir: { value: new THREE.Vector2(0, 1) },
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uDark: { value: new THREE.Color(CUE_RGB.dark) },
        uLight: { value: new THREE.Color(CUE_RGB.light) },
        uGlow: { value: new THREE.Color(CUE_RGB.glow) },
      },
      vertexShader: WALL_VERT,
      fragmentShader: WALL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.wall = new THREE.Mesh(this.wallGeo, this.wallMat);
    this.wall.name = 'smithHeartBreathStormWall';
    this.wall.position.y = floorY;
    this.wall.frustumCulled = false;
    this.wall.visible = false;
    parent.add(this.wall);

    this.arrowGeo = new THREE.PlaneGeometry(W.arrowWidth, W.arrowLength);
    // Lay it flat: x across, its point (uv v = 1, the plane's +y) turned
    // onto +z.
    this.arrowGeo.rotateX(Math.PI / 2);
    this.arrowMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathTurnArrow',
      uniforms: {
        uColor: { value: new THREE.Color(CUE_RGB.arrow) },
        uEdge: { value: new THREE.Color(CUE_RGB.arrowEdge) },
      },
      vertexShader: ARROW_VERT,
      fragmentShader: ARROW_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.arrowAlpha = new THREE.InstancedBufferAttribute(new Float32Array(ARROW_MAX), 1);
    this.arrowAlpha.setUsage(THREE.DynamicDrawUsage);
    this.arrowGeo.setAttribute('aAlpha', this.arrowAlpha);
    this.arrow = new THREE.InstancedMesh(this.arrowGeo, this.arrowMat, ARROW_MAX);
    this.arrow.count = 0;
    this.arrow.name = 'smithHeartBreathTurnArrow';
    // Over the painted granite (its kit stands a hand over the field floor);
    // each arrow's spot is claim-local, on its instance matrix.
    this.arrow.position.y = floorY + 0.35;
    this.arrow.renderOrder = floorVfxRenderOrder('encounter', 12);
    this.arrow.frustumCulled = false;
    this.arrow.visible = false;
    parent.add(this.arrow);
  }

  /** One frame: the wall's strength (0 hides it) and the wind's way (a unit
   *  x, z, already eased round by the caller), the seconds since the wind
   *  turned (negative: no arrows) and its NEW way the arrows point along;
   *  `still` (reduced motion) holds the clouds. */
  paint(
    wallStrength: number,
    dir: { x: number; z: number },
    sinceTurn: number,
    arrowDir: { x: number; z: number },
    dt: number,
    still: boolean,
  ): void {
    const u = this.wallMat.uniforms;
    u.uStrength.value += (wallStrength - u.uStrength.value) * Math.min(1, dt * 3);
    this.wall.visible = u.uStrength.value > 0.01;
    if (this.wall.visible) {
      if (!still) this.time = (this.time + dt) % 3600;
      u.uTime.value = this.time;
      (u.uDir.value as THREE.Vector2).set(dir.x, dir.z);
    }
    this.paintArrows(sinceTurn, arrowDir);
  }

  /** The turn arrows: laid down the sides for a new way, each faded on its
   *  own clock down the flow. */
  private paintArrows(since: number, dir: { x: number; z: number }): void {
    let any = false;
    if (since >= 0) {
      if (dir.x !== this.spotDir.x || dir.z !== this.spotDir.z) this.layArrows(dir);
      const a = this.arrowAlpha.array as Float32Array;
      for (let i = 0; i < this.spots.length; i++) {
        a[i] = turnArrowAlphaAt(since, this.spots[i].k);
        if (a[i] > 0.01) any = true;
      }
      if (any) this.arrowAlpha.needsUpdate = true;
    }
    this.arrow.visible = any;
  }

  /** Each arrow's spot and heading for the wind along `dir` (only on a turn). */
  private layArrows(dir: { x: number; z: number }): void {
    this.spotDir.x = dir.x;
    this.spotDir.z = dir.z;
    this.spots = turnArrowSpots(dir);
    _q.setFromAxisAngle(_up, Math.atan2(dir.x, dir.z));
    for (let i = 0; i < this.spots.length; i++) {
      _p.set(this.spots[i].x, 0, this.spots[i].z);
      this.arrow.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.arrow.count = this.spots.length;
    this.arrow.instanceMatrix.needsUpdate = true;
  }

  /** Gone at once (the fight over or reset). */
  hide(): void {
    this.wallMat.uniforms.uStrength.value = 0;
    this.spotDir.x = Number.NaN;
    this.wall.visible = false;
    this.arrow.visible = false;
  }

  dispose(): void {
    this.wall.removeFromParent();
    this.arrow.removeFromParent();
    this.wallGeo.dispose();
    this.wallMat.dispose();
    this.arrowGeo.dispose();
    this.arrowMat.dispose();
  }
}
