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
import type { Surface } from './audio_sink';
import { bossAuraPlan, moteBudget, readBossVfxState } from './balgath_aura_core';
import { BalgathDebris } from './balgath_debris';
import {
  BALGATH_CLEAVE_ABILITY,
  BALGATH_CLEAVE_HALF_ARC,
  BALGATH_CLEAVE_TRAUMA,
  BALGATH_CRATER_FADE,
  BALGATH_CRATER_SECONDS,
  BALGATH_EYE_POOL_RADIUS,
  BALGATH_HAMMER_ABILITY,
  BALGATH_HAMMER_TRAUMA,
  BALGATH_RING_SECONDS,
  BALGATH_SMASH_MIN_RADIUS,
  BALGATH_SMASH_TRAUMA,
  BALGATH_STOMP_TRAUMA,
  BALGATH_STRIDE_UNITS,
  BALGATH_TEMPLATE_PREFIX,
  type BalgathRingPlan,
  balgathRingAlpha,
  balgathRingRadius,
  debrisPowerForBlast,
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
// Craters now live for minutes rather than seconds, so the cap is what bounds a long
// fight rather than a single slam. 28 is about two full warpath laps' worth of landmarks.
const MAX_ACTIVE_CRATERS = 28;

/** The entity shape this layer reads. Narrow on purpose: it never mutates the world. */
export interface BalgathBody {
  id: number;
  templateId?: string;
  /**
   * `y` matters as much as the other two here. He WADES a fen with his feet on the bed
   * (MobTemplate.wadeDepth), so his displayed height sits under the waterline wherever he
   * is in water, and the surface classifier reads exactly that: a foot below the surface
   * is a splash, a foot on dry mud is dust. Sampling terrain alone could not tell the two
   * apart, and the first cut (which rode the surface) kicked dust up through the lake.
   */
  pos: { x: number; y: number; z: number };
  castingAbility?: string | null;
  /** Everything the phase aura reads (balgath_aura_core.ts). All optional: an ordinary
   *  mob carries none of it and simply gets no aura. */
  warpathPhase?: 'focus' | 'travel' | 'wreck';
  warpathUnharried?: number;
  auras?: { kind?: string; id?: string }[];
  enraged?: boolean;
  hp?: number;
  maxHp?: number;
  scale?: number;
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
  ev: {
    x: number;
    z: number;
    fx: string;
    radius?: number;
    sourceId?: number;
    ability?: string;
    duration?: number;
    dirX?: number;
    dirZ?: number;
  },
  fx: BalgathFx,
  entities: () => Iterable<{ id: number; templateId?: string }>,
): boolean {
  // Cheap guards BEFORE the entity walk, and `entities` is a thunk so the walk is not
  // even reached for the overwhelming majority of effect events that are not a boss slam.
  // This sits at the top of a per-event hot path, and it also means a caller whose world
  // is not wired yet cannot be made to throw by an unrelated effect event.
  // The cleave's telegraph is the one RUNE CIRCLE this router takes: its damage is a
  // 120-degree wedge, so the generic full circle the renderer would draw promises four
  // times the area it will hit. Returning true suppresses that circle in favour of the arc.
  const telegraph = ev.fx === 'runeCircle' && ev.ability === BALGATH_CLEAVE_ABILITY;
  if (!telegraph && (ev.fx !== 'nova' || !ev.radius || ev.sourceId === undefined)) return false;
  if (!ev.radius || ev.sourceId === undefined) return false;
  let found = false;
  for (const e of entities()) {
    if (e.id !== ev.sourceId) continue;
    found = e.templateId?.startsWith(BALGATH_TEMPLATE_PREFIX) === true;
    break;
  }
  if (!found) return false;
  const aim = Math.atan2(ev.dirX ?? 0, ev.dirZ ?? 1);
  if (telegraph) {
    fx.cleaveTelegraph(ev.x, ev.z, ev.radius, aim, ev.duration ?? 1.5);
    return true;
  }
  if (ev.ability === BALGATH_CLEAVE_ABILITY) {
    fx.cleaveImpact(ev.x, ev.z, ev.radius, aim);
    return true;
  }
  if (ev.ability === BALGATH_HAMMER_ABILITY) {
    fx.hammerImpact(ev.x, ev.z, ev.radius);
    return true;
  }
  // The two slams differ by footprint, which is also how a raid tells them apart: the
  // smash is the big telegraphed circle, the stomp the tighter shockwave.
  if (ev.radius >= BALGATH_SMASH_MIN_RADIUS) {
    fx.smashImpact(ev.x, ev.z, ev.radius);
    fx.impactFelt(BALGATH_SMASH_TRAUMA, ev.x, ev.z);
  } else {
    fx.stompRing(ev.x, ev.z, ev.radius);
    fx.impactFelt(BALGATH_STOMP_TRAUMA, ev.x, ev.z);
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
  /** Per-boss fractional mote budget, carried frame to frame so a low rate still emits. */
  private auraCarry = new Map<number, number>();
  private seenThisFrame = new Set<number>();

  private debris: BalgathDebris;

  constructor(
    private scene: THREE.Scene,
    private groundHeightAt: (x: number, z: number) => number,
    /**
     * Camera trauma for a landed slam, with the impact's own position so the consumer can
     * weigh it by distance. Optional so a headless probe needs no camera.
     */
    private onImpact: (trauma: number, x: number, z: number) => void = () => {},
    /**
     * What the ground at a point is made of, so a slam into a reed bank and a slam into
     * open water do not look alike. This is the renderer's own footstep classifier
     * (world_audio.ts), passed in rather than re-derived, so the debris a fist throws and
     * the dust a boot lifts can never disagree about the same patch of ground.
     */
    private surfaceAt: (x: number, z: number, y: number) => Surface = () => 'dirt',
  ) {
    this.debris = new BalgathDebris(scene);
  }

  /**
   * Kick the camera for a landed slam, at the world point it landed on.
   *
   * The position is REQUIRED, and that is the whole point of the signature. It defaulted to
   * the origin while the two shipped call sites here still passed trauma alone, so every
   * smash and stomp reported an impact 450 yards away in the corner of the world, the
   * distance falloff correctly scored it zero, and the boss's heaviest blows landed in
   * total silence. Nothing about that is visible: the dust, the crater and the ring all
   * fire normally, and only the shake is missing.
   */
  impactFelt(trauma: number, x: number, z: number): void {
    this.onImpact(trauma, x, z);
  }

  setQuality(level: number): void {
    this.quality = Math.min(1, Math.max(0, level));
    this.debris.setQuality(this.quality);
  }

  /** The overhead smash landing. `radius` is the TRUE blast radius the telegraph drew. */
  smashImpact(x: number, z: number, radius: number): void {
    this.spawnRing(x, z, radius, SILT, 1);
    this.spawnCrater(x, z, radius);
    // A fist this size turns the ground over. The dust IS the impact read at distance,
    // where the ring is a thin line and the crater is hidden behind his own body.
    this.throwGround(x, z, radius, 1.7);
  }

  /** The shockwave stomp: same shape, quicker and thinner. */
  stompRing(x: number, z: number, radius: number): void {
    this.spawnRing(x, z, radius, SILT_DEEP, 0.72);
    this.throwGround(x, z, radius, 1.1);
  }

  /** One fist, dropped on a spot: a tight ring, a deep hole, and a column of soil. */
  hammerImpact(x: number, z: number, radius: number): void {
    this.spawnRing(x, z, radius, SILT, 0.9);
    this.spawnCrater(x, z, radius * 1.15);
    this.throwGround(x, z, radius, 1.5);
    this.impactFelt(BALGATH_HAMMER_TRAUMA, x, z);
  }

  /**
   * The cleave landing: material thrown along the ARC rather than out of a point.
   *
   * Seeding several small bursts across the sweep is what makes it read as an arm dragged
   * through the ground instead of an explosion that happened to be arc-shaped, and it is
   * the same trick the telegraph uses, so the promise and the payoff have the same shape.
   */
  cleaveImpact(x: number, z: number, radius: number, aim: number): void {
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const a = aim + BALGATH_CLEAVE_HALF_ARC * (-1 + (2 * i) / (steps - 1));
      const r = radius * 0.72;
      const px = x + Math.sin(a) * r;
      const pz = z + Math.cos(a) * r;
      this.spawnRing(px, pz, radius * 0.34, SILT_DEEP, 0.5);
      this.throwGround(px, pz, radius * 0.22, 0.5);
    }
    this.impactFelt(BALGATH_CLEAVE_TRAUMA, x, z);
  }

  /**
   * The ground telegraph for the cleave: an arc, not a circle.
   *
   * Drawn here rather than left to the renderer's generic rune circle because the damage
   * is a 120-degree wedge and a full circle promises four times the area it will actually
   * hit. A telegraph that overstates itself trains the raid to ignore it, which costs more
   * than having no telegraph at all.
   */
  cleaveTelegraph(x: number, z: number, radius: number, aim: number, seconds: number): void {
    const geo = new THREE.RingGeometry(
      radius * 0.12,
      radius,
      36,
      1,
      // three measures theta from +X counter-clockwise; the game's headings are from +Z
      // clockwise, so the start angle is (PI/2 - aim) minus the half-width.
      Math.PI / 2 - aim - BALGATH_CLEAVE_HALF_ARC,
      BALGATH_CLEAVE_HALF_ARC * 2,
    );
    geo.rotateX(-Math.PI / 2);
    const mat = fxMaterial(SILT, softDisc());
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, this.groundHeightAt(x, z) + 0.06, z);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    // Reuse the crater list: it is already an age-and-fade pool with a cap, and a
    // telegraph is a crater that lives for a second and a half.
    this.makeCraterRoom();
    this.craters.push({ mesh, mat, age: 0, life: Math.max(0.2, seconds) });
  }

  /**
   * Throw whatever this patch of ground is made of.
   *
   * The surface is sampled at the blast's own coordinates, not the boss's, so a fist that
   * lands in the shallows splashes while the giant standing on the bank does not.
   */
  private throwGround(x: number, z: number, radius: number, power: number): void {
    const y = this.groundHeightAt(x, z);
    this.debris.burst(
      x,
      y,
      z,
      this.surfaceAt(x, z, y),
      power * debrisPowerForBlast(radius),
      radius,
    );
  }

  /**
   * One footfall's dust. Deliberately tiny and budget-capped: this fires twice a second
   * for the whole fight, so it must never compete with the mechanics for particles.
   */
  footfall(x: number, z: number, power = 1, footY?: number): void {
    if (this.quality < 0.35) return;
    const ground = this.groundHeightAt(x, z);
    const surface = this.surfaceAt(x, z, footY ?? ground);
    if (surface === 'water') {
      // Wading. A thirteen-unit body does not leave dust on a fen: it throws the water
      // out of its own way, and at his stride that is the loudest thing about him.
      this.debris.burst(x, footY ?? ground, z, 'water', 0.55 * power, 1.4);
      this.spawnRing(x, z, 2.4 + power, SILT, 0.28);
      return;
    }
    this.spawnRing(x, z, 1.6 + power * 0.9, SILT, 0.34);
    this.debris.burst(x, ground, z, surface, 0.22 * power, 0.9);
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

  /**
   * Free a slot, dropping whatever has the least life LEFT rather than whatever is oldest.
   *
   * This pool holds two very different things: craters that live for three minutes, and
   * cleave telegraphs that live for one and a half seconds and reuse it because a
   * telegraph is just a crater in a hurry. Evicting the oldest entry means a busy fight's
   * telegraphs steadily delete the earliest craters, which are exactly the ones a raid
   * walked past and remembers. Evicting by remaining life always sacrifices a telegraph
   * first, and can only ever reach a crater once there is nothing cheaper to give up.
   */
  private makeCraterRoom(): void {
    if (this.craters.length < MAX_ACTIVE_CRATERS) return;
    let worst = 0;
    let leastLeft = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.craters.length; i++) {
      const left = this.craters[i].life - this.craters[i].age;
      if (left < leastLeft) {
        leastLeft = left;
        worst = i;
      }
    }
    this.retireCrater(worst);
  }

  private spawnCrater(x: number, z: number, radius: number): void {
    this.makeCraterRoom();
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
  private syncBosses(bosses: Iterable<BalgathBody>, dt: number, reducedMotion: boolean): void {
    this.seenThisFrame.clear();
    for (const e of bosses) {
      if (!e.templateId?.startsWith(BALGATH_TEMPLATE_PREFIX)) continue;
      this.seenThisFrame.add(e.id);
      // The eye's pool tracks the channel exactly: lit while the bar runs, out the
      // instant it stops. Re-armed every frame with a short lease rather than latched on
      // a start event, so an interrupted cast cannot leave the ground lit forever.
      if (e.castingAbility) this.eyeGlow(e.pos.x, e.pos.z, EYE_POOL_LEASE_SECONDS);

      this.syncAura(e, dt, reducedMotion);

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
      this.footfall(e.pos.x, e.pos.z, 1, e.pos.y);
    }
    // Forget bosses that despawned, so the stride table cannot grow without bound.
    for (const id of [...this.stride.keys()]) {
      if (!this.seenThisFrame.has(id)) this.stride.delete(id);
    }
    for (const id of [...this.auraCarry.keys()]) {
      if (!this.seenThisFrame.has(id)) this.retireAura(id);
    }
  }

  /**
   * The phase indicator, worn ON HIM rather than painted on the floor.
   *
   * This started as a coloured disc under his feet and that was the wrong surface: a
   * ground wash competes with the telegraph rings, which are the one thing on the floor a
   * player must never misread, and it disappears entirely the moment he is behind a rise or
   * the camera is low. State belongs on the body that has the state. So the phase now reads
   * as a SHELL of motes around him, at his own height, plus the fists and the eye.
   *
   * Driven from the live entity rather than from events, because every one of these is a
   * CONDITION rather than a moment (which phase, is the shield up, is he healing) and a
   * condition pushed as an event has to be un-pushed correctly on every exit path. Read
   * each frame, it cannot get stuck showing a heal that stopped ten seconds ago.
   */
  private syncAura(e: BalgathBody, dt: number, reducedMotion: boolean): void {
    const plan = bossAuraPlan(readBossVfxState(e));
    const scale = e.scale ?? 1;
    const carry = this.auraCarry.get(e.id) ?? 0;
    if (reducedMotion || this.quality < 0.4) {
      this.auraCarry.set(e.id, 0);
      return;
    }
    const [count, next] = moteBudget(plan, dt, carry);
    this.auraCarry.set(e.id, next);
    if (count === 0) return;
    const ground = this.groundHeightAt(e.pos.x, e.pos.z);
    // The shell: motes are seeded around his SILHOUETTE, from knee to shoulder, so they
    // hug the body instead of pooling at his feet. `chest` is where the inward flow ends.
    const chest: [number, number, number] = [e.pos.x, ground + 2.1 * scale, e.pos.z];
    const shell = 1.15 * scale;
    for (let i = 0; i < count; i++) {
      const t = ((i * 2654435761) % 1000) / 1000;
      const height = ground + (0.4 + 2.4 * t) * scale;
      this.debris.mote(
        e.pos.x,
        height,
        e.pos.z,
        plan.moteColor,
        0.4 + 0.3 * Math.min(1.6, scale) * 0.3,
        plan.moteFlow === 'inward' ? chest : undefined,
        shell,
      );
    }
  }

  private retireAura(id: number): void {
    this.auraCarry.delete(id);
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
    this.syncBosses(bosses, dt, reducedMotion);
    this.debris.update(dt);

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
      // Hold, then fade. A crater that starts dissolving the instant it is made never
      // reads as damage to the ground; one that sits at full strength and only gives up at
      // the end reads as a hole that is slowly filling in.
      const left = 1 - crater.age / crater.life;
      crater.mat.opacity = 0.5 * Math.min(1, left / BALGATH_CRATER_FADE);
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
    this.auraCarry.clear();
    this.stride.clear();
    this.debris.clear();
    for (let i = this.rings.length - 1; i >= 0; i--) this.retireRing(i);
    for (let i = this.craters.length - 1; i >= 0; i--) this.retireCrater(i);
    if (this.eyePool) this.eyePool.visible = false;
    this.eyeUntil = 0;
  }

  dispose(): void {
    this.clear();
    this.debris.dispose();
    if (this.eyePool) {
      this.scene.remove(this.eyePool);
      this.eyePool.geometry.dispose();
      this.eyePoolMat?.dispose();
      this.eyePool = null;
      this.eyePoolMat = null;
    }
  }
}
