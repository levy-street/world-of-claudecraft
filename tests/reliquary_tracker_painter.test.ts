// @vitest-environment happy-dom
// Behavioral pin for the Reliquary tracker painter (src/ui/reliquary_tracker_painter.ts),
// the deed_tracker_painter rig scoped to the collection strip: the collapse
// header's live aria-expanded sync, the chip-mode dialog-opener swap and its
// flip-back (the setAttr elision-cache trap), the row contents, the fill-flash
// class, and the write-elision contract an always-on slow-band painter lives by.
// The header's click/keydown delegation lives in hud.ts (it needs the full Hud)
// and stays source-pinned in tests/reliquary_tracker_view.test.ts.
import { describe, expect, it } from 'vitest';
import { t } from '../src/ui/i18n';
import { makeWriterFacet, type PainterHostWriters } from '../src/ui/painter_host';
import { ReliquaryTrackerPainter } from '../src/ui/reliquary_tracker_painter';
import {
  makeReliquaryTrackerView,
  RELIQUARY_TRACK_CAP,
  type ReliquaryTrackerView,
} from '../src/ui/reliquary_tracker_view';

// A live facet that performs the real DOM writes (no elision), so the rendered
// text/attributes/styles can be read back off the happy-dom tree.
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

/** A real eliding facet plus the write/skip counters Hud keeps. */
function countingWriters(): { writers: PainterHostWriters; counts: { writes: number } } {
  const counts = { writes: 0 };
  const writers = makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => {
      counts.writes++;
    },
    () => {},
  );
  return { writers, counts };
}

/** One visible tracked page; `collapsed`, `chip`, and the flash vary per paint. */
function view(
  opts: { collapsed?: boolean; chip?: boolean; owned?: number; flash?: boolean } = {},
): ReliquaryTrackerView {
  const v = makeReliquaryTrackerView();
  v.visible = true;
  v.collapsed = opts.collapsed ?? false;
  v.chip = opts.chip ?? false;
  v.count = 1;
  v.lines[0].pageId = 'crypt_of_the_nine';
  v.lines[0].owned = opts.owned ?? 4;
  v.lines[0].total = 10;
  v.lines[0].flash = opts.flash ?? false;
  return v;
}

describe('ReliquaryTrackerPainter: collapse header live sync', () => {
  it('flips aria-expanded true to false and hides the pin list as the view collapses', () => {
    const root = document.createElement('div');
    const painter = new ReliquaryTrackerPainter({ root: () => root, writers: liveWriters() });
    const header = root.querySelector('.dt-header') as HTMLElement;
    const list = root.querySelector('.dt-list') as HTMLElement;

    // The static skeleton carries the aria-controls -> pin-list wiring once, and
    // the id is the tracker's OWN (never the deed tracker's watch list).
    expect(header.getAttribute('aria-controls')).toBe('reliquary-pin-list');
    expect(list.id).toBe('reliquary-pin-list');

    painter.update(view());
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(list.style.display).toBe('');

    painter.update(view({ collapsed: true }));
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(list.style.display).toBe('none');
  });

  it('hides the whole strip when the view is not visible', () => {
    const root = document.createElement('div');
    const painter = new ReliquaryTrackerPainter({ root: () => root, writers: liveWriters() });
    const empty = makeReliquaryTrackerView();
    painter.update(empty);
    expect(root.style.display).toBe('none');
  });
});

