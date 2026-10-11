// What each trinket aura DOES, for its buff/debuff hover tooltip. A pure
// descriptor like the rest of aura_effect.ts (which calls this first): it
// returns a hudChrome.auraEffect.trinket.* key plus the raw numbers, and the HUD
// formats the numbers and renders t(key, values). No DOM, no i18n runtime.
// Pinned by tests/trinket_aura_tooltip.test.ts.
//
// Numbers come from where combat keeps them (src/sim/combat/trinkets.ts): the
// aura's own value, stacks and tick interval when the sim stores the live
// amount there (absorbs, heals, bleeds, burns, shares, stored healing, spent
// heat), and TRINKET_SPECS otherwise. A few trinket counters feed an amount
// that scales with the wearer's power (the tally strike, the storm bolt, the
// heart nova, the temper's fire, the orb's bolt, the talon bleed): those
// resolve against the viewing player's live power when the aura is their own,
// with the same rounding combat uses, and fall back to a number-free sentence
// on anyone else's aura (their power is not on the wire).

import {
  TRINKET_ANCHOR_SLOW_AURA,
  TRINKET_AURA,
  TRINKET_AURA_ITEM,
  TRINKET_SPECS,
  type TrinketPassive,
  type TrinketUse,
} from '../sim/content/trinkets';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

/** The local player's live power, for their own power-scaled trinket auras
 *  (a structural subset of the Entity both worlds mirror). */
export interface TrinketAuraViewer {
  id: number;
  attackPower: number;
  /** Ranged Attack Power (hunters); 0 for everyone else. */
  rangedPower: number;
  spellPower: number;
}

/** The aura fields a trinket arm reads beyond AuraEffectInput. */
export interface TrinketAuraInput extends AuraEffectInput {
  sourceId?: number;
}

const KEY = 'hudChrome.auraEffect.trinket';

/** Talon Wound's fixed cadence and length (combat/trinkets.ts applyBleed). */
const TALON_WOUND_EVERY = 2;
const TALON_WOUND_DURATION = 6;
/** Molten Ignite's fixed cadence (combat/trinkets.ts applyIgnite). */
const MOLTEN_IGNITE_EVERY = 2;

const round = (n: number): number => Math.round(n);
const round1 = (n: number): number => Math.round(n * 10) / 10;
const pct = (fraction: number): number => Math.abs(round(fraction * 100));

type UseOf<K extends TrinketUse['kind']> = Extract<TrinketUse, { kind: K }>;
type PassiveOf<K extends TrinketPassive['kind']> = Extract<TrinketPassive, { kind: K }>;

function useOf<K extends TrinketUse['kind']>(itemId: string, kind: K): UseOf<K> | undefined {
  const use = TRINKET_SPECS[itemId]?.use;
  return use?.kind === kind ? (use as UseOf<K>) : undefined;
}

function passiveOf<K extends TrinketPassive['kind']>(
  itemId: string,
  kind: K,
): PassiveOf<K> | undefined {
  const passive = TRINKET_SPECS[itemId]?.passive;
  return passive?.kind === kind ? (passive as PassiveOf<K>) : undefined;
}

/** The weapon power Forgefather's Temper scales with (combat weaponPower). */
function weaponPower(v: TrinketAuraViewer): number {
  return Math.max(v.attackPower, v.rangedPower);
}

/** Whether this aura is the viewer's own, so their power resolves its amount. */
function ownViewer(a: TrinketAuraInput, viewer?: TrinketAuraViewer): TrinketAuraViewer | null {
  return viewer && a.sourceId === viewer.id ? viewer : null;
}

/** True for every aura a trinket applies (TRINKET_AURA_ITEM's keys). */
export function isTrinketAuraId(id: string | undefined): id is string {
  return id !== undefined && Object.hasOwn(TRINKET_AURA_ITEM, id);
}

/**
 * Describe a trinket aura, or null when the aura is not a trinket's (the caller
 * then falls through to the generic kind descriptors).
 */
