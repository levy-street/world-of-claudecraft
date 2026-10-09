// The Wildheart Basin's encounter alert: the pure, DOM-free view core. It tells
// the local player what a Basin mechanic asks of them, read off the auras and
// entities the sim already mirrors (encounters/wildheart_basin):
//  - marked as Zulgar's Prey (the jade claw): run him through the lit sun
//    glyphs; on heroic Twin Prey the line says whether he is chasing you now;
//  - Stalked by the Fanglord's Great Jaguar (the fang mark): kite it away from
//    its master;
//  - Pollinated by the Gorgebloom: stay off the seeds;
//  - targeting the Beastmaster or his jaguar while Pack Bond holds: pull them
//    apart.
// Every bar is the mark's own time left. Priority: the Prey over the Stalk
// over the pollen over the bond readout. The painter is the shared encounter
// alert's (encounter_alert_painter.ts); every decision is here.

import {
  BEAST_PACK_BOND,
  BEAST_STALKED,
  BEASTMASTER_ID,
  BLOOM_POLLINATED,
  FANGLORD_JAGUAR_ID,
  ZULGAR_PREY,
} from '../../../sim/encounters/wildheart_basin/ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type WildheartAlertKind = 'prey' | 'prey-wait' | 'stalked' | 'pollinated' | 'bonded';

/** Every kind class the painter toggles (the CSS keys on them). */
export const WILDHEART_ALERT_KINDS: readonly WildheartAlertKind[] = [
  'prey',
  'prey-wait',
  'stalked',
  'pollinated',
  'bonded',
];

export type WildheartAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: WildheartAlertKind };
export type WildheartAlertView = WildheartAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

interface AlertAura {
  id: string;
  remaining?: number;
  duration?: number;
  value2?: number;
}

export interface WildheartAlertEntity {
  templateId?: string;
  dead?: boolean;
  auras?: readonly AlertAura[];
}

export interface WildheartAlertInput {
  auras: readonly AlertAura[];
  targetId: number | null | undefined;
  entity: (id: number) => WildheartAlertEntity | null | undefined;
}

function auraOf(auras: readonly AlertAura[] | undefined, id: string): AlertAura | null {
  if (!auras) return null;
  for (const a of auras) if (a.id === id) return a;
  return null;
}

function timeLeft(a: AlertAura): number {
  if (!a.duration || a.duration <= 0 || a.remaining === undefined) return 0;
  return Math.max(0, Math.min(1, a.remaining / a.duration));
}

function seconds(a: AlertAura): string {
  return formatNumber(Math.max(0, Math.ceil(a.remaining ?? 0)), { maximumFractionDigits: 0 });
}

function live(
  kind: WildheartAlertKind,
  title: string,
  line: string,
  mark: AlertAura | null,
): WildheartAlertLive {
  const progress = mark ? timeLeft(mark) : null;
  return {
    visible: true,
    kind,
    title,
    line,
    hint: '',
    key: '',
    progress,
    progressAria: mark ? t('hudChrome.wildheartAlert.timeAria', { seconds: seconds(mark) }) : '',
    pressable: false,
    buttonAria: title,
  };
}

export function buildWildheartAlertView(input: WildheartAlertInput): WildheartAlertView {
  const prey = auraOf(input.auras, ZULGAR_PREY);
  if (prey) {
    // value2 1 = he is chasing THIS prey now (always on normal's lone mark).
    const chased = prey.value2 !== 0;
    return live(
      chased ? 'prey' : 'prey-wait',
      t('hudChrome.wildheartAlert.preyTitle'),
      chased ? t('hudChrome.wildheartAlert.preyLine') : t('hudChrome.wildheartAlert.preyWaitLine'),
      prey,
    );
  }
  const stalked = auraOf(input.auras, BEAST_STALKED);
  if (stalked)
    return live(
      'stalked',
      t('hudChrome.wildheartAlert.stalkedTitle'),
      t('hudChrome.wildheartAlert.stalkedLine'),
      stalked,
    );
  const pollen = auraOf(input.auras, BLOOM_POLLINATED);
  if (pollen)
    return live(
      'pollinated',
      t('hudChrome.wildheartAlert.pollinatedTitle'),
      t('hudChrome.wildheartAlert.pollinatedLine'),
      pollen,
    );
  if (input.targetId !== null && input.targetId !== undefined) {
    const target = input.entity(input.targetId);
    const pair = target?.templateId === BEASTMASTER_ID || target?.templateId === FANGLORD_JAGUAR_ID;
    if (target && !target.dead && pair && auraOf(target.auras, BEAST_PACK_BOND))
      return live(
        'bonded',
        t('hudChrome.wildheartAlert.bondTitle'),
        t('hudChrome.wildheartAlert.bondLine'),
        null,
      );
  }
  return HIDDEN;
}
