// The Smith's Heart's Masterless Strength alert: the pure, DOM-free view core
// of the mark or gauge the fight puts on the local player, read off the auras
// the sim already mirrors (encounters/smith_heart/final_ids.ts and
// final_phase_ids.ts). A short title over a bar and its number, and no
// sentence under it (the owner's rule of 2026-11-03, kept again on
// 2026-11-09: what each mark asks lives in its aura tooltip and the boss
// journal):
//  - the stars' marks (the rework of 2026-11-18): Crossing Blade (the line
//    runs through you: lead it through the pillars; once it locks, step
//    off) and Sky Strike (lightning falls where you stand: move);
//  - Ember Mark, Drawn Lightning, Crushed, and part 2's Bursting Coal,
//    Wind-Tethered and Mounting Weight (a tank near the swap): the bar is the
//    mark's time left, its label the seconds.
// The marked player's own alarm (the owner's rule: alarms only for the one
// affected), an ACTION prompt (the hints setting never hides it), on every
// graphics tier. Priority: the coal, the tether, the blade, the strike, the
// ember, the lightning, Crushed, the Weight. The painter is the shared
// encounter alert's (encounter_alert_painter.ts).

import { FINAL_AURAS } from '../../../sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS,
  MOUNTING_WEIGHT_AURA,
  FINAL_PHASES as P,
} from '../../../sim/encounters/smith_heart/final_phase_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type FinalAlertKind =
  | 'blade'
  | 'bladeLocked'
  | 'sky'
  | 'ember'
  | 'drawn'
  | 'crushed'
  | 'coal'
  | 'tether'
  | 'weight';

/** Every kind class the painter toggles (the CSS keys on them). */
export const FINAL_ALERT_KINDS: readonly FinalAlertKind[] = [
  'blade',
  'bladeLocked',
  'sky',
  'ember',
  'drawn',
  'crushed',
  'coal',
  'tether',
  'weight',
];

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

function timed(kind: FinalAlertKind, title: string, mark: AlertAura): FinalAlertLive {
  const left = Math.max(0, mark.remaining ?? 0);
  const total = Math.max(1e-6, mark.duration ?? 1);
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

export function buildFinalAlertView(input: FinalAlertInput): FinalAlertView {
  if (input.dead) return HIDDEN;
  const a = input.auras;
  const coal = auraOf(a, FINAL_PHASE_AURAS.coal);
  if (coal) return timed('coal', t('hudChrome.finalAlert.coalTitle'), coal);
  const tether = auraOf(a, FINAL_PHASE_AURAS.tether);
  if (tether) return timed('tether', t('hudChrome.finalAlert.tetherTitle'), tether);
  const blade = auraOf(a, FINAL_AURAS.bladeMark);
  if (blade) {
    const locked = (blade.value ?? 1) >= 2;
    return timed(
      locked ? 'bladeLocked' : 'blade',
      t(locked ? 'hudChrome.finalAlert.bladeLockedTitle' : 'hudChrome.finalAlert.bladeTitle'),
      blade,
    );
  }
  const sky = auraOf(a, FINAL_AURAS.skyMark);
  if (sky) return timed('sky', t('hudChrome.finalAlert.skyTitle'), sky);
  const ember = auraOf(a, FINAL_AURAS.ember);
  if (ember) return timed('ember', t('hudChrome.finalAlert.emberTitle'), ember);
  const drawn = auraOf(a, FINAL_AURAS.drawn);
  if (drawn) return timed('drawn', t('hudChrome.finalAlert.drawnTitle'), drawn);
  const crushed = auraOf(a, FINAL_AURAS.crushed);
  if (crushed) return timed('crushed', t('hudChrome.finalAlert.crushedTitle'), crushed);
  const weight = auraOf(a, MOUNTING_WEIGHT_AURA);
  const stacks = Math.round(weight?.stacks ?? 0);
  if (weight && stacks >= P.weightSwap - 1)
    return timed(
      'weight',
      t('hudChrome.finalAlert.weightTitle', {
        stacks: formatNumber(stacks, { maximumFractionDigits: 0 }),
      }),
      weight,
    );
  return HIDDEN;
}