export function trinketAuraEffectDescriptor(
  a: TrinketAuraInput,
  viewer?: TrinketAuraViewer,
): AuraEffectDescriptor | null {
  if (!isTrinketAuraId(a.id)) return null;
  const stacks = Math.max(0, Math.trunc(a.stacks ?? 0));
  const own = ownViewer(a, viewer);
  switch (a.id) {
    case TRINKET_AURA.lastStandIcd: {
      const p = passiveOf('bastion_sigil', 'lastStand');
      return { key: `${KEY}.lastStandCooldown`, nums: { threshold: pct(p?.belowHp ?? 0) } };
    }
    case TRINKET_AURA.lastStand: {
      const p = passiveOf('bastion_sigil', 'lastStand');
      return {
        key: `${KEY}.lastBastion`,
        nums: { value: round(a.value), threshold: pct(p?.belowHp ?? 0) },
      };
    }
    case TRINKET_AURA.retaliate:
      return { key: `${KEY}.retaliate`, nums: { pct: pct(a.value) } };
    case TRINKET_AURA.anchor:
    case TRINKET_AURA.anchorGuard:
    case TRINKET_ANCHOR_SLOW_AURA: {
      // The three Moored auras share one sentence; each reads its own live
      // number from its value and the other one from the spec.
      const use = useOf('mooring_stone', 'anchor');
      const reduction = a.id === TRINKET_AURA.anchorGuard ? a.value : (use?.reduction ?? 0);
      const speed = a.id === TRINKET_AURA.anchorGuard ? (use?.speed ?? 1) : a.value;
      return { key: `${KEY}.moored`, nums: { reduction: pct(reduction), speed: pct(speed) } };
    }
    case TRINKET_AURA.hourglass: {
      const use = useOf('menders_hourglass', 'hourglass');
      return {
        key: `${KEY}.hourglassStored`,
        nums: { stored: round(a.value), range: use?.range ?? 0 },
      };
    }
    case TRINKET_AURA.hourglassShield:
      return { key: `${KEY}.hourglassShield`, nums: { value: round(a.value) } };
    case TRINKET_AURA.wellspring:
      return {
        key: `${KEY}.wellspring`,
        nums: { tick: round(a.value), every: a.tickInterval ?? 0 },
      };
    case TRINKET_AURA.twinStrikeIcd:
      return { key: `${KEY}.twinStrikeCooldown`, nums: {} };
    case TRINKET_AURA.bleedEdge: {
      const use = useOf('paired_talons', 'bleedEdge');
      const max = use?.stacks ?? 0;
      if (!own || !use) return { key: `${KEY}.bleedEdgeOther`, nums: { max } };
      return {
        key: `${KEY}.bleedEdge`,
        nums: {
          tick: round(use.tick + use.coef * own.attackPower),
          every: TALON_WOUND_EVERY,
          duration: TALON_WOUND_DURATION,
          max,
        },
      };
    }
    case TRINKET_AURA.bleed:
      return {
        key: `${KEY}.talonWound`,
        nums: {
          damage: round(a.value),
          every: a.tickInterval ?? TALON_WOUND_EVERY,
          stacks: Math.max(1, stacks),
          max: useOf('paired_talons', 'bleedEdge')?.stacks ?? 0,
        },
      };
    case TRINKET_AURA.tally: {
      const use = useOf('hunters_tally', 'tallyStrike');
      const max = passiveOf('hunters_tally', 'tally')?.max ?? 0;
      if (!own || !use) return { key: `${KEY}.tallyOther`, nums: { stacks, max } };
      const perMark = use.perMark + use.coef * own.attackPower;
      return {
        key: `${KEY}.tally`,
        nums: { stacks, max, damage: round(stacks * perMark), perMark: round1(perMark) },
      };
    }
    case TRINKET_AURA.storm: {
      const use = useOf('stormjar', 'stormjar');
      const max = passiveOf('stormjar', 'storm')?.max ?? 0;
      const extra = Math.max(0, (use?.jumps ?? 1) - 1);
      if (!own || !use) return { key: `${KEY}.stormOther`, nums: { stacks, max, extra } };
      const perCharge = use.perCharge + use.coef * own.spellPower;
      return {
        key: `${KEY}.storm`,
        nums: {
          stacks,
          max,
          extra,
          jumpRange: use.jumpRange,
          damage: round(stacks * perCharge),
          perCharge: round1(perCharge),
        },
      };
    }
    case TRINKET_AURA.echo:
      return { key: `${KEY}.echo`, nums: { casts: stacks, pct: pct(a.value) } };
    case TRINKET_AURA.fortune:
      // One aura id, three fortunes: the kind says which one was rolled.
      if (a.kind === 'buff_dmg_done') {
        return { key: `${KEY}.keenEdge`, nums: { pct: pct(a.value) } };
      }
      if (a.kind === 'hot') {
        return {
          key: `${KEY}.luckyStreak`,
          nums: { tick: round(a.value), every: a.tickInterval ?? 0 },
        };
      }
      return { key: `${KEY}.gildedGuard`, nums: { value: round(a.value) } };
    case TRINKET_AURA.riftGuard:
      return { key: `${KEY}.riftGuard`, nums: { pct: pct(a.value) } };
    case TRINKET_AURA.sprint:
      return { key: `${KEY}.sprint`, nums: { pct: pct(a.value - 1) } };
    case TRINKET_AURA.brand:
      return { key: `${KEY}.brand`, nums: { pct: pct(a.value) } };
    case TRINKET_AURA.heat: {
      const use = useOf('forgefathers_temper', 'temper');
      const max = passiveOf('forgefathers_temper', 'heat')?.max ?? 0;
      return {
        key: `${KEY}.forgeHeat`,
        nums: { stacks, max, pct: pct(stacks * (use?.perHeat ?? 0)) },
      };
    }
    case TRINKET_AURA.temper: {
      const use = useOf('forgefathers_temper', 'temper');
      const heat = Math.max(0, round(a.value));
      const bonus = pct(heat * (use?.perHeat ?? 0));
      if (!own || !use) return { key: `${KEY}.temperedOther`, nums: { pct: bonus } };
      const damage = Math.max(
        1,
        round((use.flat + use.coef * weaponPower(own)) * (1 + use.perHeat * heat)),
      );
      return {
        key: `${KEY}.tempered`,
        nums: {
          damage,
          pct: bonus,
          killExtend: use.killExtend,
          maxDuration: use.maxDuration,
        },
      };
    }
    case TRINKET_AURA.kindlingOrb: {
      const use = useOf('kindling_orb', 'kindlingOrb');
      if (!own || !use) return { key: `${KEY}.kindlingOrbOther`, nums: {} };
      return {
        key: `${KEY}.kindlingOrb`,
        nums: { damage: Math.max(1, round(use.flat + use.coef * own.spellPower)) },
      };
    }
    case TRINKET_AURA.ignite:
      return {
        key: `${KEY}.moltenIgnite`,
        nums: { damage: round(a.value), every: a.tickInterval ?? MOLTEN_IGNITE_EVERY },
      };
    case TRINKET_AURA.pierce: {
      const use = useOf('molten_fletching', 'pierce');
      return { key: `${KEY}.pierce`, nums: { pct: pct(a.value), reach: use?.reach ?? 0 } };
    }
    case TRINKET_AURA.lantern: {
      const use = useOf('last_flame_lantern', 'lantern');
      return { key: `${KEY}.lantern`, nums: { pct: pct(a.value), radius: use?.radius ?? 0 } };
    }
    case TRINKET_AURA.guardHeat: {
      const use = useOf('heart_of_the_crucible', 'heartNova');
      const max = passiveOf('heart_of_the_crucible', 'guardHeat')?.max ?? 0;
      const radius = use?.radius ?? 0;
      if (!own || !use) return { key: `${KEY}.crucibleHeatOther`, nums: { stacks, max, radius } };
      return {
        key: `${KEY}.crucibleHeat`,
        nums: {
          stacks,
          max,
          radius,
          damage: Math.max(1, round((use.flat + use.coef * own.attackPower) * stacks)),
        },
      };
    }
  }
  return null;
}
