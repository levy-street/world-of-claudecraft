// The Knellwyrm's heroic Burning Knell (host: morthen_rite_fx.ts; plan:
// morthen_rite_fx_core.ts; sim: encounters/hollow_crypt/knellwyrm_knell.ts),
// read off the half's encounter object (centred on the ring, `facing` the
// half's direction, `scale` the fire's reach; the marked template swapping to
// the fire one as the breath lands) and the wyrm's bars:
//  - the MARK: a big lethal-red half-disc over the marked half of the Rite
//    Ring, its outline and the diameter it is cut along burning red, the fill
//    sweeping out over the 4.5 s bar and red embers thickening off it toward
//    the end; the wyrm roars the fire down (its SkyRoar one-shot: aloft, a
//    flier's cast clip never plays);
//  - the FIRE: its ghost fire (GHOST_FIRE_RAMP, the crypt_creature_fx torrent
//    language) erupts over that WHOLE half the moment it lands and pours on
//    for the 1.4 s breath, a torrent falling from its jaws as it dives into
//    the pour (its Strafe one-shot), the half's footprint burning bright;
//  - the SCORCH: char and ghost-fire embers left on the half, fading.
//
// The half (mark and fire) is ACTIONABLE: every tier. The torrent, embers and
// the scorch's glow are cosmetic and thin on the low tier.

import * as THREE from 'three';
import {
  KNELL_HALF_FIRE_TEMPLATE,
  KNELL_HALF_MARK_TEMPLATE,
  KNELL_TUNING,
  KNELLWYRM_KNELL_FIRE,
  KNELLWYRM_KNELL_MARK,
} from '../../sim/encounters/hollow_crypt/ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { type TelegraphFan, telegraphFillOf } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  type CragDrapeMemo,
  cragDrapeMemo,
  drapeFanOnCrag,
  resetCragDrape,
} from './crag_fan_drape';
import { anchorWorld, coneSpot, KNELLWYRM_JAWS_EXHALE } from './crypt_creature_fx_core';
import { GHOST_RAMP } from './crypt_fx_particles';
import {
  cragRimRadius,
  KNELL_GESTURE_POUR,
  KNELL_GESTURE_SKY_ROAR,
  KNELL_SCORCH_SEC,
  knellFire,
  knellMarkLook,
  knellScorch,
  MORTHEN_TELEGRAPHS,
  onCragFloor,
} from './morthen_rite_fx_core';
import type { RiteFxHost, RitePainter } from './morthen_rite_host';

const SLOTS = 2;
const RINGS = 10;
const SEGMENTS = 40;

const SCORCH_VERT = /* glsl */ `
attribute vec2 aPolar;
varying vec2 vPolar;
varying vec3 vLocal;
void main() {
  vPolar = aPolar;
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The burnt half: charred ash with ghost-fire embers glowing through its
 *  cracks; while the fire pours the whole footprint burns bright. */
const SCORCH_FRAG = /* glsl */ `
uniform float uTime;
uniform float uChar;
uniform float uEmbers;
uniform float uBurn;
varying vec2 vPolar;
varying vec3 vLocal;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1 + 7.3) * 0.3 + vnoise(p * 4.3 - 3.1) * 0.15; }
${GHOST_RAMP}
void main() {
  float edge = (1.0 - smoothstep(0.9, 1.0, vPolar.x)) * smoothstep(0.0, 0.02, vPolar.y) * (1.0 - smoothstep(0.98, 1.0, vPolar.y));
  float n = fbm(vLocal.xz * 0.35);
  float cracks = 1.0 - smoothstep(0.02, 0.08, abs(fbm(vLocal.xz * 0.9 + 4.0) - 0.5));
  float ash = uChar * edge * (0.5 + 0.5 * n);
  float flick = 0.7 + 0.3 * sin(uTime * 3.0 + n * 20.0);
  float glow = uEmbers * edge * cracks * flick;
  float lick = fbm(vLocal.xz * 0.5 + vec2(0.0, -uTime * 2.2));
  float burn = uBurn * edge * (0.45 + 0.55 * lick);
  vec3 col = mix(vec3(0.02, 0.025, 0.02), ghostRamp(0.5 + 0.45 * clamp(glow + burn, 0.0, 1.0)) * 1.6, clamp(glow + burn, 0.0, 1.0));
  float a = clamp(ash * 0.75 + glow * 0.9 + burn * 0.7, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

/** A half-disc patch on a polar grid (r 0..1, angle 0..1 over 180 degrees). */
function halfDiscGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = (RINGS + 1) * (SEGMENTS + 1);
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage),
  );
  const polar = new Float32Array(n * 2);
  const index: number[] = [];
  for (let r = 0; r <= RINGS; r++) {
    for (let s = 0; s <= SEGMENTS; s++) {
      const i = r * (SEGMENTS + 1) + s;
      polar[i * 2] = r / RINGS;
      polar[i * 2 + 1] = s / SEGMENTS;
      if (r < RINGS && s < SEGMENTS) {
        const c = i + SEGMENTS + 1;
        index.push(i, c, i + 1, i + 1, c, c + 1);
      }
    }
  }
  g.setAttribute('aPolar', new THREE.BufferAttribute(polar, 2));
  g.setIndex(index);
  return g;
}

