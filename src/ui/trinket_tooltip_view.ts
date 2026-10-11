// The trinkets' item-tooltip lines: the green "Equip:" line for a worn passive
// and the green "Use:" line (with its cooldown) for the action-bar effect, plus
// the Gambler's Die fortune notice. A pure string builder (t() + esc, no DOM,
// no Hud state) composed inside Hud.itemTooltip; registered in
// tests/architecture.test.ts UI_PURE_CORES and driven directly by
// tests/trinket_tooltip_view.test.ts.
//
// Every number is read from TRINKET_SPECS / GAMBLE (src/sim/content/trinkets.ts)
// and resolved the way src/sim/combat/trinkets.ts resolves it, so the copy
// cannot drift from combat: a power-scaled amount uses the viewer's live Attack
// Power, Spell Power or Healing Power with the same rounding, and a
// maximum-health amount uses the viewer's live maximum health.

import { TRINKET_EQUIP_LOCKOUT } from '../sim/combat/trinkets';
import {
  GAMBLE,
  type GambleFortune,
  type TrinketPassive,
  type TrinketSpec,
  type TrinketUse,
  trinketSpec,
} from '../sim/content/trinkets';
import { ITEMS } from '../sim/data';
import type { ItemDef } from '../sim/types';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, type InterpolationValues, type TranslationKey, t } from './i18n';
import { tSim } from './sim_i18n';

/** The viewer stats the scaled numbers resolve against (a structural subset of
 *  the player Entity both worlds mirror). */
export interface TrinketTooltipViewer {
  attackPower: number;
  /** Ranged Attack Power (hunters); 0 for everyone else. */
  rangedPower: number;
  spellPower: number;
  healPower: number;
  maxHp: number;
}

/** Keen Edge's damage bonus, read from the sim's own tuning (pinned by
 *  tests/trinket_tooltip_view.test.ts against a real roll). */
export const KEEN_EDGE_DAMAGE_BONUS = GAMBLE.keenEdgeDamage;

/** Talon Wound's fixed tick cadence and length (combat/trinkets.ts applyBleed). */
export const TALON_WOUND = Object.freeze({ every: 2, duration: 6 });

/** How long the hourglass keeps stored healing after it last grew
 *  (combat/trinkets.ts onTrinketHeal marker duration). */
export const HOURGLASS_STORE_SEC = 60;

/** Molten Ignite's fixed tick cadence (combat/trinkets.ts applyIgnite). */
export const MOLTEN_IGNITE_EVERY = 2;

/** The power a weapon-driven trinket (Forgefather's Temper, Molten Fletching)
 *  scales with: melee Attack Power, or Ranged Attack Power when that is higher
 *  (combat/trinkets.ts weaponPower). */
export function trinketWeaponPower(viewer: TrinketTooltipViewer): number {
  return Math.max(viewer.attackPower, viewer.rangedPower);
}

/** Lucky Streak's heal-over-time cadence (combat/trinkets.ts gamble arm). */
const LUCKY_STREAK_EVERY = 3;

export interface TrinketTooltipLine {
  kind: 'equip' | 'use';
  text: string;
}

const n = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });
const pct = (fraction: number): string => n(Math.round(fraction * 100));

/** "2 min" for a whole number of minutes, else "90 sec". */
export function trinketCooldownText(seconds: number): string {
  return seconds % 60 === 0
    ? t('hudChrome.trinkets.cooldownMinutes', { minutes: n(seconds / 60) })
    : t('hudChrome.trinkets.cooldownSeconds', { seconds: n(seconds) });
}

/** The fortune's display name (the aura it applies, or Snake Eyes). */
export function gambleFortuneName(fortune: GambleFortune): string {
  switch (fortune) {
    case 'keenEdge':
      return tSim('aura.trinketKeenEdge');
    case 'luckyHeal':
      return tSim('aura.trinketLuckyStreak');
    case 'gildedGuard':
      return tSim('aura.trinketGildedGuard');
    case 'snakeEyes':
      return t('hudChrome.trinkets.snakeEyes');
  }
}

/** The Gambler's Die notice for a rolled fortune (chat log + banner). */
export function trinketGambleText(fortune: GambleFortune): string {
  const die = ITEMS.gamblers_die;
  return t('hudChrome.trinkets.gambleResult', {
    item: die ? itemDisplayName(die) : 'gamblers_die',
    fortune: gambleFortuneName(fortune),
  });
}

/** Lucky Streak's total healing: the per-tick amount the sim rounds, times its ticks. */
export function luckyStreakTotal(duration: number, maxHp: number): number {
  const ticks = Math.max(1, Math.floor(duration / LUCKY_STREAK_EVERY));
  return Math.round((maxHp * GAMBLE.luckyHealShare) / ticks) * ticks;
}

