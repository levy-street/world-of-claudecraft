// @vitest-environment jsdom
// The paperdoll cold-open stand-in layer: one node per open, the cached
// headshot when the portrait cache already holds one, and nothing left behind
// on the container once the reveal lands.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const portrait = vi.hoisted(() => ({
  cached: null as string | null,
  peeks: [] as Array<[string, number, string]>,
  kicked: 0,
}));

// Only the PEEK may be reached from here: the stand-in is built at the moment
// the sheet's own context is linking, so kicking a second-context capture
// would land its 43 to 201 ms build, upload and encode on that very frame.
vi.mock('../src/render/characters/portrait', () => ({
  cachedPortraitDataUrl: (visualKey: string, skin: number, framing: string) => {
    portrait.peeks.push([visualKey, skin, framing]);
    return portrait.cached;
  },
  playerPortraitDataUrl: () => {
    portrait.kicked++;
    return null;
  },
  visualPortraitDataUrl: () => {
    portrait.kicked++;
    return null;
  },
}));
vi.mock('../src/ui/portrait_chip', () => ({
  crestUrl: (cls: string) => `data:crest:${cls}`,
}));

import { createPreviewStandIn, PREVIEW_STAND_IN_CLASS } from '../src/ui/preview_stand_in';

const layersIn = (container: HTMLElement): NodeListOf<HTMLElement> =>
  container.querySelectorAll<HTMLElement>(`.${PREVIEW_STAND_IN_CLASS}`);

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  portrait.cached = null;
  portrait.peeks.length = 0;
  portrait.kicked = 0;
});

describe('preview cold-open stand-in', () => {
  it('mints one layer with the class crest and marks the container busy', () => {
    const standIn = createPreviewStandIn(container, { cls: 'mage' });
    // Nothing until show(): an open that skips the gate costs no DOM at all.
    expect(layersIn(container)).toHaveLength(0);

    standIn.show();
    const layers = layersIn(container);
    expect(layers).toHaveLength(1);
    expect(layers[0].querySelector('img')?.getAttribute('src')).toBe('data:crest:mage');
    // Decorative: the container already carries the localized aria-label, so
    // the layer adds no string, only the busy state.
    expect(layers[0].getAttribute('aria-hidden')).toBe('true');
    expect(layers[0].querySelector('img')?.getAttribute('alt')).toBe('');
    expect(container.getAttribute('aria-busy')).toBe('true');
  });

  it('is idempotent: a second show() adds no second layer', () => {
    const standIn = createPreviewStandIn(container, { cls: 'rogue' });
    standIn.show();
    standIn.show();
    expect(layersIn(container)).toHaveLength(1);
  });

  it('hide() removes the node and the busy state, and is safe twice', () => {
    const standIn = createPreviewStandIn(container, { cls: 'rogue' });
    standIn.show();
    standIn.hide();
    expect(layersIn(container)).toHaveLength(0);
    expect(container.hasAttribute('aria-busy')).toBe(false);

    standIn.hide();
    expect(layersIn(container)).toHaveLength(0);
    // ...and a later show() mints a fresh layer.
    standIn.show();
    expect(layersIn(container)).toHaveLength(1);
  });

  it('prefers a CACHED headshot of this exact class and skin over the crest', () => {
    portrait.cached = 'data:portrait:mage3';
    const standIn = createPreviewStandIn(container, { cls: 'mage', skin: 3 });
    standIn.show();

    expect(layersIn(container)[0].querySelector('img')?.getAttribute('src')).toBe(
      'data:portrait:mage3',
    );
    expect(portrait.peeks).toEqual([['player_mage', 3, 'headshot']]);
  });

  it('peeks only: it never kicks a capture, on a hit or a miss', () => {
    createPreviewStandIn(container, { cls: 'druid' }).show();
    portrait.cached = 'data:portrait:druid';
    createPreviewStandIn(container, { cls: 'druid' }).show();

    expect(portrait.kicked).toBe(0);
    // The skin defaults to the first chroma rather than being left out of the
    // key, so a miss can never read another skin's headshot.
    expect(portrait.peeks).toEqual([
      ['player_druid', 0, 'headshot'],
      ['player_druid', 0, 'headshot'],
    ]);
  });
});
