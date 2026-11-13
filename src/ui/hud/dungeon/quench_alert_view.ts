// The Smith's Heart's Guardian of the Quench alert: the pure, DOM-free view
// core of the player's own cold bar, read off the auras the sim already
// mirrors (encounters/smith_heart/quench*.ts). A short title over a bar and
// its number, and no sentence under it (the owner's rule of 2026-11-03, kept
// again on 2026-11-09: what each state asks lives in its aura tooltip and the
// boss journal):
//  - the cold (the bar's aura: its value 0 to 100, its trend): rising it
//    reads Cold, past three quarters Freezing!, falling in a huddle Huddled
//    warmth; struck by an ally's shatter a moment ago, the title says the
//    cold it took;
//  - marked for a slash: the player's number in the round, the bar the time
//    until their slash has landed;
//  - encased in rime (the freeze): the bar is the time to the shatter;
//  - under the ice (the water): the bar is the time to the climb out;
//  - Living Rime on them: the bar is the healing left to break it (it drains
//    as the healers land), its label the number; the seconds before it
//    bursts read on the debuff's own timer.
// It is a live gauge the player steers by (never advisory: the hints setting
// does not hide it), shown the whole fight on every graphics tier. Priority:
// the freeze over the water over Living Rime over the mark over the bar. The
// painter is the shared encounter alert's (encounter_alert_painter.ts); every
// decision is here.

import { QUENCH_AURAS, QUENCH_TUNING as T } from '../../../sim/encounters/smith_heart/quench_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type QuenchAlertKind = 'cold' | 'freezing' | 'warm' | 'frozen' | 'water' | 'marked' | 'rime';

/** Every kind class the painter toggles (the CSS keys on them). */
export const QUENCH_ALERT_KINDS: readonly QuenchAlertKind[] = [
  'cold',
  'freezing',
  'warm',
  'frozen',
  'water',
  'marked',
  'rime',
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
  return {
    visible: true,
    kind,
    title,
    line: '',
    hint: '',
    key: '',
    progress: Math.max(0, Math.min(1, left / total)),
    progressAria: t('hudChrome.quenchAlert.timeAria', { seconds }),
    barLabel: t('hudChrome.quenchAlert.secondsBar', { seconds }),
    pressable: false,
    buttonAria: title,
  };
}

/** Marked for a slash: its number, the time until it has landed. */
function markedView(mark: AlertAura): QuenchAlertLive {
  const left = Math.max(0, mark.remaining ?? 0);
  const total = Math.max(1e-6, mark.duration ?? 1);
  const seconds = whole(left);
  const title = t('hudChrome.quenchAlert.markedTitle', {
    order: whole(mark.value ?? 1),
    count: whole(mark.value2 ?? 1),
  });
  return {
    visible: true,
    kind: 'marked',
    title,
    line: '',
    hint: '',
    key: '',
    progress: Math.max(0, Math.min(1, left / total)),
    progressAria: t('hudChrome.quenchAlert.timeAria', { seconds }),
    barLabel: t('hudChrome.quenchAlert.secondsBar', { seconds }),
    pressable: false,
    buttonAria: title,
  };
}

/** Living Rime on the player: the healing left to break it (the bar and its
 *  number; the seconds to its burst read on the debuff's own timer). */
function rimeView(rime: AlertAura): QuenchAlertLive {
  const full = Math.max(1, rime.value2 ?? rime.value ?? 1);
  const left = Math.max(0, Math.min(full, rime.value ?? 0));
  const title = t('hudChrome.quenchAlert.rimeTitle');
  const nums = { left: whole(left), whole: whole(full) };
  return {
    visible: true,
    kind: 'rime',
    title,
    line: '',
    hint: '',
    key: '',
    progress: left / full,
    progressAria: t('hudChrome.quenchAlert.rimeAria', nums),
    barLabel: t('hudChrome.quenchAlert.rimeBar', nums),
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
  const rime = auraOf(input.auras, QUENCH_AURAS.rime);
  if (rime) return rimeView(rime);
  const marked = auraOf(input.auras, QUENCH_AURAS.marked);
  if (marked) return markedView(marked);
  const cold = auraOf(input.auras, QUENCH_AURAS.cold);
  if (!cold) return HIDDEN;
  const value = Math.max(0, Math.min(T.coldMax, cold.value ?? 0));
  const falling = (cold.value2 ?? 1) < 0;
  const kind: QuenchAlertKind = falling
    ? 'warm'
    : value >= QUENCH_FREEZING_AT
      ? 'freezing'
      : 'cold';
  const splash = auraOf(input.auras, QUENCH_AURAS.splashed);
  const title = splash
    ? t('hudChrome.quenchAlert.splashTitle', { cold: whole(splash.value ?? 0) })
    : kind === 'warm'
      ? t('hudChrome.quenchAlert.warmTitle')
      : kind === 'freezing'
        ? t('hudChrome.quenchAlert.freezingTitle')
        : t('hudChrome.quenchAlert.coldTitle');
  const n = whole(value);
  const max = whole(T.coldMax);
  return {
    visible: true,
    kind,
    title,
    line: '',
    hint: '',
    key: '',
    progress: value / T.coldMax,
    progressAria: t('hudChrome.quenchAlert.coldAria', { cold: n, max }),
    barLabel: t('hudChrome.quenchAlert.coldBar', { cold: n, max }),
    pressable: false,
    buttonAria: title,
  };
}
