// THE SINGLE-SLOT COLLISION, proven against the REAL painters.
//
// makeWriterFacet's four single-slot writers (setText / setDisplay /
// setTransform / setWidth) share ONE cache entry per element: `{ kind, value }`,
// compared as `entry.kind === kind && entry.value === value`
// (painter_host.ts shouldWriteSingleSlot). So an element written through TWO
// DIFFERENT single-slot writers has that entry flipped by each call, the equality
// is false every time, and BOTH writes bypass elision forever. Nothing renders
// wrong. The writes simply never elide, and they count as real writes in
// hotDomWrites.
//
// tests/painter_host.test.ts pins the mechanism on the facet itself (the DEFEAT /
// FIX pair). This file pins it where it shipped: real painters, driven across two
// STEADY polls, over the REAL facet and its real caches. A recording stub cannot
// show this at all, because a stub has no cache to collide in.
//
// It asserts SKIPS, not just writes. A painter that stopped painting altogether
// would also report zero writes, so writes-only assertions pass on both the
// broken and the fixed shape and prove nothing.

import { describe, expect, it } from 'vitest';
import { AurasPainter, type AurasPainterDeps } from '../src/ui/auras_painter';
import type { AuraSlotState, AurasState } from '../src/ui/auras_view';
import {
  type QuestStripPaintDescriptor,
  QuestStripPainter,
  type QuestStripPaintModel,
} from '../src/ui/hud/quest/quest_strip_painter';
import { makeWriterFacet, type SingleSlotEntry } from '../src/ui/painter_host';

// A DOM-free node carrying exactly the surface the real facet writes plus the
// structure AurasPainter's keyed pool walks.
interface FakeNode {
  tagName: string;
  className: string;
  textContent: string;
  parentNode: FakeNode | null;
  childNodes: FakeNode[];
  style: {
    display: string;
    width: string;
    transform: string;
    setProperty(p: string, v: string): void;
  };
  classList: { toggle(cls: string, on: boolean): void };
  props: Record<string, string>;
  classes: Record<string, boolean>;
  attrs: Record<string, string>;
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
  addEventListener(): void;
  appendChild(kid: FakeNode): FakeNode;
  insertBefore(node: FakeNode, ref: FakeNode | null): FakeNode;
  remove(): void;
  _detach(kid: FakeNode): void;
  readonly firstChild: FakeNode | null;
  readonly nextSibling: FakeNode | null;
}

function fakeNode(tag = 'div'): FakeNode {
  const props: Record<string, string> = {};
  const classes: Record<string, boolean> = {};
  const attrs: Record<string, string> = {};
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    parentNode: null as FakeNode | null,
    childNodes: [] as FakeNode[],
    props,
    classes,
    attrs,
    style: {
      display: '',
      width: '',
      transform: '',
      setProperty(p: string, v: string): void {
        props[p] = v;
      },
    },
    classList: {
      toggle(cls: string, on: boolean): void {
        classes[cls] = on;
      },
    },
    setAttribute(n: string, v: string): void {
      attrs[n] = v;
    },
    removeAttribute(n: string): void {
      delete attrs[n];
    },
    addEventListener(): void {},
    appendChild(kid: FakeNode) {
      kid.parentNode?._detach(kid);
      kid.parentNode = el;
      el.childNodes.push(kid);
      return kid;
    },
    insertBefore(node: FakeNode, ref: FakeNode | null) {
      node.parentNode?._detach(node);
      node.parentNode = el;
      const i = ref ? el.childNodes.indexOf(ref) : -1;
      if (i < 0) el.childNodes.push(node);
      else el.childNodes.splice(i, 0, node);
      return node;
    },
    _detach(kid: FakeNode) {
      const i = el.childNodes.indexOf(kid);
      if (i >= 0) el.childNodes.splice(i, 1);
    },
    remove() {
      el.parentNode?._detach(el);
      el.parentNode = null;
    },
    get firstChild() {
      return el.childNodes[0] ?? null;
    },
    get nextSibling() {
      const p = el.parentNode;
      if (!p) return null;
      return p.childNodes[p.childNodes.indexOf(el) + 1] ?? null;
    },
  } as unknown as FakeNode;
  return el;
}

