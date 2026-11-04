// A loose gale's toss as a SHOVE (Jose's playtest of 2026-11-04: touching a
// Breath tornado threw him sideways like a teleport), a part of
// BreathFightFx. The sim now slides the body out over a short eased moment
// (encounters/smith_heart/breath_shove.ts) under an unbreakable root, so
// every client draws the slide; this dresses it:
//  - the blow (the toss cue): a burst of wind thrown out of the gale through
//    the body along the shove's line, grit kicked up off the stone, a ring,
//    and a light camera kick if the body is yours (never under reduced
//    motion);
//  - the slide: a dust trail scuffed off the stone at its feet and pale
//    streaks of wind left behind it while it is carried, thinning as the
//    shove settles.
// Cosmetic: every layer thins on the low tier (`density`); the readable
// telegraph is the gale's own footprint (BreathFightFx). No geometry or
// material of its own (the host's particles): no GPU producer.

import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';

/** How long a toss is dressed after its blow (the sim's slide and a beat). */
export const TOSS_TRAIL_SECONDS = 0.85;
const SLOTS = 6;

export interface BreathTossHost {
  readonly particles: EngineParticles;
  readonly density: number;
  shakeNear(x: number, z: number, amount: number, reach?: number): void;
  groundY(x: number, z: number): number;
}

interface Trail {
  id: number;
  until: number;
  x: number;
  z: number;
  emit: number;
}

export class BreathTossFx {
  private readonly trails: Trail[] = [];
  private clock = 0;

  constructor(private readonly h: BreathTossHost) {
    for (let i = 0; i < SLOTS; i++) this.trails.push({ id: -1, until: 0, x: 0, z: 0, emit: 0 });
  }

  /** The blow: `gale` tosses `body` (the toss cue). */
  blow(world: IWorld, gale: Entity | undefined, body: Entity): void {
    const a = fxAnchor(body);
    const y = this.h.groundY(a.x, a.z);
    const dx = gale ? a.x - gale.pos.x : 0;
    const dz = gale ? a.z - gale.pos.z : 1;
    const l = Math.hypot(dx, dz) || 1;
    const ux = dx / l;
    const uz = dz / l;
    const d = this.h.density;
    // The wind thrown out of the gale through the body, along the shove.
    this.h.particles.puff(a.x - ux * 0.8, y + 1.1, a.z - uz * 0.8, Math.round(18 * d), {
      speed: 13,
      up: 1.5,
      life: 0.55,
      size: [1.1, 2.6],
      color: [0.86, 0.9, 0.94],
      alpha: 0.5,
      dir: [ux, 0.12, uz],
      spread: 0.35,
      drag: 2.2,
    });
    // Grit kicked off the stone.
    this.h.particles.puff(a.x, y + 0.25, a.z, Math.round(14 * d), {
      speed: 7,
      up: 3.5,
      life: 0.7,
      size: [0.18, 0.06],
      color: [0.5, 0.46, 0.4],
      alpha: 0.9,
      dir: [ux, 0.4, uz],
      spread: 0.7,
      gravity: 12,
    });
    this.h.particles.shockRing(a.x, a.z, 0xe6f2ff, 3.2, 0.35);
    // A light kick of the camera: the shove is felt, never a jolt.
    if (body.id === world.playerId) this.h.shakeNear(a.x, a.z, 0.35, 4);
    const t =
      this.trails.find((s) => s.id === body.id) ??
      this.trails.find((s) => s.until < this.clock) ??
      this.trails[0];
    t.id = body.id;
    t.until = this.clock + TOSS_TRAIL_SECONDS;
    t.x = a.x;
    t.z = a.z;
    t.emit = 0;
  }

  /** One frame: the dust and the wind behind every body still sliding. */
  update(world: IWorld, dt: number): void {
    this.clock += dt;
    const d = this.h.density;
    for (const t of this.trails) {
      if (t.id < 0 || t.until < this.clock) continue;
      const e = world.entities.get(t.id);
      if (!e || e.dead) {
        t.id = -1;
        continue;
      }
      const a = fxAnchor(e);
      const mx = a.x - t.x;
      const mz = a.z - t.z;
      const moved = Math.hypot(mx, mz);
      t.x = a.x;
      t.z = a.z;
      if (moved < 0.02) continue;
      const left = Math.max(0, (t.until - this.clock) / TOSS_TRAIL_SECONDS);
      // A puff per stretch of ground covered, so the trail follows the slide
      // whatever the frame rate.
      t.emit += moved * 2.4 * d;
      const y = this.h.groundY(a.x, a.z);
      const ux = -mx / moved;
      const uz = -mz / moved;
      while (t.emit >= 1) {
        t.emit -= 1;
        this.h.particles.puff(a.x, y + 0.15, a.z, 1, {
          speed: 1.6,
          up: 1.2,
          life: 0.9,
          size: [0.7, 1.8],
          color: [0.62, 0.58, 0.52],
          alpha: 0.45 * (0.4 + 0.6 * left),
          dir: [ux, 0.3, uz],
          spread: 0.6,
          drag: 1.5,
          radius: 0.35,
        });
        this.h.particles.puff(a.x, y + 0.9, a.z, 1, {
          speed: 3,
          life: 0.35,
          size: [0.9, 0.2],
          color: [0.9, 0.94, 0.98],
          alpha: 0.35 * left,
          dir: [ux, 0, uz],
          spread: 0.15,
          pool: 'glow',
        });
      }
    }
  }

  clear(): void {
    for (const t of this.trails) t.id = -1;
  }
}
