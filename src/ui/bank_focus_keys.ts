// The bank window's focus-key annotators: after a pane paints, stamp its
// controls with the `data-focus-key` identities BankWindow's restore ladder
// re-lands focus on across the next full rebuild. A sibling of bank_window.ts
// (which stays under its ratchet) that IMPORTS focus_restore, so the shared
// namespace keeps a single reader family (the single-reader guard in
// tests/focus_restore.test.ts) and the panes themselves stay focus-agnostic.
//
// Why keys matter here: the guild pane repaints on ANY officer's op (its
// cache busts and the response lands), and the history's chips and Show
// older rebuild it through requestRender on the very click, so a keyboard
// user must re-land on the control they were on, never on the close button
// (and on Chromium a mouse click focuses the button too, so a following Enter
// would have closed the bank).

import { stampFocusKey } from './focus_restore';
import { type GuildBankViewModel, guildBankSlotFocusKeys } from './guild_bank_view';

/** Stamp the guild pane's controls AFTER renderInto returned. Cells are keyed
 *  by semantic item/copy identity; duplicate-group cardinality is part of that
 *  key, so an ambiguous disappearing twin safely falls back instead of
 *  transferring focus to a different physical copy. */
export function annotateGuildFocusKeys(el: HTMLElement, model: GuildBankViewModel): void {
  // The Contents / History sub-strip first: a reader must not be thrown off
  // the strip by somebody else's deposit.
  for (const tab of el.querySelectorAll<HTMLElement>('.gbank-view-tab')) {
    tab.dataset.focusKey = `gbank:view:${tab.dataset.tab}`;
  }
  const slotKeys = model.kind === 'guild' ? guildBankSlotFocusKeys(model.slots) : [];
  // A key miss stamps NOTHING: '' would still satisfy the restore ladder.
  el.querySelectorAll<HTMLElement>('.bank-grid .bank-item:not(.empty)').forEach((cell, i) => {
    if (slotKeys[i] !== undefined) cell.dataset.focusKey = slotKeys[i];
  });
  const [deposit, withdraw] = Array.from(el.querySelectorAll<HTMLElement>('.gbank-gold-btn'));
  if (deposit) deposit.dataset.focusKey = 'gbank:deposit-gold';
  if (withdraw) withdraw.dataset.focusKey = 'gbank:withdraw-gold';
  stampFocusKey(el, '.bank-buy-btn', 'gbank:buy');
  // The history's controls. The Show older button vanishes while its page
  // loads, so a restore aimed at it falls through the ladder to Close; the
  // chips are always present and re-land exactly.
  stampFocusKey(el, '.gbank-log-older', 'gbank:log:older');
  for (const chip of el.querySelectorAll<HTMLElement>('.gbank-log-filter')) {
    chip.dataset.focusKey = `gbank:log:filter:${chip.dataset.kind}`;
  }
}

/** VaultTab owns semantic row/action keys because it has the row model in
 *  hand; the window adds only its fixed footer controls after renderInto. */
export function annotateVaultFocusKeys(el: HTMLElement): void {
  stampFocusKey(el, '.vault-deposit-all', 'vault:deposit-all');
  stampFocusKey(el, '.vault-unlock-btn', 'vault:unlock');
  stampFocusKey(el, '.vault-upgrade-btn', 'vault:upgrade');
}
