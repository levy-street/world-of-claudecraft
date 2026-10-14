// The Idol's Breath of Zulgar's final phase (plan: zulgar_hunt_fx_core.ts), on
// WildheartFx's host. The stone jaguar behind the terrace breathes over one
// half of it at a time; the sim's object says which half and when (its
// template, its facing and its own clock, encounters/wildheart_basin/
// zulgar_idol.ts).
//  - The WARNING: that half of the terrace, cut on the sim's own centre line,
//    painted in the shared telegraph look (the threat palette's lethal red,
//    its fill racing out of the maw as the warning runs, a crisp rim on the
//    centre line a player crosses to be safe). On the detailed tiers a curtain
//    of light stands on the centre line and jade motes are drawn up into the
//    maw as the idol inhales.
//  - The BREATH: the same half floods jade (the world entrance's own jade,
//    wildheart_basin_entrance.ts): a bright front racing from the maw to the
//    stair, a boiling sheet behind it, then thinning out over the seconds the
//    sim keeps the object. Jade fog pours out of the maw and rolls across it.
//  - The IDOL: `eyes()` and `throat()` say how hard its eyes and its throat
//    burn; WildheartFx writes them to the kit's eyes and the maw's jade cards.
// The two floor layers are shader states of meshes built once here and draw on
// every graphics tier; the curtain, the motes and the fog are cosmetic.
//
// Rules (src/render/CLAUDE.md): every mesh and material is built in the
// constructor under the host's root before its gated attach; the frame path
// allocates nothing; no light.

import * as THREE from 'three';
import {
  type IdolBreathSide,
  idolBreathSideOf,
  WILDHEART_IDOL_BREATH,
  WILDHEART_IDOL_BREATH_WARNING,
  ZULGAR_IDOL_AWAKE,
  ZULGAR_IDOL_WAKES,
  ZULGAR_IDOLS_BREATH,
  ZULGAR_TUNING,
} from '../../sim/encounters/wildheart_basin/ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { TelegraphLane, TelegraphPaint } from '../floor_telegraph';
import {
  createTelegraphCurtainMaterial,
  createTelegraphFloorMaterial,
  type TelegraphCurtainMaterial,
} from '../floor_telegraph/telegraph_material';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { BasinPuffOptions } from './basin_fx_core';
import type { BasinFxHost } from './basin_fx_host';
import {
  basinOriginInto,
  breathPour,
  clockLeft,
  IDOL_BREATH_COLORS,
  IDOL_MAW_MOUTH,
  type IdolState,
  idolBreathFan,
  idolBreathHalf,
  idolBreathLane,
  idolBreathSpotInto,
  idolEyesBurn,
  idolThroatGlow,
} from './zulgar_hunt_fx_core';

/** How far the floor layers float over the flags (the kit's own lift). */
const LIFT = 0.07;
/** The centre line's curtain of light (yards tall). */
const CURTAIN_HEIGHT = 2.6;

interface Half {
  side: IdolBreathSide;
  /** The lane the shader measures along (instance-local start, length, half width). */
  lane: ReturnType<typeof idolBreathLane>;
  fan: ReturnType<typeof idolBreathFan>;
  /** The warning: the shared telegraph floor on the half's own polygon. */
  warning: TelegraphLane;
  /** The breath itself. */
  sheet: THREE.Mesh;
  sheetMat: THREE.ShaderMaterial;
}

