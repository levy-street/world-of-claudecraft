// The Smith's Heart's Guardian of the Quench alert: the pure, DOM-free view
// core of the player's own Quench bar, read off the auras the sim already
// mirrors (encounters/smith_heart/quench*.ts). A short title over a bar and
// its number, and no sentence under it (the owner's rule of 2026-11-03, kept
// again on 2026-11-09: what each state asks lives in its aura tooltip and the
// boss journal). It shows only what no other readout carries:
//  - marked for a slash: the player's number in the round, the bar the time
//    until their slash has landed;
//  - Living Rime on them: the bar is the healing left to break it (it drains
//    as the healers land), its label the number; the seconds before it
//    bursts read on the debuff's own timer.
// The cold is NOT this bar's since the playtest of 2026-11-25: the cold
// debuff badges its own value and the frost marks round the character fill
// with it (quench_cold_view.ts), and the freeze and the water read on their
// debuffs' own timers, so the bar stands down while either holds the player.
// Rime-Tempered (the tank swap) is the raid's shared tank swap alert
// (tank_swap_alert_view.ts).
// It is a live gauge the player steers by (never advisory: the hints setting
// does not hide it), shown on every graphics tier. Priority: Living Rime over
// the mark. The painter is the shared encounter alert's
// (encounter_alert_painter.ts); every decision is here.

import { QUENCH_AURAS } from '../../../sim/encounters/smith_heart/quench_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type QuenchAlertKind = 'marked' | 'rime';

/** Every kind class the painter toggles (the CSS keys on them). */
export const QUENCH_ALERT_KINDS: readonly QuenchAlertKind[] = ['marked', 'rime'];

export type QuenchAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: QuenchAlertKind };
export type QuenchAlertView = QuenchAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

interface AlertAura {
  id: string;
  remaining?: number;
  duration?: number;
  value?: number;
  value2?: number;
  value3?: number;
  stacks?: number;
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
  // Frozen solid or held in the water: the debuffs' own timers carry it.
  if (auraOf(input.auras, QUENCH_AURAS.frozen)) return HIDDEN;
  if (auraOf(input.auras, QUENCH_AURAS.trapped)) return HIDDEN;
  const rime = auraOf(input.auras, QUENCH_AURAS.rime);
  if (rime) return rimeView(rime);
  const marked = auraOf(input.auras, QUENCH_AURAS.marked);
  if (marked) return markedView(marked);
  return HIDDEN;
}