const fakeDoc = { createElement: (tag: string) => fakeNode(tag) } as unknown as Document;

/** The REAL facet over REAL caches, with the host's write/skip counters. */
function realFacet() {
  const counts = { writes: 0, skips: 0 };
  const facet = makeWriterFacet(
    new Map<HTMLElement, SingleSlotEntry>(),
    new Map<HTMLElement, Map<string, string>>(),
    new Map<HTMLElement, Map<string, string>>(),
    new Map<HTMLElement, Map<string, string>>(),
    () => {
      counts.writes++;
    },
    () => {
      counts.skips++;
    },
  );
  return { facet, counts };
}

function auraSlot(over: Partial<AuraSlotState> & { key: string }): AuraSlotState {
  return {
    iconKey: over.key,
    isDebuff: false,
    school: '',
    own: false,
    expiring: false,
    durationText: '',
    stacksText: '',
    name: over.key,
    remaining: 0,
    cancelable: false,
    effectHtml: '',
    toggle: false,
    alwaysRender: false,
    ...over,
  };
}

describe('auras_painter: the stacks badge elides across steady frames', () => {
  // THE HOT SITE. AurasPainter is per-frame, so before the fix every stacking
  // aura paid two un-elided DOM writes on the badge EVERY frame, for the whole
  // life of the aura. In combat that is most auras.
  function driveAuras(stacksText: string) {
    const { facet, counts } = realFacet();
    const container = fakeNode('div');
    const deps: AurasPainterDeps = {
      resolveIconUrl: (key) => `url(${key})`,
      renderTooltip: (name) => name,
      attachTooltip: () => {},
      attachCancel: () => {},
    };
    const painter = new AurasPainter(facet, container as unknown as HTMLElement, deps, fakeDoc);
    const state = (): AurasState => {
      const slots = [auraSlot({ key: 'sunder', stacksText })];
      return { slots, count: slots.length };
    };
    painter.paint(state()); // establishing frame: writes are expected here
    counts.writes = 0;
    counts.skips = 0;
    painter.paint(state()); // two STEADY frames: an elided painter does nothing
    painter.paint(state());
    return { counts, container };
  }

  it('a STACKING aura writes nothing across two steady frames', () => {
    const { counts, container } = driveAuras('5');
    // The badge really is showing the count: the arm is not vacuously green
    // because the painter skipped the node.
    const badge = container.childNodes[0].childNodes[1];
    expect(badge.textContent).toBe('5');
    expect(badge.props.display).toBe('');
    // Before the fix this element alone contributed 2 writes and 0 skips per
    // frame, so this read { writes: 4, skips: N }. Both facets now elide.
    expect(counts.writes).toBe(0);
    expect(counts.skips).toBeGreaterThan(0);
  });

  it('a NON-stacking aura still writes nothing (the branch that was already fine)', () => {
    // The no-stacks branch only ever ran the visibility write, so it elided even
    // before the fix. Pinned so the fix cannot have regressed it.
    const { counts, container } = driveAuras('');
    expect(container.childNodes[0].childNodes[1].props.display).toBe('none');
    expect(counts.writes).toBe(0);
    expect(counts.skips).toBeGreaterThan(0);
  });

  it('a CHANGED stack count still writes, and only the text', () => {
    // Elision must not become suppression: the count moving has to reach the DOM.
    const { facet, counts } = realFacet();
    const container = fakeNode('div');
    const painter = new AurasPainter(
      facet,
      container as unknown as HTMLElement,
      {
        resolveIconUrl: (key) => `url(${key})`,
        renderTooltip: (name) => name,
        attachTooltip: () => {},
        attachCancel: () => {},
      },
      fakeDoc,
    );
    const paintWith = (stacksText: string): void => {
      painter.paint({ slots: [auraSlot({ key: 'sunder', stacksText })], count: 1 });
    };
    paintWith('4');
    counts.writes = 0;
    counts.skips = 0;
    paintWith('5');
    const badge = container.childNodes[0].childNodes[1];
    expect(badge.textContent).toBe('5');
    // Exactly one write: the text. The visibility is unchanged and elides.
    expect(counts.writes).toBe(1);
  });
});

