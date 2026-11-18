// The Guardian of the Heat's lava waves on screen (plan: heat_lava_wall_core.ts;
// shaders: heat_lava_wall_glsl.ts; the sim: encounters/smith_heart/heat_waves.ts),
// a part of HeatFightFx over its root: each ring of lava rolling out of the
// wellspring is a WALL OF FIRE.
//  - The wall: stacked sheets of animated fire standing on the ring (a
//    white-yellow core at the foot cooling to deep red tips that break into
//    licks), tongues of flame leaping off it and breaking away, a sheet of dark
//    smoke rolling up behind it lit from below, embers swirling up off it and
//    sparks flung ahead, a heat haze wavering over it. It rises out of the lip as
//    the ring leaves and sinks into the Hearth's walls at the end; the flames
//    part at each corridor and lean back from its edges.
//  - Its foot on the floor (the Heat's floor ladder, `wallChar`/`wallGlow`): the
//    molten band at the sim's own front and wall depth, the floor ahead lit by
//    the fire coming, the scorched basalt cooling behind it, dark crust through
//    the corridors with their parted edges glowing.
//  - The corridors on the floor (the fight's warning glow rung, additive): the
//    next ring's from the lip out to the newest ring's front, throbbing quicker
//    to its launch; each rolling ring's ahead of its front (corridorSpans: every
//    yard of floor shows the one pair that saves whoever stands there).
//  - Its roar: a loop at the nearest burning point of the nearest wall, louder as
//    it comes (game/smith_heart_heat_audio.ts), and a rush as a wall passes you.
// The wall, its foot and every corridor draw on EVERY tier (where the fire is
// and where it parts is what a player acts on); the low tier keeps one sheet and
// sheds the smoke, the haze and most tongues and embers (wallBudget).
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the host's root (one gated attach, so every program links
// before the first ring); fixed pools (LAVA_WALL_POOLS); no per-frame
// allocation; its one light is the budgeted glow on the raid near a wall
// (heat_lava_wall_light.ts, a dynamic source of the renderer's point-light
// budget, handed down by RiftDeathZoneVisuals). The wall stands in the air, so its sheets, tongues,
// embers and haze are drawn after every floor mark (WALL_AIR_ORDER, above the
// floor ladder's bands: no floor mark paints over its foot); its foot and the
// corridors are on the ladder.

import * as THREE from 'three';
import { FORGE_POINTS, HEARTH_WELL } from '../../sim/content/smith_heart_layout';
import { HEAT_TUNING as T } from '../../sim/encounters/smith_heart/heat_ids';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { BudgetPointLightRegistry } from '../point_light_budget';
import { gapOfCached, ringOfCached } from './heat_fight_fx_core';
import { fireRampGlsl } from './heat_flame_core';
import { HEAT_FLOOR } from './heat_floor_ladder_core';
import type { HeatFxHost } from './heat_fx_host';
import { HEAT_LAVA_GLSL, HEAT_MOLTEN_GLSL, HEAT_NOISE_GLSL } from './heat_lava_glsl';
import {
  corridorSpanPool,
  corridorSpans,
  type GapWarnLook,
  gapWarnLook,
  LAVA_WALL,
  LAVA_WALL_POOLS,
  ringFront,
  type WallLook,
  wallBudget,
  wallLook,
  wallRoar,
} from './heat_lava_wall_core';
import {
  WALL_BAND_VERT,
  WALL_CORRIDOR_FRAG,
  WALL_CORRIDOR_VERT,
  WALL_CURTAIN_VERT,
  WALL_EMBER_FRAG,
  WALL_EMBER_VERT,
  WALL_GLOW_FRAG,
  WALL_HAZE_FRAG,
  WALL_POLY_N,
  WALL_SMOKE_FRAG,
  WALL_TONGUE_VERT,
  wallBandFrag,
  wallFireFrag,
  wallTongueFrag,
} from './heat_lava_wall_glsl';
import { HeatWallLights, type WallLightRing } from './heat_lava_wall_light';
import { moltenDecal } from './heat_molten_decal';

