// Keyed-pool aura painter: the no-raw-write + no-magic source guards,
// and an end-to-end pool proof over a tiny fake DOM (no jsdom): the tooltip
// attaches ONCE per pooled node (no duplicate listeners across frames), a recycled node
// reads the NEW aura's LIVE data (the mutable-record rule), a steady-state
// frame moves no node, and every write routes through the elided writers.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiEffectsTier } from '../src/game/ui_effects_profile';
import { AURA_VISIBLE_CAP_LOW } from '../src/game/ui_tier_knobs';
import { AurasPainter, type AurasPainterDeps } from '../src/ui/auras_painter';
import {
  type AuraInput,
  type AuraSlotState,
  type AurasDeps,
  type AurasState,
  createAurasView,
} from '../src/ui/auras_view';
import type { PainterHostWriters } from '../src/ui/painter_host';

// ---------------------------------------------------------------------------
// Source guards
// ---------------------------------------------------------------------------

describe('AurasPainter: no raw DOM writes, no magic values', () => {
  const src = readFileSync(new URL('../src/ui/auras_painter.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('makes no raw style / textContent / classList / setAttribute / setProperty / innerHTML write', () => {
    // Everything per-frame routes through the facet; no raw single-slot writers.
    expect(code).not.toMatch(/\.style\b/);
    expect(code).not.toMatch(/\.textContent\b/);
    expect(code).not.toMatch(/\.classList\b/);
    expect(code).not.toMatch(/\.setAttribute\b/);
    expect(code).not.toMatch(/\.setProperty\b/);
    expect(code).not.toMatch(/\.innerHTML\b/);
    // No listener churn in the hot painter: the tooltip attaches once in createNode via
    // the injected helper, never addEventListener directly + never per frame.
    expect(code).not.toMatch(/addEventListener/);
    // .className is set EXACTLY 3 times, all in createNode (the pooled node + its .dur /
    // .stacks children, set once at build). Pinning the count gives the guard teeth: the
    // debuff state must flow through toggleClass, so any per-frame raw `rec.el.className =`
    // write (the shape the old inline code used) would push this above 3 and fail here.
    expect(code.match(/\.className\b/g) ?? []).toHaveLength(3);
  });

  it('carries no literal hex / rgb / px value', () => {
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(code.match(/\brgba?\s*\(/g) ?? []).toEqual([]);
    expect(code.match(/\b\d+px\b/g) ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A tiny fake DOM (node env) + a recording facet drive the real painter.
// ---------------------------------------------------------------------------

interface FakeEl {
  tagName: string;
  parentNode: FakeEl | null;
  childNodes: FakeEl[];
  firstChild: FakeEl | null;
  nextSibling: FakeEl | null;
  _mutations: number;
  [k: string]: unknown;
  appendChild(kid: FakeEl): FakeEl;
  insertBefore(node: FakeEl, ref: FakeEl | null): FakeEl;
  _detach(kid: FakeEl): void;
  remove(): void;
}

function fakeEl(tag: string): FakeEl {
  const el = {
    tagName: tag.toUpperCase(),
    parentNode: null as FakeEl | null,
    childNodes: [] as FakeEl[],
    _mutations: 0,
    appendChild(kid: FakeEl) {
      kid.parentNode?._detach(kid);
      kid.parentNode = el;
      el.childNodes.push(kid);
      el._mutations++;
      return kid;
    },
    insertBefore(node: FakeEl, ref: FakeEl | null) {
      node.parentNode?._detach(node);
      node.parentNode = el;
      const i = ref ? el.childNodes.indexOf(ref) : -1;
      if (i < 0) el.childNodes.push(node);
      else el.childNodes.splice(i, 0, node);
      el._mutations++;
      return node;
    },
    get firstChild() {
      return el.childNodes[0] ?? null;
    },
    get nextSibling() {
      const p = el.parentNode;
      if (!p) return null;
      const i = p.childNodes.indexOf(el);
      return p.childNodes[i + 1] ?? null;
    },
    _detach(kid: FakeEl) {
      const i = el.childNodes.indexOf(kid);
      if (i >= 0) el.childNodes.splice(i, 1);
    },
    remove() {
      el.parentNode?._detach(el);
      el.parentNode = null;
    },
  } as unknown as FakeEl;
  return el;
}

const fakeDoc = { createElement: (tag: string) => fakeEl(tag) } as unknown as Document;

type Call = { m: keyof PainterHostWriters; el: unknown; args: unknown[] };
function recordingFacet() {
  const calls: Call[] = [];
  const writers: PainterHostWriters = {
    setText: (el, text) => calls.push({ m: 'setText', el, args: [text] }),
    setDisplay: (el, display) => calls.push({ m: 'setDisplay', el, args: [display] }),
    setTransform: (el, transform) => calls.push({ m: 'setTransform', el, args: [transform] }),
    setWidth: (el, width) => calls.push({ m: 'setWidth', el, args: [width] }),
    setStyleProp: (el, prop, value) => calls.push({ m: 'setStyleProp', el, args: [prop, value] }),
    toggleClass: (el, cls, on) => calls.push({ m: 'toggleClass', el, args: [cls, on] }),
    setAttr: (el, name, value) => calls.push({ m: 'setAttr', el, args: [name, value] }),
  };
  return { calls, writers };
}

// A recording attachTooltip: stores the (el, htmlFn) so a test can invoke the closure
// and prove it reads the LIVE pooled record.
function recordingTooltips() {
  const attached: Array<{ el: unknown; html: () => string }> = [];
  const attachTooltip = (el: HTMLElement, html: () => string) => {
    attached.push({ el, html });
  };
  return { attached, attachTooltip };
}

// A typed icon-URL spy (a bare `vi.fn()` widens to a non-callable Mock under tsc).
function makeIconUrl() {
  return vi.fn((key: string) => `url(${key})`);
}

function slot(over: Partial<AuraSlotState> & { key: string }): AuraSlotState {
  return {
    iconKey: over.key,
    isDebuff: false,
    school: '',
    own: false,
    durationText: '',
    stacksText: '',
    name: over.key,
    remaining: 0,
    cancelable: false,
    effectHtml: '',
    ...over,
  };
}

function state(slots: AuraSlotState[]): AurasState {
  return { slots, count: slots.length };
}

describe('AurasPainter: keyed pool over the elided writers', () => {
  let container: FakeEl;
  let calls: Call[];
  let tooltips: ReturnType<typeof recordingTooltips>;
  let iconUrl: ReturnType<typeof makeIconUrl>;
  let painter: AurasPainter;

  beforeEach(() => {
    container = fakeEl('div');
    const facet = recordingFacet();
    calls = facet.calls;
    tooltips = recordingTooltips();
    iconUrl = makeIconUrl();
    const deps: AurasPainterDeps = {
      resolveIconUrl: (key) => iconUrl(key),
      renderTooltip: (name, remaining) => `${name}|${Math.ceil(remaining)}`,
      attachTooltip: tooltips.attachTooltip,
      attachCancel: () => {},
    };
    painter = new AurasPainter(facet.writers, container as unknown as HTMLElement, deps, fakeDoc);
  });

  const nodes = () => container.childNodes;

  it('builds one .buff node per aura with .dur + .stacks children', () => {
    painter.paint(state([slot({ key: 'a' }), slot({ key: 'b' })]));
    expect(nodes()).toHaveLength(2);
    // each pooled node has the two children (dur, stacks) appended once.
    expect(nodes()[0].childNodes).toHaveLength(2);
    expect(nodes()[0].className).toBe('buff');
  });

  it('attaches the tooltip ONCE per pooled node across frames (no duplicate listeners)', () => {
    painter.paint(state([slot({ key: 'a', name: 'Might', remaining: 8 })]));
    expect(tooltips.attached).toHaveLength(1);
    const nodeA = nodes()[0];
    // Re-paint the SAME aura (a stat changed): the node is reused, not rebuilt, and the
    // tooltip is NOT re-attached.
    painter.paint(state([slot({ key: 'a', name: 'Might', remaining: 7 })]));
    expect(nodes()[0]).toBe(nodeA);
    expect(tooltips.attached).toHaveLength(1);
  });

  it('STALE-CAPTURE regression: a recycled node reads the NEW aura, not the old one', () => {
    // Aura A appears.
    painter.paint(state([slot({ key: 'A', name: 'Aura A', remaining: 5 })]));
    const nodeA = nodes()[0];
    const tipA = tooltips.attached[0];
    expect(tipA.html()).toBe('Aura A|5');
    // Aura A leaves: its node detaches to the free list.
    painter.paint(state([]));
    expect(nodes()).toHaveLength(0);
    // Aura B appears and RECYCLES A's freed node.
    painter.paint(state([slot({ key: 'B', name: 'Aura B', remaining: 9 })]));
    const nodeB = nodes()[0];
    expect(nodeB).toBe(nodeA); // same node recycled
    expect(tooltips.attached).toHaveLength(1); // tooltip NOT re-attached
    // The ORIGINAL closure now renders B's LIVE data (the mutable-record rule); a
    // capture-by-value would still say 'Aura A|5'.
    expect(tipA.html()).toBe('Aura B|9');
  });

  it('resolves the icon URL only when an aura icon key changes (the expensive write)', () => {
    painter.paint(state([slot({ key: 'a', iconKey: 'icon_x' })]));
    expect(iconUrl).toHaveBeenCalledTimes(1);
    // Same icon key next frame: no re-resolve.
    painter.paint(state([slot({ key: 'a', iconKey: 'icon_x' })]));
    expect(iconUrl).toHaveBeenCalledTimes(1);
    // The aura swaps to a new icon: one more resolve.
    painter.paint(state([slot({ key: 'a', iconKey: 'icon_y' })]));
    expect(iconUrl).toHaveBeenCalledTimes(2);
  });

  it('a steady-state frame (same auras) moves no node, so the pool causes no DOM churn', () => {
    painter.paint(state([slot({ key: 'a' }), slot({ key: 'b' })]));
    const movesBefore = container._mutations;
    painter.paint(state([slot({ key: 'a', remaining: 3 }), slot({ key: 'b', remaining: 2 })]));
    expect(container._mutations).toBe(movesBefore); // zero DOM moves in the hot path
    expect(nodes()).toHaveLength(2);
  });

  it('reconciles DOM order on reorder, reusing the SAME nodes', () => {
    painter.paint(state([slot({ key: 'a' }), slot({ key: 'b' }), slot({ key: 'c' })]));
    const [a, b, c] = nodes();
    painter.paint(state([slot({ key: 'c' }), slot({ key: 'a' }), slot({ key: 'b' })]));
    const reordered = nodes();
    expect(reordered).toHaveLength(3);
    expect(reordered[0]).toBe(c);
    expect(reordered[1]).toBe(a);
    expect(reordered[2]).toBe(b);
  });

  it('detaches only the departed node on a PARTIAL departure, keeping the rest in order', () => {
    // One of several auras leaves (a -> still here, b -> gone, c -> still here). The
    // detach sweep must remove exactly b (recycle it to the free list) and leave a + c
    // in place, then recycle b's freed node to a new aura d. This exercises deleting a
    // non-last map entry mid-iteration (the values()-iteration detach path).
    painter.paint(state([slot({ key: 'a' }), slot({ key: 'b' }), slot({ key: 'c' })]));
    const [a, b, c] = nodes();
    painter.paint(state([slot({ key: 'a' }), slot({ key: 'c' })]));
    expect(nodes()).toHaveLength(2);
    expect(nodes()[0]).toBe(a);
    expect(nodes()[1]).toBe(c);
    expect(b.parentNode).toBe(null); // b detached, not orphaned in the container
    // d recycles b's freed node (no new node allocated), proving the free list took it.
    painter.paint(state([slot({ key: 'a' }), slot({ key: 'c' }), slot({ key: 'd' })]));
    const after = nodes();
    expect(after).toHaveLength(3);
    expect(after[2]).toBe(b); // b's node reused for d
    expect(tooltips.attached).toHaveLength(3); // a, b, c built once; d reused b's node
  });

  it('renders two NODES for two auras sharing an id from different sources (no collapse)', () => {
    // The sim dedups auras by id+sourceId, so one entity can carry two auras with the
    // same ability id from different casters (e.g. two warlocks' Corruption on a boss,
    // or two healers' same shield on the player). The old renderAuras appended one .buff
    // per aura, so the pool must NOT collapse same-id auras onto one node (the wire also
    // zeroes sourceId, so disambiguation is by per-frame occurrence, not the composite).
    painter.paint(
      state([
        slot({ key: 'corruption', name: 'Corruption A', remaining: 6 }),
        slot({ key: 'corruption', name: 'Corruption B', remaining: 12 }),
      ]),
    );
    expect(nodes()).toHaveLength(2);
    expect(tooltips.attached).toHaveLength(2);
    // Each node's tooltip reads its OWN aura's live data (no collapse to the second).
    expect(tooltips.attached[0].html()).toBe('Corruption A|6');
    expect(tooltips.attached[1].html()).toBe('Corruption B|12');
    // Steady state: the same two auras next frame reuse the SAME two nodes, no churn.
    const [a, b] = nodes();
    const moves = container._mutations;
    painter.paint(
      state([
        slot({ key: 'corruption', name: 'Corruption A', remaining: 5 }),
        slot({ key: 'corruption', name: 'Corruption B', remaining: 11 }),
      ]),
    );
    expect(nodes()[0]).toBe(a);
    expect(nodes()[1]).toBe(b);
    expect(container._mutations).toBe(moves);
    // When one of the duplicates leaves, the survivor keeps a node and the other detaches.
    painter.paint(state([slot({ key: 'corruption', name: 'Corruption A', remaining: 4 })]));
    expect(nodes()).toHaveLength(1);
    expect(nodes()[0].childNodes).toHaveLength(2); // a real pooled node, not orphaned
  });

  it('routes EVERY per-frame write through the elided writers', () => {
    painter.paint(
      state([
        slot({
          key: 'a',
          iconKey: 'ic',
          isDebuff: true,
          school: 'nature',
          durationText: '5s',
          stacksText: '3',
        }),
      ]),
    );
    const has = (m: Call['m'], pred: (c: Call) => boolean) =>
      calls.some((c) => c.m === m && pred(c));
    // icon via setStyleProp(background-image), not a raw style write.
    expect(
      has('setStyleProp', (c) => c.args[0] === 'background-image' && c.args[1] === 'url(ic)'),
    ).toBe(true);
    // debuff via toggleClass (a structural class, not a color).
    expect(has('toggleClass', (c) => c.args[0] === 'debuff' && c.args[1] === true)).toBe(true);
    // the school border tint via setAttr(data-school), a structural attribute the
    // stylesheet maps to a --color-debuff-* token.
    expect(has('setAttr', (c) => c.args[0] === 'data-school' && c.args[1] === 'nature')).toBe(true);
    // duration + stacks via setText.
    expect(has('setText', (c) => c.args[0] === '5s')).toBe(true);
    expect(has('setText', (c) => c.args[0] === '3')).toBe(true);
    // stacks badge shown via setDisplay('').
    expect(has('setDisplay', (c) => c.args[0] === '')).toBe(true);
  });

  it('hides the stacks badge (setDisplay none) when the aura does not stack', () => {
    painter.paint(state([slot({ key: 'a', stacksText: '' })]));
    expect(calls.some((c) => c.m === 'setDisplay' && c.args[0] === 'none')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The visible-count cap is a pure function of the STATIC ui effects tier
// (data-fx-level), NEVER the governor, injected via getFxTier. Ultra renders every active
// aura (byte-equivalent to the untiered painter); low renders at most AURA_VISIBLE_CAP_LOW
// and recycles the overflow out of the pool, identically under a Sim- and a ClientWorld-
// shaped state. (The refresh/tick-granularity throttle is the Hud's call-site gate, tested
// in the tier-knobs cadence suite; the painter owns only the count cap.)
// ---------------------------------------------------------------------------

describe('AurasPainter: static-preset visible-count cap', () => {
  let container: FakeEl;
  let tooltips: ReturnType<typeof recordingTooltips>;
  let calls: Call[];

  beforeEach(() => {
    container = fakeEl('div');
    tooltips = recordingTooltips();
    calls = [];
  });

  function tierPainter(tier: UiEffectsTier): AurasPainter {
    const facet = recordingFacet();
    calls = facet.calls;
    const deps: AurasPainterDeps = {
      resolveIconUrl: (key) => `url(${key})`,
      renderTooltip: (name, remaining) => `${name}|${Math.ceil(remaining)}`,
      attachTooltip: tooltips.attachTooltip,
      attachCancel: () => {},
    };
    return new AurasPainter(
      facet.writers,
      container as unknown as HTMLElement,
      deps,
      fakeDoc,
      () => tier,
    );
  }
  const nodes = () => container.childNodes;
  const manyBuffs = (count: number) =>
    state(Array.from({ length: count }, (_, i) => slot({ key: `aura${i}` })));
  // Did the painter toggle the `debuff` class ON for any node this paint (i.e. a debuff
  // actually rendered)? Identity of the node does not matter, only that the debuff write
  // fired, which it only does for a rendered slot.
  const aDebuffRendered = () =>
    calls.some((c) => c.m === 'toggleClass' && c.args[0] === 'debuff' && c.args[1] === true);

  it('ultra renders every active aura (uncapped, byte-equivalent)', () => {
    const over = AURA_VISIBLE_CAP_LOW + 5;
    tierPainter('ultra').paint(manyBuffs(over));
    expect(nodes()).toHaveLength(over);
  });

  it('low caps the rendered BUFF count at AURA_VISIBLE_CAP_LOW, dropping buff overflow', () => {
    // A buff-only bar (the common case): low keeps the first cap buffs, drops the rest.
    const over = AURA_VISIBLE_CAP_LOW + 5;
    tierPainter('low').paint(manyBuffs(over));
    expect(nodes()).toHaveLength(AURA_VISIBLE_CAP_LOW);
    expect(nodes().length).toBeLessThan(over);
  });

  it('low under the cap renders every aura (the cap only bites past the limit)', () => {
    tierPainter('low').paint(manyBuffs(AURA_VISIBLE_CAP_LOW - 2));
    expect(nodes()).toHaveLength(AURA_VISIBLE_CAP_LOW - 2);
  });

  it('FAIRNESS: low NEVER culls a debuff -- a debuff past the buff cap still renders', () => {
    // The player buff bar is mode 'all' (buffs + debuffs interleaved). A flat first-N cap
    // would hide a debuff applied after the front buffs; the debuff-priority cap renders it
    // anyway (it is the actionable half; there is no self-dispel). Build cap+2 leading buffs
    // then one debuff at the end (the worst case, well past the cap): the debuff renders and
    // the buff overflow is what gets shed instead.
    const slots = Array.from({ length: AURA_VISIBLE_CAP_LOW + 2 }, (_, i) =>
      slot({ key: `buff${i}` }),
    );
    slots.push(slot({ key: 'boss_curse', isDebuff: true, name: 'Boss Curse', remaining: 9 }));
    tierPainter('low').paint(state(slots));
    // cap buffs + the never-culled debuff = cap + 1 nodes; the 2 trailing buffs are shed.
    expect(nodes()).toHaveLength(AURA_VISIBLE_CAP_LOW + 1);
    expect(aDebuffRendered()).toBe(true);
  });

  it('low renders ALL debuffs even when debuffs alone exceed the cap (a debuff is never the shed)', () => {
    // A pathological all-debuff bar (cap+3 debuffs): none may be hidden, so the count
    // exceeds the cap. Debuffs are the actionable half; the cap only ever sheds buffs.
    const debuffs = Array.from({ length: AURA_VISIBLE_CAP_LOW + 3 }, (_, i) =>
      slot({ key: `dot${i}`, isDebuff: true }),
    );
    tierPainter('low').paint(state(debuffs));
    expect(nodes()).toHaveLength(AURA_VISIBLE_CAP_LOW + 3);
  });

  it('the tiered painter is deterministic: identical painted output by value for the same state', () => {
    // The painter consumes AurasState (the already-normalized, parity-identical view
    // output), so cross-world SHAPE parity (Sim {stacks:1} vs ClientWorld {stacks:undefined},
    // the value-zeroed buff_* case) is a VIEW concern, covered in auras_view.test.ts. Here we
    // pin that the painter itself, at a fixed low tier, is a pure function of its state: feed
    // the SAME logical aura set (a debuff past the cap among buffs) through two independent
    // painters and assert identical painted OUTPUT by value (not just count) -- the icon URLs,
    // debuff toggles, and duration/stacks text -- and that the debuff-priority cap selection
    // (cap buffs + the kept debuff) is reproduced.
    const build = () => {
      const s = Array.from({ length: AURA_VISIBLE_CAP_LOW + 2 }, (_, i) =>
        slot({ key: `b${i}`, iconKey: `ic${i}`, durationText: `${i}s` }),
      );
      s.push(slot({ key: 'curse', iconKey: 'ic_curse', isDebuff: true, durationText: '9s' }));
      return state(s);
    };
    // Reduce each run's writes to a value-only signature (drop the per-run node identity).
    const sig = (cs: Call[]) => cs.map((c) => `${c.m}:${JSON.stringify(c.args)}`);

    const simPainter = tierPainter('low');
    simPainter.paint(build());
    const simSig = sig(calls);
    const simCount = nodes().length;

    container = fakeEl('div'); // fresh container + facet for the client-mirror run
    const clientPainter = tierPainter('low');
    clientPainter.paint(build());

    expect(nodes().length).toBe(simCount);
    expect(nodes().length).toBe(AURA_VISIBLE_CAP_LOW + 1); // cap buffs + the kept debuff
    expect(sig(calls)).toEqual(simSig); // identical painted output, value for value
  });
});

// ---------------------------------------------------------------------------
// End-to-end (view -> painter) for the negative-value stat-sap. The wire now carries the
// sap's negative value, so it classifies as a debuff in BOTH worlds; this drives a sap
// through the REAL createAurasView into the low painter and asserts the debuff-priority cap
// renders it past the buff budget. The wire half (server emit + client decode) lives in
// tests/snapshots.test.ts; the pure classification in tests/auras_view.test.ts. This guard
// pins the coupling between the two (view marks isDebuff, painter keys the cap on isDebuff).
// ---------------------------------------------------------------------------
describe('AurasPainter: a wire-faithful buff_* stat-sap survives the low cap (view -> painter)', () => {
  it('renders a negative-value buff_int sap behind cap+2 leading raid buffs on low', () => {
    const container = fakeEl('div');
    const facet = recordingFacet();
    const tips = recordingTooltips();
    const painterDeps: AurasPainterDeps = {
      resolveIconUrl: (key) => `url(${key})`,
      renderTooltip: (name, remaining) => `${name}|${Math.ceil(remaining)}`,
      attachTooltip: tips.attachTooltip,
      attachCancel: () => {},
    };
    const painter = new AurasPainter(
      facet.writers,
      container as unknown as HTMLElement,
      painterDeps,
      fakeDoc,
      () => 'low',
    );
    const viewDeps: AurasDeps = {
      iconId: (a) => a.id,
      auraName: (a) => a.name,
      formatStacks: (n) => String(n),
      isOwn: () => false,
      durationUnits: () => ({ s: 's', m: 'm', h: 'h', d: 'd' }),
      auraEffectHtml: () => '',
    };
    const view = createAurasView('all', viewDeps);
    // cap+2 leading raid buffs (the worst case), then the negative-value sap last.
    const auras: AuraInput[] = Array.from({ length: AURA_VISIBLE_CAP_LOW + 2 }, (_, i) => ({
      id: `buff${i}`,
      name: `Buff ${i}`,
      kind: 'buff_ap',
      remaining: 600,
      value: 50,
    }));
    auras.push({ id: 'enfeeble', name: 'Enfeeble', kind: 'buff_int', remaining: 8, value: -30 });

    painter.paint(view.tick({ auras }));

    // cap buffs + the never-culled sap = cap + 1 nodes; the 2 trailing buffs are shed.
    expect(container.childNodes).toHaveLength(AURA_VISIBLE_CAP_LOW + 1);
    // the sap actually rendered: its debuff class toggled on for a rendered node.
    expect(
      facet.calls.some(
        (c) => c.m === 'toggleClass' && c.args[0] === 'debuff' && c.args[1] === true,
      ),
    ).toBe(true);
  });
});
