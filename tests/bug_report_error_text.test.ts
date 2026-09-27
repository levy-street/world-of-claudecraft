// The bug-report failure ladder (src/ui/bug_report_error_text.ts), extracted from
// the options painter. Pinned to the SERVER's exact refusal strings: rewording one
// of them without updating the map silently downgrades a specific, actionable line
// to the generic one, which no rendered-text assertion would catch.

import { describe, expect, it } from 'vitest';
import { bugReportErrorText } from '../src/ui/bug_report_error_text';
import { t } from '../src/ui/i18n';

describe('bugReportErrorText', () => {
  it('classifies each screened server refusal, case-insensitively', () => {
    expect(bugReportErrorText(new Error('describe the bug'))).toBe(
      t('hudChrome.bugReport.describeFirst'),
    );
    expect(bugReportErrorText(new Error('bug report too large'))).toBe(
      t('hudChrome.bugReport.tooLarge'),
    );
    expect(bugReportErrorText(new Error('too many bug reports, try again later'))).toBe(
      t('hudChrome.bugReport.rateLimited'),
    );
    expect(bugReportErrorText(new Error('Bug Report Too Large'))).toBe(
      t('hudChrome.bugReport.tooLarge'),
    );
  });

  it('falls back to the generic line for anything else, and never renders err.message', () => {
    const generic = t('hudChrome.bugReport.failed');
    expect(bugReportErrorText(new Error('ECONNRESET'))).toBe(generic);
    expect(bugReportErrorText('a bare string')).toBe(generic);
    expect(bugReportErrorText(null)).toBe(generic);
    expect(bugReportErrorText(undefined)).toBe(generic);
    expect(bugReportErrorText({ message: 'not an Error' })).toBe(generic);
    expect(bugReportErrorText(new Error('ECONNRESET'))).not.toContain('ECONNRESET');
  });
});
