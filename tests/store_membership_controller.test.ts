// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusKeyAttr } from '../src/ui/focus_restore';
import { StoreMembershipController } from '../src/ui/store_membership_controller';

afterEach(() => {
  document.body.innerHTML = '';
});

function harness() {
  document.body.innerHTML =
    '<section><button data-woc-store-tab="memberships"></button><span data-membership-announcement></span><div class="body"></div></section>';
  const root = document.querySelector('section')!;
  const body = root.querySelector<HTMLElement>('.body')!;
  let markup = `<button ${focusKeyAttr('buy')}>Buy</button><p data-membership-summary>Pending</p>`;
  const subscription = { html: () => markup, bind: vi.fn() };
  const controller = new StoreMembershipController();
  const paint = () => controller.paint(root, body, subscription, vi.fn());
  return {
    root,
    body,
    subscription,
    controller,
    paint,
    setMarkup: (next: string) => {
      markup = next;
    },
  };
}

describe('membership repaint controller', () => {
  it('retains unchanged controls and resets the markup memo when the surface is replaced', () => {
    const h = harness();
    h.paint();
    const button = h.body.querySelector('button');
    h.paint();
    expect(h.body.querySelector('button')).toBe(button);
    expect(h.subscription.bind).toHaveBeenCalledTimes(1);
    h.body.innerHTML = '';
    h.controller.reset();
    h.paint();
    expect(h.body.querySelector('button')).not.toBeNull();
    expect(h.subscription.bind).toHaveBeenCalledTimes(2);
  });

  it('preserves scroll and keyed focus, then falls back to manage or the tab', () => {
    const h = harness();
    h.paint();
    h.body.querySelector('button')!.focus();
    h.body.scrollTop = 170;
    const announcement = h.root.querySelector('[data-membership-announcement]');
    h.setMarkup(
      `<button ${focusKeyAttr('buy')}>Upgrade</button><p data-membership-summary>Active</p>`,
    );
    h.paint();
    expect(document.activeElement).toBe(h.body.querySelector('button'));
    expect(h.body.scrollTop).toBe(170);
    expect(h.root.querySelector('[data-membership-announcement]')).toBe(announcement);
    expect(announcement?.textContent).toBe('Active');
    h.setMarkup(`<button ${focusKeyAttr('subscription-manage')}>Manage</button>`);
    h.paint();
    expect(document.activeElement).toBe(h.body.querySelector('button'));
    h.setMarkup('<p>Unavailable</p>');
    h.paint();
    expect(document.activeElement).toBe(h.root.querySelector('[data-woc-store-tab]'));
  });
});
