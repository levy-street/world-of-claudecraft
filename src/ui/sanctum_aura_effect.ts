// What the Gravewyrm Sanctum's boss auras DO, for their buff/debuff hover
// tooltip. A pure descriptor like the rest of aura_effect.ts (which calls this
// before the generic kind line): it returns a hudChrome.auraEffect.sanctum.*
// key plus the raw numbers, and the HUD formats the numbers and renders
// t(key, values). Several of these auras are marks or states whose generic
// kind line would not say the rule (the Eye, the airborne wyrm, Doused), so
// each says it instead. Numbers come from the encounter tuning
// (src/sim/encounters/gravewyrm_sanctum/boss_ids.ts) and the heroic mechanic
// factors (content/dungeon_difficulty.ts), the same constants combat reads;
// the amounts that ride the aura itself (Lockbound's share, an enrage) read
// the aura's own value. The trash debuffs (Branded, Creeping Rime, Iced Over)
// read their timings off the trash kit records (content/gravewyrm_sanctum.ts)
// and their live amount off the aura. Pinned by
// tests/gravewyrm_sanctum_alert.test.ts and tests/sanctum_trash_ui.test.ts.

import { HEROIC_DUNGEON_TUNING } from '../sim/content/dungeon_difficulty';
import { GRAVEWYRM_SANCTUM_MOBS } from '../sim/content/gravewyrm_sanctum';
import {
  KORGATH_ENRAGE,
  KORGATH_LOCKBOUND,
  KORGATH_TUNING,
  KORZUL_AIRBORNE,
  KORZUL_DOUSED,
  KORZUL_ENRAGE,
  KORZUL_ID,
  KORZUL_SHARD_FLARE,
  KORZUL_TUNING,
  KORZUL_WYRMS_EYE,
  SANCTUM_QUENCH_WATER,
  VELKHAR_GRASP,
  VELKHAR_TUNING,
  VELKHAR_TWICE_WOKEN,
} from '../sim/encounters/gravewyrm_sanctum/ids';
import {
  SANCTUM_BRANDED,
  SANCTUM_CREEPING_RIME,
  SANCTUM_ICED_OVER,
} from '../sim/mob/trash_kit/sanctum_cast_ids';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

const KEY = 'hudChrome.auraEffect.sanctum';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);

/** The Goadsmith's Branding Iron and the Rime Whelp's freeze stack: the trash
 *  records the debuff tooltips read their rules from. */
const BRAND = GRAVEWYRM_SANCTUM_MOBS.broodsworn_goadsmith?.trashKit?.brand;
const RIME = GRAVEWYRM_SANCTUM_MOBS.rime_whelp?.trashKit?.cone?.freezeStack;

/** A boss mechanic's heroic amount (its normal numbers are stated landed;
 *  heroic multiplies them by the mob's heroic mechanic factor). */
export function sanctumHeroicAmount(mobId: string, amount: number): number {
  const mult = HEROIC_DUNGEON_TUNING.gravewyrm_sanctum?.mechanicDamageMultiplierByMob?.[mobId] ?? 1;
  return Math.round(amount * mult);
}

/** The Sanctum aura's descriptor, or null when `a` is not one of them. */
export function sanctumAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  switch (a.id) {
    case KORGATH_LOCKBOUND:
      return {
        key: `${KEY}.lockbound`,
        nums: { pct: pct(a.value), per: pct(KORGATH_TUNING.lockboundPerChain) },
      };
    case KORGATH_ENRAGE:
    case KORZUL_ENRAGE:
      return { key: `${KEY}.enrage`, nums: { pct: pct(a.value) } };
    case VELKHAR_GRASP:
      return {
        key: `${KEY}.grasp`,
        nums: { pct: pct(VELKHAR_TUNING.graspDamage), seconds: VELKHAR_TUNING.riseDelay },
      };
    case VELKHAR_TWICE_WOKEN:
      return { key: `${KEY}.twiceWoken`, nums: { pct: pct(VELKHAR_TUNING.twiceWokenDamage) } };
    case KORZUL_DOUSED:
      return { key: `${KEY}.doused`, nums: {} };
    case KORZUL_AIRBORNE:
      return {
        key: `${KEY}.airborne`,
        nums: {
          min: KORZUL_TUNING.descentMin,
          max: KORZUL_TUNING.descentMax,
          heroicMin: sanctumHeroicAmount(KORZUL_ID, KORZUL_TUNING.descentMin),
          heroicMax: sanctumHeroicAmount(KORZUL_ID, KORZUL_TUNING.descentMax),
          radius: KORZUL_TUNING.descentRadius,
        },
      };
    case KORZUL_WYRMS_EYE:
      return {
        key: `${KEY}.wyrmsEye`,
        nums: {
          min: KORZUL_TUNING.plungeMin,
          max: KORZUL_TUNING.plungeMax,
          heroicMin: sanctumHeroicAmount(KORZUL_ID, KORZUL_TUNING.plungeMin),
          heroicMax: sanctumHeroicAmount(KORZUL_ID, KORZUL_TUNING.plungeMax),
        },
      };
    case SANCTUM_QUENCH_WATER:
      return {
        key: `${KEY}.quenchWater`,
        nums: {
          slow: pct(KORZUL_TUNING.quenchSlow),
          damage: KORZUL_TUNING.quenchPerSecond,
          heroic: KORZUL_TUNING.quenchPerSecondHeroic,
        },
      };
    case KORZUL_SHARD_FLARE:
      return {
        key: `${KEY}.shardFlare`,
        nums: { breath: KORZUL_TUNING.breathEveryLast, gale: KORZUL_TUNING.galeEveryLast },
      };
    case SANCTUM_BRANDED:
      return {
        key: `${KEY}.branded`,
        nums: {
          value: Math.round(a.value),
          interval: a.tickInterval ?? BRAND?.interval ?? 2,
          seconds: BRAND?.seconds ?? 12,
        },
        school: a.school ?? 'fire',
      };
    case SANCTUM_CREEPING_RIME:
      return {
        key: `${KEY}.creepingRime`,
        nums: {
          pct: Math.round((1 - a.value) * 100),
          per: pct(RIME?.perStack ?? 0.08),
          seconds: RIME?.seconds ?? 8,
          max: RIME?.maxStacks ?? 5,
          freeze: RIME?.freezeSeconds ?? 2,
        },
      };
    case SANCTUM_ICED_OVER:
      return { key: `${KEY}.icedOver`, nums: {} };
    default:
      return null;
  }
}
