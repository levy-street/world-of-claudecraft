// The Rite of the Unquiet round Morthen at the altar (host: morthen_rite_fx.ts;
// plan: morthen_rite_fx_core.ts), read off his auras and cast bar and the
// candles' encounter objects:
//  - the Unquiet Ward: a dome of soul-green light over the altar, a lattice of
//    runes turning in it, bright at its rim, that CRACKS with every candle
//    relit (value2 counts them; each crack opens on the side facing its
//    candle, holy gold light leaking through), flickering as it fails;
//  - the Rite's swirl while he channels: souls spiralling up inside the dome,
//    ghost fire licking round its foot, the rune circle turning on the floor;
//  - the fourth candle: the ward explodes (a flash of holy light, shards of
//    the dome flung out, gold shockwaves);
//  - the Rite Broken: bands of holy light bind him, his soul fire gutters
//    (morthen_fx.ts) and dazed gold motes circle his mitre; the Shattered
//    Ward: a gold glow of exposure round him for the damage window;
//  - Grave Chill: a light cold mist hugging the ring floor through the Rite,
//    drawn UNDER every telegraph rung so it never hides one.
//
// The ward (immune), the bands (stunned) and the exposure (vulnerable) are
// states a player reads: every tier. The swirl, mist, shards and motes are
// cosmetic and thin on the low tier.

import * as THREE from 'three';
import { RITE_RING } from '../../sim/encounters/hollow_crypt/ids';
import {
  MORTHEN_RITE,
  MORTHEN_RITE_BROKEN,
  MORTHEN_SHATTERED,
  MORTHEN_UNQUIET_WARD,
  MORTHEN_WARD_SHATTERS,
  RITE_CANDLE_LIT,
} from '../../sim/encounters/hollow_crypt/morthen_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { cryptSlotOrigin } from './crypt_boss_fx_core';
import {
  MORTHEN_MITRE_EYE,
  MORTHEN_RIBS,
  morthenAnchor,
  morthenBodyY,
  morthenDrawScale,
} from './morthen_fx_core';
import {
  brokenBind,
  candleIndexAt,
  chillMist,
  crackGrowth,
  WARD_HEIGHT,
  WARD_RADIUS,
  wardIntegrity,
  wardShards,
} from './morthen_rite_fx_core';
import {
  RITE_MESH_VERT,
  type RiteFxHost,
  type RiteGlowMesh,
  type RitePainter,
} from './morthen_rite_host';

