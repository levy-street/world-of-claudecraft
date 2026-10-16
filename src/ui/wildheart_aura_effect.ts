// What the Wildheart Basin's encounter auras DO, for their buff/debuff hover
// tooltip. A pure descriptor like the rest of aura_effect.ts (which calls this
// first): it returns a hudChrome.auraEffect.wildheart.* key plus the raw
// numbers, and the HUD formats the numbers and renders t(key, values). Several
// of these auras are marks that carry no stat (a `vulnerability` of 0), so the
// generic kind line would lie ("increases damage taken by 0%"); each says the
// rule instead. Numbers come from the encounter tuning
// (src/sim/encounters/wildheart_basin/ids.ts) and the heroic mechanic factors
// (content/dungeon_difficulty.ts), the same constants combat reads.
// Pinned by tests/wildheart_basin_alert.test.ts.

import { HEROIC_DUNGEON_TUNING } from '../sim/content/dungeon_difficulty';
import {
  BEAST_PACK_BOND,
  BEAST_PACK_BOND_FURY,
  BEAST_STALKED,
  BEAST_TUNING,
  BEAST_WARY_ROOT,
  BEAST_WARY_SLOW,
  BEAST_WARY_STUN,
  BLOOM_POLLINATED,
  BLOOM_TUNING,
  FANGLORD_JAGUAR_ID,
  ZULGAR_AVATAR,
  ZULGAR_ID,
  ZULGAR_PREY,
  ZULGAR_TUNING,
  ZULGAR_VANISHED,
} from '../sim/encounters/wildheart_basin/ids';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

const KEY = 'hudChrome.auraEffect.wildheart';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);

/** A boss mechanic's heroic amount (its normal numbers are stated landed;
 *  heroic multiplies them by the mob's heroic mechanic factor). */
export function wildheartHeroicAmount(mobId: string, amount: number): number {
  const mult = HEROIC_DUNGEON_TUNING.wildheart_basin?.mechanicDamageMultiplierByMob?.[mobId] ?? 1;
  return Math.round(amount * mult);
}

/** The Basin aura's descriptor, or null when `a` is not one of them. */
export function wildheartAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  switch (a.id) {
    case BEAST_PACK_BOND:
      return { key: `${KEY}.packBond`, nums: { pct: pct(BEAST_TUNING.bondDr) } };
    case BEAST_PACK_BOND_FURY:
      return { key: `${KEY}.packBondFury`, nums: { pct: pct(BEAST_TUNING.bondDamage) } };
    case BEAST_STALKED:
      return {
        key: `${KEY}.stalked`,
        nums: {
          min: BEAST_TUNING.biteMin,
          max: BEAST_TUNING.biteMax,
          heroicMin: wildheartHeroicAmount(FANGLORD_JAGUAR_ID, BEAST_TUNING.biteMin),
          heroicMax: wildheartHeroicAmount(FANGLORD_JAGUAR_ID, BEAST_TUNING.biteMax),
        },
      };
    case BEAST_WARY_STUN:
      return { key: `${KEY}.waryStuns`, nums: {} };
    case BEAST_WARY_ROOT:
      return { key: `${KEY}.waryRoots`, nums: {} };
    case BEAST_WARY_SLOW:
      return { key: `${KEY}.warySlows`, nums: {} };
    case BLOOM_POLLINATED:
      return {
        key: `${KEY}.pollinated`,
        nums: { seconds: BLOOM_TUNING.podSprout, heroic: BLOOM_TUNING.heroicBurrow },
      };
    case ZULGAR_PREY:
      return {
        key: `${KEY}.prey`,
        nums: {
          slow: pct(ZULGAR_TUNING.sunstruckSlow),
          damage: ZULGAR_TUNING.maulDamage,
          heroic: wildheartHeroicAmount(ZULGAR_ID, ZULGAR_TUNING.maulDamage),
          stun: ZULGAR_TUNING.maulStun,
        },
      };
    case ZULGAR_AVATAR:
      return { key: `${KEY}.avatar`, nums: { pct: pct(ZULGAR_TUNING.huntSpeedMult - 1) } };
    case ZULGAR_VANISHED:
      return { key: `${KEY}.vanished`, nums: {} };
    default:
      return null;
  }
}
