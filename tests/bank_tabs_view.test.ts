import { expect, it } from 'vitest';
import { bankTabsHtml } from '../src/ui/bank_tabs_view';

it('keeps banking and weekly rewards separate even while both mirrors exist', () => {
  expect(bankTabsHtml('rewards', { vault: true, guild: true })).toBe('');
  const html = bankTabsHtml('personal', { vault: true, guild: true });
  expect(html).not.toContain('weekly-rewards');
  expect(html).toContain('bank-tab-vault');
  expect(html).toContain('bank-tab-guild');
});
