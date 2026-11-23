// The Gorgebloom's body effects (plan: gorgebloom_fx_core.ts, the model's
// measured facts: gorgebloom_model_core.ts), composed by WildheartFx
// (basin_fx.ts) under its gated root:
//  - Seed Rain: sap and pollen dust shaken off while the bulb swells, then the
//    spit itself at the maw (the seeds' arcs start there: basin_boss_bursts.ts);
//  - Pollinate: the four sacs sparkle as they swell, then burst in gold clouds
//    blasted outward, a drifting haze, the pollen reaching its marks;
//  - Vine Lash: water and leaves shed off the club held high, the club slamming
//    the loam where the model's own club lands (8.7 yd out), then a wave of
//    thorns tearing up out of the loam down the rest of the 30 yd lane;
//  - Gorge: acid drooling from the gaping maw, the bite crunching shut at the
//    model's maw over the tank, the acid flung on each shake, the swallow;
//  - Bloom Spit: the throat's flash as the glob leaves (the glob itself is the
//    bursts' seed slot, launched on the same beat);
//  - the roar on the pull, and its death: the last pollen, the petals torn
//    off as it wilts, the head crashing into the root pool, the bubbles and
//    rings as it sinks.
// It also drives the model: the Pollinate, Bloom Spit and Roar clips and the
// glow of its gullet and sacs (VisualDef.glowPulses) are gestures sent from
// here, never over a strike's play-out.
//
// Cosmetic only (src/render/CLAUDE.md): nothing here is a telegraph (the lane,
// the Gorge mark and the pods' rings are basin_boss_fx.ts's, on the encounter
// band); the splashes ride the shared ground-band pools. Built once under the
// host's root before its gated attach; no per-frame allocation; no light.

import {
  BLOOM_POLLINATE,
  BLOOM_SPIT,
  BLOOM_TUNING,
  GORGEBLOOM_ID,
} from '../../sim/encounters/wildheart_basin/ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { BOSS_SPLASH, bossBodyHeight } from './basin_boss_fx_core';
import type { BasinPuffOptions } from './basin_fx_core';
import type { BasinFxHost } from './basin_fx_host';
import { GORGEBLOOM_ROOT_POOL } from './basin_plan_core';
import {
  BLOOM_CROWNS,
  BLOOM_RIPPLES,
  BLOOM_TINTS,
  type BloomBeat,
  type BloomTrigger,
  bloomBarTrigger,
  bloomEventTrigger,
  bloomPlayOutSeconds,
  GORGEBLOOM_GULLET_GESTURE,
  GORGEBLOOM_ROAR_GESTURE,
  GORGEBLOOM_SACS_GESTURE,
  GORGEBLOOM_THROAT_GESTURE,
  gorgebloomBeats,
  lashWaveStations,
  ROOT_POOL_LIFT,
  THORN_SPROUT_EMERGE_GESTURE,
  THORN_SPROUT_EMERGE_WINDOW,
} from './gorgebloom_fx_core';
import {
  GORGEBLOOM_CLIP,
  GORGEBLOOM_MODEL,
  gorgebloomModelScale,
  gorgebloomModelToWorld,
  type ModelPoint,
} from './gorgebloom_model_core';

const BEAT_SLOTS = 56;
const EMERGE_SLOTS = 8;
/** Seconds within which repeated events of one cast are one burst (Seed Rain
 *  sends six, Pollinate one per mark, all on the same tick). */
const SAME_CAST = 0.4;

interface PendingBeat {
  at: number;
  beat: BloomBeat | null;
  entityId: number;
  targetId: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  scale: number;
  live: boolean;
}

/** What the fx remember of one Gorgebloom between frames. */
interface Tracker {
  id: number;
  seen: boolean;
  dead: boolean;
  engaged: boolean;
  /** The bar the effects already reacted to, and its time left last frame
   *  (a bar of the same id restarting shows as that time jumping back up). */
  barCast: string | null;
  barRemaining: number;
  /** Its strike clip plays out until then (no gesture may cut it). */
  playOutUntil: number;
  lastSeed: number;
  lastPollinate: number;
}

export class GorgebloomFx {
  private readonly beats: PendingBeat[] = [];
  private readonly trackers = new Map<number, Tracker>();
  private readonly stations: number[] = [];
  private readonly pt: ModelPoint = { x: 0, y: 0, z: 0 };
  private readonly pt2: ModelPoint = { x: 0, y: 0, z: 0 };
  /** Reused puff options for the hot paths (the wave's dirt and sap). */
  private readonly dirt: BasinPuffOptions = {
    speed: 4,
    up: 4.5,
    life: 0.9,
    size: [0.42, 0.16],
    color: [0.36, 0.27, 0.16],
    alpha: 1,
    gravity: 13,
    drag: 0.4,
    radius: 0.6,
  };
  private readonly sapSpray: BasinPuffOptions = {
    speed: 5,
    up: 3,
    life: 0.8,
    size: [0.3, 0.1],
    color: [0.55, 0.85, 0.25],
    alpha: 0.95,
    gravity: 11,
    glow: true,
    radius: 0.5,
  };
  /** Sprouts just risen: the Emerge gesture is offered until their view
   *  takes it (each body plays it once). */
  private readonly emerges: { id: number; until: number }[] = [];
  private clock = 0;

