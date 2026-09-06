import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import {
  clearPadFocus,
  focusFirstInWindow,
  moveDpadFocus,
  pressDpadFocus,
} from '../../src/game/dpad_focus_nav';
import type { MaterialComposition } from '../../src/sim/material_sources';
import { MaterialSourcesDialog } from '../../src/ui/material_sources_dialog';
import { axeSeriousViolations, cleanup, host } from './_harness';

let dialog: MaterialSourcesDialog | null = null;
afterEach(() => {
  clearPadFocus();
  dialog?.close();
  dialog = null;
  cleanup();
  document.body.className = '';
  document.documentElement.style.removeProperty('--app-vw');
  document.documentElement.style.removeProperty('--app-vh');
  document.documentElement.style.removeProperty('--ui-scale');
});

function mount(width: number, height: number, selectable = true) {
  document.body.className = width < 900 ? 'game-active mobile-touch' : 'game-active';
  document.documentElement.style.setProperty('--app-vw', `${width}px`);
  document.documentElement.style.setProperty('--app-vh', `${height}px`);
  document.documentElement.style.setProperty('--ui-scale', '1');
  const windowRoot = host('bank-window');
  const opener = document.createElement('button');
  opener.className = 'btn';
  opener.textContent = 'Choose sources';
  windowRoot.appendChild(opener);
  const prompts = document.createElement('div');
  prompts.id = 'prompt-stack';
  document.body.appendChild(prompts);
  const sources: MaterialComposition = Array.from({ length: 30 }, (_, index) => ({
    source: {
      gatherer: { kind: 'character', id: index + 1, name: `Collector ${index + 1}` },
      ...(index === 0 ? { signer: 'Renamed Maker' } : {}),
    },
    count: 3,
  }));
  const confirm = vi.fn();
  dialog = new MaterialSourcesDialog();
  opener.focus();
  dialog.open({
    itemName: 'Copper Ore',
    sources,
    opener,
    ...(selectable ? { onConfirm: confirm } : {}),
  });
  const root = document.getElementById('material-sources-dialog')!;
  return { root, windowRoot, opener, confirm, sources };
}

