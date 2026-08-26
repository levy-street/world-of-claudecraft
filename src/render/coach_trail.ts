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
// reads, no governor reads.

import * as THREE from 'three';
import type { CoachTrailPlan } from './coach_trail_core';

const RIBBON_WIDTH = 0.7;
const RIBBON_LIFT = 0.14;
const CHEVRON_LENGTH = 2.0; // world units per chevron repeat
const SCROLL_SPEED = 1.5; // repeats per second, toward the destination
const SAMPLES_PER_UNIT = 0.6; // cross-sections per world unit of route
const MIN_SAMPLES = 24;
const MAX_SAMPLES = 320;
const GOLD = 0xffc860;
const RING_INNER = 0.95;
const RING_OUTER = 1.35;
const RING_LIFT = 0.12;
// The target NPC's body aura: a soft radial billboard behind the model, the
// "glowing character" read (playtest: an arrow over the head looked wrong).
const AURA_WIDTH = 3.0;
const AURA_HEIGHT = 3.6;
const AURA_LIFT = 1.15;
// The non-character objective's vertical light column, sized to read across
// the whole shore ("a beam, say 25 yards").
const BEAM_HEIGHT = 25;
const BEAM_RADIUS = 0.55;

/** The race_line chevron strip, narrower: one arrow per repeat, pointing +u. */
function chevronTexture(): THREE.Texture {
  const w = 64;
  const h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(10, 4);
  ctx.lineTo(34, 16);
  ctx.lineTo(10, 28);
  ctx.lineTo(22, 16);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** A soft radial glow disc, drawn once (the aura sprite's face). */
function radialGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/** A vertical alpha falloff strip for the beam (bright at the ground, gone
 *  at the top). */
function beamFadeTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 64;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 64, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export class CoachTrail {
  private ribbon: THREE.Mesh | null = null;
  private mat: THREE.MeshBasicMaterial | null = null;
  private tex: THREE.Texture | null = null;
  private builtKey: string | null = null;
  private ring: THREE.Mesh | null = null;
  private ringMat: THREE.MeshBasicMaterial | null = null;
  private ringKey = '';
  private aura: THREE.Sprite | null = null;
  private auraMat: THREE.SpriteMaterial | null = null;
  private beam: THREE.Mesh | null = null;
  private beamMat: THREE.MeshBasicMaterial | null = null;
  private beamKey = '';
  private areaRing: THREE.Mesh | null = null;
  private areaRingMat: THREE.MeshBasicMaterial | null = null;
  private areaRingKey = '';

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
  ) {}

  /** Rebuild the draped ribbon for a new route key. */
  private buildRibbon(plan: CoachTrailPlan): void {
    this.disposeRibbon();
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(index);
    if (!this.tex) this.tex = chevronTexture();
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      color: new THREE.Color(GOLD).multiplyScalar(1.7),
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ribbon = new THREE.Mesh(geo, this.mat);
    this.ribbon.renderOrder = 3;
    // Diagnostics-only census bucket (world-space actionable UI, the
    // race_line precedent); never a behavior or visibility gate.
    this.ribbon.userData.renderCategory = 'ui3d';
    this.scene.add(this.ribbon);
    this.builtKey = plan.key;
  }

  private disposeRibbon(): void {
    if (this.ribbon) {
      this.scene.remove(this.ribbon);
      this.ribbon.geometry.dispose();
      this.ribbon = null;
    }
    this.mat?.dispose();
    this.mat = null;
    this.builtKey = null;
  }

  private ensureRing(): void {
    if (this.ring) return;
    const geo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 40);
    geo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(GOLD).multiplyScalar(1.9),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(geo, this.ringMat);
    this.ring.renderOrder = 3;
    this.ring.userData.renderCategory = 'ui3d';
    this.ring.visible = false;
    this.scene.add(this.ring);
  }

  private ensureAura(): void {
    if (this.aura) return;
    this.auraMat = new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color: new THREE.Color(GOLD).multiplyScalar(1.6),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.aura = new THREE.Sprite(this.auraMat);
    this.aura.renderOrder = 3;
    this.aura.userData.renderCategory = 'ui3d';
    this.aura.visible = false;
    this.scene.add(this.aura);
  }

  private ensureBeam(): void {
    if (this.beam) return;
    const geo = new THREE.CylinderGeometry(
      BEAM_RADIUS,
      BEAM_RADIUS * 1.5,
      BEAM_HEIGHT,
      14,
      1,
      true,
    );
    this.beamMat = new THREE.MeshBasicMaterial({
      map: beamFadeTexture(),
      color: new THREE.Color(GOLD).multiplyScalar(1.8),
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(geo, this.beamMat);
    this.beam.renderOrder = 3;
    this.beam.userData.renderCategory = 'ui3d';
    this.beam.visible = false;
    this.scene.add(this.beam);
  }

  /** The kill camps' wide draped ring: an annulus ribbon whose every vertex
   *  sits on the sampled terrain, rebuilt only when the camp changes. */
  private buildAreaRing(key: string, at: { x: number; z: number; radius: number }): void {
    this.disposeAreaRing();
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(index);
    this.areaRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(GOLD).multiplyScalar(1.8),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.areaRing = new THREE.Mesh(geo, this.areaRingMat);
    this.areaRing.renderOrder = 3;
    this.areaRing.userData.renderCategory = 'ui3d';
    this.scene.add(this.areaRing);
    this.areaRingKey = key;
  }

  private disposeAreaRing(): void {
    if (this.areaRing) {
      this.scene.remove(this.areaRing);
      this.areaRing.geometry.dispose();
      this.areaRing = null;
    }
    this.areaRingMat?.dispose();
    this.areaRingMat = null;
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
      if (this.ribbon) this.disposeRibbon();
    } else {
      if (this.builtKey !== plan.key) this.buildRibbon(plan);
      if (this.ribbon && this.mat && this.tex) {
        this.ribbon.visible = true;
        this.tex.offset.x -= SCROLL_SPEED * dt;
        this.mat.opacity = 0.65 + 0.2 * Math.sin(time * 2.4);
      }
    }
    this.updateRingAndAura(ringAt, time);
    this.updateBeam(beamAt, time);
    if (!areaRing) {
      if (this.areaRing) this.areaRing.visible = false;
    } else {
      const key = `${areaRing.x},${areaRing.z},${areaRing.radius}`;
      if (this.areaRingKey !== key) this.buildAreaRing(key, areaRing);
      if (this.areaRing && this.areaRingMat) {
        this.areaRing.visible = true;
        // A LOUD pulse (the playtest ask): the whole camp boundary breathes.
        this.areaRingMat.opacity = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(time * 3.0));
      }
    }
  }

  private updateRingAndAura(ringAt: { x: number; z: number } | null, time: number): void {
    if (!ringAt) {
      if (this.ring) this.ring.visible = false;
      if (this.aura) this.aura.visible = false;
      return;
    }
    this.ensureRing();
    this.ensureAura();
    if (!this.ring || !this.ringMat || !this.aura || !this.auraMat) return;
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
    this.ringMat.opacity = 0.4 + 0.25 * (0.5 + 0.5 * Math.sin(time * 3.4));
    const breathe = 1 + 0.07 * Math.sin(time * 2.2);
    this.aura.scale.set(AURA_WIDTH * breathe, AURA_HEIGHT * breathe, 1);
    this.auraMat.opacity = 0.45 + 0.2 * (0.5 + 0.5 * Math.sin(time * 2.2));
  }

  private updateBeam(beamAt: { x: number; z: number } | null, time: number): void {
    if (!beamAt) {
      if (this.beam) this.beam.visible = false;
      return;
    }
    this.ensureBeam();
    if (!this.beam || !this.beamMat) return;
    this.beam.visible = true;
    const key = `${beamAt.x},${beamAt.z}`;
    if (this.beamKey !== key) {
      this.beamKey = key;
      const ground = this.groundAt(beamAt.x, beamAt.z);
      this.beam.position.set(beamAt.x, ground + BEAM_HEIGHT / 2, beamAt.z);
    }
    this.beamMat.opacity = 0.5 + 0.2 * Math.sin(time * 2.8);
  }
}
