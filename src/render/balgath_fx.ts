// Balgath, the Buried Foreman: the world boss's bespoke visual layer.
//
// Everything here is what the pooled particle vocabulary (vfx.ts burst/nova/groundPuff)
// and the shared telegraph ring cannot express on their own: a stone giant needs weight,
// and weight reads as GROUND behaviour, not sparks. Three effects carry the whole fight:
//
//  - `smashImpact`  the two-fisted overhead slam landing: a silt shockwave ring that
//                   expands and thins, plus a short-lived crater darkening. This is the
//                   payoff frame of the telegraphed circle the raid dodges, so it has to
//                   land exactly where the rune ring was drawn, never on the boss.
//  - `stompRing`    the lighter, faster cousin on the shockwave stomp.
//  - `footfall`     per-step dust while he strides. Cosmetic only and quality-scaled;
//                   this is the effect that sells "something enormous is walking toward
//                   Fenbridge" from across the fen.
//  - `eyeGlow`      the scrying channel: the Loom-shard eye brightens and throws a
//                   ground pool of teal light under him while the cast bar runs.
//
// Pure planning math (ring radii over time, fade curves, budget clamps) lives in
// balgath_fx_core.ts so it is Node-testable and registered in RENDER_PURE_CORES; this
// module owns only the Three objects. Reduced motion drops the expansion animation but
// keeps a static ring, so the mechanic stays readable: the telegraph is actionable
// information, and the gameplay-neutral-graphics invariant forbids hiding it.

import * as THREE from 'three';
import {
  BALGATH_CRATER_SECONDS,
  BALGATH_EYE_POOL_RADIUS,
  BALGATH_MECHANIC_MATCH_SQ,
  BALGATH_RING_SECONDS,
  BALGATH_SMASH_MIN_RADIUS,
  BALGATH_TEMPLATE_PREFIX,
  type BalgathRingPlan,
  balgathRingAlpha,
  balgathRingRadius,
  planBalgathRing,
} from './balgath_fx_core';

// These deliberately do NOT go through gfx.ts `surfaceMat`. That factory DEDUPES by
// (color|maps|flags) so hundreds of static surfaces can share one program, which is
// exactly wrong here: every ring animates its OWN opacity, and a shared material would
// make the newest ring's fade drive every older ring on screen. Short-lived, per-instance
// animated effects own their material and dispose it on retire.
function fxMaterial(color: number, alphaMap?: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    depthWrite: false,
    opacity: 0,
    alphaMap,
  });
}

// A radial falloff, white at the centre to nothing at the rim, used as an alpha
// map by the two effects that are supposed to be LIGHT or STAIN rather than a
// hard-bordered shape. Rendered without it, both read as a flat vinyl decal
// stuck to the fen: real light has no edge, and neither does a shock-crushed
// patch of ground. The shockwave RINGS deliberately keep their crisp edge; a
// telegraph is actionable information and wants to be legible, not pretty.
//
// Built once and shared forever: it is one 128px greyscale canvas, it never
// animates (only the per-instance material opacity does), and the module-level
// cache means the whole effect layer costs a single upload.
let softDiscTex: THREE.CanvasTexture | null = null;
function softDisc(): THREE.CanvasTexture {
  if (softDiscTex) return softDiscTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const mid = size / 2;
  // A null 2D context means the document cannot rasterize at all. Fail soft to an
  // un-mapped texture rather than throwing inside a per-effect spawn: the ring still
  // draws, it just draws hard-edged, which is a cosmetic loss and not a dead frame.
  if (!ctx) {
    softDiscTex = new THREE.CanvasTexture(canvas);
    return softDiscTex;
  }
  const grad = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  // Held near full out to 55% before it falls away, so the effect keeps a solid
  // readable core and spends its falloff on the outer half.
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.82, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  softDiscTex = new THREE.CanvasTexture(canvas);
  // Clamp, not the repeat default: a repeating alpha map tiles the falloff and
  // rings the disc with a bright seam at the UV edge.
  softDiscTex.wrapS = THREE.ClampToEdgeWrapping;
  softDiscTex.wrapT = THREE.ClampToEdgeWrapping;
  return softDiscTex;
}

