// QuenchWakeThrow, a part of QuenchBody (quench_body.ts): the Blades Wake's
// throw-down on the Guardian of the Quench (plan: quench_wake_core.ts). As her
// arms come down and the four blades tear free:
//  - a frost shockwave races out over the lake, a deep blue band under a
//    bright cyan crest (dark on the white ice: an additive ring alone was lost
//    on it), ice spikes erupting all round her behind its front;
//  - a line races over the ice from her feet to each blade: a bright cyan
//    core in a deep blue edge, jagged like a crack, its head white-hot, ice
//    spikes standing along it and frost crystals sprouting as its head
//    passes; each blade flares as its line arrives.
// Cosmetic (the blades' own warnings are the fight painters', on every tier):
// the low tier keeps the lines, the wave and the flares, and sheds the
// crystals and half the spikes.
//
// Rules (src/render/CLAUDE.md): every geometry and material built in the
// constructor under the owner's gated root (the spikes' program is its own,
// linked by the owner's compile gate with the rest); fixed pools; no
// per-frame allocation; no light. Ground heights are read once per throw.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { quenchSpikeGeometry } from './quench_spike_geometry';
import {
  QUENCH_WAKE_COLORS as C,
  QUENCH_WAKE_THROW_SECONDS,
  quenchWakeCrystal,
  quenchWakeFlare,
  quenchWakeFrontAt,
  quenchWakeHeadAt,
  quenchWakeLine,
  quenchWakeLineSpikes,
  quenchWakeRingSpikes,
  quenchWakeSpikeDone,
  quenchWakeSpikeRise,
  quenchWakeWave,
  QUENCH_WAKE_THROW as T,
  type WakeSpike,
} from './quench_wake_core';

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const LINE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A line racing over the ice: jagged like a crack, a deep blue edge, a
 *  bright cyan core, a white-hot head; frost feathering off it behind. */
const LINE_FRAG = /* glsl */ `
uniform float uHead;
uniform float uAlpha;
uniform float uGlow;
uniform float uLen;
uniform float uSeed;
uniform vec3 uDeep;
uniform vec3 uCore;
uniform vec3 uHot;
varying vec2 vUv;
${NOISE}
void main() {
  float yd = vUv.x * uLen;
  // The crack's wander across its strip.
  float wander = (vnoise(vec2(yd * 0.45, uSeed)) - 0.5) * 0.34 + (vnoise(vec2(yd * 1.7, uSeed + 3.0)) - 0.5) * 0.12;
  float across = abs((vUv.y - 0.5 - wander) * 2.0);
  float core = 1.0 - smoothstep(0.08, 0.3, across);
  float edge = 1.0 - smoothstep(0.42, 0.62, across);
  float feather = vnoise(vec2(yd * 2.2, vUv.y * 9.0 + uSeed)) * (1.0 - smoothstep(0.55, 1.0, across));
  float ahead = (vUv.x - uHead) * uLen;
  float behind = 1.0 - smoothstep(-0.2, 0.3, ahead);
  float head = exp(-abs(ahead) * 0.9) * uGlow;
  float a = uAlpha * (behind * max(edge * 0.88, feather * 0.35) + head * edge);
  vec3 col = mix(uDeep, uCore, clamp(core * 1.1 + head * 0.6, 0.0, 1.0));
  col = mix(col, uHot, clamp(head * core * 1.4, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
}
`;

const WAVE_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The throw's frost shockwave over the lake (unit disc scaled to its
 *  reach): a deep blue band, a bright crest at the front, rime in its wake. */
