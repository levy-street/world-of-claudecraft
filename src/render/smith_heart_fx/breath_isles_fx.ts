// The Islands of the Wind (encounters/smith_heart/breath_isles.ts), a part of
// BreathFightFx (plan: breath_isles_fx_core.ts):
//
//  - the two floating isles, always: the Breath kit's Blender sculpts
//    (Kit_WindIsleA, B: the walk flat at the very floor you stand on, the
//    craggy lip with its wind-rune stones, the crag hanging under it with
//    its roots, vines, crystal and broken stone chain), riding the wind on a
//    slow bob that eases all but still while the round is on; a ring of wind
//    runes on each walk (awake, they burn and race), mist under them, and
//    the kit's stones drifting round them in the open air;
//  - on EVERY tier (the raid acts on them): Thessaly's Updrafts on the
//    Cornice and on each isle (a wheeling wind disc on the floor, a column
//    of wind over it with two ribbons spiralling up round a bright core, and
//    the route of wind it will carry you on, drawn along the ride's own arc
//    to the next isle); its rising (ISLE_CUES.padUp) a burst of wind;
//  - the 50 percent phase's parts: the Gale Cocoon and Skyrend Nova with
//    their seals (breath_cocoon_fx.ts), each isle's Closing Storm and Sky's
//    Reckoning (breath_isle_storm_fx.ts), the Stillstones
//    (breath_stillstone_fx.ts), the adds' lane, ward, beams and split
//    (breath_isle_adds_fx.ts), and the ride itself, its launch and its
//    landing (breath_ride_fx.ts);
//  - cosmetic (thinned on the low tier): the drifting stones' count, the
//    motes, the isles' life (mist streaming off each hang and away on the
//    wind, grit falling from under the turf's lip, dust sifting off the
//    crag: ISLE_LIFE, from the shared particle pools, no new program).
//
// Built in the constructor under the host's root and local group (its one
// gated attach); the kit's pieces join their isles the moment that kit has
// landed (its shared slot programs are linked with the interior, so nothing
// links in a live frame); no light; fixed pools; no per-frame allocation.

import * as THREE from 'three';
import { BREATH_ISLES } from '../../sim/content/smith_heart_layout';
import {
  ISLE_AURAS,
  ISLE_CUES,
  ISLE_MOBS,
  padOf,
} from '../../sim/encounters/smith_heart/breath_isle_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { TelegraphKit } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  HEART_KIT_SLOTS,
  heartKitMeshes,
  heartKitPiece,
  heartKitSlotMaterial,
  SMITH_HEART_BREATH_KIT_URL,
} from '../smith_heart/heart_kit';
import { radialGlowTexture } from '../textures';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { BreathCocoonFx } from './breath_cocoon_fx';
import { CORNICE_FLOOR_H } from './breath_fight_fx_core';
import { BreathIsleAddsFx } from './breath_isle_adds_fx';
import { BreathIsleStormFx } from './breath_isle_storm_fx';
import {
  ISLE_COLORS as C,
  circleLook,
  circleRoute,
  driftStone,
  ISLE_KIT,
  ISLE_LIFE,
  ISLE_PADS,
  ISLE_SHARD,
  type IsleMote,
  isleBob,
  isleDepth,
  isleGrit,
  isleMist,
  isleObjectKind,
  isleRuneRing,
  ISLE_POOLS as P,
  padSpot,
  ISLE_RGB as RGB,
  RIDE,
} from './breath_isles_fx_core';
import {
  ISLE_COLUMN_FRAG,
  ISLE_DISC_FRAG,
  ISLE_RIBBON_FRAG,
  ISLE_RUNE_FRAG,
  ISLE_UV_VERT,
} from './breath_isles_glsl';
import { BreathRideFx, ribbonGeometry } from './breath_ride_fx';
import { BreathStillstoneFx } from './breath_stillstone_fx';
import type { BreathTelegraphs } from './painted_telegraphs';

