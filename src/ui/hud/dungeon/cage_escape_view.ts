// The Iron Cage escape prompt: the pure, DOM-free view core. When the local
// player is locked in the Gaol Turnkey's Iron Cage (the Caged aura, whose
// sourceId names the cage), it turns the cage's health into the escape
// progress (the same number the sim resolves: sim/encounters/sunken_bastion
// cageEscapeProgress), and picks the prompt line: the interact key's label on
// a keyboard, a tap line on touch, and a click line when interact is unbound
// (the whole panel is a button, so clicking it is the escape control then).
// The painter (cage_escape_painter.ts) only paints; every decision is here.

import { cageEscapeProgress, TURNKEY_CAGED } from '../../../sim/encounters/sunken_bastion/ids';
import { formatNumber, t } from '../../i18n';

export interface CageEscapeLive {
  visible: true;
  /** 0 locked to 1 broken out. */
  progress: number;
  title: string;
  prompt: string;
  /** The key the prompt names ('' on touch or when unbound). */
  key: string;
  buttonAria: string;
  progressAria: string;
}

export interface CageEscapeHidden {
  visible: false;
}

export type CageEscapeView = CageEscapeLive | CageEscapeHidden;

const HIDDEN: CageEscapeHidden = { visible: false };

export interface CageEscapeInput {
  auras: readonly { id: string; sourceId?: number }[];
  /** The cage body's health, looked up by the Caged aura's sourceId. */
  cage: (id: number) => { hp: number; maxHp: number } | null | undefined;
  /** The interact key's label ('' when unbound). */
  interactKey: string;
  touch: boolean;
}

export function buildCageEscapeView(input: CageEscapeInput): CageEscapeView {
  let cageId = -1;
  for (const a of input.auras) {
    if (a.id === TURNKEY_CAGED) {
      cageId = a.sourceId ?? -1;
      break;
    }
  }
  if (cageId < 0) return HIDDEN;
  const cage = input.cage(cageId);
  const progress = cage ? cageEscapeProgress(cage.hp, cage.maxHp) : 0;
  const key = input.touch ? '' : input.interactKey;
  const prompt = input.touch
    ? t('hudChrome.bastionCage.promptTap')
    : key
      ? t('hudChrome.bastionCage.promptKey', { key })
      : t('hudChrome.bastionCage.promptClick');
  return {
    visible: true,
    progress,
    title: t('hudChrome.bastionCage.title'),
    prompt,
    key,
    buttonAria: t('hudChrome.bastionCage.buttonAria'),
    progressAria: t('hudChrome.bastionCage.progressAria', {
      pct: formatNumber(progress, { style: 'percent', maximumFractionDigits: 0 }),
    }),
  };
}