/** The wall's in-air layers' order: after the floor ladder's every band
 *  (ground, player, encounter, reticle end at 53), before the camera overlays
 *  (9990): smoke first, the wall's dark body, then the glow and the fire over
 *  it, its tongues, its embers, its haze. */
export const WALL_AIR_ORDER = {
  smoke: 60,
  dark: 61,
  glow: 62,
  fire: 63,
  tongues: 64,
  embers: 65,
  haze: 66,
} as const;

const _look: WallLook = { rise: 0, heat: 0 };
const _warn: GapWarnLook = { fill: 0, beat: 0, glow: 0 };

/** A small deterministic hash in [0, 1) (the layout of tongues and embers). */
function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2d7a3f91) ^ Math.imul(b | 0, 0x1b873593)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The curtain: `sheets` sheets round the ring, each a strip of quads, its
 *  bearing and height in `position`, its sheet's offset and seed in aSheet. */
function curtainGeometry(sheets: readonly (readonly [number, number])[]): THREE.BufferGeometry {
  const seg = LAVA_WALL.segments;
  const hs = LAVA_WALL.heightSegments;
  const per = (seg + 1) * (hs + 1);
  const pos = new Float32Array(per * sheets.length * 3);
  const sh = new Float32Array(per * sheets.length * 2);
  const idx: number[] = [];
  sheets.forEach(([off, seed], s) => {
    const base = s * per;
    for (let i = 0; i <= seg; i++)
      for (let j = 0; j <= hs; j++) {
        const k = base + i * (hs + 1) + j;
        pos[k * 3] = i / seg;
        pos[k * 3 + 1] = j / hs;
        pos[k * 3 + 2] = 0;
        sh[k * 2] = off;
        sh[k * 2 + 1] = seed;
      }
    for (let i = 0; i < seg; i++)
      for (let j = 0; j < hs; j++) {
        const a = base + i * (hs + 1) + j;
        const b = a + hs + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSheet', new THREE.BufferAttribute(sh, 2));
  g.setIndex(idx);
  return g;
}

/** The foot's band: a grid of bearings by rows (behind to ahead). */
function bandGeometry(): THREE.BufferGeometry {
  const seg = LAVA_WALL.segments;
  const rows = 28;
  const pos = new Float32Array((seg + 1) * (rows + 1) * 3);
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++)
    for (let j = 0; j <= rows; j++) {
      const k = i * (rows + 1) + j;
      pos[k * 3] = i / seg;
      pos[k * 3 + 1] = j / rows;
    }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      const b = a + rows + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** A corridor strip: across -1..1, along 0..1. */
function corridorGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(2, 1, 4, 24);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i), pos.getY(i) + 0.5, 0);
  return g;
}

interface RingSlot {
  id: number;
  born: number;
  front: number;
  /** Its corridors' bearings and half width this frame. */
  gaps: number[];
  half: number;
  /** The listener's distance as last seen (a wall passing them rushes). */
  heard: number;
  uniforms: Record<string, THREE.IUniform>;
  meshes: THREE.Object3D[];
  band: THREE.Mesh;
}

interface CorridorSlot {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
}

export class HeatLavaWallFx {
  private readonly rings: RingSlot[] = [];
  private readonly corridors: CorridorSlot[] = [];
  private readonly poly: THREE.Vector2[] = Array.from(
    { length: WALL_POLY_N },
    () => new THREE.Vector2(),
  );
  private readonly polyFor = { x: Number.NaN, z: Number.NaN };
  private readonly center = new THREE.Vector3();
  /** The next ring's corridors (the warning objects, gathered each frame). */
  private readonly nextGaps: number[] = [];
  private readonly gapSeen = new Map<number, number>();
  private readonly spans = corridorSpanPool(LAVA_WALL_POOLS.rings + 1);
  /** The rings standing this frame (their slots' own records, reused). */
  private readonly live: { front: number; gaps: readonly number[]; half: number }[] = [];
  private readonly next = { gaps: this.nextGaps as readonly number[], half: 0 };
  private nextHalf = 0;
  private nextAge = 0;
  private nextSeconds = 1;
  private shown = false;

