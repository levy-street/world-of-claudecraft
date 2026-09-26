// Transient point-light pulses for talent moments (proc surges, ward blooms,
// detonations): a tiny pooled set of THREE.PointLights the renderer flashes at
// an entity and forgets. Purely cosmetic (the graphics-fairness rule): the
// pool size shrinks with the static fx tier, so no tier gains information.
//
// The whole pool is created eagerly in the constructor and every light stays
// `visible` forever at intensity 0. The pulses are carrier sources
// (point_light_carriers.ts): three never gathers them, the carriers draw the
// live ones, and the pool size is part of the pinned carrier count.
import * as THREE from 'three';
import { GFX } from './gfx';
import { markPointLightSource } from './point_light_carriers_core';

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

/** Composer-off tiers keep at most one live pulse; richer tiers a few. */
export function lightPulsePoolSize(): number {
  return GFX.composer ? 4 : 1;
}

export class LightPulses {
  private pool: Pulse[] = [];
  readonly lights: THREE.PointLight[] = [];

  constructor(scene: THREE.Scene) {
    // GFX is final by construction time (initGfxTier runs before any scene
    // content), so eager-create exactly the tier's capacity. capacity() is
    // still consulted per pulse and clamped to the pool as a guard.
    for (let i = 0; i < this.capacity(); i++) {
      const light = new THREE.PointLight(0xffffff, 0, 7, 2);
      markPointLightSource(light);
      scene.add(light);
      this.pool.push({ light, remaining: 0, duration: 1, peak: 1 });
      this.lights.push(light);
    }
  }

  private capacity(): number {
    return lightPulsePoolSize();
  }

  /** Flash a short-lived point light at a world position. */
  pulse(at: THREE.Vector3, school: string, intensity = 6, duration = 0.45, range = 7): void {
    const cap = Math.min(this.capacity(), this.pool.length);
    if (cap === 0) return;
    let slot: Pulse | undefined;
    for (let i = 0; i < cap; i++) {
      if (this.pool[i].remaining <= 0) {
        slot = this.pool[i];
        break;
      }
    }
    if (!slot) {
      // Pool saturated: steal the dimmest pulse so big moments always show.
      slot = this.pool[0];
      for (let i = 1; i < cap; i++) {
        if (this.pool[i].remaining < slot.remaining) slot = this.pool[i];
      }
    }
    slot.light.color.setHex(SCHOOL_LIGHT[school] ?? 0xffe28a);
    slot.light.position.copy(at);
    slot.light.position.y += 1.1;
    slot.light.distance = range;
    slot.remaining = duration;
    slot.duration = duration;
    slot.peak = intensity;
  }

  /** Advance and decay every live pulse; called once per frame. */
  update(dt: number): void {
    for (const p of this.pool) {
      if (p.remaining <= 0) continue;
      p.remaining -= dt;
      if (p.remaining <= 0) {
        p.light.intensity = 0;
        continue;
      }
      // Fast attack, smooth quadratic decay.
      const f = p.remaining / p.duration;
      p.light.intensity = p.peak * f * f;
    }
  }
}
