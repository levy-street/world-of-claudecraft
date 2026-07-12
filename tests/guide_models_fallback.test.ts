// Unit test for the models gallery's no-WebGL branch (src/guide/pages/models.ts mount):
// the fallback note shows, the drag hint hides (there is no model to drag), and the stage
// poster carries a real alt exactly while a still is the page content. Per tests/CLAUDE.md
// this uses a small hand-rolled fake DOM (only the surface mount() queries), never jsdom.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/guide/viewer', () => ({
  hasWebGL: () => false,
  createViewer: vi.fn(),
}));
// The page renders through icons/class crests (canvas) and t(); none of that is under
// test here, so stub the lot and assert on behavior, not labels.
vi.mock('../src/ui/icons', () => ({ iconDataUrl: () => '' }));
vi.mock('../src/guide/class_view', () => ({
  classCrest: () => '',
  className: (id: string) => id,
}));
vi.mock('../src/ui/i18n', () => ({ t: (k: string) => k }));

import { models } from '../src/guide/pages/models';

class FakeEl {
  hidden = false;
  textContent = '';
  src = '';
  alt = '';
  dataset: Record<string, string | undefined> = {};
  style: Record<string, string> = {};
  private attrs: Record<string, string> = {};
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners[type] = this.listeners[type] ?? [];
    this.listeners[type].push(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  fire(type: string, e: unknown): void {
    for (const fn of (this.listeners[type] ?? []).slice()) fn(e);
  }
}

class FakePicker extends FakeEl {
  constructor(private opts: FakeEl[]) {
    super();
  }
  querySelector(sel: string): FakeEl | null {
    if (sel.includes('guide-gallery-opt')) return this.opts[0] ?? null;
    return null;
  }
  querySelectorAll(sel: string): FakeEl[] {
    if (sel.includes('aria-pressed')) {
      return this.opts.filter((o) => o.getAttribute('aria-pressed') === 'true');
    }
    if (sel.includes('guide-gallery-opt')) return this.opts;
    return [];
  }
}

function makeRoot(opts: FakeEl[]) {
  const stage = new FakeEl();
  const picker = new FakePicker(opts);
  const caption = new FakeEl();
  const fallback = new FakeEl();
  fallback.hidden = true;
  const poster = new FakeEl();
  poster.hidden = true;
  const hint = new FakeEl();
  const bySelector: Record<string, FakeEl> = {
    '[data-stage]': stage,
    '.guide-gallery-picker': picker,
    '[data-caption]': caption,
    '[data-fallback]': fallback,
    '[data-poster]': poster,
    '.guide-gallery-hint': hint,
  };
  const root = {
    querySelector: (sel: string) => bySelector[sel] ?? null,
  } as unknown as HTMLElement;
  return { root, picker, caption, fallback, poster, hint };
}

describe('models gallery no-WebGL fallback', () => {
  it('shows the fallback, hides the drag hint, and gives the still a real alt', () => {
    const withStill = new FakeEl();
    withStill.dataset = { still: '/guide-stills/wolf.webp', name: 'Wolf', model: 'wolf' };
    const noStill = new FakeEl();
    noStill.dataset = { name: 'Bare', model: 'bare' };
    const { root, picker, caption, fallback, poster, hint } = makeRoot([withStill, noStill]);

    const cleanup = models.mount?.(root, {
      params: [],
      sub: 'models',
      titleKey: 'guide.nav.models',
    });

    // The fallback note is revealed and the turntable drag hint hidden: there is no model.
    expect(fallback.hidden).toBe(false);
    expect(hint.hidden).toBe(true);

    // The first option auto-selects: its still becomes the stage content WITH an alt.
    expect(withStill.getAttribute('aria-pressed')).toBe('true');
    expect(poster.hidden).toBe(false);
    expect(poster.src).toBe('/guide-stills/wolf.webp');
    expect(poster.alt).toBe('guide.viewer.posterAlt');
    expect(caption.textContent).toBe('Wolf');

    // Picking a figure with no still hides the poster and clears the alt.
    picker.fire('click', { target: { closest: () => noStill } });
    expect(noStill.getAttribute('aria-pressed')).toBe('true');
    expect(withStill.getAttribute('aria-pressed')).toBe('false');
    expect(poster.hidden).toBe(true);
    expect(poster.alt).toBe('');

    expect(() => (cleanup as () => void)?.()).not.toThrow();
  });
});
