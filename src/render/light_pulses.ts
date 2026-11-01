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
  // Held by a tracked owner (a moving light such as the Arc Bolt leader): the
  // owner writes position, colour and intensity every frame until it releases
  // the slot, which then decays like an ordinary pulse.
  tracked: boolean;
  // Bumped whenever the slot changes hands, so a stale token from an owner
  // whose slot was stolen can never move someone else's light.
  gen: number;
}

/** A tracked-light token: slot index plus that slot's generation. -1 = none. */
const TOKEN_SLOTS = 16;

/** The moving-light seam ability VFX consume (stepped_leader.ts): the pulse
 * pool implements it, so a tracked light needs no new THREE.PointLight. */
export interface TrackedLightHost {
  track(): number;
  setTracked(
    token: number,
    x: number,
    y: number,
    z: number,
    intensity: number,
    colorHex: number,
    range: number,
  ): boolean;
  releaseTracked(token: number, fadeSeconds: number): void;
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

export class LightPulses implements TrackedLightHost {
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
      this.pool.push({ light, remaining: 0, duration: 1, peak: 1, tracked: false, gen: 0 });
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
      if (this.pool[i].remaining <= 0 && !this.pool[i].tracked) {
        slot = this.pool[i];
        break;
      }
    }
    if (!slot) {
      // Pool saturated: steal the dimmest decaying pulse so big moments always
      // show; a tracked light is taken only when nothing else is left (its
      // owner sees the stale token and stops writing).
      for (let i = 0; i < cap; i++) {
        const p = this.pool[i];
        if (p.tracked) continue;
        if (!slot || p.remaining < slot.remaining) slot = p;
      }
      slot ??= this.pool[0];
    }
    if (slot.tracked) {
      slot.tracked = false;
      slot.gen++;
    }
    slot.light.color.setHex(SCHOOL_LIGHT[school] ?? 0xffe28a);
    slot.light.position.copy(at);
    slot.light.position.y += 1.1;
    slot.light.distance = range;
    slot.remaining = duration;
    slot.duration = duration;
    slot.peak = intensity;
  }

  /**
   * Claim a free slot for a moving light, or -1 when none can be spared (a
   * tracked light never steals: impacts and procs keep priority). On a pool of
   * more than one, tracked lights never hold the LAST untracked slot, so a
   * crowd of moving lights cannot crowd ordinary pulses onto one slot. The
   * light stays dark until the owner's first setTracked.
   */
  track(): number {
    const cap = Math.min(this.capacity(), this.pool.length);
    let untracked = 0;
    for (let i = 0; i < cap; i++) if (!this.pool[i].tracked) untracked++;
    if (cap > 1 && untracked <= 1) return -1;
    for (let i = 0; i < cap; i++) {
      const p = this.pool[i];
      if (p.remaining > 0 || p.tracked) continue;
      p.tracked = true;
      p.gen++;
      p.light.intensity = 0;
      return i + p.gen * TOKEN_SLOTS;
    }
    return -1;
  }

  private trackedSlot(token: number): Pulse | null {
    if (token < 0) return null;
    const p = this.pool[token % TOKEN_SLOTS];
    if (!p?.tracked || p.gen !== Math.floor(token / TOKEN_SLOTS)) return null;
    return p;
  }

  /** Write a tracked light's pose for this frame. False once the slot was
   * stolen or released (the token is stale). */
  setTracked(
    token: number,
    x: number,
    y: number,
    z: number,
    intensity: number,
    colorHex: number,
    range: number,
  ): boolean {
    const p = this.trackedSlot(token);
    if (!p) return false;
    p.light.position.set(x, y, z);
    p.light.color.setHex(colorHex);
    p.light.distance = range;
    p.light.intensity = Math.max(0, intensity);
    return true;
  }

  /** Hand a tracked light back to the pool, fading from its current intensity
   * over fadeSeconds (0 = off at once). A stale token is a no-op. */
  releaseTracked(token: number, fadeSeconds: number): void {
    const p = this.trackedSlot(token);
    if (!p) return;
    p.tracked = false;
    p.gen++;
    if (fadeSeconds > 0 && p.light.intensity > 0) {
      p.peak = p.light.intensity;
      p.remaining = fadeSeconds;
      p.duration = fadeSeconds;
    } else {
      p.remaining = 0;
      p.light.intensity = 0;
    }
  }

  /** Advance and decay every live pulse; called once per frame. Tracked
   * slots are the owner's to write and are skipped here. */
  update(dt: number): void {
    for (const p of this.pool) {
      if (p.tracked || p.remaining <= 0) continue;
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
