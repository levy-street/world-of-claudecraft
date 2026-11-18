// The Wheel of the Hearth on screen (plan: heat_wheel_fx_core.ts; shaders:
// heat_wheel_glsl.ts; the sim: encounters/smith_heart/heat_wheel.ts), a part of
// HeatFightFx over its root, in the family of the lava waves' wall of fire
// (the polish pass of 2026-11-18: the slices used to be one flat strong red):
//  - each slice on the floor (a molten decal on Wakefire's commuting rungs,
//    `zoneChar`/`zoneGlow`, so two rounds' slices crossing compose the same
//    from every angle): a doomed slice darkens while molten cracks spread out
//    from the lip and its plates heat to a throb, its rims the lethal crimson;
//    the safe slice calm frost blue. It erupts in a flash running out from the
//    lip, burns, then its scorch cools after the sim drops it;
//  - its vents (one instanced draw a slice, in the air: WALL_AIR_ORDER's fire
//    and haze orders, over every floor band): heat shimmer wavering up while it
//    warns, geysers of fire and a low sheet of flame when it erupts;
//  - embers escaping the cracks late in the warning; at the eruption sparks,
//    flames and smoke (the host's particles, on the fight's rungs) and a shake.
// The floor decal (where to stand) draws on EVERY tier; the low tier thins the
// vents and particles (wheelVentCount, the host's density). Rules
// (src/render/CLAUDE.md): built in the constructor under the host's gated root,
// fixed pools, no per-frame allocation, no light.

import * as THREE from 'three';
import { FORGE_POINTS, HEARTH_WELL } from '../../sim/content/smith_heart_layout';
import { HEAT_TUNING as T } from '../../sim/encounters/smith_heart/heat_ids';
import type { IWorld } from '../../world_api';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { HEAT_FIGHT_COLORS as C, wheelArc, wheelOfCached } from './heat_fight_fx_core';
import { fireRampGlsl } from './heat_flame_core';
import { HEAT_FLOOR } from './heat_floor_ladder_core';
import type { HeatFxHost } from './heat_fx_host';
import { HEAT_LAVA_GLSL, HEAT_MOLTEN_GLSL, HEAT_NOISE_GLSL } from './heat_lava_glsl';
import { WALL_AIR_ORDER } from './heat_lava_wall_fx';
import { WALL_POLY_N } from './heat_lava_wall_glsl';
import { moltenDecal } from './heat_molten_decal';
import { floorRingGeometry } from './heat_shapes';
import {
  WHEEL_FX,
  type WheelFireLook,
  type WheelLook,
  wheelEruptLook,
  wheelEruptSpan,
  wheelFireLook,
  wheelVentAt,
  wheelVentCount,
  wheelVents,
  wheelWarnLook,
} from './heat_wheel_fx_core';
import {
  WHEEL_FLOOR_VERT,
  WHEEL_VENT_VERT,
  wheelFloorFrag,
  wheelVentFrag,
} from './heat_wheel_glsl';

/** The Hearth's floor's box (instance-local): a slice never draws past it. */
const FLOOR_BOX = { x0: -256, x1: -174, z0: -46, z1: 46 } as const;
/** The safe slice's rim: cool, against every danger colour on that floor. */
const SAFE_RIM = 0x7fd4ff;

const EMBER = {
  speed: 1.4,
  up: 3.2,
  life: 1.1,
  size: [0.32, 0.06] as [number, number],
  color: C.ember,
  alpha: 1,
  pool: 'glow' as const,
  drag: 0.6,
  radius: 1.2,
};
const SPARK_DIR: [number, number, number] = [0, 1, 0];
const SPARK = {
  speed: 13,
  up: 4,
  life: 0.9,
  size: [0.42, 0.08] as [number, number],
  color: C.spark,
  alpha: 1,
  pool: 'glow' as const,
  gravity: 9,
  dir: SPARK_DIR,
  spread: 0.55,
  radius: 0.8,
};
const FLAME = {
  speed: 1.2,
  up: 6,
  life: 0.6,
  size: [3.2, 0.8] as [number, number],
  color: C.gold,
  alpha: 0.85,
  pool: 'glow' as const,
  radius: 1.4,
};
const SMOKE = {
  speed: 1.1,
  up: 3.4,
  life: 2.6,
  size: [2.2, 6.5] as [number, number],
  color: [0.11, 0.085, 0.075] as const,
  alpha: 0.42,
  drag: 0.6,
  radius: 2,
};

type Phase = 'warn' | 'burn' | 'safe' | 'gone';

