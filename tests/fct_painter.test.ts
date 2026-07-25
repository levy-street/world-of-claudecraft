// Pooled FCT painter: the no-raw-write + no-magic source guards,
// and an end-to-end pool proof over a tiny fake DOM (no jsdom): a FIXED cap that the live
// node count never exceeds, FIFO-by-spawn-order eviction (array position, no sequence
// counter) that reuses the oldest slot, correct TTL recycle including interleaved with
// over-cap eviction, no dropped or duplicated text under rapid spawn, the getUiScale author-space
// divide + behind-cull (positioning under zoom, on both a Sim- and a ClientWorld-shaped
// anchor), the CSS-rise animation restart on reuse, and the colour-token / crit class swap.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { UiEffectsTier } from '../src/game/ui_effects_profile';
import { FCT_MAX_CONCURRENT_LOW, FCT_TTL_SCALE_LOW } from '../src/game/ui_tier_knobs';
import {
  DAMAGE_FCT_KINDS,
  FCT_ANCHOR_HEAD_OFFSET,
  FCT_JITTER_RANGE,
  FCT_TTL_MS,
  type FctEvent,
  type FctKind,
} from '../src/ui/fct_core';
import { FCT_POOL_CAP, FctPainter, type FctProject } from '../src/ui/fct_painter';
import type { PainterHostWriters } from '../src/ui/painter_host';

// ---------------------------------------------------------------------------
// Source guards
// ---------------------------------------------------------------------------

