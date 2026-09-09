// @vitest-environment happy-dom

// Direct cover for src/ui/compass_strip_painter.ts, the compass strip's DOM
// half, extracted out of the HUD coordinator by masterwrought D129.
//
// THE RELABEL IS WHY THIS FILE EXISTS. The eight rose labels are written ONCE
// when the pool is built, so a runtime language change left the whole strip in
// the previous locale forever: one of the seven i18n defects that audit found.
// Until this suite, the only thing holding that fix anywhere was a source-text
// check that `relabelCompassMarks(` APPEARS inside the fan-out arm, which an
// empty-bodied function passes green. These arms drive the real function over a
// real DOM across two real locales, so the fix is asserted rather than assumed.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COMPASS_ROSE_IDS, compassView } from '../src/ui/compass';
import {
  buildCompassMarks,
  type CompassMarkElements,
  paintCompassMarks,
  relabelCompassMarks,
} from '../src/ui/compass_strip_painter';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import type { PainterHostWriters } from '../src/ui/painter_host';

// A real locale, not the dev pseudo one: the pseudo-locale is a transform of
// English and would still pass an arm that never re-resolved anything.
const OTHER = 'es';

beforeAll(async () => {
  await ensureLocaleLoaded(OTHER);
});

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
});

afterEach(() => {
  setLanguage('en');
});

/** A recording facet: the painter must reach the DOM only through this. */
function recordingWriters(): { writers: PainterHostWriters; calls: string[] } {
  const calls: string[] = [];
  const el = (e: HTMLElement) => e.textContent || e.className;
  const writers = {
    setText: (e: HTMLElement, v: string) => {
      calls.push(`setText ${el(e)} ${v}`);
      e.textContent = v;
    },
    setDisplay: (e: HTMLElement, v: string) => {
      calls.push(`setDisplay ${el(e)} ${v}`);
      e.style.display = v;
    },
    setTransform: () => {},
    setWidth: () => {},
    setStyleProp: (e: HTMLElement, prop: string, v: string) => {
      calls.push(`setStyleProp ${el(e)} ${prop} ${v}`);
      e.style.setProperty(prop, v);
    },
    toggleClass: () => {},
    setAttr: () => {},
  } as unknown as PainterHostWriters;
  return { writers, calls };
}

function buildPool(): { track: HTMLElement; marks: CompassMarkElements } {
  const track = document.createElement('div');
  document.body.appendChild(track);
  return { track, marks: buildCompassMarks(track, document) };
}

describe('compass strip painter', () => {
  it('builds one labelled span per rose point, majors marked', () => {
    const { track, marks } = buildPool();
    expect(marks.size).toBe(COMPASS_ROSE_IDS.length);
    expect(track.children.length).toBe(COMPASS_ROSE_IDS.length);
    for (const id of COMPASS_ROSE_IDS) {
      const el = marks.get(id);
      expect(el, `no span for ${id}`).toBeTruthy();
      expect(el?.textContent, `${id} is unlabelled`).toBeTruthy();
      // The four cardinals are the majors; the diagonals are not.
      expect(el?.className.includes('major'), `${id} major flag`).toBe(id.length === 1);
    }
  });

  it('relabels EVERY mark when the locale changes', () => {
    const { marks } = buildPool();
    const english = [...marks].map(([, el]) => el.textContent ?? '');
    setLanguage(OTHER);
    // The bug, reproduced first: a locale switch alone does not touch the pool,
    // because nothing rewrites a label after the build.
    expect([...marks].map(([, el]) => el.textContent ?? '')).toEqual(english);
    relabelCompassMarks(marks);
    const translated = [...marks].map(([, el]) => el.textContent ?? '');
    expect(translated, 'no label is empty after the relabel').not.toContain('');
    // At least one value must genuinely differ, or a locale that happened to
    // match English would make the whole arm vacuous. Spanish differs on the
    // cardinals (E is 'E' in both, so this is a some, not an every).
    expect(translated).not.toEqual(english);
    // And an emptied relabel body would leave EVERY value on the English side.
    const changed = translated.filter((v, i) => v !== english[i]).length;
    expect(changed, 'the relabel changed nothing').toBeGreaterThan(0);
  });

  it('paints visible marks through the facet and hides the rest', () => {
    const { marks } = buildPool();
    const { writers, calls } = recordingWriters();
    const view = compassView(0);
    const scratch = new Set<string>();
    paintCompassMarks(marks, view, scratch, writers);

    const visible = new Set(view.marks.map((m) => m.label));
    expect(visible.size, 'the view really shows some marks').toBeGreaterThan(0);
    expect(visible.size, 'and hides some, or the hide arm is untested').toBeLessThan(marks.size);
    for (const [id, el] of marks) {
      expect(el.style.display, `${id} display`).toBe(visible.has(id) ? 'block' : 'none');
    }
    // EVERY write went through the facet: the painter is on the fast band, so a
    // raw style write here is a facet-routing break, not a style preference.
    expect(calls.filter((c) => c.startsWith('setStyleProp')).length).toBe(visible.size * 2);
    expect(calls.filter((c) => c.startsWith('setDisplay')).length).toBe(marks.size);
    expect(scratch.size).toBe(visible.size);
  });

  it('reuses the caller scratch set rather than allocating per paint', () => {
    const { marks } = buildPool();
    const { writers } = recordingWriters();
    const scratch = new Set<string>();
    paintCompassMarks(marks, compassView(0), scratch, writers);
    const first = scratch.size;
    // A stale entry from the previous paint would leak a mark into the visible
    // set and leave it painted after it left the window.
    paintCompassMarks(marks, compassView(Math.PI), scratch, writers);
    expect(scratch.size).toBe(first);
    for (const label of scratch) expect(COMPASS_ROSE_IDS).toContain(label);
  });
});