  /** The wall lighting the raid (one budgeted light per ring). */
  readonly lights: HeatWallLights;
  private readonly lightRings: WallLightRing[] = [];

  constructor(
    private readonly host: HeatFxHost,
    pointLights: BudgetPointLightRegistry | null = null,
  ) {
    this.lights = new HeatWallLights(host.root, LAVA_WALL_POOLS.rings, pointLights);
    const budget = wallBudget(host.detail);
    const all: readonly (readonly [number, number])[] = [
      [0, 0.13],
      [-0.75, 0.57],
      [0.7, 0.91],
    ];
    const sheets = all.slice(0, budget.sheets);
    const curtain = curtainGeometry(sheets);
    const single = curtainGeometry([[-0.55, 0.37]]);
    const band = bandGeometry();
    const strip = corridorGeometry();
    const tongueQuad = new THREE.PlaneGeometry(1, 1, 1, 10);
    host.geometries.push(curtain, single, band, strip, tongueQuad);
    const ramp = fireRampGlsl('fireRamp');
    const fireFrag = wallFireFrag(ramp);
    const tongueFrag = wallTongueFrag(ramp);
    const bandFrag = wallBandFrag(HEAT_NOISE_GLSL, HEAT_MOLTEN_GLSL, HEAT_LAVA_GLSL);

    for (let r = 0; r < LAVA_WALL_POOLS.rings; r++) {
      const shared: Record<string, THREE.IUniform> = {
        uCenter: { value: new THREE.Vector3() },
        uR: { value: T.ringStart },
        uGaps: { value: new THREE.Vector4(0, Math.PI, 3, 2) },
        uPoly: { value: this.poly },
        uRise: { value: 0 },
        uTime: host.uTime,
        uHeat: { value: 1 },
      };
      const meshes: THREE.Object3D[] = [];
      const air = (
        name: string,
        geometry: THREE.BufferGeometry,
        uniforms: Record<string, THREE.IUniform>,
        vertexShader: string,
        fragmentShader: string,
        blending: THREE.Blending,
        order: number,
        points = false,
        defines: Record<string, string> = {},
      ): THREE.Object3D => {
        const mat = new THREE.ShaderMaterial({
          name,
          uniforms,
          defines,
          vertexShader,
          fragmentShader,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending,
          toneMapped: false,
          fog: false,
        });
        host.materials.push(mat);
        const obj = points ? new THREE.Points(geometry, mat) : new THREE.Mesh(geometry, mat);
        obj.name = name;
        obj.frustumCulled = false;
        obj.visible = false;
        obj.renderOrder = order;
        host.root.add(obj);
        meshes.push(obj);
        return obj;
      };
      // The fire's sheets.
      air(
        'smithHeartHeatWallFire',
        curtain,
        {
          ...shared,
          uH: { value: LAVA_WALL.height },
          uLift: { value: 0 },
          // Stacked sheets sum: each one dimmer, so the wall's core never
          // burns out to a flat white band.
          uGain: { value: budget.sheets > 1 ? 0.62 : 1 },
        },
        WALL_CURTAIN_VERT,
        fireFrag,
        THREE.AdditiveBlending,
        WALL_AIR_ORDER.fire,
      );
      // The wall's dark body under the fire (every tier: it is the wall's
      // shape against the bright Hearth).
      air(
        'smithHeartHeatWallBody',
        single,
        {
          ...shared,
          uH: { value: LAVA_WALL.height * 1.08 },
          uLift: { value: 0 },
          uGain: { value: 1 },
        },
        WALL_CURTAIN_VERT,
        fireFrag,
        THREE.NormalBlending,
        WALL_AIR_ORDER.dark,
        false,
        { WALL_DARK: '' },
      );
      // The air lit round it (every tier: it is how far the wall reads).
      air(
        'smithHeartHeatWallGlow',
        single,
        { ...shared, uH: { value: LAVA_WALL.height * 1.5 }, uLift: { value: 0 } },
        WALL_CURTAIN_VERT,
        WALL_GLOW_FRAG,
        THREE.AdditiveBlending,
        WALL_AIR_ORDER.glow,
      );
      if (budget.smoke)
        air(
          'smithHeartHeatWallSmoke',
          single,
          { ...shared, uH: { value: LAVA_WALL.height * 2.1 }, uLift: { value: 0 } },
          WALL_CURTAIN_VERT,
          WALL_SMOKE_FRAG,
          THREE.NormalBlending,
          WALL_AIR_ORDER.smoke,
        );
      if (budget.haze)
        air(
          'smithHeartHeatWallHaze',
          single,
          { ...shared, uH: { value: LAVA_WALL.height * 1.3 }, uLift: { value: 0.55 } },
          WALL_CURTAIN_VERT,
          WALL_HAZE_FRAG,
          THREE.AdditiveBlending,
          WALL_AIR_ORDER.haze,
        );
      // The tongues: one instanced draw.
      const tg = new THREE.InstancedBufferGeometry();
      tg.index = tongueQuad.index;
      tg.setAttribute('position', tongueQuad.getAttribute('position'));
      const ta = new Float32Array(budget.tongues * 2);
      for (let i = 0; i < budget.tongues; i++) {
        ta[i * 2] = (i + 0.8 * hash01(i, 11 + r)) / budget.tongues;
        ta[i * 2 + 1] = hash01(i, 29 + r);
      }
      tg.setAttribute('aTongue', new THREE.InstancedBufferAttribute(ta, 2));
      tg.instanceCount = budget.tongues;
      host.geometries.push(tg);
      air(
        'smithHeartHeatWallTongues',
        tg,
        { ...shared, uTongue: { value: LAVA_WALL.tongue } },
        WALL_TONGUE_VERT,
        tongueFrag,
        THREE.AdditiveBlending,
        WALL_AIR_ORDER.tongues,
      );
      // The embers and sparks: one point draw.
      const eg = new THREE.BufferGeometry();
      const n = budget.embers;
      eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const ea = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        ea[i * 4] = hash01(i, 101 + r);
        ea[i * 4 + 1] = hash01(i, 131 + r);
        ea[i * 4 + 2] = 0.32 + 0.5 * hash01(i, 151 + r);
        ea[i * 4 + 3] = 0.16 + 0.26 * hash01(i, 171 + r);
      }
      eg.setAttribute('aEmber', new THREE.BufferAttribute(ea, 4));
      host.geometries.push(eg);
      air(
        'smithHeartHeatWallEmbers',
        eg,
        { ...shared, uPx: { value: 900 } },
        WALL_EMBER_VERT,
        WALL_EMBER_FRAG,
        THREE.AdditiveBlending,
        WALL_AIR_ORDER.embers,
        true,
      );
      // The foot on the floor: the ladder's char and glow.
      const decal = moltenDecal(
        {
          name: 'smithHeartHeatWallFoot',
          geometry: band,
          vertexShader: WALL_BAND_VERT,
          fragmentShader: bandFrag,
          uniforms: {
            ...shared,
            uBehind: { value: LAVA_WALL.scorchBehind },
            uAhead: { value: LAVA_WALL.lightAhead },
          },
          charStep: HEAT_FLOOR.wallChar.step,
          glowStep: HEAT_FLOOR.wallGlow.step,
        },
        host.materials,
      );
      // Laid flat by its vertex shader whichever way its grid winds.
      decal.mat.side = THREE.DoubleSide;
      decal.glowMat.side = THREE.DoubleSide;
      host.root.add(decal.mesh);
      this.rings.push({
        id: -1,
        born: 0,
        front: T.ringStart,
        gaps: [],
        half: 0,
        heard: Number.NaN,
        uniforms: shared,
        meshes,
        band: decal.mesh,
      });
    }

