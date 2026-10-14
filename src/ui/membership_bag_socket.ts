// The member-only fifth socket shares the bag bar's existing interaction grammar.

import { bagSlotsOf } from '../sim/bags';
import { ITEMS } from '../sim/data';
import { MEMBERSHIP_BAG_SOCKET } from '../sim/membership_bag_slot';
import type { ItemDef } from '../sim/types';
import type { IWorld } from '../world_api';
import { bagSlotsLineKey } from './bags_view';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

interface MembershipBagSocketDeps {
  itemIcon(item: ItemDef): string;
  itemTooltip(item: ItemDef): string;
  attachTooltip(el: HTMLElement, html: () => string): void;
  hideTooltip(): void;
  repaint(): void;
}

export function membershipBagSlotLocked(bags: readonly (string | null)[]): boolean {
  return bags.length <= MEMBERSHIP_BAG_SOCKET;
}

export function createMembershipBagSocket(
  world: IWorld,
  deps: MembershipBagSocketDeps,
): HTMLElement {
  const locked = membershipBagSlotLocked(world.bags);
  const id = world.bags[MEMBERSHIP_BAG_SOCKET];
  const item = id ? ITEMS[id] : undefined;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `bag-socket ui-socket ui-socket--bag membership-bag-slot${locked ? ' empty membership-locked' : item ? ` q-${item.quality}` : ' empty'}`;
  button.setAttribute(
    'aria-label',
    !locked && item
      ? t('hudChrome.bags.bagSocketAria', {
          name: itemDisplayName(item),
          slots: t(bagSlotsLineKey(item) ?? 'itemUi.tooltip.bagSlots', {
            slots: formatNumber(bagSlotsOf(item), { maximumFractionDigits: 0 }),
          }),
        })
      : t(locked ? 'hudChrome.bags.membershipSlotLocked' : 'hudChrome.bags.membershipSlot'),
  );
  if (locked || !item) button.setAttribute('aria-disabled', 'true');
  button.innerHTML = locked ? svgIcon('lock') : item ? deps.itemIcon(item) : svgIcon('bags');
  deps.attachTooltip(
    button,
    () =>
      `<div class="tt-title">${esc(t('hudChrome.bags.membershipSlot'))}</div>${item ? deps.itemTooltip(item) : ''}${!locked && item ? `<div class="tt-sub">${esc(t('hudChrome.bags.unequipHint'))}</div>` : ''}<div class="tt-sub">${esc(t(locked ? 'hudChrome.bags.membershipSlotLocked' : 'hudChrome.bags.membershipSlotHint'))}</div>`,
  );
  if (!locked && item)
    button.addEventListener('click', () => {
      world.unequipBag(MEMBERSHIP_BAG_SOCKET);
      deps.hideTooltip();
      deps.repaint();
    });
  return button;
}
