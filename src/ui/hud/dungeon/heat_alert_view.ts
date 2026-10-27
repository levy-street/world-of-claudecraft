// The Smith's Heart's Guardian of the Heat alert: the pure, DOM-free view
// core of the Hearth's heat gauge, read off the auras the sim already mirrors
// (encounters/smith_heart/heat*.ts):
//  - the heat (the quiet marker every player on the Hearth's floor wears: its
//    value 0 to 100, its trend): rising, it says the crystals' rays cool it;
//    falling, that the rays are working;
//  - the wind-up (from 90): urgent, brace for Hearthburst;
//  - the player's own Crystal Burn (a debuff's stacks): past a handful it
//    turns urgent and tells them to hand the ray to someone else.
// It is a live gauge the player steers by (never advisory: the hints setting
// does not hide it), shown the whole fight on every graphics tier. Priority:
// the wind-up over a heavy burn over the heat. The painter is the shared
// encounter alert's (encounter_alert_painter.ts); every decision is here. The
// same family as the Quench's cold bar (quench_alert_view.ts), never a copy of
// its painter.

import {
  burnAmp,
  HEAT_AURAS,
  HEAT_TUNING as T,
} from '../../../sim/encounters/smith_heart/heat_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type HeatAlertKind = 'heat' | 'cooling' | 'overheat' | 'burning';

/** Every kind class the painter toggles (the CSS keys on them). */
export const HEAT_ALERT_KINDS: readonly HeatAlertKind[] = [
  'heat',
  'cooling',
  'overheat',
  'burning',
];

/** From this many stacks of Crystal Burn the gauge tells the player to hand
 *  the ray on. */
export const HEAT_BURNING_AT = 5;

export type HeatAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: HeatAlertKind };
export type HeatAlertView = HeatAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

interface AlertAura {
  id: string;
  value?: number;
  value2?: number;
  stacks?: number;
}

export interface HeatAlertInput {
  auras: readonly AlertAura[];
  dead?: boolean;
}

function auraOf(auras: readonly AlertAura[], id: string): AlertAura | null {
  for (const a of auras) if (a.id === id) return a;
  return null;
}

const whole = (v: number) => formatNumber(Math.max(0, Math.round(v)), { maximumFractionDigits: 0 });

export function buildHeatAlertView(input: HeatAlertInput): HeatAlertView {
  if (input.dead) return HIDDEN;
  const mark = auraOf(input.auras, HEAT_AURAS.heat);
  if (!mark) return HIDDEN;
  const heat = Math.max(0, Math.min(T.heatMax, mark.value ?? 0));
  const falling = (mark.value2 ?? 1) < 0;
  const stacks = auraOf(input.auras, HEAT_AURAS.burn)?.stacks ?? 0;
  const kind: HeatAlertKind =
    heat >= T.windupAt
      ? 'overheat'
      : stacks >= HEAT_BURNING_AT
        ? 'burning'
        : falling
          ? 'cooling'
          : 'heat';
  const n = whole(heat);
  const max = whole(T.heatMax);
  const title =
    kind === 'overheat'
      ? t('hudChrome.heatAlert.overheatTitle')
      : kind === 'burning'
        ? t('hudChrome.heatAlert.burningTitle', { stacks: whole(stacks) })
        : kind === 'cooling'
          ? t('hudChrome.heatAlert.coolingTitle')
          : t('hudChrome.heatAlert.heatTitle');
  const line =
    kind === 'overheat'
      ? t('hudChrome.heatAlert.overheatLine', { max })
      : kind === 'burning'
        ? t('hudChrome.heatAlert.burningLine', { pct: whole(burnAmp(stacks) * 100) })
        : kind === 'cooling'
          ? t('hudChrome.heatAlert.coolingLine')
          : t('hudChrome.heatAlert.heatLine', { range: whole(T.rayRange) });
  return {
    visible: true,
    kind,
    title,
    line,
    hint: '',
    key: '',
    progress: heat / T.heatMax,
    progressAria: t('hudChrome.heatAlert.heatAria', { heat: n, max }),
    barLabel: t('hudChrome.heatAlert.heatBar', { heat: n, max }),
    pressable: false,
    buttonAria: title,
  };
}
