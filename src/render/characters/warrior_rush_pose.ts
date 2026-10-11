import { isRooted } from '../../sim/combat/cc';
import type { Entity } from '../../sim/types';
import type { AnimState } from './anim_state';

/** Mirror the movement owner's interruption rules using facts also on peers. */
export function onrushArrivalAllowed(
  source: Entity | undefined,
  target: Entity | undefined,
): boolean {
  return !!source && !!target && !source.dead && !target.dead && !isRooted(source);
}

export function createOnrushArrivalHandler<View>(
  entitiesNow: () => ReadonlyMap<number, Entity>,
  views: ReadonlyMap<number, View>,
  visualOf: (view: View) => { arriveFromOnrush(): boolean } | null,
): (sourceId: number, targetId: number) => boolean {
  return (sourceId, targetId) => {
    const entities = entitiesNow();
    if (!onrushArrivalAllowed(entities.get(sourceId), entities.get(targetId))) return false;
    const view = views.get(sourceId);
    return view ? (visualOf(view)?.arriveFromOnrush() ?? true) : true;
  };
}

/** A cast opens a bounded window; displayed movement owns the actual loop.
 * No local-only charge fields or runtime bone offsets are needed for peers. */
export class WarriorRushPose {
  active = false;
  arrivalStarted = false;
  private remaining = 0;
  private age = 0;
  private stalled = 0;
  private moved = false;
  private charge = false;
  private arrivalPending = 0;
  private recovery = 0;

  get recovering(): boolean {
    return this.recovery > 0;
  }

  get ownsBody(): boolean {
    // Damage events run before the next render sync. Preserve this cast's
    // existing short stop window so an automatic hit cannot insert a chop
    // between the rush and the successful-arrival notification.
    return this.active || this.recovering || (this.charge && this.moved && this.remaining > 0);
  }

  begin(ability: 'charge' | 'intervene' = 'charge'): void {
    this.cancel();
    this.charge = ability === 'charge';
    this.remaining = 3.2;
    this.age = this.stalled = 0;
    this.moved = false;
  }

  /** Called only by the sequencer's successfully travelled Onrush arrival. */
  arrive(): boolean {
    if (!this.charge || this.remaining <= 0 || this.arrivalPending || this.recovering) return false;
    this.arrivalPending = 0.18;
    return true;
  }

  cancel(): void {
    this.remaining = this.arrivalPending = this.recovery = 0;
    this.active = this.arrivalStarted = false;
  }

  update(dt: number, state: AnimState): boolean {
    const previous = this.active;
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const movingNow = state.rawMoving ?? state.moving;
    this.arrivalStarted = false;
    if (state.dead || state.swimming || state.airborne || state.casting) {
      this.cancel();
      return previous;
    }
    if (step === 0) return false;
    if (this.recovering) {
      this.recovery = Math.max(0, this.recovery - step);
      if (movingNow) this.cancel();
      return false;
    }
    if (this.arrivalPending > 0) {
      // The gait holds moving/speed for 220 ms after the actual stop. Use
      // displayed displacement, and accept a stopped large frame BEFORE the
      // timeout: a valid 200 ms frame must not swallow the whole finish.
      if (!movingNow && step > 0) {
        this.remaining = this.arrivalPending = 0;
        this.active = false;
        this.recovery = 0.3;
        this.arrivalStarted = true;
        return previous;
      }
      this.arrivalPending -= step;
      if (this.arrivalPending <= 0 || (movingNow && state.speed <= 10.5)) {
        this.cancel();
        return previous;
      }
    }
    this.remaining -= step;
    this.age += step;
    // The actual rush travels at 21 yd/s. Ordinary running at 7 yd/s must
    // release this pose even when the player never becomes stationary.
    const moving = state.moving && state.speed > 10.5;
    if (moving) {
      this.moved = true;
      this.stalled = 0;
    } else this.stalled += step;
    if ((this.moved && this.stalled > 0.14) || (!this.moved && this.age > 0.45)) this.remaining = 0;
    this.active = this.remaining > 0 && moving;
    return this.active !== previous;
  }
}
