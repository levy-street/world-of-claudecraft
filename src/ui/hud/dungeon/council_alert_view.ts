// The Smith's Heart's Hammer Council alert: the pure, DOM-free view core. It
// tells the local player which council mark is on them, read off the auras
// the sim already mirrors (encounters/smith_heart/council*.ts): Mountain's
// Rush, Falling Rock, Wake the Stone, Hammer's Weight or Resonance. Each is a
// short title over the mark's own time left (the bar and its seconds), with
// no sentence under it: what a mark asks lives in its aura tooltip and the
// boss journal, and the world shows the rest (the owner's rule of 2026-11-03,
// kept again on 2026-11-09: as little text in the fight as it can bear).
// Priority: the Rush over the rock over the wake over the Weight over
// Resonance. The painter is the shared encounter alert's
// (encounter_alert_painter.ts); every decision is here.

import { COUNCIL_AURAS } from '../../../sim/encounters/smith_heart/council_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type CouncilAlertKind = 'rush' | 'rock' | 'wake' | 'weight' | 'resonance';

/** Every kind class the painter toggles (the CSS keys on them). */
export const COUNCIL_ALERT_KINDS: readonly CouncilAlertKind[] = [
  'rush',
  'rock',
  'wake',
  'weight',
  'resonance',
];

export type CouncilAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: CouncilAlertKind };
export type CouncilAlertView = CouncilAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

interface AlertAura {
  id: string;
  remaining?: number;
  duration?: number;
  value?: number;
  value2?: number;
}

export interface CouncilAlertInput {
  auras: readonly AlertAura[];
}

function auraOf(auras: readonly AlertAura[], id: string): AlertAura | null {
  for (const a of auras) if (a.id === id) return a;
  return null;
}

function timeLeft(a: AlertAura): number {
  if (!a.duration || a.duration <= 0 || a.remaining === undefined) return 0;
  return Math.max(0, Math.min(1, a.remaining / a.duration));
}

function live(kind: CouncilAlertKind, title: string, mark: AlertAura): CouncilAlertLive {
  const seconds = formatNumber(Math.max(0, Math.ceil(mark.remaining ?? 0)), {
    maximumFractionDigits: 0,
  });
  return {
    visible: true,
    kind,
    title,
    line: '',
    hint: '',
    key: '',
    progress: timeLeft(mark),
    progressAria: t('hudChrome.council.alert.timeAria', { seconds }),
    barLabel: t('hudChrome.quenchAlert.secondsBar', { seconds }),
    pressable: false,
    buttonAria: title,
  };
}

/** Is Mountain's Rush marked on the player? The one council mark that kills: its
 *  alert shows whatever the hints setting (dungeon_prompts.ts), big, red and in the
 *  screen's upper middle (the CSS's `is-rush`), with its alarm in the player's ear
 *  (game/smith_heart_council_audio_core.ts RUSH_MARK_ALARM). */
export function councilRushMarked(auras: readonly AlertAura[]): boolean {
  return auraOf(auras, COUNCIL_AURAS.rushMark) !== null;
}

export function buildCouncilAlertView(input: CouncilAlertInput): CouncilAlertView {
  const rush = auraOf(input.auras, COUNCIL_AURAS.rushMark);
  if (rush) return live('rush', t('hudChrome.council.alert.rushTitle'), rush);
  const rock = auraOf(input.auras, COUNCIL_AURAS.rockMark);
  if (rock) return live('rock', t('hudChrome.council.alert.rockTitle'), rock);
  const wake = auraOf(input.auras, COUNCIL_AURAS.wakeMark);
  if (wake) return live('wake', t('hudChrome.council.alert.wakeTitle'), wake);
  const weight = auraOf(input.auras, COUNCIL_AURAS.weight);
  if (weight) return live('weight', t('hudChrome.council.alert.weightTitle'), weight);
  const res = auraOf(input.auras, COUNCIL_AURAS.resonance);
  if (res) return live('resonance', t('hudChrome.council.alert.resonanceTitle'), res);
  return HIDDEN;
}