  constructor(
    private readonly host: BasinFxHost,
    private readonly world: IWorld,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
    private readonly lashYaw: (casterId: number, fallback: number) => number = (_, f) => f,
  ) {
    for (let i = 0; i < EMERGE_SLOTS; i++) this.emerges.push({ id: -1, until: -1 });
    for (let i = 0; i < BEAT_SLOTS; i++)
      this.beats.push({
        at: 0,
        beat: null,
        entityId: -1,
        targetId: -1,
        x: 0,
        y: 0,
        z: 0,
        facing: 0,
        scale: 1,
        live: false,
      });
  }

  // ------------------------------------------------------------------ events

  /** The Gorgebloom's own spellfx (its body beats). True when drawn here; the
   *  seeds and the spit's glob are still launched by the bursts after this. */
  handleEvent(ev: SimEvent & { type: 'spellfx' }, src: Entity): boolean {
    if (src.templateId !== GORGEBLOOM_ID) return false;
    const trigger = bloomEventTrigger(ev.ability);
    if (!trigger) return false;
    const t = this.tracker(src);
    switch (trigger) {
      case 'seedSpit':
        if (this.clock - t.lastSeed < SAME_CAST) return true;
        t.lastSeed = this.clock;
        this.schedule('seedSpit', src);
        return true;
      case 'pollinate': {
        // One burst per cast; each mark gets the pollen reaching it.
        if (this.clock - t.lastPollinate >= SAME_CAST) {
          t.lastPollinate = this.clock;
          this.playGesture?.(src.id, GORGEBLOOM_SACS_GESTURE);
          if (this.mayGesture(t, src)) this.playGesture?.(src.id, BLOOM_POLLINATE);
          this.schedule('pollinate', src, -1, 'pollenReach');
        }
        this.scheduleOne(
          { kind: 'pollenReach', at: GORGEBLOOM_CLIP.pollinateBurst + 0.35 },
          src,
          ev.targetId,
        );
        return true;
      }
      case 'lashSlam': {
        // The lane's locked line (the sim holds the bloom on it through the bar).
        const yaw = this.lashYaw(src.id, src.facing);
        this.schedule('lashSlam', src, -1, null, yaw);
        if (!this.host.reducedMotion()) this.host.shake(0.3);
        return true;
      }
      case 'gorgeBite':
        this.schedule('gorgeBite', src, ev.targetId);
        if (!this.host.reducedMotion()) this.host.shake(0.25);
        return true;
      case 'sprout': {
        // A Thorn Sprout bursts out of its pod: its Emerge clip, the pod
        // splitting on the clip's burst frame.
        const add = this.world.entities.get(ev.targetId);
        if (!add || add.id === src.id) return true;
        const slot = this.emerges.find((m) => m.until < this.clock) ?? this.emerges[0];
        slot.id = add.id;
        slot.until = this.clock + THORN_SPROUT_EMERGE_WINDOW;
        this.playGesture?.(add.id, THORN_SPROUT_EMERGE_GESTURE);
        this.schedule('sprout', add);
        return true;
      }
      case 'spit':
        this.playGesture?.(src.id, GORGEBLOOM_THROAT_GESTURE);
        if (this.mayGesture(t, src)) this.playGesture?.(src.id, BLOOM_SPIT);
        this.schedule('spit', src);
        return true;
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------- scans

  beginScan(): void {
    for (const t of this.trackers.values()) t.seen = false;
  }

  /** One Gorgebloom seen by the scan (its bars, pull and death are stepped
   *  each frame in update). */
  scanBloom(e: Entity): void {
    if (e.templateId !== GORGEBLOOM_ID) return;
    this.tracker(e).seen = true;
  }

  endScan(): void {
    for (const [id, t] of this.trackers) if (!t.seen) this.trackers.delete(id);
  }

  // ------------------------------------------------------------------- frame

  update(_dt: number, clock: number): void {
    this.clock = clock;
    this.stepTrackers();
    this.fireBeats();
    this.stepEmerges();
  }

  hideAll(): void {
    for (const b of this.beats) b.live = false;
    for (const m of this.emerges) m.until = -1;
  }

  /** Nothing of its own to free: the thorns, splashes and particles are the
   *  host's. */
  dispose(): void {
    this.trackers.clear();
  }

  // ---------------------------------------------------------------- internals

  private tracker(e: Entity): Tracker {
    let t = this.trackers.get(e.id);
    if (!t) {
      t = {
        id: e.id,
        seen: true,
        dead: e.dead,
        // A view joining a fight already under way never roars it in again.
        engaged: e.inCombat && !e.dead,
        barCast: null,
        barRemaining: 0,
        playOutUntil: -1,
        lastSeed: -1e9,
        lastPollinate: -1e9,
      };
      this.trackers.set(e.id, t);
    }
    return t;
  }

  /** A gesture would cut nothing: no bar runs and no strike is playing out. */
  private mayGesture(t: Tracker, e: Entity): boolean {
    return !e.dead && e.castingAbility === null && this.clock >= t.playOutUntil;
  }

  private stepEmerges(): void {
    for (const m of this.emerges) {
      if (m.until < this.clock) continue;
      const e = this.world.entities.get(m.id);
      if (!e || e.dead) {
        m.until = -1;
        continue;
      }
      this.playGesture?.(m.id, THORN_SPROUT_EMERGE_GESTURE);
    }
  }

  private stepTrackers(): void {
    for (const t of this.trackers.values()) {
      const e = this.world.entities.get(t.id);
      if (!e) continue;
      if (e.dead && !t.dead) this.schedule('death', e);
      t.dead = e.dead;
      // The pull: it roars as the fight opens.
      const engaged = e.inCombat && !e.dead;
      if (engaged && !t.engaged) {
        this.playGesture?.(e.id, GORGEBLOOM_ROAR_GESTURE);
        this.schedule('roar', e);
      }
      t.engaged = engaged;
      // A bar opening: its windup beats, the gullet stoked for the spit and
      // the bite. A bar ending starts its strike's play-out window.
      const bar = e.dead ? null : e.castingAbility;
      const restarted =
        bar !== null && bar === t.barCast && e.castRemaining > t.barRemaining + 0.05;
      if (bar !== t.barCast || restarted) {
        if (t.barCast && !bar) t.playOutUntil = this.clock + bloomPlayOutSeconds(t.barCast);
        const trigger = bloomBarTrigger(bar);
        if (trigger && e.castRemaining > e.castTotal - 0.3) {
          this.schedule(trigger, e);
          if (trigger !== 'lashBar') this.playGesture?.(e.id, GORGEBLOOM_GULLET_GESTURE);
        }
        t.barCast = bar;
      }
      t.barRemaining = bar ? e.castRemaining : 0;
    }
  }

  private schedule(
    trigger: BloomTrigger,
    e: Entity,
    targetId = -1,
    skip: BloomBeat['kind'] | null = null,
    facing = e.facing,
  ): void {
    for (const beat of gorgebloomBeats(trigger, e.scale || 1)) {
      if (beat.kind === skip) continue;
      this.scheduleOne(beat, e, targetId, facing);
    }
  }

  private scheduleOne(beat: BloomBeat, e: Entity, targetId: number, facing = e.facing): void {
    const slot = this.beats.find((b) => !b.live);
    if (!slot) return;
    slot.live = true;
    slot.at = this.clock + beat.at;
    slot.beat = beat;
    slot.entityId = e.id;
    slot.targetId = targetId;
    slot.x = e.pos.x;
    slot.y = e.pos.y;
    slot.z = e.pos.z;
    slot.facing = facing;
    slot.scale = e.scale || 1;
  }

  private fireBeats(): void {
    for (const b of this.beats) {
      if (!b.live || this.clock < b.at || !b.beat) continue;
      b.live = false;
      this.playBeat(b.beat, b);
    }
  }

  /** A model point of the beat's bloom to the world (into `out`). */
  private at(b: PendingBeat, p: ModelPoint, out: ModelPoint = this.pt): ModelPoint {
    return gorgebloomModelToWorld(b, b.facing, b.scale, p, out);
  }

  /** The surface at (x, z): the root pool's skin of water on the dais round
   *  the bloom, the loam beyond it. */
  private surfaceY(b: PendingBeat, x: number, z: number): number {
    const gy = this.host.groundY(x, z);
    return this.inPool(b, x, z) ? gy + ROOT_POOL_LIFT : gy;
  }

  private inPool(b: PendingBeat, x: number, z: number): boolean {
    return Math.hypot(x - b.x, z - b.z) <= GORGEBLOOM_ROOT_POOL.r;
  }

  /** A world direction from a model one (x its left, z forward). */
  private dir(b: PendingBeat, mx: number, my: number, mz: number): [number, number, number] {
    const s = Math.sin(b.facing);
    const c = Math.cos(b.facing);
    return [mz * s + mx * c, my, mz * c - mx * s];
  }

  private playBeat(beat: BloomBeat, b: PendingBeat): void {
    const host = this.host;
    const k = gorgebloomModelScale(b.scale);
    const C = GORGEBLOOM_CLIP;
    switch (beat.kind) {
      case 'gulletSwell': {
        // The bulb swells and the petals curl: sap weeps, pollen dust shakes off.
        const p = this.at(b, C.seedMaw);
        host.puff(p.x, p.y - 0.6, p.z, 8, {
          speed: 0.8,
          up: 1.6,
          life: 1.1,
          size: [0.45, 0.12],
          color: [1, 0.55, 0.22],
          alpha: 0.9,
          glow: true,
          radius: 0.9 * k,
        });
        host.puff(p.x, p.y - 1.5, p.z, 10, {
          speed: 1.2,
          up: 0.4,
          life: 2,
          size: [0.8, 2.4],
          color: [0.95, 0.84, 0.45],
          alpha: 0.32,
          drag: 1.6,
          radius: 3 * k,
        });
        host.puff(p.x, p.y - 1, p.z, 5, {
          speed: 0.6,
          life: 1.2,
          size: [0.22, 0.12],
          color: [0.55, 0.78, 0.22],
          alpha: 1,
          gravity: 9,
          radius: 1.2 * k,
        });
        return;
      }
      case 'seedSpit': {
        // The retch: sap and husks blown out of the maw after the six pods.
        const p = this.at(b, C.seedMaw);
        const d = this.dir(b, 0, 0.69, 0.72);
        host.puff(p.x, p.y, p.z, 2, {
          speed: 0.5,
          life: 0.32,
          size: [4.5 * k, 1.2 * k],
          color: [1, 0.6, 0.25],
          alpha: 0.9,
          glow: true,
        });
        host.puff(p.x, p.y, p.z, 26, {
          speed: 9,
          life: 1.2,
          size: [0.38, 0.14],
          color: [0.62, 0.88, 0.28],
          alpha: 1,
          glow: true,
          gravity: 12,
          dir: d,
          spread: 0.55,
        });
        host.puff(p.x, p.y, p.z, 16, {
          speed: 7,
          life: 1.4,
          size: [0.5, 0.3],
          color: [0.45, 0.06, 0.08],
          alpha: 1,
          gravity: 11,
          dir: d,
          spread: 0.7,
        });
        host.puff(p.x, p.y, p.z, 8, {
          speed: 3,
          up: 0.6,
          life: 1.8,
          size: [1.4, 4],
          color: [0.86, 0.9, 0.62],
          alpha: 0.35,
          drag: 1.8,
          dir: d,
          spread: 0.6,
        });
        if (!host.reducedMotion()) host.shake(0.12);
        return;
      }
      case 'sacSwell': {
        for (const sac of GORGEBLOOM_MODEL.sacs) {
          const p = this.at(b, sac);
          host.puff(p.x, p.y, p.z, 6, {
            speed: 0.7,
            up: 0.5,
            life: 0.7,
            size: [0.3, 0.08],
            color: [1, 0.9, 0.42],
            alpha: 1,
            glow: true,
            radius: 0.8 * k,
          });
        }
        return;
      }
      case 'pollenBurst':
        this.pollenBurst(b, k);
        return;
      case 'pollenReach': {
        const target = this.world.entities.get(b.targetId);
        if (!target || target.dead) return;
        const th = bossBodyHeight(target.templateId, target.scale || 1);
        host.puff(target.pos.x, target.pos.y + th * 0.5, target.pos.z, 34, {
          speed: 3,
          up: 1,
          life: 1.2,
          size: [0.5, 0.12],
          color: [1, 0.86, 0.35],
          alpha: 1,
          glow: true,
          radius: 0.8,
        });
        host.puff(target.pos.x, target.pos.y + th * 0.5, target.pos.z, 8, {
          speed: 1.4,
          life: 1.6,
          size: [1.2, 3.2],
          color: [1, 0.88, 0.45],
          alpha: 0.35,
          drag: 1.6,
          radius: 0.6,
        });
        return;
      }
      case 'lashRear': {
        // The club held high sheds the pool's water and torn leaves.
        const p = this.at(b, C.lashHighTip);
        host.puff(p.x, p.y, p.z, 18, {
          speed: 1.2,
          life: 1.3,
          size: [0.3, 0.12],
          color: [0.88, 0.96, 1],
          alpha: 0.9,
          glow: true,
          gravity: 14,
          radius: 0.8 * k,
        });
        host.puff(p.x, p.y, p.z, 10, {
          speed: 1.6,
          life: 2.2,
          size: [0.45, 0.35],
          color: [0.28, 0.46, 0.14],
          alpha: 1,
          gravity: 3,
          drag: 1.4,
          radius: 1 * k,
        });
        return;
      }
      case 'lashSlam':
        this.lashSlam(b, k);
        return;
      case 'lashWave':
        this.lashWave(b, beat.k ?? 0);
        return;
      case 'gorgeDrool': {
        const p = this.at(b, C.gorgeGapeMaw);
        host.puff(p.x, p.y - 0.4, p.z, 14, {
          speed: 0.8,
          life: 1.5,
          size: [0.32, 0.16],
          color: [0.62, 0.95, 0.26],
          alpha: 1,
          glow: true,
          gravity: 9,
          radius: 0.9 * k,
        });
        host.puff(p.x, p.y, p.z, 6, {
          speed: 0.8,
          up: 1.2,
          life: 1.6,
          size: [1, 3],
          color: [0.7, 0.9, 0.55],
          alpha: 0.3,
          drag: 1.5,
          radius: 0.8 * k,
        });
        return;
      }
      case 'gorgeBite':
        this.gorgeBite(b, k);
        return;
      case 'gorgeShake': {
        // Acid flung off the clamped petals, one side then the other.
        const p = this.at(b, C.gorgeBiteMaw);
        const side = (beat.k ?? 0) % 2 === 0 ? 1 : -1;
        host.puff(p.x, p.y + 0.8, p.z, 16, {
          speed: 8,
          up: 3,
          life: 1.1,
          size: [0.3, 0.12],
          color: [0.62, 0.95, 0.26],
          alpha: 1,
          glow: true,
          gravity: 12,
          dir: this.dir(b, side, 0.35, 0.25),
          spread: 0.5,
        });
        return;
      }
      case 'gorgeSwallow': {
        const p = this.at(b, { x: 0, y: 6.2, z: 2.4 });
        host.puff(p.x, p.y, p.z, 3, {
          speed: 0.4,
          life: 0.5,
          size: [2.2 * k, 3.2 * k],
          color: [0.62, 1, 0.36],
          alpha: 0.55,
          glow: true,
        });
        host.splash.ripple(b.x, this.surfaceY(b, b.x, b.z) + 0.03, b.z, BLOOM_RIPPLES.deathSink);
        return;
      }
      case 'spitFlash': {
        const p = this.at(b, C.spitMaw);
        host.puff(p.x, p.y, p.z, 2, {
          speed: 0.4,
          life: 0.22,
          size: [2.4 * k, 0.6 * k],
          color: [0.7, 1, 0.35],
          alpha: 1,
          glow: true,
        });
        host.puff(p.x, p.y, p.z, 10, {
          speed: 6,
          life: 0.7,
          size: [0.28, 0.1],
          color: [0.62, 0.95, 0.26],
          alpha: 1,
          glow: true,
          gravity: 10,
          dir: this.dir(b, 0, -0.2, 1),
          spread: 0.4,
        });
        return;
      }
      case 'roarPeak':
        this.roar(b, k);
        return;
      case 'deathShriek': {
        // The last of its pollen, coughed out as it shrieks.
        for (const sac of GORGEBLOOM_MODEL.sacs) {
          const p = this.at(b, sac);
          host.puff(p.x, p.y, p.z, 6, {
            speed: 2.5,
            up: 0.8,
            life: 2.2,
            size: [1.2, 3.8],
            color: [0.95, 0.84, 0.42],
            alpha: 0.4,
            drag: 1.6,
            radius: 0.6 * k,
          });
          host.puff(p.x, p.y, p.z, 8, {
            speed: 3,
            up: 1,
            life: 1.4,
            size: [0.3, 0.08],
            color: [1, 0.86, 0.35],
            alpha: 1,
            glow: true,
          });
        }
        return;
      }
      case 'deathPetals': {
        // Torn petal scraps and pale warts shed as the head sinks.
        const u = (beat.k ?? 0) / 3;
        const p = this.at(b, { x: 0, y: 8.2 - u * 5.4, z: 2.6 + u * 0.8 });
        host.puff(p.x, p.y, p.z, 12, {
          speed: 2.6,
          up: 0.6,
          life: 2.8,
          size: [0.75, 0.55],
          color: [0.6, 0.07, 0.09],
          alpha: 1,
          gravity: 2.2,
          drag: 1.5,
          radius: 3.2 * k,
        });
        host.puff(p.x, p.y, p.z, 5, {
          speed: 2,
          life: 2.4,
          size: [0.3, 0.2],
          color: [0.85, 0.72, 0.6],
          alpha: 1,
          gravity: 3,
          drag: 1.2,
          radius: 2.6 * k,
        });
        return;
      }
      case 'deathSplash':
        this.deathSplash(b, k);
        return;
      case 'sproutBurst':
        this.sproutBurst(b);
        return;
      case 'deathSink': {
        const y = this.surfaceY(b, b.x, b.z);
        host.splash.ripple(b.x, y + 0.03, b.z, BLOOM_RIPPLES.deathSink, BLOOM_TINTS.water);
        host.puff(b.x, y + 0.1, b.z, 12, {
          speed: 0.3,
          up: 1.4,
          life: 1.1,
          size: [0.26, 0.1],
          color: [0.9, 0.97, 1],
          alpha: 0.9,
          radius: GORGEBLOOM_MODEL.bulbRadius * k,
        });
        return;
      }
    }
  }

  // ----- Pollinate

  private pollenBurst(b: PendingBeat, k: number): void {
    const host = this.host;
    for (const sac of GORGEBLOOM_CLIP.pollinateSacs) {
      const p = this.at(b, sac);
      const l = Math.hypot(sac.x, sac.z) || 1;
      const d = this.dir(b, sac.x / l, 0.35, sac.z / l);
      host.puff(p.x, p.y, p.z, 18, {
        speed: 7,
        life: 2.4,
        size: [2.4, 7.5],
        color: [1, 0.86, 0.4],
        alpha: 0.7,
        drag: 1.8,
        dir: d,
        spread: 0.6,
      });
      host.puff(p.x, p.y, p.z, 34, {
        speed: 9,
        life: 1.7,
        size: [0.36, 0.1],
        color: [1, 0.9, 0.42],
        alpha: 1,
        glow: true,
        gravity: 1.5,
        drag: 0.8,
        dir: d,
        spread: 0.8,
      });
      host.puff(p.x, p.y, p.z, 2, {
        speed: 0.3,
        life: 0.3,
        size: [3 * k, 1 * k],
        color: [1, 0.85, 0.35],
        alpha: 0.9,
        glow: true,
      });
    }
    // The grain haze drifting over the terrace after.
    host.puff(b.x, b.y + 4.5 * k, b.z, 10, {
      speed: 1.4,
      up: 0.2,
      life: 3.6,
      size: [4, 10],
      color: [1, 0.9, 0.55],
      alpha: 0.22,
      drag: 1.2,
      radius: 5 * k,
    });
    host.shockRing(b.x, b.z, 0xffe27a, 9 * k, 0.8);
  }

  // ----- Vine Lash

  private lashSlam(b: PendingBeat, k: number): void {
    const host = this.host;
    const C = GORGEBLOOM_CLIP;
    const p = this.at(b, C.lashTipImpact);
    const y = this.surfaceY(b, p.x, p.z);
    const wet = this.inPool(b, p.x, p.z);
    host.splash.crown(
      p.x,
      y - 0.05,
      p.z,
      BLOOM_CROWNS.clubSlam,
      wet ? BLOOM_TINTS.water : BLOOM_TINTS.loam,
    );
    host.splash.ripple(
      p.x,
      y + 0.04,
      p.z,
      BLOOM_RIPPLES.clubSlam,
      wet ? BLOOM_TINTS.water : BLOOM_TINTS.sap,
    );
    host.shockRing(p.x, p.z, 0xb8ff8a, 5.5, 0.55);
    host.shockRing(p.x, p.z, 0xfff0c8, 7, 0.75);
    host.puff(p.x, y + 0.3, p.z, 30, {
      speed: 8,
      up: 6,
      life: 1.2,
      size: [0.5, 0.2],
      color: [0.36, 0.27, 0.16],
      alpha: 1,
      gravity: 14,
      drag: 0.35,
      radius: 1,
    });
    host.puff(p.x, y + 0.3, p.z, 20, {
      speed: 6,
      up: 4,
      life: 0.9,
      size: [0.32, 0.1],
      color: [0.55, 0.85, 0.25],
      alpha: 0.95,
      glow: true,
      gravity: 11,
    });
    host.puff(p.x, y + 0.5, p.z, 16, {
      speed: 5,
      up: 1,
      life: 1.9,
      size: [1.8, 5],
      color: [0.58, 0.5, 0.36],
      alpha: 0.45,
      drag: 2,
      radius: 1.5,
    });
    // The whole vine slaps down flat behind the club, root to tip.
    this.at(b, C.lashVineRoot, this.pt2);
    for (let i = 1; i <= 4; i++) {
      const u = i / 5;
      const x = this.pt2.x + (p.x - this.pt2.x) * u;
      const z = this.pt2.z + (p.z - this.pt2.z) * u;
      host.puff(x, this.surfaceY(b, x, z) + 0.2, z, 5, {
        speed: 2.5,
        up: 1.5,
        life: 1.2,
        size: [1, 2.6],
        color: [0.62, 0.56, 0.44],
        alpha: 0.4,
        drag: 2,
        radius: 0.6 * k,
      });
    }
    // A crown of thorns tears up round the club.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + b.facing;
      this.host.thorns.spawn(p.x + Math.sin(a) * 1.3, p.z + Math.cos(a) * 1.3, a, 0.5, 1.6, 0);
    }
  }

  /** One station of the wave tearing down the rest of the lane. */
  private lashWave(b: PendingBeat, k: number): void {
    const host = this.host;
    const stations = lashWaveStations(b.scale, this.stations);
    const d = stations[k];
    if (d === undefined) return;
    const ax = Math.sin(b.facing);
    const az = Math.cos(b.facing);
    // The lane's edges: thorns lean out over them, the middle stands tall.
    const half = BLOOM_TUNING.lashHalfWidth;
    const r = () => host.rand();
    for (let j = 0; j < 3; j++) {
      const lateral = j === 0 ? (r() - 0.5) * 0.8 : (j === 1 ? -1 : 1) * half * (0.7 + 0.2 * r());
      const along = d + (r() - 0.5) * 1.2;
      const x = b.x + ax * along + az * lateral;
      const z = b.z + az * along - ax * lateral;
      const lean = j === 0 ? 0.12 : 0.45;
      const yaw = j === 0 ? r() * Math.PI * 2 : b.facing + (j === 1 ? 1 : -1) * Math.PI * 0.5;
      this.host.thorns.spawn(x, z, yaw, lean, j === 0 ? 2 + r() * 0.6 : 1.3 + r() * 0.5, 0);
    }
    const x = b.x + ax * d;
    const z = b.z + az * d;
    const y = this.surfaceY(b, x, z);
    if (k % 2 === 0) host.splash.crown(x, y - 0.05, z, BLOOM_CROWNS.thorn, BLOOM_TINTS.loam);
    this.dirt.radius = half * 0.8;
    host.puff(x, y + 0.3, z, 6, this.dirt);
    host.puff(x, y + 0.3, z, 3, this.sapSpray);
  }

  // ----- Gorge

  private gorgeBite(b: PendingBeat, k: number): void {
    const host = this.host;
    const p = this.at(b, GORGEBLOOM_CLIP.gorgeBiteMaw);
    const down = this.dir(b, 0, -0.75, 0.6);
    // The petals crunch shut: a hot flash, acid sprayed down over the tank,
    // torn red petal flesh.
    host.puff(p.x, p.y, p.z, 2, {
      speed: 0.4,
      life: 0.26,
      size: [4 * k, 1.2 * k],
      color: [1, 0.42, 0.28],
      alpha: 1,
      glow: true,
    });
    host.puff(p.x, p.y, p.z, 28, {
      speed: 7,
      life: 1,
      size: [0.36, 0.12],
      color: [0.62, 0.95, 0.26],
      alpha: 1,
      glow: true,
      gravity: 12,
      dir: down,
      spread: 0.7,
    });
    host.puff(p.x, p.y + 0.6, p.z, 18, {
      speed: 5,
      up: 2,
      life: 1.1,
      size: [0.45, 0.25],
      color: [0.62, 0.08, 0.1],
      alpha: 1,
      gravity: 10,
      radius: 1.2 * k,
    });
    const tank = this.world.entities.get(b.targetId);
    if (!tank) return;
    // The acid splashing round the tank's feet, the hit on him.
    const th = bossBodyHeight(tank.templateId, tank.scale || 1);
    const ty = this.surfaceY(b, tank.pos.x, tank.pos.z);
    host.splash.crown(tank.pos.x, ty - 0.05, tank.pos.z, BOSS_SPLASH.gorge.crown, BLOOM_TINTS.acid);
    if (BOSS_SPLASH.gorge.ripple)
      host.splash.ripple(
        tank.pos.x,
        ty + 0.04,
        tank.pos.z,
        BOSS_SPLASH.gorge.ripple,
        BLOOM_TINTS.acid,
      );
    host.puff(tank.pos.x, tank.pos.y + th * 0.55, tank.pos.z, 24, {
      speed: 5,
      life: 0.5,
      size: [1.3, 0.3],
      color: [1, 0.22, 0.24],
      alpha: 1,
      glow: true,
    });
  }

  // ----- the roar

  private roar(b: PendingBeat, k: number): void {
    const host = this.host;
    const p = this.at(b, GORGEBLOOM_CLIP.roarMaw);
    host.puff(p.x, p.y, p.z, 30, {
      speed: 6,
      life: 1.4,
      size: [0.4, 0.1],
      color: [1, 0.86, 0.4],
      alpha: 1,
      glow: true,
      dir: this.dir(b, 0, 0.8, 0.6),
      spread: 0.9,
    });
    host.puff(p.x, p.y, p.z, 10, {
      speed: 4,
      life: 2,
      size: [1.6, 5],
      color: [0.9, 0.86, 0.6],
      alpha: 0.3,
      drag: 1.6,
      dir: this.dir(b, 0, 0.5, 0.8),
      spread: 0.7,
    });
    const y = this.surfaceY(b, b.x, b.z);
    host.splash.crown(b.x, y - 0.05, b.z, BLOOM_CROWNS.roar, BLOOM_TINTS.water);
    host.splash.ripple(b.x, y + 0.03, b.z, BLOOM_RIPPLES.roar, BLOOM_TINTS.water);
    host.shockRing(b.x, b.z, 0xffe8a0, 10 * k, 0.9);
    if (!host.reducedMotion()) host.shake(0.35);
  }

  // ----- a Thorn Sprout bursting out of its pod (b is the sprout)

  private sproutBurst(b: PendingBeat): void {
    const host = this.host;
    const e = this.world.entities.get(b.entityId);
    const x = e ? e.pos.x : b.x;
    const z = e ? e.pos.z : b.z;
    const y = host.groundY(x, z);
    host.splash.crown(x, y - 0.05, z, BOSS_SPLASH.sprout.crown, BOSS_SPLASH.sprout.tint);
    if (BOSS_SPLASH.sprout.ripple)
      host.splash.ripple(x, y + 0.04, z, BOSS_SPLASH.sprout.ripple, BOSS_SPLASH.sprout.tint);
    host.shockRing(x, z, 0xb8ff8a, 3.2, 0.6);
    // The pod's red shell in shards, its pale pith, the loam it split.
    host.puff(x, y + 0.5, z, 22, {
      speed: 7,
      up: 5,
      life: 1.3,
      size: [0.55, 0.35],
      color: [0.5, 0.05, 0.07],
      alpha: 1,
      gravity: 13,
      drag: 0.4,
    });
    host.puff(x, y + 0.5, z, 14, {
      speed: 5,
      up: 4,
      life: 1.1,
      size: [0.3, 0.18],
      color: [0.9, 0.84, 0.7],
      alpha: 1,
      gravity: 12,
    });
    host.puff(x, y + 0.3, z, 24, {
      speed: 4,
      up: 1.5,
      life: 1.4,
      size: [1.4, 3.6],
      color: [0.46, 0.34, 0.2],
      alpha: 0.6,
      drag: 2,
      radius: 1,
    });
    // Glowing spores hanging in the air after.
    host.puff(x, y + 0.8, z, 18, {
      speed: 1.2,
      up: 1.2,
      life: 2,
      size: [0.3, 0.08],
      color: [0.85, 1, 0.45],
      alpha: 1,
      glow: true,
      radius: 1.2,
    });
    // Thorn shoots spring up round the split pod.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + host.rand() * 0.6;
      const r = 0.9 + host.rand() * 0.5;
      host.thorns.spawn(x + Math.sin(a) * r, z + Math.cos(a) * r, a, 0.55, 0.9 + host.rand() * 0.5);
    }
    if (!host.reducedMotion()) host.shake(0.12);
  }

