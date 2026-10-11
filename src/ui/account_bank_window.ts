import { ITEMS } from '../sim/data';
import type { InvSlot } from '../sim/types';
import type { IWorld } from '../world_api';
import { accountBankTransferAllowed } from './account_bank_view';
import { buildBankView } from './bank_view';
import { formatCount } from './count_format';
import { esc } from './esc';
import { findFocusKey } from './focus_restore';
import { t } from './i18n';
import { knownItemDef } from './known_item';
import {
  buildPersonalBankItemCell,
  type PersonalBankItemCellDeps,
} from './personal_bank_item_cell';
import { wireTabStrip } from './tab_strip_painter';
import { tabStripHtml, tabStripModel } from './tab_strip_view';

export function available(world: IWorld): boolean {
  return world.player?.membershipActive === true || !!world.player?.referralInviterName;
}

/** The referral claim panel is available without granting member bank reads. */
export function request(world: IWorld, force = false): void {
  if (world.player?.membershipActive && (force || !world.accountBankInfo))
    world.requestAccountBanks?.();
}

/** The parent bank owns invalidation, focus restoration and the one open-time request. */
export function renderAccountBank(
  root: HTMLElement,
  deps: PersonalBankItemCellDeps & { world(): IWorld },
  repaint: () => void,
): void {
  const info = deps.world().accountBankInfo;
  const pane = document.createElement('div');
  pane.id = 'account-bank-panel';
  pane.className = 'bank-scroll account-bank-panel';
  pane.setAttribute('role', 'tabpanel');
  pane.setAttribute('aria-labelledby', 'bank-tab-account');
  root.appendChild(pane);
  if (deps.world().player.membershipActive || deps.world().player.referralInviterName) {
    const claim = document.createElement('button');
    claim.type = 'button';
    claim.className = 'btn ui-btn';
    claim.textContent = t(
      deps.world().player.membershipActive
        ? 'hudChrome.bank.accountArmour'
        : 'hudChrome.bank.referralArmour',
    );
    claim.dataset.focusKey = 'account-armour';
    claim.addEventListener('click', () => deps.world().claimMembershipArmour());
    pane.appendChild(claim);
  }
  if (deps.world().player.membershipActive !== true || !info) {
    pane.insertAdjacentHTML('beforeend', `<p>${esc(t('hudChrome.bank.accountMembership'))}</p>`);
    return;
  }
  if (info.characters.length === 0) {
    pane.insertAdjacentHTML('beforeend', `<p>${esc(t('hudChrome.bank.accountEmpty'))}</p>`);
    return;
  }
  pane.insertAdjacentHTML(
    'beforeend',
    tabStripHtml(
      tabStripModel({
        ariaLabel: t('hudChrome.bank.accountCharacters'),
        stripClass: 'bank-tabs ui-tabs',
        tabClass: 'account-bank-tab ui-tab',
        selectedClass: 'on is-on',
        selected: String(info.selectedCharacterId ?? info.characters[0].characterId),
        tabs: info.characters.map((character) => ({
          id: String(character.characterId),
          label: character.name,
        })),
      }),
    ),
  );
  wireTabStrip(pane, 'account-bank-tab', (id, focusFollow) => {
    deps.world().selectAccountBank(Number(id));
    repaint();
    if (focusFollow) findFocusKey(root, `account-character:${id}`)?.focus();
  });
  for (const tab of pane.querySelectorAll<HTMLElement>('.account-bank-tab'))
    tab.dataset.focusKey = `account-character:${tab.dataset.tab}`;
  if (info.error) {
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = t('hudChrome.bank.accountUnavailable');
    pane.appendChild(status);
  }
  if (!info.bank || info.selectedCharacterId === null) {
    pane.insertAdjacentHTML('beforeend', `<p>${esc(t('hudChrome.bank.accountSelect'))}</p>`);
    return;
  }
  const characterId = info.selectedCharacterId;
  const selectedBank = info.bank;
  const appendGrid = (slots: InvSlot[], direction: 'deposit' | 'withdraw') => {
    const model = buildBankView({ ...selectedBank, slots }, (id) => knownItemDef(ITEMS, id));
    if (model.kind === 'away') return;
    const heading = document.createElement('h3');
    heading.textContent = t(
      direction === 'deposit' ? 'hudChrome.bank.accountDeposit' : 'hudChrome.bank.accountWithdraw',
    );
    pane.appendChild(heading);
    const grid = document.createElement('div');
    grid.className = 'bank-grid';
    for (const slot of model.slots) {
      const source = slots[slot.slotIndex];
      const cell = buildPersonalBankItemCell(
        deps,
        slot,
        formatCount(slot.count),
        () => {
          if (!accountBankTransferAllowed(source, knownItemDef(ITEMS, source.itemId))) return;
          deps
            .world()
            .accountBankTransfer(
              characterId,
              direction,
              slot.slotIndex,
              source.count,
              structuredClone(source),
            );
          deps.onInventoryChanged();
        },
        repaint,
        {
          wholeStack: true,
          hintKey:
            direction === 'deposit'
              ? 'hudChrome.bank.accountDepositHint'
              : 'hudChrome.bank.accountWithdrawHint',
        },
      );
      (cell as HTMLButtonElement).disabled = !accountBankTransferAllowed(
        source,
        knownItemDef(ITEMS, source.itemId),
      );
      cell.dataset.focusKey = `account-${direction}:${slot.slotIndex}`;
      grid.appendChild(cell);
    }
    pane.appendChild(grid);
  };
  appendGrid(info.bank.slots, 'withdraw');
  appendGrid(deps.world().inventory, 'deposit');
  pane.insertAdjacentHTML('beforeend', `<p>${esc(t('hudChrome.bank.accountBound'))}</p>`);
}
