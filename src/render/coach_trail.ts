// The Proving Shore's golden guidance: a terrain-draped chevron ribbon along
// the coach's current route (coach_trail_core.ts decides the route), plus a
// pulsing golden ground ring under the rail's current target NPC. The island
// coaches players who have never played the genre; the ribbon paints the
// walk on the ground so nobody has to read to find the way.
//
// The race_line.ts idiom: geometry is sampled onto the terrain via the
// renderer's ground sampler and rebuilt only when the route key changes (a
// handful of times across the whole island, never per frame); per frame the
// chevron texture scrolls toward the destination and the glow breathes.
// MeshBasicMaterial + additive blending keeps this actionable guidance
// identical on every graphics tier (the fairness rule): no lights, no tier
// reads, no governor reads. The materials are the page-wide set in
// coach_trail_materials.ts (staged by the boot manifest, never disposed), and
// every guidance object is built up front under ONE root the constructor
// attaches through the gated scene attach (gated_scene_attach.ts): the root
// stays hidden until the host's compile gate links the three programs, and a
// route or target change afterwards only ever swaps geometry, so nothing the
// coach does can link a program inside a live frame, whatever the boot kept.

import * as THREE from 'three';
import type { CoachTrailPlan } from './coach_trail_core';
import {
  COACH_BEAM_HEIGHT,
  COACH_STRIP_INDEX,
  type CoachTrailMaterials,
  coachAreaRingGeometry,
  coachBeamGeometry,
  coachRibbonGeometry,
  coachRingGeometry,
  coachStripPositions,
  coachStripUvs,
  coachTrailMaterials,
} from './coach_trail_materials';
import { attachSceneGroupGated } from './gated_scene_attach';

const RIBBON_WIDTH = 0.7;
const RIBBON_LIFT = 0.14;
const CHEVRON_LENGTH = 2.0; // world units per chevron repeat
const SCROLL_SPEED = 1.5; // repeats per second, toward the destination
const SAMPLES_PER_UNIT = 0.6; // cross-sections per world unit of route
const MIN_SAMPLES = 24;
const MAX_SAMPLES = 320;
const RING_LIFT = 0.12;
// The target NPC's body aura: a soft radial billboard behind the model, the
// "glowing character" read (playtest: an arrow over the head looked wrong).
const AURA_WIDTH = 3.0;
const AURA_HEIGHT = 3.6;
const AURA_LIFT = 1.15;

/** The host's compile step for the trail's root: link its programs off the
 *  frame before it shows (the renderer's compile gate). */
export type CoachTrailCompileGate = (target: THREE.Object3D) => Promise<unknown>;

export class CoachTrail {
  private readonly mats: CoachTrailMaterials = coachTrailMaterials();
  /** Every guidance object, under one root attached to the scene once. */
  readonly group = new THREE.Group();
  private readonly ribbon: THREE.Mesh;
  private builtKey: string | null = null;
  private readonly ring: THREE.Mesh;
  private ringKey = '';
  private readonly aura: THREE.Sprite;
  private readonly beam: THREE.Mesh;
  private beamKey = '';
  private readonly areaRing: THREE.Mesh;
  private areaRingKey = '';

  constructor(
    scene: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
    compileGate?: CoachTrailCompileGate,
  ) {
    this.group.name = 'coach-trail';
    this.ribbon = this.guidance(
      new THREE.Mesh(
        coachRibbonGeometry(coachStripPositions(), coachStripUvs(), COACH_STRIP_INDEX),
        this.mats.ribbon,
      ),
    );
    this.ring = this.guidance(new THREE.Mesh(coachRingGeometry(), this.mats.ring));
    this.aura = this.guidance(new THREE.Sprite(this.mats.aura));
    this.beam = this.guidance(new THREE.Mesh(coachBeamGeometry(), this.mats.beam));
    this.areaRing = this.guidance(
      new THREE.Mesh(
        coachAreaRingGeometry(coachStripPositions(), COACH_STRIP_INDEX),
        this.mats.areaRing,
      ),
    );
    // Hidden until the gate links the programs, then revealed; the objects
    // above keep their own visibility for the per-frame drive below. This
    // runs at renderer construction, before any live frame: without async
    // compile the gate links synchronously under the boot window (the
    // sibling attach sites guard on it because they attach mid-session), and
    // its unit runs ahead of the boot manifest, whose coach stand-in then
    // finds the programs cached.
    void attachSceneGroupGated(scene, this.group, compileGate);
  }

