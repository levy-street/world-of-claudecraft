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
//  - on EVERY tier (the raid acts on them): the Gale Path on the Cornice (a
//    wheeling wind disc, a column of wind over it, and the route of wind it
//    will carry you on, drawn along the ride's own arc to the isle), the
//    Homeward Gale on an isle (the same in the way home's pale gold);
//  - the Gale Bulwark and the Menders' beams (breath_bulwark_fx.ts) and the
//    ride itself, its launch and its landing (breath_ride_fx.ts);
//  - cosmetic (thinned on the low tier): the drifting stones' count, the
//    motes.
//
// Built in the constructor under the host's root and local group (its one
// gated attach); the kit's pieces join their isles the moment that kit has
// landed (its shared slot programs are linked with the interior, so nothing
// links in a live frame); no light; fixed pools; no per-frame allocation.

import * as THREE from 'three';
import { BREATH_ISLES } from '../../sim/content/smith_heart_layout';
import { isleSpots } from '../../sim/encounters/smith_heart/breath_isle_geometry';
import {
  ISLE_AURAS,
  ISLE_CUES,
  ISLE_MOBS,
  isleCircleOf,
} from '../../sim/encounters/smith_heart/breath_isle_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
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
import { BreathBulwarkFx } from './breath_bulwark_fx';
import { CORNICE_FLOOR_H } from './breath_fight_fx_core';
import {
  ISLE_COLORS as C,
  circleLook,
  circleRoute,
  driftStone,
  ISLE_KIT,
  ISLE_SHARD,
  isleBob,
  isleDepth,
  isleObjectKind,
  isleRuneRing,
  ISLE_POOLS as P,
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
}

interface CircleSlot {
  isle: number;
  kind: 'path' | 'home';
  group: THREE.Group;
  disc: THREE.ShaderMaterial;
  column: THREE.ShaderMaterial;
  route: THREE.ShaderMaterial;
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
  private readonly bulwark: BreathBulwarkFx;
  private readonly ride: BreathRideFx;
  // The scan's findings (reused).
  private guardianId = -1;
  private bulwarkLeft = 0;
  private bulwarkWhole = 0;
  private readonly seenCircles: number[] = [];
  private readonly seenRiders: number[] = [];
  private readonly menders: number[] = [];
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
    const colGeo = new THREE.CylinderGeometry(1, 1.15, 1, 28, 1, true);
    colGeo.translate(0, 0.5, 0);
    h.geometries.push(discGeo, colGeo);
    const spots = isleSpots();
    BREATH_ISLES.forEach((isle, i) => {
      for (const kind of ['path', 'home'] as const) {
        const color = kind === 'path' ? C.path : C.home;
        const core = kind === 'path' ? C.pathCore : C.homeCore;
        const at = kind === 'path' ? spots[i].path : spots[i].home;
        const y = (kind === 'path' ? CORNICE_FLOOR_H : isle.h) + 0.08;
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
        colMesh.scale.set(RIDE.circleR * 0.95, 9, RIDE.circleR * 0.95);
        colMesh.position.set(at.x, y, at.z);
        group.add(colMesh);
        // The route: two crossed ribbons along the ride's own arc.
        const pts = circleRoute(i, kind, 48, { cornice: CORNICE_FLOOR_H + 1.1 });
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
        h.materials.push(disc, column, route);
        h.local.add(group);
        this.circles.push({ isle: i, kind, group, disc, column, route, id: -1, born: 0 });
      }
    });

