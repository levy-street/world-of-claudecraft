// The cold interact-affordance adapter
// (src/ui/hud/professions/farm_press_affordance_controller.ts): what it writes,
// what the facet elides, and how it degrades.
//
// Driven over the REAL makeWriterFacet (with counting write/skip callbacks, the
// shape Hud builds over its own caches) rather than a recording stub, because
// the elision is the module's whole design: it carries no repaint signature of
// its own, so "an unchanged poll costs nothing" is a claim about the facet
// comparison and only the real facet can prove it. It is also what catches the
// single-slot cache collision this module was first written into: text plus
// display on ONE element elides nothing, because the four single-slot writers
// share one (kind, value) entry per element. A recording stub is blind to that
// class of bug, and it is invisible in production too (everything still
// renders, it just writes the DOM on every poll forever).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FarmPressTarget } from '../src/game/farm_press_target_core';
import {
  FARM_PRESS_AFFORDANCE_SHOWN_CLASS,
  FarmPressAffordanceController,
  type FarmPressAffordanceDeps,
} from '../src/ui/hud/professions/farm_press_affordance_controller';
import { makeWriterFacet } from '../src/ui/painter_host';

/** A fake element supporting exactly the write surface the facet touches, plus
 *  a record of the class toggles so the reveal is assertable. */
function fakeEl(): { el: HTMLElement; classes: Map<string, boolean> } {
  const classes = new Map<string, boolean>();
  const el = {
    textContent: '',
    style: { display: '', width: '', transform: '', setProperty(): void {} },
    classList: {
      toggle(cls: string, on: boolean): void {
        classes.set(cls, on);
      },
    },
    setAttribute(): void {},
    removeAttribute(): void {},
  } as unknown as HTMLElement;
  return { el, classes };
}

function rig(options: { missingRoot?: boolean } = {}) {
  const counts = { writes: 0, skips: 0 };
  const facet = makeWriterFacet(
    new Map(),
    new WeakMap(),
    new WeakMap(),
    new WeakMap(),
    () => {
      counts.writes++;
    },
    () => {
      counts.skips++;
    },
  );
  const node = fakeEl();
  const textCalls: FarmPressTarget[] = [];
  // Mutable so a test can simulate the player switching language: the same
  // target resolves to a different sentence.
  let harvestLine = 'FEAST BEFORE CROP';
  const deps: FarmPressAffordanceDeps = {
    root: options.missingRoot ? null : node.el,
    writers: facet,
    text: (target) => {
      textCalls.push(target);
      return target === 'feast_over_harvest' ? harvestLine : 'FEAST BEFORE BED';
    },
  };
  return {
    controller: new FarmPressAffordanceController(deps),
    counts,
    textCalls,
    el: node.el,
    shown: () => node.classes.get(FARM_PRESS_AFFORDANCE_SHOWN_CLASS),
    reset: () => {
      counts.writes = 0;
      counts.skips = 0;
    },
    setHarvestLine: (line: string) => {
      harvestLine = line;
    },
  };
}

