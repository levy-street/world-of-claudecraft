// Pure view core for Tibbs' shift offer (the Graveyard Shift's way in, see
// src/sim/graveyard_shift/grave_entry.ts): which lines he says and the two
// choices. A first meeting is his whole pitch; a character that has already
// covered a shift (the Boss for a Day deed earned) gets his short re-offer.
// The quest dialog controller paints it; the accept choice is the sim's
// targeted interact on Tibbs, the decline is client side.
import { BOSS_FOR_A_DAY_DEED_ID, TIBBS_NPC_ID } from '../../../sim/graveyard_shift/grave_entry';
import type { Entity } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { type TranslationKey, t } from '../../i18n';

const FIRST_MEETING: readonly TranslationKey[] = [
  'devCommand.graveyardShift.tibbs.offer.intro1',
  'devCommand.graveyardShift.tibbs.offer.intro2',
  'devCommand.graveyardShift.tibbs.offer.intro3',
  'devCommand.graveyardShift.tibbs.offer.intro4',
];
const RETURNING: readonly TranslationKey[] = ['devCommand.graveyardShift.tibbs.offer.returning'];

export interface TibbsOfferView {
  readonly lines: readonly string[];
  readonly acceptLabel: string;
  readonly declineLabel: string;
}

export function isTibbs(npc: Pick<Entity, 'kind' | 'templateId'>): boolean {
  return npc.kind === 'npc' && npc.templateId === TIBBS_NPC_ID;
}

/** Tibbs' offer for this character, or null for any other NPC. */
export function tibbsOfferDialog(
  world: Pick<IWorld, 'deedsEarned'>,
  npc: Pick<Entity, 'kind' | 'templateId'>,
): TibbsOfferView | null {
  if (!isTibbs(npc)) return null;
  const keys = world.deedsEarned.has(BOSS_FOR_A_DAY_DEED_ID) ? RETURNING : FIRST_MEETING;
  return {
    lines: keys.map((key) => t(key)),
    acceptLabel: t('devCommand.graveyardShift.tibbs.offer.accept'),
    declineLabel: t('devCommand.graveyardShift.tibbs.offer.decline'),
  };
}

/** Tibbs' answer to a declined offer. */
export function tibbsDeclineLine(): string {
  return t('devCommand.graveyardShift.tibbs.say.decline');
}
