// @vitest-environment jsdom
//
// Product decisions about the character creator that live in the DOM and
// nowhere else, so a refactor can undo one without a single type error, plus
// the entry-document parity the customizer needs to mount at all.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BODY_SLIDERS,
  DEFAULT_APPEARANCE,
  hslToHex,
  type ModularAppearance,
} from '../src/render/characters/modular';
import { mountAppearanceCustomizer } from '../src/ui/appearance_customizer';

function mount(value?: Partial<ModularAppearance>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let last: ModularAppearance | null = null;
  const ui = mountAppearanceCustomizer(host, {
    value: value ?? null,
    onChange: (v) => {
      last = v;
    },
  });
  return { host, ui, changed: () => last };
}

describe('creator: body proportions are Fit Studio only', () => {
  it('offers no control for any body slider', () => {
    const { host, ui } = mount();
    // Every control that can move a value carries an accessible name; none of
    // them may be a body slider. Checked by name rather than by counting rows
    // so it still holds whatever the rows are rebuilt as.
    const names = [...host.querySelectorAll('[aria-label]')].map((n) =>
      (n.getAttribute('aria-label') ?? '').toLowerCase(),
    );
    for (const key of BODY_SLIDERS) {
      expect(names.some((n) => n.includes(key))).toBe(false);
    }
    // The sculpt sliders that DO belong to the player are still here, so this
    // is not passing because the panel failed to build.
    expect(host.querySelectorAll('input.ac-slider').length).toBeGreaterThan(0);
    ui.destroy();
    host.remove();
  });

  it('keeps the stored body shape untouched rather than discarding it', () => {
    // A body sculpted in the Fit Studio (or by an older build's sliders) must
    // survive a trip through the creator: the rows are gone, the DATA is not.
    const shaped = { ...DEFAULT_APPEARANCE, body: { ...DEFAULT_APPEARANCE.body, shoulders: 0.5 } };
    const { host, ui, changed } = mount(shaped);
    ui.set({ hair: 'mullet' });
    expect(changed()?.body?.shoulders).toBe(0.5);
    ui.destroy();
    host.remove();
  });
});

describe('creator: colour rows lead with presets', () => {
  it('applies a preset exactly and lights that chip alone', () => {
    const { host, ui, changed } = mount();
    const row = [...host.querySelectorAll('.ac-color')].find((r) =>
      /skin/i.test(r.querySelector('.ac-label')?.textContent ?? ''),
    );
    expect(row).toBeTruthy();
    const chips = [...(row?.querySelectorAll('.ac-sw:not(.ac-sw-custom)') ?? [])];
    expect(chips.length).toBeGreaterThan(4);

    const target = chips[chips.length - 1] as HTMLButtonElement;
    target.click();
    const a = changed();
    expect(a).not.toBeNull();
    // The swatch renders the colour it writes: matching the chip's own
    // background proves the preset table and the applied value cannot drift.
    // Compared as rgb() because that is what the DOM normalises a hex to.
    const rgb = hslToHex(a!.skinHue, a!.skinSat, a!.skinLight);
    expect(target.style.background).toBe(
      `rgb(${(rgb >> 16) & 0xff}, ${(rgb >> 8) & 0xff}, ${rgb & 0xff})`,
    );

    const lit = [...(row?.querySelectorAll('.ac-sw.sel') ?? [])];
    expect(lit).toEqual([target]);
    ui.destroy();
    host.remove();
  });

  it('lands an untouched character on a named preset, not on Custom', () => {
    // The palettes carry DEFAULT_APPEARANCE's own four colours. If a palette is
    // ever retuned without keeping them, a brand-new character opens the
    // creator with every colour row reading "Custom", which is both wrong and
    // the first thing anybody sees.
    const { host, ui } = mount();
    for (const row of host.querySelectorAll('.ac-color')) {
      const label = row.querySelector('.ac-label')?.textContent ?? '?';
      expect(
        row.querySelector('.ac-sw-custom')?.classList.contains('sel'),
        `${label} starts on Custom`,
      ).toBe(false);
      expect(row.querySelectorAll('.ac-sw.sel').length, `${label} lights no preset`).toBe(1);
    }
    ui.destroy();
    host.remove();
  });

  it('hides the wheel until Custom asks for it, and marks Custom for an off-palette colour', () => {
    // A hue no preset carries: Custom is the lit chip, and the wheel is still
    // put away until it is asked for.
    const { host, ui } = mount({
      ...DEFAULT_APPEARANCE,
      skinHue: 300,
      skinSat: 0.8,
      skinLight: 0.5,
    });
    const row = [...host.querySelectorAll('.ac-color')].find((r) =>
      /skin/i.test(r.querySelector('.ac-label')?.textContent ?? ''),
    );
    const custom = row?.querySelector('.ac-sw-custom') as HTMLButtonElement;
    const drawer = row?.querySelector('.ac-custom') as HTMLElement;

    expect(custom.classList.contains('sel')).toBe(true);
    expect(drawer.hidden).toBe(true);

    custom.click();
    expect(drawer.hidden).toBe(false);
    expect(custom.getAttribute('aria-expanded')).toBe('true');

    custom.click();
    expect(drawer.hidden).toBe(true);
    ui.destroy();
    host.remove();
  });
});

// Both build entries (index.html at / and play.html at /play) load the same
// src/main.ts, and renderClassDetails('charcreate-class-details', ...) runs on
// both. syncAppearanceUi resolves its host with querySelector and returns
// early when it is missing, while refreshOnlineSkins empties the legacy skin
// row unconditionally: an entry without the mount point loses the customizer
// AND the row it replaced, leaving a bare "Appearance" header. Silent, because
// nothing throws. Regression: the mount div shipped to index.html only.
// tests/entry_window_parity.test.ts does not cover it (this is a plain div
// inside an existing panel, not a `.window panel`), so it is pinned here.
describe('creator: the customizer mount point exists on every entry that creates', () => {
  // cwd, not import.meta.url: this suite runs under jsdom, where import.meta.url
  // is an http:// document URL and `new URL('../x', ...)` resolves to /x.
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const hostIds = (src: string): string[] => {
    const block = src.match(/const APPEARANCE_HOSTS[^=]*=\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    return [...block.matchAll(/'#([\w-]+)'/g)].map((m) => m[1]);
  };

  it('declares a host per creation panel in main.ts', () => {
    // The pin below is only as good as this list, so fail loudly if the map
    // is renamed or emptied rather than silently checking nothing.
    expect(hostIds(read('src/main.ts'))).toEqual(['charcreate-appearance', 'offline-appearance']);
  });

  it('index.html carries both hosts (it owns the offline flow too)', () => {
    const html = read('index.html');
    for (const id of hostIds(read('src/main.ts'))) {
      expect(html, id).toContain(`id="${id}"`);
    }
  });

  it('play.html carries the online host (it is the online-only entry)', () => {
    // #offline-appearance is legitimately index-only: play.html has no
    // #offline-select panel (see ENTRY_ONLY_PANEL_IDS in entry_window_parity).
    const html = read('play.html');
    expect(html).toContain('id="charcreate-appearance"');
    expect(html).not.toContain('id="offline-select"');
  });
});
