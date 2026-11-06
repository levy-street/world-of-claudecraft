// The Guardian of the Heat's Molten Swells, the waves themselves (pass 4;
// plan: heat_swell_core.ts), a part of HeatFx: HeatFx owns the lanes (their
// telegraph, the sim's wave objects and the clock) and hands each lane slot's
// wave here to draw:
//  - the wall: a heavy curling wave of molten rock standing exactly in the
//    sim's hit box (heat_swell_core.ts), its face open and boiling under the
//    curl, a white-hot lip hooking over the front line, the crest breaking
//    into gold, plates of dark crust with glowing seams riding its back, its
//    crest rippling along its length, its ends rolling down to the floor;
//  - the spray: drops and blobs of molten rock torn off the crest and thrown
//    ahead, fire foaming at its foot, embers climbing, smoke off its back;
//  - the floor: the box under the wall burning white-gold (the hit area, read
//    from above too), and behind it a scorched trail cooling from gold to
//    crust, cracks still glowing, that lingers and fades once the lane is gone;
//  - the origin: the ground heaving where the swells break out of the fist's
//    crater (a rumble ring, basalt kicked up, a shake).
// The walls and the floor boxes draw on every tier; the spray, the embers,
// the smoke and the shakes thin on the low tier and under reduced motion.
//
// Built in HeatFx's constructor under its root (one gated attach), a fixed
// pool, no per-frame allocation, no light.

import * as THREE from 'three';
import { HEAT_TUNING as T } from '../../sim/encounters/smith_heart/heat_ids';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { HEAT_FLOOR } from './heat_floor_ladder_core';
import { HEAT_FX_COLORS as C } from './heat_fx_core';
import { HEAT_LAVA_GLSL, HEAT_MOLTEN_GLSL, HEAT_NOISE_GLSL } from './heat_lava_glsl';
import { moltenDecal } from './heat_molten_decal';
import {
  HEAT_SWELL_LOOK as L,
  SWELL_LIP_V,
  SWELL_PROFILE,
  swellDroop,
  swellFootprint,
  swellTrailFade,
} from './heat_swell_core';

/** What HeatFx lends the swells. */
export interface HeatSwellHost {
  readonly root: THREE.Group;
  readonly particles: EngineParticles;
  readonly uTime: { value: number };
  readonly density: number;
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  groundY(x: number, z: number): number;
  rand(): number;
  shakeNear(x: number, z: number, amount: number, reach?: number): void;
}

type Puff = Parameters<EngineParticles['puff']>[4];
const _foot = { near: 0, far: 0 };
const _spray = { x: 0, y: 0, z: 0, sin: 0, cos: 1, half: 1, k: 0 };
const FWD: [number, number, number] = [0, 0, 0];

/** Drops torn off the crest and flung ahead of the wave. */
const DROP = {
  speed: 6,
  up: 5,
  life: 0.8,
  size: [0.55, 0.14] as [number, number],
  color: C.spark,
  alpha: 1,
  pool: 'glow' as const,
  dir: FWD,
  spread: 0.55,
  gravity: 18,
  drag: 0.4,
  radius: 0.4,
};
/** Heavier blobs of molten rock thrown off the lip. */
const BLOB = {
  speed: 4.5,
  up: 4,
  life: 0.9,
  size: [1.15, 0.4] as [number, number],
  color: C.fire,
  alpha: 1,
  pool: 'glow' as const,
  dir: FWD,
  spread: 0.4,
  gravity: 20,
  drag: 0.3,
  radius: 0.3,
};
/** Fire foaming at the wave's foot as it bulldozes the floor. */
const FOAM = {
  speed: 1.6,
  up: 2.4,
  life: 0.45,
  size: [2.3, 0.45] as [number, number],
  color: [0.62, 0, 0] as const,
  alpha: 0.9,
  pool: 'pyre' as const,
  radius: 0.4,
};
/** The crest frothing into flame as it breaks. */
const CREST = {
  speed: 1.2,
  up: 2.8,
  life: 0.5,
  size: [2.1, 0.4] as [number, number],
  color: [0.55, 0, 0] as const,
  alpha: 0.9,
  pool: 'pyre' as const,
  radius: 0.3,
};
const EMBER = {
  speed: 1,
  up: 4.2,
  life: 1.5,
  size: [0.24, 0.05] as [number, number],
  color: C.spark,
  alpha: 1,
  pool: 'glow' as const,
  radius: 0.6,
};
const SMOKE = {
  speed: 0.6,
  up: 2.2,
  life: 2.2,
  size: [2.3, 5.8] as [number, number],
  color: [0.1, 0.085, 0.075] as const,
  alpha: 0.42,
  drag: 0.8,
  radius: 0.8,
};