const SHARDS = 56;
const SHARD_PLAN = wardShards(SHARDS);
const SHATTER_SEC = 1.8;
const FLASH_SEC = 0.28;
const BANDS = 3;

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1 + 7.3) * 0.3 + vnoise(p * 4.3 - 3.1) * 0.15; }
`;

const WARD_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vView;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

/** The ward: soul light bright at its rim, a lattice of runes turning in it,
 *  and per relit candle a crack network opening on that candle's side,
 *  leaking holy gold light; the whole dome flickers as it fails. */
const WARD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uIntegrity;
uniform float uFlash;
uniform vec4 uCrack;
uniform vec4 uCrackAz;
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vView;
${NOISE}
float crackAt(float g, float az0, float az, float h, float seed) {
  if (g <= 0.0) return 0.0;
  float d = abs(atan(sin(az - az0), cos(az - az0)));
  float dist = length(vec2(d * 1.1, (h - 0.18) * 1.6));
  float reach = g * 1.35;
  float mask = 1.0 - smoothstep(reach * 0.65, reach, dist);
  float n1 = fbm(vec2(az * 5.0 + seed, h * 6.5));
  float n2 = fbm(vec2(az * 11.0 - seed, h * 13.0 + 2.0));
  float lines = max(1.0 - smoothstep(0.0, 0.03, abs(n1 - 0.5)), 0.7 * (1.0 - smoothstep(0.0, 0.025, abs(n2 - 0.5))));
  float heart = (1.0 - smoothstep(0.0, 0.25 * g, dist)) * 0.6;
  return max(lines * mask, heart);
}
void main() {
  vec3 p = normalize(vLocal);
  float facing = abs(dot(normalize(vN), normalize(vView)));
  float rim = pow(clamp(1.0 - facing, 0.0, 1.0), 2.2);
  float az = atan(p.x, p.z);
  float h = clamp(vLocal.y, 0.0, 1.0);
  float ribs = smoothstep(0.9, 1.0, abs(sin(az * 8.0 + uTime * 0.35)));
  float rings = smoothstep(0.93, 1.0, abs(sin(h * 15.0 - uTime * 0.9)));
  float glyph = step(0.62, vnoise(vec2(az * 9.0 + uTime * 0.2, h * 11.0)));
  float runes = (ribs * 0.5 + rings * 0.5) * (0.35 + 0.65 * glyph);
  float flick = 1.0 - (1.0 - uIntegrity) * 0.45 * step(0.55, vnoise(vec2(uTime * 11.0, h * 3.0)));
  float base = (0.06 + rim * 0.85 + runes * 0.4) * flick * (0.45 + 0.55 * uIntegrity);
  float crack = crackAt(uCrack.x, uCrackAz.x, az, h, 0.0);
  crack = max(crack, crackAt(uCrack.y, uCrackAz.y, az, h, 13.1));
  crack = max(crack, crackAt(uCrack.z, uCrackAz.z, az, h, 27.7));
  crack = max(crack, crackAt(uCrack.w, uCrackAz.w, az, h, 41.3));
  vec3 soul = vec3(0.42, 1.0, 0.55);
  vec3 col = soul * base + vec3(1.4, 1.2, 0.7) * crack * 1.5 + vec3(1.2, 1.15, 0.95) * uFlash;
  float foot = smoothstep(0.0, 0.05, h);
  float a = (base + crack * 0.9 + uFlash * 0.9) * foot * uAlpha;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

/** The Rite's rune circle turning on the floor round the dome's foot. */
const RUNE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vLocal;
${NOISE}
void main() {
  float r = length(vLocal.xz);
  float az = atan(vLocal.x, vLocal.z);
  float band = smoothstep(0.78, 0.82, r) * (1.0 - smoothstep(0.96, 1.0, r));
  float inner = (1.0 - smoothstep(0.0, 0.02, abs(r - 0.74))) * 0.7;
  float runes = step(0.5, vnoise(vec2((az + uTime * 0.25) * 9.0, r * 3.0))) * band;
  float ticks = (1.0 - smoothstep(0.0, 0.05, abs(fract((az + uTime * 0.25) * 3.8197) - 0.5))) * band * 0.6;
  float a = (band * 0.25 + runes * 0.6 + ticks + inner) * uAlpha;
  gl_FragColor = vec4(vec3(0.45, 1.0, 0.55) * 1.2, clamp(a, 0.0, 1.0));
}
`;

/** A band of holy light binding him: runes streaming round it. */
const BAND_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float flow = 0.6 + 0.4 * sin(vUv.x * 60.0 - uTime * 7.0);
  float core = 1.0 - abs(vUv.y - 0.5) * 2.0;
  gl_FragColor = vec4(vec3(1.4, 1.2, 0.7) * (0.8 + 0.6 * flow), clamp(core * flow * uAlpha, 0.0, 1.0));
}
`;

/** The ward's shards: GPU flight from the burst, spinning, fading. */
const SHARD_VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aVel;
attribute vec4 aSpin;
uniform float uTime;
uniform float uBurst;
uniform float uScale;
varying float vT;
varying vec3 vN;
mat3 rot(vec3 axis, float ang) {
  axis = normalize(axis);
  float s = sin(ang), c = cos(ang), oc = 1.0 - c;
  return mat3(oc * axis.x * axis.x + c, oc * axis.x * axis.y + axis.z * s, oc * axis.z * axis.x - axis.y * s,
              oc * axis.x * axis.y - axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z + axis.x * s,
              oc * axis.z * axis.x + axis.y * s, oc * axis.y * axis.z - axis.x * s, oc * axis.z * axis.z + c);
}
${CAMERA_RELATIVE_GLSL}
void main() {
  float t = uTime - uBurst;
  vT = t / ${SHATTER_SEC.toFixed(2)};
  vec3 p = aStart + aVel * (1.0 - exp(-1.2 * t)) / 1.2 + vec3(0.0, -6.0 * t * t, 0.0);
  mat3 R = rot(aSpin.xyz + vec3(0.01), aSpin.w * t);
  vN = R * vec3(0.0, 0.0, 1.0);
  vec3 w = p + R * (position * uScale);
  gl_Position = (t >= 0.0 && vT < 1.0) ? projectionMatrix * wocCamRelView(w) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const SHARD_FRAG = /* glsl */ `
