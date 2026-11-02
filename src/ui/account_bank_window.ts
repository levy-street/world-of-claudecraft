import { ITEMS } from '../sim/data';
import type { IWorld } from '../world_api';
import type { BankInfo } from '../world_api/bank';
import {
  type AccountBankStage,
  accountBankDepositTarget,
  accountBankStage,
  accountBankTransferAllowed,
} from './account_bank_view';
import { buildBankView } from './bank_view';
import { formatCount } from './count_format';
import { findFocusKey } from './focus_restore';
import { type TranslationKey, t } from './i18n';
import { knownItemDef } from './known_item';
import {
  buildPersonalBankItemCell,
  type PersonalBankItemCellDeps,
} from './personal_bank_item_cell';
import { wireTabStrip } from './tab_strip_painter';
import { tabStripHtml, tabStripModel } from './tab_strip_view';

export function available(world: IWorld): boolean {
  return world.player?.membershipActive === true;
}

/** Only active members request other characters' bank data. */
export function request(world: IWorld, force = false, openFirst = false): void {
  if (world.player?.membershipActive && (force || !world.accountBankInfo))
    world.requestAccountBanks?.(openFirst);
}

/** Showing the tab opens a bank: the roster is fetched (or the in-flight fetch
 *  armed) so the remembered or first character loads without a click. */
export function openTab(world: IWorld): void {
  const info = world.accountBankInfo;
  request(world, !info || (info.selectedCharacterId === null && !info.error), true);
}

/** The character a docked bags click deposits into, or null when the pane
 *  is not `onScreen` or its selected bank is not ready yet. */
export function depositTarget(world: IWorld, onScreen: boolean): number | null {
  return onScreen
    ? accountBankDepositTarget(world.accountBankInfo, world.player?.membershipActive)
    : null;
}

type AccountBankDeps = PersonalBankItemCellDeps & { world(): IWorld };

/** The parent bank owns invalidation, focus restoration and the one open-time request. */
export function renderAccountBank(
  root: HTMLElement,
  deps: AccountBankDeps,
  repaint: () => void,
): void {
  const world = deps.world();
  const info = world.accountBankInfo;
  const stage = accountBankStage(info, world.player?.membershipActive);
  const pane = document.createElement('div');
  pane.id = 'account-bank-panel';
  pane.className = 'bank-scroll account-bank-panel';
  pane.setAttribute('role', 'tabpanel');
  pane.setAttribute('aria-labelledby', 'bank-tab-account');
  root.appendChild(pane);
  if (stage.kind === 'membership') {
    pane.appendChild(notice('hudChrome.bank.accountMembership'));
    return;
  }
  if (info && info.characters.length > 0) appendCharacterTabs(root, pane, deps, info, repaint);
  const name = (id: number | null): string =>
    info?.characters.find((c) => c.characterId === id)?.name ?? '';
  switch (stage.kind) {
    case 'loading':
      pane.appendChild(notice('hudChrome.bank.accountLoading', undefined, 'status'));
      pane.appendChild(retryButton(() => request(deps.world(), true, true)));
      break;
    case 'no_characters':
      pane.appendChild(notice('hudChrome.bank.accountEmpty'));
      break;
    case 'choose':
      pane.appendChild(notice('hudChrome.bank.accountSelect'));
      break;
    case 'opening':
      pane.appendChild(
        notice('hudChrome.bank.accountOpening', { name: name(stage.characterId) }, 'status'),
      );
      break;
    case 'failed':
      pane.appendChild(failure(stage, name(stage.characterId), deps));
      break;
    case 'ready':
      if (stage.errorKey)
        pane.appendChild(notice(stage.errorKey, { name: name(stage.characterId) }, 'alert'));
      if (info?.bank)
        appendGrids(pane, deps, stage.characterId, name(stage.characterId), info.bank, repaint);
      break;
  }
  pane.appendChild(footer());
}

function notice(
  key: TranslationKey,
  values?: Record<string, string>,
  role?: 'status' | 'alert',
): HTMLElement {
  const p = document.createElement('p');
  p.className = 'bank-empty account-bank-notice';
  if (role) p.setAttribute('role', role);
  p.textContent = t(key, values);
  return p;
}