interface Slot {
  id: number;
  phase: Phase | null;
  /** When it entered its warning, or erupted (the clock). */
  born: number;
  erupted: number;
  seconds: number;
  burnSeconds: number;
  from: number;
  to: number;
  count: number;
  /** Its slice (WHEEL_ARCS_DEG), and how far its fire is put out (0..1):
   *  cosmetic, once the next round's safe slice lies on it. */
  slice: number;
  quench: number;
  /** When the sim dropped it (the clock; its burn's real end). */
  dropped: number;
  /** The wellspring's centre on the floor (world yards). */
  x: number;
  y: number;
  z: number;
  floor: THREE.Mesh;
  floorU: Record<string, THREE.IUniform>;
  vents: THREE.Mesh;
  ventU: Record<string, THREE.IUniform>;
}

const _look: WheelLook = { build: 0, throb: 0, erupt: -1, burn: 0, scorch: 0 };
const _fire: WheelFireLook = { floor: 0, geysers: 0, low: 0 };
const _at: [number, number] = [0, 0];

export class HeatWheelFx {
  private readonly slots: Slot[] = [];
  private readonly layout = wheelVents();
  private readonly poly: THREE.Vector2[] = Array.from(
    { length: WALL_POLY_N },
    () => new THREE.Vector2(),
  );
  private readonly polyFor = { x: Number.NaN, z: Number.NaN };
  private readonly centre = new THREE.Vector3();
  private readonly clip = new THREE.Vector4(-1e9, 1e9, -1e9, 1e9);
  private shown = false;

  constructor(
    private readonly host: HeatFxHost,
    /** A slice's sound as it changes state (the host's audio). */
    private readonly onState: (
      state: 'warn' | 'burn' | 'safe',
      x: number,
      y: number,
      z: number,
    ) => void,
  ) {
    const floorGeo = floorRingGeometry(HEARTH_WELL.r / T.wheelOuter, 96);
    const quad = new THREE.PlaneGeometry(1, 1, 1, 8);
    // A geyser is WHEEL_FX.planes instances: its crossed planes and its burst.
    const P = WHEEL_FX.planes;
    const n = WHEEL_FX.vents * P;
    const vent = new Float32Array(n * 4);
    const index = new Float32Array(n);
    const plane = new Float32Array(n);
    for (let i = 0; i < WHEEL_FX.vents; i++)
      for (let k = 0; k < P; k++) {
        const j = i * P + k;
        vent.set(this.layout.subarray(i * 4, i * 4 + 4), j * 4);
        index[j] = i;
        plane[j] = k;
      }
    const vents = new THREE.InstancedBufferGeometry();
    vents.index = quad.index;
    vents.setAttribute('position', quad.getAttribute('position'));
    vents.setAttribute('uv', quad.getAttribute('uv'));
    vents.setAttribute('aVent', new THREE.InstancedBufferAttribute(vent, 4));
    vents.setAttribute('aIndex', new THREE.InstancedBufferAttribute(index, 1));
    vents.setAttribute('aPlane', new THREE.InstancedBufferAttribute(plane, 1));
    vents.instanceCount = n;
    host.geometries.push(floorGeo, quad, vents);
    const floorFrag = wheelFloorFrag(HEAT_NOISE_GLSL, HEAT_MOLTEN_GLSL, HEAT_LAVA_GLSL);
    const ventFrag = wheelVentFrag(fireRampGlsl('fireRamp'));

    for (let i = 0; i < WHEEL_FX.slots; i++) {
      const arc = new THREE.Vector4();
      const floorU: Record<string, THREE.IUniform> = {
        uTime: host.uTime,
        uBuild: { value: 0 },
        uThrob: { value: 0 },
        uErupt: { value: -1 },
        uBurn: { value: 0 },
        uScorch: { value: 0 },
        uRim: { value: new THREE.Color(TELEGRAPH_THREAT_COLORS.lethal) },
        uClip: { value: this.clip },
        uArc: { value: arc },
        uSafe: { value: 0 },
        uPending: { value: 0 },
      };
      // Wakefire's two rungs: a char and a glow pool commute, so a crossing of
      // slices (two rounds) and bands composes the same from every angle.
      const { mesh: floor } = moltenDecal(
        {
          name: 'smithHeartHeatWheel',
          geometry: floorGeo,
          vertexShader: WHEEL_FLOOR_VERT,
          fragmentShader: floorFrag,
          uniforms: floorU,
          charStep: HEAT_FLOOR.zoneChar.step,
          glowStep: HEAT_FLOOR.zoneGlow.step,
        },
        host.materials,
      );
      // On the encounter band's zone rungs (moltenDecal lays both passes; the
      // char pass named here so the rung is read where the slice is built).
      floor.renderOrder = floorVfxRenderOrder('encounter', HEAT_FLOOR.zoneChar.step);
      host.root.add(floor);
      const ventU: Record<string, THREE.IUniform> = {
        uTime: host.uTime,
        uCenter: { value: this.centre },
        uPoly: { value: this.poly },
        uArc: { value: arc },
        uCount: { value: 0 },
        uBuild: floorU.uBuild,
        uErupt: floorU.uErupt,
        uBurn: floorU.uBurn,
        uGeysers: { value: 1 },
        uLow: { value: 0 },
      };
      const ventMat = new THREE.ShaderMaterial({
        name: 'smithHeartHeatWheelVents',
        uniforms: ventU,
        vertexShader: WHEEL_VENT_VERT,
        fragmentShader: ventFrag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      });
      host.materials.push(ventMat);
      const ventMesh = new THREE.Mesh(vents, ventMat);
      ventMesh.name = 'smithHeartHeatWheelVents';
      ventMesh.frustumCulled = false;
      ventMesh.visible = false;
      // In the air over every floor band, with the lava waves' fire.
      ventMesh.renderOrder = WALL_AIR_ORDER.fire;
      host.root.add(ventMesh);
      this.slots.push({
        id: -1,
        phase: null,
        born: 0,
        erupted: 0,
        seconds: 1,
        burnSeconds: T.wheelBurn,
        from: 0,
        to: 0,
        count: 0,
        slice: 0,
        quench: 0,
        dropped: 0,
        x: 0,
        y: 0,
        z: 0,
        floor,
        floorU,
        vents: ventMesh,
        ventU,
      });
    }
  }