const WAVE_FRAG = /* glsl */ `
uniform float uFront;
uniform float uAlpha;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uCore;
uniform vec3 uHot;
varying vec2 vLocal;
${NOISE}
void main() {
  float r = length(vLocal);
  float ang = atan(vLocal.y, vLocal.x);
  float torn = (vnoise(vec2(ang * 7.0, uTime * 2.0)) - 0.5) * 0.03;
  float d = uFront + torn - r;
  float cd = d * 40.0;
  float crest = exp(-cd * cd) * step(-0.05, d);
  float band = smoothstep(-0.01, 0.02, d) * (1.0 - smoothstep(0.03, 0.12, d));
  float wake = smoothstep(0.0, 0.05, d) * (1.0 - smoothstep(0.05, 0.4, d))
    * vnoise(vec2(ang * 22.0, r * 30.0)) * 0.6;
  float a = uAlpha * clamp(band * 0.8 + crest + wake, 0.0, 1.0) * (1.0 - smoothstep(0.96, 1.0, r));
  vec3 col = mix(uDeep, uCore, clamp(crest * 1.3 + wake * 0.4, 0.0, 1.0));
  col = mix(col, uHot, crest * 0.4);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
}
`;

const SPIKE_VERT = /* glsl */ `
varying float vUp;
varying vec3 vN;
varying vec3 vView;
void main() {
  vUp = position.y;
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
  local = instanceMatrix * local;
  n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * local;
  vN = normalize(normalMatrix * n);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
/** The spikes and crystals: deep lake blue at the root to a cold white tip,
 *  lit by a fixed cold key, a cyan rim: opaque, they stand dark-rooted and
 *  bright-tipped on the white ice. */
const SPIKE_FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uHot;
uniform vec3 uCore;
varying float vUp;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 n = normalize(vN);
  float key = clamp(dot(n, normalize(vec3(0.4, 0.8, 0.45))), 0.0, 1.0);
  float rim = pow(1.0 - clamp(abs(dot(n, vView)), 0.0, 1.0), 2.5);
  vec3 col = mix(uDeep, uMid, smoothstep(0.0, 0.55, vUp));
  col = mix(col, uHot, smoothstep(0.55, 1.0, vUp));
  col *= 0.55 + 0.6 * key;
  col += uCore * rim * 0.7;
  gl_FragColor = vec4(col, 1.0);
}
`;

const color = (c: readonly [number, number, number]) => new THREE.Color(c[0], c[1], c[2]);

/** One live spike: where it stands (world), its ground, and when the front
 *  reaches it. */
interface Live {
  x: number;
  y: number;
  z: number;
  at: number;
  h: number;
  lean: number;
  yaw: number;
  /** Bearing out from her (the lean's direction). */
  out: number;
  crystal: boolean;
  shattered: boolean;
}

const _lineLook = { head: 0, alpha: 0, glow: 0 };
const _wave = { radius: 0, alpha: 0 };
const _lineSpikes = Array.from({ length: T.lineSpikes }, () => ({
  r: 0,
  side: 0,
  h: 0,
  lean: 0,
  yaw: 0,
}));

