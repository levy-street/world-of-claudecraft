// A stilled Stillstone's choke on the nova (the Islands of the Wind,
// encounters/smith_heart/breath_isles.ts), a part of BreathCocoonFx (its look:
// breath_isle_phase_core.ts CHOKE, chokeLook): Jose's playtest of 2026-11-18
// ("when the last isle's crystal lights up it should channel lightning"). From
// the moment a stone is stilled (its seal broken, read off the cocoon's own
// seal state) until the cocoon ends, a thick beam of gold calm pours from the
// crystal into the nova, pulses racing into it; white lightning crawls along
// it, re-forming many times a second, and forks over the nova's skin where
// it bites, a gold glow at both ends and sparks thrown off the bite. Both
// stones stilled, the two beams strangle it until the shatter.
//
// On EVERY tier (the raid reads how many stones hold off it); the sparks thin
// on the low tier. Built in the host's constructor (its one gated attach):
// two pooled beams and its own bolt pool, no per-frame allocation. In the
// open air (nothing on the floor).

import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { BreathEntranceBolts } from './breath_entrance_bolts';
import { IsleBeam, type IsleBeamHost } from './breath_isle_beam';
import {
  CHOKE,
  type ChokeLook,
  chokeLook,
  PHASE_COLORS as PC,
  phaseRgb,
} from './breath_isle_phase_core';

export interface SealChokeHost extends IsleBeamHost {
  readonly particles: EngineParticles;
  readonly density: number;
}

type P3 = { x: number; y: number; z: number };

const GOLD = phaseRgb(PC.stilled);
const _look: ChokeLook = { half: 0, glow: 0, bolt: 0, boltWidth: 0, bite: 0 };
const _a: P3 = { x: 0, y: 0, z: 0 };
const _b: P3 = { x: 0, y: 0, z: 0 };
const _bite: P3 = { x: 0, y: 0, z: 0 };
/** The beam's few points the lightning follows (stone to bite). */
const LEGS = 3;

export class SealChokeFx {
  private readonly beams: [IsleBeam, IsleBeam];
  private readonly bolts: BreathEntranceBolts;
  /** When each side's choke began (NaN: none). */
  private readonly since: [number, number] = [Number.NaN, Number.NaN];
  private clock = 0;
  private seed = 0x51c4;

  constructor(private readonly h: SealChokeHost) {
    this.beams = [
      new IsleBeam(h, 'smithHeartBreathSealChokeEast', PC.stilled, 0xffffff),
      new IsleBeam(h, 'smithHeartBreathSealChokeWest', PC.stilled, 0xffffff),
    ];
    this.bolts = new BreathEntranceBolts(h.root, h);
  }

  /**
   * One frame. `on[k]`: side k's stone is stilled while the cocoon stands;
   * `stone(k)` its crystal (world); the nova at `nova` (world) of radius
   * `novaR`; `t` the shader clock.
   */
  update(
    on: readonly [boolean, boolean],
    stone: (k: 0 | 1, out: P3) => P3,
    nova: P3,
    novaR: number,
    t: number,
    dt: number,
  ): void {
    this.clock += dt;
    this.bolts.begin();
    const step = Math.floor(t * CHOKE.flicker);
    for (const k of [0, 1] as const) {
      const beam = this.beams[k];
      if (!on[k]) {
        this.since[k] = Number.NaN;
        beam.hide();
        continue;
      }
      if (Number.isNaN(this.since[k])) this.since[k] = this.clock;
      const L = chokeLook(this.clock - this.since[k], t, _look);
      stone(k, _a);
      // It bites the nova's skin on the stone's side.
      const dx = _a.x - nova.x;
      const dy = _a.y - nova.y;
      const dz = _a.z - nova.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      _bite.x = nova.x + (dx / d) * novaR * 0.92;
      _bite.y = nova.y + (dy / d) * novaR * 0.92;
      _bite.z = nova.z + (dz / d) * novaR * 0.92;
      const lift = Math.min(9, d * 0.05);
      beam.lay(_a, _bite, Math.max(0.05, L.half), lift, 0.25, t);
      beam.paint(L.glow, 0);
      // The lightning along it: two crawling strands, each in legs on the
      // beam's own arc, re-formed many times a second.
      for (let s = 0; s < 2; s++)
        for (let j = 0; j < LEGS; j++) {
          IsleBeam.point(_a, _bite, j / LEGS, lift, 0.25, t, _b);
          const x0 = _b.x;
          const y0 = _b.y;
          const z0 = _b.z;
          IsleBeam.point(_a, _bite, (j + 1) / LEGS, lift, 0.25, t, _b);
          this.bolts.draw(
            step * 29 + j * 7 + s * 101 + k * 313,
            x0,
            y0,
            z0,
            _b.x,
            _b.y,
            _b.z,
            0.09 + 0.05 * s,
            L.boltWidth * (s === 0 ? 1 : 0.6),
            L.bolt * (s === 0 ? 1 : 0.7),
          );
        }
      // Forks over the nova's skin where it bites.
      for (let f = 0; f < CHOKE.forks; f++) {
        const a = ((step * 7 + f * 11 + k * 5) % 23) * 0.273 + f * 2.1;
        const reach = novaR * (0.55 + 0.25 * ((f + step) % 3));
        this.bolts.draw(
          step * 31 + f * 13 + k * 271 + 5,
          _bite.x,
          _bite.y,
          _bite.z,
          _bite.x + Math.sin(a) * reach,
          _bite.y + Math.cos(a * 1.7) * reach * 0.6,
          _bite.z + Math.cos(a) * reach,
          0.22,
          L.boltWidth * 0.7,
          L.bolt * 0.8,
        );
      }
      // The glow where it bites and where it leaves the crystal.
      const bite = novaR * L.bite;
      this.bolts.glow(_bite.x, _bite.y, _bite.z, bite, GOLD[0], GOLD[1], GOLD[2]);
      this.bolts.glow(_a.x, _a.y, _a.z, 3.5 + 1.5 * L.glow, GOLD[0], GOLD[1], GOLD[2]);
      // Sparks of calm thrown off the bite (cosmetic).
      if (this.rand() < dt * 18 * this.h.density) {
        const ang = this.rand() * Math.PI * 2;
        this.h.particles.puff(_bite.x, _bite.y, _bite.z, 2, {
          speed: 6 + this.rand() * 6,
          life: 0.6,
          size: [0.7, 0.12],
          color: this.rand() < 0.5 ? GOLD : [1, 1, 1],
          alpha: 1,
          pool: 'glow',
          dir: [Math.sin(ang) + dx / d, this.rand() - 0.3, Math.cos(ang) + dz / d],
          spread: 0.4,
          drag: 1,
          floor: -1e6,
        });
      }
    }
    this.bolts.end();
  }

  /** Is side `k` choking the nova (the tests read it)? */
  choking(k: 0 | 1): boolean {
    return !Number.isNaN(this.since[k]);
  }

  hide(): void {
    this.since[0] = Number.NaN;
    this.since[1] = Number.NaN;
    this.beams[0].hide();
    this.beams[1].hide();
    this.bolts.begin();
    this.bolts.end();
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }
}
