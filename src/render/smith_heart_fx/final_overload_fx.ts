// The Masterless Strength's Overload in the world (plan: final_overload_core.ts;
// the team's review of 2026-11-17, the owner's rework of 2026-11-18), a part
// of FinalFx (final_fx.ts, which reads the boss and hands its frame in). As
// the bar of the quarter it drinks fills, every tier sees it on the boss and
// the arena, never only on the HUD:
//   - the boss's own cracks throbbing brighter in the quarter's element (the
//     rig's glow pulses, three steps, quicker as it fills: the light is in its
//     body, never a cage round it; the coordinator's review of 2026-11-18),
//     light bleeding off its body in sparks;
//   - at three quarters the quarter's wall erupts: its landmark throws its
//     element up (the Heat's lava, the Quench's shards and mist, the
//     Breath's sparks, the Hammer's stone and gold), with a thud as it
//     starts (the landmark's own light flaring and the floor's cracks
//     throbbing are the interior's, through heart_quarters_core.ts `strain`);
//   - the burst itself is FinalFx's wave of light out of the body.
// The body's throb draws on every tier; the sparks and the eruption's
// particles thin with the host's density; the thud goes under reduced motion.
//
// Rules (src/render/CLAUDE.md): no material, no light; no per-frame
// allocation.

import { HEART_ROOM, type SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { heartLandmarkSpots } from '../smith_heart/heart_landmarks_core';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { FINAL_BODY_GESTURES } from './final_body_core';
import { eruptLevel, eruptStarts, strainLook, strainPulse } from './final_overload_core';

/** What FinalFx lends. */
export interface FinalOverloadHost {
  particles: EngineParticles;
  groundY: (x: number, z: number) => number;
  rand: () => number;
  density: number;
  shakeNear: (x: number, z: number, amount: number) => void;
  /** A glow pulse on the boss's own rig (FinalBodyFx). */
  pulseBody: (gesture: string) => void;
}

/** One frame of the boss as FinalFx saw it. */
export interface FinalOverloadFrame {
  /** Its feet (world) and its drawn height. */
  x: number;
  y: number;
  z: number;
  height: number;
  /** The quarter it drinks (null: the ring, or no fight) and that bar's fill
   *  (0..1). */
  vein: SmithHeartVein | null;
  fill: number;
  /** Its quarter's colour. */
  color: number;
  /** The slot's origin (world). */
  ox: number;
  oz: number;
  clock: number;
  dt: number;
}

const _look = { swell: 1, crack: 0, heat: 0, throb: 0 };
const _rgb: [number, number, number] = [1, 1, 1];

export class FinalOverloadFx {
  private lastFill = 0;
  private lastVein: SmithHeartVein | null = null;
  private sparkOwed = 0;
  private eruptOwed = 0;
  private pulsedAt = -99;

  constructor(private readonly h: FinalOverloadHost) {}

  update(f: FinalOverloadFrame): void {
    const H = this.h;
    const fill = f.vein ? f.fill : 0;
    // Its own cracks throbbing brighter (the rig's glow pulses).
    const pulse = strainPulse(fill);
    if (pulse.level > 0 && f.clock - this.pulsedAt >= pulse.every) {
      this.pulsedAt = f.clock;
      H.pulseBody(FINAL_BODY_GESTURES.strain[pulse.level - 1]);
    }
    const look = strainLook(fill, f.clock, _look);
    if (look.crack > 0.001) {
      // Light bleeding off the strained body.
      this.sparkOwed += f.dt * 30 * look.crack * look.crack * H.density;
      _rgb[0] = ((f.color >> 16) & 255) / 255;
      _rgb[1] = ((f.color >> 8) & 255) / 255;
      _rgb[2] = (f.color & 255) / 255;
      const r = f.height * 0.16;
      while (this.sparkOwed >= 1) {
        this.sparkOwed -= 1;
        const a = H.rand() * Math.PI * 2;
        H.particles.puff(
          f.x + Math.cos(a) * r,
          f.y + f.height * (0.2 + 0.7 * H.rand()),
          f.z + Math.sin(a) * r,
          1,
          {
            speed: 3 + 5 * look.heat,
            up: 2,
            life: 0.6,
            size: [0.45, 0.08],
            color: _rgb,
            alpha: 1,
            pool: 'glow',
            dir: [Math.cos(a), 0.3, Math.sin(a)],
            spread: 0.4,
          },
        );
      }
    }
    // The quarter's wall erupting from three quarters full.
    if (f.vein && f.vein === this.lastVein && eruptStarts(this.lastFill, fill))
      H.shakeNear(f.x, f.z, 0.35);
    const erupt = f.vein ? eruptLevel(fill) : 0;
    if (f.vein && erupt > 0) this.erupt(f, f.vein, erupt);
    this.lastFill = fill;
    this.lastVein = f.vein;
  }

  /** The wall's eruption: its element thrown up off its signature spots. */
  private erupt(f: FinalOverloadFrame, vein: SmithHeartVein, level: number): void {
    const H = this.h;
    this.eruptOwed += f.dt * 26 * level * H.density;
    if (this.eruptOwed < 1) return;
    const spots = heartLandmarkSpots(vein);
    const cx = f.ox + HEART_ROOM.x;
    const cz = f.oz + HEART_ROOM.z;
    const floor = H.groundY(cx, cz);
    while (this.eruptOwed >= 1) {
      this.eruptOwed -= 1;
      const s = spots[Math.floor(H.rand() * spots.length) % spots.length];
      const x = cx + s.x;
      const y = floor + s.y;
      const z = cz + s.z;
      if (vein === 'heat') {
        H.particles.puff(x, y, z, 3, {
          speed: 4,
          up: 16 + H.rand() * 10,
          life: 1.6,
          size: [1.1, 0.4],
          color: [1, 0.55, 0.15],
          alpha: 1,
          pool: 'pyre',
          gravity: 14,
          radius: 2,
        });
      } else if (vein === 'quench') {
        H.particles.puff(x, y, z, 3, {
          speed: 5,
          up: 12 + H.rand() * 8,
          life: 1.4,
          size: [0.6, 0.2],
          color: [0.75, 0.92, 1],
          alpha: 1,
          pool: 'glow',
          gravity: 12,
          radius: 2,
        });
        H.particles.puff(x, y, z, 1, {
          speed: 2,
          up: 3,
          life: 2,
          size: [3, 7],
          color: [0.7, 0.85, 1],
          alpha: 0.25,
          radius: 3,
        });
      } else if (vein === 'breath') {
        H.particles.puff(x, y, z, 4, {
          speed: 12,
          up: 6,
          life: 0.45,
          size: [0.7, 0.08],
          color: [0.85, 0.8, 1],
          alpha: 1,
          pool: 'glow',
          radius: 1.5,
        });
      } else {
        H.particles.puff(x, y, z, 2, {
          speed: 5,
          up: 10 + H.rand() * 6,
          life: 1.5,
          size: [0.8, 0.5],
          color: [0.55, 0.45, 0.32],
          alpha: 1,
          gravity: 22,
          radius: 2,
        });
        H.particles.puff(x, y, z, 2, {
          speed: 6,
          up: 8,
          life: 0.8,
          size: [0.5, 0.1],
          color: [1, 0.82, 0.4],
          alpha: 1,
          pool: 'glow',
          radius: 2,
        });
      }
    }
  }

  hide(): void {
    this.lastFill = 0;
    this.lastVein = null;
  }
}
