// The Drowned Temple's encounter alert: the pure, DOM-free view core. It
// teaches Choirmother Selthe's Score (sim: encounters/drowned_temple/
// selthe_score.ts) off the bodies the sim already mirrors: her two bars, her
// ward and her broken-voice aura, and the five moon tiles (a tile's template id
// is its state and its place in the melody).
//  - the melody: watch the tiles ring, then step onto them in that order (on
//    heroic, remember the order: the tiles go dark);
//  - the answer: which tile comes next and how many are sounded (on heroic
//    only the count: the order is the group's to remember);
//  - standing on the tile the answer wants: step off and back on (a step is
//    the way IN, so a body already on the tile has not stepped it);
//  - a False Note: that tile was out of turn, the answer starts over;
//  - her voice is broken: the damage window is open.
// Every bar is the clock the sim runs (her bar, or her aura's time left).
// Priority: personal Spent Voice over a false note over the step-off hint over the
// answer over the melody over the window. The painter is the shared encounter
// alert's (encounter_alert_painter.ts); every decision is here.

import {
  moonTileOf,
  SELTHE_BROKEN_VOICE_EXPOSED,
  SELTHE_SCORE,
  SELTHE_SCORE_ANSWER,
  SELTHE_SCORE_WARD,
  SELTHE_SPENT_VOICE,
  SELTHE_TUNING,
} from '../../../sim/encounters/drowned_temple/ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type TempleAlertKind =
  | 'score-spent'
  | 'score-false'
  | 'score-step-off'
  | 'score-answer'
  | 'score-answer-dark'
  | 'score-melody'
  | 'score-broken';

/** Every kind class the painter toggles (the CSS keys on them). */
export const TEMPLE_ALERT_KINDS: readonly TempleAlertKind[] = [
  'score-spent',
  'score-false',
  'score-step-off',
  'score-answer',
  'score-answer-dark',
  'score-melody',
  'score-broken',
];

export type TempleAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: TempleAlertKind };
export type TempleAlertView = TempleAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

interface AlertAura {
  id: string;
  remaining?: number;
  duration?: number;
  value2?: number;
  stacks?: number;
}

export interface TempleAlertEntity {
  templateId?: string;
  dead?: boolean;
  auras?: readonly AlertAura[];
  pos?: { x: number; z: number };
  castingAbility?: string | null;
  castRemaining?: number;
  castTotal?: number;
}

/** The bodies of Selthe's Score (TempleAlertSceneScan keeps them). */
export interface TempleAlertScene {
  selthe: TempleAlertEntity | null;
  tiles: readonly TempleAlertEntity[];
}

export const EMPTY_TEMPLE_SCENE: TempleAlertScene = { selthe: null, tiles: [] };

export interface TempleAlertInput {
  /** The local player (the tile they stand on). */
  selfPos?: { x: number; z: number };
  auras?: readonly AlertAura[];
  scene?: TempleAlertScene;
}

function auraOf(auras: readonly AlertAura[] | undefined, id: string): AlertAura | null {
  if (!auras) return null;
  for (const a of auras) if (a.id === id) return a;
  return null;
}

function count(n: number): string {
  return formatNumber(Math.max(0, Math.round(n)), { maximumFractionDigits: 0 });
}

function alert(
  kind: TempleAlertKind,
  title: string,
  line: string,
  left: number,
  total: number,
): TempleAlertLive {
  const seconds = count(Math.ceil(Math.max(0, left)));
  return {
    visible: true,
    kind,
    title,
    line,
    hint: '',
    key: '',
    progress: total > 0 ? Math.max(0, Math.min(1, left / total)) : null,
    progressAria: total > 0 ? t('hudChrome.templeAlert.timeAria', { seconds }) : '',
    pressable: false,
    buttonAria: title,
  };
}

export function buildTempleAlertView(input: TempleAlertInput): TempleAlertView {
  const scene = input.scene ?? EMPTY_TEMPLE_SCENE;
  const selthe = scene.selthe && !scene.selthe.dead ? scene.selthe : null;
  if (!selthe) return HIDDEN;
  const left = selthe.castRemaining ?? 0;
  const total = selthe.castTotal ?? 0;
  const ward = auraOf(selthe.auras, SELTHE_SCORE_WARD);
  // The tiles go dark for the answer (heroic): the ward says so.
  const dark = ward?.value2 === 1;
  if (selthe.castingAbility === SELTHE_SCORE_ANSWER) {
    let done = 0;
    let nextPlace = 0;
    let sour = false;
    let onNext = false;
    for (const tile of scene.tiles) {
      const look = tile.templateId ? moonTileOf(tile.templateId) : null;
      if (!look) continue;
      if (look.state === 'done') done++;
      else if (look.state === 'sour') sour = true;
      else if (look.state === 'next') {
        nextPlace = look.place;
        const me = input.selfPos;
        // The sim's own rim (onMoonTile's leave rim: a body this close has
        // not left the tile, so walking in again from here is no step).
        if (me && tile.pos)
          onNext =
            Math.hypot(me.x - tile.pos.x, me.z - tile.pos.z) <=
            SELTHE_TUNING.scoreTileRadius + SELTHE_TUNING.scoreTileLeave;
      }
    }
    const notes = ward?.stacks ?? 0;
    const values = { done: count(done), total: count(notes), place: count(nextPlace) };
    if (auraOf(input.auras, SELTHE_SPENT_VOICE))
      return alert(
        'score-spent',
        t('hudChrome.templeAlert.spentTitle'),
        t('hudChrome.templeAlert.spentLine', values),
        left,
        total,
      );
    if (sour)
      return alert(
        'score-false',
        t('hudChrome.templeAlert.falseTitle'),
        t('hudChrome.templeAlert.falseLine'),
        left,
        total,
      );
    if (onNext)
      return alert(
        'score-step-off',
        t('hudChrome.templeAlert.stepOffTitle'),
        t('hudChrome.templeAlert.stepOffLine'),
        left,
        total,
      );
    if (dark || nextPlace === 0)
      return alert(
        'score-answer-dark',
        t('hudChrome.templeAlert.answerTitle'),
        t('hudChrome.templeAlert.answerDarkLine', values),
        left,
        total,
      );
    return alert(
      'score-answer',
      t('hudChrome.templeAlert.answerTitle'),
      t('hudChrome.templeAlert.answerLine', values),
      left,
      total,
    );
  }
  if (selthe.castingAbility === SELTHE_SCORE)
    return alert(
      'score-melody',
      t('hudChrome.templeAlert.melodyTitle'),
      dark ? t('hudChrome.templeAlert.melodyDarkLine') : t('hudChrome.templeAlert.melodyLine'),
      left,
      total,
    );
  const broken = auraOf(selthe.auras, SELTHE_BROKEN_VOICE_EXPOSED);
  if (broken)
    return alert(
      'score-broken',
      t('hudChrome.templeAlert.brokenTitle'),
      t('hudChrome.templeAlert.brokenLine', {
        pct: count(SELTHE_TUNING.brokenVuln * 100),
      }),
      broken.remaining ?? 0,
      broken.duration ?? 0,
    );
  return HIDDEN;
}