  /** One guidance object: drawn late (over the ground), in the diagnostics'
   *  world-space UI census bucket (never a behavior or visibility gate),
   *  hidden until its station needs it. */
  private guidance<T extends THREE.Object3D>(object: T): T {
    object.renderOrder = 3;
    object.userData.renderCategory = 'ui3d';
    object.visible = false;
    this.group.add(object);
    return object;
  }

  /** Rebuild the draped ribbon for a new route key. */
  private buildRibbon(plan: CoachTrailPlan): void {
    this.hideRibbon();
    if (plan.points.length < 2) return;
    const pts = plan.points.map((p) => new THREE.Vector3(p.x, 0, p.z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    let routeLength = 0;
    for (let i = 1; i < pts.length; i++) {
      routeLength += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    }
    const samples = Math.max(
      MIN_SAMPLES,
      Math.min(MAX_SAMPLES, Math.round(routeLength * SAMPLES_PER_UNIT)),
    );
    const positions = new Float32Array((samples + 1) * 2 * 3);
    const uvs = new Float32Array((samples + 1) * 2 * 2);
    const index: number[] = [];
    const p = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    let u = 0;
    let prevX = 0;
    let prevZ = 0;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      curve.getPoint(t, p);
      curve.getTangent(t, tangent);
      if (i > 0) u += Math.hypot(p.x - prevX, p.z - prevZ) / CHEVRON_LENGTH;
      prevX = p.x;
      prevZ = p.z;
      const len = Math.hypot(tangent.x, tangent.z) || 1;
      const nx = -tangent.z / len;
      const nz = tangent.x / len;
      const half = RIBBON_WIDTH / 2;
      const lx = p.x + nx * half;
      const lz = p.z + nz * half;
      const rx = p.x - nx * half;
      const rz = p.z - nz * half;
      const vi = i * 2;
      positions.set([lx, this.groundAt(lx, lz) + RIBBON_LIFT, lz], vi * 3);
      positions.set([rx, this.groundAt(rx, rz) + RIBBON_LIFT, rz], (vi + 1) * 3);
      uvs.set([u, 0], vi * 2);
      uvs.set([u, 1], (vi + 1) * 2);
      if (i > 0) {
        const a = vi - 2;
        const b = vi - 1;
        index.push(a, b, vi, b, vi + 1, vi);
      }
    }
    this.ribbon.geometry.dispose();
    this.ribbon.geometry = coachRibbonGeometry(positions, uvs, index);
    this.builtKey = plan.key;
  }

  private hideRibbon(): void {
    this.ribbon.visible = false;
    this.builtKey = null;
  }

  /** The kill camps' wide draped ring: an annulus ribbon whose every vertex
   *  sits on the sampled terrain, rebuilt only when the camp changes. */
  private buildAreaRing(key: string, at: { x: number; z: number; radius: number }): void {
    this.hideAreaRing();
    const SEGMENTS = 72;
    const HALF_WIDTH = 0.5;
    const LIFT = 0.16;
    const positions = new Float32Array((SEGMENTS + 1) * 2 * 3);
    const index: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const ix = at.x + cos * (at.radius - HALF_WIDTH);
      const iz = at.z + sin * (at.radius - HALF_WIDTH);
      const ox = at.x + cos * (at.radius + HALF_WIDTH);
      const oz = at.z + sin * (at.radius + HALF_WIDTH);
      const vi = i * 2;
      positions.set([ix, this.groundAt(ix, iz) + LIFT, iz], vi * 3);
      positions.set([ox, this.groundAt(ox, oz) + LIFT, oz], (vi + 1) * 3);
      if (i > 0) {
        const p = vi - 2;
        const q = vi - 1;
        index.push(p, q, vi, q, vi + 1, vi);
      }
    }
    this.areaRing.geometry.dispose();
    this.areaRing.geometry = coachAreaRingGeometry(positions, index);
    this.areaRingKey = key;
  }

