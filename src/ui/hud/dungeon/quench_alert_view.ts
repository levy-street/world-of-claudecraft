// The Smith's Heart's Guardian of the Quench alert: the pure, DOM-free view
// core of the player's own cold bar, read off the auras the sim already
// mirrors (encounters/smith_heart/quench*.ts):
//  - the cold (the bar's aura: its value 0 to 100, its trend): rising, it
//    says how to warm up; past three quarters it turns urgent; falling in a
//    huddle, it says the huddle warms and the ice will crack under it;
//  - encased in rime (the freeze): the bar is the time to the shatter and
//    the line tells the raid to step away;
//  - under the ice (the water): the bar is the time to the climb out.
// It is a live gauge the player steers by (never advisory: the hints setting
// does not hide it), shown the whole fight on every graphics tier. Priority:
// the freeze over the water over the bar. The painter is the shared encounter
// alert's (encounter_alert_painter.ts); every decision is here.

import { QUENCH_AURAS, QUENCH_TUNING as T } from '../../../sim/encounters/smith_heart/quench_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type QuenchAlertKind = 'cold' | 'freezing' | 'warm' | 'frozen' | 'water';

/** Every kind class the painter toggles (the CSS keys on them). */
export const QUENCH_ALERT_KINDS: readonly QuenchAlertKind[] = [
  'cold',
  'freezing',
  'warm',
  'frozen',
  'water',
];

/** Past this much cold (of 100) a rising bar is urgent. */
export const QUENCH_FREEZING_AT = 75;

export type QuenchAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: QuenchAlertKind };
export type QuenchAlertView = QuenchAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

interface AlertAura {
  id: string;
  remaining?: number;
  duration?: number;
  value?: number;
  value2?: number;
}

export interface QuenchAlertInput {
  auras: readonly AlertAura[];
  dead?: boolean;
}

function auraOf(auras: readonly AlertAura[], id: string): AlertAura | null {
  for (const a of auras) if (a.id === id) return a;
  return null;
}

const whole = (v: number) => formatNumber(Math.max(0, Math.ceil(v)), { maximumFractionDigits: 0 });

/** A timed state's view: the bar is the time left. */
function timed(kind: QuenchAlertKind, title: string, mark: AlertAura): QuenchAlertLive {
  // The water's root runs a second past the climb (the sim lifts it then).
  const pad = kind === 'water' ? 1 : 0;
  const left = Math.max(0, (mark.remaining ?? 0) - pad);
  const total = Math.max(1e-6, (mark.duration ?? 1) - pad);
  const seconds = whole(left);
  const line =
    kind === 'frozen'
      ? t('hudChrome.quenchAlert.frozenLine', { seconds })
      : t('hudChrome.quenchAlert.waterLine', { seconds });
  return {
    visible: true,
    kind,
    title,
    line,
    hint: '',
    key: '',
    progress: Math.max(0, Math.min(1, left / total)),
    progressAria: t('hudChrome.quenchAlert.timeAria', { seconds }),
    barLabel: '',
    pressable: false,
    buttonAria: title,
  };
}

export function buildQuenchAlertView(input: QuenchAlertInput): QuenchAlertView {
  if (input.dead) return HIDDEN;
  const frozen = auraOf(input.auras, QUENCH_AURAS.frozen);
  if (frozen) return timed('frozen', t('hudChrome.quenchAlert.frozenTitle'), frozen);
  const water = auraOf(input.auras, QUENCH_AURAS.trapped);
  if (water) return timed('water', t('hudChrome.quenchAlert.waterTitle'), water);
  const cold = auraOf(input.auras, QUENCH_AURAS.cold);
  if (!cold) return HIDDEN;
  const value = Math.max(0, Math.min(T.coldMax, cold.value ?? 0));
  const falling = (cold.value2 ?? 1) < 0;
  const kind: QuenchAlertKind = falling
    ? 'warm'
    : value >= QUENCH_FREEZING_AT
      ? 'freezing'
      : 'cold';
  const title =
    kind === 'warm'
      ? t('hudChrome.quenchAlert.warmTitle')
      : kind === 'freezing'
        ? t('hudChrome.quenchAlert.freezingTitle')
        : t('hudChrome.quenchAlert.coldTitle');
  const line =
    kind === 'warm'
      ? t('hudChrome.quenchAlert.warmLine', { seconds: whole(T.strainLinger) })
      : t('hudChrome.quenchAlert.coldLine', {
          radius: whole(T.warmR),
          others: whole(T.warmNeed),
        });
  const n = whole(value);
  const max = whole(T.coldMax);
  return {
    visible: true,
    kind,
    title,
    line,
    hint: '',
    key: '',
    progress: value / T.coldMax,
    progressAria: t('hudChrome.quenchAlert.coldAria', { cold: n, max }),
    barLabel: t('hudChrome.quenchAlert.coldBar', { cold: n, max }),
    pressable: false,
    buttonAria: title,
  };
}
