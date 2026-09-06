// Shared deposit-all summary interpolation for the Bank and Materials Vault
// windows (bank_window.ts, vault_window.ts): both pick their arm from their own
// pure core (bank_view.ts's depositAllSummaryKey, vault_view.ts's
// vaultDepositAllSummaryKey), then need the identical resolution for a Notable
// arm's {item} token: the epic-or-better def's localized name off the SAME
// knownItemDef lookup each painter already uses for every other item name in
// its file. i18n key/label resolution is allowed in a pure module (see
// src/ui/CLAUDE.md).
import type { ItemDef } from '../sim/types';
import { itemDisplayName } from './entity_i18n';
import { type TranslationKey, t } from './i18n';

/** The count token always, plus {item} only when a Notable arm resolved a def:
 *  an id that somehow escaped the guarded plan degrades to the count-only
 *  params rather than leaving a literal `{item}` in the rendered line. */
export function depositAllNotableParams(
  fmtCount: string,
  notableDef: ItemDef | undefined,
): Record<string, string> {
  return { count: fmtCount, ...(notableDef ? { item: itemDisplayName(notableDef) } : {}) };
}

/** Bank's eager-resolve summary (unlike the vault, which stores key+params for
 *  its language-switch relocalize fan-out): count/item are safe to pass even to
 *  the None arm's count-less template, since t()'s interpolation only reads the
 *  placeholders that template actually declares. */
export function depositAllStatusText(
  key: TranslationKey,
  fmtCount: string,
  notableDef: ItemDef | undefined,
): string {
  return t(key, depositAllNotableParams(fmtCount, notableDef));
}
