import { expect, it } from 'vitest';
import { bankTabsHtml, bankWindowTitle } from '../src/ui/bank_tabs_view';
import { t } from '../src/ui/i18n';

it('carries no weekly rewards tab: the Vault is the Rewards hub tab now', () => {
  // Menu consolidation step 7: the bank is Personal, Materials Vault, Guild and
  // Account; the weekly rewards sheet left for the Rewards hub.
  const html = bankTabsHtml('personal', { vault: true, guild: true, account: true });
  expect(html).not.toContain('weekly-rewards');
  expect(html).not.toContain('data-tab="rewards"');
  expect(html).toContain('bank-tab-vault');
  expect(html).toContain('bank-tab-guild');
  expect(html).toContain('bank-tab-account');
  expect(bankWindowTitle()).toBe(t('hudChrome.bank.title'));
});