function passiveLine(p: TrinketPassive, viewer: TrinketTooltipViewer): TrinketTooltipLine {
  let key: TranslationKey;
  let values: InterpolationValues;
  switch (p.kind) {
    case 'lastStand':
      key = 'hudChrome.trinkets.equip.lastStand';
      values = {
        threshold: pct(p.belowHp),
        absorb: n(Math.round(viewer.maxHp * p.absorb)),
        absorbPct: pct(p.absorb),
        duration: n(p.duration),
        icd: n(p.icd),
      };
      break;
    case 'hourglass':
      key = 'hudChrome.trinkets.equip.hourglass';
      values = {
        cap: n(Math.round(viewer.maxHp * p.cap)),
        capPct: pct(p.cap),
        fade: n(HOURGLASS_STORE_SEC),
      };
      break;
    case 'twinStrike':
      key = 'hudChrome.trinkets.equip.twinStrike';
      values = { chance: pct(p.chance), icd: n(p.icd) };
      break;
    case 'tally':
      key = 'hudChrome.trinkets.equip.tally';
      values = { max: n(p.max), duration: n(p.duration) };
      break;
    case 'storm':
      key = 'hudChrome.trinkets.equip.storm';
      values = { max: n(p.max), duration: n(p.duration) };
      break;
    case 'heat':
      key = 'hudChrome.trinkets.equip.heat';
      values = { max: n(p.max), duration: n(p.duration) };
      break;
    case 'ignite':
      key = 'hudChrome.trinkets.equip.ignite';
      values = {
        tick: scaled(p.flat, p.coef * trinketWeaponPower(viewer)),
        every: n(MOLTEN_IGNITE_EVERY),
        duration: n(p.ticks * MOLTEN_IGNITE_EVERY),
      };
      break;
    case 'guardHeat':
      key = 'hudChrome.trinkets.equip.guardHeat';
      values = { max: n(p.max), duration: n(p.duration) };
      break;
  }
  return {
    kind: 'equip',
    text: t('hudChrome.trinkets.equipLine', { effect: t(key, values) }),
  };
}

/** A power-scaled amount as its base plus what the viewer's power adds, e.g.
 *  "12 (+18)"; just the base while the viewer's power adds nothing. */
function scaled(base: number, bonus: number, digits = 0): string {
  const round = (v: number) => formatNumber(v, { maximumFractionDigits: digits });
  const shownBonus =
    digits > 0 ? Math.round(bonus * 10 ** digits) / 10 ** digits : Math.round(bonus);
  if (shownBonus <= 0) return round(base);
  return t('hudChrome.trinkets.scaled', { base: round(base), bonus: round(shownBonus) });
}

/** The stack cap of the worn passive a use spends (tally marks, storm charges,
 *  heat stacks). */
function passiveMax(spec: TrinketSpec): number {
  const p = spec.passive;
  return p &&
    (p.kind === 'tally' || p.kind === 'storm' || p.kind === 'heat' || p.kind === 'guardHeat')
    ? p.max
    : 1;
}

