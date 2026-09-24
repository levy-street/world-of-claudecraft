// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A composed chip built before its capture landed carries the capture's cache
// KEY; when exactly that key lands, the chip upgrades in place. This is what
// lets a chip whose builder never rebuilds (the player menu's title chip for a
// peer) show that player's face without a second open.

const composedUrl = 'data:image/png;base64,COMPOSED';
const portrait = vi.hoisted(() => ({
  cached: new Map<string, string>(),
  listeners: [] as Array<(visualKey: string, skin: number, key?: string) => void>,
}));

vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: () => undefined,
  onPortraitUpdate: (cb: (visualKey: string, skin: number, key?: string) => void) => {
    portrait.listeners.push(cb);
  },
  // The composed getter answers the cache the test steers, and nothing else
  // (the real one would kick a capture on the miss).
  modularPortraitDataUrl: (
    visualKey: string,
    look: { app: { gender: string } },
    framing = 'headshot',
  ) => portrait.cached.get(`${visualKey}:mod:${look.app.gender}:${framing}`) ?? null,
  playerPortraitDataUrl: () => null,
  visualPortraitDataUrl: () => null,
  portraitsReady: () => true,
  composedPortraitKey: (visualKey: string, look: { app: { gender: string } }, framing: string) =>
    `${visualKey}:mod:${look.app.gender}:${framing}`,
  isComposedPortraitKey: (key?: string) => key?.includes(':mod:') === true,
  cachedPortraitByKey: (key: string) => portrait.cached.get(key) ?? null,
}));
// portrait_chip re-exports modularLookFor from the characters barrel, whose
// real import starts GLB fetches that can outlive happy-dom teardown and
// surface Three FileLoader ProgressEvent rejections after green assertions
// (CI shard 1 on 2211c93118). This suite never resolves a look, so the barrel
// stays inert like the portrait module above.
vi.mock('../src/render/characters', () => ({
  modularLookFor: () => null,
}));
vi.mock('../src/ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/i18n')>()),
  t: () => 'Warrior portrait',
}));
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: () => 'data:image/png;base64,crest',
  // The crest fallback arming paints a procedural crest for a src-less image;
  // happy-dom has no 2D canvas, so the painter is stubbed to its data URL.
  proceduralIconDataUrl: () => 'data:image/png;base64,crest',
}));

import type { ModularLook } from '../src/render/characters/modular';
import { hydrateComposedChips, portraitChipHtml } from '../src/ui/portrait_chip';

const LOOK = { app: { gender: 'female' }, worn: {} } as unknown as ModularLook;
const KEY = 'player_warrior_modular:mod:female:headshot';

function mountChip(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const emit = (key: string): void => {
  for (const cb of portrait.listeners) cb('player_warrior_modular', -1, key);
};

describe('composed chip in-place hydration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    portrait.cached.clear();
  });

  it('stamps a pending composed chip with the key its capture files under', () => {
    const html = portraitChipHtml({ cls: 'warrior', name: 'Ayla', look: LOOK });
    expect(html).toContain('data-portrait-composed="1"');
    expect(html).toContain(`data-portrait-key="${KEY}"`);
    expect(html).toContain('data-portrait-pending="1"');
  });

  it('carries no key once the composed portrait is already cached', () => {
    // The chip ships the real src, so there is nothing left to wait on.
    portrait.cached.set(KEY, composedUrl);
    const html = portraitChipHtml({ cls: 'warrior', name: 'Ayla', look: LOOK });
    expect(html).not.toContain('data-portrait-key');
  });

  it('swaps the landed portrait into the chip waiting on exactly that key', () => {
    const root = mountChip(portraitChipHtml({ cls: 'warrior', name: 'Ayla', look: LOOK }));
    portrait.cached.set(KEY, composedUrl);
    emit(KEY);
    const chip = root.querySelector<HTMLElement>('.portrait-chip')!;
    const img = chip.querySelector<HTMLImageElement>('.portrait-img')!;
    expect(img.getAttribute('src')).toBe(composedUrl);
    expect(chip.classList.contains('is-fallback')).toBe(false);
    expect(chip.hasAttribute('data-portrait-pending')).toBe(false);
  });

  it('fills EVERY chip under root waiting on that key, not the first', () => {
    // In production the player menu chip and the character sheet chip share a
    // key (one look, one capture); a single-chip upgrade would leave the other
    // on its crest.
    const root = mountChip(
      portraitChipHtml({ cls: 'warrior', name: 'Ayla', look: LOOK }) +
        portraitChipHtml({ cls: 'warrior', name: 'Ayla', look: LOOK, variant: 'md' }),
    );
    portrait.cached.set(KEY, composedUrl);
    emit(KEY);
    const imgs = [...root.querySelectorAll<HTMLImageElement>('.portrait-img')];
    expect(imgs).toHaveLength(2);
    for (const img of imgs) expect(img.getAttribute('src')).toBe(composedUrl);
    expect(root.querySelectorAll('.portrait-chip[data-portrait-pending]')).toHaveLength(0);
  });

  it('leaves a chip waiting on a different look alone', () => {
    const root = mountChip(portraitChipHtml({ cls: 'warrior', name: 'Ayla', look: LOOK }));
    const otherKey = 'player_warrior_modular:mod:male:headshot';
    portrait.cached.set(otherKey, composedUrl);
    emit(otherKey);
    const img = root.querySelector<HTMLImageElement>('.portrait-img')!;
    expect(img.getAttribute('src')).not.toBe(composedUrl);
    expect(root.querySelector('.portrait-chip')!.hasAttribute('data-portrait-pending')).toBe(true);
  });

  it('is a no-op while the key has no cached portrait, without starting anything', () => {
    const root = mountChip(portraitChipHtml({ cls: 'warrior', name: 'Ayla', look: LOOK }));
    hydrateComposedChips(root, KEY);
    expect(root.querySelector('.portrait-chip')!.hasAttribute('data-portrait-pending')).toBe(true);
  });

  it('never touches a class chip, whose src hydratePortraits owns', () => {
    const root = mountChip(portraitChipHtml({ cls: 'warrior', name: 'Ayla' }));
    portrait.cached.set(KEY, composedUrl);
    emit(KEY);
    const img = root.querySelector<HTMLImageElement>('.portrait-img')!;
    expect(img.getAttribute('src')).not.toBe(composedUrl);
  });
});