varying float vT;
varying vec3 vN;
void main() {
  float fade = 1.0 - smoothstep(0.45, 1.0, vT);
  float glint = 0.5 + 0.5 * abs(vN.y);
  vec3 col = mix(vec3(0.5, 1.0, 0.6), vec3(1.3, 1.15, 0.75), 1.0 - fade * 0.6) * (0.7 + 0.8 * glint);
  gl_FragColor = vec4(col, fade * 0.85);
}
`;

interface CrackSlot {
  /** When this candle was seen lit (-1: dark). */
  litAt: number;
  az: number;
}

export class MorthenWardFx implements RitePainter {
  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly rune: THREE.Mesh;
  private readonly runeMat: THREE.ShaderMaterial;
  private readonly bands: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  private readonly shards: THREE.InstancedMesh;
  private readonly shardMat: THREE.ShaderMaterial;
  private readonly exposure: RiteGlowMesh;
  private readonly exposureColumn: RiteGlowMesh;
  private readonly cracks: CrackSlot[] = [0, 1, 2, 3].map(() => ({ litAt: -1, az: 0 }));
  private flashAt = -1e6;
  private hadWard = false;
  private shatterX = 0;
  private shatterY = 0;
  private shatterZ = 0;

  constructor(private readonly h: RiteFxHost) {
    const domeGeo = h.own(new THREE.SphereGeometry(1, 56, 22, 0, Math.PI * 2, 0, Math.PI / 2));
    this.domeMat = h.own(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: h.uTime,
          uAlpha: { value: 0 },
          uIntegrity: { value: 1 },
          uFlash: { value: 0 },
          uCrack: { value: new THREE.Vector4() },
          uCrackAz: { value: new THREE.Vector4() },
        },
        vertexShader: WARD_VERT,
        fragmentShader: WARD_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.dome = new THREE.Mesh(domeGeo, this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.visible = false;
    this.dome.renderOrder = floorVfxRenderOrder('encounter', 24);
    h.root.add(this.dome);

    const runeGeo = h.own(new THREE.CircleGeometry(1, 96));
    runeGeo.rotateX(-Math.PI / 2);
    this.runeMat = h.own(
      new THREE.ShaderMaterial({
        uniforms: { uTime: h.uTime, uAlpha: { value: 0 } },
        vertexShader: RITE_MESH_VERT,
        fragmentShader: RUNE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.rune = new THREE.Mesh(runeGeo, this.runeMat);
    this.rune.frustumCulled = false;
    this.rune.visible = false;
    this.rune.renderOrder = floorVfxRenderOrder('encounter', 3);
    h.root.add(this.rune);

    const bandGeo = h.own(new THREE.TorusGeometry(1, 0.05, 6, 72));
    bandGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < BANDS; i++) {
      const mat = h.own(
        new THREE.ShaderMaterial({
          uniforms: { uTime: h.uTime, uAlpha: { value: 0 } },
          vertexShader: RITE_MESH_VERT,
          fragmentShader: BAND_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const mesh = new THREE.Mesh(bandGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 28);
      h.root.add(mesh);
      this.bands.push({ mesh, mat });
    }

    // The shards: thin triangular plates of the dome, flung on the GPU.
    const plate = new THREE.BufferGeometry();
    plate.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, -0.45, 0, 0.55, -0.3, 0, -0.05, 0.6, 0], 3),
    );
    const inst = h.own(new THREE.InstancedBufferGeometry());
    inst.setAttribute('position', plate.getAttribute('position'));
    plate.dispose();
    const start = new Float32Array(SHARDS * 3);
    const vel = new Float32Array(SHARDS * 3);
    const spin = new Float32Array(SHARDS * 4);
    SHARD_PLAN.forEach((s, i) => {
      vel.set([s.x * s.speed, s.y * s.speed * 0.6 + 3, s.z * s.speed], i * 3);
      spin.set([s.z, 0.4 + s.y, -s.x, s.spin], i * 4);
    });
    inst.setAttribute('aStart', new THREE.InstancedBufferAttribute(start, 3));
    inst.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3));
    inst.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4));
    inst.instanceCount = SHARDS;
    this.shardMat = h.own(
      new THREE.ShaderMaterial({
        uniforms: { uTime: h.uTime, uBurst: { value: -1e6 }, uScale: { value: 1.6 } },
        vertexShader: SHARD_VERT,
        fragmentShader: SHARD_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.shards = new THREE.InstancedMesh(inst, this.shardMat, SHARDS);
    this.shards.frustumCulled = false;
    this.shards.visible = false;
    this.shards.renderOrder = floorVfxRenderOrder('encounter', 28);
    h.root.add(this.shards);

    this.exposure = h.halo(0xffcf6a, 29);
    this.exposureColumn = h.column(0xffd88a, 23);
  }

  // ------------------------------------------------------------------ events

  handleEvent(ev: SimEvent, world: IWorld): void {
    if (ev.type !== 'spellfx' || ev.ability !== MORTHEN_WARD_SHATTERS) return;
    const m = world.entities.get(ev.sourceId);
    if (m) this.shatter(m);
  }

  /** The fourth candle: the ward explodes in holy light. */
  private shatter(m: Entity): void {
    const h = this.h;
    const gy = h.groundY(m.pos.x, m.pos.z);
    const s = morthenDrawScale(m.scale);
    this.flashAt = h.clock();
    this.shatterX = m.pos.x;
    this.shatterY = gy;
    this.shatterZ = m.pos.z;
    // The shards start on the dome's skin, where the plan put them.
    const inst = this.shards.geometry as THREE.InstancedBufferGeometry;
    const start = inst.getAttribute('aStart') as THREE.InstancedBufferAttribute;
    SHARD_PLAN.forEach((p, i) => {
      start.setXYZ(
        i,
        m.pos.x + p.x * WARD_RADIUS,
        gy + p.y * WARD_HEIGHT,
        m.pos.z + p.z * WARD_RADIUS,
      );
    });
    start.needsUpdate = true;
    this.shardMat.uniforms.uBurst.value = h.clock();
    this.shards.visible = true;
    const ribsY = morthenBodyY(m.pos.y, MORTHEN_RIBS.y, s);
    h.flash(m.pos.x, ribsY, m.pos.z, 24, 0.7, 0xfff0c0);
    h.flash(m.pos.x, ribsY, m.pos.z, 10, 0.35, 0xffffff);
    h.wave(m.pos.x, m.pos.z, 18, 0.7, 0xffe7a0, 0.2);
    h.wave(m.pos.x, m.pos.z, 10, 0.45, 0xffffff, 0.3);
    const n = Math.round(200 * h.density);
    for (let i = 0; i < n; i++) {
      const a = h.rand() * Math.PI * 2;
      const el = h.rand() * 1.2;
      const sp = 8 + h.rand() * 10;
      {
        const ps = h.ps();
        ps.x = m.pos.x;
        ps.y = ribsY;
        ps.z = m.pos.z;
        ps.vx = Math.sin(a) * Math.cos(el) * sp;
        ps.vy = Math.sin(el) * sp * 0.8;
        ps.vz = Math.cos(a) * Math.cos(el) * sp;
        ps.ay = -2;
        ps.life = 0.9 + h.rand() * 0.8;
        ps.drag = 1.3;
        ps.size0 = 0.4;
        ps.size1 = 0.08;
        ps.r = 1;
        ps.g = 0.86 + h.rand() * 0.14;
        ps.b = 0.5;
        ps.a = 1;
        h.glow.emit(h.clock() + h.rand() * 0.05, ps);
      }
    }
    const d = Math.round(70 * h.density);
    for (let i = 0; i < d; i++) {
      const a = (i / d) * Math.PI * 2;
      const sp = 10 + h.rand() * 5;
      {
        const ps = h.ps();
        ps.x = m.pos.x + Math.sin(a) * WARD_RADIUS;
        ps.y = gy + 0.4;
        ps.z = m.pos.z + Math.cos(a) * WARD_RADIUS;
        ps.vx = Math.sin(a) * sp;
        ps.vy = 0.6 + h.rand();
        ps.vz = Math.cos(a) * sp;
        ps.life = 1.2 + h.rand() * 0.5;
        ps.drag = 1.8;
        ps.floor = gy + 0.2;
        ps.size0 = 1.5;
        ps.size1 = 4;
        ps.r = 0.4;
        ps.g = 0.42;
        ps.b = 0.36;
        ps.a = 0.4;
        h.dust.emit(h.clock(), ps);
      }
    }
    h.shakeAt(m.pos.x, m.pos.z, 0.75);
  }

  // ------------------------------------------------------------------- frame

  update(world: IWorld, dt: number): void {
    const h = this.h;
    const now = h.clock();
    const m = h.scan.morthenId >= 0 ? world.entities.get(h.scan.morthenId) : undefined;
    let ward: { value2?: number } | undefined;
    let broken: { remaining: number; duration: number } | undefined;
    let exposed: { remaining: number; duration: number } | undefined;
    if (m && !m.dead) {
      for (const a of m.auras) {
        if (a.id === MORTHEN_UNQUIET_WARD) ward = a;
        else if (a.id === MORTHEN_RITE_BROKEN) broken = a;
        else if (a.id === MORTHEN_SHATTERED) exposed = a;
      }
    }
    this.stepCracks(world, m, now);
    // The ward gone and the Rite Broken on him: it shattered (a cue that never
    // came, a late joiner's, still gets its burst).
    if (this.hadWard && !ward && broken && now - this.flashAt > 1 && m) this.shatter(m);
    this.hadWard = !!ward;
    const flash = Math.max(0, 1 - (now - this.flashAt) / FLASH_SEC);
    const showDome = (!!m && !!ward) || flash > 0;
    this.dome.visible = showDome;
    if (showDome) {
      const x = m && ward ? m.pos.x : this.shatterX;
      const z = m && ward ? m.pos.z : this.shatterZ;
      const gy = m && ward ? h.groundY(x, z) : this.shatterY;
      this.dome.position.set(x, gy, z);
      // The shatter blows the dome out as it flashes.
      const blow = 1 + (1 - flash) * 0.25 * (flash > 0 ? 1 : 0);
      this.dome.scale.set(WARD_RADIUS * blow, WARD_HEIGHT * blow, WARD_RADIUS * blow);
      const lit = ward?.value2 ?? 4;
      const u = this.domeMat.uniforms;
      u.uIntegrity.value = wardIntegrity(lit);
      u.uFlash.value = flash;
      u.uAlpha.value = ward ? 1 : flash;
      const crack = u.uCrack.value as THREE.Vector4;
      const az = u.uCrackAz.value as THREE.Vector4;
      const c = this.cracks;
      crack.set(
        c[0].litAt >= 0 ? crackGrowth(now - c[0].litAt) : 0,
        c[1].litAt >= 0 ? crackGrowth(now - c[1].litAt) : 0,
        c[2].litAt >= 0 ? crackGrowth(now - c[2].litAt) : 0,
        c[3].litAt >= 0 ? crackGrowth(now - c[3].litAt) : 0,
      );
      az.set(c[0].az, c[1].az, c[2].az, c[3].az);
    }
    if (this.shards.visible && now - this.shardMat.uniforms.uBurst.value > SHATTER_SEC)
      this.shards.visible = false;
    const channelling = !!m && !!ward && m.castingAbility === MORTHEN_RITE;
    this.rune.visible = !!m && !!ward;
    if (m && ward) {
      const gy = h.groundY(m.pos.x, m.pos.z);
      this.rune.position.set(m.pos.x, gy + 0.08, m.pos.z);
      this.rune.scale.setScalar(WARD_RADIUS + 0.9);
      this.runeMat.uniforms.uAlpha.value = channelling ? 0.75 : 0.45;
      if (channelling) this.swirl(m, gy, dt);
    }
    this.stepBroken(m, broken, now);
    this.stepExposed(m, exposed, now, dt);
    this.stepChill(m, dt);
  }

  /** Which candles are lit (each crack opens on its candle's side). */
  private stepCracks(world: IWorld, m: Entity | undefined, now: number): void {
    const h = this.h;
    const seen = [false, false, false, false];
    for (const id of h.scan.candles) {
      const e = world.entities.get(id);
      if (!e) continue;
      const o = cryptSlotOrigin(e.pos.x, e.pos.z);
      const i = candleIndexAt(e.pos.x - o.x, e.pos.z - o.z);
      if (i < 0) continue;
      const lit = e.templateId === RITE_CANDLE_LIT;
      seen[i] = lit;
      const c = this.cracks[i];
      if (lit && c.litAt < 0) c.litAt = now;
      if (m) c.az = Math.atan2(e.pos.x - m.pos.x, e.pos.z - m.pos.z);
    }
    for (let i = 0; i < 4; i++) if (!seen[i]) this.cracks[i].litAt = -1;
  }

  /** The Rite's swirl: souls spiralling up inside the ward, ghost fire round its foot. */
  private swirl(m: Entity, gy: number, dt: number): void {
    const h = this.h;
    const now = h.clock();
    const n = 40 * h.density * dt;
    for (let i = 0; i < Math.floor(n + h.rand()); i++) {
      const a = h.rand() * Math.PI * 2;
      const r = 2 + h.rand() * (WARD_RADIUS - 2.6);
      const tang = a + Math.PI / 2;
      {
        const ps = h.ps();
        ps.x = m.pos.x + Math.sin(a) * r;
        ps.y = gy + 0.3;
        ps.z = m.pos.z + Math.cos(a) * r;
        ps.vx = Math.sin(tang) * 3.2;
        ps.vy = 2.6 + h.rand() * 2.4;
        ps.vz = Math.cos(tang) * 3.2;
        ps.life = 1.6 + h.rand() * 0.8;
        ps.drag = 0.5;
        ps.size0 = 0.32;
        ps.size1 = 0.06;
        ps.r = 0.6;
        ps.g = 1;
        ps.b = 0.55;
        ps.a = 0.9;
        h.glow.emit(now, ps);
      }
      if (i % 2 === 0) {
        const fa = h.rand() * Math.PI * 2;
        {
          const ps = h.ps();
          ps.x = m.pos.x + Math.sin(fa) * WARD_RADIUS * 0.97;
          ps.y = gy + 0.1;
          ps.z = m.pos.z + Math.cos(fa) * WARD_RADIUS * 0.97;
          ps.vx = 0;
          ps.vy = 1.2 + h.rand();
          ps.vz = 0;
          ps.ay = 1;
          ps.life = 0.7 + h.rand() * 0.4;
          ps.drag = 0.8;
          ps.size0 = 0.6;
          ps.size1 = 1.6 + h.rand();
          ps.r = 0.8 + h.rand() * 0.2;
          ps.g = 0;
          ps.b = 0;
          ps.a = 0.75;
          h.fire.emit(now, ps);
        }
      }
    }
  }

  /** The Rite Broken: bands of holy light bind him while the stun holds. */
  private stepBroken(
    m: Entity | undefined,
    broken: { remaining: number; duration: number } | undefined,
    now: number,
  ): void {
    const bind = m && broken ? brokenBind(broken.remaining, broken.duration) : 0;
    for (let i = 0; i < BANDS; i++) {
      const b = this.bands[i];
      b.mesh.visible = bind > 0.001;
      if (!m || !b.mesh.visible) continue;
      const s = morthenDrawScale(m.scale);
      const rigY = 1.9 + i * 1.35;
      const y = morthenBodyY(m.pos.y, rigY, s);
      // Each band snaps tight onto him as the stun lands, turning slowly.
      const r = (1.25 + 0.15 * (1 - i / BANDS)) * s * (1 + (1 - bind) * 0.8);
      b.mesh.position.set(m.pos.x, y, m.pos.z);
      b.mesh.scale.setScalar(r);
      b.mesh.rotation.set(
        0.25 * Math.sin(now * 0.9 + i * 2.1),
        now * (0.6 + i * 0.25),
        0.2 * Math.cos(now * 1.1 + i),
      );
      b.mat.uniforms.uAlpha.value = bind;
    }
    if (!m || bind <= 0.001) return;
    // Dazed gold motes circling his mitre.
    const h = this.h;
    if (h.rand() < 0.6) {
      const s = morthenDrawScale(m.scale);
      const eye = morthenAnchor(m.pos, m.facing, s, MORTHEN_MITRE_EYE);
      const a = now * 3 + h.rand() * 0.4;
      {
        const ps = h.ps();
        ps.x = eye.x + Math.cos(a) * 1.1 * s;
        ps.y = eye.y + 0.6 * s;
        ps.z = eye.z + Math.sin(a) * 1.1 * s;
        ps.vx = -Math.sin(a) * 2;
        ps.vy = 0.1;
        ps.vz = Math.cos(a) * 2;
        ps.life = 0.6;
        ps.drag = 0.3;
        ps.size0 = 0.28;
        ps.size1 = 0.08;
        ps.r = 1;
        ps.g = 0.88;
        ps.b = 0.5;
        ps.a = 1;
        h.glow.emit(now, ps);
      }
    }
  }

  /** The Shattered Ward: a gold glow of exposure round him (the damage window). */
  private stepExposed(
    m: Entity | undefined,
    exposed: { remaining: number; duration: number } | undefined,
    now: number,
    dt: number,
  ): void {
    const on = !!m && !!exposed && exposed.remaining > 0;
    this.exposure.mesh.visible = on;
    this.exposureColumn.mesh.visible = on;
    if (!m || !exposed || !on) return;
    const h = this.h;
    const s = morthenDrawScale(m.scale);
    const k = Math.min(1, exposed.remaining / 0.8) * (0.8 + 0.2 * Math.sin(now * 6));
    const ribsY = morthenBodyY(m.pos.y, MORTHEN_RIBS.y, s);
    this.exposure.mesh.position.set(m.pos.x, ribsY, m.pos.z);
    this.exposure.mesh.scale.setScalar(7 * s);
    this.exposure.mat.uniforms.uAlpha.value = 0.55 * k;
    const gy = h.groundY(m.pos.x, m.pos.z);
    this.exposureColumn.mesh.position.set(m.pos.x, gy, m.pos.z);
    this.exposureColumn.mesh.scale.set(2.4 * s, 16, 2.4 * s);
    this.exposureColumn.mat.uniforms.uAlpha.value = 0.45 * k;
    const n = 30 * h.density * dt;
    for (let i = 0; i < Math.floor(n + h.rand()); i++) {
      const a = h.rand() * Math.PI * 2;
      const r = (0.6 + h.rand() * 1.2) * s;
      {
        const ps = h.ps();
        ps.x = m.pos.x + Math.sin(a) * r;
        ps.y = gy + (0.5 + h.rand() * 5) * s;
        ps.z = m.pos.z + Math.cos(a) * r;
        ps.vx = 0;
        ps.vy = 1.5 + h.rand() * 1.5;
        ps.vz = 0;
        ps.life = 0.9;
        ps.drag = 0.4;
        ps.size0 = 0.22;
        ps.size1 = 0.05;
        ps.r = 1;
        ps.g = 0.82;
        ps.b = 0.42;
        ps.a = 1;
        h.glow.emit(now, ps);
      }
    }
  }

  /** Grave Chill: a light cold mist hugging the ring floor, under every telegraph. */
  private stepChill(m: Entity | undefined, dt: number): void {
    const h = this.h;
    const density = chillMist(h.scan.chill);
    if (density <= 0 || !m) return;
    const o = cryptSlotOrigin(m.pos.x, m.pos.z);
    const cx = o.x + RITE_RING.x;
    const cz = o.z + RITE_RING.z;
    const now = h.clock();
    const n = 34 * density * h.density * dt;
    for (let i = 0; i < Math.floor(n + h.rand()); i++) {
      const a = h.rand() * Math.PI * 2;
      const r = Math.sqrt(h.rand()) * (RITE_RING.r - 1.5);
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      const gy = h.groundY(x, z);
      {
        const ps = h.ps();
        ps.x = x;
        ps.y = gy + 0.25 + h.rand() * 0.5;
        ps.z = z;
        ps.vx = (h.rand() - 0.5) * 0.8;
        ps.vy = 0.08;
        ps.vz = (h.rand() - 0.5) * 0.8;
        ps.life = 3.5 + h.rand() * 1.5;
        ps.drag = 0.3;
        ps.size0 = 2.6;
        ps.size1 = 5.5 + h.rand() * 2;
        ps.spin = (h.rand() - 0.5) * 0.3;
        ps.r = 0.6;
        ps.g = 0.72;
        ps.b = 0.78;
        ps.a = 0.13 * density;
        h.mist.emit(now, ps);
      }
      if (h.rand() < 0.15) {
        const ps = h.ps();
        ps.x = x;
        ps.y = gy + 0.3 + h.rand() * 0.6;
        ps.z = z;
        ps.vx = 0;
        ps.vy = 0.2;
        ps.vz = 0;
        ps.life = 1.2;
        ps.drag = 0.3;
        ps.size0 = 0.1;
        ps.size1 = 0.03;
        ps.r = 0.75;
        ps.g = 0.9;
        ps.b = 1;
        ps.a = 0.8;
        h.glow.emit(now, ps);
      }
    }
  }
}