describe('FarmPressAffordanceController', () => {
  it('establishes both writes when the ambiguity appears', () => {
    const r = rig();
    r.controller.paint('feast_over_harvest');
    expect(r.counts).toEqual({ writes: 2, skips: 0 });
    expect(r.el.textContent).toBe('FEAST BEFORE CROP');
    expect(r.shown()).toBe(true);
  });

  it('shows the plant sentence for the free-bed ambiguity', () => {
    const r = rig();
    r.controller.paint('feast_over_plant');
    expect(r.el.textContent).toBe('FEAST BEFORE BED');
    expect(r.shown()).toBe(true);
  });

  it('writes NOTHING on an unchanged repeat: every poll is elided by the facet', () => {
    // The module carries no signature of its own, so this is the whole per-poll
    // cost claim. BOTH writers must elide: the count of 4 over two polls is what
    // fails if the two writes ever share one cache slot again.
    const r = rig();
    r.controller.paint('feast_over_harvest');
    r.reset();

    r.controller.paint('feast_over_harvest');
    r.controller.paint('feast_over_harvest');
    expect(r.counts).toEqual({ writes: 0, skips: 4 });
  });

  it('re-paints when the ambiguity CHANGES shape, and only the text moves', () => {
    const r = rig();
    r.controller.paint('feast_over_harvest');
    r.reset();

    r.controller.paint('feast_over_plant');
    // One write (the sentence); the reveal class is already on and elides.
    expect(r.counts).toEqual({ writes: 1, skips: 1 });
    expect(r.el.textContent).toBe('FEAST BEFORE BED');
  });

  it('follows a LANGUAGE SWITCH with no fan-out arm, because the facet compares the resolved text', () => {
    // The reason this module has no relocalize(): the same target resolving to
    // a new sentence moves the facet's own comparison. A data-digest repaint
    // signature would swallow this exact case and strand the old locale until
    // the player walked out of the ambiguity and back in.
    const r = rig();
    r.controller.paint('feast_over_harvest');
    r.reset();

    r.setHarvestLine('FESTMAHL VOR DER ERNTE');
    r.controller.paint('feast_over_harvest');
    expect(r.counts).toEqual({ writes: 1, skips: 1 });
    expect(r.el.textContent).toBe('FESTMAHL VOR DER ERNTE');
  });

  it('hides the notice when the ambiguity ends, then elides the hidden polls', () => {
    const r = rig();
    r.controller.paint('feast_over_harvest');
    r.reset();

    r.controller.paint(null);
    expect(r.shown()).toBe(false);
    expect(r.counts).toEqual({ writes: 2, skips: 0 });
    expect(r.el.textContent).toBe('');

    r.controller.paint(null);
    expect(r.counts).toEqual({ writes: 2, skips: 2 });
  });

  it('re-announces the same target after leaving and re-entering', () => {
    const r = rig();
    r.controller.paint('feast_over_harvest');
    r.controller.paint(null);
    r.reset();
    r.controller.paint('feast_over_harvest');
    expect(r.counts).toEqual({ writes: 2, skips: 0 });
    expect(r.el.textContent).toBe('FEAST BEFORE CROP');
  });

  it('does not re-resolve the copy while hidden', () => {
    // The hidden path must not pay a catalog lookup: that is the one cost the
    // signature-free shape could plausibly have leaked.
    const r = rig();
    r.controller.paint(null);
    r.controller.paint(null);
    expect(r.textCalls).toEqual([]);
  });

  it('no-ops against a document that does not carry the element', () => {
    // The HUD boots two entry documents; a missing node is "nothing to paint",
    // never a throw that would take the whole per-frame ladder down with it.
    const r = rig({ missingRoot: true });
    expect(() => r.controller.paint('feast_over_harvest')).not.toThrow();
    expect(() => r.controller.paint(null)).not.toThrow();
    expect(r.counts).toEqual({ writes: 0, skips: 0 });
    expect(r.textCalls).toEqual([]);
  });
});

// The three files the painted notice needs besides this module. Kept here
// rather than in client_shell.test.ts because it is this module's own surface,
// and deliberately independent of the hud.ts wiring, so it holds both before
// and after that arm lands.
describe('the notice surface the controller paints into', () => {
  const read = (name: string): string =>
    readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

  it.each(['index.html', 'play.html'])('%s carries the notice element', (entry) => {
    // BOTH entry documents: index.html and play.html each boot src/main.ts, and
    // the recorded bug class here is a HUD node that ships on one entry only,
    // leaving /play players without the surface entirely.
    const html = read(entry);
    expect(html).toContain('id="interact-affordance"');
    // role=status, so a screen reader is told about the ambiguity the sighted
    // line shows. It carries no authored text: every sentence is localized at
    // paint time, so a hardcoded English string here would be a leak.
    const tag = /<div id="interact-affordance"[^>]*>(?<inner>[^<]*)</.exec(html);
    expect(tag?.[0]).toContain('role="status"');
    expect(tag?.groups?.inner?.trim()).toBe('');
  });

  it('hud.css keeps the status node present while visually hiding the notice', () => {
    const css = read('src/styles/hud.css');
    expect(css).toMatch(/#interact-affordance\s*\{[^}]*opacity:\s*0/s);
    expect(css).not.toMatch(/#interact-affordance\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(
      new RegExp(`#interact-affordance\\.${FARM_PRESS_AFFORDANCE_SHOWN_CLASS}\\s*\\{[^}]*opacity:`),
    );
    // pointer-events:none, or the line would eat world clicks aimed through it.
    expect(css).toMatch(/#interact-affordance\s*\{[^}]*pointer-events:\s*none/);
  });

  it('Hud resolves the stable notice node once when wiring the controller', () => {
    const hud = read('src/ui/hud.ts');
    const start = hud.indexOf('this.farmPressAffordance = new FarmPressAffordanceController({');
    expect(start).toBeGreaterThan(-1);
    const wiring = hud.slice(start, hud.indexOf('});', start) + 3);
    expect(wiring.match(/interact-affordance/g)).toHaveLength(1);
    expect(wiring).toContain('root: ');
    expect(wiring).not.toContain('root: () =>');
  });
});
