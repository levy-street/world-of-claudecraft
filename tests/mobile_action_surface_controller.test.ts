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
        <button id="mobile-utility-page-toggle"><span class="mobile-action-page-indicator"></span></button>
        <div id="mobile-utility-actions">
        ${Array.from(
          { length: 5 },
          (_, slot) =>
            `<button class="mobile-action-slot mobile-utility-action${slot === 4 ? ' mobile-ring-seat' : ''}" data-mobile-index="${slot}" data-utility-slot="${slot}"><span class="mobile-utility-icon"></span></button>`,
        ).join('')}
        </div>
      </div>
    </div>
    ${MENU_STRIP_ITEMS.map(
      ({ elementId, id }) =>
        `<button id="${elementId}" data-icon="${{ mount: 'mount', chat: 'chat', map: 'map', bags: 'bags', social: 'social', quest: 'questlog', char: 'character', spellbook: 'spellbook', settings: 'menu', more: 'more', dfinder: 'dfinder', crafting: 'crafting' }[id]}"></button>`,
    ).join('')}
    <button id="mobile-dfinder" data-icon="dfinder"></button>
    <button id="mobile-crafting" data-icon="crafting"></button>
  `;
  hydrateIcons(document);
});

describe('mobile action surface controller', () => {
  it('switches between surfaces and routes both utility pages through existing buttons', () => {
    const calls = new Map<string, number>();
    const showUtilitySurface = vi.fn();
    for (const { id, elementId } of MENU_STRIP_ITEMS) {
      document.getElementById(elementId)?.addEventListener('click', () => {
        calls.set(id, (calls.get(id) ?? 0) + 1);
      });
    }
    for (const id of ['dfinder', 'crafting']) {
      document.getElementById(`mobile-${id}`)?.addEventListener('click', () => {
        calls.set(id, (calls.get(id) ?? 0) + 1);
      });
    }
    const controller = buildMobileActionSurface({
      writers,
      t: (key, values) =>
        key === 'hudChrome.mobile.actionPageIndicator' ? `${values?.page}/${values?.count}` : key,
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
      document.querySelector('#mobile-utility-page-toggle .mobile-action-page-indicator')
        ?.textContent,
    ).toBe('1/2');
    expect(
      Array.from(document.querySelectorAll<HTMLButtonElement>('.mobile-utility-action'), (button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual([
      'hudChrome.mounts.mount',
      'hud.core.mobileMap',
      'hud.keybinds.actions.bags',
      'hud.keybinds.actions.char',
      'questUi.tracker.title',
    ]);
    expect(document.querySelector('.mobile-utility-action .mobile-label')).toBeNull();

    for (const button of document.querySelectorAll<HTMLButtonElement>('.mobile-utility-action')) {
      button.click();
    }
    expect([...calls.values()]).toEqual([1, 1, 1, 1, 1]);

    const pageToggle = document.getElementById('mobile-utility-page-toggle') as HTMLButtonElement;
    pageToggle.click();
    expect(
      document.querySelector('#mobile-utility-page-toggle .mobile-action-page-indicator')
        ?.textContent,
    ).toBe('2/2');
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('.mobile-utility-icon'),
        (icon) => icon.dataset.icon,
      ),
    ).toEqual(['chat', 'social', 'dfinder', 'spellbook', 'crafting']);
    expect(
      Array.from(document.querySelectorAll<HTMLButtonElement>('.mobile-utility-action'), (button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual([
      'hud.core.mobileChat',
      'hud.core.mobileSocial',
      'hudChrome.finder.title',
      'abilityUi.spellbook.title',
      'hudChrome.crafting.title',
    ]);
    for (const button of document.querySelectorAll<HTMLButtonElement>('.mobile-utility-action')) {
      button.click();
    }
    expect([...calls.values()]).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);

    pageToggle.click();
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('.mobile-utility-icon'),
        (icon) => icon.dataset.icon,
      ),
    ).toEqual(['mount', 'map', 'bags', 'character', 'questlog']);
    expect([...calls.values()]).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);

    controller?.update(true, 1);
    expect(document.getElementById('mobile-action-ring')?.dataset.actionSurface).toBe('combat');
    expect(document.getElementById('mobile-action-ring')?.getAttribute('data-action-surface')).toBe(
      'combat',
    );
  });

  it('routes non-primary touch taps through the existing action button', () => {
    const calls = vi.fn();
    const character = document.getElementById('mobile-menu-char');
    character?.addEventListener('click', calls);
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
    ).toEqual(['mount', 'map', 'bags', 'character', 'questlog']);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'hudChrome.mounts.mount',
      'hud.core.mobileMap',
      'hud.keybinds.actions.bags',
      'hud.keybinds.actions.char',
      'questUi.tracker.title',
    ]);
    expect(buttons.map((button) => button.getAttribute('title'))).toEqual([
      'hudChrome.mounts.mount',
      'hud.core.mobileMap',
      'hud.keybinds.actions.bags',
      'hud.keybinds.actions.char',
      'questUi.tracker.title',
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

  it('lets the player return to utility while combat is forcing the combat layout', () => {
    const controller = buildMobileActionSurface({
      writers,
      t: (key) => key,
      consumePeekGuard: vi.fn(),
      hideTooltip: vi.fn(),
      clickSfx: vi.fn(),
    });
    const mode = document.getElementById('mobile-action-mode') as HTMLButtonElement;

    controller?.update(false, 1);
    controller?.update(true, 1);
    expect(document.getElementById('mobile-action-ring')?.dataset.actionSurface).toBe('combat');
    expect(mode.querySelector('.mobile-action-mode-label')?.textContent).toBe(
      'hudChrome.mobile.actionModeUtility',
    );
    expect(mode.getAttribute('aria-label')).toBe('hudChrome.mobile.actionModeUtility');

    mode.click();
    controller?.update(true, 1);
    expect(document.getElementById('mobile-action-ring')?.dataset.actionSurface).toBe('utility');
    expect(mode.querySelector('.mobile-action-mode-label')?.textContent).toBe(
      'hudChrome.mobile.actionModeCombat',
    );
    expect(mode.getAttribute('aria-label')).toBe('hudChrome.mobile.actionModeCombat');

    mode.click();
    controller?.update(true, 1);
    expect(document.getElementById('mobile-action-ring')?.dataset.actionSurface).toBe('combat');
    expect(mode.querySelector('.mobile-action-mode-label')?.textContent).toBe(
      'hudChrome.mobile.actionModeUtility',
    );
  });

  it("auto-switches once on each combat entry without overriding the player's choice mid-combat", () => {
    const controller = buildMobileActionSurface({
      writers,
      t: (key) => key,
      consumePeekGuard: vi.fn(),
      hideTooltip: vi.fn(),
      clickSfx: vi.fn(),
    });
    const mode = document.getElementById('mobile-action-mode') as HTMLButtonElement;

    controller?.update(false, 1);
    controller?.update(true, 1);
    expect(document.getElementById('mobile-action-ring')?.dataset.actionSurface).toBe('combat');

    mode.click();
    controller?.update(true, 1);
    expect(document.getElementById('mobile-action-ring')?.dataset.actionSurface).toBe('utility');

    controller?.update(false, 1);
    expect(document.getElementById('mobile-action-ring')?.dataset.actionSurface).toBe('utility');
    controller?.update(true, 1);
    expect(document.getElementById('mobile-action-ring')?.dataset.actionSurface).toBe('combat');
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
