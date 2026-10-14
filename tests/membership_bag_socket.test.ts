// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { t } from '../src/ui/i18n';
import { createMembershipBagSocket } from '../src/ui/membership_bag_socket';
import type { IWorld } from '../src/world_api';

function render(bags: (string | null)[]) {
  const unequipBag = vi.fn();
  const world = { bags, unequipBag } as unknown as IWorld;
  let tooltip = () => '';
  const deps = {
    itemIcon: () => '<span class="item-icon"></span>',
    itemTooltip: () => '<span>bag item</span>',
    attachTooltip: (_el: HTMLElement, html: () => string) => {
      tooltip = html;
    },
    hideTooltip: vi.fn(),
    repaint: vi.fn(),
  };
  const button = createMembershipBagSocket(world, deps);
  return { button, unequipBag, deps, tooltip };
}

describe('membership bag socket painter', () => {
  it('shows a keyboard-readable locked slot that cannot unequip while inactive', () => {
    const { button, unequipBag, tooltip } = render([null, null, null, null]);
    expect(button.classList.contains('membership-locked')).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-label')).toBeTruthy();
    expect(button.querySelector('svg')).not.toBeNull();
    button.click();
    expect(unequipBag).not.toHaveBeenCalled();
    expect(tooltip()).toContain('tt-sub');
  });
  it('renders the equipped member bag and routes its click to the fifth socket', () => {
    const { button, unequipBag, deps, tooltip } = render([null, null, null, null, 'linen_pouch']);
    expect(button.classList.contains('membership-locked')).toBe(false);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.querySelector('.item-icon')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toContain(itemDisplayName(ITEMS.linen_pouch));
    expect(button.getAttribute('aria-label')).toContain('6');
    expect(tooltip()).toContain(t('hudChrome.bags.unequipHint'));
    button.click();
    expect(unequipBag).toHaveBeenCalledExactlyOnceWith(4);
    expect(deps.repaint).toHaveBeenCalledOnce();
  });
  it('shows the available empty member slot without dispatching a phantom unequip', () => {
    const { button, unequipBag } = render([null, null, null, null, null]);
    expect(button.classList.contains('membership-locked')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.click();
    expect(unequipBag).not.toHaveBeenCalled();
  });
});
