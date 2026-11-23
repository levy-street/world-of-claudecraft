// The Snarlvine Lasher's Entangling Lash on its Blender body (plan:
// lasher_fx_core.ts, the model's facts: lasher_model_core.ts), composed by
// WildheartFx (basin_fx.ts): when the bar lands, the whip's tip slams the lane
// where the model's own tip falls (loam, leaves, glowing sap, a scorched ring),
// then thorns tear up out of the loam down the rest of the 20 yd lane, the
// front racing out from the whip's end. It replaces the generic heavy bolt.
//
// Cosmetic only (the lane's telegraph is basin_fx.ts's, on the encounter band);
// everything draws through the host's pools, splashes and thorns. No mesh, no
// light, no per-frame allocation.

import { VINE_LASHER_ID } from '../../sim/encounters/wildheart_basin/ids';
import { WILDHEART_ENTANGLING_LASH } from '../../sim/mob/trash_kit/wildheart_cast_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { BasinFxHost } from './basin_fx_host';
import {
  LASHER_SPLASH,
  lasherLane,
  lasherModelScale,
  lasherTipReach,
  lasherWaveDelay,
  lasherWaveStations,
} from './lasher_fx_core';
import { LASHER_CLIP } from './lasher_model_core';

const WAVE_SLOTS = 24;

interface WaveBeat {
  at: number;
  x: number;
  z: number;
  facing: number;
  reach: number;
  live: boolean;
}

export class LasherFx {
  private readonly beats: WaveBeat[] = [];
  private readonly stations: number[] = [];
  private clock = 0;

  constructor(private readonly host: BasinFxHost) {
    for (let i = 0; i < WAVE_SLOTS; i++)
      this.beats.push({ at: 0, x: 0, z: 0, facing: 0, reach: 0, live: false });
  }

  /** The Lasher's lash landing; true when drawn here. */
  handleEvent(ev: SimEvent & { type: 'spellfx' }, src: Entity): boolean {
    if (ev.ability !== WILDHEART_ENTANGLING_LASH || src.templateId !== VINE_LASHER_ID) return false;
    // The sim holds the lasher on the lane's locked line through the bar.
    const scale = src.scale || 1;
    this.slam(src.pos.x, src.pos.z, src.facing, scale);
    for (const d of lasherWaveStations(scale, this.stations)) {
      const slot = this.beats.find((b) => !b.live);
      if (!slot) break;
      slot.live = true;
      slot.at = this.clock + lasherWaveDelay(d, scale);
      slot.x = src.pos.x;
      slot.z = src.pos.z;
      slot.facing = src.facing;
      slot.reach = d;
    }
    if (!this.host.reducedMotion()) this.host.shake(0.12);
    return true;
  }

  update(clock: number): void {
    this.clock = clock;
    for (const b of this.beats) {
      if (!b.live || clock < b.at) continue;
      b.live = false;
      this.wave(b);
    }
  }

  /** A lash's wave is still running down its lane. */
  busy(): boolean {
    for (const b of this.beats) if (b.live) return true;
    return false;
  }

  hideAll(): void {
    for (const b of this.beats) b.live = false;
  }

  private slam(x0: number, z0: number, facing: number, scale: number): void {
    const host = this.host;
    const k = lasherModelScale(scale);
    const ax = Math.sin(facing);
    const az = Math.cos(facing);
    // The tip on the centre line (its model x is its left, +x).
    const along = lasherTipReach(scale);
    const side = LASHER_CLIP.lashTipImpact.x * k;
    const x = x0 + ax * along + az * side;
    const z = z0 + az * along - ax * side;
    const y = host.groundY(x, z);
    const s = LASHER_SPLASH.tip;
    host.splash.crown(x, y - 0.05, z, s.crown, s.tint);
    host.splash.ripple(x, y + 0.04, z, s.ripple, s.tint);
    host.shockRing(x, z, 0xb8ff8a, 3.4, 0.5);
    host.puff(x, y + 0.3, z, 20, {
      speed: 6,
      up: 5,
      life: 1,
      size: [0.4, 0.16],
      color: [0.36, 0.27, 0.16],
      alpha: 1,
      gravity: 14,
      drag: 0.4,
      radius: 0.6,
    });
    host.puff(x, y + 0.4, z, 14, {
      speed: 4.5,
      up: 3,
      life: 0.9,
      size: [0.28, 0.1],
      color: [0.6, 0.95, 0.3],
      alpha: 1,
      glow: true,
      gravity: 11,
    });
    host.puff(x, y + 0.6, z, 10, {
      speed: 2.5,
      up: 1,
      life: 2.2,
      size: [0.4, 0.32],
      color: [0.3, 0.48, 0.14],
      alpha: 1,
      gravity: 2.6,
      drag: 1.4,
      radius: 0.8,
    });
    host.puff(x, y + 0.4, z, 8, {
      speed: 3,
      up: 0.8,
      life: 1.6,
      size: [1.2, 3.4],
      color: [0.58, 0.5, 0.36],
      alpha: 0.42,
      drag: 2,
      radius: 0.8,
    });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + facing + 0.4;
      host.thorns.spawn(x + Math.sin(a) * 1, z + Math.cos(a) * 1, a, 0.5, 1.1 + host.rand() * 0.4);
    }
  }

  /** One station of the thorn wave: a spike on each lane edge, one in the
   *  middle, the loam torn round them. */
  private wave(b: WaveBeat): void {
    const host = this.host;
    const half = lasherLane().halfWidth;
    const ax = Math.sin(b.facing);
    const az = Math.cos(b.facing);
    for (let j = 0; j < 3; j++) {
      const lateral =
        j === 0 ? (host.rand() - 0.5) * 0.6 : (j === 1 ? -1 : 1) * half * (0.7 + 0.2 * host.rand());
      const along = b.reach + (host.rand() - 0.5) * 1;
      const x = b.x + ax * along + az * lateral;
      const z = b.z + az * along - ax * lateral;
      const yaw =
        j === 0 ? host.rand() * Math.PI * 2 : b.facing + (j === 1 ? 1 : -1) * Math.PI * 0.5;
      host.thorns.spawn(
        x,
        z,
        yaw,
        j === 0 ? 0.15 : 0.45,
        j === 0 ? 1.5 + host.rand() * 0.4 : 1 + host.rand() * 0.4,
      );
    }
    const x = b.x + ax * b.reach;
    const z = b.z + az * b.reach;
    const y = host.groundY(x, z);
    host.splash.crown(x, y - 0.05, z, LASHER_SPLASH.wave, LASHER_SPLASH.tip.tint);
    host.puff(x, y + 0.3, z, 5, {
      speed: 3.5,
      up: 4,
      life: 0.8,
      size: [0.36, 0.14],
      color: [0.36, 0.27, 0.16],
      alpha: 1,
      gravity: 13,
      radius: half * 0.7,
    });
  }
}