// ---- the wall ---------------------------------------------------------------------------

/** The wave's body: SWELL_PROFILE extruded across the lane (x -1..1), its ends
 *  drooping to the floor. uv.x across, uv.y along the profile (0 the front
 *  foot, 1 the back foot). The mesh is laid at the wave's front, scaled (half
 *  width, height, waveDepth). */
export function swellCurlGeometry(across = 28): THREE.BufferGeometry {
  const P = SWELL_PROFILE;
  const rows = P.length;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((across + 1) * rows * 3);
  const uv = new Float32Array((across + 1) * rows * 2);
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i <= across; i++) {
      const x = -1 + (2 * i) / across;
      const d = swellDroop(x);
      pos[k * 3] = x;
      pos[k * 3 + 1] = P[j][1] * d;
      // The curl tucks back toward the body at the ends (still in the box).
      pos[k * 3 + 2] = P[j][0] * (0.55 + 0.45 * d) - 0.45 * (1 - d) * 0.5;
      uv[k * 2] = i / across;
      uv[k * 2 + 1] = j / (rows - 1);
      k++;
    }
  }
  for (let i = 0; i < pos.length; i += 3) pos[i + 2] = Math.max(-1, Math.min(0, pos[i + 2]));
  const index: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < across; i++) {
      const a = j * (across + 1) + i;
      const b = a + across + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const WALL_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
varying vec3 vW;
varying vec3 vN;
void main() {
  vUv = uv;
  vec3 p = position;
  // The crest ripples along the wave's length; the lip surges and falls back.
  float crest = smoothstep(0.25, 0.7, uv.y) * (1.0 - smoothstep(0.7, 1.0, uv.y));
  float lipBand = 1.0 - smoothstep(0.0, 0.25, abs(uv.y - ${SWELL_LIP_V.toFixed(4)}));
  float x = uv.x * 6.2831853;
  float wob = sin(x * 1.5 + uTime * 5.0 + uSeed) * 0.5 + sin(x * 3.7 - uTime * 7.3 + uSeed * 2.0) * 0.5;
  float edge = smoothstep(0.0, 0.15, uv.x) * smoothstep(1.0, 0.85, uv.x);
  p.y += (crest * 0.06 + lipBand * 0.05) * wob * edge;
  p.z = clamp(p.z + lipBand * 0.04 * (0.5 + 0.5 * sin(uTime * 9.0 + x * 2.0 + uSeed)) * edge, -1.0, 0.0);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
const WALL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHeat;
uniform float uSeed;
varying vec2 vUv;
varying vec3 vW;
varying vec3 vN;
${HEAT_NOISE_GLSL}
// The wave's own ramp (the guardian's fire palette: dark crust, deep red,
// orange, gold only at the hottest): 0 cold crust to 1 the lip's gold.
vec3 waveRamp(float m) {
  vec3 crust = vec3(0.05, 0.038, 0.034);
  vec3 ember = vec3(0.42, 0.07, 0.015);
  vec3 orange = vec3(0.98, 0.36, 0.06);
  vec3 gold = vec3(1.0, 0.68, 0.22);
  vec3 c = mix(crust, ember, smoothstep(0.08, 0.38, m));
  c = mix(c, orange, smoothstep(0.35, 0.68, m));
  c = mix(c, gold, smoothstep(0.72, 0.98, m));
  return c * (1.0 + 0.9 * smoothstep(0.45, 1.0, m));
}
void main() {
  float v = vUv.y;
  float lipV = ${SWELL_LIP_V.toFixed(4)};
  float across = vUv.x * 9.0 + uSeed;
  // The open face (the front foot up into the curl) and the back (past the
  // crest, sloping down to its foot).
  float face = 1.0 - smoothstep(lipV - 0.02, lipV + 0.04, v);
  float back = smoothstep(0.6, 0.76, v);
  // Molten streaks pouring up the face into the curl.
  float flow = fbm(vec2(across * 1.1, v * 9.0 - uTime * 2.4));
  float streak = smoothstep(0.45, 0.75, fbm(vec2(across * 2.6, v * 4.0 - uTime * 3.1)));
  float mFace = 0.44 + 0.2 * flow + 0.22 * streak;
  // Plates of dark crust riding the back, their seams alight (wider and
  // hotter near the crest, where the crust tears).
  vec2 cp = vec2(across * 0.75, v * 4.2 + uTime * 0.4);
  float seam = cellEdge(cp);
  float nearCrest = 1.0 - smoothstep(0.66, 0.98, v);
  float plate = smoothstep(0.03 + 0.05 * nearCrest, 0.12 + 0.08 * nearCrest, seam);
  float grain = vn(cp * 6.0) * 0.08;
  float mBack = mix(0.6 + 0.1 * flow, 0.04 + grain + 0.1 * nearCrest, plate);
  float m = mix(mFace, mBack, back);
  // The crest breaking over: hot, tearing.
  float crestHot = smoothstep(lipV - 0.04, lipV, v) * (1.0 - smoothstep(lipV + 0.02, 0.66, v));
  m = max(m, crestHot * (0.66 + 0.14 * flow));
  // The lip: the one gold line.
  float lip = 1.0 - smoothstep(0.0, 0.045, abs(v - lipV));
  m = max(m, lip * (0.86 + 0.1 * flow));
  // The boiling foot at the front, where it bulldozes the floor.
  float foot = 1.0 - smoothstep(0.0, 0.09, v);
  m = max(m, foot * (0.62 + 0.18 * vn(vec2(across * 3.0, uTime * 6.0))));
  // Down-facing and back-facing crust darkens (a body, not a ribbon).
  float down = clamp(-vN.y, 0.0, 1.0);
  m *= 1.0 - 0.4 * down * back;
  m = clamp(m * uHeat, 0.0, 1.0);
  // The lip tears into spatter.
  float tear = vn(vec2(across * 2.6, uTime * 2.3)) * 0.6 + vn(vec2(across * 7.0, uTime * 4.1)) * 0.4;
  if (lip > 0.4 && tear > 0.8) discard;
  gl_FragColor = vec4(waveRamp(m), 1.0);
  #include <colorspace_fragment>
}
`;

// ---- the floor: the burning box under the wall, the trail behind it ------------------------

const WAKE_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
/** uv.y 0 at the lane's start, 1 at its drawn end; uv.x across (0..1, the
 *  lane's exact width). uNear..uFar: the wall's box (the hit area). */
const WAKE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLen;
uniform float uNear;
uniform float uFar;
uniform float uCool;
uniform float uFade;
varying vec2 vUv;
varying vec3 vW;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
${HEAT_LAVA_GLSL}
vec3 trailRamp(float m) {
  vec3 crust = vec3(0.05, 0.038, 0.034);
  vec3 ember = vec3(0.45, 0.08, 0.02);
  vec3 orange = vec3(1.0, 0.4, 0.08);
  vec3 gold = vec3(1.0, 0.7, 0.26);
  vec3 c = mix(crust, ember, smoothstep(0.05, 0.35, m));
  c = mix(c, orange, smoothstep(0.32, 0.65, m));
  return mix(c, gold, smoothstep(0.7, 1.0, m));
}
void main() {
  float along = vUv.y * uLen;
  float across = abs(vUv.x - 0.5) * 2.0;
  if (along > uFar) discard;
  // The box under the wall: the hit area, burning white-gold edge to edge.
  float inBox = step(uNear, along);
  float lvl = lavaLevel(vW.xz, vec2(0.0), uTime * 0.4, 1.0);
  float box = inBox * (0.7 + 0.18 * lvl);
  // Behind it the trail: cooling from gold to crust, its cracks glowing,
  // ragged at its edges, fading once its lane is gone.
  float behind = uNear - along;
  float heat = (1.0 - inBox) * pow(1.0 - clamp(behind / uCool, 0.0, 1.0), 1.3);
  float cracks = 1.0 - smoothstep(0.0, 0.07, cellEdge(vW.xz * 0.9));
  float rag = vn(vec2(along * 0.7, vUv.x * 6.0)) * 0.22;
  float trail = (1.0 - inBox) * (1.0 - smoothstep(0.78 - rag, 1.0 - rag * 0.5, across));
  float m = max(box, trail * max(heat * (0.5 + 0.5 * lvl), cracks * 0.55 * (0.3 + 0.7 * heat)));
  vec3 col = trailRamp(clamp(m, 0.0, 1.0)) * 1.25;
  float a = max(box * 0.95, trail * (0.5 + 0.45 * heat)) * mix(1.0, uFade, 1.0 - inBox);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

interface SwellSlot {
  wall: THREE.Mesh;
  wallMat: THREE.ShaderMaterial;
  wake: THREE.Mesh;
  wakeMat: THREE.ShaderMaterial;
  x: number;
  y: number;
  z: number;
  facing: number;
  half: number;
  length: number;
  /** Rolling (true) or its lane gone and the trail fading (`goneAt`). */
  live: boolean;
  goneAt: number;
  rolled: boolean;
}

export class HeatSwells {
  private readonly slots: SwellSlot[] = [];
  private lastOrigin = -99;

  constructor(
    private readonly host: HeatSwellHost,
    count: number,
  ) {
    const wallGeo = swellCurlGeometry();
    const wakeGeo = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    // uv.y 0 at the lane's start (z 0), 1 at its end (z 1).
    const wuv = wakeGeo.getAttribute('uv') as THREE.BufferAttribute;
    const wpos = wakeGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < wuv.count; i++) wuv.setY(i, wpos.getZ(i));
    host.geometries.push(wallGeo, wakeGeo);
    for (let i = 0; i < count; i++) {
      const wallMat = new THREE.ShaderMaterial({
        name: 'smithHeartHeatSwellWall',
        uniforms: { uTime: host.uTime, uHeat: { value: 1 }, uSeed: { value: i * 3.7 } },
        vertexShader: WALL_VERT,
        fragmentShader: WALL_FRAG,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      host.materials.push(wallMat);
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.name = 'smithHeartHeatSwellWall';
      wall.frustumCulled = false;
      wall.visible = false;
      host.root.add(wall);
      // The floor box and the trail: char and glow passes (crossing trails
      // out of one crater compose the same from every angle).
      const { mesh: wake, mat: wakeMat } = moltenDecal(
        {
          name: 'smithHeartHeatSwellWake',
          geometry: wakeGeo,
          vertexShader: WAKE_VERT,
          fragmentShader: WAKE_FRAG,
          uniforms: {
            uTime: host.uTime,
            uLen: { value: T.laneLength },
            uNear: { value: 0 },
            uFar: { value: 0 },
            uCool: { value: L.coolRun },
            uFade: { value: 1 },
          },
          charStep: HEAT_FLOOR.wakeChar.step,
          glowStep: HEAT_FLOOR.wakeGlow.step,
        },
        host.materials,
      );
      host.root.add(wake);
      this.slots.push({
        wall,
        wallMat,
        wake,
        wakeMat,
        x: 0,
        y: 0,
        z: 0,
        facing: 0,
        half: T.laneHalf,
        length: T.laneLength,
        live: false,
        goneAt: -99,
        rolled: false,
      });
    }
  }

  private get clock(): number {
    return this.host.uTime.value;
  }

  /** Lane `i` came up at (x, y, z) along `facing`, `half` wide either side,
   *  drawn `length` long: its floor is laid (nothing shows till it rolls). */
  lay(
    i: number,
    x: number,
    y: number,
    z: number,
    facing: number,
    half: number,
    length: number,
  ): void {
    const s = this.slots[i];
    s.x = x;
    s.y = y;
    s.z = z;
    s.facing = facing;
    s.half = half;
    s.length = length;
    s.live = true;
    s.rolled = false;
    s.goneAt = -99;
    s.wall.visible = false;
    s.wake.visible = false;
    s.wake.position.set(x, y + 0.05, z);
    s.wake.rotation.y = facing;
    s.wake.scale.set(half * 2, 1, length);
    const u = s.wakeMat.uniforms;
    u.uLen.value = length;
    u.uNear.value = 0;
    u.uFar.value = 0;
    u.uFade.value = 1;
  }

  /** Lane `i`'s wave stands `front` yards down it, `h` yards tall (0: it has
   *  not risen or has sunk). */
  paint(i: number, front: number, h: number, dt: number): void {
    const s = this.slots[i];
    const foot = swellFootprint(front, s.length, _foot);
    s.rolled = true;
    const sin = Math.sin(s.facing);
    const cos = Math.cos(s.facing);
    const wx = s.x + sin * foot.far;
    const wz = s.z + cos * foot.far;
    const gy = this.host.groundY(wx, wz);
    s.wall.visible = h > 0.05;
    s.wall.position.set(wx, gy, wz);
    s.wall.rotation.y = s.facing;
    s.wall.scale.set(s.half, h, T.waveDepth);
    s.wallMat.uniforms.uHeat.value = 0.9 + 0.2 * (h / L.height);
    const u = s.wakeMat.uniforms;
    u.uNear.value = h > 0.05 ? foot.near : foot.far;
    u.uFar.value = foot.far;
    u.uFade.value = 1;
    s.wake.visible = true;
    if (!s.wall.visible) return;
    this.spray(s, wx, gy, wz, h, dt);
  }

  /** The crest's spray, the foot's foam, embers and smoke off the wave
   *  (no closure a frame: the wave's frame rides `_spray`). */
  private spray(s: SwellSlot, wx: number, gy: number, wz: number, h: number, dt: number): void {
    const sin = Math.sin(s.facing);
    const cos = Math.cos(s.facing);
    FWD[0] = sin;
    FWD[1] = 0.55;
    FWD[2] = cos;
    _spray.x = wx;
    _spray.y = gy;
    _spray.z = wz;
    _spray.sin = sin;
    _spray.cos = cos;
    _spray.half = s.half;
    _spray.k = dt * this.host.density;
    // Two tries a frame at the high rates.
    for (let k = 0; k < 2; k++) {
      this.emit(40, T.waveDepth * 0.15, h * 0.72, DROP);
      this.emit(14, T.waveDepth * 0.1, h * 0.7, BLOB);
      this.emit(24, 0.1, 0.25, FOAM);
      this.emit(20, T.waveDepth * 0.3, h * 0.92, CREST);
    }
    this.emit(14, T.waveDepth * 0.3, h * 0.95, EMBER);
    this.emit(10, T.waveDepth * 0.85, h * 0.45, SMOKE);
  }

  /** One try at `rate` a second: a puff `back` yards behind the front, `up`
   *  over the floor, somewhere across the wave (its frame in `_spray`). */
  private emit(rate: number, back: number, up: number, o: Puff): void {
    const host = this.host;
    if (host.rand() >= _spray.k * rate) return;
    const side = (host.rand() - 0.5) * 2 * _spray.half * 0.85;
    host.particles.puff(
      _spray.x - _spray.sin * back + _spray.cos * side,
      _spray.y + up,
      _spray.z - _spray.cos * back - _spray.sin * side,
      1,
      o,
    );
  }

  /** Lane `i` gone (its wave spent): the wall drops, the trail fades. */
  release(i: number): void {
    const s = this.slots[i];
    if (!s.live) return;
    s.live = false;
    s.wall.visible = false;
    if (s.rolled) {
      s.goneAt = this.clock;
      // The box cools into the trail with the rest.
      s.wakeMat.uniforms.uNear.value = s.wakeMat.uniforms.uFar.value;
    } else {
      s.wake.visible = false;
    }
  }

  /** The spent trails fading (every frame). */
  update(): void {
    for (const s of this.slots) {
      if (s.live || s.goneAt < -50) continue;
      const f = swellTrailFade(this.clock - s.goneAt);
      s.wakeMat.uniforms.uFade.value = f;
      if (f <= 0.01) {
        s.goneAt = -99;
        s.wake.visible = false;
      }
    }
  }

  /** The swells break out at (x, z): the ground heaves (once per fist). */
  origin(x: number, z: number): void {
    if (this.clock - this.lastOrigin < 0.3) return;
    this.lastOrigin = this.clock;
    const host = this.host;
    const y = host.groundY(x, z);
    host.particles.shockRing(x, z, C.ringGold, 9, 0.8);
    host.particles.puff(x, y + 0.5, z, 18, {
      speed: 7,
      up: 6,
      life: 1.1,
      size: [0.75, 0.5],
      color: C.crust,
      alpha: 1,
      gravity: 20,
      radius: 2.5,
    });
    host.particles.puff(x, y + 0.4, z, 22, {
      speed: 6,
      up: 7,
      life: 0.9,
      size: [0.5, 0.12],
      color: C.spark,
      alpha: 1,
      pool: 'glow',
      gravity: 16,
      radius: 2,
    });
    host.particles.puff(x, y + 0.8, z, 10, { ...SMOKE, radius: 3 });
    host.shakeNear(x, z, L.originShake, 60);
  }

  hide(): void {
    for (const s of this.slots) {
      s.live = false;
      s.goneAt = -99;
      s.wall.visible = false;
      s.wake.visible = false;
    }
  }
}