  private hideAreaRing(): void {
    this.areaRing.visible = false;
    this.areaRingKey = '';
  }

  /** Per-frame drive: every anchor is null off the island or when the
   *  station has no such target. `ringAt` doubles as the NPC aura anchor;
   *  `beamAt` is the non-character objective's light column; `areaRing`
   *  circles a kill camp. `time` is the renderer's shared clock. */
  update(
    plan: CoachTrailPlan | null,
    ringAt: { x: number; z: number } | null,
    beamAt: { x: number; z: number } | null,
    areaRing: { x: number; z: number; radius: number } | null,
    time: number,
    dt: number,
  ): void {
    if (!plan) {
      this.hideRibbon();
    } else {
      if (this.builtKey !== plan.key) this.buildRibbon(plan);
      if (this.builtKey !== null) {
        this.ribbon.visible = true;
        if (this.mats.ribbon.map) this.mats.ribbon.map.offset.x -= SCROLL_SPEED * dt;
        this.mats.ribbon.opacity = 0.65 + 0.2 * Math.sin(time * 2.4);
      }
    }
    this.updateRingAndAura(ringAt, time);
    this.updateBeam(beamAt, time);
    if (!areaRing) {
      this.areaRing.visible = false;
    } else {
      const key = `${areaRing.x},${areaRing.z},${areaRing.radius}`;
      if (this.areaRingKey !== key) this.buildAreaRing(key, areaRing);
      if (this.areaRingKey === key) {
        this.areaRing.visible = true;
        // A LOUD pulse (the playtest ask): the whole camp boundary breathes.
        this.mats.areaRing.opacity = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(time * 3.0));
      }
    }
  }

  private updateRingAndAura(ringAt: { x: number; z: number } | null, time: number): void {
    if (!ringAt) {
      this.ring.visible = false;
      this.aura.visible = false;
      return;
    }
    this.ring.visible = true;
    this.aura.visible = true;
    const key = `${ringAt.x},${ringAt.z}`;
    if (this.ringKey !== key) {
      this.ringKey = key;
      const ground = this.groundAt(ringAt.x, ringAt.z);
      this.ring.position.set(ringAt.x, ground + RING_LIFT, ringAt.z);
      this.aura.position.set(ringAt.x, ground + AURA_LIFT, ringAt.z);
    }
    const pulse = 1 + 0.1 * Math.sin(time * 3.4);
    this.ring.scale.setScalar(pulse);
    this.mats.ring.opacity = 0.4 + 0.25 * (0.5 + 0.5 * Math.sin(time * 3.4));
    const breathe = 1 + 0.07 * Math.sin(time * 2.2);
    this.aura.scale.set(AURA_WIDTH * breathe, AURA_HEIGHT * breathe, 1);
    this.mats.aura.opacity = 0.45 + 0.2 * (0.5 + 0.5 * Math.sin(time * 2.2));
  }

  private updateBeam(beamAt: { x: number; z: number } | null, time: number): void {
    if (!beamAt) {
      this.beam.visible = false;
      return;
    }
    this.beam.visible = true;
    const key = `${beamAt.x},${beamAt.z}`;
    if (this.beamKey !== key) {
      this.beamKey = key;
      const ground = this.groundAt(beamAt.x, beamAt.z);
      this.beam.position.set(beamAt.x, ground + COACH_BEAM_HEIGHT / 2, beamAt.z);
    }
    this.mats.beam.opacity = 0.5 + 0.2 * Math.sin(time * 2.8);
  }
}
