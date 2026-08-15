// Tests for the PainterHost write-elision facet (makeWriterFacet), the host
// contract every per-frame painter leans on. It grew from
// four single-slot writers to SIX, adding the multi-slot setStyleProp + toggleClass
// that the four originals cannot express. These tests are the regression guard for
// Top risk 1 (a non-byte-identical key or a single-slot collapse silently breaks
// elision and tanks the skip-rate), and they pin the multi-slot cache-key shape so
// two props / two classes on one element never clobber each other. They ALSO pin
// the allocation contract (hitch-elimination B2): the skip path composes no key
// string and mutates nothing, so an unchanged frame allocates nothing.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  makeWriterFacet,
  type PainterHostWriters,
  type SingleSlotCache,
} from '../src/ui/painter_host';

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
  const cache: SingleSlotCache = new Map();
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
    facet.setDisplay(el, 'block'); // slot (display, "block")
    facet.setWidth(el, 'block'); // slot (width, "block") -> not elided by the display write
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
    const cache: SingleSlotCache = new Map();
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

// --- Allocation-free skip path (hitch-elimination B2) ---------------------------
//
// The old single-slot shape composed its cache key (backtick `display:` + value)
// BEFORE the skip check, so every ELIDED write still allocated a key string:
// millions of allocated-then-discarded strings per session. The fixed shape
// compares (kind, value) components via shouldWriteSingleSlot and never composes
// a string over the value on ANY path. The probe below is the mutant guard: every
// JS string composition over a value (template literal, `+`, String(), .concat)
// invokes ToPrimitive/toString on it, so a probe value whose conversion hooks are
// counted turns a resurrected key-first (or any composing) shape red, while the
// component-compare shape never converts it at all.

function compositionProbe(text: string): { value: string; compositions: () => number } {
  let count = 0;
  const probe = {
    [Symbol.toPrimitive](): string {
      count++;
      return text;
    },
    toString(): string {
      count++;
      return text;
    },
    valueOf(): string {
      count++;
      return text;
    },
  };
  return { value: probe as unknown as string, compositions: () => count };
}

const SINGLE_SLOT_DRIVES: ReadonlyArray<
  [name: string, drive: (f: PainterHostWriters, el: HTMLElement, v: string) => void]
> = [
  ['setText', (f, el, v) => f.setText(el, v)],
  ['setDisplay', (f, el, v) => f.setDisplay(el, v)],
  ['setTransform', (f, el, v) => f.setTransform(el, v)],
  ['setWidth', (f, el, v) => f.setWidth(el, v)],
];

describe('write-elision skip path allocates nothing (B2 mutant guard)', () => {
  it.each(SINGLE_SLOT_DRIVES)(
    '%s never composes a string over its value, on the write path or the skip path',
    (_name, drive) => {
      const { facet, counts } = fakeFacet();
      const { el } = fakeEl();
      const probe = compositionProbe('none');
      drive(facet, el, probe.value);
      expect(counts).toEqual({ writes: 1, skips: 0 });
      expect(probe.compositions()).toBe(0); // even the establishing write stores the raw value
      for (let i = 0; i < 3; i++) drive(facet, el, probe.value);
      expect(counts).toEqual({ writes: 1, skips: 3 });
      expect(probe.compositions()).toBe(0); // an elided frame composes nothing
    },
  );

  it('the skip path neither re-sets the cache nor mints a new entry; a change mutates in place', () => {
    const { facet, cache } = fakeFacet();
    const { el } = fakeEl();
    facet.setWidth(el, '42.0%');
    const entry = cache.get(el);
    // The cache stores (kind, value) COMPONENTS, never a composed 'width:42.0%'
    // key: resurrecting the string-keyed cache reds this line.
    expect(entry).toEqual({ kind: 'width', value: '42.0%' });
    let sets = 0;
    const rawSet = cache.set.bind(cache);
    cache.set = (k, v) => {
      sets++;
      return rawSet(k, v);
    };
    for (let i = 0; i < 5; i++) facet.setWidth(el, '42.0%');
    expect(sets).toBe(0); // skip path: pure read, no Map mutation
    expect(cache.get(el)).toBe(entry); // same entry object, nothing minted
    facet.setWidth(el, '43.0%'); // a CHANGE mutates the existing entry, no new allocation
    expect(sets).toBe(0);
    expect(cache.get(el)).toBe(entry);
    expect(entry).toEqual({ kind: 'width', value: '43.0%' });
    expect(cache.size).toBe(1);
  });

  it('setStyleProp / setAttr skip paths never compose over the value either', () => {
    const { facet, counts } = fakeFacet();
    const { el } = fakeEl();
    const a = compositionProbe('0.5000');
    const b = compositionProbe('Action slot 1: Attack');
    facet.setStyleProp(el, '--xp-fill', a.value);
    facet.setAttr(el, 'aria-label', b.value);
    facet.setStyleProp(el, '--xp-fill', a.value);
    facet.setAttr(el, 'aria-label', b.value);
    expect(counts).toEqual({ writes: 2, skips: 2 });
    expect(a.compositions()).toBe(0);
    expect(b.compositions()).toBe(0);
  });
});

