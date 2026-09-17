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
      host.burstAt(
        slot.x,
        slot.y,
        slot.z,
        slot.color,
        slot.count,
        slot.power,
        slot.kind,
        slot.duration,
      );
    }
  }
  clear(): void {
    for (const slot of this.slots) slot.active = false;
  }
}
