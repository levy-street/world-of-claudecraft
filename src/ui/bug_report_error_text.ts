// The bug-report submit failure ladder: the server's screened English refusals
// mapped to catalog keys, with one generic line in every other direction.
//
// The `*_reason_text.ts` family's shape (wallet_bridge_reason_text.ts,
// woc_market_reason_text.ts): a catch site never renders `err.message`, it hands
// the error here and renders the classified line, so rewording one of those
// server messages is one edit in this map. Extracted from the options painter,
// which is at its line ceiling (tests/monolith_budget.test.ts), and pure enough
// to drive directly (tests/bug_report_error_text.test.ts).

import { t } from './i18n';
import type { TranslationKey } from './i18n.catalog';

const KEY_BY_MESSAGE: Readonly<Record<string, TranslationKey>> = {
  'describe the bug': 'hudChrome.bugReport.describeFirst',
  'bug report too large': 'hudChrome.bugReport.tooLarge',
  'too many bug reports, try again later': 'hudChrome.bugReport.rateLimited',
};

/** The localized line a failed bug-report submit shows. */
export function bugReportErrorText(err: unknown): string {
  const text = err instanceof Error ? err.message : '';
  const key = KEY_BY_MESSAGE[text.toLowerCase()];
  return key ? t(key) : t('hudChrome.bugReport.failed');
}