    for (let i = 0; i < LAVA_WALL_POOLS.corridors; i++) {
      const uniforms: Record<string, THREE.IUniform> = {
        uCenter: { value: new THREE.Vector3() },
        uGap: { value: 0 },
        uHalf: { value: 3 },
        uFrom: { value: T.ringStart },
        uTo: { value: T.ringEnd },
        uTime: host.uTime,
        uGlow: { value: 0 },
        uBeat: { value: 0 },
        uWarn: { value: 1 },
        uPoly: { value: this.poly },
      };
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartHeatWallCorridor',
        uniforms,
        vertexShader: WALL_CORRIDOR_VERT,
        fragmentShader: WALL_CORRIDOR_FRAG,
        transparent: true,
        depthWrite: false,
        // Laid flat by its vertex shader whichever way its strip winds.
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      host.materials.push(mat);
      const mesh = new THREE.Mesh(strip, mat);
      mesh.name = 'smithHeartHeatWallCorridor';
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', HEAT_FLOOR.fightTelegraphGlow.step);
      host.root.add(mesh);
      this.corridors.push({ mesh, uniforms });
    }
  }

  /** The claim's floor polygon in world yards (once per origin). */
  private placePoly(origin: { x: number; z: number }): void {
    if (this.polyFor.x === origin.x && this.polyFor.z === origin.z) return;
    this.polyFor.x = origin.x;
    this.polyFor.z = origin.z;
    FORGE_POINTS.forEach(([x, z], i) => {
      if (i < WALL_POLY_N) this.poly[i].set(origin.x + x, origin.z + z);
    });
  }

  /** One frame: the rings (`ringIds`) and the next ring's corridors
   *  (`gapIds`), the claim's `origin`, the local player for the roar. Returns
   *  the roar's point and closeness (null with no wall standing). */
  update(
    world: IWorld,
    ringIds: readonly number[],
    gapIds: readonly number[],
    origin: { x: number; z: number },
    clock: number,
    me: Entity | null,
    onPass: (x: number, y: number, z: number) => void,
  ): { x: number; y: number; z: number; near: number } | null {
    this.placePoly(origin);
    const cx = origin.x + HEARTH_WELL.x;
    const cz = origin.z + HEARTH_WELL.z;
    // The shore's floor (the wellspring's middle sits lower, in its pool).
    this.center.set(cx, this.host.groundY(cx + HEARTH_WELL.r + 4, cz), cz);
    const myD = me && !me.dead ? ringFront(me.pos.x - origin.x, me.pos.z - origin.z) : Number.NaN;
    // ---- the rings ----
    for (const s of this.rings) {
      if (s.id < 0 || ringIds.includes(s.id)) continue;
      this.freeRing(s);
    }
    this.live.length = 0;
    for (const id of ringIds) {
      const e = world.entities.get(id);
      const of = e ? ringOfCached(e.templateId) : null;
      if (!e || !of) continue;
      let s = this.rings.find((r) => r.id === id);
      if (!s) {
        s = this.rings.find((r) => r.id < 0);
        if (!s) continue;
        s.id = id;
        s.born = clock;
        s.heard = Number.NaN;
      }
      s.front = ringFront(e.pos.x - origin.x, e.pos.z - origin.z);
      s.gaps = of.gaps;
      s.half = e.scale || 3;
      const look = wallLook(clock - s.born, s.front, _look);
      const u = s.uniforms;
      (u.uCenter.value as THREE.Vector3).copy(this.center);
      u.uR.value = s.front;
      (u.uGaps.value as THREE.Vector4).set(
        of.gaps[0] ?? 0,
        of.gaps[1] ?? 0,
        s.half,
        Math.min(2, of.gaps.length),
      );
      u.uRise.value = look.rise;
      u.uHeat.value = look.heat;
      for (const m of s.meshes) m.visible = true;
      s.band.visible = true;
      this.live.push(s);
      // A wall rolling past the listener: its rush in their ear.
      if (me && Number.isFinite(myD) && Number.isFinite(s.heard) && s.heard < myD && s.front >= myD)
        onPass(me.pos.x, me.pos.y + 1.2, me.pos.z);
      s.heard = s.front;
    }
    // ---- the next ring's corridors ----
    this.nextGaps.length = 0;
    this.nextHalf = 0;
    for (const id of gapIds) {
      const e = world.entities.get(id);
      const seconds = e ? gapOfCached(e.templateId) : null;
      if (!e || seconds === null) continue;
      let born = this.gapSeen.get(id);
      if (born === undefined) {
        born = clock;
        this.gapSeen.set(id, born);
      }
      this.nextGaps.push(e.facing);
      this.nextHalf = e.scale || 3;
      this.nextAge = clock - born;
      this.nextSeconds = seconds;
    }
    if (this.gapSeen.size > 32)
      for (const id of this.gapSeen.keys()) if (!gapIds.includes(id)) this.gapSeen.delete(id);
    this.next.half = this.nextHalf;
    const spans = corridorSpans(this.live, this.nextGaps.length > 0 ? this.next : null, this.spans);
    const warn = gapWarnLook(this.nextAge, this.nextSeconds, _warn);
    let c = 0;
    for (let k = 0; k < spans; k++)
      for (const g of this.spans[k].gaps) {
        const span = this.spans[k];
        const slot = this.corridors[c++];
        if (!slot) break;
        const u = slot.uniforms;
        (u.uCenter.value as THREE.Vector3).copy(this.center);
        u.uGap.value = g;
        u.uHalf.value = span.half;
        u.uFrom.value = span.from;
        u.uTo.value = span.to;
        u.uWarn.value = span.warn ? 1 : 0;
        u.uGlow.value = span.warn ? warn.glow : 0.85;
        u.uBeat.value = span.warn ? warn.beat : 0.6;
        slot.mesh.visible = span.to - span.from > 0.5;
      }
    for (; c < this.corridors.length; c++) this.corridors[c].mesh.visible = false;
    this.shown = this.live.length > 0 || spans > 0;
    // ---- the light on the raid ----
    this.lightRings.length = 0;
    for (const s of this.rings)
      if (s.id >= 0)
        this.lightRings.push({
          front: s.front,
          gaps: s.gaps,
          half: s.half,
          rise: s.uniforms.uRise.value as number,
        });
    this.lights.update(
      this.lightRings,
      me && !me.dead ? { x: me.pos.x - origin.x, z: me.pos.z - origin.z } : null,
      origin,
      this.center.y,
      clock,
    );
    // ---- the roar ----
    if (!me || this.live.length === 0) return null;
    const roar = wallRoar(this.live, me.pos.x - origin.x, me.pos.z - origin.z);
    if (!roar) return null;
    return {
      x: origin.x + roar.x,
      y: this.center.y + 2,
      z: origin.z + roar.z,
      near: roar.near,
    };
  }

  private freeRing(s: RingSlot): void {
    s.id = -1;
    for (const m of s.meshes) m.visible = false;
    s.band.visible = false;
    s.uniforms.uRise.value = 0;
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    for (const s of this.rings) this.freeRing(s);
    for (const c of this.corridors) c.mesh.visible = false;
    this.gapSeen.clear();
    this.lights.hide();
  }

  /** Terminal: the wall's lights out of the budget. */
  dispose(): void {
    this.lights.dispose();
  }
}
