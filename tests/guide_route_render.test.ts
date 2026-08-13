// @vitest-environment happy-dom

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pageFor } from '../src/guide/pages';
import { GUIDE_ROUTES } from '../src/guide/routes';
import { hydrateCrestImageFallbacks } from '../src/ui/crest_image_fallback';
import { setLanguage } from '../src/ui/i18n';

// An INERT 2D context. happy-dom ships no canvas backend, and the procedural icon
// painter (src/ui/icons.ts) throws without one, so the bestiary, models, and class
// detail pages could not render at all here. Nothing below inspects a pixel: the claim
// under test is the page's TEXT, so every drawing call is a no-op and the few calls that
// must return something return the smallest shape that satisfies their caller. Written as
// a proxy rather than a hand-listed context so a new drawing primitive in the painter
// cannot silently break this suite.
function inertContext2d(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(store, prop: string) {
      if (prop in store) return store[prop];
      switch (prop) {
        case 'measureText':
          return () => ({ width: 0 });
        case 'createLinearGradient':
        case 'createRadialGradient':
        case 'createConicGradient':
          return () => gradient;
        case 'createPattern':
          return () => null;
        case 'getImageData':
          return (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
            width: w,
            height: h,
          });
        case 'canvas':
          return { width: 0, height: 0 };
        default:
          // Every other member is either a drawing call (no-op) or a style property
          // (undefined until something assigns it, which `prop in store` then serves).
          return () => undefined;
      }
    },
    set(store, prop: string, value) {
      store[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

// Every guide route, rendered the way the router renders it. tests/guide.test.ts proves a
// page MODULE is registered for each route; this proves the module actually produces a
// readable page. Its own file because two pages (bestiary, models) paint procedural icons
// through a canvas, so the whole sweep needs a DOM, which the node-environment guide suite
// does not have.
//
// Three failure shapes, all of which reach a reader as visible damage:
//  - an unresolved t() key, which renders as the literal id ("guide.riftsPage.intro")
//  - an uninterpolated {placeholder}, left when a caller renders a parameterized key
//    without passing its values
//  - a heading structure that is not exactly one h1 (the page's own title)
// A key typo, a missing values argument, or a new zone whose key stem has no catalog
// entry all land here. Walking the routes by hand is what the previous wiki refresh did,
// and hand-walking is what let a duplicate zone anchor ship.
describe('Guide route rendering', () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (kind: string) => (kind === '2d' ? inertContext2d() : null) as never,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,');
  });
  afterAll(() => vi.restoreAllMocks());

  it('renders every route with one h1, every key resolved, and no stray placeholder', () => {
    setLanguage('en');
    for (const r of GUIDE_ROUTES) {
      const page = pageFor(r.id);
      expect(page, `route "${r.id}" has no registered page module`).toBeTruthy();
      const html = page?.render({ params: [], sub: r.sub, titleKey: r.navKey }) ?? '';
      expect(html.length, `route "${r.id}" rendered nothing`).toBeGreaterThan(0);

      const h1s = html.match(/<h1[\s>]/g) ?? [];
      expect(h1s.length, `route "${r.id}" must render exactly one h1`).toBe(1);

      // Catalog ids are dotted ('guide.faqPage.intro'); the CSS hooks are hyphenated
      // ('guide-article'), so a dotted match is an unresolved key and nothing else.
      const rawKeys = html.match(/\bguide\.[a-zA-Z0-9_.]+/g) ?? [];
      expect(rawKeys, `route "${r.id}" leaked unresolved t() keys`).toEqual([]);

      // interpolate() leaves an unmatched {token} in place, so this catches a page that
      // renders a parameterized key without passing its values.
      const tokens = html.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) ?? [];
      expect(tokens, `route "${r.id}" left an uninterpolated placeholder`).toEqual([]);
    }
  });

  // The parameterized routes the static list cannot cover: one class detail page and one
  // professions detail page, rendered through the same contract.
  it('renders the parameterized detail pages under the same contract', () => {
    setLanguage('en');
    const cases: { id: string; sub: string; params: string[] }[] = [
      { id: 'classes', sub: 'classes', params: ['warrior'] },
      { id: 'professions', sub: 'professions', params: ['economy'] },
    ];
    for (const c of cases) {
      const page = pageFor(c.id);
      const html = page?.render({ params: c.params, sub: c.sub, titleKey: 'guide.nav.classes' });
      const label = `${c.sub}/${c.params.join('/')}`;
      expect((html?.match(/<h1[\s>]/g) ?? []).length, `${label} must render one h1`).toBe(1);
      expect(html?.match(/\bguide\.[a-zA-Z0-9_.]+/g) ?? [], `${label} leaked keys`).toEqual([]);
      expect(html?.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) ?? [], `${label} left a token`).toEqual([]);
    }
  });

  it('keeps class and creature stills until an error swaps in their exact decorative crest', () => {
    setLanguage('en');
    const cases = [
      {
        routeId: 'classes',
        selector: '.guide-class-card-still[data-crest-fallback-id="class_warrior"]',
        fallbackSize: '128',
        primaryAlt: '',
      },
      {
        routeId: 'bestiary',
        selector: '.guide-creature-still[data-crest-fallback-id="family_beast"]',
        fallbackSize: '96',
        primaryAlt: 'Forest Wolf',
      },
    ];

    for (const c of cases) {
      const page = pageFor(c.routeId);
      const root = document.createElement('div');
      root.innerHTML =
        page?.render({ params: [], sub: c.routeId, titleKey: 'guide.nav.classes' }) ?? '';
      const image = root.querySelector<HTMLImageElement>(c.selector);
      expect(image, `${c.routeId} must retain its exact crest fallback identity`).toBeTruthy();
      if (!image) continue;

      const primarySrc = image.getAttribute('src');
      expect(primarySrc).toMatch(/^\/guide-stills\/.+\.webp$/);
      expect(image.dataset.crestFallbackSize).toBe(c.fallbackSize);
      expect(image.dataset.crestFallbackDecorative).toBe('true');
      expect(image.alt).toBe(c.primaryAlt);

      Object.defineProperties(image, {
        complete: { configurable: true, value: true },
        naturalWidth: { configurable: true, value: 88 },
      });
      hydrateCrestImageFallbacks(root);
      expect(image.getAttribute('src')).toBe(primarySrc);

      image.dispatchEvent(new Event('error'));
      expect(image.getAttribute('src')).not.toBe(primarySrc);
      expect(image.src).toMatch(/^data:image\/png;base64,/);
      expect(image.alt).toBe('');
    }
  });

  it('supplies a class crest fallback for every pet and shapeshift viewer still', () => {
    setLanguage('en');
    for (const cls of ['warlock', 'druid']) {
      const html =
        pageFor('classes')?.render({
          params: [cls],
          sub: 'classes',
          titleKey: 'guide.nav.classes',
        }) ?? '';
      const root = document.createElement('div');
      root.innerHTML = html;
      const posters = [
        ...root.querySelectorAll<HTMLImageElement>('.guide-pet .guide-viewer-poster-still'),
      ];
      expect(posters.length, `${cls} detail page viewer stills`).toBe(3);
      for (const poster of posters) {
        expect(poster.getAttribute('data-poster-fallback')).toBe(`/ui/classes/${cls}.webp`);
      }
    }
  });
});
