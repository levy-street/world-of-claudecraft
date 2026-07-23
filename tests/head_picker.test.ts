// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/i18n', () => ({
  t: (key: string, vars?: { n?: number }) => `${key}${vars?.n === undefined ? '' : ` ${vars.n}`}`,
}));

import { renderHeadPicker } from '../src/ui/head_picker';

describe('renderHeadPicker keyboard focus', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="head-row"></div>';
  });

  it.each([
    ['face-1', 'face-1'],
    ['face-tone-1', 'face-tone-1'],
    ['hair-1', 'hair-1'],
    ['beard', 'beard'],
  ])('keeps focus on the rebuilt %s control', (key, expected) => {
    renderHeadPicker('#head-row', 'warrior', { face: 0, hairStyle: 0, beard: false }, () => {});
    const button = document.querySelector<HTMLElement>(`[data-head-focus="${key}"]`);
    expect(button).not.toBeNull();
    button?.focus();
    button?.click();
    expect((document.activeElement as HTMLElement | null)?.dataset.headFocus).toBe(expected);
  });

  it('emits a copied, coherent state and clears an unsupported beard on face change', () => {
    const onChange = vi.fn();
    renderHeadPicker('#head-row', 'warrior', { face: 0, hairStyle: 3, beard: true }, onChange);

    document.querySelector<HTMLButtonElement>('[data-head-focus="face-1"]')?.click();

    expect(onChange).toHaveBeenLastCalledWith({ face: 1, hairStyle: 0, beard: false });
    const emitted = onChange.mock.lastCall?.[0];
    document.querySelector<HTMLButtonElement>('[data-head-focus="hair-1"]')?.click();
    expect(emitted).toEqual({ face: 1, hairStyle: 0, beard: false });
    expect(onChange).toHaveBeenLastCalledWith({ face: 1, hairStyle: 1, beard: false });
    expect(document.querySelector('[data-head-focus="hair-1"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('emits selected skin tone and exact six-digit hair colour', () => {
    const onChange = vi.fn();
    renderHeadPicker('#head-row', 'warrior', { face: 0, hairStyle: 0, beard: false }, onChange);

    document.querySelector<HTMLButtonElement>('[data-head-focus="face-tone-1"]')?.click();
    expect(onChange.mock.lastCall?.[0].faceColor).toBe(0xd8ccbf);
    document.querySelector<HTMLButtonElement>('[data-head-focus="face-tone-0"]')?.click();
    expect(onChange.mock.lastCall?.[0].faceColor).toBeUndefined();

    const color = document.querySelector<HTMLInputElement>('[data-head-focus="hair-color"]');
    expect(color).not.toBeNull();
    if (color) {
      color.value = '#010203';
      color.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(onChange.mock.lastCall?.[0].hairColor).toBe(0x010203);
  });

  it('toggles beard state and aria-pressed together', () => {
    const onChange = vi.fn();
    renderHeadPicker('#head-row', 'warrior', { face: 0, hairStyle: 0, beard: false }, onChange);

    document.querySelector<HTMLButtonElement>('[data-head-focus="beard"]')?.click();

    expect(onChange).toHaveBeenLastCalledWith({ face: 0, hairStyle: 0, beard: true });
    expect(document.querySelector('[data-head-focus="beard"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
