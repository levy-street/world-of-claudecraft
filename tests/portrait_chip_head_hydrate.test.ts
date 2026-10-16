// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A chip for a WOC class body shows that PLAYER's own modular head (their hair,
// beard, face and colours), keyed by that head (portrait.ts visualPortraitKey).
// A pending chip cannot re-derive an appearance from its data attributes, so the
// builder files the request under the key the chip carries and hydratePortraits
// re-asks through it. Before this, every pending chip (the character list, the
// menus, the sheet title) re-derived the body's DEFAULT head.

const portrait = vi.hoisted(() => ({
  cached: new Map<string, string>(),
  ready: true,
  listeners: [] as Array<(visualKey: string, skin: number, key?: string) => void>,
  readyListeners: [] as Array<() => void>,
}));

vi.mock('../src/render/characters/portrait', () => {
  // The key rule's contract, in miniature: a head with a hairstyle keys on it, any
  // other head keys like no head at all (the real signature: woc_head_look_core.ts).
  const keyOf = (
    visualKey: string,
    skin = 0,
    framing = 'headshot',
    head?: { headHair?: string } | null,
  ): string =>
    head?.headHair
      ? `${visualKey}:${skin}:${framing}:head:${head.headHair}`
      : `${visualKey}:${skin}:${framing}`;
  return {
    onPortraitsReady: (cb: () => void) => {
      portrait.readyListeners.push(cb);
    },
    onPortraitUpdate: (cb: (visualKey: string, skin: number, key?: string) => void) => {
      portrait.listeners.push(cb);
    },
    modularPortraitDataUrl: () => null,
    // The live getter answers the cache the test steers (the real one kicks a
    // capture on a miss, which is what a call here stands for).
    visualPortraitDataUrl: vi.fn(
      (visualKey: string, skin = 0, framing = 'headshot', head?: { headHair?: string }) =>
        portrait.ready
          ? (portrait.cached.get(keyOf(visualKey, skin, framing, head)) ?? null)
          : null,
    ),
    visualPortraitKey: keyOf,
    isHeadPortraitKey: (key?: string) => key?.includes(':head:') === true,
    portraitsReady: () => portrait.ready,
    composedPortraitKey: () => 'player_warrior_modular:mod:unused:headshot',
    isComposedPortraitKey: (key?: string) => key?.includes(':mod:') === true,
    cachedPortraitByKey: (key: string) => portrait.cached.get(key) ?? null,
  };
});
// The characters barrel's real import starts GLB fetches (see the composed suite).
vi.mock('../src/render/characters', () => ({ modularLookFor: () => null }));
vi.mock('../src/ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/i18n')>()),
  t: () => 'Portrait',
}));
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: () => 'data:image/png;base64,crest',
  proceduralIconDataUrl: () => 'data:image/png;base64,crest',
}));

import { visualPortraitDataUrl } from '../src/render/characters/portrait';
import {
  HEAD_CHIP_REQUESTS_MAX,
  hydratePortraits,
  portraitChipHtml,
} from '../src/ui/portrait_chip';

const MOHAWK = { gender: 'male', headHair: 'mohawk', headBeard: 'long' };
const HEAD_KEY = 'player_warrior:0:headshot:head:mohawk';
const STOCK_KEY = 'player_warrior:0:headshot';
const headUrl = 'data:image/png;base64,MOHAWK';
const stockUrl = 'data:image/png;base64,STOCK';

