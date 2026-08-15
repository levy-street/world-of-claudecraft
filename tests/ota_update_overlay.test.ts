// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { OtaOverlayModel } from '../src/net/ota_update_gate';
import { hideOtaUpdateOverlay, renderOtaUpdateOverlay } from '../src/ui/ota_update_overlay';

function model(overrides: Partial<OtaOverlayModel> = {}): OtaOverlayModel {
  return { phase: 'downloading', percent: 42, fatal: false, ...overrides };
}

const backdrop = () => document.getElementById('ota-update-backdrop');

describe('renderOtaUpdateOverlay', () => {
  beforeEach(() => {
    hideOtaUpdateOverlay();
    document.body.innerHTML = '';
  });

  it('mounts the dialog with title and live progress, and offers no cancel action', () => {
    renderOtaUpdateOverlay(model());
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
    // The no-cancel contract: while the update is loading the dialog renders
    // no button (and no interactive control of any kind), so the player
    // cannot skip the update from here.
    expect(root?.querySelectorAll('button, [role="button"], a, input')).toHaveLength(0);
  });

  it('lands keyboard focus on the dialog root, the only focus target left', async () => {
    renderOtaUpdateOverlay(model());
    // The focus is deferred one tick (layout-before-focus, like
    // native_update_prompt); a broken tabindex on the dialog root would leave
    // focus on body and fail this.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const dialog = backdrop()?.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
  });

  it('updates the mounted dialog in place instead of remounting', () => {
    renderOtaUpdateOverlay(model({ percent: 10 }));
    const first = backdrop();
    renderOtaUpdateOverlay(model({ percent: 11 }));
    expect(backdrop()).toBe(first);
    expect(document.querySelectorAll('#ota-update-backdrop')).toHaveLength(1);
    expect(first?.querySelector('#ota-update-status')?.textContent).toBe('Downloading update: 11%');
    const fill = first?.querySelector<HTMLElement>('.ota-update-fill');
    expect(fill?.style.width).toBe('11%');
  });

  it('the applying state swaps the copy and stays button-free', () => {
    renderOtaUpdateOverlay(model());
    renderOtaUpdateOverlay(model({ phase: 'applying', percent: 100 }));
    const root = backdrop();
    expect(root?.querySelector('#ota-update-status')?.textContent).toBe(
      'Update downloaded. Restarting the game to apply it.',
    );
    expect(root?.querySelectorAll('button')).toHaveLength(0);
  });

  it('fatal mode explains that the update is required', () => {
    renderOtaUpdateOverlay(model({ fatal: true, percent: 70 }));
    expect(backdrop()?.querySelector('#ota-update-status')?.textContent).toBe(
      'An update is required to play. It will be applied as soon as it finishes downloading.',
    );
  });

  it('hide removes the overlay and a later render remounts cleanly', () => {
    renderOtaUpdateOverlay(model());
    hideOtaUpdateOverlay();
    expect(backdrop()).toBeNull();
    renderOtaUpdateOverlay(model({ percent: 5 }));
    expect(backdrop()?.querySelector('#ota-update-status')?.textContent).toBe(
      'Downloading update: 5%',
    );
  });
});
