// The Guardian of the Breath's Knotted Gale alert (Mythic,
// encounters/smith_heart/breath_heart.ts): the pure, DOM-free view core of the
// part the fight gives the local player, read off the auras the sim mirrors:
//  - Portal A / Portal B: the bar is the time until the portal opens at your
//    feet, so stand where it belongs now;
//  - Gale-Laden: the bar is the ball's fuse; the panel is the throw's button,
//    and it says so louder at the lip of a gap.
// An ACTION prompt (the hints setting never hides it), on every graphics tier.
// The painter is the shared encounter alert's (encounter_alert_painter.ts).

import { SMITH_HEART_DUNGEON } from '../../../sim/content/smith_heart';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../../sim/data';
import { atGapLip } from '../../../sim/encounters/smith_heart/breath_geometry';
import { BREATH_AURAS } from '../../../sim/encounters/smith_heart/breath_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type KnotAlertKind = 'portalA' | 'portalB' | 'carry' | 'lip';

/** Every kind class the painter toggles (the CSS keys on them). */
export const KNOT_ALERT_KINDS: readonly KnotAlertKind[] = ['portalA', 'portalB', 'carry', 'lip'];

export type KnotAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: KnotAlertKind };
export type KnotAlertView = KnotAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

interface AlertAura {
  id: string;
  remaining?: number;
  duration?: number;
}

export interface KnotAlertInput {
  auras: readonly AlertAura[];
  pos: { x: number; z: number };
  dead?: boolean;
  interactKey: string;
  touch: boolean;
}

const whole = (v: number) => formatNumber(Math.max(0, Math.ceil(v)), { maximumFractionDigits: 0 });

/** Is the world spot at the lip of a gap of its claim's Cornice? */
function worldAtLip(pos: { x: number; z: number }): boolean {
  const def = DUNGEONS[SMITH_HEART_DUNGEON];
  if (!def) return false;
  const o = instanceOrigin(def.index, instanceSlotForZ(pos.z));
  return atGapLip(pos.x - o.x, pos.z - o.z);
}

export function buildKnotAlertView(input: KnotAlertInput): KnotAlertView {
  if (input.dead) return HIDDEN;
  let mark: AlertAura | null = null;
  let kind: KnotAlertKind = 'carry';
  for (const a of input.auras) {
    if (a.id === BREATH_AURAS.laden) {
      mark = a;
      kind = 'carry';
      break;
    }
    if (a.id === BREATH_AURAS.portalA) {
      mark = a;
      kind = 'portalA';
    } else if (a.id === BREATH_AURAS.portalB) {
      mark = a;
      kind = 'portalB';
    }
  }
  if (!mark) return HIDDEN;
  const left = Math.max(0, mark.remaining ?? 0);
  const total = Math.max(1e-6, mark.duration ?? 1);
  const seconds = whole(left);
  const base = {
    visible: true as const,
    progress: Math.max(0, Math.min(1, left / total)),
    progressAria: t('hudChrome.quenchAlert.timeAria', { seconds }),
    barLabel: '',
  };
  if (kind === 'portalA' || kind === 'portalB') {
    const title = t(
      kind === 'portalA' ? 'hudChrome.knotAlert.aTitle' : 'hudChrome.knotAlert.bTitle',
    );
    return {
      ...base,
      kind,
      title,
      line: t(kind === 'portalA' ? 'hudChrome.knotAlert.aLine' : 'hudChrome.knotAlert.bLine', {
        seconds,
      }),
      hint: '',
      key: '',
      pressable: false,
      buttonAria: title,
    };
  }
  const lip = worldAtLip(input.pos);
  const key = input.touch ? '' : input.interactKey;
  const title = t(lip ? 'hudChrome.knotAlert.lipTitle' : 'hudChrome.knotAlert.carryTitle');
  return {
    ...base,
    kind: lip ? 'lip' : 'carry',
    title,
    line: t(lip ? 'hudChrome.knotAlert.lipLine' : 'hudChrome.knotAlert.carryLine', { seconds }),
    hint: input.touch
      ? t('hudChrome.knotAlert.throwTap')
      : key
        ? t('hudChrome.knotAlert.throwKey', { key })
        : t('hudChrome.knotAlert.throwClick'),
    key,
    pressable: true,
    buttonAria: t('hudChrome.knotAlert.throwAria'),
  };
}