// Silt grey-brown for the shockwave, fenlight teal for anything the eye touches: the
// zone's own two-note palette (Fenbridge's damp stone and its mirelight crystals).
const SILT = 0x9c9382;
const SILT_DEEP = 0x4a4438;
const FENLIGHT = 0x58d2ac;

const MAX_ACTIVE_RINGS = 12;
const MAX_ACTIVE_CRATERS = 8;

interface ActiveRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  plan: BalgathRingPlan;
  age: number;
}

interface ActiveCrater {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
}

/**
 * Route one `spellfxAt` event to Balgath's ground layer, or ignore it.
 *
 * The boss's mechanics ride the SHARED mob-mechanic emitters (`fx: 'runeCircle'` is
 * the telegraph, `fx: 'nova'` the detonation), which every boss in the game uses and
 * which carry no source id. So identity is resolved by POSITION: those emitters fire
 * at `mob.pos` exactly, so a Balgath standing on the event's own coordinates is the
 * caster. The match runs over the renderer's live entity list here rather than behind a
 * callback, so the whole rule (who counts as Balgath, how close is close enough) reads in
 * one place instead of being split across the coordinator. A tight radius keeps it honest:
 * if some other boss ever detonates on top of Balgath the worst case is one extra silt
 * ring, never a missing telegraph.
 *
 * Returns true when the event was consumed, so the caller can skip the generic path.
 * The telegraph deliberately is NOT consumed: the shared rune-circle ring is the
 * actionable information a player dodges, and replacing it with a cosmetic silt ring
 * would be a gameplay regression. Balgath's ring is drawn ON TOP of it, at impact.
 */
export function routeBalgathSpellfxAt(
  ev: { x: number; z: number; fx: string; radius?: number },
  fx: BalgathFx,
  entities: () => Iterable<{ templateId?: string; pos: { x: number; z: number } }>,
): boolean {
  // Cheap guards BEFORE the entity walk, and `entities` is a thunk so the walk is not
  // even reached for the overwhelming majority of effect events that are not a boss
  // slam. This sits at the top of a per-event hot path, so an unconditional scan of
  // every entity in interest range would be real per-frame cost for nothing, and it
  // would also let an unrelated event throw in a caller whose world is not wired yet.
  if (ev.fx !== 'nova' || !ev.radius) return false;
  let found = false;
  for (const e of entities()) {
    if (!e.templateId?.startsWith(BALGATH_TEMPLATE_PREFIX)) continue;
    const dx = e.pos.x - ev.x;
    const dz = e.pos.z - ev.z;
    if (dx * dx + dz * dz <= BALGATH_MECHANIC_MATCH_SQ) {
      found = true;
      break;
    }
  }
  if (!found) return false;
  // The two slams differ by footprint, which is also how a raid tells them apart:
  // the smash is the big telegraphed circle, the stomp the tighter shockwave.
  if (ev.radius >= BALGATH_SMASH_MIN_RADIUS) fx.smashImpact(ev.x, ev.z, ev.radius);
  else fx.stompRing(ev.x, ev.z, ev.radius);
  return true;
}

/** Balgath's ground-effect layer. The renderer owns one instance and ticks it. */
export class BalgathFx {
  private rings: ActiveRing[] = [];
  private craters: ActiveCrater[] = [];
  private eyePool: THREE.Mesh | null = null;
  private eyePoolMat: THREE.MeshBasicMaterial | null = null;
  private eyeUntil = 0;
  private clock = 0;
  private quality = 1;

  constructor(
    private scene: THREE.Scene,
    private groundHeightAt: (x: number, z: number) => number,
  ) {}

  setQuality(level: number): void {
    this.quality = Math.min(1, Math.max(0, level));
  }

  /** The overhead smash landing. `radius` is the TRUE blast radius the telegraph drew. */
  smashImpact(x: number, z: number, radius: number): void {
    this.spawnRing(x, z, radius, SILT, 1);
    this.spawnCrater(x, z, radius);
  }

  /** The shockwave stomp: same shape, quicker and thinner. */
  stompRing(x: number, z: number, radius: number): void {
    this.spawnRing(x, z, radius, SILT_DEEP, 0.72);
  }

  /**
   * One footfall's dust. Deliberately tiny and budget-capped: this fires twice a second
   * for the whole fight, so it must never compete with the mechanics for particles.
   */
  footfall(x: number, z: number, power = 1): void {
    if (this.quality < 0.35) return;
    this.spawnRing(x, z, 1.6 + power * 0.9, SILT, 0.34);
  }

