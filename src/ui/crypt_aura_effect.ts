// What the Hollow Crypt's trash marks and boss auras DO, for their
// buff/debuff hover tooltip. A pure descriptor like the rest of aura_effect.ts (which calls this
// before the generic kind line): it returns a hudChrome.auraEffect.crypt.* key
// plus the raw numbers, and the HUD formats the numbers and renders t(key,
// values). Several of these auras are quiet markers (a 'slow' of 1, a
// 'buff_dr' of 0, a 'buff_haste' of 1), so the generic kind line would lie
// ("reduces movement speed by 0%"); each says its rule instead. Every number is
// the encounter tuning (src/sim/encounters/hollow_crypt/*_ids.ts) or the
// slippery-ground kernel (src/sim/slippery_ground.ts), the same constants
// combat reads, and the heroic amounts multiply them by the boss's heroic
// mechanic factor (content/dungeon_difficulty.ts). Live per-aura state (the
// Gravedigger's Blow stacks, Lingering Lament's bonus, Harmony's share, the
// ice's grip, Morthen's Gorged stacks, the candles lit under his ward, Grave
// Chill's bite) reads off the aura itself. A heroic-only mark (Grasp of the
// Grave, the Knellwyrm's Burning Knell) states its heroic amounts outright.
// Pinned by tests/hollow_crypt_alert.test.ts.
// The trash marks: the Carrion Eye rides a zero vulnerability (a mark), so the
// generic line would claim 0% more damage taken; Granite Skin says its rule (it
// thickens on a clock and a stun shatters it). Their numbers are the
// template's own (src/sim/content/hollow_crypt_trash.ts). Pinned by
// tests/hollow_crypt_trash_mechanics.test.ts.

import { HEROIC_DUNGEON_TUNING } from '../sim/content/dungeon_difficulty';
import { MOBS } from '../sim/data';
import {
  KNELL_TUNING,
  KNELLWYRM_AIRBORNE,
  KNELLWYRM_ID,
  MORTHEN_ID,
} from '../sim/encounters/hollow_crypt/ids';
import {
  ILVANE_CRESCENDO,
  ILVANE_HARMONY,
  ILVANE_TUNING,
} from '../sim/encounters/hollow_crypt/ilvane_ids';
import {
  LADY_EMBRACED,
  LADY_ID,
  LADY_LAMENT_DREAD,
  LADY_LINGERING_LAMENT,
  LADY_TUNING,
} from '../sim/encounters/hollow_crypt/lady_ids';
import {
  MARROW_BLOW_STACKS,
  MARROW_DIRT_IN_EYES,
  MARROW_GRAVE_DIRT,
  MARROW_GRAVE_VIGOR,
  MARROW_ID,
  MARROW_MEASURED,
  MARROW_TOLLING,
  MARROW_TUNING,
} from '../sim/encounters/hollow_crypt/marrow_ids';
import {
  MORTHEN_GORGED,
  MORTHEN_GRASP_MARK,
  MORTHEN_GRASP_ROOT,
  MORTHEN_GRAVE_CHILL,
  MORTHEN_RITE_BROKEN,
  MORTHEN_SHATTERED,
  MORTHEN_TUNING,
  MORTHEN_UNQUIET_WARD,
  RITE_CANDLE_SPOTS,
} from '../sim/encounters/hollow_crypt/morthen_ids';
import { CRYPT_CARRION_EYE, CRYPT_GRANITE_SKIN } from '../sim/mob/trash_kit/cast_ids';
import { SLIPPERY_DEFAULT_GRIP, SLIPPERY_GROUND_AURA } from '../sim/slippery_ground';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

const KEY = 'hudChrome.auraEffect.crypt';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);

/** A crypt boss's heroic mechanic factor: the same mechanicDamageMult the sim
 *  stamps on its heroic spawn (instances/difficulty.ts: the per-mob mechanic
 *  override, else its per-mob damage factor, else the dungeon's own; the
 *  Knellwyrm rides its per-mob boss entry). */
