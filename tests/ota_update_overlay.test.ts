// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OtaOverlayModel } from '../src/net/ota_update_gate';
import { hideOtaUpdateOverlay, renderOtaUpdateOverlay } from '../src/ui/ota_update_overlay';

function model(overrides: Partial<OtaOverlayModel> = {}): OtaOverlayModel {
  return { phase: 'downloading', percent: 42, showContinue: true, fatal: false, ...overrides };
}

const backdrop = () => document.getElementById('ota-update-backdrop');

describe('renderOtaUpdateOverlay', () => {
  beforeEach(() => {
    hideOtaUpdateOverlay();
    document.body.innerHTML = '';
  });

  it('mounts the dialog with title, live progress, and the continue action', () => {
    const onContinue = vi.fn();
    renderOtaUpdateOverlay(model(), { onContinue });
    const root = backdrop();
    expect(root).not.toBeNull();
    expect(root?.querySelector('#ota-update-title')?.textContent).toBe('Game Update');
    expect(root?.querySelector('#ota-update-status')?.textContent).toBe('Downloading update: 42%');
    const bar = root?.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('42');
    const dialog = root?.firstElementChild;
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('ota-update-title');
    const btn = root?.querySelector<HTMLButtonElement>('.ota-update-continue');
    expect(btn?.textContent).toBe('Continue without updating');
    btn?.click();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('updates the mounted dialog in place instead of remounting', () => {
    renderOtaUpdateOverlay(model({ percent: 10 }), { onContinue: () => {} });
    const first = backdrop();
    renderOtaUpdateOverlay(model({ percent: 11 }), { onContinue: () => {} });
    expect(backdrop()).toBe(first);
    expect(document.querySelectorAll('#ota-update-backdrop')).toHaveLength(1);
    expect(first?.querySelector('#ota-update-status')?.textContent).toBe('Downloading update: 11%');
    const fill = first?.querySelector<HTMLElement>('.ota-update-fill');
    expect(fill?.style.width).toBe('11%');
  });

  it('the applying state drops the continue action and swaps the copy', () => {
    renderOtaUpdateOverlay(model(), { onContinue: () => {} });
    renderOtaUpdateOverlay(model({ phase: 'applying', percent: 100, showContinue: false }), {
      onContinue: () => {},
    });
    const root = backdrop();
    expect(root?.querySelector('#ota-update-status')?.textContent).toBe(
      'Update downloaded. Restarting the game to apply it.',
    );
    const btn = root?.querySelector<HTMLElement>('.ota-update-continue');
    expect(btn?.style.display).toBe('none');
  });

  it('fatal mode explains that the update is required', () => {
    renderOtaUpdateOverlay(model({ fatal: true, showContinue: false, percent: 70 }), {
      onContinue: () => {},
    });
    expect(backdrop()?.querySelector('#ota-update-status')?.textContent).toBe(
      'An update is required to play. It will be applied as soon as it finishes downloading.',
    );
  });

  it('hide removes the overlay and a later render remounts cleanly', () => {
    renderOtaUpdateOverlay(model(), { onContinue: () => {} });
    hideOtaUpdateOverlay();
    expect(backdrop()).toBeNull();
    renderOtaUpdateOverlay(model({ percent: 5 }), { onContinue: () => {} });
    expect(backdrop()?.querySelector('#ota-update-status')?.textContent).toBe(
      'Downloading update: 5%',
    );
  });
});
