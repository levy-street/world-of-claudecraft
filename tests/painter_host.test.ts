// Tests for the PainterHost write-elision facet (makeWriterFacet), the host
// contract every per-frame painter leans on. It grew from
// four single-slot writers to SIX, adding the multi-slot setStyleProp + toggleClass
// that the four originals cannot express. These tests are the regression guard for
// Top risk 1 (a non-byte-identical key or a single-slot collapse silently breaks
// elision and tanks the skip-rate), and they pin the multi-slot cache-key shape so
// two props / two classes on one element never clobber each other.

import { describe, expect, it } from 'vitest';
import { makeWriterFacet } from '../src/ui/painter_host';

// A DOM-free element that records every write the facet performs: textContent, the
// three single-slot style facets, the multi-slot custom properties (setProperty),
// and the toggled classes. Returned alongside the raw record bags so a test can
// assert the real DOM effect, not just the write/skip counts.
function fakeEl() {
  const props: Record<string, string> = {};
  const classes: Record<string, boolean> = {};
  const attrs: Record<string, string> = {};
  const node = {
    textContent: '',
    style: {
      display: '',
      width: '',
      transform: '',
      setProperty(prop: string, value: string): void {
        props[prop] = value;
      },
    },
    classList: {
      toggle(cls: string, on: boolean): void {
        classes[cls] = on;
      },
    },
    setAttribute(name: string, value: string): void {
      attrs[name] = value;
    },
  };
  return { node, props, classes, attrs, el: node as unknown as HTMLElement };
}

function fakeFacet() {
  const cache = new Map<HTMLElement, string>();
  const stylePropCache = new Map<HTMLElement, Map<string, string>>();
  const classCache = new Map<HTMLElement, Map<string, string>>();
  const attrCache = new Map<HTMLElement, Map<string, string>>();
  const counts = { writes: 0, skips: 0 };
  const facet = makeWriterFacet(
    cache,
    stylePropCache,
    classCache,
    attrCache,
    () => {
      counts.writes++;
    },
    () => {
      counts.skips++;
    },
  );
  return { cache, stylePropCache, classCache, attrCache, facet, counts };
}

// --- The four single-slot writers (unchanged) ----------------------------------

describe('makeWriterFacet: single-slot writers (setText/setDisplay/setTransform/setWidth)', () => {
  it('writes a value once, then elides repeats of the same value to the same element', () => {
    const { facet, counts } = fakeFacet();
    const { el, node } = fakeEl();
    facet.setText(el, 'x');
    expect(node.textContent).toBe('x');
    expect(counts).toEqual({ writes: 1, skips: 0 });
    facet.setText(el, 'x'); // identical -> elided
    expect(counts).toEqual({ writes: 1, skips: 1 });
    facet.setText(el, 'y'); // changed -> writes
    expect(node.textContent).toBe('y');
    expect(counts).toEqual({ writes: 2, skips: 1 });
  });

  it('keys per element: a write to one element never elides a write to another', () => {
    const { facet, counts } = fakeFacet();
    const a = fakeEl().el;
    const b = fakeEl().el;
    facet.setText(a, 'same');
    facet.setText(b, 'same'); // different element -> still a real write
    expect(counts).toEqual({ writes: 2, skips: 0 });
    facet.setText(a, 'same'); // repeat on a -> elided
    facet.setText(b, 'same'); // repeat on b -> elided
    expect(counts).toEqual({ writes: 2, skips: 2 });
  });

  it('namespaces by write type: same raw value via display vs width does not false-elide', () => {
    const { facet, counts } = fakeFacet();
    const { el, node } = fakeEl();
    facet.setDisplay(el, 'block'); // key "display:block"
    facet.setWidth(el, 'block'); // key "width:block" -> not elided by the display write
    expect(counts).toEqual({ writes: 2, skips: 0 });
    expect(node.style.display).toBe('block');
    expect(node.style.width).toBe('block');
  });
});

// --- setStyleProp: the multi-slot custom-property writer ------------------------

describe('makeWriterFacet: setStyleProp (multi-slot, keyed per (element, prop))', () => {
  it('writes on first call, elides a repeat of the same (el, prop, val), writes a changed val', () => {
    const { facet, counts } = fakeFacet();
    const { el, props } = fakeEl();
    facet.setStyleProp(el, '--xp-fill', '0.5000');
    expect(props['--xp-fill']).toBe('0.5000');
    expect(counts).toEqual({ writes: 1, skips: 0 });
    facet.setStyleProp(el, '--xp-fill', '0.5000'); // identical -> elided
    expect(counts).toEqual({ writes: 1, skips: 1 });
    facet.setStyleProp(el, '--xp-fill', '0.6000'); // changed -> writes
    expect(props['--xp-fill']).toBe('0.6000');
    expect(counts).toEqual({ writes: 2, skips: 1 });
  });

  it('does NOT collapse two different props on one element (the multi-slot key)', () => {
    const { facet, counts } = fakeFacet();
    const { el, props } = fakeEl();
    facet.setStyleProp(el, 'left', '50.0%');
    facet.setStyleProp(el, 'width', '50.0%'); // SAME value, DIFFERENT prop -> a real write
    expect(counts).toEqual({ writes: 2, skips: 0 });
    expect(props.left).toBe('50.0%');
    expect(props.width).toBe('50.0%');
    // ...and each prop elides independently on its own repeat.
    facet.setStyleProp(el, 'left', '50.0%');
    facet.setStyleProp(el, 'width', '50.0%');
    expect(counts).toEqual({ writes: 2, skips: 2 });
  });

  it('keys per element: the same prop on a second element is a real write', () => {
    const { facet, counts } = fakeFacet();
    const a = fakeEl();
    const b = fakeEl();
    facet.setStyleProp(a.el, '--xp-fill', '0.25');
    facet.setStyleProp(b.el, '--xp-fill', '0.25'); // different element -> a real write
    expect(counts).toEqual({ writes: 2, skips: 0 });
    expect(a.props['--xp-fill']).toBe('0.25');
    expect(b.props['--xp-fill']).toBe('0.25');
  });
});

