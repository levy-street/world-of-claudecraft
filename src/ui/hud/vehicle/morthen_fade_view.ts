// Pure view core for the lost shift's fade to black. While the Defeated aura
// lies on the player, the veil stays clear, then darkens over the outro's last
// stretch (LOSS_FADE_TICKS of LOSS_OUTRO_TICKS, shift_end_marks.ts), so the
// teardown's teleport happens behind black; once the aura is gone the veil
// lifts over MORTHEN_FADE_IN_MS. Keyed on the aura the client already mirrors,
// so it needs no event of its own.

import { LOSS_FADE_TICKS, LOSS_OUTRO_TICKS } from '../../../sim/graveyard_shift/shift_end_marks';
import { TICK_RATE } from '../../../sim/types';

const OUTRO_MS = (LOSS_OUTRO_TICKS / TICK_RATE) * 1000;
const FADE_OUT_MS = (LOSS_FADE_TICKS / TICK_RATE) * 1000;
export const MORTHEN_FADE_IN_MS = 800;

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

export function createMorthenFade() {
  let defeatedAt: number | null = null;
  let liftedAt: number | null = null;
  return {
    /** The veil's opacity this frame, 0 (clear) to 1 (black). */
    tick(nowMs: number, defeated: boolean): number {
      if (defeated) {
        defeatedAt ??= nowMs;
        liftedAt = null;
        return clamp01((nowMs - defeatedAt - (OUTRO_MS - FADE_OUT_MS)) / FADE_OUT_MS);
      }
      if (defeatedAt !== null) {
        defeatedAt = null;
        liftedAt = nowMs;
      }
      if (liftedAt === null) return 0;
      const opacity = clamp01(1 - (nowMs - liftedAt) / MORTHEN_FADE_IN_MS);
      if (opacity === 0) liftedAt = null;
      return opacity;
    },
  };
}
