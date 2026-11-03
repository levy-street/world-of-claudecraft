// The Islands of the Wind (encounters/smith_heart/breath_isles.ts), a part of
// BreathFightFx (plan: breath_isles_fx_core.ts):
//
//  - the two floating isles, always (the Breath's silhouette since the
//    Cornice stands bare): a carved granite top at the very floor you stand
//    on, the underside hanging to a jagged point banded in strata, storm-blue
//    crystal clusters growing out of it, roots dangling in the wind, a ring
//    of wind runes round the floor (awake, they burn and race), and stones
//    drifting under it;
//  - on EVERY tier (the raid acts on them): the Gale Path on the Cornice (a
//    wheeling wind disc, a column of wind over it, and the route of wind it
//    will carry you on, drawn along the ride's own arc to the isle), the
//    Homeward Gale on an isle (the same in the way home's pale gold), the
//    Gale Bulwark round the guardian (a shell of turning wind, cracking as
//    it thins) and each Gale Mender's stream into it while it channels;
//  - the ride: wind ribbons wrapped round the rider, a trail of streaks and
//    mist behind, a burst where it lifts and where it sets down;
//  - cosmetic (thinned on the low tier): the drifting stones' count, the
//    trail's mist, the bursts' grit.
//
// Built in the constructor under the host's root and local group (its one
// gated attach); no light; fixed pools; no per-frame allocation.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BREATH_ISLES } from '../../sim/content/smith_heart_layout';
import { isleSpots } from '../../sim/encounters/smith_heart/breath_isle_geometry';
import {
  ISLE_AURAS,
  ISLE_CASTS,
  ISLE_CUES,
  ISLE_MOBS,
  isleCircleOf,
} from '../../sim/encounters/smith_heart/breath_isle_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { radialGlowTexture } from '../textures';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { CORNICE_FLOOR_H } from './breath_fight_fx_core';
import {
  bulwarkLook,
  ISLE_COLORS as C,
  circleLook,
  circleRoute,
  driftStone,
  isleCrystals,
  isleDepth,
  isleObjectKind,
  isleRock,
  isleRoots,
  isleRuneRing,
  ISLE_POOLS as P,
  ISLE_RGB as RGB,
  RIDE,
  riderLook,
} from './breath_isles_fx_core';
import {
  BULWARK_FRAG,
  BULWARK_VERT,
  ISLE_COLUMN_FRAG,
  ISLE_DISC_FRAG,
  ISLE_RIBBON_FRAG,
  ISLE_RUNE_FRAG,
  ISLE_UV_VERT,
} from './breath_isles_glsl';

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

interface RiderSlot {
  group: THREE.Group;
  mats: THREE.ShaderMaterial[];
  id: number;
  born: number;
  trail: number;
}

interface StreamSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  pos: THREE.BufferAttribute;
  id: number;
  flare: number;
}

const STREAM_STEPS = 28;
const RIBBON_DIR = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _stone = { x: 0, y: 0, z: 0, spin: 0, size: 0 };

/** A flat ribbon (a triangle strip as a list) along `pts`, `half` wide,
 *  its width horizontal (or vertical when `upright`); uv.x along 0..1. */
function ribbonGeometry(
  pts: readonly { x: number; y: number; z: number }[],
  half: number,
  upright: boolean,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    RIBBON_DIR.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    // Across: horizontal (perpendicular to the run in xz) or straight up.
    let ax = 0;
    let ay = 1;
    let az = 0;
    if (!upright) {
      const l = Math.hypot(RIBBON_DIR.x, RIBBON_DIR.z) || 1;
      ax = -RIBBON_DIR.z / l;
      ay = 0;
      az = RIBBON_DIR.x / l;
    }
    const p = pts[i];
    pos.push(p.x - ax * half, p.y - ay * half, p.z - az * half);
    pos.push(p.x + ax * half, p.y + ay * half, p.z + az * half);
    const t = i / (n - 1);
    uv.push(t, 0, t, 1);
    if (i < n - 1) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** A helix ribbon round a body (body-local, `turns` round, `h` tall). */
function helixPoints(r: number, h: number, turns: number, phase: number) {
  const pts: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const a = phase + t * turns * Math.PI * 2;
    const rr = r * (0.75 + 0.35 * Math.sin(t * Math.PI));
    pts.push({ x: Math.cos(a) * rr, y: 0.2 + t * h, z: Math.sin(a) * rr });
  }
  return pts;
}

