// chrome_focus_wiring.ts: the root list and the wiring hud.ts applies once at
// boot for the "Space reopens the last-used menu" fix. Plain-Node suite over
// hand-rolled fakes (the tests/CLAUDE.md DOM rule): the root lists are pinned
// as data (the surfaces the bug was reported on must stay wired), the binding
// is observed per root (a keydown guard plus a CAPTURE-phase click drop on every
// panel, a capture-phase click drop keyed to the right selector on every
// tracker), and hud.ts is pinned to call the one wiring entry point.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHROME_GUARDED_PANELS,
  CHROME_TRACKER_BLURS,
  wireChromeFocus,
} from '../src/ui/chrome_focus_wiring';

interface BoundListener {
  type: string;
  listener: (e: Event) => void;
  capture: boolean;
}

class FakeRoot {
  listeners: BoundListener[] = [];
  addEventListener(
    type: string,
    listener: (e: Event) => void,
    options?: boolean | { capture?: boolean },
  ): void {
    const capture = typeof options === 'boolean' ? options : (options?.capture ?? false);
    this.listeners.push({ type, listener, capture });
  }
  dispatch(type: string, e: unknown): void {
    for (const l of this.listeners) if (l.type === type) l.listener(e as Event);
  }
}

/** A click target that matches exactly one selector (its own), with no dialog root. */
class FakeControl {
  blurred = 0;
  constructor(private readonly matches: string) {}
  closest(selector: string): FakeControl | null {
    return selector === this.matches ? this : null;
  }
  blur(): void {
    this.blurred++;
  }
}

function keydown(
  key: string,
  tagName: string,
): {
  key: string;
  code: string;
  target: { tagName: string };
  stopped: number;
  prevented: number;
  stopPropagation(): void;
  preventDefault(): void;
} {
  return {
    key,
    code: '',
    target: { tagName },
    stopped: 0,
    prevented: 0,
    stopPropagation() {
      this.stopped++;
    },
    preventDefault() {
      this.prevented++;
    },
  };
}

function wire(): { roots: Map<string, FakeRoot>; queried: string[] } {
  const roots = new Map<string, FakeRoot>();
  const queried: string[] = [];
  wireChromeFocus((selector) => {
    const root = new FakeRoot();
    roots.set(selector, root);
    queried.push(selector);
    return root;
  });
  return { roots, queried };
}

describe('the wired roots (the surfaces the fix covers)', () => {
  it('keeps the micromenu side rail, the reported surface, among the guarded panels', () => {
    expect(CHROME_GUARDED_PANELS).toContain('#side-buttons');
  });

  it('pins the whole guarded-panel list (every root the fix wires, in bind order)', () => {
    expect(CHROME_GUARDED_PANELS).toEqual([
      '#delve-board',
      '#lockpick-panel',
      '#delve-rite-panel',
      '#map-window',
      '#bank-window',
      '#bags',
      '#deeds-window',
      '#reliquary-window',
      '#professions-window',
      '#woc-market-window',
      '#side-buttons',
    ]);
  });

  it('keeps the always-on pointer-blur roots keyed to their interactive controls', () => {
    expect(CHROME_TRACKER_BLURS).toEqual([
      ['#quest-tracker', '.qt-header, .qt-title'],
      ['#deed-tracker', '.dt-header'],
      ['#reliquary-tracker', '.dt-header'],
      ['#minimap-disc', 'button'],
    ]);
  });
});

describe('wireChromeFocus', () => {
  it('resolves every guarded panel and every tracker root exactly once', () => {
    const { queried } = wire();
    const expected = [...CHROME_GUARDED_PANELS, ...CHROME_TRACKER_BLURS.map(([root]) => root)];
    // Same multiset: every root once, no root twice (a duplicate would grow the list).
    expect([...queried].sort()).toEqual([...expected].sort());
  });

  it('binds both halves over every guarded panel: a keydown guard plus a CAPTURE-phase click drop', () => {
    const { roots } = wire();
    for (const panelId of CHROME_GUARDED_PANELS) {
      const root = roots.get(panelId);
      if (!root) throw new Error(`unwired panel ${panelId}`);
      const types = root.listeners.map((l) => `${l.type}${l.capture ? ':capture' : ''}`).sort();
      expect(types, panelId).toEqual(['click:capture', 'keydown']);
      // The drop is the real pointer_blur one: a pointer click on a button blurs it,
      // a keyboard click (detail 0) does not.
      const btn = new FakeControl('button');
      root.dispatch('click', { detail: 1, target: btn });
      root.dispatch('click', { detail: 0, target: btn });
      expect(btn.blurred, panelId).toBe(1);
      // And the keydown listener is the real chrome key guard: Enter on a focused
      // BUTTON stops propagation (never the default); on a DIV it bubbles.
      const onButton = keydown('Enter', 'BUTTON');
      root.dispatch('keydown', onButton);
      expect(onButton.stopped, panelId).toBe(1);
      expect(onButton.prevented, panelId).toBe(0);
      const onDiv = keydown('Enter', 'DIV');
      root.dispatch('keydown', onDiv);
      expect(onDiv.stopped, panelId).toBe(0);
    }
  });

  it('binds the capture-phase click drop over every always-on overlay, keyed to its selector', () => {
    const { roots } = wire();
    for (const [trackerId, selector] of CHROME_TRACKER_BLURS) {
      const root = roots.get(trackerId);
      if (!root) throw new Error(`unwired tracker ${trackerId}`);
      const types = root.listeners.map((l) => `${l.type}${l.capture ? ':capture' : ''}`);
      expect(types, trackerId).toEqual(['click:capture']);
      const header = new FakeControl(selector);
      const other = new FakeControl('.unrelated');
      root.dispatch('click', { detail: 1, target: header });
      root.dispatch('click', { detail: 1, target: other });
      expect(header.blurred, trackerId).toBe(1);
      expect(other.blurred, trackerId).toBe(0);
    }
  });

  it('blurs minimap-disc buttons before their click handlers, but keeps keyboard focus', () => {
    const { roots } = wire();
    const minimap = roots.get('#minimap-disc');
    if (!minimap) throw new Error('unwired minimap disc');
    const mail = new FakeControl('button');
    minimap.dispatch('click', { detail: 1, target: mail });
    minimap.dispatch('click', { detail: 0, target: mail });
    expect(mail.blurred).toBe(1);
  });
});

describe('hud.ts wiring pin', () => {
  it('calls the one wiring entry point with its query (line comments stripped first)', () => {
    // Comments stripped by regex, not a lexer: assumes no `/*` inside a string or regex
    // literal in hud.ts.
    const hud = readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(hud).toContain('wireChromeFocus($)');
  });
});
