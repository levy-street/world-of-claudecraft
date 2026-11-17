// What the Quartered Isle's own auras DO, for their buff/debuff hover tooltip. A pure descriptor like
// the rest of aura_effect.ts (which calls this before the Hollow Crypt's: the Gale Lane shares its
// aura id with the crypt's and the frozen lakes' slick ice, so the crypt's ice line would claim it):
// it returns a hudChrome.auraEffect.quartered.* key plus the raw numbers, and the HUD formats the
// numbers and renders t(key, values). The numbers are the gale's own constants and the aura's live
// value (src/sim/quartered_gyre_wind.ts), the same ones the wind step reads.
// Pinned by tests/quartered_gyre_wind.test.ts.

import { GALE_LANE_AURA_ID, GALE_LANE_LINGER, GALE_TAPER_END } from '../sim/quartered_gyre_wind';
import { RUN_SPEED } from '../sim/types';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

const KEY = 'hudChrome.auraEffect.quartered';

/** The Quartered Isle aura's descriptor, or null when `a` is not one of them. */
export function quarteredAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  // The Gale Lane is the kernel's slick worn as a speed buff; the ice that shares its id is a
  // quiet 'slow', so the kind tells them apart. Its value is the ride's multiple of the run.
  if (a.id === GALE_LANE_AURA_ID && a.kind === 'buff_speed') {
    const speed = RUN_SPEED * a.value;
    return {
      key: `${KEY}.galeLane`,
      nums: { speed, summit: speed * GALE_TAPER_END, linger: GALE_LANE_LINGER },
    };
  }
  return null;
}
