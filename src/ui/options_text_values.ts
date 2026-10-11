// One options sentence with its placeholders resolved: the view names a
// placeholder as a KEY (or a number) so the whole sentence, value included,
// stays one translatable string, and the painter calls this to render it.

import { formatNumber, t } from './i18n';
import type { TranslationKey } from './i18n.catalog';

export function optionsText(
  textKey: TranslationKey,
  valueKeys?: Record<string, TranslationKey>,
  numbers?: Record<string, number>,
): string {
  if (!valueKeys && !numbers) return t(textKey);
  const values: Record<string, string> = {};
  for (const [name, key] of Object.entries(valueKeys ?? {})) values[name] = t(key);
  for (const [name, n] of Object.entries(numbers ?? {})) values[name] = formatNumber(n);
  return t(textKey, values);
}
