// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { decorateClassChips } from '../src/ui/portrait_chip';

describe('decorateClassChips', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="charcreate-panel">
        <button class="mini-class" data-class="warrior" data-i18n="classes.warrior">Warrior</button>
      </div>
      <div id="offline-select">
        <button class="mini-class" data-class="mage" data-i18n="classes.mage">Mage</button>
      </div>`;
  });

  it('moves the translated label beside one decorative class portrait, idempotently', () => {
    decorateClassChips();
    decorateClassChips();

    const chip = document.querySelector<HTMLElement>('#charcreate-panel .mini-class');
    const images = chip?.querySelectorAll<HTMLImageElement>('.mini-class-portrait');
    const label = chip?.querySelector<HTMLElement>('.mini-class-label');
    expect(images).toHaveLength(1);
    expect(images?.[0].src).toMatch(/\/ui\/class-icons\/warrior\.webp$/);
    expect(images?.[0].alt).toBe('');
    expect(label?.textContent).toBe('Warrior');
    expect(label?.dataset.i18n).toBe('classes.warrior');
    expect(chip?.hasAttribute('data-i18n')).toBe(false);
    expect(
      document.querySelector<HTMLImageElement>('#offline-select .mini-class-portrait')?.src,
    ).toMatch(/\/ui\/class-icons\/mage\.webp$/);
  });
});