function useEffect(spec: TrinketSpec, u: TrinketUse, viewer: TrinketTooltipViewer): string {
  switch (u.kind) {
    case 'retaliate':
      return t('hudChrome.trinkets.use.retaliate', {
        duration: n(u.duration),
        pct: pct(u.reflect),
      });
    case 'anchor':
      return t('hudChrome.trinkets.use.anchor', {
        duration: n(u.duration),
        reduction: pct(u.reduction),
        speed: pct(u.speed),
      });
    case 'hourglass':
      return t('hudChrome.trinkets.use.hourglass', {
        range: n(u.range),
        duration: n(u.duration),
      });
    case 'wellspring':
      return t('hudChrome.trinkets.use.wellspring', {
        radius: n(u.radius),
        tick: scaled(u.tick, u.coef * viewer.healPower),
        every: n(u.every),
        duration: n(u.duration),
      });
    case 'bleedEdge':
      return t('hudChrome.trinkets.use.bleedEdge', {
        duration: n(u.duration),
        tick: scaled(u.tick, u.coef * viewer.attackPower),
        every: n(TALON_WOUND.every),
        bleedDuration: n(TALON_WOUND.duration),
        stacks: n(u.stacks),
      });
    case 'tallyStrike': {
      const perMark = u.perMark + u.coef * viewer.attackPower;
      const maxMarks = passiveMax(spec);
      return t('hudChrome.trinkets.use.tallyStrike', {
        range: n(u.range),
        perMark: scaled(u.perMark, u.coef * viewer.attackPower, 1),
        max: n(Math.round(maxMarks * perMark)),
        maxMarks: n(maxMarks),
      });
    }
    case 'stormjar': {
      const perCharge = u.perCharge + u.coef * viewer.spellPower;
      const maxCharges = passiveMax(spec);
      return t('hudChrome.trinkets.use.stormjar', {
        range: n(u.range),
        extra: n(Math.max(0, u.jumps - 1)),
        jumpRange: n(u.jumpRange),
        perCharge: scaled(u.perCharge, u.coef * viewer.spellPower, 1),
        max: n(Math.round(maxCharges * perCharge)),
        maxCharges: n(maxCharges),
      });
    }
    case 'echo':
      return t('hudChrome.trinkets.use.echo', {
        duration: n(u.duration),
        casts: n(u.casts),
        pct: pct(u.echo),
      });
    case 'gamble':
      return t('hudChrome.trinkets.use.gamble', {
        duration: n(u.duration),
        keenEdge: gambleFortuneName('keenEdge'),
        keenPct: pct(KEEN_EDGE_DAMAGE_BONUS),
        luckyStreak: gambleFortuneName('luckyHeal'),
        heal: n(luckyStreakTotal(u.duration, viewer.maxHp)),
        gildedGuard: gambleFortuneName('gildedGuard'),
        absorb: n(Math.round(viewer.maxHp * GAMBLE.gildedGuardShare)),
        snakeEyes: gambleFortuneName('snakeEyes'),
      });
    case 'blink':
      return t('hudChrome.trinkets.use.blink', {
        yards: n(u.yards),
        reduction: pct(u.reduction),
        guard: n(u.guard),
      });
    case 'sprint':
      return t('hudChrome.trinkets.use.sprint', {
        speed: pct(u.speed - 1),
        duration: n(u.duration),
      });
    case 'defiance':
      return t('hudChrome.trinkets.use.defiance');
    case 'brand':
      return t('hudChrome.trinkets.use.brand', {
        range: n(u.range),
        cut: pct(u.cut),
        duration: n(u.duration),
      });
    case 'temper': {
      const maxHeat = passiveMax(spec);
      return t('hudChrome.trinkets.use.temper', {
        duration: n(u.duration),
        damage: scaled(u.flat, u.coef * trinketWeaponPower(viewer)),
        perHeat: pct(u.perHeat),
        maxBonus: pct(u.perHeat * maxHeat),
        maxHeat: n(maxHeat),
        killExtend: n(u.killExtend),
        maxDuration: n(u.maxDuration),
      });
    }
    case 'kindlingOrb':
      return t('hudChrome.trinkets.use.kindlingOrb', {
        duration: n(u.duration),
        damage: scaled(u.flat, u.coef * viewer.spellPower),
      });
    case 'pierce':
      return t('hudChrome.trinkets.use.pierce', {
        duration: n(u.duration),
        reach: n(u.reach),
        share: pct(u.share),
      });
    case 'lantern':
      return t('hudChrome.trinkets.use.lantern', {
        duration: n(u.duration),
        radius: n(u.radius),
        share: pct(u.share),
      });
    case 'heartNova': {
      const perHeat = u.flat + u.coef * viewer.attackPower;
      const maxHeat = passiveMax(spec);
      return t('hudChrome.trinkets.use.heartNova', {
        perHeat: scaled(u.flat, u.coef * viewer.attackPower, 1),
        max: n(Math.round(maxHeat * perHeat)),
        maxHeat: n(maxHeat),
        radius: n(u.radius),
      });
    }
  }
}

/** The Equip (when the trinket has a passive) and Use lines, in that order, or
 *  an empty list for an item that is not a trinket with a spec. */
export function trinketTooltipLineTexts(
  itemId: string,
  viewer: TrinketTooltipViewer,
): TrinketTooltipLine[] {
  const spec = trinketSpec(itemId);
  if (!spec) return [];
  const lines: TrinketTooltipLine[] = [];
  if (spec.passive) lines.push(passiveLine(spec.passive, viewer));
  lines.push({
    kind: 'use',
    text: t('hudChrome.trinkets.useLine', {
      effect: useEffect(spec, spec.use, viewer),
      cooldown: trinketCooldownText(spec.cooldown),
    }),
  });
  return lines;
}

/** The on-equip lockout note (combat/trinkets.ts onTrinketEquipped): putting a
 *  trinket on starts its use cooldown at TRINKET_EQUIP_LOCKOUT, or at the
 *  cooldown the trinket it replaces still had, whichever is longer. Null for an
 *  item that is not a trinket with a spec. */
export function trinketEquipLockoutText(itemId: string): string | null {
  if (!trinketSpec(itemId)) return null;
  return t('hudChrome.trinkets.equipLockout', { seconds: n(TRINKET_EQUIP_LOCKOUT) });
}

/** The lines as tooltip HTML (green, like every Equip/Use line), then the
 *  on-equip lockout note as a muted sub-line; '' for a non-trinket. */
export function trinketTooltipLines(item: ItemDef, viewer: TrinketTooltipViewer): string {
  let html = '';
  for (const line of trinketTooltipLineTexts(item.id, viewer))
    html += `<div class="tt-green">${esc(line.text)}</div>`;
  const lockout = trinketEquipLockoutText(item.id);
  if (lockout) html += `<div class="tt-sub">${esc(lockout)}</div>`;
  return html;
}