function failure(
  stage: Extract<AccountBankStage, { kind: 'failed' }>,
  name: string,
  deps: AccountBankDeps,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'account-bank-failure';
  box.appendChild(notice(stage.errorKey, { name }, 'alert'));
  if (stage.errorKey === 'hudChrome.bank.accountMembership') return box;
  box.appendChild(
    retryButton(() => {
      const world = deps.world();
      if (stage.characterId === null) request(world, true, true);
      else world.selectAccountBank(stage.characterId);
    }),
  );
  return box;
}

function retryButton(onClick: () => void): HTMLElement {
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn ui-btn account-bank-retry';
  retry.textContent = t('hudChrome.bank.accountRetry');
  retry.dataset.focusKey = 'account-retry';
  retry.addEventListener('click', onClick);
  return retry;
}

function appendCharacterTabs(
  root: HTMLElement,
  pane: HTMLElement,
  deps: AccountBankDeps,
  info: NonNullable<IWorld['accountBankInfo']>,
  repaint: () => void,
): void {
  pane.insertAdjacentHTML(
    'beforeend',
    tabStripHtml(
      tabStripModel({
        ariaLabel: t('hudChrome.bank.accountCharacters'),
        stripClass: 'bank-tabs ui-tabs account-bank-tabs',
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
}

function appendGrids(
  pane: HTMLElement,
  deps: AccountBankDeps,
  characterId: number,
  name: string,
  bank: BankInfo,
  repaint: () => void,
): void {
  // Only the selected bank's grid: deposits come from clicking the docked bags
  // window (bags_view's accountBankDeposit arm), not a second copy of the bags.
  const box = document.createElement('section');
  box.className = 'account-bank-section account-bank-withdraw';
  const head = document.createElement('div');
  head.className = 'account-bank-section-head';
  const heading = document.createElement('h3');
  heading.textContent = t('hudChrome.bank.accountBankTitle', { name });
  head.appendChild(heading);
  const model = buildBankView(bank, (id) => knownItemDef(ITEMS, id));
  if (model.kind === 'away') return;
  const meter = document.createElement('span');
  meter.className = 'account-bank-count';
  meter.textContent = t('hudChrome.bank.accountSlots', {
    used: formatCount(model.meter.used),
    total: formatCount(model.meter.total),
  });
  head.appendChild(meter);
  box.appendChild(head);
  const hint = document.createElement('p');
  hint.className = 'account-bank-hint';
  hint.textContent = t('hudChrome.bank.accountWithdrawLead', { name });
  box.appendChild(hint);
  // The deposit direction has no grid here, so say where it lives (touch
  // players never see the bags' hover hint).
  const depositHint = document.createElement('p');
  depositHint.className = 'account-bank-hint';
  depositHint.textContent = t('hudChrome.bank.accountBagsDepositLead', { name });
  box.appendChild(depositHint);
  const grid = document.createElement('div');
  grid.className = 'bank-grid';
  if (model.empty) {
    grid.appendChild(notice('hudChrome.bank.accountBankEmpty'));
  }
  for (const slot of model.slots) {
    const source = bank.slots[slot.slotIndex];
    const allowed = accountBankTransferAllowed(source, knownItemDef(ITEMS, source.itemId));
    const cell = buildPersonalBankItemCell(
      deps,
      slot,
      formatCount(slot.count),
      () => {
        if (!allowed) return;
        deps
          .world()
          .accountBankTransfer(
            characterId,
            'withdraw',
            slot.slotIndex,
            source.count,
            structuredClone(source),
          );
        deps.onInventoryChanged();
      },
      repaint,
      {
        wholeStack: true,
        hintKey: 'hudChrome.bank.accountWithdrawHint',
      },
    );
    (cell as HTMLButtonElement).disabled = !allowed;
    cell.dataset.focusKey = `account-withdraw:${slot.slotIndex}`;
    grid.appendChild(cell);
  }
  // Free squares make the selected bank's remaining room visible at a glance.
  for (let i = 0; !model.empty && i < model.emptyCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'bank-item ui-socket ui-socket--bag empty';
    cell.setAttribute('aria-hidden', 'true');
    grid.appendChild(cell);
  }
  box.appendChild(grid);
  pane.appendChild(box);
}

function footer(): HTMLElement {
  const foot = document.createElement('div');
  foot.className = 'account-bank-footer';
  const note = document.createElement('p');
  note.className = 'account-bank-note';
  note.textContent = t('hudChrome.bank.accountBound');
  foot.appendChild(note);
  return foot;
}
