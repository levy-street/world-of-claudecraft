// Transient point-light pulses for talent moments (proc surges, ward blooms,
// detonations): a tiny pooled set of THREE.PointLights the renderer flashes at
// an entity and forgets. Purely cosmetic (the graphics-fairness rule): the
// pool size shrinks with the static fx tier and the whole system is a no-op
// when the tier disables composer effects, so no tier gains information.
import * as THREE from 'three';
import { GFX } from './gfx';

interface Pulse {
  light: THREE.PointLight;
  remaining: number;
  duration: number;
  peak: number;
}

const SCHOOL_LIGHT: Record<string, number> = {
  fire: 0xff9a4d,
  frost: 0x86c9ff,
  arcane: 0xc79bff,
  shadow: 0x9a6bff,
  holy: 0xffe28a,
  nature: 0x9cf58e,
  physical: 0xffd9b0,
};

export class LightPulses {
  private pool: Pulse[] = [];

  constructor(private scene: THREE.Scene) {}

  private capacity(): number {
    // Composer-off tiers keep at most one live pulse; richer tiers a few.
    return GFX.composer ? 4 : 1;
  }

  /** Flash a short-lived point light at a world position. */
  pulse(at: THREE.Vector3, school: string, intensity = 6, duration = 0.45, range = 7): void {
    const cap = this.capacity();
    let slot = this.pool.find((p) => p.remaining <= 0);
    if (!slot && this.pool.length < cap) {
      const light = new THREE.PointLight(0xffffff, 0, range, 2);
      light.visible = false;
      this.scene.add(light);
      slot = { light, remaining: 0, duration: 1, peak: 1 };
      this.pool.push(slot);
    }
    if (!slot) {
      // Pool saturated: steal the dimmest pulse so big moments always show.
      slot = this.pool.reduce((a, b) => (a.remaining < b.remaining ? a : b));
    }
    slot.light.color.setHex(SCHOOL_LIGHT[school] ?? 0xffe28a);
    slot.light.position.copy(at);
    slot.light.position.y += 1.1;
    slot.light.distance = range;
    slot.remaining = duration;
    slot.duration = duration;
    slot.peak = intensity;
    slot.light.visible = true;
  }

  /** Advance and decay every live pulse; called once per frame. */
  update(dt: number): void {
    for (const p of this.pool) {
      if (p.remaining <= 0) continue;
      p.remaining -= dt;
      if (p.remaining <= 0) {
        p.light.intensity = 0;
        p.light.visible = false;
        continue;
      }
      // Fast attack, smooth quadratic decay.
      const f = p.remaining / p.duration;
      p.light.intensity = p.peak * f * f;
    }
  }
}
