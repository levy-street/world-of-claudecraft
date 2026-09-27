// The shared WAI-ARIA tab strip (tab_strip_view core + wireTabStrip),
// the social/talents idiom. The PERSONAL pane's sections still mount
// directly on the window root (wrapping them would disturb the flex
// column the bank CSS sizes), so the strip carries no blanket `panelId`;
// the GUILD and VAULT panes do build a real role=tabpanel (the guild one
// holds a nested tab list of its own, and a lone unwrapped peer would
// read as a second unrelated top level to a screen reader). Their
// aria-controls are stamped below, once each panel exists.
// Pure bank-pane tab markup; panel relationships are completed by the window.
export type BankTabId = 'personal' | 'vault' | 'guild' | 'rewards';

import { t } from './i18n';
import { tabStripHtml, tabStripModel } from './tab_strip_view';
export function bankTabsHtml(
  selected: BankTabId,
  available: { guild: boolean; vault: boolean },
): string {
  if (selected === 'rewards') return '';
  return tabStripHtml(
    tabStripModel({
      ariaLabel: t('hudChrome.bank.tabsAria'),
      stripClass: 'bank-tabs ui-tabs',
      tabClass: 'bank-tab ui-tab',
      selectedClass: 'on is-on',
      tabs: [
        { id: 'personal', label: t('hudChrome.bank.personalTab') },
        // The two conditional tabs carry stable button ids so their
        // panels can point aria-labelledby back at them. The vault sits
        // between Personal and Guild: both personal stores first, the
        // shared one last.
        ...(available.vault
          ? [{ id: 'vault', label: t('hudChrome.bank.vaultTab'), buttonId: 'bank-tab-vault' }]
          : []),
        ...(available.guild
          ? [{ id: 'guild', label: t('hudChrome.bank.guildTab'), buttonId: 'bank-tab-guild' }]
          : []),
      ],
      selected: selected,
    }),
  );
}

export function bankWindowTitle(selected: BankTabId): string {
  return t(selected === 'rewards' ? 'hudChrome.weeklyRewards.title' : 'hudChrome.bank.title');
}