  /** The claim's floor polygon and box in world yards (once per origin). */
  private place(origin: { x: number; z: number }): void {
    if (this.polyFor.x === origin.x && this.polyFor.z === origin.z) return;
    this.polyFor.x = origin.x;
    this.polyFor.z = origin.z;
    FORGE_POINTS.forEach(([x, z], i) => {
      if (i < WALL_POLY_N) this.poly[i].set(origin.x + x, origin.z + z);
    });
    this.clip.set(
      origin.x + FLOOR_BOX.x0,
      origin.x + FLOOR_BOX.x1,
      origin.z + FLOOR_BOX.z0,
      origin.z + FLOOR_BOX.z1,
    );
  }

  /** One frame: the slices standing (`ids`), the claim's `origin`. */
  update(
    world: IWorld,
    ids: readonly number[],
    origin: { x: number; z: number },
    clock: number,
    dt: number,
  ): void {
    this.place(origin);
    // A slice the sim has dropped: an erupted one cools, any other goes.
    for (const s of this.slots) {
      if (s.id < 0 || ids.includes(s.id)) continue;
      s.id = -1;
      if (s.phase === 'burn') {
        s.phase = 'gone';
        s.dropped = clock;
      } else this.free(s);
    }
    for (const id of ids) {
      const e = world.entities.get(id);
      const of = e ? wheelOfCached(e.templateId) : null;
      if (!e || !of) continue;
      let s = this.slots.find((x) => x.id === id);
      if (!s) {
        s = this.slots.find((x) => x.id < 0 && x.phase === null);
        // Every slot busy: the coolest scorch gives way.
        if (!s) s = this.oldestGone();
        if (!s) continue;
        s.id = id;
        s.phase = null;
      }
      if (s.phase !== of.state) {
        this.onState(of.state, e.pos.x, this.host.groundY(e.pos.x, e.pos.z), e.pos.z);
        s.phase = of.state;
        s.born = clock;
        s.seconds = of.seconds;
        if (of.state === 'burn') {
          s.erupted = clock;
          s.burnSeconds = of.seconds;
          s.quench = 0;
        }
        s.slice = of.slice;
        const arc = wheelArc(of.slice);
        s.from = arc.from;
        s.to = arc.to;
        s.count = wheelVentCount(arc.from, arc.to, this.host.detail);
        s.x = e.pos.x;
        s.z = e.pos.z;
        // The shore's floor (the wellspring's middle sits lower, in its pool).
        s.y = this.host.groundY(e.pos.x + HEARTH_WELL.r + 4, e.pos.z);
        if (of.state === 'burn') this.erupt(s);
      }
    }
    // A slice the next round marks safe while the last round still burns it:
    // its big geysers drop (the clutter), its fire floor and low flames stay
    // until the sim's burn really ends, and the safe sheet waits, its rim
    // only, until then (graphics fairness: no invisible damage).
    let safeMask = 0;
    let burnMask = 0;
    for (const s of this.slots) {
      if (s.phase === 'safe') safeMask |= 1 << s.slice;
      if (s.phase === 'burn') burnMask |= 1 << s.slice;
    }
    for (const s of this.slots) {
      if ((s.phase === 'burn' || s.phase === 'gone') && safeMask & (1 << s.slice))
        s.quench = Math.min(1, s.quench + dt / WHEEL_FX.quench);
      s.floorU.uPending.value = s.phase === 'safe' && burnMask & (1 << s.slice) ? 1 : 0;
    }
    this.shown = false;
    for (const s of this.slots) {
      if (s.phase === null) continue;
      if (s.phase === 'gone' && clock - s.erupted > wheelEruptSpan(s.burnSeconds)) {
        this.free(s);
        continue;
      }
      this.paint(s, clock, dt);
      this.shown = true;
    }
  }

