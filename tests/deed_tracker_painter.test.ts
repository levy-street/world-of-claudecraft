// @vitest-environment jsdom
// Behavioral pin for the deed-tracker collapse header (src/ui/deed_tracker_painter.ts).
// The aria-expanded live sync and aria-controls contract were pinned only by source
// scans; this drives the real painter against a jsdom container and asserts the header
// attribute flips as the view collapses. The header's click/keydown delegation lives in
// hud.ts (it needs the full Hud) and stays source-pinned there.
import { describe, expect, it, vi } from 'vitest';
import { DeedTrackerPainter } from '../src/ui/deed_tracker_painter';
import { type DeedTrackerView, makeDeedTrackerView } from '../src/ui/deeds_view';
import { makeWriterFacet, type PainterHostWriters } from '../src/ui/painter_host';

// hudChrome.deeds.openBookHint lands in the English catalog module in this change,
// but the resolved runtime table is regenerated centrally as a later step, so t()
// would throw on it here (untracked key). Shim ONLY that one key; every other key
// delegates to the real table so the painter renders exactly as in production.
vi.mock('../src/ui/i18n', async (importActual) => {
  const actual = await importActual<typeof import('../src/ui/i18n')>();
  const realT = actual.t as (k: string, v?: Record<string, unknown>) => string;
  return {
    ...actual,
    t: (key: string, values?: Record<string, unknown>) =>
      key === 'hudChrome.deeds.openBookHint' ? 'Open the Book of Deeds' : realT(key, values),
  };
});

// A live facet that performs the real DOM writes (no elision), so the rendered
// attributes/styles can be read back off the jsdom tree.
function liveWriters(): PainterHostWriters {
  return {
    setText: (el, text) => {
      el.textContent = text;
    },
    setDisplay: (el, display) => {
      el.style.display = display;
    },
    setTransform: (el, transform) => {
      el.style.transform = transform;
    },
    setWidth: (el, width) => {
      el.style.width = width;
    },
    setStyleProp: (el, prop, value) => {
      el.style.setProperty(prop, value);
    },
    toggleClass: (el, cls, on) => {
      el.classList.toggle(cls, on);
    },
    setAttr: (el, name, value) => {
      el.setAttribute(name, value);
    },
  };
}

// One visible, watched deed line; `collapsed` and `chip` vary between paints.
function view(collapsed: boolean, chip = false): DeedTrackerView {
  const v = makeDeedTrackerView();
  v.visible = true;
  v.collapsed = collapsed;
  v.chip = chip;
  v.count = 1;
  v.lines[0].id = 'pvp_fiesta_first_bout';
  return v;
}

describe('DeedTrackerPainter: collapse header live sync', () => {
  it('flips aria-expanded true -> false and hides the watch list as the view collapses', () => {
    const root = document.createElement('div');
    const painter = new DeedTrackerPainter({ root: () => root, writers: liveWriters() });
    const header = root.querySelector('.dt-header') as HTMLElement;
    const list = root.querySelector('.dt-list') as HTMLElement;

    // The static skeleton carries the aria-controls -> watch-list wiring once.
    expect(header.getAttribute('aria-controls')).toBe('deed-watch-list');
    expect(list.id).toBe('deed-watch-list');

    // Expanded: the header advertises an open region and the list shows.
    painter.update(view(false));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(list.style.display).toBe('');

    // Collapsed: aria-expanded tracks the state and the list hides.
    painter.update(view(true));
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(list.style.display).toBe('none');
  });
});

describe('DeedTrackerPainter: chip-mode header contract', () => {
  it('swaps to the dialog-opener contract in chip mode and restores disclosure on flip-back', () => {
    const root = document.createElement('div');
    // The REAL eliding facet (Hud's caches), not liveWriters: the setAttr cache is
    // exactly what the flip-back assertion pins against. A raw removeAttribute on
    // the chip transition leaves the cache holding the old aria-expanded value, so a
    // naive re-add via setAttr alone would be elided and never restore it.
    const painter = new DeedTrackerPainter({
      root: () => root,
      writers: makeWriterFacet(
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        () => {},
        () => {},
      ),
    });
    const header = root.querySelector('.dt-header') as HTMLElement;

    // Disclosure first (the quest-tracker contract): aria-expanded + aria-controls,
    // no dialog affordance.
    painter.update(view(false, false));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.getAttribute('aria-controls')).toBe('deed-watch-list');
    expect(header.hasAttribute('aria-haspopup')).toBe(false);

    // Chip mode: the header opens the Book dialog. The inline disclosure a11y is
    // dropped and it advertises a dialog opener with the open-Book hint.
    painter.update(view(false, true));
    expect(header.hasAttribute('aria-expanded')).toBe(false);
    expect(header.hasAttribute('aria-controls')).toBe(false);
    expect(header.getAttribute('aria-haspopup')).toBe('dialog');
    expect(header.getAttribute('title')).toBe('Open the Book of Deeds');

    // Flip back to disclosure: aria-expanded returns (the decisive pin against the
    // setAttr elision-cache trap, which would otherwise elide re-adding it after the
    // raw removeAttribute) and the dialog affordance is gone.
    painter.update(view(false, false));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.hasAttribute('aria-haspopup')).toBe(false);
    expect(header.getAttribute('aria-controls')).toBe('deed-watch-list');
  });
});
