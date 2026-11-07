// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMobileActionSurface } from '../src/ui/hud/action_bar/mobile_action_surface_controller';
import { MENU_STRIP_ITEMS } from '../src/ui/hud/menu/menu_strip_core';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { hydrateIcons } from '../src/ui/ui_icons';

const writers: PainterHostWriters = {
  setText: vi.fn((el, text) => {
    el.textContent = text;
  }),
  setDisplay: vi.fn((el, display) => {
    el.style.display = display;
  }),
  setTransform: vi.fn(),
  setWidth: vi.fn(),
  setStyleProp: vi.fn(),
  toggleClass: vi.fn(),
  setAttr: vi.fn((el, attr, value) => {
    el.setAttribute(attr, value);
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = `
    <div id="mobile-action-surface">
      <div id="mobile-action-ring">
        <button id="mobile-action-mode"><span class="mobile-action-mode-label"></span></button>
        <div id="mobile-utility-actions">
        ${Array.from(
          { length: 4 },
          (_, slot) =>
            `<button class="mobile-action-slot mobile-utility-action" data-mobile-index="${slot}" data-utility-slot="${slot}"><span class="mobile-utility-icon" data-icon="${['mount', 'map', 'chat', 'bags'][slot]}"></span></button>`,
        ).join('')}
        </div>
      </div>
    </div>
    ${MENU_STRIP_ITEMS.map(
      ({ elementId, id }) =>
        `<button id="${elementId}" data-icon="${{ mount: 'mount', chat: 'chat', map: 'map', bags: 'bags', social: 'social', quest: 'questlog', char: 'character', spellbook: 'spellbook', settings: 'menu', more: 'more' }[id]}"></button>`,
    ).join('')}
  `;
  hydrateIcons(document);
});

describe('mobile action surface controller', () => {
  it('switches between surfaces and routes each default shortcut once', () => {
    const calls = new Map<string, number>();
    const showUtilitySurface = vi.fn();
    for (const { id, elementId } of MENU_STRIP_ITEMS) {
      document.getElementById(elementId)?.addEventListener('click', () => {
        calls.set(id, (calls.get(id) ?? 0) + 1);
      });
    }
    const controller = buildMobileActionSurface({
      writers,
      t: (key) => key,
      consumePeekGuard: vi.fn(),
      hideTooltip: vi.fn(),
      clickSfx: vi.fn(),
      showUtilitySurface,
    });

    expect(controller).not.toBeNull();
    controller?.update(false, 1);
    controller?.update(false, 1);
    expect(document.getElementById('mobile-action-ring')?.dataset.actionSurface).toBe('utility');
    expect(showUtilitySurface).toHaveBeenCalledTimes(1);
    expect(
      Array.from(document.querySelectorAll<HTMLButtonElement>('.mobile-utility-action'), (button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual([
      'hudChrome.mounts.mount',
      'hud.core.mobileMap',
      'hud.core.mobileChat',
      'hud.keybinds.actions.bags',
    ]);
    expect(document.querySelector('.mobile-utility-action .mobile-label')).toBeNull();

    for (const button of document.querySelectorAll<HTMLButtonElement>('.mobile-utility-action')) {
      button.click();
    }
    expect([...calls.values()]).toEqual([1, 1, 1, 1]);

    controller?.update(true, 1);
    expect(document.getElementById('mobile-action-ring')?.dataset.actionSurface).toBe('combat');
    expect(document.getElementById('mobile-action-ring')?.getAttribute('data-action-surface')).toBe(
      'combat',
    );
  });

  it('routes non-primary touch taps through the existing action button', () => {
    const calls = vi.fn();
    const bags = document.getElementById('mobile-menu-bags');
    bags?.addEventListener('click', calls);
    const controller = buildMobileActionSurface({
      writers,
      t: (key) => key,
      consumePeekGuard: vi.fn(),
      hideTooltip: vi.fn(),
      clickSfx: vi.fn(),
    });
    controller?.update(false, 1);
    const shortcut = document.querySelector<HTMLButtonElement>(
      '.mobile-utility-action[data-utility-slot="3"]',
    );
    const pointer = (type: string): Event => {
      const event = new Event(type, { bubbles: true }) as PointerEvent;
      Object.defineProperties(event, {
        pointerType: { value: 'touch' },
        pointerId: { value: 2 },
        clientX: { value: 20 },
        clientY: { value: 30 },
      });
      return event;
    };

    shortcut?.dispatchEvent(pointer('pointerdown'));
    shortcut?.dispatchEvent(pointer('pointerup'));
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('keeps the fixed shortcut icons and accessible names aligned', () => {
    const controller = buildMobileActionSurface({
      writers,
      t: (key) => key,
      consumePeekGuard: vi.fn(),
      hideTooltip: vi.fn(),
      clickSfx: vi.fn(),
    });
    controller?.update(false, 1);
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.mobile-utility-action'),
    );
    expect(
      buttons.map(
        (button) => button.querySelector<HTMLElement>('.mobile-utility-icon')?.dataset.icon,
      ),
    ).toEqual(['mount', 'map', 'chat', 'bags']);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'hudChrome.mounts.mount',
      'hud.core.mobileMap',
      'hud.core.mobileChat',
      'hud.keybinds.actions.bags',
    ]);
    expect(buttons.map((button) => button.getAttribute('title'))).toEqual([
      'hudChrome.mounts.mount',
      'hud.core.mobileMap',
      'hud.core.mobileChat',
      'hud.keybinds.actions.bags',
    ]);
    expect(document.querySelector('.mobile-utility-action-label')).toBeNull();
    expect(buttons[0].querySelector('.mobile-utility-icon > .ui-icon')).not.toBeNull();
    expect(buttons[1].querySelector('.mobile-utility-icon > .ui-icon')).not.toBeNull();
  });

  it('toggles and resets the runtime combat pin when character identity changes', () => {
    const controller = buildMobileActionSurface({
      writers,
      t: (key) => key,
      consumePeekGuard: vi.fn(),
      hideTooltip: vi.fn(),
      clickSfx: vi.fn(),
    });
    const mode = document.getElementById('mobile-action-mode') as HTMLButtonElement;

    controller?.update(false, 1);
    expect(mode.querySelector('.mobile-action-mode-label')?.textContent).toBe(
      'hudChrome.mobile.actionModeCombat',
    );
    mode.click();
    expect(mode.getAttribute('aria-pressed')).toBe('true');
    controller?.update(false, 1);
    expect(mode.querySelector('.mobile-action-mode-label')?.textContent).toBe(
      'hudChrome.mobile.actionModeUtility',
    );
    expect(document.getElementById('mobile-action-ring')?.dataset.actionSurface).toBe('combat');

    controller?.update(false, 2);
    expect(mode.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('mobile-action-ring')?.dataset.actionSurface).toBe('utility');
  });

  it('does not rewrite an unchanged state and can relocalize labels', () => {
    const setText = vi.fn((el: HTMLElement, text: string) => {
      el.textContent = text;
    });
    const localWriters = { ...writers, setText };
    const controller = buildMobileActionSurface({
      writers: localWriters,
      t: (key) => `localized:${key}`,
      consumePeekGuard: vi.fn(),
      hideTooltip: vi.fn(),
      clickSfx: vi.fn(),
    });

    const countWrites = (): number =>
      [
        localWriters.setText,
        localWriters.setDisplay,
        localWriters.setTransform,
        localWriters.setWidth,
        localWriters.setStyleProp,
        localWriters.toggleClass,
        localWriters.setAttr,
      ].reduce((total, writer) => total + vi.mocked(writer).mock.calls.length, 0);

    controller?.update(false, 1);
    const writes = countWrites();
    controller?.update(false, 1);
    expect(countWrites()).toBe(writes);
    controller?.relocalize();
    expect(countWrites()).toBeGreaterThan(writes);
    expect(document.querySelector('.mobile-action-mode-label')?.textContent).toBe(
      'localized:hudChrome.mobile.actionModeCombat',
    );
  });
});
