// Fire and Fly hit feedback: when a monster's strike costs the turret points, the
// screen edges flash red, the integrity bar glows and shakes, and the camera
// kicks, all scaled by the points lost. Each breach is read once, by sequence
// number, from the seat's feedback ring; the clock and the motion preference are
// injected, so the whole curve is testable without a DOM. The edge flash rises
// afresh at most three times a second, however fast the strikes land.
import type { TurretSessionView } from '../../../world_api/vehicles';
import { TurretFeedbackReader } from './turret_feedback_reader_core';

export const TURRET_HIT_ATTACK_MS = 80;
export const TURRET_HIT_RELEASE_MS = 600;
/** The flash overlay's opacity at full strength, kept under 1 so the world stays readable. */
export const TURRET_HIT_MAX_FLASH = 0.9;
/** Under reduced motion the flash peaks at this share of its usual opacity. */
export const TURRET_HIT_REDUCED_FLASH = 0.5;
/**
 * The shortest gap between two fresh rises of the edge flash, so it never flashes more
 * than three times in any second (WCAG 2.3.1). A strike inside the gap still glows and
 * swings the bar and kicks the camera at once; the edge flash takes it when the gap ends.
 */
export const TURRET_HIT_MIN_RISE_GAP_MS = 334;
/** A 1-point strike still reads at this share of full strength. */
const MIN_STRENGTH = 0.4;
/** Points lost in one frame that read at full strength: a large monster striking near full health. */
const FULL_POINTS = 12;
const CAMERA_SHAKE_MIN = 0.12;
const CAMERA_SHAKE_SPAN = 0.18;
/** Full sideways swings of the integrity bar per second. */
const GAUGE_SHAKE_HZ = 14;
/**
 * An entry older than this many ticks at its first read flashes nothing: a seat joined
 * late, or a stall long enough that the moment has passed.
 */
const STALE_TICKS = 10;

/** How hard a strike reads, 0 to 1, from the points it cost; 0 for no loss. */
export function turretHitStrength(points: number): number {
  if (!(points > 0)) return 0;
  const k = Math.min(1, Math.max(0, (points - 1) / (FULL_POINTS - 1)));
  return MIN_STRENGTH + (1 - MIN_STRENGTH) * k;
}

/** The camera trauma a strike adds; none under reduced motion. */
export function turretHitCameraShake(points: number, reducedMotion: boolean): number {
  if (reducedMotion || !(points > 0)) return 0;
  return CAMERA_SHAKE_MIN + CAMERA_SHAKE_SPAN * turretHitStrength(points);
}

/**
 * The flash level `elapsedMs` after a strike: from `from` up to `peak` over the
 * attack, then down to 0 over the release, easing out.
 */
export function turretHitLevel(elapsedMs: number, from: number, peak: number): number {
  if (elapsedMs <= 0) return from;
  if (elapsedMs < TURRET_HIT_ATTACK_MS)
    return from + (peak - from) * (elapsedMs / TURRET_HIT_ATTACK_MS);
  const u = (elapsedMs - TURRET_HIT_ATTACK_MS) / TURRET_HIT_RELEASE_MS;
  return u >= 1 ? 0 : peak * (1 - u) ** 2;
}

export interface TurretHitFrame {
  /** False once the flash has faded (or with no seat): nothing to show. */
  active: boolean;
  /** The edge flash overlay's opacity. */
  flash: number;
  /** The integrity bar's red glow, 0 to 1. */
  glow: number;
  /** The integrity bar's sideways swing, -1 to 1; 0 under reduced motion. */
  shake: number;
  /** Camera trauma to add on this frame (a strike landed), else 0. */
  cameraShake: number;
}

/** One strike's curve: from where it stands up to the strike's peak, then down to 0. */
class HitEnvelope {
  running = false;
  /** When the last strike restarted it. */
  startMs = 0;
  private from = 0;
  private peak = 0;