function mountChip(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const img = (root: ParentNode): HTMLImageElement | null =>
  root.querySelector<HTMLImageElement>('.portrait-img');
const chipOf = (root: ParentNode): HTMLElement | null =>
  root.querySelector<HTMLElement>('.portrait-chip');
/** A capture landing for (visualKey, skin): head-keyed captures report no key. */
const land = (visualKey = 'player_warrior', skin = 0): void => {
  for (const cb of portrait.listeners) cb(visualKey, skin);
};

describe('head-keyed portrait chips', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    portrait.cached.clear();
    portrait.ready = true;
    vi.mocked(visualPortraitDataUrl).mockClear();
  });

  it("asks for the player's OWN head and, pending, waits on that head's key", () => {
    const html = portraitChipHtml({ cls: 'warrior', name: 'Rurik', appearance: MOHAWK });
    expect(visualPortraitDataUrl).toHaveBeenCalledWith('player_warrior', 0, 'headshot', MOHAWK);
    expect(html).toContain('data-portrait-pending="1"');
    expect(html).toContain('data-portrait-head="1"');
    expect(html).toContain(`data-portrait-key="${HEAD_KEY}"`);
    // never mistaken for a composed chip, which only its builder repaints
    expect(html).not.toContain('data-portrait-composed');
  });

  it('upgrades in place when THAT head lands, never to the default face', () => {
    const root = mountChip(portraitChipHtml({ cls: 'warrior', name: 'Rurik', appearance: MOHAWK }));
    // the body's stock face landing is not this chip's portrait
    portrait.cached.set(STOCK_KEY, stockUrl);
    land();
    expect(img(root)?.getAttribute('src')).not.toBe(stockUrl);
    expect(chipOf(root)?.hasAttribute('data-portrait-pending')).toBe(true);
    // the head capture lands (reported by visual and skin, like every head capture)
    portrait.cached.set(HEAD_KEY, headUrl);
    land();
    expect(img(root)?.getAttribute('src')).toBe(headUrl);
    expect(chipOf(root)?.hasAttribute('data-portrait-pending')).toBe(false);
    expect(chipOf(root)?.classList.contains('is-fallback')).toBe(false);
  });

  it('kicks the head capture on the assets landing for a chip built before them', () => {
    portrait.ready = false;
    const root = mountChip(portraitChipHtml({ cls: 'warrior', name: 'Rurik', appearance: MOHAWK }));
    expect(chipOf(root)?.dataset.portraitKey).toBe(HEAD_KEY);
    vi.mocked(visualPortraitDataUrl).mockClear();
    portrait.ready = true;
    for (const cb of portrait.readyListeners) cb();
    // the re-ask carries the head: the capture it starts is this player's face
    expect(visualPortraitDataUrl).toHaveBeenCalledWith('player_warrior', 0, 'headshot', MOHAWK);
    expect(visualPortraitDataUrl).not.toHaveBeenCalledWith('player_warrior', 0, 'headshot');
    portrait.cached.set(HEAD_KEY, headUrl);
    land();
    expect(img(root)?.getAttribute('src')).toBe(headUrl);
  });

  it('ships the real src and no key once the head is cached', () => {
    portrait.cached.set(HEAD_KEY, headUrl);
    const html = portraitChipHtml({ cls: 'warrior', name: 'Rurik', appearance: MOHAWK });
    expect(html).toContain(`src="${headUrl}"`);
    expect(html).not.toContain('data-portrait-head');
    expect(html).not.toContain('data-portrait-pending');
  });

  it('keeps a default head a stock chip: no head key, the stock getter', () => {
    const html = portraitChipHtml({
      cls: 'warrior',
      name: 'Rurik',
      appearance: { gender: 'male' },
    });
    expect(visualPortraitDataUrl).toHaveBeenCalledWith('player_warrior', 0, 'headshot', undefined);
    expect(html).not.toContain('data-portrait-head');
    const root = mountChip(html);
    portrait.cached.set(STOCK_KEY, stockUrl);
    land();
    expect(img(root)?.getAttribute('src')).toBe(stockUrl);
  });

  it('files the head for a deferred chip too, so its hydration draws that face', () => {
    const root = mountChip(
      portraitChipHtml({ cls: 'warrior', name: 'Rurik', appearance: MOHAWK, deferSource: true }),
    );
    expect(chipOf(root)?.dataset.portraitHead).toBe('1');
    portrait.cached.set(STOCK_KEY, stockUrl);
    portrait.cached.set(HEAD_KEY, headUrl);
    hydratePortraits(root);
    expect(img(root)?.getAttribute('src')).toBe(headUrl);
  });

  it('draws the mech, never a head, for a mech wearer', () => {
    const html = portraitChipHtml({
      cls: 'warrior',
      name: 'Rurik',
      appearance: MOHAWK,
      catalog: 'mech',
      skin: 2,
    });
    expect(visualPortraitDataUrl).toHaveBeenCalledWith('player_mech', 2, 'headshot');
    expect(html).not.toContain('data-portrait-head');
  });

  it('bounds the filed requests: an aged-out chip keeps its crest, never a stock face', () => {
    const heads = Array.from({ length: HEAD_CHIP_REQUESTS_MAX + 1 }, (_, i) => ({
      gender: 'male',
      headHair: `h${i}`,
    }));
    const root = mountChip(portraitChipHtml({ cls: 'warrior', name: 'Old', appearance: heads[0] }));
    // a crowd of newer heads files past the cap: the oldest request is dropped
    for (const head of heads.slice(1)) {
      portraitChipHtml({ cls: 'warrior', name: 'New', appearance: head });
    }
    vi.mocked(visualPortraitDataUrl).mockClear();
    portrait.cached.set(STOCK_KEY, stockUrl);
    land();
    // nothing re-asked for the dropped head (no capture), and no stock face drawn
    expect(visualPortraitDataUrl).not.toHaveBeenCalled();
    expect(img(root)?.getAttribute('src')).not.toBe(stockUrl);
    expect(chipOf(root)?.hasAttribute('data-portrait-pending')).toBe(true);
    // its portrait landing anyway (another consumer asked) still reaches it by key
    portrait.cached.set('player_warrior:0:headshot:head:h0', headUrl);
    land();
    expect(img(root)?.getAttribute('src')).toBe(headUrl);
  });

  it('caps the requests at the portrait cache cap they feed', () => {
    // a literal in portrait_chip.ts (module scope must not read a mocked export)
    // (repo-root relative: happy-dom's import.meta.url is not a file URL)
    const source = readFileSync(join(process.cwd(), 'src/render/characters/portrait.ts'), 'utf8');
    expect(source).toContain(
      `export const MODULAR_PORTRAIT_CACHE_MAX = ${HEAD_CHIP_REQUESTS_MAX};`,
    );
  });
});
