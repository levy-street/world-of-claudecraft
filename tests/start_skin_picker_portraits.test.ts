// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshStartSkinPickerPortraits } from '../src/ui/start_skin_picker_portraits';

describe('start skin picker portrait readiness', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section id="offline-select">
        <button class="mini-class sel" data-class="warrior"></button>
      </section>
      <div id="offline-skin-row">
        <button class="skin-swatch" data-skin="1">2</button>
      </div>
      <section id="charcreate-panel">
        <button class="mini-class sel" data-class="mage"></button>
      </section>
      <div id="online-skin-row">
        <button class="skin-swatch" data-skin="1">2</button>
      </div>
    `;
  });

  it('hydrates only the picker whose selected class matches the resolved atlas', () => {
    const portraitUrl = vi.fn(() => 'data:image/png;base64,ready');

    refreshStartSkinPickerPortraits(document, 'player_warrior', 1, portraitUrl);

    expect(portraitUrl).toHaveBeenCalledWith('warrior', 1);
    expect(document.querySelector('#offline-skin-row img')?.getAttribute('src')).toBe(
      'data:image/png;base64,ready',
    );
    expect(document.querySelector('#online-skin-row img')).toBeNull();
    expect(document.querySelector('#online-skin-row .skin-swatch')?.textContent).toBe('2');
  });
});