describe('FctPainter: no raw DOM writes, no magic values', () => {
  const src = readFileSync(new URL('../src/ui/fct_painter.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('makes no raw per-frame style / textContent / classList / setProperty / innerHTML write (setAttribute only the build-time aria-hidden)', () => {
    // Everything per-frame routes through the facet; the only direct DOM touch is the
    // offsetWidth read that forces the animation-restart reflow (a read, not a write).
    expect(code).not.toMatch(/\.style\b/);
    expect(code).not.toMatch(/\.textContent\b/);
    expect(code).not.toMatch(/\.classList\b/);
    // setAttribute appears EXACTLY once: the one-time build-time aria-hidden on each
    // pooled node (honest boundary), set in the constructor like .className, NOT a
    // per-frame write. Any per-frame raw setAttribute would push this above 1 and fail.
    expect(code.match(/\.setAttribute\b/g) ?? []).toHaveLength(1);
    expect(code).toMatch(/setAttribute\('aria-hidden', 'true'\)/);
    expect(code).not.toMatch(/\.setProperty\b/);
    expect(code).not.toMatch(/\.innerHTML\b/);
    expect(code).not.toMatch(/setTimeout/);
    expect(code).not.toMatch(/addEventListener/);
    // .className is set EXACTLY once, in the constructor (the pooled node's base class, set
    // at build). Pinning the count gives the guard teeth: any per-frame raw `node.className
    // = ...` write (the shape the old fct() used) would push this above 1 and fail here.
    expect(code.match(/\.className\b/g) ?? []).toHaveLength(1);
  });

  it('carries no literal hex / rgb / px colour value (the colours live in hud.css tokens)', () => {
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
  className: string;
  parentNode: FakeEl | null;
  childNodes: FakeEl[];
  offsetWidth: number;
  [k: string]: unknown;
  appendChild(kid: FakeEl): FakeEl;
  _detach(kid: FakeEl): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
  attrs: Record<string, string>;
}

function fakeEl(tag: string): FakeEl {
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    parentNode: null as FakeEl | null,
    childNodes: [] as FakeEl[],
    offsetWidth: 0,
    attrs: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      el.attrs[name] = value;
    },
    appendChild(kid: FakeEl) {
      // Re-appending an attached node (an evicted slot) detaches it first, then pushes it
      // to the end -- exactly real appendChild semantics, so the live count stays bounded.
      kid.parentNode?._detach(kid);
      kid.parentNode = el;
      el.childNodes.push(kid);
      return kid;
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

// The last text written to a given node (its current on-screen number).
function lastText(calls: Call[], node: unknown): string | undefined {
  let text: string | undefined;
  for (const c of calls) if (c.m === 'setText' && c.el === node) text = c.args[0] as string;
  return text;
}

function evt(over: Partial<FctEvent> & { kind: FctKind }): FctEvent {
  return {
    kind: over.kind,
    text: over.text ?? over.kind,
    target: over.target ?? { pos: { x: 0, y: 0, z: 0 }, scale: 1 },
    crit: over.crit ?? false,
    isSelf: over.isSelf ?? false,
  };
}

// A mutable projection a test can flip behind <-> in-front between frames.
function mutableProject(): {
  project: FctProject;
  set(v: { x: number; y: number; behind: boolean }): void;
} {
  let cur = { x: 0, y: 0, behind: false };
  return {
    project: () => cur,
    set: (v) => {
      cur = v;
    },
  };
}

describe('FctPainter: pooled ring over the elided writers', () => {
  let mount: FakeEl;
  let calls: Call[];

  beforeEach(() => {
    mount = fakeEl('div');
    calls = recordingFacet().calls;
  });

  // A painter with a small cap + fixed projection/scale/jitter, for the lifecycle tests.
  function makePainter(
    opts: { cap?: number; project?: FctProject; scale?: number; jitter?: number } = {},
  ): FctPainter {
    const facet = recordingFacet();
    calls = facet.calls;
    return new FctPainter(
      facet.writers,
      mount as unknown as HTMLElement,
      opts.project ?? (() => ({ x: 0, y: 0, behind: false })),
      () => opts.scale ?? 1,
      { cap: opts.cap ?? 4, doc: fakeDoc, random: () => opts.jitter ?? 0.5 },
    );
  }

  const liveNodes = () => mount.childNodes;

  it('pre-allocates the pool: no node is in the DOM until spawn, none created after', () => {
    const painter = makePainter({ cap: 3 });
    expect(liveNodes()).toHaveLength(0);
    expect(painter.liveCount()).toBe(0);
    painter.spawn(evt({ kind: 'heal', text: '+5' }), 0);
    expect(liveNodes()).toHaveLength(1);
    expect(liveNodes()[0].className).toBe('fct'); // base class set once at build
  });

  it('NEVER exceeds the cap: rapid over-cap spawns keep the live node count bounded', () => {
    const cap = 3;
    const painter = makePainter({ cap });
    for (let i = 1; i <= 9; i++) {
      painter.spawn(evt({ kind: 'damage-taken', text: `-${i}` }), 0);
      expect(painter.liveCount()).toBeLessThanOrEqual(cap);
      expect(liveNodes().length).toBeLessThanOrEqual(cap);
    }
    expect(painter.liveCount()).toBe(cap);
  });

  it('FIFO-by-spawn-order eviction: over-cap spawns drop the OLDEST, keep the newest, no dup', () => {
    const cap = 3;
    const painter = makePainter({ cap });
    for (let i = 1; i <= 5; i++) painter.spawn(evt({ kind: 'damage-taken', text: `-${i}` }), 0);
    // The 3 newest survive (-3, -4, -5); the 2 oldest (-1, -2) were evicted + their nodes
    // reused. No node still shows -1 / -2, and no text is duplicated.
    const surviving = liveNodes().map((n) => lastText(calls, n));
    expect(surviving).toHaveLength(cap);
    expect(new Set(surviving)).toEqual(new Set(['-3', '-4', '-5']));
    expect(surviving).not.toContain('-1');
    expect(surviving).not.toContain('-2');
  });

  it('recycles on TTL: a floater past its lifetime is removed and its slot returns to free', () => {
    const painter = makePainter({ cap: 4 });
    // Use 'heal' (FCT_TTL_MS) rather than 'xp', which now lives longer (FCT_XP_TTL_MS).
    painter.spawn(evt({ kind: 'heal', text: '+10' }), 0);
    expect(painter.liveCount()).toBe(1);
    painter.step(FCT_TTL_MS - 1); // still alive just before ttl
    expect(painter.liveCount()).toBe(1);
    expect(liveNodes()).toHaveLength(1);
    painter.step(FCT_TTL_MS); // ttl reached -> recycled
    expect(painter.liveCount()).toBe(0);
    expect(liveNodes()).toHaveLength(0);
    // The freed slot is reused (no new node allocated): the recycled node reappears.
    const before = liveNodes().length;
    painter.spawn(evt({ kind: 'heal', text: '+20' }), FCT_TTL_MS);
    expect(painter.liveCount()).toBe(1);
    expect(liveNodes().length).toBe(before + 1);
  });

  it('defaults to the real FCT_POOL_CAP and bounds the live count at it (no cap option)', () => {
    // The lifecycle tests use a tiny cap for readability; this pins the SHIPPING default so a
    // regression of FCT_POOL_CAP (the perf-gate bound) to a different value fails a unit test,
    // not only the flaky browser burst. Construct with no cap -> the exported default.
    const facet = recordingFacet();
    const painter = new FctPainter(
      facet.writers,
      mount as unknown as HTMLElement,
      () => ({ x: 0, y: 0, behind: false }),
      () => 1,
      { doc: fakeDoc, random: () => 0.5 },
    );
    for (let i = 0; i < FCT_POOL_CAP + 5; i++)
      painter.spawn(evt({ kind: 'heal', text: `+${i}` }), 0);
    expect(painter.liveCount()).toBe(FCT_POOL_CAP);
    expect(mount.childNodes.length).toBe(FCT_POOL_CAP);
  });

  it('interleaves TTL recycle and over-cap eviction with staggered bornAt: no drop, no dup, no stale', () => {
    const cap = 4;
    const painter = makePainter({ cap });
    // Three floaters with DISTINCT spawn clocks (staggered bornAt), so step() recycles only
    // the genuinely-expired one and the survivors keep their true spawn order.
    painter.spawn(evt({ kind: 'damage-taken', text: 'A' }), 0);
    painter.spawn(evt({ kind: 'damage-taken', text: 'B' }), 100);
    painter.spawn(evt({ kind: 'damage-taken', text: 'C' }), 200);
    expect(painter.liveCount()).toBe(3);
    // Age to exactly A's ttl: A (born 0) expires, B (born 100) and C (born 200) survive.
    painter.step(FCT_TTL_MS);
    expect(painter.liveCount()).toBe(2);
    expect(new Set(liveNodes().map((n) => lastText(calls, n)))).toEqual(new Set(['B', 'C']));
    // Now flood over the cap at a fresh clock: D,E fill the 2 free slots, then F,G,H evict the
    // oldest survivors in spawn order (B, then C, then D). The 4 newest (E,F,G,H) remain.
    for (const text of ['D', 'E', 'F', 'G', 'H']) {
      painter.spawn(evt({ kind: 'heal', text }), 1300);
    }
    expect(painter.liveCount()).toBe(cap);
    const surviving = liveNodes().map((n) => lastText(calls, n));
    expect(new Set(surviving)).toEqual(new Set(['E', 'F', 'G', 'H']));
    // The recycled (A) and evicted (B, C, D) text never lingers on a reused node.
    for (const gone of ['A', 'B', 'C', 'D']) expect(surviving).not.toContain(gone);
  });

  it('an empty pool makes step() a no-op (no writes, holds the perf gate by construction)', () => {
    const painter = makePainter({ cap: 4 });
    const before = calls.length;
    painter.step(0);
    painter.step(1000);
    expect(calls.length).toBe(before);
  });

  it('positions in author space: (projected x + jitter) / uiScale and y / uiScale', () => {
    // jitter 0.5 -> offset 0; scale 2 -> halve the projected point.
    const painter = makePainter({
      project: () => ({ x: 300, y: 200, behind: false }),
      scale: 2,
      jitter: 0.5,
    });
    painter.spawn(evt({ kind: 'damage-taken', text: '-7' }), 0);
    const node = liveNodes()[0];
    const styleFor = (prop: string) =>
      calls.filter((c) => c.m === 'setStyleProp' && c.el === node && c.args[0] === prop).at(-1)
        ?.args[1];
    expect(styleFor('left')).toBe('150px'); // (300 + 0) / 2
    expect(styleFor('top')).toBe('100px'); // 200 / 2
  });

  it('bakes the injected jitter into x (min at 0, max at 1, centred at 0.5)', () => {
    const half = FCT_JITTER_RANGE / 2; // 15
    for (const [j, expected] of [
      [0, `${(300 - half) / 2}px`],
      [1, `${(300 + half) / 2}px`],
    ] as const) {
      mount = fakeEl('div');
      const painter = makePainter({
        project: () => ({ x: 300, y: 0, behind: false }),
        scale: 2,
        jitter: j,
      });
      painter.spawn(evt({ kind: 'damage-taken', text: '-1' }), 0);
      const node = mount.childNodes[0];
      const left = calls
        .filter((c) => c.m === 'setStyleProp' && c.el === node && c.args[0] === 'left')
        .at(-1)?.args[1];
      expect(left).toBe(expected);
    }
  });

  it('behind-culls at spawn (no slot wasted): a number behind the camera spawns nothing', () => {
    const mp = mutableProject();
    const painter = makePainter({ project: mp.project, cap: 4 });
    // Anchor behind the camera at spawn: claim no slot (faithful to the live `return`).
    mp.set({ x: 0, y: 0, behind: true });
    painter.spawn(evt({ kind: 'heal', text: '+5' }), 0);
    expect(painter.liveCount()).toBe(0);
    expect(liveNodes()).toHaveLength(0);
    // An in-front anchor claims a slot.
    mp.set({ x: 10, y: 10, behind: false });
    painter.spawn(evt({ kind: 'heal', text: '+5' }), 0);
    expect(painter.liveCount()).toBe(1);
  });

  it('is screen-anchored: step() does NOT reposition a live floater (only TTL recycles)', () => {
    const mp = mutableProject();
    mp.set({ x: 100, y: 100, behind: false });
    const painter = makePainter({ project: mp.project, scale: 1, jitter: 0.5 });
    painter.spawn(evt({ kind: 'damage-taken', text: '-1' }), 0);
    const node = liveNodes()[0];
    const leftWrites = () =>
      calls.filter((c) => c.m === 'setStyleProp' && c.el === node && c.args[0] === 'left').length;
    expect(leftWrites()).toBe(1); // positioned exactly once at spawn
    // The anchor "moves" and a frame ticks: a screen-anchored number must NOT reposition
    // (the old fct() / WoW combat text floats up in screen space, it does not chase the camera).
    mp.set({ x: 240, y: 100, behind: false });
    painter.step(1);
    expect(leftWrites()).toBe(1); // no new left write -> stayed put on screen
  });

  it('restarts the CSS rise only when an ATTACHED node is evicted (free/recycled restart naturally)', () => {
    const painter = makePainter({ cap: 1 });
    painter.spawn(evt({ kind: 'heal', text: '+5' }), 0);
    const node = liveNodes()[0];
    const animOf = () =>
      calls
        .filter((c) => c.m === 'setStyleProp' && c.el === node && c.args[0] === 'animation')
        .map((c) => c.args[1]);
    // First spawn off the free list: NO forced restart (a detached node animates on append).
    expect(animOf()).toEqual([]);
    // TTL-recycle then respawn into the (now detached, cross-tick) node: still no forced restart.
    painter.step(FCT_TTL_MS);
    painter.spawn(evt({ kind: 'heal', text: '+9' }), FCT_TTL_MS);
    expect(animOf()).toEqual([]);
    // Over-cap spawn with NO recycle: the still-attached node is evicted + reused in the same
    // tick, which the browser would not restart, so the painter forces it (none -> restore).
    painter.spawn(evt({ kind: 'heal', text: '+12' }), FCT_TTL_MS);
    expect(animOf()).toEqual(['none', '']);
  });

  it('swaps the colour-token + crit class on reuse (old colour off, new on; crit toggled)', () => {
    const painter = makePainter({ cap: 1 });
    painter.spawn(evt({ kind: 'heal', text: '+5', crit: false }), 0);
    const node = liveNodes()[0];
    const toggles = () =>
      calls.filter((c) => c.m === 'toggleClass' && c.el === node).map((c) => c.args);
    expect(toggles()).toContainEqual(['fct-heal', true]);
    expect(toggles()).toContainEqual(['crit', false]);
    // Reuse the same single slot for a crit xp floater: heal off, xp on, crit on.
    painter.step(FCT_TTL_MS);
    painter.spawn(evt({ kind: 'xp', text: '+10 XP', crit: true }), FCT_TTL_MS);
    expect(toggles()).toContainEqual(['fct-heal', false]);
    expect(toggles()).toContainEqual(['fct-xp', true]);
    expect(toggles()).toContainEqual(['crit', true]);
  });

  it('routes EVERY spawn write through the elided facet (no raw DOM path)', () => {
    const painter = makePainter({ project: () => ({ x: 50, y: 60, behind: false }), scale: 1 });
    painter.spawn(evt({ kind: 'damage-done-ability', text: '123', crit: true }), 0);
    const node = liveNodes()[0];
    const on = (m: Call['m'], pred: (c: Call) => boolean) =>
      calls.some((c) => c.m === m && c.el === node && pred(c));
    expect(on('setText', (c) => c.args[0] === '123')).toBe(true);
    expect(
      on('toggleClass', (c) => c.args[0] === 'fct-damage-done-ability' && c.args[1] === true),
    ).toBe(true);
    expect(on('toggleClass', (c) => c.args[0] === 'crit' && c.args[1] === true)).toBe(true);
    expect(on('setStyleProp', (c) => c.args[0] === 'left')).toBe(true);
    expect(on('setStyleProp', (c) => c.args[0] === 'top')).toBe(true);
    // No setDisplay: a node is shown by being attached (appendChild) and hidden by remove();
    // the spawn path never writes display, so there must be no setDisplay call at all.
    expect(calls.some((c) => c.m === 'setDisplay')).toBe(false);
  });

  // ClientWorld-vs-Sim parity: the painter reads ONLY pos.{x,y,z} + scale off
  // the anchor entity, so an offline Sim entity and an online ClientWorld-mirror entity (the
  // SAME structural shape) position identically. A Sim-only field assumption would pass the
  // offline gate and misrender online; this drives both shapes through the getUiScale divide.
  it('positions identically off a Sim-shaped and a ClientWorld-mirror-shaped anchor', () => {
    const project: FctProject = (x, y) => ({ x: x * 100, y: y * 100, behind: false });
    const run = (target: FctEvent['target']) => {
      mount = fakeEl('div');
      const facet = recordingFacet();
      const painter = new FctPainter(
        facet.writers,
        mount as unknown as HTMLElement,
        project,
        () => 2,
        {
          cap: 2,
          doc: fakeDoc,
          random: () => 0.5,
        },
      );
      painter.spawn(evt({ kind: 'damage-taken', text: '-9', target }), 0);
      const node = mount.childNodes[0];
      const get = (prop: string) =>
        facet.calls
          .filter((c) => c.m === 'setStyleProp' && c.el === node && c.args[0] === prop)
          .at(-1)?.args[1];
      return { left: get('left'), top: get('top') };
    };
    // Same coords from each world (Sim object literal vs a ClientWorld mirror record): the
    // painter has no field beyond pos + scale to diverge on, so the divided position agrees.
    const sim = run({ pos: { x: 1, y: 2, z: 3 }, scale: 1.5 });
    const online = run({ pos: { x: 1, y: 2, z: 3 }, scale: 1.5 });
    expect(sim).toEqual(online);
    // and the getUiScale divide is actually applied: anchor y = pos.y + 2.2*scale, then
    // project (*100), then / uiScale (2). Computed the same way the painter does so the
    // float matches exactly.
    const anchorY = 2 + FCT_ANCHOR_HEAD_OFFSET * 1.5;
    expect(sim.top).toBe(`${(anchorY * 100) / 2}px`);
  });
});

// Sanity: the painter's default cap is the exported bound the perf gate asserts against.
describe('FctPainter: the exported cap', () => {
  it('exposes FCT_POOL_CAP as a positive bound', () => {
    expect(FCT_POOL_CAP).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The pool cap / TTL knobs are a pure function of the STATIC ui effects tier
// (data-fx-level), NEVER the governor. These drive the painter through the injected
// getFxTier accessor and assert: ultra is byte-equivalent to the untiered painter (full
// cap, full TTL) and low sheds cost ONLY through a tighter live cap + a shorter TTL, never
// by refusing a floater. Every floater (including a non-crit damage number, the player's
// primary combat feedback) still spawns on low, identically under a Sim- and a
// ClientWorld-shaped anchor.
// ---------------------------------------------------------------------------

describe('FctPainter: static-preset tiering', () => {
  let mount: FakeEl;
  let calls: Call[];

  beforeEach(() => {
    mount = fakeEl('div');
    calls = recordingFacet().calls;
  });

  function tierPainter(tier: UiEffectsTier, cap = FCT_POOL_CAP): FctPainter {
    const facet = recordingFacet();
    calls = facet.calls;
    return new FctPainter(
      facet.writers,
      mount as unknown as HTMLElement,
      () => ({ x: 0, y: 0, behind: false }),
      () => 1,
      { cap, doc: fakeDoc, random: () => 0.5, getFxTier: () => tier },
    );
  }
  const liveNodes = () => mount.childNodes;

  it('no-drop: low still spawns every non-crit DAMAGE number (the primary combat feedback)', () => {
    const low = tierPainter('low', 16);
    // Non-crit damage numbers are the player's core combat feedback: never refused on low.
    // (The previous drop-non-crit shed hid the player's own hits on their target; removed.)
    low.spawn(evt({ kind: 'damage-taken', text: '-7', crit: false }), 0);
    low.spawn(evt({ kind: 'damage-done-auto', text: '12', crit: false }), 0);
    expect(low.liveCount()).toBe(2);
    // A crit damage number is likewise spawned.
    low.spawn(evt({ kind: 'damage-done-ability', text: '99', crit: true }), 0);
    expect(low.liveCount()).toBe(3);
    expect(lastText(calls, liveNodes()[2])).toBe('99');
    // The non-damage floaters spawn on low too: xp, the self-note hint, heals, avoidance words.
    low.spawn(evt({ kind: 'xp', text: '+10 XP', crit: false }), 0);
    low.spawn(evt({ kind: 'self-note', text: 'Cannot move', crit: false }), 0);
    low.spawn(evt({ kind: 'heal', text: '+5', crit: false }), 0);
    low.spawn(evt({ kind: 'miss', text: 'Miss', crit: false }), 0);
    expect(low.liveCount()).toBe(7); // 3 damage + xp + self-note + heal + miss

    const ultra = tierPainter('ultra', 8);
    ultra.spawn(evt({ kind: 'damage-taken', text: '-7', crit: false }), 0);
    expect(ultra.liveCount()).toBe(1); // ultra keeps non-crit damage too (byte-equivalent)
  });

  it('no-drop holds UNIFORMLY across all three damage kinds (non-crit AND crit both spawn)', () => {
    // Iterate the whole DAMAGE_FCT_KINDS set (so a future damage kind is auto-covered) and
    // pin that low spawns BOTH a non-crit and a crit of every kind: no damage number is ever
    // shed by the tier.
    for (const kind of DAMAGE_FCT_KINDS) {
      const low = tierPainter('low', 8);
      low.spawn(evt({ kind, text: '1', crit: false }), 0);
      expect(low.liveCount()).toBe(1); // non-crit damage of EVERY kind spawns on low
      low.spawn(evt({ kind, text: '2', crit: true }), 0);
      expect(low.liveCount()).toBe(2); // and a crit of EVERY kind spawns too
    }
  });

  it('max-concurrent: low caps the live count tighter than the pre-allocated pool', () => {
    const low = tierPainter('low', FCT_POOL_CAP);
    // Well over the low cap; the cap (not any drop) is what bounds the live count.
    for (let i = 0; i < FCT_MAX_CONCURRENT_LOW + 16; i++) {
      low.spawn(evt({ kind: 'damage-done-ability', text: `${i}`, crit: true }), 0);
    }
    expect(low.liveCount()).toBe(FCT_MAX_CONCURRENT_LOW);
    expect(liveNodes().length).toBe(FCT_MAX_CONCURRENT_LOW);

    // Ultra over the SAME spawn count stays uncapped until the pool itself fills.
    const ultra = tierPainter('ultra', FCT_POOL_CAP);
    for (let i = 0; i < FCT_MAX_CONCURRENT_LOW + 16; i++) {
      ultra.spawn(evt({ kind: 'damage-done-ability', text: `${i}`, crit: true }), 0);
    }
    expect(ultra.liveCount()).toBe(FCT_MAX_CONCURRENT_LOW + 16);
    expect(ultra.liveCount()).toBeGreaterThan(low.liveCount());
  });

  it('TTL: low recycles a floater earlier (FCT_TTL_MS * scale) than ultra', () => {
    const lowTtl = FCT_TTL_MS * FCT_TTL_SCALE_LOW;
    const low = tierPainter('low', 4);
    low.spawn(evt({ kind: 'heal', text: '+5', crit: true }), 0);
    low.step(lowTtl - 1);
    expect(low.liveCount()).toBe(1); // alive just before the shortened ttl
    low.step(lowTtl);
    expect(low.liveCount()).toBe(0); // recycled at the shortened ttl

    // Ultra is still alive at the same clock (full 1250ms ttl), proving low is shorter.
    const ultra = tierPainter('ultra', 4);
    ultra.spawn(evt({ kind: 'heal', text: '+5', crit: true }), 0);
    ultra.step(lowTtl);
    expect(ultra.liveCount()).toBe(1);
    ultra.step(FCT_TTL_MS);
    expect(ultra.liveCount()).toBe(0);
  });

  it('the tier behaves identically for a Sim- and a ClientWorld-shaped anchor', () => {
    // The painter reads the event, not the anchor; assert the tiered spawn is anchor-shape
    // independent. Sim-shaped anchor carries sim-only junk the descriptor must ignore; the
    // ClientWorld mirror is lean. Both: a non-crit and a crit damage number both spawn on low.
    const simAnchor = {
      pos: { x: 1, y: 2, z: 3 },
      scale: 1,
      hp: 100,
      maxHp: 100,
    } as FctEvent['target'];
    const clientAnchor = { pos: { x: 1, y: 2, z: 3 }, scale: 1 } as FctEvent['target'];
    for (const anchor of [simAnchor, clientAnchor]) {
      mount = fakeEl('div'); // fresh mount + facet per anchor (tierPainter reads both)
      const low = tierPainter('low', 8);
      low.spawn(evt({ kind: 'damage-taken', text: '-7', crit: false, target: anchor }), 0);
      expect(low.liveCount()).toBe(1);
      low.spawn(evt({ kind: 'damage-done-ability', text: '42', crit: true, target: anchor }), 0);
      expect(low.liveCount()).toBe(2);
      expect(lastText(calls, liveNodes()[1])).toBe('42');
    }
  });
});

// The per-kind colours moved out of TS into hud.css's .fct-<token> rules, so the
// faithfulness guard for them must live where the colours now are: this asserts each token rule
// still carries the EXACT hex the live fct() passed. A drift (a heal that is no longer #3ce63c,
// say) fails here. It reads CSS, never TS, so it reintroduces no hex into the painter.
describe('FCT colour tokens: the .fct-<token> hex stays byte-faithful to the old fct()', () => {
  const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
  // token -> the exact hex the live per-event fct() passed for that spawn kind.
  const PINNED: Record<string, string> = {
    'fct-miss-self': '#bbb',
    'fct-dodge-self': '#bbb',
    'fct-miss-other': '#fff',
    'fct-dodge-other': '#fff',
    'fct-damage-done-auto': '#fff',
    'fct-damage-done-ability': '#ffe97a',
    'fct-damage-taken': '#ff5544',
    'fct-absorb': '#9fd7ff',
    'fct-heal': '#3ce63c',
    'fct-xp': '#d9a3ff',
    'fct-rested-xp': '#6db8ff',
    'fct-honor': '#ffd100',
    'fct-self-note': '#ff8c66',
  };

  it('declares every descriptor colour token with its pinned hex', () => {
    for (const [token, hex] of Object.entries(PINNED)) {
      // Find the selector (it may be grouped with siblings), then assert the colour in its block.
      const at = css.indexOf(`.${token}`);
      expect(at, `.${token} selector present in hud.css`).toBeGreaterThanOrEqual(0);
      const block = css.slice(at, css.indexOf('}', at)).toLowerCase();
      expect(block, `.${token} -> color: ${hex}`).toContain(`color: ${hex}`);
    }
  });
});
