// PainterHost: the thin shared host that HUD windows and painters compose into.
//
// Factored into TWO facets, because the already-tested bespoke windows do NOT
// share one dep shape:
//
//   1) PainterHostPresentation -- the icon / money / tooltip surface. This is the
//      shared BASE the cold windows COMPOSE into where they actually render item
//      rows (today only the vendor window does; lockpick is callback-driven and
//      raid_lockout is a pure HTML-string builder, so neither composes it). It is
//      a presentation dep-bag, NOT a unified bag the windows migrate onto: a
//      window's own deps interface EXTENDS this and keeps its window-specific
//      members on top.
//
//   2) PainterHostWriters -- the write-elision facet: the SEVEN cached DOM writers
//      (setText/setDisplay/setTransform/setWidth + the additions
//      setStyleProp/toggleClass + the later addition setAttr), exposed to painters as
//      closures over Hud's shared caches via makeWriterFacet. Hud also keeps private
//      mirrors of the writers it still uses on its own per-frame path AND builds this
//      equivalent facet to hand to painters; both share the SAME caches, so the
//      skip-rate stays one number. (As per-frame work migrates onto painters the
//      Hud-direct mirror shrinks: the cast_bar painter took the last direct width
//      write, so setWidth now lives only on the facet -- the interface
//      still exposes all seven.)
//      The per-frame painters consume this facet; setStyleProp/toggleClass extended
//      it to express what the four original
//      single-slot writers cannot: a custom-property write to a `--var` and
//      a classList toggle. setAttr was added for the same reason: the action-bar
//      aria-label is a per-frame ATTRIBUTE write the other writers cannot express,
//      and it was the Top-risk-4 raw `setAttribute` fired every frame per slot.
//      These three need a MULTI-SLOT cache keyed per (element, prop) / (element,
//      class) / (element, attr), because one element legitimately holds many custom
//      properties, toggled classes, and attributes, whereas the four single-slot
//      writers each own one DOM facet per element; collapsing them into the
//      single-slot cache would silently break elision (Top risk 1), so they take
//      their own caches.
//
// This module is host-agnostic and Node-importable: it touches no `window` /
// `document` global. The writer closures write element properties (`el.textContent`
// / `el.style.*`) on elements handed to them, but never reach for a browser global,
// so the host itself imports cleanly under Vitest.

import type { ItemDef } from '../sim/types';

/**
 * Facet 1: the presentation dep-bag. Exactly the icon / money / tooltip helpers a
 * window needs to paint item rows via `innerHTML`. A window's deps interface
 * composes this (extends it) and adds its own members; Hud builds one bag and
 * hands it to every window that renders items, so the helpers live in one place.
 */
export interface PainterHostPresentation {
  /** `<img>` markup for an item's procedural icon. */
  itemIcon(item: ItemDef): string;
  /** Localized coin markup (gold/silver/copper) for a copper amount. */
  moneyHtml(copper: number): string;
  /** Full item tooltip markup (name, stats, compare). */
  itemTooltip(item: ItemDef): string;
  /** Attach a lazily-built tooltip to an element. */
  attachTooltip(el: HTMLElement, html: () => string): void;
}

/**
 * Facet 2: the write-elision facet. Seven cached DOM writers, each eliding a repeat
 * write of an identical value to the same element. A painter routes its DOM
 * text/display/transform/width/custom-property/class/attribute writes through these
 * so a no-op frame costs no DOM mutation. The CANVAS schematic a 2D painter draws is
 * NOT routed through here: a 2D context cannot be elided, so a
 * Canvas painter touches the context directly and uses these writers only for the
 * DOM bits it owns (e.g. a `#zone-label` text node).
 *
 * setText/setDisplay/setTransform/setWidth are SINGLE-SLOT (one cached string per
 * element, since each owns one DOM facet). setStyleProp/toggleClass/setAttr are
 * MULTI-SLOT (keyed per (element, prop) / (element, class) / (element, attr)), since
 * one element holds many custom properties, toggled classes, and attributes.
 */