  private oldestGone(): Slot | undefined {
    let best: Slot | undefined;
    for (const s of this.slots)
      if (s.phase === 'gone' && (!best || s.erupted < best.erupted)) best = s;
    if (best) this.free(best);
    return best;
  }

  private paint(s: Slot, clock: number, dt: number): void {
    const safe = s.phase === 'safe';
    const look =
      s.phase === 'warn'
        ? wheelWarnLook(clock - s.born, s.seconds, _look)
        : s.phase === 'burn' || s.phase === 'gone'
          ? wheelEruptLook(clock - s.erupted, s.burnSeconds, _look)
          : null;
    const u = s.floorU;
    (u.uArc.value as THREE.Vector4).set(s.x, s.z, s.from, s.to);
    (u.uRim.value as THREE.Color).setHex(safe ? SAFE_RIM : TELEGRAPH_THREAT_COLORS.lethal);
    u.uSafe.value = safe ? 1 : 0;
    u.uBuild.value = look ? look.build : 0;
    u.uThrob.value = look ? look.throb : 0;
    u.uErupt.value = look ? look.erupt : -1;
    const fire =
      look && (s.phase === 'burn' || s.phase === 'gone')
        ? wheelFireLook(look, s.phase === 'burn', clock - s.dropped, s.quench, _fire)
        : null;
    u.uBurn.value = fire ? fire.floor : 0;
    u.uScorch.value = look ? look.scorch : 0;
    s.ventU.uGeysers.value = fire ? fire.geysers : 1;
    s.ventU.uLow.value = fire ? fire.low : 0;
    s.floor.position.set(s.x, s.y + 0.1, s.z);
    s.floor.scale.set(T.wheelOuter, 1, T.wheelOuter);
    s.floor.visible = true;
    this.centre.set(s.x, s.y, s.z);
    s.ventU.uCount.value = s.count;
    s.vents.visible = !safe && s.count > 0;
    if (!look || safe) return;
    // Embers slipping out of the cracks as the warning nears; flames and
    // embers off the burning ground.
    const h = this.host;
    const rate =
      s.phase === 'warn'
        ? 10 * look.build * look.build
        : s.phase === 'burn'
          ? 14 * (fire ? fire.floor : 0)
          : 0;
    let n = rate * dt * h.density;
    while (n > 0) {
      if (h.rand() >= n) break;
      n -= 1;
      const i = Math.floor(h.rand() * s.count);
      if (!wheelVentAt(this.layout, i, s.from, s.to, _at)) continue;
      const x = s.x + _at[0];
      const z = s.z + _at[1];
      if (!this.onFloor(x, z)) continue;
      // Embers off the cracks and the burning ground; smoke over the fire.
      h.particles.puff(x, s.y + 0.4, z, 1, EMBER);
      if (s.phase === 'burn' && h.rand() < 0.5) h.particles.puff(x, s.y + 2.5, z, 1, SMOKE);
    }
  }

  /** A slice erupting: sparks flung up off its vents, flames, smoke, a shake. */
  private erupt(s: Slot): void {
    const h = this.host;
    for (let i = 0; i < s.count; i++) {
      if (!wheelVentAt(this.layout, i, s.from, s.to, _at)) continue;
      const x = s.x + _at[0];
      const z = s.z + _at[1];
      if (!this.onFloor(x, z)) continue;
      h.particles.puff(x, s.y + 0.4, z, 10, SPARK);
      h.particles.puff(x, s.y + 0.3, z, 2, FLAME);
      h.particles.puff(x, s.y + 3, z, 3, SMOKE);
      h.particles.puff(x, s.y + 0.5, z, 4, EMBER);
    }
    const mid = (s.from + s.to) / 2;
    h.shakeNear(s.x + Math.sin(mid) * 24, s.z + Math.cos(mid) * 24, 0.45, 40);
  }

  /** Inside the Hearth's floor box (the polygon clips the vents' draws). */
  private onFloor(x: number, z: number): boolean {
    return x > this.clip.x && x < this.clip.y && z > this.clip.z && z < this.clip.w;
  }

  private free(s: Slot): void {
    s.id = -1;
    s.phase = null;
    s.floor.visible = false;
    s.vents.visible = false;
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    for (const s of this.slots) this.free(s);
  }
}