describe('ReliquaryTrackerPainter: rows', () => {
  it('paints the page name, the progress pair, and the bar fill', () => {
    const root = document.createElement('div');
    const painter = new ReliquaryTrackerPainter({ root: () => root, writers: liveWriters() });
    painter.update(view({ owned: 4 }));
    const line = root.querySelector('.dt-line') as HTMLElement;
    expect(line.style.display).toBe('');
    // Live t() / label calls, never hardcoded English: a locale fill must not
    // turn this pin red, and an English-only regression must not hide in it.
    expect((line.querySelector('.dt-name') as HTMLElement).textContent).toBe(
      // The synthetic id is not in the catalog, so the name channel falls back
      // to the raw id: that fallback IS the contract for a drifted id.
      'crypt_of_the_nine',
    );
    expect((line.querySelector('.dt-count') as HTMLElement).textContent).toBe(
      t('hudChrome.reliquary.progressText', { owned: '4', total: '10' }),
    );
    expect((line.querySelector('.dt-bar-fill') as HTMLElement).style.width).toBe('40%');
    // The tally reuses the quest-tracker count shape rather than a duplicate key.
    expect((root.querySelector('.dt-tally') as HTMLElement).textContent).toBe(
      t('hudChrome.questTracker.count', { count: '1' }),
    );
    // Unused pool slots stay hidden.
    const lines = [...root.querySelectorAll<HTMLElement>('.dt-line')];
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[1].style.display).toBe('none');
  });

  it('toggles the fill-flash class on and back off with the view flag', () => {
    const root = document.createElement('div');
    const painter = new ReliquaryTrackerPainter({ root: () => root, writers: liveWriters() });
    const line = root.querySelector('.dt-line') as HTMLElement;
    painter.update(view({ flash: false }));
    expect(line.classList.contains('dt-flash')).toBe(false);
    painter.update(view({ owned: 5, flash: true }));
    expect(line.classList.contains('dt-flash')).toBe(true);
    painter.update(view({ owned: 5, flash: false }));
    expect(line.classList.contains('dt-flash')).toBe(false);
  });

  it('clears the flash from a slot whose row left the strip mid-hold', () => {
    // Through the REAL eliding facet: a hide path that skipped the clear would
    // leave the class on the pooled node AND 'on' in the multi-slot cache, so
    // the next page recycled into this slot could never flash again (the
    // toggle would elide against the stale entry). The shrink is a core-
    // reachable shape (five tracked lines dropping to two, visible stays
    // true), so a clear scoped to slot 0 or gated on emptiness fails here.
    const last = RELIQUARY_TRACK_CAP - 1;
    const fullLit = (flashSlot: number): ReliquaryTrackerView => {
      const v = makeReliquaryTrackerView();
      v.visible = true;
      v.count = RELIQUARY_TRACK_CAP;
      for (let i = 0; i < RELIQUARY_TRACK_CAP; i++) {
        v.lines[i].pageId = `page_${i}`;
        v.lines[i].owned = 3;
        v.lines[i].total = 10;
        v.lines[i].flash = i === flashSlot;
      }
      return v;
    };
    const root = document.createElement('div');
    const { writers } = countingWriters();
    const painter = new ReliquaryTrackerPainter({ root: () => root, writers });
    const lines = [...root.querySelectorAll<HTMLElement>('.dt-line')];
    painter.update(fullLit(last));
    expect(lines[last].classList.contains('dt-flash')).toBe(true);
    const shrunk = fullLit(-1);
    shrunk.count = 2;
    painter.update(shrunk);
    // The hidden slot lost the class with the row (the pin the fix earns).
    expect(lines[last].classList.contains('dt-flash')).toBe(false);
    expect(lines[last].style.display).toBe('none');
    // A different page recycled into the slot pulses for real: the cache was
    // cleared, so this toggle writes instead of eliding.
    const recycled = fullLit(last);
    recycled.lines[last].pageId = 'page_recycled';
    painter.update(recycled);
    expect(lines[last].classList.contains('dt-flash')).toBe(true);
  });
});

