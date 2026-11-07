// The Smith's Heart's Masterless Strength alert: the pure, DOM-free view core
// of what the fight asks of the local player, read off the auras the sim
// already mirrors (encounters/smith_heart/final_ids.ts):
//  - Encased in Rime (frozen alone): the bar is the time to the thaw;
//  - Ember Mark: embers fall at your feet when the bar runs out, so join the
//    other marked players in one corner;
//  - Drawn Lightning: keep 8 yd from everyone while the bar runs;
//  - the Quench quarter's cold (the bar, 0 to 100): rising, stand with two or
//    more others; past three quarters it turns urgent;
//  - Crushed: sit the next Weight of the Anvil out while the bar runs;
//  - part 2: Bursting Coal (leave the group before it bursts), Wind-Tethered
//    (drag the Splinter of the Breath away), Mounting Weight on a tank near
//    the swap (final_phase_ids.ts).
// The cold is a live gauge the player steers by, so the alert is an ACTION
// prompt (the hints setting never hides it), on every graphics tier.
// Priority: the coal, the tether, frozen, then the ember, the lightning, the cold, Crushed. The cold
// reuses the Guardian of the Quench's lines (quenchAlert.*). The painter is
// the shared encounter alert's (encounter_alert_painter.ts).

import { FINAL_AURAS, FINAL_TUNING as T } from '../../../sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS,
  MOUNTING_WEIGHT_AURA,
  FINAL_PHASES as P,
} from '../../../sim/encounters/smith_heart/final_phase_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type FinalAlertKind =
  | 'frozen'
  | 'ember'
  | 'drawn'
  | 'cold'
  | 'freezing'
  | 'crushed'
  | 'coal'
  | 'tether'
  | 'weight';

/** Every kind class the painter toggles (the CSS keys on them). */
export const FINAL_ALERT_KINDS: readonly FinalAlertKind[] = [
  'frozen',
  'ember',
  'drawn',
  'cold',
  'freezing',
  'crushed',
  'coal',
  'tether',
  'weight',
];

/** Past this much cold (of 100) a rising bar is urgent. */
export const FINAL_FREEZING_AT = 75;

export type FinalAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: FinalAlertKind };
export type FinalAlertView = FinalAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

interface AlertAura {
  id: string;
  remaining?: number;
  duration?: number;
  value?: number;
  value2?: number;
  stacks?: number;
}

export interface FinalAlertInput {
  auras: readonly AlertAura[];
  dead?: boolean;
}

function auraOf(auras: readonly AlertAura[], id: string): AlertAura | null {
  for (const a of auras) if (a.id === id) return a;
  return null;
}

const whole = (v: number) => formatNumber(Math.max(0, Math.ceil(v)), { maximumFractionDigits: 0 });

function timed(kind: FinalAlertKind, title: string, line: string, mark: AlertAura): FinalAlertLive {
  const left = Math.max(0, mark.remaining ?? 0);
  const total = Math.max(1e-6, mark.duration ?? 1);
  return {
    visible: true,
    kind,
    title,
    line,
    hint: '',
    key: '',
    progress: Math.max(0, Math.min(1, left / total)),
    progressAria: t('hudChrome.quenchAlert.timeAria', { seconds: whole(left) }),
    barLabel: '',
    pressable: false,
    buttonAria: title,
  };
}

export function buildFinalAlertView(input: FinalAlertInput): FinalAlertView {
  if (input.dead) return HIDDEN;
  const a = input.auras;
  const coal = auraOf(a, FINAL_PHASE_AURAS.coal);
  if (coal)
    return timed(
      'coal',
      t('hudChrome.finalAlert.coalTitle'),
      t('hudChrome.finalAlert.coalLine', {
        reach: formatNumber(P.coalReach, { maximumFractionDigits: 0 }),
        seconds: whole(coal.remaining ?? 0),
      }),
      coal,
    );
  const tether = auraOf(a, FINAL_PHASE_AURAS.tether);
  if (tether)
    return timed(
      'tether',
      t('hudChrome.finalAlert.tetherTitle'),
      t('hudChrome.finalAlert.tetherLine', { seconds: whole(tether.remaining ?? 0) }),
      tether,
    );
  const frozen = auraOf(a, FINAL_AURAS.frozen);
  if (frozen)
    return timed(
      'frozen',
      t('hudChrome.quenchAlert.frozenTitle'),
      t('hudChrome.finalAlert.frozenLine', { seconds: whole(frozen.remaining ?? 0) }),
      frozen,
    );
  const ember = auraOf(a, FINAL_AURAS.ember);
  if (ember)
    return timed(
      'ember',
      t('hudChrome.finalAlert.emberTitle'),
      t('hudChrome.finalAlert.emberLine', { seconds: whole(ember.remaining ?? 0) }),
      ember,
    );
  const drawn = auraOf(a, FINAL_AURAS.drawn);
  if (drawn)
    return timed(
      'drawn',
      t('hudChrome.finalAlert.drawnTitle'),
      t('hudChrome.finalAlert.drawnLine', {
        reach: formatNumber(T.drawnReach, { maximumFractionDigits: 0 }),
        seconds: whole(drawn.remaining ?? 0),
      }),
      drawn,
    );
  const cold = auraOf(a, FINAL_AURAS.cold);
  const value = Math.max(0, Math.min(T.coldMax, Math.round(cold?.value ?? 0)));
  if (cold && (value > 0 || (cold.value2 ?? 0) > 0)) {
    const freezing = (cold.value2 ?? 0) > 0 && value >= FINAL_FREEZING_AT;
    const n = (v: number) => formatNumber(v, { maximumFractionDigits: 0 });
    return {
      visible: true,
      kind: freezing ? 'freezing' : 'cold',
      title: freezing
        ? t('hudChrome.quenchAlert.freezingTitle')
        : t('hudChrome.quenchAlert.coldTitle'),
      line: t('hudChrome.quenchAlert.coldLine', {
        radius: n(T.coldReach),
        others: n(T.coldAllies),
      }),
      hint: '',
      key: '',
      progress: value / T.coldMax,
      progressAria: t('hudChrome.quenchAlert.coldAria', { cold: n(value), max: n(T.coldMax) }),
      barLabel: t('hudChrome.quenchAlert.coldBar', { cold: n(value), max: n(T.coldMax) }),
      pressable: false,
      buttonAria: t('hudChrome.quenchAlert.coldTitle'),
    };
  }
  const crushed = auraOf(a, FINAL_AURAS.crushed);
  if (crushed)
    return timed(
      'crushed',
      t('hudChrome.finalAlert.crushedTitle'),
      t('hudChrome.finalAlert.crushedLine', { seconds: whole(crushed.remaining ?? 0) }),
      crushed,
    );
  const weight = auraOf(a, MOUNTING_WEIGHT_AURA);
  const stacks = Math.round(weight?.stacks ?? 0);
  if (weight && stacks >= P.weightSwap - 1)
    return timed(
      'weight',
      t('hudChrome.finalAlert.weightTitle', {
        stacks: formatNumber(stacks, { maximumFractionDigits: 0 }),
      }),
      t('hudChrome.finalAlert.weightLine', {
        swap: formatNumber(P.weightSwap, { maximumFractionDigits: 0 }),
      }),
      weight,
    );
  return HIDDEN;
}