  /** Hold the eye's ground pool lit for `seconds` (the scry channel's duration). */
  eyeGlow(x: number, z: number, seconds: number): void {
    if (!this.eyePool) {
      const geo = new THREE.CircleGeometry(BALGATH_EYE_POOL_RADIUS, 40);
      geo.rotateX(-Math.PI / 2);
      const mat = fxMaterial(FENLIGHT, softDisc());
      this.eyePool = new THREE.Mesh(geo, mat);
      this.eyePool.renderOrder = 2;
      this.eyePoolMat = mat;
      this.scene.add(this.eyePool);
    }
    this.eyePool.position.set(x, this.groundHeightAt(x, z) + 0.06, z);
    this.eyePool.visible = true;
    this.eyeUntil = this.clock + Math.max(0.1, seconds);
  }

  private spawnRing(x: number, z: number, radius: number, color: number, power: number): void {
    if (this.rings.length >= MAX_ACTIVE_RINGS) this.retireRing(0);
    const plan = planBalgathRing(radius, power);
    const geo = new THREE.RingGeometry(0.82, 1, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = fxMaterial(color);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, this.groundHeightAt(x, z) + 0.05, z);
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.rings.push({ mesh, mat, plan, age: 0 });
  }

  private spawnCrater(x: number, z: number, radius: number): void {
    if (this.craters.length >= MAX_ACTIVE_CRATERS) this.retireCrater(0);
    const geo = new THREE.CircleGeometry(radius * 0.55, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = fxMaterial(SILT_DEEP, softDisc());
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, this.groundHeightAt(x, z) + 0.04, z);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.craters.push({ mesh, mat, age: 0, life: BALGATH_CRATER_SECONDS });
  }

  update(dt: number, reducedMotion = false): void {
    this.clock += dt;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.age += dt;
      if (ring.age >= BALGATH_RING_SECONDS) {
        this.retireRing(i);
        continue;
      }
      // Reduced motion: hold the ring at its full radius instead of expanding it, so
      // the AREA still reads without the sweep.
      const r = reducedMotion
        ? ring.plan.maxRadius
        : balgathRingRadius(ring.plan, ring.age / BALGATH_RING_SECONDS);
      ring.mesh.scale.set(r, 1, r);
      ring.mat.opacity = balgathRingAlpha(ring.plan, ring.age / BALGATH_RING_SECONDS);
    }

    for (let i = this.craters.length - 1; i >= 0; i--) {
      const crater = this.craters[i];
      crater.age += dt;
      if (crater.age >= crater.life) {
        this.retireCrater(i);
        continue;
      }
      crater.mat.opacity = 0.5 * (1 - crater.age / crater.life);
    }

    if (this.eyePool && this.eyePoolMat) {
      const lit = this.clock < this.eyeUntil;
      this.eyePool.visible = lit;
      if (lit) {
        // A slow breath, not a strobe: reduced motion pins it to the mean.
        const pulse = reducedMotion ? 0.34 : 0.28 + 0.1 * Math.sin(this.clock * 3.1);
        this.eyePoolMat.opacity = pulse;
      }
    }
  }

  private retireRing(index: number): void {
    const ring = this.rings[index];
    this.scene.remove(ring.mesh);
    ring.mesh.geometry.dispose();
    ring.mat.dispose();
    this.rings.splice(index, 1);
  }

  private retireCrater(index: number): void {
    const crater = this.craters[index];
    this.scene.remove(crater.mesh);
    crater.mesh.geometry.dispose();
    crater.mat.dispose();
    this.craters.splice(index, 1);
  }

  clear(): void {
    for (let i = this.rings.length - 1; i >= 0; i--) this.retireRing(i);
    for (let i = this.craters.length - 1; i >= 0; i--) this.retireCrater(i);
    if (this.eyePool) this.eyePool.visible = false;
    this.eyeUntil = 0;
  }

  dispose(): void {
    this.clear();
    if (this.eyePool) {
      this.scene.remove(this.eyePool);
      this.eyePool.geometry.dispose();
      this.eyePoolMat?.dispose();
      this.eyePool = null;
      this.eyePoolMat = null;
    }
  }
}
