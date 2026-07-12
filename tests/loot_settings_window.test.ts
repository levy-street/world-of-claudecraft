// @vitest-environment jsdom
//
// Behavioral guards for the loot-settings window painter after it adopts the
// shared window-frame chrome (the pure model is unit-tested in
// loot_settings_view.test.ts). #loot-settings-window carries a STATIC
// role="dialog" aria-labelledby="loot-settings-title" in index.html and Hud
// focus-traps the root, so the dialog identity stays on the root: the frame
// supplies visual chrome only (its own redundant role is stripped) and its title
// id matches the root's existing aria-labelledby target. These render the real
// DOM and assert the frame chrome, the single-dialog aria contract, the drag
// handle, the leader form + member read-only bodies, hostile-name escaping, and
// the change/close callbacks.

import { describe, expect, it, vi } from 'vitest';
import type { LootSettingsModel } from '../src/ui/loot_settings_view';
import {
  type LootSettingsWindowDeps,
  renderLootSettingsWindow,
} from '../src/ui/loot_settings_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';

function model(overrides: Partial<LootSettingsModel> = {}): LootSettingsModel {
  return {
    isLeader: true,
    enabled: false,
    threshold: 'uncommon',
    looterPid: 0,
    looterName: 'Leader',
    memberOptions: [
      { pid: 0, name: 'Leader' },
      { pid: 2, name: 'Ally' },
    ],
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<LootSettingsWindowDeps> = {}): LootSettingsWindowDeps {
  return { onChange: () => {}, onClose: () => {}, ...overrides };
}

// Mirrors index.html: the root is the static dialog with a stable title id.
function lootEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'loot-settings-window';
  el.className = 'window panel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'loot-settings-title');
  return el;
}

describe('renderLootSettingsWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an inner mount with titlebar, body, close', () => {
    const el = lootEl();
    renderLootSettingsWindow(el, model(), fakeDeps());
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // A form window has no sticky footer.
    expect(frame?.querySelector('.window-footer')).toBeNull();
  });

  it('keeps the single dialog on the root, matching the static aria-labelledby target', () => {
    const el = lootEl();
    renderLootSettingsWindow(el, model(), fakeDeps());
    // The root stays the sole dialog (index.html + Hud focus trap contract).
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-labelledby')).toBe('loot-settings-title');
    // The frame is chrome only: its redundant role/aria are stripped.
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame?.hasAttribute('role')).toBe(false);
    expect(frame?.hasAttribute('aria-labelledby')).toBe(false);
    // The title node the root points at lives inside the frame.
    const title = el.querySelector<HTMLElement>('#loot-settings-title');
    expect(title?.classList.contains('window-title')).toBe(true);
  });

  it('reuses the frame on a second render instead of rebuilding it cold', () => {
    const el = lootEl();
    renderLootSettingsWindow(el, model(), fakeDeps());
    const firstBody = el.querySelector('.window-body');
    renderLootSettingsWindow(el, model({ enabled: true }), fakeDeps());
    expect(el.querySelector('.window-body')).toBe(firstBody);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
  });
});

describe('renderLootSettingsWindow: move / resize / fit parity', () => {
  it('makes the titlebar a drag handle the Hud recognizes, but never the close button', () => {
    const el = lootEl();
    renderLootSettingsWindow(el, model(), fakeDeps());
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(closeBtn, el)).toBe(false);
  });
});

describe('renderLootSettingsWindow: body + callbacks', () => {
  it('renders the leader form and fires onChange when the method changes', () => {
    const el = lootEl();
    const onChange = vi.fn();
    renderLootSettingsWindow(el, model(), fakeDeps({ onChange }));
    const method = el.querySelector<HTMLSelectElement>('#ls-method');
    expect(method).not.toBeNull();
    // Switch to master loot led by pid 2.
    (method as HTMLSelectElement).value = '2';
    method?.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(true, 2, 'uncommon');
  });

  it('renders a read-only body for a non-leader (no method select)', () => {
    const el = lootEl();
    renderLootSettingsWindow(el, model({ isLeader: false }), fakeDeps());
    expect(el.querySelector('#ls-method')).toBeNull();
    expect(el.querySelector('.ls-ro')).not.toBeNull();
  });

  it('escapes interpolated player names through esc() (no live injection)', () => {
    // The effective looter name (a player name) renders in the member read-only
    // body; a hostile name must be escaped, never injected as live markup.
    const el = lootEl();
    renderLootSettingsWindow(
      el,
      model({ isLeader: false, enabled: true, looterName: '<img src=x onerror=alert(1)>' }),
      fakeDeps(),
    );
    const body = el.querySelector('.window-body') as HTMLElement;
    expect(body.querySelector('img')).toBeNull();
    expect(body.innerHTML).toContain('&lt;img');
  });

  it('routes the close control to the injected onClose dep', () => {
    const el = lootEl();
    const onClose = vi.fn();
    renderLootSettingsWindow(el, model(), fakeDeps({ onClose }));
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