const SHEET_VERT = /* glsl */ `
uniform float uLen;
uniform float uHalf;
varying vec2 vLocal;
void main() {
  // Across the half (-1 to 1) and from the maw to the stair (0 to 1).
  vLocal = vec2(position.x / max(uHalf, 1e-3), -position.z / max(uLen, 1e-3));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The breath over its half: a front racing out of the maw, a boiling jade
 *  sheet behind it, a seam of light on the centre line. */
const SHEET_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
uniform float uFront;
uniform float uFlash;
uniform float uTime;
uniform float uLen;
uniform float uHalf;
uniform float uSeam;
uniform vec3 uJade;
varying vec2 vLocal;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float along = vLocal.y;
  vec2 q = vec2(vLocal.x * uHalf, along * uLen);
  float behind = 1.0 - smoothstep(uFront - 0.05, uFront + 0.01, along);
  // Rolling mist: two octaves racing toward the stair, torn into billows.
  float n = noise(q * 0.16 + vec2(0.0, -uTime * 2.6)) * 0.6
    + noise(q * 0.42 + vec2(uTime * 0.7, -uTime * 4.4)) * 0.4;
  float billow = smoothstep(0.28, 0.82, n);
  float streak = 0.5 + 0.5 * sin(q.x * 1.3 + n * 5.0);
  float body = behind * (0.07 + 0.42 * billow) * (0.7 + 0.3 * streak);
  float front = (1.0 - smoothstep(0.0, 0.07, abs(along - uFront))) * step(uFront, 0.995);
  // The centre line a player crosses: lit along its whole length.
  float seam = smoothstep(0.92, 1.0, vLocal.x * uSeam) * behind;
  vec3 hot = vec3(0.7, 1.0, 0.84);
  vec3 col = mix(uJade, hot, clamp(front + uFlash * 0.6 + seam * 0.4 + billow * 0.18, 0.0, 1.0));
  float a = body + front * 0.9 + seam * 0.4 + uFlash * 0.3;
  gl_FragColor = vec4(col * a * uAlpha, 1.0);
}
`;

