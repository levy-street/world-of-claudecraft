// Computed font-size alone misses inputs shrunk by #ui's CSS zoom. Measure
// a one-em probe in the control's actual parent with the shipped style barrel.
// Native touch mode must also work when the primary pointer is fine.
import '../../src/styles/index.css';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { showQuantityPrompt } from '../../src/ui/bank_quantity_prompt';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  for (const key of ['--ui-scale', '--app-vw', '--app-vh']) {
    document.documentElement.style.removeProperty(key);
  }
});

function mountControls(scale: number): HTMLElement[] {
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  document.documentElement.style.setProperty('--app-vw', '844px');
  document.documentElement.style.setProperty('--app-vh', '390px');
  document.body.innerHTML = `
    <input id="outside-hud" class="ui-input">
    <div id="ui">
      <div id="prompt-stack"></div>
      <div id="bags" style="display:block"><input class="bag-search ui-input"></div>
      <div id="bank-window" style="display:block"><input class="bag-search ui-input"></div>
      <div id="market-window" style="display:block"><input class="mkt-search ui-input">
        <select class="ui-select"><option>fixture</option></select>
        <textarea class="ui-input"></textarea>
      </div>
    </div>`;
  showQuantityPrompt(
    {
      dismissSiblings: () => undefined,
      installPromptDialog: (_prompt, _opener, close) => ({
        dismiss: close,
        dismissAndReturn: close,
      }),
    },
    {
      className: 'bank-quantity-prompt',
      titleText: 'fixture',
      inputAriaText: 'fixture',
      confirmText: 'fixture',
      cancelText: 'fixture',
      maxCount: 20,
      resolveCount: (n) => n,
      send: () => undefined,
      afterClose: () => undefined,
    },
  );
  return [...document.querySelectorAll<HTMLElement>('input, textarea, select')];
}

function renderedFontSize(control: HTMLElement): number {
  const probe = document.createElement('span');
  // A tall probe avoids a one-em box rounding down by a layout subpixel.
  probe.style.cssText = 'position:absolute;display:block;width:1em;height:100em;';
  probe.style.fontSize = getComputedStyle(control).fontSize;
  control.parentElement!.appendChild(probe);
  const px = probe.getBoundingClientRect().height / 100;
  probe.remove();
  return px;
}

describe('touch input focus-zoom floor in the scaled HUD', () => {
  for (const scale of [0.75, 0.85, 1, 1.4, 2]) {
    it(`keeps quantity and search controls at 16 rendered pixels at UI scale ${scale}`, async () => {
      await page.viewport(844, 390);
      // The browser runner has a fine pointer. This is also a native app's
      // explicit touch mode, independent of its pointer media-query result.
      expect(matchMedia('(pointer: coarse)').matches).toBe(false);
      document.body.className = 'mobile-touch';
      const controls = mountControls(scale);
      expect(controls).toHaveLength(7);
      for (const control of controls) {
        expect(renderedFontSize(control), control.outerHTML).toBeGreaterThanOrEqual(15.99);
      }
      // The pre-game shell is outside #ui: HUD scale must not enlarge it.
      expect(getComputedStyle(document.getElementById('outside-hud')!).fontSize).toBe('16px');
    });
  }

  it('retains the desktop library font without forcing a mobile floor', async () => {
    await page.viewport(1440, 900);
    const controls = mountControls(1);
    expect(getComputedStyle(controls[0]).fontSize).toBe('13px');
    expect(getComputedStyle(document.querySelector('.prompt-number')!).fontSize).toBe('13px');
  });
});