/** What BreathFightFx lends this part (a type-only seam). */
export interface BreathIslesHost {
  /** World space. */
  readonly root: THREE.Group;
  /** Instance-local, its y the sim's heights (the claim's floor offset). */
  readonly local: THREE.Group;
  readonly particles: EngineParticles;
  readonly uTime: { value: number };
  readonly density: number;
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  groundY(x: number, z: number): number;
  shakeNear(x: number, z: number, amount: number, reach?: number): void;
  /** The fight's floor telegraph kit and the Breath's paints (the Herald's
   *  lane wears the wind's). */
  readonly kit: TelegraphKit;
  readonly paints: BreathTelegraphs;
}

interface CircleSlot {
  from: number;
  to: number;
  group: THREE.Group;
  disc: THREE.ShaderMaterial;
  column: THREE.ShaderMaterial;
  route: THREE.ShaderMaterial;
  helix: THREE.ShaderMaterial;
  core: THREE.Mesh;
  helixGroup: THREE.Group;
  id: number;
  born: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _stone = { x: 0, y: 0, z: 0, spin: 0, size: 0 };
const _bob = { y: 0, rx: 0, rz: 0 };
const _mote: IsleMote = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
const MIST_RGB = [0.86, 0.9, 0.95] as const;
/** An Updraft's column (yards): tall enough to read from the next isle. */
const PAD_HEIGHT = 16;
const _stilled: [boolean, boolean] = [false, false];
const GRIT_RGB = [0.36, 0.34, 0.33] as const;
const DUST_RGB = [0.74, 0.72, 0.68] as const;

export class BreathIslesFx {
  private readonly circles: CircleSlot[] = [];
  private readonly runeMats: THREE.ShaderMaterial[] = [];
  private readonly wake: number[] = BREATH_ISLES.map(() => 0);
  /** Each isle's calm (0 free on the wind, 1 held still for the round). */
  private readonly calm: number[] = BREATH_ISLES.map(() => 0);
  private readonly held: number[] = BREATH_ISLES.map(() => 0);
  /** Each isle's bobbing group (instance-local, at its floor). */
  private readonly isles: THREE.Group[] = [];
  /** The kit's sculpt is on each isle (it lands late at most once). */
  private readonly dressed: boolean[] = BREATH_ISLES.map(() => false);
  private stones: THREE.InstancedMesh[] = [];
  private readonly mists: THREE.Sprite[] = [];
  private readonly mistMat: THREE.SpriteMaterial;
  /** The mist's soft disc (none without a DOM: a headless test host). */
  private readonly glow: THREE.Texture | null =
    typeof document !== 'undefined' ? radialGlowTexture() : null;
  private readonly cocoon: BreathCocoonFx;
  private readonly storm: BreathIsleStormFx;
  private readonly stillstones: BreathStillstoneFx;
  private readonly adds: BreathIsleAddsFx;
  private readonly ride: BreathRideFx;
  // The scan's findings (reused).
  private guardianId = -1;
  private cocoonUp = false;
  private cocoonStilled = 0;
  private readonly seenCircles: number[] = [];
  private readonly seenRiders: number[] = [];
  private readonly isleMobs: number[] = [];
  private clock = 0;
  private seed = 0x7a31;