describe('quest_strip_painter: the three text-and-visibility nodes elide', () => {
  // Three of the seven sites live here: the complete marker, every objective
  // line, and the "+N more" overflow line. The objective line is a loop
  // variable, which is why a scan keyed on `d.<field>` missed it.
  function descriptor(objectiveCount: number) {
    const mk = () => fakeNode('div');
    const objectives = Array.from({ length: objectiveCount }, mk);
    const d = {
      root: mk(),
      surface: mk(),
      title: mk(),
      completeMark: mk(),
      cycleHint: mk(),
      counter: mk(),
      prevArrow: mk(),
      nextArrow: mk(),
      objectives,
      more: mk(),
      hint: mk(),
    };
    return d as unknown as QuestStripPaintDescriptor & { objectives: FakeNode[] };
  }

  function model(over: Partial<QuestStripPaintModel> = {}): QuestStripPaintModel {
    return {
      visible: true,
      title: 'Wolves of the Barrow',
      complete: true,
      completeLabel: '(Complete)',
      counter: '2/3',
      counterVisible: true,
      hint: 'Quest tracker',
      objectives: [{ text: 'Wolves 3/8', done: false }],
      more: '+2 more',
      pressed: false,
      flash: null,
      ...over,
    };
  }

  it('writes nothing across two steady paints', () => {
    const { facet, counts } = realFacet();
    const d = descriptor(1);
    const painter = new QuestStripPainter(facet, d);
    painter.paint(model()); // establishing
    counts.writes = 0;
    counts.skips = 0;
    painter.paint(model());
    painter.paint(model());
    // Not vacuous: the three colliding nodes really carry their text.
    const nodes = d as unknown as {
      completeMark: FakeNode;
      more: FakeNode;
      objectives: FakeNode[];
    };
    expect(nodes.completeMark.textContent).toBe('(Complete)');
    expect(nodes.more.textContent).toBe('+2 more');
    expect(nodes.objectives[0].textContent).toBe('Wolves 3/8');
    // Before the fix these three nodes alone contributed 6 writes per paint,
    // so two steady paints read { writes: 12, skips: ... }.
    expect(counts.writes).toBe(0);
    expect(counts.skips).toBeGreaterThan(0);
  });

  it('an objective line that goes away still hides, and a returning one shows', () => {
    // The visibility facet must stay live after moving slots.
    const { facet } = realFacet();
    const d = descriptor(2);
    const nodes = d as unknown as { objectives: FakeNode[] };
    const painter = new QuestStripPainter(facet, d);
    painter.paint(
      model({
        objectives: [
          { text: 'a', done: false },
          { text: 'b', done: false },
        ],
      }),
    );
    expect(nodes.objectives[1].props.display).toBe('');
    painter.paint(model({ objectives: [{ text: 'a', done: false }] }));
    expect(nodes.objectives[1].props.display).toBe('none');
    painter.paint(
      model({
        objectives: [
          { text: 'a', done: false },
          { text: 'b', done: false },
        ],
      }),
    );
    expect(nodes.objectives[1].props.display).toBe('');
    expect(nodes.objectives[1].textContent).toBe('b');
  });

  it('a changed title still writes: elision is not suppression', () => {
    const { facet, counts } = realFacet();
    const d = descriptor(1);
    const painter = new QuestStripPainter(facet, d);
    painter.paint(model());
    counts.writes = 0;
    counts.skips = 0;
    painter.paint(model({ title: 'Barrow Deeps' }));
    expect((d as unknown as { title: FakeNode }).title.textContent).toBe('Barrow Deeps');
    expect(counts.writes).toBe(1);
  });
});
