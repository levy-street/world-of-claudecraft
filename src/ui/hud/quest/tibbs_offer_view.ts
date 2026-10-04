// Pure view core for Tibbs' shift offer (the Graveyard Shift's way in, see
// src/sim/graveyard_shift/grave_entry.ts): which lines he says and the two
// choices: his whole pitch, or, once the shift is won (it can be won once;
// he stands for his report a while after), a closing line and no offer. The
// quest dialog controller paints it; the accept choice is the sim's
// targeted interact on Tibbs, the decline is client side.
import { BOSS_FOR_A_DAY_DEED_ID, TIBBS_NPC_ID } from '../../../sim/graveyard_shift/grave_entry';
import type { Entity } from '../../../sim/types';
import { type TranslationKey, t } from '../../i18n';

const FIRST_MEETING: readonly TranslationKey[] = [
  'devCommand.graveyardShift.tibbs.offer.intro1',
  'devCommand.graveyardShift.tibbs.offer.intro2',
  'devCommand.graveyardShift.tibbs.offer.intro3',
  'devCommand.graveyardShift.tibbs.offer.intro4',
];

export interface TibbsOfferView {
  readonly lines: readonly string[];
  /** Null once the shift is won: there is nothing left to offer. */
  readonly acceptLabel: string | null;
  readonly declineLabel: string;
}

export function isTibbs(npc: Pick<Entity, 'kind' | 'templateId'>): boolean {
  return npc.kind === 'npc' && npc.templateId === TIBBS_NPC_ID;
}

/** Tibbs' offer for this character, or null for any other NPC. */
export function tibbsOfferDialog(
  npc: Pick<Entity, 'kind' | 'templateId'>,
  deedsEarned: { has(id: string): boolean },
): TibbsOfferView | null {
  if (!isTibbs(npc)) return null;
  if (deedsEarned.has(BOSS_FOR_A_DAY_DEED_ID)) {
    return {
      lines: [t('devCommand.graveyardShift.tibbs.say.covered')],
      acceptLabel: null,
      declineLabel: t('questUi.dialog.continue'),
    };
  }
  return {
    lines: FIRST_MEETING.map((key) => t(key)),
    acceptLabel: t('devCommand.graveyardShift.tibbs.offer.accept'),
    declineLabel: t('devCommand.graveyardShift.tibbs.offer.decline'),
  };
}

/** Tibbs' answer to a declined offer. */
export function tibbsDeclineLine(): string {
  return t('devCommand.graveyardShift.tibbs.say.decline');
}