export interface PainterHostWriters {
  /** Set `el.textContent`, eliding a repeat of the same text. */
  setText(el: HTMLElement, text: string): void;
  /** Set `el.style.display`, eliding a repeat of the same value. */
  setDisplay(el: HTMLElement, display: string): void;
  /** Set `el.style.transform`, eliding a repeat of the same value. */
  setTransform(el: HTMLElement, transform: string): void;
  /** Set `el.style.width`, eliding a repeat of the same value. */
  setWidth(el: HTMLElement, width: string): void;
  /**
   * Set a CSS property (a custom `--var` or a standard property) via
   * `el.style.setProperty`, eliding a repeat of the same value for the same
   * (element, prop). Multi-slot: different props on one element never collide.
   */
  setStyleProp(el: HTMLElement, prop: string, value: string): void;
  /**
   * Toggle a class on `el`, eliding a repeat of the same on/off state for the same
   * (element, class). Multi-slot: different classes on one element never collide.
   */
  toggleClass(el: HTMLElement, cls: string, on: boolean): void;
  /**
   * Set an attribute on `el` via `el.setAttribute`, eliding a repeat of the same
   * value for the same (element, attr). Multi-slot: different attributes on one
   * element never collide. Added for the action-bar aria-label, which was
   * written every frame per slot (Top risk 4); the rendered string still comes from
   * the core's `t()` call each frame, this only elides the DOM write.
   */
  setAttr(el: HTMLElement, name: string, value: string): void;
}

/**
 * Build the write-elision facet over the supplied caches. The four single-slot
 * writers share `cache` (one string per element); setStyleProp/toggleClass/setAttr
 * use the multi-slot `stylePropCache` / `classCache` / `attrCache` (a per-element
 * inner map keyed by prop / class / attr). Every closure reports each real write via
 * `onWrite` and each elided write via `onSkip`, so a host that builds the facet from
 * its own caches + counters keeps a single skip-rate across its direct writes and
 * the painter writes. The key scheme matches Hud's private writers exactly (raw text
 * for setText; `display:`/`transform:`/`width:` prefixes for the style writers; the
 * raw value for setStyleProp; `on`/`off` for toggleClass; the raw value for setAttr)
 * so the two never disagree on the same element.
 */
export function makeWriterFacet(
  cache: Map<HTMLElement, string>,
  stylePropCache: Map<HTMLElement, Map<string, string>>,
  classCache: Map<HTMLElement, Map<string, string>>,
  attrCache: Map<HTMLElement, Map<string, string>>,
  onWrite: () => void,
  onSkip: () => void,
): PainterHostWriters {
  const write = (el: HTMLElement, key: string, apply: () => void): void => {
    if (cache.get(el) === key) {
      onSkip();
      return;
    }
    cache.set(el, key);
    onWrite();
    apply();
  };
  // Multi-slot variant: resolves (or lazily creates) the per-element inner map and
  // elides per (element, slot). Used by setStyleProp/toggleClass so one element can
  // hold many independent props/classes without them clobbering each other's cache.
  const writeSlot = (
    store: Map<HTMLElement, Map<string, string>>,
    el: HTMLElement,
    slot: string,
    value: string,
    apply: () => void,
  ): void => {
    let slots = store.get(el);
    if (slots === undefined) {
      slots = new Map();
      store.set(el, slots);
    }
    if (slots.get(slot) === value) {
      onSkip();
      return;
    }
    slots.set(slot, value);
    onWrite();
    apply();
  };
  return {
    setText: (el, text) =>
      write(el, text, () => {
        el.textContent = text;
      }),
    setDisplay: (el, display) =>
      write(el, `display:${display}`, () => {
        el.style.display = display;
      }),
    setTransform: (el, transform) =>
      write(el, `transform:${transform}`, () => {
        el.style.transform = transform;
      }),
    setWidth: (el, width) =>
      write(el, `width:${width}`, () => {
        el.style.width = width;
      }),
    setStyleProp: (el, prop, value) =>
      writeSlot(stylePropCache, el, prop, value, () => {
        el.style.setProperty(prop, value);
      }),
    toggleClass: (el, cls, on) =>
      writeSlot(classCache, el, cls, on ? 'on' : 'off', () => {
        el.classList.toggle(cls, on);
      }),
    setAttr: (el, name, value) =>
      writeSlot(attrCache, el, name, value, () => {
        el.setAttribute(name, value);
      }),
  };
}