describe('ReliquaryTrackerPainter: chip-mode header contract', () => {
  it('swaps to the dialog-opener contract in chip mode and restores disclosure on flip-back', () => {
    const root = document.createElement('div');
    // The REAL eliding facet (Hud's caches), not liveWriters: the setAttr cache is
    // exactly what the flip-back assertion pins against. A raw removeAttribute on
    // the chip transition leaves the cache holding the old aria-expanded value, so a
    // naive re-add via setAttr alone would be elided and never restore it.
    const painter = new ReliquaryTrackerPainter({
      root: () => root,
      writers: countingWriters().writers,
    });
    const header = root.querySelector('.dt-header') as HTMLElement;

    painter.update(view({ chip: false }));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.getAttribute('aria-controls')).toBe('reliquary-pin-list');
    expect(header.hasAttribute('aria-haspopup')).toBe(false);
    expect(header.getAttribute('title')).toBe(t('hudChrome.reliquary.collapseHint'));

    // Chip mode: the header opens The Reliquary. The inline disclosure a11y is
    // dropped and it advertises a dialog opener with the open-window hint.
    painter.update(view({ chip: true }));
    expect(header.hasAttribute('aria-expanded')).toBe(false);
    expect(header.hasAttribute('aria-controls')).toBe(false);
    expect(header.getAttribute('aria-haspopup')).toBe('dialog');
    expect(header.getAttribute('title')).toBe(t('hudChrome.reliquary.openWindowHint'));

    // Flip back to disclosure: aria-expanded returns (the decisive pin against the
    // setAttr elision-cache trap) and the dialog affordance is gone.
    painter.update(view({ chip: false }));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.hasAttribute('aria-haspopup')).toBe(false);
    expect(header.getAttribute('aria-controls')).toBe('reliquary-pin-list');
  });

  it('names the expand hint when a collapsed header is the disclosure toggle', () => {
    const root = document.createElement('div');
    const painter = new ReliquaryTrackerPainter({ root: () => root, writers: liveWriters() });
    const header = root.querySelector('.dt-header') as HTMLElement;
    painter.update(view({ collapsed: true }));
    expect(header.getAttribute('title')).toBe(t('hudChrome.reliquary.expandHint'));
  });
});

describe('ReliquaryTrackerPainter: write elision', () => {
  it('performs zero DOM writes on an unchanged repaint (and real work on the cold one)', () => {
    // The strip repaints on every slow band whether or not anything moved, so a
    // steady frame has to cost nothing. The cold-frame count is asserted too:
    // a painter that wrote nothing at all would trivially satisfy "no second
    // write" while rendering an empty strip.
    const root = document.createElement('div');
    const { writers, counts } = countingWriters();
    const painter = new ReliquaryTrackerPainter({ root: () => root, writers });
    const v = view();

    painter.update(v);
    const cold = counts.writes;
    expect(cold).toBeGreaterThan(0);

    painter.update(v);
    expect(counts.writes).toBe(cold);

    // A real change still writes: elision must not be staleness.
    painter.update(view({ owned: 5, flash: true }));
    expect(counts.writes).toBeGreaterThan(cold);
  });

  it('touches the header attributes only on a real mode transition', () => {
    // The facet counter cannot see the RAW setAttribute / removeAttribute the
    // chip swap performs (it goes around the facet on purpose), so count them
    // at the element. A painter that dropped the lastChip guard would re-run
    // the whole ARIA swap on every slow band and never show up above.
    const root = document.createElement('div');
    const { writers } = countingWriters();
    const painter = new ReliquaryTrackerPainter({ root: () => root, writers });
    const header = root.querySelector('.dt-header') as HTMLElement;
    painter.update(view());

    const raw = { set: 0, remove: 0 };
    const realSet = header.setAttribute.bind(header);
    const realRemove = header.removeAttribute.bind(header);
    header.setAttribute = (name: string, value: string) => {
      raw.set++;
      realSet(name, value);
    };
    header.removeAttribute = (name: string) => {
      raw.remove++;
      realRemove(name);
    };

    painter.update(view());
    painter.update(view());
    expect(raw).toEqual({ set: 0, remove: 0 });

    // The transition itself does write: aria-haspopup in, the two disclosure
    // attributes out, plus the elided title swap.
    painter.update(view({ chip: true }));
    expect(raw.remove).toBe(2);
    expect(raw.set).toBeGreaterThan(0);
  });
});
