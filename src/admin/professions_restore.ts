// Pure builders for the R35 GM professions restores, the moderation_actions.ts
// pattern: each returns a PendingAction (title + summary rows + endpoint +
// body for the confirm prompt) or an errorKey to surface, side-effect-free so
// a Vitest asserts endpoint/body/validation directly; the component performs
// the apiPost after the operator confirms. The server re-validates everything
// fail-closed (content vocabularies live with the sim, not here), so these
// checks exist only to catch operator slips before the audit row is written.

import { fmtNumber } from './format';
import { t } from './i18n';
import type { Built } from './moderation_actions';

/** Client mirror of the server's dev_give clamp (RESTORE_ITEM_MAX_COUNT in
 *  server/character_professions.ts); the server refuses past it regardless. */
export const RESTORE_ITEM_MAX_COUNT = 20;

/** The "<id> x<count>" confirm-row value. The multiplier is typography a
 *  locale may render differently, and the count goes through the admin number
 *  formatter, so both the builder row and the live modal row read it here. */
export function restoreItemSummary(itemId: string, count: number): string {
  return t('profInspect.restoreSummary', { id: itemId, count: fmtNumber(count) });
}

export function restoreItem(
  characterId: number,
  characterName: string,
  itemId: string,
  count: number,
  note: string,
): Built {
  // Trimmed, matching the server's cleanText refusal, so a whitespace-only
  // note refuses locally instead of round-tripping to a 400.
  if (!note.trim()) return { errorKey: 'alert.noteRequired' };
  const id = itemId.trim();
  if (!id) return { errorKey: 'alert.itemIdRequired' };
  if (!Number.isInteger(count) || count < 1 || count > RESTORE_ITEM_MAX_COUNT) {
    return { errorKey: 'alert.restoreCountRange' };
  }
  return {
    pending: {
      title: t('dialog.confirmRestoreItem'),
      rows: [
        { label: t('dialog.character'), value: characterName },
        { label: t('dialog.item'), value: restoreItemSummary(id, count) },
        { label: t('dialog.reason'), value: note },
      ],
      endpoint: `/admin/api/moderation/characters/${characterId}/restore-item`,
      body: { itemId: id, count, reason: note },
    },
  };
}

export function restoreSlot(
  characterId: number,
  characterName: string,
  professionId: string,
  effectId: string,
  note: string,
): Built {
  if (!note.trim()) return { errorKey: 'alert.noteRequired' };
  if (!professionId || !effectId) return { errorKey: 'alert.restoreSlotSelection' };
  return {
    pending: {
      title: t('dialog.confirmRestoreSlot'),
      rows: [
        { label: t('dialog.character'), value: characterName },
        {
          label: t('dialog.slot'),
          // Through a key, not template concatenation: composition typography
          // (the separator) is the locale's call, the restoreSummary rule.
          value: t('profInspect.slotPair', { profession: professionId, effect: effectId }),
        },
        { label: t('dialog.reason'), value: note },
      ],
      endpoint: `/admin/api/moderation/characters/${characterId}/restore-slot`,
      body: { professionId, effectId, reason: note },
    },
  };
}
