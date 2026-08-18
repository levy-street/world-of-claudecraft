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
  BALGATH_RING_SECONDS,
  BALGATH_SMASH_MIN_RADIUS,
  BALGATH_SMASH_TRAUMA,
  BALGATH_STOMP_TRAUMA,
  BALGATH_STRIDE_UNITS,
  BALGATH_TEMPLATE_PREFIX,
  type BalgathRingPlan,
  balgathRingAlpha,
  balgathRingRadius,
  EYE_POOL_LEASE_SECONDS,
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
function softDisc(): THREE.CanvasTexture | undefined {
  if (softDiscTex) return softDiscTex;
  // No document at all: a Node unit test driving this layer's timing and budgets. Answer
  // undefined so the material simply carries no alpha map, exactly as it already does
  // when the 2D context comes back null. The effects still spawn, retire and count
  // correctly; they just lose the soft edge, which is what a headless caller cannot see
  // anyway. The alternative is a DOM shim in every test that touches an impact.
  if (typeof document === 'undefined') return undefined;
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

/** The entity shape this layer reads. Narrow on purpose: it never mutates the world. */
export interface BalgathBody {
  id: number;
  templateId?: string;
  pos: { x: number; z: number };
  castingAbility?: string | null;
}

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
 * Identity comes from `sourceId`, not from the event's coordinates. That is not a
 * preference: a telegraphed blast detonates at the centre of the ring the players were
 * shown, and the boss has usually walked several yards off it during the 1.2s windup, so
 * a proximity match against live bodies fails exactly when the mechanic is working
 * correctly. Matching the id is exact and cannot be fooled by two bosses fighting in the
 * same place.
 *
 * Returns true when the event was consumed, so the caller can skip the generic path. The
 * telegraph itself is deliberately NOT consumed: the shared rune-circle ring is the
 * actionable information a player dodges, and swapping it for a cosmetic silt ring would
 * be a gameplay regression. Balgath's ring is drawn ON TOP of it, at impact.
 */
export function routeBalgathSpellfxAt(
  ev: { x: number; z: number; fx: string; radius?: number; sourceId?: number },
  fx: BalgathFx,
  entities: () => Iterable<{ id: number; templateId?: string }>,
): boolean {
  // Cheap guards BEFORE the entity walk, and `entities` is a thunk so the walk is not
  // even reached for the overwhelming majority of effect events that are not a boss slam.
  // This sits at the top of a per-event hot path, and it also means a caller whose world
  // is not wired yet cannot be made to throw by an unrelated effect event.
  if (ev.fx !== 'nova' || !ev.radius || ev.sourceId === undefined) return false;
  let found = false;
  for (const e of entities()) {
    if (e.id !== ev.sourceId) continue;
    found = e.templateId?.startsWith(BALGATH_TEMPLATE_PREFIX) === true;
    break;
  }
  if (!found) return false;
  // The two slams differ by footprint, which is also how a raid tells them apart: the
  // smash is the big telegraphed circle, the stomp the tighter shockwave.
  if (ev.radius >= BALGATH_SMASH_MIN_RADIUS) {
    fx.smashImpact(ev.x, ev.z, ev.radius);
    fx.impactFelt(BALGATH_SMASH_TRAUMA);
  } else {
    fx.stompRing(ev.x, ev.z, ev.radius);
    fx.impactFelt(BALGATH_STOMP_TRAUMA);
  }
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
  /** Per-boss distance-travelled accumulator for footfall spacing. */
  private stride = new Map<number, { x: number; z: number; left: boolean }>();
  private seenThisFrame = new Set<number>();

  constructor(
    private scene: THREE.Scene,
    private groundHeightAt: (x: number, z: number) => number,
    /** Camera trauma for a landed slam. Optional so a headless probe needs no camera. */
    private onImpact: (trauma: number) => void = () => {},
  ) {}

  /** Kick the camera for a landed slam. Reduced motion is handled by the consumer. */
  impactFelt(trauma: number): void {
    this.onImpact(trauma);
  }

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

  /**
   * Per-frame world integration, driven off the live entity list.
   *
   * Two things a giant needs that no event can carry, because both are continuous:
   * dust under his feet while he walks, and the eye's ground pool while he channels.
   * Reading them here rather than from renderer.ts hooks keeps the coordinator at two
   * call sites total and puts the whole boss's presentation in one file.
   */
  private syncBosses(bosses: Iterable<BalgathBody>): void {
    this.seenThisFrame.clear();
    for (const e of bosses) {
      if (!e.templateId?.startsWith(BALGATH_TEMPLATE_PREFIX)) continue;
      this.seenThisFrame.add(e.id);
      // The eye's pool tracks the channel exactly: lit while the bar runs, out the
      // instant it stops. Re-armed every frame with a short lease rather than latched on
      // a start event, so an interrupted cast cannot leave the ground lit forever.
      if (e.castingAbility) this.eyeGlow(e.pos.x, e.pos.z, EYE_POOL_LEASE_SECONDS);

      // Footfall dust, spaced by DISTANCE TRAVELLED rather than by a timer: that is what
      // ties a puff to a footfall instead of to the frame rate, so it stays in step when
      // he is slowed, and stops entirely when he stops.
      const last = this.stride.get(e.id);
      if (!last) {
        this.stride.set(e.id, { x: e.pos.x, z: e.pos.z, left: false });
        continue;
      }
      const moved = Math.hypot(e.pos.x - last.x, e.pos.z - last.z);
      if (moved < BALGATH_STRIDE_UNITS) continue;
      last.x = e.pos.x;
      last.z = e.pos.z;
      last.left = !last.left;
      this.footfall(e.pos.x, e.pos.z, 1);
    }
    // Forget bosses that despawned, so the stride table cannot grow without bound.
    for (const id of [...this.stride.keys()]) {
      if (!this.seenThisFrame.has(id)) this.stride.delete(id);
    }
  }

  /**
   * Advance every effect by one frame.
   *
   * `bosses` is the live entity list; the continuous half of the presentation (footfall
   * dust, the eye's ground pool) is read from it here rather than pushed in from the
   * renderer, so the coordinator keeps ONE call and the two halves cannot drift out of
   * step with each other.
   */
  update(dt: number, reducedMotion = false, bosses: Iterable<BalgathBody> = []): void {
    this.clock += dt;
    this.syncBosses(bosses);

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
    this.stride.clear();
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
