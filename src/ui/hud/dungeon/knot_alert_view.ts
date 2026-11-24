// The Guardian of the Breath's Knotted Gale alert (Heroic and Mythic,
// encounters/smith_heart/breath_heart.ts): the pure, DOM-free view core of the
// part the fight gives the local player, read off the auras the sim mirrors.
// A short title over a bar and its seconds, and no sentence under it (the
// owner's rule of 2026-11-03, kept again on 2026-11-09: where each portal
// belongs and how the Gale is thrown live in the aura tooltips and the boss
// journal):
//  - Portal A / Portal B (and phase 2's second pair, Portal C / Portal D): the
//    bar is the time until the portal opens at your feet; each letter its own
//    kind, so its own colour;
//  - Gale-Laden: the bar is the ball's fuse; the panel is the throw's button,
//    so its one hint is the key (or the tap) that throws, and its title says
//    so louder at the lip of a gap (a portal is a shortcut, never needed:
//    Jose's call of 2026-11-08).
//  - under the Gale's marks, a Bellows Blow under way that will throw its
//    tank off the Cornice (Heroic's lethal fifth blow, breath_blow.ts), the
//    bar the cast's time. The swap itself (Wind-Battered, Thunder-Laden at the
//    tier's count) is the raid's shared tank swap alert since 2026-11-24
//    (tank_swap_alert_view.ts): the ruin stays here, a different and lethal
//    call (the tank is about to die, not to hand over).
// An ACTION prompt (the hints setting never hides it), on every graphics tier.
// The painter is the shared encounter alert's (encounter_alert_painter.ts).

import { SMITH_HEART_DUNGEON } from '../../../sim/content/smith_heart';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../../sim/data';
import { atGapLip } from '../../../sim/encounters/smith_heart/breath_geometry';
import { BREATH_AURAS } from '../../../sim/encounters/smith_heart/breath_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

type PortalKind = 'portalA' | 'portalB' | 'portalC' | 'portalD';
export type KnotAlertKind = PortalKind | 'carry' | 'lip' | 'ruin';

/** Every kind class the painter toggles (the CSS keys on them). */
export const KNOT_ALERT_KINDS: readonly KnotAlertKind[] = [
  'portalA',
  'portalB',
  'portalC',
  'portalD',
  'carry',
  'lip',
  'ruin',
];

/** Each mark's aura, its kind and its title key. */
const PORTAL_MARKS: readonly {
  aura: string;
  kind: PortalKind;
  title:
    | 'hudChrome.knotAlert.aTitle'
    | 'hudChrome.knotAlert.bTitle'
    | 'hudChrome.knotAlert.cTitle'
    | 'hudChrome.knotAlert.dTitle';
}[] = [
  {
    aura: BREATH_AURAS.portalA,
    kind: 'portalA',
    title: 'hudChrome.knotAlert.aTitle',
  },
  {
    aura: BREATH_AURAS.portalB,
    kind: 'portalB',
    title: 'hudChrome.knotAlert.bTitle',
  },
  {
    aura: BREATH_AURAS.portalC,
    kind: 'portalC',
    title: 'hudChrome.knotAlert.cTitle',
  },
  {
    aura: BREATH_AURAS.portalD,
    kind: 'portalD',
    title: 'hudChrome.knotAlert.dTitle',
  },
];

export type KnotAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: KnotAlertKind };
export type KnotAlertView = KnotAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

interface AlertAura {
  id: string;
  remaining?: number;
  duration?: number;
  value2?: number;
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
  let portal: (typeof PORTAL_MARKS)[number] | null = null;
  for (const a of input.auras) {
    if (a.id === BREATH_AURAS.laden) {
      mark = a;
      portal = null;
      break;
    }
    const m = PORTAL_MARKS.find((x) => x.aura === a.id);
    if (m) {
      mark = a;
      portal = m;
    }
  }
  if (!mark) return ruinView(input.auras);
  const left = Math.max(0, mark.remaining ?? 0);
  const total = Math.max(1e-6, mark.duration ?? 1);
  const seconds = whole(left);
  const base = {
    visible: true as const,
    progress: Math.max(0, Math.min(1, left / total)),
    progressAria: t('hudChrome.quenchAlert.timeAria', { seconds }),
    barLabel: t('hudChrome.quenchAlert.secondsBar', { seconds }),
    line: '',
  };
  if (portal) {
    const title = t(portal.title);
    return {
      ...base,
      kind: portal.kind,
      title,
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

/** A timed panel: its title, the bar its aura's time left. */
function timedPanel(kind: KnotAlertKind, title: string, a: AlertAura): KnotAlertLive {
  const left = Math.max(0, a.remaining ?? 0);
  const total = Math.max(1e-6, a.duration ?? 1);
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

/** The ruinous Bellows Blow's panel (breath_blow.ts), else nothing. */
function ruinView(auras: readonly AlertAura[]): KnotAlertView {
  for (const a of auras) {
    if (a.id === BREATH_AURAS.blowMark && (a.value2 ?? 0) > 0)
      return timedPanel('ruin', t('hudChrome.knotAlert.ruinTitle'), a);
  }
  return HIDDEN;
}
