// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { decorativeArtImg } from '../src/ui/decorative_art';

// The shared decorative contract for painted chrome art (banner, chat log,
// quest attunement preview): the a11y shape lives HERE so the three surfaces
// cannot drift apart on it. Literal pins, so a helper edit that weakens any
// leg of the contract fails loudly.
describe('decorativeArtImg', () => {
  it('builds one decorative img: class + src + the full assistive-tech opt-out', () => {
    const img = decorativeArtImg(document, 'banner-art', '/ui/professions/masterwork_seal.webp');

    expect(img.tagName).toBe('IMG');
    expect(img.className).toBe('banner-art');
    expect(img.getAttribute('src')).toBe('/ui/professions/masterwork_seal.webp');
    // Empty alt AND aria-hidden: the art must never reach the accessibility
    // tree, so the surface's announced text stays exactly the localized line.
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    // Drag-disabled so the art never ghosts out of the chrome.
    expect(img.draggable).toBe(false);
  });

  it('creates through the caller-supplied document, never a global', () => {
    let created = 0;
    const doc = {
      createElement: (tag: string) => {
        created += 1;
        return document.createElement(tag);
      },
    } as unknown as Document;

    const img = decorativeArtImg(doc, 'qd-profession-crest', '/ui/professions/prof_alchemy.webp');
    expect(created).toBe(1);
    expect(img.className).toBe('qd-profession-crest');
  });
});