describe('single-slot semantics: kinds are components, the slot still clobbers across kinds', () => {
  it('a text value shaped like an old prefixed key never false-elides a different kind', () => {
    // The composed-key scheme had one latent collision: setText storing the
    // literal 'display:none' made a later setDisplay(el, 'none') falsely skip a
    // real write. Components cannot collide: the display write must happen.
    const { facet, counts } = fakeFacet();
    const { el, node } = fakeEl();
    facet.setText(el, 'display:none');
    facet.setDisplay(el, 'none');
    expect(node.style.display).toBe('none');
    expect(counts).toEqual({ writes: 2, skips: 0 });
  });

  it('cross-kind writes to one element keep the historical single-slot clobber (write set unchanged)', () => {
    // One element, alternating kinds: the single slot holds the LAST (kind, value),
    // so each alternation is a real write, exactly as the composed-key cache
    // behaved. This pins that the DOM writes that DO happen are unchanged.
    const { facet, counts } = fakeFacet();
    const { el, node } = fakeEl();
    facet.setText(el, 'Ready');
    facet.setDisplay(el, 'flex');
    facet.setText(el, 'Ready'); // the display write stole the slot -> a real write again
    expect(counts).toEqual({ writes: 3, skips: 0 });
    expect(node.textContent).toBe('Ready');
    facet.setText(el, 'Ready'); // now cached -> elided
    expect(counts).toEqual({ writes: 3, skips: 1 });
  });
});

// --- Source pins: key-first composition stays banished (both writer hosts) ------
//
// The behavioral probe above covers makeWriterFacet; Hud's two private mirrors
// (setText/setDisplay in src/ui/hud.ts) cannot be driven without a full DOM boot,
// so their half of the contract is pinned at the source level: they must route
// their decision through the one shared shouldWriteSingleSlot helper (which the
// probe DOES cover), and neither host may regrow a composed prefix key.

describe('elision key composition stays banished (hud.ts + painter_host.ts source pins)', () => {
  const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

  it('neither writer host composes a prefixed elision key', () => {
    for (const src of [read('../src/ui/painter_host.ts'), read('../src/ui/hud.ts')]) {
      expect(src).not.toMatch(/`display:\$\{/);
      expect(src).not.toMatch(/`transform:\$\{/);
      expect(src).not.toMatch(/`width:\$\{/);
    }
  });

  it('Hud private single-slot writers route through the shared decision helper', () => {
    const hud = read('../src/ui/hud.ts');
    expect(hud).toContain("shouldWriteSingleSlot(this.hotWriteCache, el, 'text', text)");
    expect(hud).toContain("shouldWriteSingleSlot(this.hotWriteCache, el, 'display', display)");
  });
});
