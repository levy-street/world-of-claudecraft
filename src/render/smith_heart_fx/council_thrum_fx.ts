// Stone Thrum's painter (encounters/smith_heart/council_risen_pulse.ts): on
// each `heart_council_stone_thrum` cue a soft jade ripple rolls off the risen
// pillar that rang, and a little dust shakes off its foot. Cosmetic only: the
// ring and the puff are the council's pooled engine particles (built at the
// council's boot, never here), the look is the pure core's
// (council_thrum_core.ts), its constants shared (one small options object
// kept here, its fields written per cue). The ring is never thinned by a
// tier: the raid reacts to it.

import type { SanctumPuffOptions } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import type { CouncilFxHost } from './council_pillars_fx';
import {
  STONE_THRUM_COLOR,
  STONE_THRUM_DUST,
  STONE_THRUM_LOOK,
  STONE_THRUM_PUFFS,
  STONE_THRUM_SECONDS,
  stoneThrumRadius,
} from './council_thrum_core';

const PUFF: SanctumPuffOptions = {
  speed: 1.6,
  life: 0.7,
  size: [0.8, 1.8],
  color: STONE_THRUM_DUST,
  alpha: 0.3,
  radius: 1,
};

/** One risen pillar rang: paint its ripple. */
export function paintStoneThrum(
  h: CouncilFxHost,
  at: { x: number; y: number; z: number; radius: number },
): void {
  h.particles.shockRing(
    at.x,
    at.z,
    STONE_THRUM_COLOR,
    stoneThrumRadius(at.radius),
    STONE_THRUM_SECONDS,
    STONE_THRUM_LOOK,
  );
  PUFF.radius = at.radius;
  h.particles.puff(at.x, at.y + 0.3, at.z, STONE_THRUM_PUFFS, PUFF);
}