  // ----- the death

  private deathSplash(b: PendingBeat, k: number): void {
    const host = this.host;
    const p = this.at(b, GORGEBLOOM_CLIP.deathSplashAt);
    const y = this.surfaceY(b, p.x, p.z);
    const wet = this.inPool(b, p.x, p.z);
    host.splash.crown(
      p.x,
      y - 0.05,
      p.z,
      BLOOM_CROWNS.deathSplash,
      wet ? BLOOM_TINTS.water : BLOOM_TINTS.loam,
    );
    host.splash.ripple(p.x, y + 0.03, p.z, BLOOM_RIPPLES.deathSplash, BLOOM_TINTS.water);
    host.puff(p.x, y + 0.3, p.z, 70, {
      speed: 4,
      up: 7,
      life: 1.4,
      size: [0.36, 0.14],
      color: [0.9, 0.97, 1],
      alpha: 0.95,
      gravity: 15,
      drag: 0.25,
      radius: 2.2 * k,
      glow: true,
    });
    host.puff(p.x, y + 0.8, p.z, 14, {
      speed: 3,
      up: 1.2,
      life: 2.6,
      size: [2.2, 6.5],
      color: [0.93, 0.96, 0.94],
      alpha: 0.34,
      drag: 1.6,
      radius: 3 * k,
    });
    host.puff(p.x, y + 1, p.z, 20, {
      speed: 4,
      up: 3,
      life: 2.6,
      size: [0.7, 0.5],
      color: [0.6, 0.07, 0.09],
      alpha: 1,
      gravity: 4,
      drag: 1.3,
      radius: 2 * k,
    });
    host.puff(p.x, y + 1.5, p.z, 12, {
      speed: 2.4,
      up: 1.2,
      life: 2,
      size: [0.3, 0.08],
      color: [1, 0.86, 0.35],
      alpha: 1,
      glow: true,
      radius: 2 * k,
    });
    host.shockRing(p.x, p.z, 0xe8f4ff, 8 * k, 1);
    if (!host.reducedMotion()) host.shake(0.45);
  }
}