describe('material source prompt in Chromium', () => {
  for (const [width, height] of [
    [1280, 720],
    [844, 390],
    [390, 844],
  ]) {
    it(`keeps all sources and controls usable at ${width}x${height}`, async () => {
      await page.viewport(width, height);
      const { root, windowRoot } = mount(width, height);
      expect(root.querySelectorAll('.material-sources-row')).toHaveLength(30);
      expect(root.textContent).toContain('Collected by Collector 1, signed by Renamed Maker');
      expect(windowRoot.inert).toBe(true);
      const box = root.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(box.bottom).toBeLessThanOrEqual(height);
      const list = root.querySelector<HTMLElement>('.material-sources-list')!;
      expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
      for (const row of root.querySelectorAll<HTMLElement>('.material-sources-row')) {
        const label = row.querySelector<HTMLElement>('.material-sources-label')!;
        const rowBox = row.getBoundingClientRect();
        const labelBox = label.getBoundingClientRect();
        expect(labelBox.top).toBeGreaterThanOrEqual(rowBox.top);
        expect(labelBox.bottom).toBeLessThanOrEqual(rowBox.bottom);
      }
      if (width < 900) {
        for (const control of root.querySelectorAll<HTMLElement>('button, input')) {
          const rect = control.getBoundingClientRect();
          expect(rect.width).toBeGreaterThanOrEqual(40);
          expect(rect.height).toBeGreaterThanOrEqual(40);
        }
      }
      expect(await axeSeriousViolations(root)).toEqual([]);
      await page.screenshot({
        path: `../../docs/screenshots/intentional-gathering-pr2/source-picker-${width}x${height}.png`,
      });
    });
  }

  it('blocks pointer actions in an associated storage window until dismissal', async () => {
    await page.viewport(1280, 720);
    const { opener, sources } = mount(1280, 720);
    const associated = host('bags');
    Object.assign(associated.style, {
      display: 'block', position: 'fixed', left: '10px', top: '10px',
      width: '160px', height: '80px', right: 'auto', bottom: 'auto',
    });
    const behind = document.createElement('button');
    behind.textContent = 'Storage action';
    const action = vi.fn();
    behind.addEventListener('click', action);
    associated.appendChild(behind);
    dialog!.open({ itemName: 'Copper Ore', sources, opener, associatedOwners: [associated] });
    expect(associated.inert).toBe(true);
    await userEvent.click(behind, { force: true });
    expect(action).not.toHaveBeenCalled();
    document.querySelector<HTMLElement>('#material-sources-dialog [data-close]')!.focus();
    await userEvent.keyboard('[Escape]');
    expect(associated.inert).toBe(false);
    await userEvent.click(behind);
    expect(action).toHaveBeenCalledOnce();
  });

  it('returns focus to the live owner after its item rows repaint', async () => {
    await page.viewport(1280, 720);
    const { windowRoot, opener } = mount(1280, 720);
    const close = document.createElement('button');
    close.dataset.close = '';
    close.textContent = 'Close bank';
    windowRoot.replaceChildren(close);
    expect(opener.isConnected).toBe(false);
    await userEvent.keyboard('[Escape]');
    expect(document.getElementById('material-sources-dialog')).toBeNull();
    expect(document.activeElement).toBe(close);
    expect(windowRoot.inert).toBe(false);
  });

  it('traps Tab and returns focus on Escape without closing the bank', async () => {
    await page.viewport(1280, 720);
    const { root, windowRoot, opener, confirm } = mount(1280, 720);
    const cancel = root.querySelector<HTMLElement>('.material-sources-cancel')!;
    cancel.focus();
    await userEvent.keyboard('[Tab]');
    expect(document.activeElement).toBe(root.querySelector('[data-material-sources-close]'));
    await userEvent.keyboard('[ShiftLeft>][Tab][/ShiftLeft]');
    expect(document.activeElement).toBe(cancel);
    root.querySelector<HTMLInputElement>('input')!.focus();
    await userEvent.keyboard('[Escape]');
    expect(root.isConnected).toBe(false);
    expect(windowRoot.inert).toBe(false);
    expect(windowRoot.style.display).toBe('block');
    expect(document.activeElement).toBe(opener);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('lets controller activation choose a quantity before confirming', async () => {
    await page.viewport(844, 390);
    const { root, confirm } = mount(844, 390);
    expect(focusFirstInWindow()).toBe(true);
    expect(root.contains(document.activeElement)).toBe(true);
    const increase = root.querySelector<HTMLButtonElement>('[data-material-source-increase]');
    expect(increase, 'A controller needs a reachable quantity action').not.toBeNull();
    expect(moveDpadFocus('right')).not.toBeNull();
    expect(document.activeElement).toBe(increase);
    expect(pressDpadFocus()).toBe(true);
    expect(root.querySelector<HTMLInputElement>('input')!.value).toBe('1');
    root.querySelector<HTMLElement>('.material-sources-confirm')!.focus();
    expect(pressDpadFocus()).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].count).toBe(1);
  });

  it('native Enter submits chosen units once without reaching game hotkeys', async () => {
    await page.viewport(1280, 720);
    const { root, opener, confirm } = mount(1280, 720);
    const input = root.querySelector<HTMLInputElement>('input')!;
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const gameKey = vi.fn();
    window.addEventListener('keydown', gameKey);
    try {
      root.querySelector<HTMLElement>('.material-sources-confirm')!.focus();
      await userEvent.keyboard('[Enter]');
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0][0].count).toBe(2);
      expect(confirm.mock.calls[0][0].quantities).toEqual([{ sourceIndex: 0, count: 2 }]);
      expect(document.activeElement).toBe(opener);
      expect(gameKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', gameKey);
    }
  });
});