export class QuenchWakeThrow {
  private readonly lines: THREE.Mesh[] = [];
  private readonly lineMats: THREE.ShaderMaterial[] = [];
  private readonly wave: THREE.Mesh;
  private readonly waveMat: THREE.ShaderMaterial;
  private readonly spikes: THREE.InstancedMesh;
  private readonly flares: THREE.Sprite[] = [];
  private readonly flareMat: THREE.SpriteMaterial[] = [];
  private readonly ring: WakeSpike[];
  private readonly live: Live[];
  private liveCount = 0;
  private readonly bladeAt = new Float32Array(8);
  private readonly lineLen = new Float32Array(4);
  private readonly bladeY = new Float32Array(4);
  private bladeCount = 0;
  private burst = false;
  private born = -99;
  private x = 0;
  private y = 0;
  private z = 0;
  private reach = 18;
  private active = false;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(
    parent: THREE.Object3D,
    uTime: { value: number },
    private readonly particles: EngineParticles,
    private readonly groundY: (x: number, z: number) => number,
    private readonly lineCount: number,
    private readonly low: boolean,
    glowTex: THREE.Texture | null,
    materials: THREE.Material[],
    geometries: THREE.BufferGeometry[],
  ) {
    // The lines: a unit strip along +x, stretched and turned when drawn.
    const lineGeo = new THREE.PlaneGeometry(1, 1, 24, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    geometries.push(lineGeo);
    for (let i = 0; i < lineCount; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartQuenchWakeLine',
        uniforms: {
          uHead: { value: 0 },
          uAlpha: { value: 0 },
          uGlow: { value: 0 },
          uLen: { value: 1 },
          uSeed: { value: i * 7.31 },
          uDeep: { value: color(C.deep) },
          uCore: { value: color(C.core) },
          uHot: { value: color(C.hot) },
        },
        vertexShader: LINE_VERT,
        fragmentShader: LINE_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
        fog: false,
      });
      materials.push(mat);
      const m = new THREE.Mesh(lineGeo, mat);
      m.name = 'smithHeartQuenchWakeLine';
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = floorVfxRenderOrder('encounter', 6);
      parent.add(m);
      this.lines.push(m);
      this.lineMats.push(mat);
    }
    // The shockwave.
    const waveGeo = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2);
    geometries.push(waveGeo);
    this.waveMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchWakeWave',
      uniforms: {
        uFront: { value: 0 },
        uAlpha: { value: 0 },
        uTime,
        uDeep: { value: color(C.deep) },
        uCore: { value: color(C.core) },
        uHot: { value: color(C.hot) },
      },
      vertexShader: WAVE_VERT,
      fragmentShader: WAVE_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: false,
    });
    materials.push(this.waveMat);
    this.wave = new THREE.Mesh(waveGeo, this.waveMat);
    this.wave.name = 'smithHeartQuenchWakeWave';
    this.wave.frustumCulled = false;
    this.wave.visible = false;
    this.wave.renderOrder = floorVfxRenderOrder('encounter', 5);
    parent.add(this.wave);
    // The spikes and the crystals: one instanced draw.
    this.ring = quenchWakeRingSpikes(0x5a1e);
    const ringN = this.low ? Math.ceil(this.ring.length / 2) : this.ring.length;
    const crystals = this.low ? 0 : T.crystalsPerLine * lineCount;
    const cap = ringN + T.lineSpikes * lineCount + crystals;
    this.live = Array.from({ length: cap }, () => ({
      x: 0,
      y: 0,
      z: 0,
      at: 0,
      h: 0,
      lean: 0,
      yaw: 0,
      out: 0,
      crystal: false,
      shattered: false,
    }));
    const spikeGeo = quenchSpikeGeometry();
    geometries.push(spikeGeo);
    const spikeMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchWakeSpike',
      uniforms: {
        uDeep: { value: color(C.deep) },
        uMid: { value: color(C.mid) },
        uHot: { value: color(C.hot) },
        uCore: { value: color(C.core) },
      },
      vertexShader: SPIKE_VERT,
      fragmentShader: SPIKE_FRAG,
      fog: false,
    });
    materials.push(spikeMat);
    this.spikes = new THREE.InstancedMesh(spikeGeo, spikeMat, cap);
    this.spikes.name = 'smithHeartQuenchWakeSpikes';
    this.spikes.frustumCulled = false;
    this.spikes.visible = false;
    this.spikes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let k = 0; k < cap; k++) this.spikes.setMatrixAt(k, this.m.makeScale(0, 0, 0));
    parent.add(this.spikes);
    // The blades' flares.
    for (let i = 0; i < lineCount; i++) {
      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(C.core[0], C.core[1], C.core[2]),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        name: 'smithHeartQuenchWakeFlare',
      });
      materials.push(mat);
      const s = new THREE.Sprite(mat);
      s.name = 'smithHeartQuenchWakeFlare';
      s.visible = false;
      parent.add(s);
      this.flares.push(s);
      this.flareMat.push(mat);
    }
  }

  /** Her arms come down at (x, z): the throw out to the `count` blades in
   *  `blades` (x, z pairs), from render time `clock`. */
  begin(x: number, z: number, blades: Float32Array, count: number, clock: number): void {
    this.x = x;
    this.z = z;
    this.y = this.groundY(x, z);
    this.born = clock;
    this.active = true;
    this.burst = false;
    this.bladeCount = Math.min(count, this.lineCount);
    let reach = 18;
    for (let i = 0; i < this.bladeCount; i++) {
      this.bladeAt[i * 2] = blades[i * 2];
      this.bladeAt[i * 2 + 1] = blades[i * 2 + 1];
      const len = Math.hypot(blades[i * 2] - x, blades[i * 2 + 1] - z);
      this.lineLen[i] = len;
      this.bladeY[i] = this.groundY(blades[i * 2], blades[i * 2 + 1]);
      reach = Math.max(reach, len + 3);
    }
    this.reach = reach;
    // Lay the spikes out once (ground read here, never a frame).
    let n = 0;
    const ringN = this.low ? Math.ceil(this.ring.length / 2) : this.ring.length;
    for (let i = 0; i < ringN; i++) {
      const sp = this.ring[this.low ? i * 2 : i];
      if (!sp) break;
      const wx = x + Math.sin(sp.a) * sp.r;
      const wz = z + Math.cos(sp.a) * sp.r;
      n = this.lay(n, wx, wz, quenchWakeFrontAt(sp.r), sp.h, sp.lean, sp.yaw, sp.a, false);
    }
    for (let b = 0; b < this.bladeCount; b++) {
      const bx = this.bladeAt[b * 2];
      const bz = this.bladeAt[b * 2 + 1];
      const len = this.lineLen[b];
      if (len < 1) continue;
      const dx = (bx - x) / len;
      const dz = (bz - z) / len;
      const out = Math.atan2(dx, dz);
      const k = quenchWakeLineSpikes(len, 0x71 + b * 13, _lineSpikes);
      for (let i = 0; i < k; i++) {
        const o = _lineSpikes[i];
        const wx = x + dx * o.r + dz * o.side;
        const wz = z + dz * o.r - dx * o.side;
        const at = quenchWakeHeadAt(o.r / len);
        n = this.lay(n, wx, wz, at, o.h, o.lean, o.yaw, out, false);
      }
      if (this.low) continue;
      for (let i = 0; i < T.crystalsPerLine; i++) {
        const r = 3 + i * T.crystalStep;
        if (r > len - 1.5) break;
        const side = ((i * 37) % 7) / 7 - 0.5;
        const wx = x + dx * r + dz * side;
        const wz = z + dz * r - dx * side;
        const at = quenchWakeHeadAt(r / len);
        n = this.lay(n, wx, wz, at, 0.6 + ((i * 53) % 5) * 0.14, 0.5, i * 1.7, out, true);
      }
    }
    this.liveCount = n;
    for (let k = n; k < this.live.length; k++)
      this.spikes.setMatrixAt(k, this.m.makeScale(0, 0, 0));
    this.spikes.visible = n > 0;
    this.wave.position.set(x, this.y + 0.1, z);
    this.wave.scale.setScalar(reach);
    this.wave.visible = true;
  }

  private lay(
    n: number,
    x: number,
    z: number,
    at: number,
    h: number,
    lean: number,
    yaw: number,
    out: number,
    crystal: boolean,
  ): number {
    if (n >= this.live.length) return n;
    const l = this.live[n];
    l.x = x;
    l.z = z;
    l.y = this.groundY(x, z);
    l.at = at;
    l.h = h;
    l.lean = lean;
    l.yaw = yaw;
    l.out = out;
    l.crystal = crystal;
    l.shattered = false;
    return n + 1;
  }

  update(clock: number): void {
    if (!this.active) return;
    const age = clock - this.born;
    if (age > QUENCH_WAKE_THROW_SECONDS + 0.2) {
      this.hide();
      return;
    }
    // The lines.
    const line = quenchWakeLine(age, _lineLook);
    for (let i = 0; i < this.lines.length; i++) {
      const m = this.lines[i];
      if (i >= this.bladeCount || line.alpha <= 0.01) {
        m.visible = false;
        continue;
      }
      const bx = this.bladeAt[i * 2];
      const bz = this.bladeAt[i * 2 + 1];
      const len = this.lineLen[i];
      m.visible = true;
      m.position.set(this.x, this.y + 0.08, this.z);
      m.rotation.set(0, -Math.atan2(bz - this.z, bx - this.x), 0);
      m.scale.set(len, 1, T.lineWidth);
      const u = this.lineMats[i].uniforms;
      u.uHead.value = line.head;
      u.uAlpha.value = line.alpha;
      u.uGlow.value = line.glow;
      u.uLen.value = len;
      // The blade flares as its line arrives.
      const f = quenchWakeFlare(age);
      const s = this.flares[i];
      s.visible = f > 0.01;
      if (s.visible) {
        s.position.set(bx, this.bladeY[i] + 3.2, bz);
        s.scale.setScalar(T.flareSize * (0.6 + 0.4 * f));
        this.flareMat[i].opacity = Math.min(0.9, f);
      }
      if (!this.burst && age >= T.lineRun) this.bladeBurst(bx, this.bladeY[i], bz);
    }
    if (age >= T.lineRun) this.burst = true;
    // The wave.
    const w = quenchWakeWave(age, this.reach, _wave);
    this.wave.visible = w.alpha > 0.01;
    this.waveMat.uniforms.uFront.value = w.radius / this.reach;
    this.waveMat.uniforms.uAlpha.value = w.alpha;
    // The spikes and the crystals.
    for (let k = 0; k < this.liveCount; k++) {
      const l = this.live[k];
      const rise = l.crystal ? quenchWakeCrystal(age, l.at) : quenchWakeSpikeRise(age, l.at);
      if (rise <= 0.001) {
        this.spikes.setMatrixAt(k, this.m.makeScale(0, 0, 0));
        if (!l.crystal && !l.shattered && quenchWakeSpikeDone(age, l.at)) {
          l.shattered = true;
          this.shatter(l);
        }
        continue;
      }
      this.v.set(l.x, l.y - 0.15, l.z);
      this.e.set(l.lean, l.out, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      const h = l.h * (0.15 + 0.85 * rise);
      const w0 = l.crystal ? 0.9 : 1.3 + l.h * 0.22;
      this.s.set(w0, h, w0);
      this.spikes.setMatrixAt(k, this.m.compose(this.v, this.q, this.s));
    }
    this.spikes.instanceMatrix.needsUpdate = true;
  }

  /** A sunk spike breaks into shards and a puff of frost. */
  private shatter(l: Live): void {
    this.particles.puff(l.x, l.y + l.h * 0.5, l.z, 5, {
      speed: 4,
      up: 3,
      life: 0.8,
      size: [0.4, 0.1],
      color: C.core,
      alpha: 1,
      pool: 'glow',
      gravity: 12,
      drag: 0.4,
      floor: l.y + 0.05,
    });
  }

  /** A blade's own burst as its line arrives. */
  private bladeBurst(x: number, y: number, z: number): void {
    this.particles.puff(x, y + 1.2, z, 18, {
      speed: 7,
      up: 5,
      life: 1,
      size: [0.5, 0.12],
      color: C.core,
      alpha: 1,
      pool: 'glow',
      gravity: 10,
      drag: 0.4,
      floor: y + 0.05,
    });
    this.particles.puff(x, y + 0.6, z, 6, {
      speed: 3,
      up: 1,
      life: 1.3,
      size: [1.4, 3.8],
      color: C.mid,
      alpha: 0.32,
      drag: 1,
      radius: 1.2,
      floor: y + 0.1,
    });
  }

  hide(): void {
    this.active = false;
    for (const m of this.lines) m.visible = false;
    for (const s of this.flares) s.visible = false;
    this.wave.visible = false;
    this.spikes.visible = false;
  }

  /** Free the instanced draw's own per-instance buffer (its geometry and
   *  material are the owner's arrays). */
  dispose(): void {
    this.spikes.dispose();
  }

  /** Is the throw still playing? */
  get playing(): boolean {
    return this.active;
  }
}