  level(now: number): number {
    return this.running ? turretHitLevel(now - this.startMs, this.from, this.peak) : 0;
  }

  /** Restacks a strike from the current level, never dropping to black first. */
  trigger(strength: number, now: number): void {
    const current = this.level(now);
    this.from = current;
    this.peak = Math.max(strength, current);
    this.startMs = now;
    this.running = true;
  }

  /** The level at `now`; the envelope stops once it has faded out. */
  settle(now: number): number {
    if (!this.running) return 0;
    const elapsed = now - this.startMs;
    const level = turretHitLevel(elapsed, this.from, this.peak);
    if (level <= 0 && elapsed > 0) this.running = false;
    return this.running ? level : 0;
  }
}

export class TurretHitFeedback {
  private readonly reader = new TurretFeedbackReader();
  private readonly frame: TurretHitFrame = {
    active: false,
    flash: 0,
    glow: 0,
    shake: 0,
    cameraShake: 0,
  };
  /** The bar's glow and swing: every strike restacks it at once. */
  private readonly gauge = new HitEnvelope();
  /** The edge flash: its fresh rises stay TURRET_HIT_MIN_RISE_GAP_MS apart. */
  private readonly veil = new HitEnvelope();
  /** The strongest strike waiting for the edge flash's gap to end; 0 for none. */
  private heldStrength = 0;
  private reduced = false;

  /**
   * `now` is a millisecond clock, read only while a flash runs or a strike lands;
   * `reducedMotion` is read once per strike.
   */
  constructor(
    private readonly now: () => number,
    private readonly reducedMotion: () => boolean,
  ) {}

  /** `clock` is the seat's sim tick (IWorld.turretClock), null when unknown. */
  update(session: TurretSessionView | null, clock: number | null): TurretHitFrame {
    const frame = this.frame;
    frame.cameraShake = 0;
    if (!session) {
      this.stop();
      return frame;
    }
    const fresh = this.reader.read(session);
    if (this.reader.newSeat) this.stop();
    let points = 0;
    for (const entry of fresh) {
      if (clock !== null && entry.tick < clock - STALE_TICKS) continue;
      if (entry.event.type === 'breach') points += entry.event.points;
    }
    if (points === 0 && !this.gauge.running && !this.veil.running && this.heldStrength === 0)
      return frame;
    const now = this.now();
    if (points > 0) this.strike(points, now);
    if (this.heldStrength > 0 && now - this.veil.startMs >= TURRET_HIT_MIN_RISE_GAP_MS) {
      this.veil.trigger(this.heldStrength, now);
      this.heldStrength = 0;
    }
    const glow = this.gauge.settle(now);
    const flash = this.veil.settle(now);
    if (!this.gauge.running && !this.veil.running && this.heldStrength === 0) {
      this.stop();
      return frame;
    }
    frame.active = true;
    frame.flash = flash * TURRET_HIT_MAX_FLASH * (this.reduced ? TURRET_HIT_REDUCED_FLASH : 1);
    frame.glow = glow;
    frame.shake = this.reduced
      ? 0
      : Math.sin((2 * Math.PI * GAUGE_SHAKE_HZ * (now - this.gauge.startMs)) / 1000) * glow;
    return frame;
  }

  private strike(points: number, now: number): void {
    const strength = turretHitStrength(points);
    this.reduced = this.reducedMotion();
    this.gauge.trigger(strength, now);
    if (this.veil.running && now - this.veil.startMs < TURRET_HIT_MIN_RISE_GAP_MS)
      this.heldStrength = Math.max(this.heldStrength, strength);
    else this.veil.trigger(strength, now);
    this.frame.cameraShake = turretHitCameraShake(points, this.reduced);
  }

  private stop(): void {
    this.gauge.running = false;
    this.veil.running = false;
    this.heldStrength = 0;
    const frame = this.frame;
    frame.active = false;
    frame.flash = 0;
    frame.glow = 0;
    frame.shake = 0;
  }
}
