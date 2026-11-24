// The Smith's Heart's Live Coal chip: the pure, DOM-free view core of the
// bearer's own small readout (the Guardian of the Heat's Live Coal, Heroic and
// Mythic; encounters/smith_heart/heat_coal.ts). Jose's rule of 2026-11-24 keeps
// on-screen warnings minimal: the coal reads in the world for everyone (the
// arrow over its bearer and the leap ring at their feet, render
// smith_heart_fx/heat_coal_fx.ts), and only its bearer gets this, calm and
// small beside the action bar, mirroring the tank swap chip on the other side.
//
//  - Shown: the local player carries the coal. The title names it, the number
//    under the thin bar is the healing it still absorbs (the aura's `value`),
//    the bar the fuse left (`remaining` of `duration`).
//  - Hidden otherwise, and while dead.
// An ACTION readout (who must be healed and keep apart): the hints setting
// never hides it, every graphics tier paints it. The painter is the shared
// encounter alert's.

import { HEAT_AURAS } from '../../../sim/encounters/smith_heart/heat_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type CoalAlertKind = 'coal';

/** Every kind class the painter toggles (the CSS keys on them). */
export const COAL_ALERT_KINDS: readonly CoalAlertKind[] = ['coal'];

export type CoalAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: CoalAlertKind };
export type CoalAlertView = CoalAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

export interface CoalAlertAura {
  id: string;
  value?: number;
  remaining?: number;
  duration?: number;
}

export interface CoalAlertInput {
  auras: readonly CoalAlertAura[];
  dead?: boolean;
}

const whole = (v: number) => formatNumber(Math.max(0, Math.ceil(v)), { maximumFractionDigits: 0 });

export function buildCoalAlertView(input: CoalAlertInput): CoalAlertView {
  if (input.dead) return HIDDEN;
  const coal = input.auras.find((a) => a.id === HEAT_AURAS.coal);
  if (!coal) return HIDDEN;
  const left = Math.max(0, coal.remaining ?? 0);
  const total = Math.max(1e-6, coal.duration ?? left);
  const title = t('hudChrome.liveCoal.title');
  return {
    visible: true,
    kind: 'coal',
    title,
    line: '',
    hint: '',
    key: '',
    progress: Math.max(0, Math.min(1, left / total)),
    progressAria: t('hudChrome.liveCoal.fuseAria', { seconds: whole(left) }),
    barLabel: t('hudChrome.liveCoal.absorb', { absorb: whole(Math.max(0, coal.value ?? 0)) }),
    pressable: false,
    buttonAria: title,
  };
}