/** A half's polygon as a triangle fan, each vertex relative to its lane's start. */
function halfGeometry(side: IdolBreathSide): THREE.BufferGeometry {
  const points = idolBreathHalf(side);
  const lane = idolBreathLane(side);
  const pos = new Float32Array(points.length * 3);
  points.forEach(([x, z], i) => {
    pos[i * 3] = x - lane.x;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = z - lane.z;
  });
  const index: number[] = [];
  for (let i = 1; i + 1 < points.length; i++) index.push(0, i, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

/** The curtain of light on the centre line: a wall from the maw to the stair. */
function curtainGeometry(length: number): THREE.BufferGeometry {
  const steps = 24;
  const pos = new Float32Array((steps + 1) * 2 * 3);
  const along = new Float32Array((steps + 1) * 2);
  const height = new Float32Array((steps + 1) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * length;
    pos.set([0, 0, -t, 0, CURTAIN_HEIGHT, -t], i * 6);
    along[i * 2] = t;
    along[i * 2 + 1] = t;
    height[i * 2 + 1] = 1;
  }
  const index: number[] = [];
  for (let i = 0; i < steps; i++) {
    const b = i * 2;
    index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  g.setAttribute('aH', new THREE.BufferAttribute(height, 1));
  g.setIndex(index);
  return g;
}

export class IdolBreathFx {
  private readonly halves: Half[] = [];
  private readonly curtain: THREE.Mesh | null = null;
  private readonly curtainMat: TelegraphCurtainMaterial | null = null;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly origin = { x: 0, z: 0 };
  private readonly spot = { x: 0, z: 0 };
  private readonly paint: TelegraphPaint = { fill: 0, clock: 0, range: 1 };
  /** Jade motes drawn up into the maw while the idol inhales. */
  private readonly mote: BasinPuffOptions & { dir: [number, number, number] } = {
    speed: 9,
    life: 1.1,
    size: [0.5, 0.12],
    color: IDOL_BREATH_COLORS.jade,
    alpha: 0.9,
    glow: true,
    dir: [0, 0.4, 1],
    spread: 0.12,
    drag: 0.2,
  };
  /** The fog rolling out of the maw across the half. */
  private readonly fog: BasinPuffOptions & { dir: [number, number, number] } = {
    speed: 15,
    life: 1.5,
    size: [2.2, 7],
    color: [0.2, 0.78, 0.48],
    alpha: 0.42,
    dir: [0, -0.3, -1],
    spread: 0.3,
    drag: 1.3,
    radius: 3,
  };
  /** The fog lying on the half once the breath has washed over it. */
  private readonly pall: BasinPuffOptions = {
    speed: 1.2,
    up: 1.4,
    life: 1.6,
    size: [2.4, 5.5],
    color: [0.24, 0.85, 0.52],
    alpha: 0.34,
    drag: 1.6,
    radius: 1.5,
  };
  private readonly ember: BasinPuffOptions = {
    speed: 1.6,
    up: 3.4,
    life: 1.1,
    size: [0.5, 0.12],
    color: IDOL_BREATH_COLORS.jade,
    alpha: 1,
    glow: true,
    radius: 1.2,
  };
  private objectId = -1;
  private zulgarId = -1;
  private state: IdolState = 'asleep';
  private fill = 0;
  private emit = 0;
  private clock = 0;

  constructor(
    private readonly host: BasinFxHost,
    private readonly world: IWorld,
  ) {
    const { root } = host;
    for (const side of [1, -1] as const) {
      const geo = halfGeometry(side);
      this.geometries.push(geo);
      const lane = idolBreathLane(side);
      const floorMat = createTelegraphFloorMaterial(true);
      const u = floorMat.uniforms;
      u.uColor.value.setHex(IDOL_BREATH_COLORS.color);
      u.uAccent.value.setHex(IDOL_BREATH_COLORS.accent);
      // The lane runs from the maw to the stair (instance -z).
      u.uDir.value.set(0, -1);
      u.uLen.value = lane.length;
      u.uHalf.value = lane.half;
      u.uDetail.value = host.density >= 1 ? 1 : 0;
      const floor = new THREE.Mesh(geo, floorMat);
      floor.frustumCulled = false;
      floor.renderOrder = floorVfxRenderOrder('encounter', 21);
      const group = new THREE.Group();
      group.name = 'wildheart-idol-warning';
      group.visible = false;
      group.add(floor);
      root.add(group);
      const sheetMat = new THREE.ShaderMaterial({
        name: 'wildheartIdolBreathSheet',
        uniforms: {
          uAlpha: { value: 0 },
          uFront: { value: 0 },
          uFlash: { value: 0 },
          uTime: host.uTime,
          uLen: { value: lane.length },
          uHalf: { value: lane.half },
          // The centre line lies on the lane's west edge for the east half
          // and on its east edge for the west half.
          uSeam: { value: -side },
          uJade: { value: new THREE.Vector3(...IDOL_BREATH_COLORS.jade) },
        },
        vertexShader: SHEET_VERT,
        fragmentShader: SHEET_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const sheet = new THREE.Mesh(geo, sheetMat);
      sheet.name = 'wildheart-idol-breath';
      sheet.frustumCulled = false;
      sheet.visible = false;
      sheet.renderOrder = floorVfxRenderOrder('encounter', 22);
      root.add(sheet);
      this.materials.push(floorMat, sheetMat);
      this.halves.push({
        side,
        lane,
        fan: idolBreathFan(side),
        warning: { group, floor, floorMat, curtain: null, curtainMat: null },
        sheet,
        sheetMat,
      });
    }
    if (host.density >= 1) {
      // Cosmetic: one wall of light on the centre line, shared by both halves.
      const geo = curtainGeometry(this.halves[0].lane.length);
      this.curtainMat = createTelegraphCurtainMaterial();
      this.curtainMat.uniforms.uColor.value.setHex(IDOL_BREATH_COLORS.color);
      this.curtainMat.uniforms.uAccent.value.setHex(IDOL_BREATH_COLORS.accent);
      this.curtain = new THREE.Mesh(geo, this.curtainMat);
      this.curtain.name = 'wildheart-idol-curtain';
      this.curtain.frustumCulled = false;
      this.curtain.visible = false;
      this.curtain.renderOrder = floorVfxRenderOrder('encounter', 23);
      this.geometries.push(geo);
      this.materials.push(this.curtainMat);
      root.add(this.curtain);
    }
  }

  // ------------------------------------------------------------------- scan

  /** The scan saw Zulgar (or, with null, lost him). */
  setZulgar(e: Entity | null): void {
    this.zulgarId = e ? e.id : -1;
  }

  /** Claim the breath's object (the warned half, then the breath over it);
   *  its claim's origin is read once, as it is claimed. */
  scanObject(e: Entity): void {
    const t = e.templateId;
    if (t !== WILDHEART_IDOL_BREATH_WARNING && t !== WILDHEART_IDOL_BREATH) return;
    if (this.objectId === e.id) return;
    this.objectId = e.id;
    basinOriginInto(this.origin, e.pos);
  }

  // ------------------------------------------------------------------- the idol

  /** How hard the stone jaguar's eyes burn for its breath (0 asleep). */
  eyes(): number {
    return idolEyesBurn(this.state, this.fill, this.clock);
  }

  /** How hard the jade burns in its throat (0 asleep). */
  throat(): number {
    return idolThroatGlow(this.state, this.fill, this.clock);
  }

  // ------------------------------------------------------------------- frame

  update(dt: number, clock: number): void {
    this.clock = clock;
    const world = this.world;
    const obj = this.objectId >= 0 ? world.entities.get(this.objectId) : undefined;
    const warning = obj?.templateId === WILDHEART_IDOL_BREATH_WARNING;
    const breath = obj?.templateId === WILDHEART_IDOL_BREATH;
    if (!obj || !(warning || breath)) {
      this.objectId = -1;
      this.hideLayers();
      const z = this.zulgarId >= 0 ? world.entities.get(this.zulgarId) : undefined;
      this.state = z && !z.dead && hasAura(z, ZULGAR_IDOL_AWAKE) ? 'awake' : 'asleep';
      this.fill = 0;
      return;
    }
    const side = idolBreathSideOf(obj.facing);
    const origin = this.origin;
    const left = clockLeft(obj.castRemaining, obj.castTotal);
    for (const half of this.halves) {
      const mine = half.side === side;
      const wx = origin.x + half.lane.x;
      const wz = origin.z + half.lane.z;
      const gy = this.host.groundY(obj.pos.x + half.side * 4, obj.pos.z) + LIFT;
      half.warning.group.visible = mine && warning;
      if (half.warning.group.visible) {
        half.warning.group.position.set(wx, gy, wz);
        this.paint.fill = 1 - left;
        this.paint.clock = clock;
        this.paint.range = half.lane.length;
        this.host.kit.paintLane(half.warning, this.paint);
      }
      half.sheet.visible = mine && breath;
      if (half.sheet.visible) {
        half.sheet.position.set(wx, gy + 0.04, wz);
        const pour = breathPour((1 - left) * ZULGAR_TUNING.breathLinger);
        half.sheetMat.uniforms.uAlpha.value = pour.alpha;
        half.sheetMat.uniforms.uFront.value = pour.front;
        half.sheetMat.uniforms.uFlash.value = pour.flash;
      }
      if (mine) this.breathe(half, origin, gy, warning, 1 - left, dt);
    }
    if (this.curtain && this.curtainMat) {
      this.curtain.visible = warning;
      if (warning) {
        const lane = this.halves[0].lane;
        const gy = this.host.groundY(obj.pos.x, obj.pos.z) + LIFT;
        this.curtain.position.set(origin.x, gy, origin.z + lane.z);
        const cu = this.curtainMat.uniforms;
        cu.uTime.value = clock;
        cu.uScale.value = 1;
        cu.uStrength.value = 1.1 + 0.9 * (1 - left);
        cu.uFade.value = 1;
      }
    }
    this.state = warning ? 'inhale' : 'exhale';
    this.fill = warning ? 1 - left : 1;
  }

  /** The cosmetic air: motes drawn into the maw as it inhales, fog poured out
   *  of it and lying on the half as it breathes. */
  private breathe(
    half: Half,
    origin: { x: number; z: number },
    floorY: number,
    warning: boolean,
    fill: number,
    dt: number,
  ): void {
    const host = this.host;
    const mx = origin.x + IDOL_MAW_MOUTH.x;
    const mz = origin.z + IDOL_MAW_MOUTH.z;
    this.emit += dt * (warning ? 10 + 30 * fill : 60) * host.density;
    while (this.emit >= 1) {
      this.emit -= 1;
      const p = idolBreathSpotInto(this.spot, half.fan, host.rand(), host.rand(), host.rand());
      const x = origin.x + p.x;
      const z = origin.z + p.z;
      if (warning) {
        // Up off the marked floor and into the maw.
        const dx = mx - x;
        const dy = IDOL_MAW_MOUTH.y - floorY;
        const dz = mz - z;
        const len = Math.hypot(dx, dy, dz) || 1;
        this.mote.dir[0] = dx / len;
        this.mote.dir[1] = dy / len;
        this.mote.dir[2] = dz / len;
        this.mote.speed = len / this.mote.life;
        host.puff(x, floorY + 0.4, z, 1, this.mote);
        continue;
      }
      host.puff(x, floorY + 0.5, z, 1, this.pall);
      host.puff(x, floorY + 0.3, z, 1, this.ember);
      // And the stream itself, out of the maw toward that spot.
      const sx = mx + (host.rand() - 0.5) * 2 * IDOL_MAW_MOUTH.halfWidth;
      const dx = x - sx;
      const dy = floorY + 1 - IDOL_MAW_MOUTH.y;
      const dz = z - mz;
      const len = Math.hypot(dx, dy, dz) || 1;
      this.fog.dir[0] = dx / len;
      this.fog.dir[1] = dy / len;
      this.fog.dir[2] = dz / len;
      host.puff(sx, IDOL_MAW_MOUTH.y, mz, 1, this.fog);
    }
  }

  private hideLayers(): void {
    for (const half of this.halves) {
      half.warning.group.visible = false;
      half.sheet.visible = false;
    }
    if (this.curtain) this.curtain.visible = false;
  }

  // ------------------------------------------------------------------- events

  /** The idol waking and its breath landing. True when the event was the idol's. */
  handleEvent(ev: Extract<SimEvent, { type: 'spellfx' }>, src: Entity): boolean {
    if (ev.ability !== ZULGAR_IDOL_WAKES && ev.ability !== ZULGAR_IDOLS_BREATH) return false;
    // The warning itself is the floor's to show.
    if (ev.ability === ZULGAR_IDOLS_BREATH && ev.fx !== 'nova') return true;
    const host = this.host;
    const origin = basinOriginInto(this.origin, src.pos);
    const mx = origin.x + IDOL_MAW_MOUTH.x;
    const mz = origin.z + IDOL_MAW_MOUTH.z;
    const waking = ev.ability === ZULGAR_IDOL_WAKES;
    // A blast of jade out of the stone throat.
    host.puff(mx, IDOL_MAW_MOUTH.y, mz, waking ? 46 : 30, {
      speed: waking ? 13 : 18,
      up: -1,
      life: 1.5,
      size: [2.4, 8],
      color: [0.2, 0.8, 0.48],
      alpha: 0.5,
      dir: [0, -0.25, -1],
      spread: 0.55,
      drag: 1.4,
      radius: IDOL_MAW_MOUTH.halfWidth,
    });
    host.puff(mx, IDOL_MAW_MOUTH.y, mz, waking ? 60 : 36, {
      speed: 16,
      life: 1.2,
      size: [0.7, 0.14],
      color: IDOL_BREATH_COLORS.jade,
      alpha: 1,
      glow: true,
      dir: [0, -0.2, -1],
      spread: 0.6,
      drag: 0.8,
      radius: IDOL_MAW_MOUTH.halfWidth,
    });
    if (waking) host.shockRing(mx, mz - 14, 0x6ff0b0, 34, 1.3);
    if (!host.reducedMotion()) host.shake(waking ? 0.55 : 0.4);
    return true;
  }

  // ------------------------------------------------------------------- lifetime

  /** Out of the basin (a wipe, a leave): the idol sleeps. */
  hideAll(): void {
    this.objectId = -1;
    this.zulgarId = -1;
    this.state = 'asleep';
    this.fill = 0;
    this.hideLayers();
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

/** Does the entity carry the aura (a loop: no per-frame closure). */
function hasAura(e: { auras?: readonly { id: string }[] }, id: string): boolean {
  const auras = e.auras;
  if (!auras) return false;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return true;
  return false;
}
