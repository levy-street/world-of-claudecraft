// Pure view core for Tibbs' shift offer (the Graveyard Shift's way in, see
// src/sim/graveyard_shift/grave_entry.ts): which lines he says and the two
// choices: his whole pitch every time (the shift can be won once, so nobody
// meets him after a win). The quest dialog controller paints it; the accept choice is the sim's
// targeted interact on Tibbs, the decline is client side.
import { TIBBS_NPC_ID } from '../../../sim/graveyard_shift/grave_entry';
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
  readonly acceptLabel: string;
  readonly declineLabel: string;
}

export function isTibbs(npc: Pick<Entity, 'kind' | 'templateId'>): boolean {
  return npc.kind === 'npc' && npc.templateId === TIBBS_NPC_ID;
}

/** Tibbs' offer for this character, or null for any other NPC. */
export function tibbsOfferDialog(npc: Pick<Entity, 'kind' | 'templateId'>): TibbsOfferView | null {
  if (!isTibbs(npc)) return null;
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