interface Scorch {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  alive: boolean;
}

interface HalfSlot {
  objectId: number;
  fan: TelegraphFan;
  born: number;
  /** When the fire landed on it (-1: still marked). */
  burnAt: number;
  x: number;
  z: number;
  yaw: number;
  reach: number;
  roared: boolean;
  embers: number;
  flames: number;
  torrent: number;
  scorch: Scorch;
  /** The ring floor under the half's centre: only the crag top within the
   *  sim's band of it ever burns (the Choir Loft below the rim never). */
  floor: number;
  memo: CragDrapeMemo;
}

export class KnellFx implements RitePainter {
  private readonly slots: HalfSlot[] = [];

  constructor(private readonly h: RiteFxHost) {
    const S = MORTHEN_TELEGRAPHS.knell;
    for (let i = 0; i < SLOTS; i++) {
      const fan = h.kit.fan(13);
      h.kit.layOutFan(fan, S.arcDeg, { color: S.color, accent: S.accent });
      const mat = h.own(
        new THREE.ShaderMaterial({
          uniforms: {
            uTime: h.uTime,
            uChar: { value: 0 },
            uEmbers: { value: 0 },
            uBurn: { value: 0 },
          },
          vertexShader: SCORCH_VERT,
          fragmentShader: SCORCH_FRAG,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      const mesh = new THREE.Mesh(h.own(halfDiscGeometry()), mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 2);
      h.root.add(mesh);
      this.slots.push({
        objectId: -1,
        fan,
        born: 0,
        burnAt: -1,
        x: 0,
        z: 0,
        yaw: 0,
        reach: S.radius,
        roared: false,
        embers: 0,
        flames: 0,
        torrent: 0,
        scorch: { mesh, mat, born: -1e6, alive: false },
        floor: 0,
        memo: cragDrapeMemo(),
      });
    }
  }

  // ------------------------------------------------------------------ events

  handleEvent(ev: SimEvent, world: IWorld): void {
    if (ev.type !== 'spellfx' || ev.ability !== KNELLWYRM_KNELL_FIRE) return;
    const slot = this.slots.find((s) => s.objectId === ev.targetId);
    const obj = world.entities.get(ev.targetId);
    if (slot) this.burn(slot, world);
    else if (obj) {
      const fresh = this.claim(obj);
      if (fresh) this.burn(fresh, world);
    }
  }

  private claim(e: Entity): HalfSlot | null {
    const slot = this.slots.find((s) => s.objectId < 0);
    if (!slot) return null;
    slot.objectId = e.id;
    slot.born = this.h.clock();
    slot.burnAt = -1;
    slot.roared = false;
    slot.x = e.pos.x;
    slot.z = e.pos.z;
    slot.yaw = e.facing;
    slot.reach = e.scale || KNELL_TUNING.reach;
    slot.floor = this.h.groundY(slot.x, slot.z);
    resetCragDrape(slot.memo);
    slot.fan.group.visible = true;
    return slot;
  }

  /** The fire lands on the whole half at once, then pours on. */
  private burn(s: HalfSlot, world: IWorld): void {
    const h = this.h;
    if (s.burnAt >= 0) return;
    const now = h.clock();
    s.burnAt = now;
    s.flames = 0;
    s.torrent = 0;
    const wyrm = h.scan.wyrmId >= 0 ? world.entities.get(h.scan.wyrmId) : undefined;
    if (wyrm && !wyrm.dead) h.gesture(wyrm.id, KNELL_GESTURE_POUR);
    // The scorch under it.
    this.layScorch(s);
    // The eruption: every spot of the half catches at once.
    const n = Math.round(380 * h.density) + 60;
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    for (let i = 0; i < n; i++) {
      const spot = coneSpot(i, n, s.reach, 180, 0.6);
      const x = s.x + spot.x * c + spot.z * sn;
      const z = s.z - spot.x * sn + spot.z * c;
      const gy = h.groundY(x, z);
      if (!onCragFloor(gy, s.floor)) continue;
      {
        const ps = h.ps();
        ps.x = x;
        ps.y = gy + 0.1;
        ps.z = z;
        ps.vx = 0;
        ps.vy = 2.2 + h.rand() * 2.4;
        ps.vz = 0;
        ps.ay = 1.6;
        ps.life = 0.8 + h.rand() * 0.5;
        ps.drag = 0.8;
        ps.size0 = 1.4 + h.rand();
        ps.size1 = 3.4 + h.rand() * 2.4;
        ps.r = 0.95 + h.rand() * 0.25;
        ps.g = 0;
        ps.b = 0;
        ps.a = 0.9;
        h.fire.emit(now + h.rand() * 0.1, ps);
      }
      if (i % 4 === 0) {
        const ps = h.ps();
        ps.x = x + (h.rand() - 0.5) * 2;
        ps.y = gy + 0.4;
        ps.z = z + (h.rand() - 0.5) * 2;
        ps.vx = (h.rand() - 0.5) * 2;
        ps.vy = 3.5 + h.rand() * 4;
        ps.vz = (h.rand() - 0.5) * 2;
        ps.ay = 0.8;
        ps.life = 1.2 + h.rand();
        ps.drag = 0.6;
        ps.size0 = 0.18;
        ps.size1 = 0.06;
        ps.r = 0.8;
        ps.g = 1;
        ps.b = 0.42;
        ps.a = 1;
        h.glow.emit(now + h.rand() * 0.6, ps);
      }
    }
    for (let i = 0; i < 4; i++) {
      const spot = coneSpot(i * 7 + 3, 28, s.reach * 0.8, 160, 4);
      const x = s.x + spot.x * c + spot.z * sn;
      const z = s.z - spot.x * sn + spot.z * c;
      const gy = h.groundY(x, z);
      if (onCragFloor(gy, s.floor)) h.flash(x, gy + 1.5, z, 14, 0.5, 0xd8ffb0);
    }
    h.shakeAt(s.x, s.z, 0.75);
  }

  private layScorch(s: HalfSlot): void {
    const h = this.h;
    const sc = s.scorch;
    const pos = sc.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const polar = sc.mesh.geometry.getAttribute('aPolar') as THREE.BufferAttribute;
    const y0 = s.floor;
    // Cut back to the crag top along each spoke (never down the cliff).
    const rims = new Map<number, number>();
    for (let i = 0; i < pos.count; i++) {
      const a = s.yaw - Math.PI / 2 + Math.PI * polar.getY(i);
      let rim = rims.get(polar.getY(i));
      if (rim === undefined) {
        rim = cragRimRadius(h.groundY, s.x, s.z, Math.sin(a), Math.cos(a), y0, s.reach);
        rims.set(polar.getY(i), rim);
      }
      const rr = Math.min(polar.getX(i) * s.reach, rim);
      const wx = s.x + Math.sin(a) * rr;
      const wz = s.z + Math.cos(a) * rr;
      pos.setXYZ(i, wx - s.x, h.groundY(wx, wz) - y0 + 0.05, wz - s.z);
    }
    pos.needsUpdate = true;
    sc.mesh.position.set(s.x, y0, s.z);
    sc.born = h.clock();
    sc.alive = true;
    sc.mesh.visible = true;
  }

  // ------------------------------------------------------------------- frame

  update(world: IWorld, dt: number): void {
    const h = this.h;
    const now = h.clock();
    for (const id of h.scan.knells) {
      let held = false;
      for (const s of this.slots) if (s.objectId === id) held = true;
      if (held) continue;
      const e = world.entities.get(id);
      if (e) this.claim(e);
    }
    const wyrm = h.scan.wyrmId >= 0 ? world.entities.get(h.scan.wyrmId) : undefined;
    for (const s of this.slots) {
      this.stepScorch(s, now);
      if (s.objectId < 0) continue;
      const e = world.entities.get(s.objectId);
      if (!e) {
        s.objectId = -1;
        s.fan.group.visible = false;
        continue;
      }
      s.x = e.pos.x;
      s.z = e.pos.z;
      s.yaw = e.facing;
      s.reach = e.scale || s.reach;
      const gy = s.floor;
      drapeFanOnCrag(h.kit, s.fan, h.groundY, s.x, gy, s.z, s.yaw, s.reach, s.memo);
      if (e.templateId === KNELL_HALF_FIRE_TEMPLATE && s.burnAt < 0) this.burn(s, world);
      if (e.templateId === KNELL_HALF_MARK_TEMPLATE && s.burnAt < 0) {
        this.mark(s, wyrm, gy, dt);
        continue;
      }
      const fire = knellFire(now - s.burnAt);
      h.kit.paintFan(s.fan, {
        fill: 1,
        clock: now,
        range: s.reach,
        fade: 0.35 + 0.65 * fire,
        front: 0,
      });
      this.pour(s, wyrm, fire, dt);
    }
  }

  /** The half while it is marked: the red footprint filling with the bar. */
  private mark(s: HalfSlot, wyrm: Entity | undefined, gy: number, dt: number): void {
    const h = this.h;
    const now = h.clock();
    if (!s.roared && wyrm && !wyrm.dead) {
      s.roared = true;
      h.gesture(wyrm.id, KNELL_GESTURE_SKY_ROAR);
    }
    const fill =
      wyrm && wyrm.castingAbility === KNELLWYRM_KNELL_MARK
        ? telegraphFillOf(wyrm.castRemaining, wyrm.castTotal)
        : Math.min(1, (now - s.born) / KNELL_TUNING.markSeconds);
    h.kit.paintFan(s.fan, { fill, clock: now, range: s.reach });
    const look = knellMarkLook(fill);
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    // Red embers lifting off the marked half, thicker as the fire nears.
    s.embers += look.embers * 90 * h.density * dt;
    while (s.embers >= 1) {
      s.embers -= 1;
      const spot = coneSpot(Math.floor(h.rand() * 4093), 4093, s.reach, 180, 0.5);
      const x = s.x + spot.x * c + spot.z * sn;
      const z = s.z - spot.x * sn + spot.z * c;
      const gy = h.groundY(x, z);
      if (!onCragFloor(gy, s.floor)) continue;
      {
        const ps = h.ps();
        ps.x = x;
        ps.y = gy + 0.15;
        ps.z = z;
        ps.vx = (h.rand() - 0.5) * 0.6;
        ps.vy = 1.2 + h.rand() * 2.2 * look.edge;
        ps.vz = (h.rand() - 0.5) * 0.6;
        ps.life = 1 + h.rand() * 0.6;
        ps.drag = 0.5;
        ps.size0 = 0.24;
        ps.size1 = 0.06;
        ps.r = 1;
        ps.g = 0.16 + h.rand() * 0.1;
        ps.b = 0.08;
        ps.a = 0.95;
        h.glow.emit(now, ps);
      }
    }
    // Sparks along the diameter it is cut along: the line to get behind.
    if (h.rand() < look.edge * 40 * h.density * dt * 4) {
      const t = (h.rand() * 2 - 1) * s.reach;
      const x = s.x + c * t;
      const z = s.z - sn * t;
      const ly = h.groundY(x, z);
      if (onCragFloor(ly, gy)) {
        const ps = h.ps();
        ps.x = x;
        ps.y = ly + 0.2;
        ps.z = z;
        ps.vx = 0;
        ps.vy = 2 + h.rand() * 2;
        ps.vz = 0;
        ps.life = 0.6;
        ps.drag = 0.4;
        ps.size0 = 0.3;
        ps.size1 = 0.08;
        ps.r = 1;
        ps.g = 0.32;
        ps.b = 0.14;
        ps.a = 1;
        h.glow.emit(now, ps);
      }
    }
  }

  /** The breath: ghost fire pouring over the whole half, a torrent off the jaws. */
  private pour(s: HalfSlot, wyrm: Entity | undefined, fire: number, dt: number): void {
    const h = this.h;
    if (fire <= 0) return;
    const now = h.clock();
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    s.flames += 520 * fire * h.density * dt;
    while (s.flames >= 1) {
      s.flames -= 1;
      const spot = coneSpot(Math.floor(h.rand() * 8191), 8191, s.reach, 180, 0.5);
      const x = s.x + spot.x * c + spot.z * sn;
      const z = s.z - spot.x * sn + spot.z * c;
      const gy = h.groundY(x, z);
      if (!onCragFloor(gy, s.floor)) continue;
      {
        const ps = h.ps();
        ps.x = x;
        ps.y = gy + 0.1;
        ps.z = z;
        ps.vx = 0;
        ps.vy = 1.8 + h.rand() * 2;
        ps.vz = 0;
        ps.ay = 1.4;
        ps.life = 0.7 + h.rand() * 0.4;
        ps.drag = 0.8;
        ps.size0 = 1.1 + h.rand() * 0.6;
        ps.size1 = 2.6 + h.rand() * 2;
        ps.r = 0.85 + h.rand() * 0.3;
        ps.g = 0;
        ps.b = 0;
        ps.a = 0.85 * fire;
        h.fire.emit(now, ps);
      }
    }
    if (!wyrm || wyrm.dead) return;
    const jaws = anchorWorld(
      KNELLWYRM_JAWS_EXHALE,
      wyrm.pos.x,
      wyrm.pos.y,
      wyrm.pos.z,
      wyrm.facing,
      wyrm.scale || 1,
    );
    s.torrent += 240 * fire * h.density * dt;
    while (s.torrent >= 1) {
      s.torrent -= 1;
      const spot = coneSpot(Math.floor(h.rand() * 8191), 8191, s.reach, 170, 2);
      const tx = s.x + spot.x * c + spot.z * sn;
      const tz = s.z - spot.x * sn + spot.z * c;
      const gy = h.groundY(tx, tz);
      if (!onCragFloor(gy, s.floor)) continue;
      const flight = 0.4 + h.rand() * 0.2;
      const drag = 0.9;
      const k = (1 - Math.exp(-drag * flight)) / drag;
      {
        const ps = h.ps();
        ps.x = jaws.x + (h.rand() - 0.5) * 0.6;
        ps.y = jaws.y + (h.rand() - 0.5) * 0.6;
        ps.z = jaws.z + (h.rand() - 0.5) * 0.6;
        ps.vx = (tx - jaws.x) / k;
        ps.vy = (gy - jaws.y) / k;
        ps.vz = (tz - jaws.z) / k;
        ps.ay = 2;
        ps.life = flight + 0.4 + h.rand() * 0.3;
        ps.drag = drag;
        ps.floor = gy + 0.25;
        ps.size0 = 0.5 + h.rand() * 0.3;
        ps.size1 = 2.2 + h.rand() * 1.8;
        ps.r = 1.05 + h.rand() * 0.2;
        ps.g = 0;
        ps.b = 0;
        ps.a = 0.9 * fire;
        h.fire.emit(now, ps);
      }
    }
  }

  private stepScorch(s: HalfSlot, now: number): void {
    const sc = s.scorch;
    if (!sc.alive) return;
    const age = now - sc.born;
    if (age > KNELL_SCORCH_SEC) {
      sc.alive = false;
      sc.mesh.visible = false;
      return;
    }
    const lv = knellScorch(age);
    const u = sc.mat.uniforms;
    u.uChar.value = lv.char;
    u.uEmbers.value = lv.embers;
    u.uBurn.value = knellFire(age);
  }
}