    // ---- the Bulwark and the Menders' beams, the ride (every tier) ----
    this.bulwark = new BreathBulwarkFx(h);
    this.ride = new BreathRideFx(h);
  }

  /** Put the kit's sculpts on the isles and its stones round them, once
   *  that kit has landed (true when every isle is dressed). */
  private dressIsles(): boolean {
    let all = true;
    BREATH_ISLES.forEach((_, i) => {
      if (this.dressed[i]) return;
      const kit = ISLE_KIT[i % ISLE_KIT.length];
      const meshes = heartKitMeshes(SMITH_HEART_BREATH_KIT_URL, kit.piece);
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
            heartKitSlotMaterial(slot),
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
    this.menders.length = 0;
    this.isleMobs.length = 0;
    this.guardianId = -1;
  }

  /** An object of the claim: a Gale Path, a Homeward Gale or a ride's
   *  carrier is this part's (true). */
  takeObject(e: Entity): boolean {
    const kind = isleObjectKind(e.templateId);
    if (!kind) return false;
    if (kind !== 'ride') this.seenCircles.push(e.id);
    return true;
  }

  /** The guardian: its Bulwark (absorb left and whole). */
  takeGuardian(e: Entity): void {
    this.guardianId = e.id;
    let left = 0;
    let whole = 0;
    if (!e.dead)
      for (const a of e.auras)
        if (a.id === ISLE_AURAS.bulwark) {
          left = a.value;
          whole = a.value2 ?? a.value;
        }
    this.bulwarkLeft = left;
    this.bulwarkWhole = whole;
  }

  /** A mob of the claim: the isles' adds (true). */
  takeMob(e: Entity): boolean {
    if (e.templateId !== ISLE_MOBS.mender && e.templateId !== ISLE_MOBS.sentinel) return false;
    if (e.dead) return true;
    this.isleMobs.push(e.id);
    if (e.templateId === ISLE_MOBS.mender) this.menders.push(e.id);
    return true;
  }

  /** A player's aura: the ride's (true). */
  takeAura(e: Entity, id: string): boolean {
    if (id !== ISLE_AURAS.riding) return id === ISLE_AURAS.windworn;
    this.seenRiders.push(e.id);
    return true;
  }

  endScan(world: IWorld): void {
    // Circles: the scanned objects to their fixed slots.
    for (const c of this.circles) {
      let found = -1;
      for (const id of this.seenCircles) {
        const e = world.entities.get(id);
        const k = e ? isleCircleOf(e.templateId) : null;
        if (k && k.isle === c.isle && k.kind === c.kind) found = id;
      }
      if (found !== c.id) {
        c.id = found;
        c.born = this.clock;
        c.group.visible = found >= 0;
      }
    }
    this.ride.setRiders(this.seenRiders);
    this.bulwark.setMenders(this.menders);
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
    for (const c of this.circles) if (c.id >= 0) this.held[c.isle] = 1;
    if (this.seenRiders.length > 0) this.held.fill(1);
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
    BREATH_ISLES.forEach((isle, i) => {
      const u = this.runeMats[i].uniforms.uWake;
      u.value += (this.wake[i] - u.value) * Math.min(1, dt * 2.5);
      woken = Math.max(woken, u.value);
      this.calm[i] += (this.held[i] - this.calm[i]) * Math.min(1, dt * 1.5);
      const b = isleBob(i, t, this.calm[i], _bob);
      const g = this.isles[i];
      g.position.y = isle.h + b.y;
      g.rotation.x = b.rx;
      g.rotation.z = b.rz;
    });
    this.mistMat.opacity = 0.2 + 0.18 * woken;
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
      c.column.uniforms.uGlow.value = 0.8 * look.glow;
      c.route.uniforms.uGlow.value = 0.85 * look.open * look.glow;
      // A few motes drawn up the column (cosmetic).
      if (this.rand() < dt * 10 * this.h.density) {
        const spots = isleSpots()[c.isle];
        const at = c.kind === 'path' ? spots.path : spots.home;
        const o = this.h.local.position;
        const a = this.rand() * Math.PI * 2;
        const y = o.y + (c.kind === 'path' ? CORNICE_FLOOR_H : BREATH_ISLES[c.isle].h);
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
            color: c.kind === 'path' ? RGB.pathCore : RGB.homeCore,
            alpha: 0.85,
            pool: 'glow',
          },
        );
      }
    }
    this.ride.update(world, dt);
    const g = this.guardianId >= 0 ? world.entities.get(this.guardianId) : undefined;
    this.bulwark.update(world, g, this.bulwarkLeft, this.bulwarkWhole, dt);
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
      return false;
    }
    if (ev.type !== 'spellfx') return false;
    const src = world.entities.get(ev.sourceId);
    if (ev.ability === ISLE_CUES.bulwarkUp && src) {
      const a = src.pos;
      this.bulwark.flashShell(1.2);
      this.h.particles.shockRing(a.x, a.z, C.bulwark, 16, 0.9);
      this.h.particles.shockRing(a.x, a.z, 0xffffff, 9, 0.5);
      this.h.shakeNear(a.x, a.z, 0.3, 40);
      return true;
    }
    if ((ev.ability === ISLE_CUES.bulwarkBreak || ev.ability === ISLE_CUES.bulwarkBurst) && src) {
      const a = src.pos;
      const burst = ev.ability === ISLE_CUES.bulwarkBurst;
      this.h.particles.shockRing(
        a.x,
        a.z,
        burst ? 0xffffff : C.bulwark,
        burst ? 50 : 22,
        burst ? 1.4 : 0.9,
      );
      const n = Math.round((burst ? 60 : 40) * this.h.density);
      for (let i = 0; i < n; i++) {
        const ang = this.rand() * Math.PI * 2;
        const up = this.rand() * 0.8 - 0.1;
        this.h.particles.puff(
          a.x + Math.sin(ang) * 3,
          src.pos.y + 3 + this.rand() * 5,
          a.z + Math.cos(ang) * 3,
          1,
          {
            speed: 16 + this.rand() * 10,
            life: 0.9,
            size: [0.6, 0.15],
            color: RGB.bulwarkEdge,
            alpha: 0.9,
            pool: 'glow',
            dir: [Math.sin(ang), up, Math.cos(ang)],
            spread: 0.2,
            drag: 1,
          },
        );
      }
      this.h.shakeNear(a.x, a.z, burst ? 0.7 : 0.4, burst ? 90 : 50);
      return true;
    }
    if (ev.ability === ISLE_CUES.mended) {
      this.bulwark.mended(ev.sourceId);
      return true;
    }
    return false;
  }

  /** The textures and pools this part owns (the host frees its geometries
   *  and materials; the kit's pieces and materials are the kit's). */
  dispose(): void {
    this.glow?.dispose();
    for (const inst of this.stones) inst.dispose();
    this.bulwark.dispose();
  }

  /** The fight's claim is out of view: hide what moves. */
  leave(): void {
    for (const c of this.circles) {
      c.id = -1;
      c.group.visible = false;
    }
    this.ride.leave();
    this.bulwark.leave();
    this.guardianId = -1;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }
}
