// The paperdoll's real pointer path: the preview canvas must stay beneath the
// equipment controls. A programmatic button.click() bypasses hit-testing and
// previously passed even while every mouse press landed on the canvas instead.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { CharWindow } from '../../src/ui/char_window';
import { ItemDragState } from '../../src/ui/item_drag_state';
import { cleanup, host, stubDeps } from './_harness';

afterEach(() => {
  cleanup();
  document.body.className = '';
});

function mountSheet() {
  const root = host('char-window', 'window panel ui-window');
  const player = { name: 'Hoodcheck', level: 60, skin: 0, helmHidden: true };
  const previewPress = vi.fn();
  const toggleHelm = vi.fn(() => {
    player.helmHidden = !player.helmHidden;
    win.renderIfOpen();
  });
  const win = new CharWindow(
    stubDeps({
      root: () => root,
      world: () =>
        ({
          cfg: { playerClass: 'hunter' },
          player,
          equipment: { helmet: 'monarch_crown_helm' },
          honor: 0,
          archetypeTitle: null,
          hobbyCraft: null,
          professionsState: { skills: [] },
        }) as never,
      statCellHtml: () => '',
      statTooltipHtml: () => '',
      progressionHtml: () => '',
      slotName: (slot) => slot,
      itemIcon: () => '<img class="item-icon" alt="">',
      helmSlotAvailable: () => true,
      helmHidden: () => player.helmHidden,
      toggleHelm,
      captureFocus: () => null,
      dragState: new ItemDragState(),
      renderPreview: () => {
        const canvas = document.createElement('canvas');
        canvas.addEventListener('pointerdown', previewPress);
        const stage = root.querySelector('#char-model-preview');
        if (!stage) throw new Error('Character preview stage missing');
        stage.appendChild(canvas);
      },
    }),
  );
  win.render();
  return { root, player, toggleHelm, previewPress };
}

describe('paperdoll helmet visibility through real pointer hit-testing', () => {
  for (const [name, width, height, touch] of [
    ['desktop', 1440, 1000, false],
    // Mobile gameplay uses the landscape sheet behind the portrait rotate gate.
    ['mobile landscape', 844, 390, true],
  ] as const) {
    it(`${name}: shows and hides the hood without pressing the preview behind it`, async () => {
      await page.viewport(width, height);
      document.body.className = touch ? 'game-active mobile-touch' : 'game-active';
      const { root, player, toggleHelm, previewPress } = mountSheet();
      for (const hidden of [false, true]) {
        const eye = root.querySelector<HTMLButtonElement>('.equip-helm-eye');
        if (!eye) throw new Error('Helmet toggle missing');
        // Force bypasses Playwright's interception retry, not browser hit-testing:
        // it sends an actual pointer click to the button's center. A covering
        // canvas receives that click and leaves the assertions below red.
        await userEvent.click(eye, { force: true });
        expect(player.helmHidden).toBe(hidden);
        expect(root.querySelector('.equip-helm-eye')?.getAttribute('aria-pressed')).toBe(
          String(hidden),
        );
      }
      expect(toggleHelm).toHaveBeenCalledTimes(2);
      expect(previewPress).not.toHaveBeenCalled();
      // The uncovered model must still receive pointer presses for rotation.
      const canvas = root.querySelector<HTMLCanvasElement>('#char-model-preview canvas');
      if (!canvas) throw new Error('Character preview canvas missing');
      await userEvent.click(canvas, { force: true });
      expect(previewPress).toHaveBeenCalledOnce();
    });
  }
});