export function cryptHeroicFactor(mobId: string): number {
  const tuning = HEROIC_DUNGEON_TUNING.hollow_crypt;
  if (!tuning) return 1;
  return (
    tuning.mechanicDamageMultiplierByMob?.[mobId] ??
    tuning.damageMultiplierByMob?.[mobId] ??
    tuning.damageMultiplier
  );
}

/** A boss mechanic's heroic amount (its normal numbers are stated as
 *  authored; heroic multiplies them by the boss's heroic mechanic factor). */
export function cryptHeroicAmount(mobId: string, amount: number): number {
  return Math.round(amount * cryptHeroicFactor(mobId));
}

/** A normal and heroic damage range under one boss's factor. */
function range(mobId: string, min: number, max: number): Record<string, number> {
  return {
    min,
    max,
    heroicMin: cryptHeroicAmount(mobId, min),
    heroicMax: cryptHeroicAmount(mobId, max),
  };
}

/** The Crypt aura's descriptor, or null when `a` is not one of them. */
export function cryptAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  const M = MARROW_TUNING;
  const L = LADY_TUNING;
  const I = ILVANE_TUNING;
  const MT = MORTHEN_TUNING;
  switch (a.id) {
    case MARROW_MEASURED:
      return {
        key: `${KEY}.measured`,
        nums: { radius: M.graveRadius, ...range(MARROW_ID, M.graveOpenMin, M.graveOpenMax) },
      };
    case MARROW_GRAVE_DIRT:
      return {
        key: `${KEY}.graveDirt`,
        nums: {
          slow: pct(1 - M.graveSlow),
          damage: M.graveDirtPerSecond,
          heroic: cryptHeroicAmount(MARROW_ID, M.graveDirtPerSecond),
          linger: M.unquietLinger,
        },
      };
    case MARROW_DIRT_IN_EYES:
      return { key: `${KEY}.dirtInEyes`, nums: { pct: pct(1 - M.shovelSlow) } };
    case MARROW_BLOW_STACKS:
      return {
        key: `${KEY}.blow`,
        nums: {
          pct: pct(a.value),
          per: pct(M.blowVulnPerStack),
          stacks: a.stacks ?? 1,
          max: M.blowMaxStacks,
          seconds: M.blowSeconds,
        },
      };
    case MARROW_GRAVE_VIGOR:
      return { key: `${KEY}.graveVigor`, nums: { pct: pct(M.graveVigorHaste - 1) } };
    case MARROW_TOLLING:
      return { key: `${KEY}.tolling`, nums: range(MARROW_ID, M.tollMin, M.tollMax) };
    case LADY_EMBRACED:
      return {
        key: `${KEY}.embraced`,
        nums: {
          tick: L.embracePerSecond,
          tickHeroic: cryptHeroicAmount(LADY_ID, L.embracePerSecond),
          share: pct(L.embraceBreakShare),
          hold: L.embraceHold,
          ...range(LADY_ID, L.dropMin, L.dropMax),
        },
      };
    case LADY_LAMENT_DREAD:
      return {
        key: `${KEY}.lament`,
        nums: {
          radius: L.lanternRadius,
          cap: L.lanternCap,
          ...range(LADY_ID, L.lamentMin, L.lamentMax),
        },
      };
    case LADY_LINGERING_LAMENT:
      return {
        key: `${KEY}.lingering`,
        nums: {
          // value2 carries the whole bonus the next Lament takes.
          pct: pct(a.value2 ?? L.lingerPerStack * (a.stacks ?? 1)),
          per: pct(L.lingerPerStack),
          max: L.lingerMaxStacks,
        },
      };
    case SLIPPERY_GROUND_AURA:
      return {
        key: `${KEY}.slippery`,
        nums: { grip: a.value2 !== undefined && a.value2 > 0 ? a.value2 : SLIPPERY_DEFAULT_GRIP },
      };
    case ILVANE_HARMONY:
      return { key: `${KEY}.harmony`, nums: { pct: pct(a.value), per: pct(I.harmonyPer) } };
    case ILVANE_CRESCENDO:
      return {
        key: `${KEY}.crescendo`,
        nums: {
          cast: I.dirgeCastCrescendo,
          castNormal: I.dirgeCast,
          every: I.dirgeEveryCrescendo,
          everyNormal: I.dirgeEvery,
          waves: I.organWaveAtCrescendo.length,
          wavesNormal: I.organWaveAt.length,
        },
      };
    case MORTHEN_GORGED:
      return {
        key: `${KEY}.gorged`,
        nums: {
          pct: pct(a.value),
          per: pct(MT.gorgedPct),
          stacks: a.stacks ?? 1,
          max: MT.gorgedMaxStacks,
          heal: pct(MT.gorgedHeal),
        },
      };
    case MORTHEN_UNQUIET_WARD:
      return {
        key: `${KEY}.unquietWard`,
        nums: {
          // value2 carries the candles relit so far.
          lit: a.value2 ?? 0,
          total: RITE_CANDLE_SPOTS.length,
          channel: MT.relightChannel,
          drain: pct(MT.relightDrainPct),
          drainHeroic: pct(MT.relightDrainPctHeroic),
          wrongMin: cryptHeroicAmount(MORTHEN_ID, MT.wrongCandleMin),
          wrongMax: cryptHeroicAmount(MORTHEN_ID, MT.wrongCandleMax),
        },
      };
    case MORTHEN_RITE_BROKEN:
      return { key: `${KEY}.riteBroken`, nums: { seconds: MT.brokenSeconds } };
    case MORTHEN_SHATTERED:
      return {
        key: `${KEY}.shatteredWard`,
        nums: { pct: pct(a.value), seconds: MT.brokenSeconds },
      };
    case MORTHEN_GRAVE_CHILL: {
      // value2 carries the bite a second right now (before the heroic factor).
      const bite = a.value2 !== undefined && a.value2 > 0 ? a.value2 : MT.chillBase;
      return {
        key: `${KEY}.graveChill`,
        nums: {
          bite,
          biteHeroic: cryptHeroicAmount(MORTHEN_ID, bite),
          step: MT.chillStep,
          stepHeroic: cryptHeroicAmount(MORTHEN_ID, MT.chillStep),
          every: MT.chillEvery,
        },
      };
    }
    case MORTHEN_GRASP_MARK:
      // Heroic only: its damage is stated at the heroic factor.
      return {
        key: `${KEY}.graspMark`,
        nums: {
          fuse: MT.graspFuse,
          radius: a.value2 !== undefined && a.value2 > 0 ? a.value2 : MT.graspRadius,
          root: MT.graspRootSeconds,
          min: cryptHeroicAmount(MORTHEN_ID, MT.graspMin),
          max: cryptHeroicAmount(MORTHEN_ID, MT.graspMax),
        },
      };
    case MORTHEN_GRASP_ROOT:
      return { key: `${KEY}.graspRoot`, nums: { seconds: MT.graspRootSeconds } };
    case KNELLWYRM_AIRBORNE:
      // Heroic only: its fire is stated at the wyrm's heroic factor.
      return {
        key: `${KEY}.knellAirborne`,
        nums: {
          mark: KNELL_TUNING.markSeconds,
          min: cryptHeroicAmount(KNELLWYRM_ID, KNELL_TUNING.fireMin),
          max: cryptHeroicAmount(KNELLWYRM_ID, KNELL_TUNING.fireMax),
          breaths: KNELL_TUNING.breaths,
        },
      };
    case CRYPT_CARRION_EYE: {
      const eye = MOBS.crypt_crow_caller?.trashKit?.eye;
      return { key: `${KEY}.carrionEye`, nums: { seconds: eye?.seconds ?? 6 } };
    }
    case CRYPT_GRANITE_SKIN: {
      const g = MOBS.crypt_chapel_gargoyle?.trashKit?.granite;
      return {
        key: `${KEY}.graniteSkin`,
        nums: {
          pct: pct(a.value),
          every: g?.every ?? 3,
          max: g?.maxStacks ?? 5,
          cracked: pct(g?.cracked.taken ?? 0.25),
          seconds: g?.cracked.seconds ?? 6,
        },
      };
    }
    default:
      return null;
  }
}