  constructor(private readonly h: BreathIslesHost) {
    // ---- the isles (always) ----
    BREATH_ISLES.forEach((isle, i) => {
      const group = new THREE.Group();
      group.name = `smithHeartBreathIsle${i}`;
      group.position.set(isle.x, isle.h, isle.z);
      h.local.add(group);
      this.isles.push(group);
      // The ring of wind runes on its walk (it rides with the isle).
      const ring = isleRuneRing(i);
      const runeGeo = new THREE.RingGeometry(ring.inner, ring.outer, 72, 1);
      // RingGeometry's uv is planar: rewrite it to (round, across).
      const pos = runeGeo.getAttribute('position');
      const uv = runeGeo.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k);
        const y = pos.getY(k);
        const a = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1;
        const r = Math.hypot(x, y);
        uv.setXY(k, a, (r - ring.inner) / (ring.outer - ring.inner));
      }
      runeGeo.rotateX(-Math.PI / 2);
      runeGeo.translate(0, 0.07, 0);
      h.geometries.push(runeGeo);
      const runeMat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathIsleRunes',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(C.rune) },
          uWake: { value: 0 },
        },
        vertexShader: ISLE_UV_VERT,
        fragmentShader: ISLE_RUNE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      h.materials.push(runeMat);
      this.runeMats.push(runeMat);
      const rune = new THREE.Mesh(runeGeo, runeMat);
      rune.renderOrder = floorVfxRenderOrder('encounter', 4);
      group.add(rune);
    });
    // A veil of mist under each isle, its crystal's light in it when the
    // isle wakes (soft, additive; one draw each, the low tier keeps it).
    this.mistMat = new THREE.SpriteMaterial({
      map: this.glow,
      color: C.mist,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      name: 'smithHeartBreathIsleMist',
    });
    h.materials.push(this.mistMat);
    BREATH_ISLES.forEach((isle, i) => {
      const depth = isleDepth(i);
      for (let k = 0; k < 4; k++) {
        const sp = new THREE.Sprite(this.mistMat);
        const a = (k / 4) * Math.PI * 2 + i;
        sp.position.set(
          Math.sin(a) * isle.r * 0.5,
          -depth * (0.3 + 0.2 * k),
          Math.cos(a) * isle.r * 0.5,
        );
        sp.scale.setScalar(isle.r * (2.8 - 0.4 * k));
        this.mists.push(sp);
        this.isles[i].add(sp);
      }
    });
    this.dressIsles();

    // ---- the circles and their routes (every tier) ----
    const discGeo = new THREE.PlaneGeometry(1, 1);
    discGeo.rotateX(-Math.PI / 2);
    const colGeo = new THREE.CylinderGeometry(0.8, 1.15, 1, 28, 1, true);
    colGeo.translate(0, 0.5, 0);
    const coreGeo = new THREE.CylinderGeometry(0.18, 0.4, 1, 12, 1, true);
    coreGeo.translate(0, 0.5, 0);
    // The two ribbons spiralling up the column (unit radius, unit height).
    const helixGeos: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 2; k++) {
      const pts: { x: number; y: number; z: number }[] = [];
      for (let i = 0; i <= 64; i++) {
        const f = i / 64;
        const a = f * Math.PI * 2 * 2.25 + k * Math.PI;
        const r = 1 - 0.35 * f;
        pts.push({ x: Math.sin(a) * r, y: f, z: Math.cos(a) * r });
      }
      const g = ribbonGeometry(pts, 0.022, true);
      helixGeos.push(g);
    }
    h.geometries.push(discGeo, colGeo, coreGeo, ...helixGeos);
    for (const pad of ISLE_PADS) {
      {
        const color = C.path;
        const core = C.pathCore;
        const spot = padSpot(pad.from, pad.to, CORNICE_FLOOR_H);
        const at = { x: spot.x, z: spot.z };
        const y = spot.y + 0.08;
        const group = new THREE.Group();
        group.visible = false;
        const disc = new THREE.ShaderMaterial({
          name: 'smithHeartBreathGaleDisc',
          uniforms: {
            uTime: h.uTime,
            uColor: { value: new THREE.Color(color) },
            uCore: { value: new THREE.Color(core) },
            uGlow: { value: 1 },
            uOpen: { value: 0 },
            uSpin: { value: 1 },
          },
          vertexShader: ISLE_UV_VERT,
          fragmentShader: ISLE_DISC_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        });
        const discMesh = new THREE.Mesh(discGeo, disc);
        discMesh.scale.set(RIDE.circleR * 2.4, 1, RIDE.circleR * 2.4);
        discMesh.position.set(at.x, y, at.z);
        discMesh.renderOrder = floorVfxRenderOrder('encounter', 18);
        group.add(discMesh);
        const column = new THREE.ShaderMaterial({
          name: 'smithHeartBreathGaleColumn',
          uniforms: {
            uTime: h.uTime,
            uColor: { value: new THREE.Color(color) },
            uGlow: { value: 1 },
            uOpen: { value: 0 },
          },
          vertexShader: ISLE_UV_VERT,
          fragmentShader: ISLE_COLUMN_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
        const colMesh = new THREE.Mesh(colGeo, column);
        colMesh.scale.set(RIDE.circleR * 0.95, PAD_HEIGHT, RIDE.circleR * 0.95);
        colMesh.position.set(at.x, y, at.z);
        group.add(colMesh);
        // The bright core of the updraft, and its two spiralling ribbons.
        const coreMesh = new THREE.Mesh(coreGeo, column);
        coreMesh.scale.set(1, PAD_HEIGHT * 1.25, 1);
        coreMesh.position.set(at.x, y, at.z);
        group.add(coreMesh);
        const helix = new THREE.ShaderMaterial({
          name: 'smithHeartBreathUpdraftHelix',
          uniforms: {
            uTime: h.uTime,
            uColor: { value: new THREE.Color(color) },
            uCore: { value: new THREE.Color(C.pathCore) },
            uGlow: { value: 0 },
            uFlow: { value: 2.2 },
            uDash: { value: 4 },
            uFade: { value: 0.12 },
          },
          vertexShader: ISLE_UV_VERT,
          fragmentShader: ISLE_RIBBON_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
        const helixGroup = new THREE.Group();
        helixGroup.position.set(at.x, y + 0.2, at.z);
        helixGroup.scale.set(RIDE.circleR * 1.05, PAD_HEIGHT * 0.95, RIDE.circleR * 1.05);
        for (const g of helixGeos) {
          const hm = new THREE.Mesh(g, helix);
          hm.frustumCulled = false;
          helixGroup.add(hm);
        }
        group.add(helixGroup);
        // The route: two crossed ribbons along the ride's own arc.
        const pts = circleRoute(pad.from, pad.to, 48, { cornice: CORNICE_FLOOR_H + 1.1 });
        const route = new THREE.ShaderMaterial({
          name: 'smithHeartBreathGaleRoute',
          uniforms: {
            uTime: h.uTime,
            uColor: { value: new THREE.Color(color) },
            uCore: { value: new THREE.Color(core) },
            uGlow: { value: 0 },
            uFlow: { value: 0.9 },
            uDash: { value: 9 },
            uFade: { value: 0.06 },
          },
          vertexShader: ISLE_UV_VERT,
          fragmentShader: ISLE_RIBBON_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
        for (const upright of [false, true]) {
          const rg = ribbonGeometry(pts, 0.75, upright);
          h.geometries.push(rg);
          const rm = new THREE.Mesh(rg, route);
          rm.frustumCulled = false;
          group.add(rm);
        }
        h.materials.push(disc, column, route, helix);
        h.local.add(group);
        this.circles.push({
          from: pad.from,
          to: pad.to,
          group,
          disc,
          column,
          route,
          helix,
          core: coreMesh,
          helixGroup,
          id: -1,
          born: 0,
        });
      }
    }

    // ---- the phase's parts, the ride (every tier) ----
    this.cocoon = new BreathCocoonFx(h, this.glow);
    this.storm = new BreathIsleStormFx(h, this.isles);
    this.stillstones = new BreathStillstoneFx(h, this.isles, this.glow);
    this.adds = new BreathIsleAddsFx(h, { kit: h.kit, paints: h.paints });
    this.ride = new BreathRideFx(h);
  }

  /** Put the kit's sculpts on the isles and its stones round them, once
   *  that kit has landed (true when every isle is dressed). */
  private dressIsles(): boolean {
    let all = true;
    BREATH_ISLES.forEach((_, i) => {
      if (this.dressed[i]) return;
      const kit = ISLE_KIT[i % ISLE_KIT.length];
      // The isle's own stone (the cloud sea's fill under it, heart_isle_fill.ts).
      const meshes = heartKitMeshes(SMITH_HEART_BREATH_KIT_URL, kit.piece, 'isle');
      if (!meshes) {
        all = false;
        return;
      }
      meshes.rotation.y = kit.rot;
      meshes.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = false;
      });
      this.isles[i].add(meshes);
      this.dressed[i] = true;
    });
    if (this.stones.length === 0) {
      const shard = heartKitPiece(SMITH_HEART_BREATH_KIT_URL, ISLE_SHARD);
      if (shard) {
        for (const slot of HEART_KIT_SLOTS) {
          const g = shard[slot];
          if (!g) continue;
          const inst = new THREE.InstancedMesh(
            g,
            heartKitSlotMaterial(slot === 'stone' ? 'isle' : slot),
            P.stones * BREATH_ISLES.length,
          );
          inst.name = `smithHeartBreathIsleStones:${slot}`;
          inst.frustumCulled = false;
          inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.h.local.add(inst);
          this.stones.push(inst);
        }
      } else all = false;
    }
    return all;
  }

  // ---- the scan --------------------------------------------------------------------

  beginScan(): void {
    this.seenCircles.length = 0;
    this.seenRiders.length = 0;
    this.isleMobs.length = 0;
    this.guardianId = -1;
    this.storm.beginScan();
    this.stillstones.beginScan();
    this.adds.beginScan();
  }

  /** An object of the claim: an Updraft, a ride's carrier or a Closing
   *  Storm is this part's (true). */
  takeObject(e: Entity): boolean {
    if (this.storm.takeObject(e)) return true;
    const kind = isleObjectKind(e.templateId);
    if (!kind) return false;
    if (kind !== 'ride') this.seenCircles.push(e.id);
    return true;
  }

  /** The guardian: its Gale Cocoon (up, and the stones it counts stilled). */
  takeGuardian(e: Entity): void {
    this.guardianId = e.id;
    this.cocoonUp = false;
    this.cocoonStilled = 0;
    if (!e.dead)
      for (const a of e.auras)
        if (a.id === ISLE_AURAS.cocoon) {
          this.cocoonUp = true;
          this.cocoonStilled = a.value ?? 0;
        }
  }

  /** A mob of the claim: the isles' adds and the Stillstones (true). */
  takeMob(e: Entity): boolean {
    const t = e.templateId;
    if (t === ISLE_MOBS.stillstone) {
      this.stillstones.takeStone(e);
      return true;
    }
    if (
      t !== ISLE_MOBS.mender &&
      t !== ISLE_MOBS.sentinel &&
      t !== ISLE_MOBS.herald &&
      t !== ISLE_MOBS.squall &&
      t !== ISLE_MOBS.fragment &&
      t !== ISLE_MOBS.shieldbearer
    )
      return false;
    if (e.dead) return true;
    this.isleMobs.push(e.id);
    this.adds.takeMob(e);
    return true;
  }

  /** A living player of the claim (a Stillstone's channeller?). */
  takePlayer(e: Entity): void {
    this.stillstones.takePlayer(e);
  }

  /** A player's aura: the ride's (true). */
  takeAura(e: Entity, id: string): boolean {
    if (id !== ISLE_AURAS.riding) return false;
    this.seenRiders.push(e.id);
    return true;
  }

  endScan(world: IWorld): void {
    // Circles: the scanned objects to their fixed slots.
    for (const c of this.circles) {
      let found = -1;
      for (const id of this.seenCircles) {
        const e = world.entities.get(id);
        const k = e ? padOf(e.templateId) : null;
        if (k && k.from === c.from && k.to === c.to) found = id;
      }
      if (found !== c.id) {
        c.id = found;
        c.born = this.clock;
        c.group.visible = found >= 0;
      }
    }
    this.ride.setRiders(this.seenRiders);
    this.storm.endScan();
    this.stillstones.endScan(world);
    this.adds.endScan();
    // The isles wake while their adds live; they hold still while the round
    // is on (its adds, its circles: someone may stand on them).
    for (let i = 0; i < this.wake.length; i++) {
      this.wake[i] = 0;
      this.held[i] = 0;
    }
    for (const id of this.isleMobs) {
      const e = world.entities.get(id);
      const i = e ? this.isleOf(e) : -1;
      if (i >= 0) {
        this.wake[i] = 1;
        this.held[i] = 1;
      }
    }
    for (const c of this.circles) if (c.id >= 0) this.held[c.to] = 1;
    if (this.seenRiders.length > 0 || this.cocoonUp) this.held.fill(1);
  }

  /** The isle an entity stands on (by its local spot), or -1. */
  private isleOf(e: Entity): number {
    const o = this.h.local.position;
    let best = -1;
    let bestD = 1e9;
    BREATH_ISLES.forEach((isle, i) => {
      const d = Math.hypot(e.pos.x - o.x - isle.x, e.pos.z - o.z - isle.z);
      if (d < isle.r + 4 && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  // ---- the frame -------------------------------------------------------------------

  update(world: IWorld, dt: number): void {
    this.clock += dt;
    const t = this.h.uTime.value;
    if (this.stones.length === 0 || this.dressed.includes(false)) this.dressIsles();
    // The isles: riding the wind, their runes waking.
    let woken = 0;
    for (let i = 0; i < BREATH_ISLES.length; i++) {
      const isle = BREATH_ISLES[i];
      const u = this.runeMats[i].uniforms.uWake;
      u.value += (this.wake[i] - u.value) * Math.min(1, dt * 2.5);
      woken = Math.max(woken, u.value);
      this.calm[i] += (this.held[i] - this.calm[i]) * Math.min(1, dt * 1.5);
      const b = isleBob(i, t, this.calm[i], _bob);
      const g = this.isles[i];
      g.position.y = isle.h + b.y;
      g.rotation.x = b.rx;
      g.rotation.z = b.rz;
    }
    this.mistMat.opacity = 0.2 + 0.18 * woken;
    this.isleLife(dt);
    // The drifting stones, round the isles in the open air.
    if (this.stones.length > 0) {
      const live = Math.max(3, Math.round(P.stones * this.h.density));
      for (let i = 0; i < BREATH_ISLES.length; i++) {
        for (let k = 0; k < P.stones; k++) {
          const slot = i * P.stones + k;
          if (k >= live) _m.makeScale(0, 0, 0);
          else {
            const s = driftStone(i, k, t, _stone);
            _e.set(s.spin, s.spin * 0.7, s.spin * 0.3);
            _q.setFromEuler(_e);
            _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(s.size, s.size, s.size));
          }
          for (const inst of this.stones) inst.setMatrixAt(slot, _m);
        }
      }
      for (const inst of this.stones) inst.instanceMatrix.needsUpdate = true;
    }
    // The circles: open, beckoning; the route flowing to where it carries.
    for (const c of this.circles) {
      if (c.id < 0) continue;
      const look = circleLook(this.clock - c.born);
      c.disc.uniforms.uOpen.value = look.open;
      c.disc.uniforms.uGlow.value = look.glow;
      c.disc.uniforms.uSpin.value = look.spin;
      c.column.uniforms.uOpen.value = look.open;
      c.column.uniforms.uGlow.value = 0.42 * look.glow;
      c.route.uniforms.uGlow.value = 0.85 * look.open * look.glow;
      c.helix.uniforms.uGlow.value = 0.5 * look.open * look.glow;
      c.helixGroup.rotation.y = t * 2.1;
      // A few motes drawn up the column (cosmetic).
      if (this.rand() < dt * 10 * this.h.density) {
        const at = padSpot(c.from, c.to, CORNICE_FLOOR_H);
        const o = this.h.local.position;
        const a = this.rand() * Math.PI * 2;
        const y = o.y + at.y;
        this.h.particles.puff(
          o.x + at.x + Math.sin(a) * 2,
          y + 0.2,
          o.z + at.z + Math.cos(a) * 2,
          1,
          {
            speed: 0.6,
            up: 6,
            life: 1.2,
            size: [0.25, 0.08],
            color: RGB.pathCore,
            alpha: 0.85,
            pool: 'glow',
          },
        );
      }
    }
    this.ride.update(world, dt);
    const g = this.guardianId >= 0 ? world.entities.get(this.guardianId) : undefined;
    const seen = this.stillstones.stilledSides(world, _stilled);
    this.cocoon.update(g, this.cocoonUp, this.cocoonStilled, seen, dt);
    this.storm.update(this.isles, dt);
    this.stillstones.update(world, dt);
    this.adds.update(world, dt);
  }

  /** Skyrend Nova's hum this frame (0: none; the fight's audio plays it). */
  get novaHum(): number {
    return this.cocoon.hum;
  }

  /** The isles' life (cosmetic, thinned by the tier's density): mist off
   *  each hang, grit off the lip, dust off the crag, born where the isle
   *  rides this frame (world space: the shared pools are world space). */
  private isleLife(dt: number): void {
    const o = this.h.local.position;
    const k = dt * this.h.density;
    for (let i = 0; i < this.isles.length; i++) {
      const g = this.isles[i].position;
      const ox = o.x + g.x;
      const oy = o.y + g.y;
      const oz = o.z + g.z;
      if (this.rand() < k * ISLE_LIFE.mist) {
        const m = isleMist(i, this.rand(), this.rand(), this.rand(), _mote);
        this.h.particles.puff(ox + m.x, oy + m.y, oz + m.z, 1, {
          speed: Math.hypot(m.vx, m.vy, m.vz),
          dir: [m.vx, m.vy, m.vz],
          spread: 0.15,
          drag: 0.12,
          life: 6.5,
          size: [2.6, 9],
          color: MIST_RGB,
          alpha: 0.32,
          floor: -1e6,
        });
      }
      if (this.rand() < k * ISLE_LIFE.grit) {
        const m = isleGrit(i, this.rand(), this.rand(), _mote);
        this.h.particles.puff(ox + m.x, oy + m.y, oz + m.z, 1, {
          speed: 0.5,
          dir: [m.vx, m.vy, m.vz],
          spread: 0.3,
          drag: 0.2,
          gravity: 6,
          life: 3,
          size: [0.16, 0.11],
          color: GRIT_RGB,
          alpha: 0.95,
          floor: -1e6,
        });
      }
      if (this.rand() < k * ISLE_LIFE.dust) {
        const m = isleMist(i, this.rand(), this.rand(), this.rand(), _mote);
        this.h.particles.puff(ox + m.x * 0.85, oy + m.y, oz + m.z * 0.85, 1, {
          speed: 0.3,
          dir: [m.vx, -1, m.vz],
          spread: 0.4,
          drag: 0.6,
          gravity: 0.5,
          life: 4,
          size: [0.3, 1.1],
          color: DUST_RGB,
          alpha: 0.3,
          floor: -1e6,
        });
      }
    }
  }

  // ---- the moments -----------------------------------------------------------------

  handleEvent(ev: SimEvent, world: IWorld): boolean {
    if (ev.type === 'spellfxAt') {
      if (ev.ability === ISLE_CUES.rideUp) {
        this.ride.rideUp(ev.x, ev.z);
        return true;
      }
      if (ev.ability === ISLE_CUES.rideDown) {
        this.ride.rideDown(ev.x, ev.z);
        return true;
      }
      if (ev.ability === ISLE_CUES.isleWake) {
        this.h.particles.shockRing(ev.x, ev.z, C.rune, (ev.radius ?? 9) + 3, 1.1);
        return true;
      }
      if (ev.ability === ISLE_CUES.padUp) {
        this.padUp(ev.x, ev.z);
        return true;
      }
      if (ev.ability === ISLE_CUES.reckoning) {
        this.storm.reckoning(ev.x, ev.z);
        return true;
      }
      if (ev.ability === ISLE_CUES.split) {
        this.adds.split(ev.x, ev.z);
        return true;
      }
      return false;
    }
    if (ev.type !== 'spellfx') return false;
    const src = world.entities.get(ev.sourceId);
    if (ev.ability === ISLE_CUES.cocoonUp && src) {
      const a = src.pos;
      this.cocoon.flashShell(1.2);
      this.h.particles.shockRing(a.x, a.z, C.bulwark, 16, 0.9);
      this.h.particles.shockRing(a.x, a.z, 0xffffff, 9, 0.5);
      this.h.shakeNear(a.x, a.z, 0.3, 40);
      return true;
    }
    if (ev.ability === ISLE_CUES.cocoonBreak || ev.ability === ISLE_CUES.novaBurst) {
      this.cocoon.end(ev.ability === ISLE_CUES.novaBurst, src);
      return true;
    }
    if (ev.ability === ISLE_CUES.stilled) {
      if (src) this.cocoon.stilled(src.pos.x, src.pos.z);
      this.stillstones.stilled(world, ev.sourceId);
      return true;
    }
    if (ev.ability === ISLE_CUES.mended) {
      this.adds.mended(world, ev.sourceId, ev.targetId);
      return true;
    }
    if (ev.ability === ISLE_CUES.shoved) {
      this.adds.shoved(world, ev.sourceId);
      return true;
    }
    return false;
  }

  /** Thessaly raises an Updraft at (x, z) (world): her wind rising out of
   *  the stone, a column flaring up, rings, grit and motes. */
  private padUp(x: number, z: number): void {
    const y = this.h.groundY(x, z);
    const p = this.h.particles;
    p.shockRing(x, z, C.path, RIDE.circleR * 4, 0.9, { wake: 0.8, crest: 0.14, strength: 1.2 });
    p.shockRing(x, z, 0xffffff, RIDE.circleR * 2.2, 0.5);
    const n = Math.round(50 * (0.4 + 0.6 * this.h.density));
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * RIDE.circleR;
      p.puff(x + Math.sin(a) * r, y + 0.3, z + Math.cos(a) * r, 1, {
        speed: 10 + this.rand() * 14,
        life: 1.3,
        size: [0.55, 0.1],
        color: this.rand() < 0.5 ? RGB.pathCore : RGB.path,
        alpha: 1,
        pool: 'glow',
        dir: [Math.cos(a) * 0.25, 1, -Math.sin(a) * 0.25],
        spread: 0.15,
        drag: 0.7,
      });
    }
    for (let i = 0; i < Math.round(18 * this.h.density); i++) {
      const a = this.rand() * Math.PI * 2;
      p.puff(x, y + 0.3, z, 1, {
        speed: 7,
        life: 1.2,
        size: [0.6, 2.2],
        color: [0.78, 0.8, 0.82],
        alpha: 0.5,
        dir: [Math.sin(a), 0.25, Math.cos(a)],
        spread: 0.2,
        drag: 1.2,
      });
    }
    this.ride.rideUp(x, z);
    this.h.shakeNear(x, z, 0.2, 24);
  }

  /** The textures and pools this part owns (the host frees its geometries
   *  and materials; the kit's pieces and materials are the kit's). */
  dispose(): void {
    this.glow?.dispose();
    for (const inst of this.stones) inst.dispose();
    this.cocoon.dispose();
    this.adds.dispose();
  }

  /** The fight's claim is out of view: hide what moves. */
  leave(): void {
    for (const c of this.circles) {
      c.id = -1;
      c.group.visible = false;
    }
    this.ride.leave();
    this.cocoon.leave();
    this.storm.leave();
    this.stillstones.leave();
    this.adds.leave();
    this.guardianId = -1;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }
}