// --- toggleClass: the multi-slot class writer -----------------------------------

describe('makeWriterFacet: toggleClass (multi-slot, keyed per (element, class))', () => {
  it('writes on first toggle, elides a repeat of the same on/off state, tracks the flip', () => {
    const { facet, counts } = fakeFacet();
    const { el, classes } = fakeEl();
    facet.toggleClass(el, 'ready', true);
    expect(classes.ready).toBe(true);
    expect(counts).toEqual({ writes: 1, skips: 0 });
    facet.toggleClass(el, 'ready', true); // same state -> elided
    expect(counts).toEqual({ writes: 1, skips: 1 });
    facet.toggleClass(el, 'ready', false); // off transition -> a real write
    expect(classes.ready).toBe(false);
    expect(counts).toEqual({ writes: 2, skips: 1 });
    facet.toggleClass(el, 'ready', false); // same off state -> elided
    expect(counts).toEqual({ writes: 2, skips: 2 });
    facet.toggleClass(el, 'ready', true); // back on -> a real write
    expect(classes.ready).toBe(true);
    expect(counts).toEqual({ writes: 3, skips: 2 });
  });

  it('does NOT collapse two different classes on one element (the multi-slot key)', () => {
    const { facet, counts } = fakeFacet();
    const { el, classes } = fakeEl();
    facet.toggleClass(el, 'overflow', true);
    facet.toggleClass(el, 'rested', true); // same state, DIFFERENT class -> a real write
    expect(counts).toEqual({ writes: 2, skips: 0 });
    expect(classes.overflow).toBe(true);
    expect(classes.rested).toBe(true);
    facet.toggleClass(el, 'overflow', true); // each class elides on its own slot
    facet.toggleClass(el, 'rested', true);
    expect(counts).toEqual({ writes: 2, skips: 2 });
  });
});

describe('makeWriterFacet: setAttr (multi-slot, keyed per (element, attr))', () => {
  it('writes on first set, elides a repeat of the same value, tracks a change', () => {
    const { facet, counts } = fakeFacet();
    const { el, attrs } = fakeEl();
    facet.setAttr(el, 'aria-label', 'Action slot 1: Attack');
    expect(attrs['aria-label']).toBe('Action slot 1: Attack');
    expect(counts).toEqual({ writes: 1, skips: 0 });
    facet.setAttr(el, 'aria-label', 'Action slot 1: Attack'); // same value -> elided
    expect(counts).toEqual({ writes: 1, skips: 1 });
    facet.setAttr(el, 'aria-label', 'Action slot 1: Fireball'); // changed -> a real write
    expect(attrs['aria-label']).toBe('Action slot 1: Fireball');
    expect(counts).toEqual({ writes: 2, skips: 1 });
  });

  it('does NOT collapse two different attributes on one element (the multi-slot key)', () => {
    const { facet, counts } = fakeFacet();
    const { el } = fakeEl();
    facet.setAttr(el, 'aria-label', 'x');
    facet.setAttr(el, 'title', 'x'); // same value, DIFFERENT attr -> a real write
    expect(counts).toEqual({ writes: 2, skips: 0 });
    facet.setAttr(el, 'aria-label', 'x'); // each attr elides on its own slot
    facet.setAttr(el, 'title', 'x');
    expect(counts).toEqual({ writes: 2, skips: 2 });
  });
});

// --- Shared-cache coherence + single/multi-slot independence --------------------

describe('makeWriterFacet: shared caches keep one skip-rate (HUD + painter coherence)', () => {
  it('two facets over the SAME caches elide each other across all writer kinds', () => {
    // Hud keeps its own writers AND hands painters a facet built from the SAME
    // caches; the second writer must see the first writer's cache entry so a repeat
    // is elided whichever path wrote it last (one skip-rate across HUD + painters).
    const cache = new Map<HTMLElement, string>();
    const stylePropCache = new Map<HTMLElement, Map<string, string>>();
    const classCache = new Map<HTMLElement, Map<string, string>>();
    const attrCache = new Map<HTMLElement, Map<string, string>>();
    const a = { writes: 0, skips: 0 };
    const b = { writes: 0, skips: 0 };
    const facetA = makeWriterFacet(
      cache,
      stylePropCache,
      classCache,
      attrCache,
      () => a.writes++,
      () => a.skips++,
    );
    const facetB = makeWriterFacet(
      cache,
      stylePropCache,
      classCache,
      attrCache,
      () => b.writes++,
      () => b.skips++,
    );
    const { el } = fakeEl();
    facetA.setText(el, 'Delve: Ossuary');
    facetA.setStyleProp(el, '--xp-fill', '0.5');
    facetA.toggleClass(el, 'rested', true);
    facetA.setAttr(el, 'aria-label', 'Action slot 1: Attack');
    expect(a).toEqual({ writes: 4, skips: 0 });
    facetB.setText(el, 'Delve: Ossuary'); // shared single-slot cache -> elided
    facetB.setStyleProp(el, '--xp-fill', '0.5'); // shared style-prop cache -> elided
    facetB.toggleClass(el, 'rested', true); // shared class cache -> elided
    facetB.setAttr(el, 'aria-label', 'Action slot 1: Attack'); // shared attr cache -> elided
    expect(b).toEqual({ writes: 0, skips: 4 });
  });
});