export class BreathIslesFx {
  private readonly circles: CircleSlot[] = [];
  private readonly riders: RiderSlot[] = [];
  private readonly streams: StreamSlot[] = [];
  private readonly runeMats: THREE.ShaderMaterial[] = [];
  private readonly wake: number[] = BREATH_ISLES.map(() => 0);
  private readonly stones: THREE.InstancedMesh;
  private readonly crystalMat: THREE.MeshStandardMaterial;
  private readonly bulwark: THREE.Mesh;
  private readonly bulwarkMat: THREE.ShaderMaterial;
  private readonly roots: THREE.Group[] = [];
  private readonly mists: THREE.Sprite[] = [];
  /** The mist's soft disc (none without a DOM: a headless test host). */
  private readonly glow: THREE.Texture | null =
    typeof document !== 'undefined' ? radialGlowTexture() : null;
  // The scan's findings (reused).
  private guardianId = -1;
  private bulwarkLeft = 0;
  private bulwarkWhole = 0;
  private bulwarkFlash = 0;
  private readonly seenCircles: number[] = [];
  private readonly seenRiders: number[] = [];
  private readonly menders: number[] = [];
  private readonly isleMobs: number[] = [];
  private clock = 0;
  private seed = 0x7a31;

  constructor(private readonly h: BreathIslesHost) {
    // ---- the isles (always) ----
    const rockMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      name: 'smithHeartBreathIsleRock',
    });
    this.crystalMat = new THREE.MeshStandardMaterial({
      color: C.crystal,
      emissive: C.crystal,
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.1,
      flatShading: true,
      name: 'smithHeartBreathIsleCrystal',
    });
    const rootMat = new THREE.MeshStandardMaterial({
      color: C.root,
      roughness: 1,
      name: 'smithHeartBreathIsleRoot',
    });
    h.materials.push(rockMat, this.crystalMat, rootMat);
    BREATH_ISLES.forEach((isle, i) => {
      const plan = isleRock(i);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(plan.positions, 3));
      // The plan's paint is sRGB; the lit material wants it linear.
      g.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(
          plan.colors.map((c) => c ** 2.2),
          3,
        ),
      );
      g.setIndex(plan.indices);
      // Smooth across the hang (the stone's mass reads round, its lumps in
      // the light), the paint carrying the strata.
      g.computeVertexNormals();
      h.geometries.push(g);
      const rock = new THREE.Mesh(g, rockMat);
      rock.name = `smithHeartBreathIsle${i}`;
      rock.receiveShadow = true;
      h.local.add(rock);
      // The crystals: hexagonal shards with a point, merged per isle.
      const shards: THREE.BufferGeometry[] = [];
      for (const c of isleCrystals(i)) {
        const body = new THREE.CylinderGeometry(c.girth * 0.8, c.girth, c.len * 0.78, 6, 1);
        body.translate(0, c.len * 0.39, 0);
        const tip = new THREE.ConeGeometry(c.girth * 0.8, c.len * 0.3, 6, 1);
        tip.translate(0, c.len * 0.78 + c.len * 0.15, 0);
        const both = mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()]);
        body.dispose();
        tip.dispose();
        if (!both) continue;
        _p.set(c.dx, c.dy, c.dz).normalize();
        _q.setFromUnitVectors(UP, _p);
        _m.compose(_s.set(c.x, c.y, c.z), _q, new THREE.Vector3(1, 1, 1));
        both.applyMatrix4(_m);
        shards.push(both);
      }
      const merged = mergeGeometries(shards);
      for (const s of shards) s.dispose();
      if (merged) {
        merged.computeVertexNormals();
        h.geometries.push(merged);
        const m = new THREE.Mesh(merged, this.crystalMat);
        m.name = `smithHeartBreathIsleCrystals${i}`;
        h.local.add(m);
      }
      // The roots, dangling (the group sways a little).
      const tubes: THREE.BufferGeometry[] = [];
      for (const pts of isleRoots(i)) {
        const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
        tubes.push(new THREE.TubeGeometry(curve, 10, 0.13, 4, false));
      }
      const rootGeo = mergeGeometries(tubes);
      for (const t of tubes) t.dispose();
      const rootGroup = new THREE.Group();
      rootGroup.position.set(isle.x, isle.h, isle.z);
      if (rootGeo) {
        rootGeo.translate(-isle.x, -isle.h, -isle.z);
        h.geometries.push(rootGeo);
        rootGroup.add(new THREE.Mesh(rootGeo, rootMat));
      }
      this.roots.push(rootGroup);
      h.local.add(rootGroup);
      // The ring of wind runes round its floor.
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
      runeGeo.translate(isle.x, isle.h + 0.07, isle.z);
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
      h.local.add(rune);
    });
    // A veil of mist under each isle (soft, additive; a cosmetic look the
    // low tier keeps, it is one draw each).
    const mistMat = new THREE.SpriteMaterial({
      map: this.glow,
      color: C.mist,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      name: 'smithHeartBreathIsleMist',
    });
    h.materials.push(mistMat);
    BREATH_ISLES.forEach((isle, i) => {
      for (let k = 0; k < 4; k++) {
        const sp = new THREE.Sprite(mistMat);
        const a = (k / 4) * Math.PI * 2 + i;
        sp.position.set(
          isle.x + Math.sin(a) * isle.r * 0.4,
          isle.h - isleDepth(i) * (0.35 + 0.18 * k),
          isle.z + Math.cos(a) * isle.r * 0.4,
        );
        sp.scale.setScalar(isle.r * (2.6 - 0.35 * k));
        this.mists.push(sp);
        h.local.add(sp);
      }
    });
    // The drifting stones, one instanced draw for both isles.
    const stoneGeo = new THREE.DodecahedronGeometry(1, 0);
    h.geometries.push(stoneGeo);
    const stoneMat = new THREE.MeshStandardMaterial({
      color: C.granite,
      roughness: 0.95,
      flatShading: true,
      name: 'smithHeartBreathIsleStones',
    });
    h.materials.push(stoneMat);
    this.stones = new THREE.InstancedMesh(stoneGeo, stoneMat, P.stones * BREATH_ISLES.length);
    this.stones.name = 'smithHeartBreathIsleStones';
    this.stones.frustumCulled = false;
    this.stones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    h.local.add(this.stones);

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

    // ---- the riders (every tier) ----
    for (let r = 0; r < P.riders; r++) {
      const group = new THREE.Group();
      group.visible = false;
      const mats: THREE.ShaderMaterial[] = [];
      for (let k = 0; k < 3; k++) {
        const mat = new THREE.ShaderMaterial({
          name: 'smithHeartBreathRiderWrap',
          uniforms: {
            uTime: h.uTime,
            uColor: { value: new THREE.Color(k === 2 ? C.path : C.ribbon) },
            uCore: { value: new THREE.Color(C.pathCore) },
            uGlow: { value: 1 },
            uFlow: { value: 2.2 },
            uDash: { value: 3 },
            uFade: { value: 0.15 },
          },
          vertexShader: ISLE_UV_VERT,
          fragmentShader: ISLE_RIBBON_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
        const geo = ribbonGeometry(helixPoints(1.3 + k * 0.35, 3.2, 1.6, k * 2.1), 0.22, true);
        h.geometries.push(geo);
        h.materials.push(mat);
        mats.push(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        group.add(mesh);
      }
      h.root.add(group);
      this.riders.push({ group, mats, id: -1, born: 0, trail: 0 });
    }

    // ---- the Bulwark and the Menders' streams (every tier) ----
    this.bulwarkMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathBulwark',
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(C.bulwark) },
        uEdge: { value: new THREE.Color(C.bulwarkEdge) },
        uSolid: { value: 1 },
        uCrack: { value: 0 },
        uSpin: { value: 1 },
        uFlash: { value: 0 },
      },
      vertexShader: BULWARK_VERT,
      fragmentShader: BULWARK_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    h.materials.push(this.bulwarkMat);
    const sphere = new THREE.SphereGeometry(1, 48, 28);
    h.geometries.push(sphere);
    this.bulwark = new THREE.Mesh(sphere, this.bulwarkMat);
    this.bulwark.name = 'smithHeartBreathBulwark';
    this.bulwark.visible = false;
    this.bulwark.frustumCulled = false;
    h.root.add(this.bulwark);
    for (let k = 0; k < P.streams; k++) {
      const pos = new Float32Array((STREAM_STEPS + 1) * 2 * 3);
      const uv: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= STREAM_STEPS; i++) {
        uv.push(i / STREAM_STEPS, 0, i / STREAM_STEPS, 1);
        if (i < STREAM_STEPS)
          idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const geo = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(pos, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', attr);
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      h.geometries.push(geo);
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathMendStream',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(C.mend) },
          uCore: { value: new THREE.Color(0xffffff) },
          uGlow: { value: 1.2 },
          uFlow: { value: 2.6 },
          uDash: { value: 14 },
          uFade: { value: 0.04 },
        },
        vertexShader: ISLE_UV_VERT,
        fragmentShader: ISLE_RIBBON_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      h.materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      h.root.add(mesh);
      this.streams.push({ mesh, mat, pos: attr, id: -1, flare: 0 });
    }
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
    // Riders: keep a slot while its rider rides.
    for (const r of this.riders) {
      if (r.id >= 0 && !this.seenRiders.includes(r.id)) {
        r.id = -1;
        r.group.visible = false;
      }
    }
    for (const id of this.seenRiders) {
      if (this.riders.some((r) => r.id === id)) continue;
      const free = this.riders.find((r) => r.id < 0);
      if (!free) break;
      free.id = id;
      free.born = this.clock;
      free.group.visible = true;
    }
    // Streams: one per Mender (shown while it channels).
    this.streams.forEach((s, k) => {
      s.id = k < this.menders.length ? this.menders[k] : -1;
      if (s.id < 0) s.mesh.visible = false;
    });
    // The isles wake while their adds live.
    for (let i = 0; i < this.wake.length; i++) this.wake[i] = 0;
    for (const id of this.isleMobs) {
      const e = world.entities.get(id);
      const i = e ? this.isleOf(e) : -1;
      if (i >= 0) this.wake[i] = 1;
    }
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
    // The isles: runes waking, roots swaying, stones drifting.
    BREATH_ISLES.forEach((_, i) => {
      const u = this.runeMats[i].uniforms.uWake;
      u.value += (this.wake[i] - u.value) * Math.min(1, dt * 2.5);
      const root = this.roots[i];
      root.rotation.z = Math.sin(t * 0.7 + i) * 0.035;
      root.rotation.x = Math.cos(t * 0.53 + i * 2) * 0.03;
    });
    const live = Math.max(3, Math.round(P.stones * this.h.density));
    for (let i = 0; i < BREATH_ISLES.length; i++) {
      for (let k = 0; k < P.stones; k++) {
        const slot = i * P.stones + k;
        if (k >= live) {
          this.stones.setMatrixAt(slot, _m.makeScale(0, 0, 0));
          continue;
        }
        const s = driftStone(i, k, t, _stone);
        _e.set(s.spin, s.spin * 0.7, s.spin * 0.3);
        _q.setFromEuler(_e);
        _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(s.size, s.size * 0.8, s.size));
        this.stones.setMatrixAt(slot, _m);
      }
    }
    this.stones.instanceMatrix.needsUpdate = true;
    let woken = 0;
    for (const w of this.wake) woken = Math.max(woken, w);
    this.crystalMat.emissiveIntensity = 0.45 + 0.15 * Math.sin(t * 1.3) + 0.55 * woken;
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
    // The riders: ribbons wrapped round them, a trail behind.
    for (const r of this.riders) {
      if (r.id < 0) continue;
      const e = world.entities.get(r.id);
      if (!e) {
        r.group.visible = false;
        continue;
      }
      const a = fxAnchor(e);
      const k = Math.min(1, (this.clock - r.born) / RIDE.seconds);
      const look = riderLook(k);
      r.group.position.set(a.x, a.y - 0.4, a.z);
      r.group.rotation.y = t * 5;
      r.group.scale.setScalar(0.8 + 0.4 * look.wrap);
      for (const m of r.mats) m.uniforms.uGlow.value = 0.6 + 0.9 * look.bright;
      r.trail += dt * 26 * (0.4 + 0.6 * this.h.density);
      while (r.trail >= 1) {
        r.trail -= 1;
        this.h.particles.puff(a.x, e.pos.y + 0.8 + this.rand() * 1.6, a.z, 1, {
          speed: 0.4,
          life: 0.9,
          size: [0.9, 0.2],
          color: RGB.ribbon,
          alpha: 0.55,
          pool: 'glow',
          drag: 2,
        });
      }
    }
    // The Bulwark round the guardian.
    const g = this.guardianId >= 0 ? world.entities.get(this.guardianId) : undefined;
    if (g && !g.dead && this.bulwarkLeft > 0) {
      const look = bulwarkLook(this.bulwarkLeft, this.bulwarkWhole, t);
      const a = fxAnchor(g);
      const R = 3.2 * Math.max(1, g.scale ?? 1);
      this.bulwark.visible = true;
      this.bulwark.position.set(a.x, g.pos.y + R * 0.55, a.z);
      this.bulwark.scale.set(R * look.pulse, R * 0.9 * look.pulse, R * look.pulse);
      this.bulwark.rotation.y = t * 0.3;
      const u = this.bulwarkMat.uniforms;
      u.uSolid.value = look.solid;
      u.uCrack.value = look.crack;
      u.uSpin.value = look.spin;
      this.bulwarkFlash = Math.max(0, this.bulwarkFlash - dt * 2.2);
      u.uFlash.value = this.bulwarkFlash;
    } else this.bulwark.visible = false;
    // The Menders' streams while they channel: from the isle into the shell.
    for (const s of this.streams) {
      if (s.id < 0) continue;
      const m = world.entities.get(s.id);
      const channel = !!m && !m.dead && m.castingAbility === ISLE_CASTS.mending;
      s.flare = Math.max(0, s.flare - dt * 1.6);
      if (!m || !g || (!channel && s.flare <= 0)) {
        s.mesh.visible = false;
        continue;
      }
      s.mesh.visible = true;
      s.mat.uniforms.uGlow.value = (channel ? 0.9 + 0.3 * Math.sin(t * 9) : 0) + s.flare * 1.5;
      const ma = fxAnchor(m);
      const ga = fxAnchor(g);
      const from = { x: ma.x, y: m.pos.y + 2.2, z: ma.z };
      const to = { x: ga.x, y: g.pos.y + 5, z: ga.z };
      const d = Math.hypot(to.x - from.x, to.z - from.z);
      const across = { x: -(to.z - from.z) / (d || 1), z: (to.x - from.x) / (d || 1) };
      for (let i = 0; i <= STREAM_STEPS; i++) {
        const k = i / STREAM_STEPS;
        const lift = Math.sin(k * Math.PI) * Math.min(14, d * 0.25);
        const wob = Math.sin(k * 9 - t * 6) * 0.5 * Math.sin(k * Math.PI);
        const x = from.x + (to.x - from.x) * k + across.x * wob;
        const y = from.y + (to.y - from.y) * k + lift;
        const z = from.z + (to.z - from.z) * k + across.z * wob;
        s.pos.setXYZ(i * 2, x, y - 0.35, z);
        s.pos.setXYZ(i * 2 + 1, x, y + 0.35, z);
      }
      s.pos.needsUpdate = true;
    }
  }

  // ---- the moments -----------------------------------------------------------------

  handleEvent(ev: SimEvent, world: IWorld): boolean {
    if (ev.type === 'spellfxAt') {
      if (ev.ability === ISLE_CUES.rideUp) {
        const ground = this.h.groundY(ev.x, ev.z);
        this.h.particles.shockRing(ev.x, ev.z, C.path, 6, 0.6);
        this.h.particles.puff(ev.x, ground + 0.5, ev.z, Math.round(18 * this.h.density), {
          speed: 5,
          up: 9,
          life: 0.9,
          size: [0.5, 1.6],
          color: RGB.ribbon,
          alpha: 0.6,
          drag: 1.4,
          radius: 1.2,
        });
        return true;
      }
      if (ev.ability === ISLE_CUES.rideDown) {
        const ground = this.h.groundY(ev.x, ev.z);
        this.h.particles.shockRing(ev.x, ev.z, C.path, 7, 0.7);
        this.h.particles.shockRing(ev.x, ev.z, 0xffffff, 3.5, 0.4);
        this.h.particles.puff(ev.x, ground + 0.3, ev.z, Math.round(26 * this.h.density), {
          speed: 9,
          up: 2,
          life: 1,
          size: [0.7, 2.2],
          color: RGB.dust,
          alpha: 0.5,
          drag: 1.6,
          radius: 0.8,
        });
        this.h.shakeNear(ev.x, ev.z, 0.18, 14);
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
      const a = fxAnchor(src);
      this.bulwarkFlash = 1.2;
      this.h.particles.shockRing(a.x, a.z, C.bulwark, 14, 0.9);
      this.h.particles.shockRing(a.x, a.z, 0xffffff, 8, 0.5);
      this.h.shakeNear(a.x, a.z, 0.3, 40);
      return true;
    }
    if ((ev.ability === ISLE_CUES.bulwarkBreak || ev.ability === ISLE_CUES.bulwarkBurst) && src) {
      const a = fxAnchor(src);
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
      const s = this.streams.find((q) => q.id === ev.sourceId);
      if (s) s.flare = 1;
      this.bulwarkFlash = Math.max(this.bulwarkFlash, 0.7);
      return true;
    }
    return false;
  }

  /** The textures this part owns (the host frees its geometries and
   *  materials). */
  dispose(): void {
    this.glow?.dispose();
    this.stones.dispose();
  }

  /** The fight's claim is out of view: hide what moves. */
  leave(): void {
    for (const c of this.circles) {
      c.id = -1;
      c.group.visible = false;
    }
    for (const r of this.riders) {
      r.id = -1;
      r.group.visible = false;
    }
    for (const s of this.streams) s.mesh.visible = false;
    this.bulwark.visible = false;
    this.guardianId = -1;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }
}
