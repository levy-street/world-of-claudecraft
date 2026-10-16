// The Great Saurian's part of the Wildheart Basin alert (wildheart_alert_view.ts
// calls it): what its totem rework asks of the local player right now, read
// off what the sim mirrors (encounters/wildheart_basin: its Earthshaking Stomp
// bar, the Sunbone Sap Totems standing in the ford with their own bars, the
// Howdah Drum aura on the Saurian). Pure and DOM-free; it returns the kind,
// the title, the line and the bar, and the Basin view dresses them.
//
// Priority: standing inside the Stomp's ring while its bar runs; a Sap Totem
// standing (the bar is the totem nearest its next mending); and, on heroic,
// the drum's rule while the player targets the Saurian and no totem stands.

import {
  GREAT_SAURIAN_ID,
  SAURIAN_SAP_TETHER,
  SAURIAN_STOMP,
  SAURIAN_WAR_DRUM,
  SAURIAN_TUNING as T,
} from '../../../sim/encounters/wildheart_basin/ids';
import { formatNumber, t } from '../../i18n';

export type SaurianAlertKind = 'saurian-stomp' | 'sap-totem' | 'drum';

export const SAURIAN_ALERT_KINDS: readonly SaurianAlertKind[] = [
  'saurian-stomp',
  'sap-totem',
  'drum',
];

/** Extra yards past the Stomp's ring a warning still fires at. */
const RING_MARGIN = 1;

interface SaurianAlertAura {
  id: string;
}

/** A body the Saurian's alert reads (the Saurian, a Sap Totem). */
export interface SaurianAlertEntity {
  id?: number;
  templateId?: string;
  dead?: boolean;
  hp?: number;
  pos?: { x: number; z: number };
  auras?: readonly SaurianAlertAura[];
  castingAbility?: string | null;
  castRemaining?: number;
  castTotal?: number;
}

export interface SaurianAlertScene {
  saurian: SaurianAlertEntity | null;
  /** The Sunbone Sap Totems in view (living or fallen). */
  sapTotems: readonly SaurianAlertEntity[];
}

/** What the Saurian asks, before the Basin view dresses it. */
export interface SaurianAlert {
  kind: SaurianAlertKind;
  title: string;
  line: string;
  /** 0 to 1 (what is left of the bar), or null for no bar. */
  progress: number | null;
  seconds: number | null;
}

function left(e: SaurianAlertEntity): number | null {
  if (!e.castTotal || e.castTotal <= 0 || e.castRemaining === undefined) return null;
  return Math.max(0, Math.min(1, e.castRemaining / e.castTotal));
}

/** The Saurian's alert for a player standing at `me` (their target's
 *  template, to gate the drum's readout), or null. */
export function buildSaurianAlert(
  scene: SaurianAlertScene,
  me: { x: number; z: number } | undefined,
  targetTemplateId: string | undefined,
): SaurianAlert | null {
  const saurian = scene.saurian && !scene.saurian.dead ? scene.saurian : null;
  if (!saurian) return null;
  if (
    me &&
    saurian.pos &&
    saurian.castingAbility === SAURIAN_STOMP &&
    Math.hypot(me.x - saurian.pos.x, me.z - saurian.pos.z) <= T.stompRadius + RING_MARGIN
  )
    return {
      kind: 'saurian-stomp',
      title: t('hudChrome.wildheartAlert.saurianStompTitle'),
      line: t('hudChrome.wildheartAlert.saurianStompLine'),
      progress: left(saurian),
      seconds: saurian.castRemaining ?? null,
    };
  // The totems standing, and the one nearest its next mending.
  let count = 0;
  let next: SaurianAlertEntity | null = null;
  for (const totem of scene.sapTotems) {
    if (totem.dead || (totem.hp ?? 1) <= 0) continue;
    count++;
    if (totem.castingAbility !== SAURIAN_SAP_TETHER) continue;
    if (!next || (totem.castRemaining ?? 0) < (next.castRemaining ?? 0)) next = totem;
  }
  if (count > 0)
    return {
      kind: 'sap-totem',
      title: t('hudChrome.wildheartAlert.sapTotemTitle'),
      line: t('hudChrome.wildheartAlert.sapTotemLine', {
        seconds: formatNumber(T.totemHealEvery, { maximumFractionDigits: 1 }),
        count: formatNumber(count, { maximumFractionDigits: 0 }),
      }),
      progress: next ? left(next) : null,
      seconds: next?.castRemaining ?? null,
    };
  if (
    targetTemplateId === GREAT_SAURIAN_ID &&
    saurian.auras?.some((a) => a.id === SAURIAN_WAR_DRUM)
  )
    return {
      kind: 'drum',
      title: t('hudChrome.wildheartAlert.drumTitle'),
      line: t('hudChrome.wildheartAlert.drumLine', {
        seconds: formatNumber(T.drumSilence, { maximumFractionDigits: 1 }),
      }),
      progress: null,
      seconds: null,
    };
  return null;
}
