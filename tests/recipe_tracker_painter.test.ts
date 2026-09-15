// @vitest-environment happy-dom
// Behavioral pin for the pinned-recipe tracker painter
// (src/ui/recipe_tracker_painter.ts): the once-built skeleton and its pools,
// the collapse header's live aria-expanded sync, the block and reagent rows
// (names, have/need, the done and ready classes), and the write-elision
// contract an always-on slow-band painter lives by.
import { describe, expect, it } from 'vitest';
import { t } from '../src/ui/i18n';
import { makeWriterFacet, type PainterHostWriters } from '../src/ui/painter_host';
import { RecipeTrackerPainter } from '../src/ui/recipe_tracker_painter';
import {
  RECIPE_TRACK_CAP,
  RECIPE_TRACKER_MAX_REAGENTS,
  type RecipeTrackerView,
} from '../src/ui/recipe_tracker_view';

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
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, value);
    },
  };
}

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

function view(opts: { collapsed?: boolean; have?: number } = {}): RecipeTrackerView {
  const have = opts.have ?? 1;
  return {
    visible: true,
    collapsed: opts.collapsed ?? false,
    count: 1,
    lines: opts.collapsed
      ? []
      : [
          {
            recipeId: 'recipe_minor_healing_potion',
            resultItemId: 'minor_healing_potion',
            resultCount: 1,
            reagents: [
              { itemId: 'silverleaf_herb', have, need: 2, done: have >= 2 },
              { itemId: 'spider_leg', have: 1, need: 1, done: true },
            ],
            ready: have >= 2,
          },
        ],
  };
}

describe('RecipeTrackerPainter: skeleton and header', () => {
  it('builds the block and reagent pools once with the aria-controls wiring', () => {
    const root = document.createElement('div');
    new RecipeTrackerPainter({ root: () => root, writers: liveWriters() });
    const header = root.querySelector('.dt-header') as HTMLElement;
    expect(header.tagName).toBe('BUTTON');
    // The list id derives from the root's own id, so a second instance can
    // never mint a duplicate id or cross-wire the disclosure.
    expect(header.getAttribute('aria-controls')).toBe('recipe-tracker-pin-list');
    expect((root.querySelector('.dt-list') as HTMLElement).id).toBe('recipe-tracker-pin-list');
    const named = document.createElement('div');
    named.id = 'other-tracker';
    new RecipeTrackerPainter({ root: () => named, writers: liveWriters() });
    expect(named.querySelector('.dt-header')?.getAttribute('aria-controls')).toBe(
      'other-tracker-pin-list',
    );
    expect(root.querySelectorAll('.rt-recipe')).toHaveLength(RECIPE_TRACK_CAP);
    expect(root.querySelectorAll('.rt-mat')).toHaveLength(
      RECIPE_TRACK_CAP * RECIPE_TRACKER_MAX_REAGENTS,
    );
    expect(root.querySelector('.dt-chevron')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('flips aria-expanded and hides the list as the view collapses, showing the tally', () => {
    const root = document.createElement('div');
    const painter = new RecipeTrackerPainter({ root: () => root, writers: liveWriters() });
    const header = root.querySelector('.dt-header') as HTMLElement;
    const list = root.querySelector('.dt-list') as HTMLElement;
    painter.update(view());
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.getAttribute('title')).toBe(t('hudChrome.recipeTracker.collapseHint'));
    expect(list.style.display).toBe('');
    expect(root.querySelector('.dt-tally')?.textContent).toBe('');
    painter.update(view({ collapsed: true }));
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.getAttribute('title')).toBe(t('hudChrome.recipeTracker.expandHint'));
    expect(list.style.display).toBe('none');
    expect(root.querySelector('.dt-tally')?.textContent).toBe(
      t('hudChrome.questTracker.count', { count: '1' }),
    );
    expect(root.querySelector('.dt-label')?.textContent).toBe(
      t('hudChrome.recipeTracker.trackerLabel'),
    );
  });

  it('hides the whole strip when the view is not visible', () => {
    const root = document.createElement('div');
    const painter = new RecipeTrackerPainter({ root: () => root, writers: liveWriters() });
    painter.update({ visible: false, collapsed: false, count: 0, lines: [] });
    expect(root.style.display).toBe('none');
  });
});

describe('RecipeTrackerPainter: rows', () => {
  it('paints the result name, each reagent name with have/need, and the done classes', () => {
    const root = document.createElement('div');
    const painter = new RecipeTrackerPainter({ root: () => root, writers: liveWriters() });
    painter.update(view({ have: 1 }));
    const blocks = root.querySelectorAll<HTMLElement>('.rt-recipe');
    expect(blocks[0].style.display).toBe('');
    expect(blocks[0].classList.contains('rt-ready')).toBe(false);
    expect(blocks[1].style.display).toBe('none');
    expect(blocks[0].querySelector('.rt-name')?.textContent).toBe('Minor Healing Potion');
    const mats = blocks[0].querySelectorAll<HTMLElement>('.rt-mat');
    expect(mats[0].querySelector('.rt-mat-name')?.textContent).toBe('Sheenleaf Herb');
    expect(mats[0].querySelector('.rt-mat-count')?.textContent).toBe('1/2');
    expect(mats[0].classList.contains('done')).toBe(false);
    expect(mats[1].querySelector('.rt-mat-count')?.textContent).toBe('1/1');
    expect(mats[1].classList.contains('done')).toBe(true);
    expect(mats[2].style.display).toBe('none');

    painter.update(view({ have: 2 }));
    expect(blocks[0].classList.contains('rt-ready')).toBe(true);
    expect(mats[0].classList.contains('done')).toBe(true);
    expect(mats[0].querySelector('.rt-mat-count')?.textContent).toBe('2/2');
  });

  it('spells a multi-count result through the resultCount key', () => {
    const root = document.createElement('div');
    const painter = new RecipeTrackerPainter({ root: () => root, writers: liveWriters() });
    const v = view();
    v.lines[0].resultCount = 3;
    painter.update(v);
    expect(root.querySelector('.rt-name')?.textContent).toBe(
      t('hudChrome.recipeTracker.resultCount', { name: 'Minor Healing Potion', count: '3' }),
    );
  });

  it('falls back to the raw id for an item the bundle does not know', () => {
    const root = document.createElement('div');
    const painter = new RecipeTrackerPainter({ root: () => root, writers: liveWriters() });
    const v = view();
    v.lines[0].reagents[0].itemId = 'not_an_item';
    painter.update(v);
    expect(root.querySelector('.rt-mat-name')?.textContent).toBe('not_an_item');
  });
});

describe('RecipeTrackerPainter: write elision', () => {
  it('writes on the first paint and nothing on an identical repaint', () => {
    const root = document.createElement('div');
    const { writers, counts } = countingWriters();
    const painter = new RecipeTrackerPainter({ root: () => root, writers });
    painter.update(view());
    expect(counts.writes).toBeGreaterThan(0);
    const after = counts.writes;
    painter.update(view());
    expect(counts.writes).toBe(after);
    painter.update(view({ have: 2 }));
    expect(counts.writes).toBeGreaterThan(after);
  });
});
