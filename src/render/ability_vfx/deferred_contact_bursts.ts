import type { ParticleBurstKind } from './fx';

interface Burst {
  active: boolean;
  delay: number;
  x: number;
  y: number;
  z: number;
  color: number;
  count: number;
  power: number;
  kind: ParticleBurstKind;
  duration?: number;
}
interface BurstHost {
  burstAt(
    x: number,
    y: number,
    z: number,
    color: number,
    count: number,
    power: number,
    kind: ParticleBurstKind,
    duration?: number,
  ): void;
}
/** Optional extraction garnish survives sequencer reuse without retaining its slot. */
export class DeferredContactBursts {
  private readonly slots: Burst[] = Array.from({ length: 48 }, () => ({
    active: false,
    delay: 0,
    x: 0,
    y: 0,
    z: 0,
    color: 0,
    count: 0,
    power: 0,
    kind: 'blood',
    duration: 0,
  }));
  reserve(
    x: number,
    y: number,
    z: number,
    color: number,
    count: number,
    power: number,
    kind: ParticleBurstKind,
    duration: number | undefined,
    delay: number,
  ): void {
    if (!Number.isFinite(delay) || delay <= 0) return;
    const slot = this.slots.find((s) => !s.active);
    if (!slot) return;
    slot.active = true;
    slot.delay = Math.min(0.2, delay);
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.color = color;
    slot.count = count;
    slot.power = power;
    slot.kind = kind;
    slot.duration = duration;
  }
  update(host: BurstHost, dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.delay -= dt;
      if (slot.delay > 0) continue;
      slot.active = false;
      // The extraction's end belongs to the contact clock, even when a slow
      // frame delivers it late. An unspecified lifetime remains host-owned.
      const duration = slot.duration === undefined ? undefined : slot.duration + slot.delay;
      // Vfx.burst clamps explicit lifetimes to 50 ms. Omit optional garnish
      // when that minimum would push it beyond the original contact window.
      if (duration !== undefined && duration < 0.05) continue;
      host.burstAt(slot.x, slot.y, slot.z, slot.color, slot.count, slot.power, slot.kind, duration);
    }
  }
  clear(): void {
    for (const slot of this.slots) slot.active = false;
  }
}
