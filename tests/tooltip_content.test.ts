// @vitest-environment happy-dom
// mediawiki/reader/tooltip_content.js tooltipLookup is the XSS boundary for the
// public encyclopedia's hover cards: card HTML is parsed into an inert template
// and only the presentation vocabulary is copied out. These pins feed it hostile
// markup and assert nothing executable or off-path survives, plus positive
// controls proving the allowlist still lets the real tooltip vocabulary through.
import { describe, expect, it } from 'vitest';
// The reader is plain browser JS with no declaration file (tsconfig has no
// allowJs), so the import is typed here. A static import, not a dynamic one, so
// the selective gate's `vitest related` graph still links this file to it.
// @ts-expect-error TS7016: no .d.ts for the reader module
import { tooltipLookup as untypedLookup } from '../mediawiki/reader/tooltip_content.js';

type TooltipLookup = (
  cards: Record<string, unknown>,
  assetUrl: (path: string) => string | null,
) => (title: string) => DocumentFragment | null;
const tooltipLookup = untypedLookup as TooltipLookup;

const ASSET_BASE = 'https://cdn.test/assets';
const assetUrl = (path: string): string => `${ASSET_BASE}${path}`;

/** Render one card through the boundary and serialize what survived. */
function render(card: unknown): string | null {
  const lookup = tooltipLookup({ card }, assetUrl);
  const fragment = lookup('card');
  if (!fragment) return null;
  const host = document.createElement('div');
  host.append(fragment);
  return host.innerHTML;
}

/** Same, but returns the live host element for structural queries. */
function renderHost(card: string): HTMLDivElement {
  const fragment = tooltipLookup({ card }, assetUrl)('card');
  const host = document.createElement('div');
  if (fragment) host.append(fragment);
  return host;
}

describe('tooltipLookup hostile input', () => {
  it('strips the onerror handler from an allowed on-path image', () => {
    const host = renderHost('<img src="/ui/x.webp" alt="X" onerror="alert(1)">');
    const img = host.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(`${ASSET_BASE}/ui/x.webp`);
    expect(img?.hasAttribute('onerror')).toBe(false);
    expect(host.innerHTML).not.toContain('onerror');
    expect(host.innerHTML).not.toContain('alert');
  });

  it('drops a script element and its body', () => {
    const html = render('<div class="tt-title">Safe</div><script>alert(1)</script>');
    expect(html).toBe('<div class="tt-title">Safe</div>');
  });

  it('drops a javascript: link entirely', () => {
    const host = renderHost('<div>a<a href="javascript:alert(1)">x</a>b</div>');
    expect(host.querySelector('a')).toBeNull();
    expect(host.innerHTML).not.toContain('javascript');
    expect(host.innerHTML).toBe('<div>ab</div>');
  });

  it('refuses a url() inline colour', () => {
    const host = renderHost('<div style="color:url(javascript:1)">c</div>');
    const div = host.querySelector('div');
    expect(div?.textContent).toBe('c');
    expect(div?.hasAttribute('style')).toBe(false);
    expect(host.innerHTML).not.toContain('javascript');
  });

  it('refuses a background url() on a span', () => {
    const host = renderHost('<span style="background:url(//evil)">s</span>');
    const span = host.querySelector('span');
    expect(span?.textContent).toBe('s');
    expect(span?.hasAttribute('style')).toBe(false);
    expect(host.innerHTML).not.toContain('evil');
  });

  it('turns an off-path image into its alt text', () => {
    const html = render('<div><img src="https://evil.example/x.png" alt="Evil art"></div>');
    expect(html).toBe('<div>Evil art</div>');
  });
});

describe('tooltipLookup allowed vocabulary', () => {
  it('keeps tt- and q- classes, a hex colour and an on-path item image', () => {
    const host = renderHost(
      '<div class="tt-title q-epic not-allowed" style="color:#ff0000">Blade' +
        '<img src="/ui/items/x.webp" alt="Blade art"></div>',
    );
    const div = host.querySelector('div');
    expect(div?.classList.contains('tt-title')).toBe(true);
    expect(div?.classList.contains('q-epic')).toBe(true);
    // The allowlist is a filter, not a pass-through.
    expect(div?.classList.contains('not-allowed')).toBe(false);
    expect(div?.style.color).not.toBe('');
    expect(div?.getAttribute('style')).toMatch(/#ff0000|rgb\(255, 0, 0\)/i);
    const img = host.querySelector('img');
    expect(img?.getAttribute('src')).toBe(`${ASSET_BASE}/ui/items/x.webp`);
    expect(img?.getAttribute('alt')).toBe('Blade art');
  });
});

describe('tooltipLookup lookup contract', () => {
  it('returns null for an unknown title', () => {
    expect(tooltipLookup({ known: '<div>k</div>' }, assetUrl)('missing')).toBeNull();
  });

  it('returns null for a non-string card', () => {
    expect(render({ html: '<div>x</div>' })).toBeNull();
    expect(render(42)).toBeNull();
  });

  it('does not resolve an inherited prototype key', () => {
    expect(tooltipLookup({}, assetUrl)('constructor')).toBeNull();
  });
});
