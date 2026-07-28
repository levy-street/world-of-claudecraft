// @vitest-environment jsdom

// The spellbook's per-frame repaint contract (#2519).
//
// `spellbook_window.tickOpen()` is the ONE window `Hud.update()` drives on the per-frame
// band (`tests/hud_update_drive.test.ts` records it as such). Its `lastKnownSig` guard has
// always gated the expensive half, the full `rerenderPreservingView()`. The FALL-THROUGH was
// ungated: every frame the window was open it re-resolved the root twice, ran a
// `querySelector` for the Attack toggle plus a `querySelectorAll` subtree walk over every
// ability row, allocated a fresh `Set` from a freshly built id list, and wrote `disabled` on
// every row unelided.
//
// NOTHING IN THE THREE SOURCE GATES COULD SEE ANY OF THAT, which is why the contract is
// pinned behaviorally here rather than by another token. `.disabled` is an IDL property that
// `RAW_WRITES` deliberately does not carry (#2518 measured that question and answered it),
// `querySelector` is only counted inside a driver callback, and `spellbook_window` is a COLD
// painter, which takes no raw-write scan at all. A count over a window FILE cannot tell a
// build-time write from a per-frame one in any case. Driving the real window across repeated
// identical frames can, so that is what this file does.
//
// WHAT IS ASSERTED, and what is not. An unchanged frame is held to zero DOM lookups, zero DOM
// reads, zero DOM writes, exactly four dep reads, and zero allocating array operations
// (`watchAlloc` below, which sees `map`/`filter`/`flatMap`/`slice`/`concat`/`join`/`Array.from`
// plus `@@iterator`, so `for...of`, spread and `new Set(array)` all count). Node cannot count
// heap allocations directly, so that array watch is the honest approximation and its limit is
// stated where it lives: a closure or a template literal built inside the tick is invisible to
// it, which is why both comparison paths are also written as index loops a reader can check.
//
// The rebuild gate that got cheaper is still held to what it always covered, and per FIELD:
// one describe below drives one talent-shaped change at a time, because a comparison that
// quietly stopped looking at `cooldown` (or at the tail of the list) moves no other assertion
// in this file.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedAbility } from '../src/sim/sim';
import { tEntity } from '../src/ui/entity_i18n';
import type { HotbarAction } from '../src/ui/hud/action_bar/hotbar';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { SpellbookWindow, type SpellbookWindowDeps } from '../src/ui/spellbook_window';

// jsdom ships no 2D canvas, so the procedural ability-icon compositor cannot run
// here; the painter only ever uses the returned string as a CSS background-image.
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: () => 'data:,',
}));

const CLASS_ID = 'warrior';
// Five learned, action-bar-eligible warrior abilities with no spec gate, so every one of them
// renders a row WITH a +/- toggle. More than one on purpose: a single-row fixture cannot see a
// per-row guard, and half the claims below are about painting one row and not its neighbours.
const KNOWN_IDS = ['heroic_strike', 'battle_shout', 'charge', 'hamstring', 'overpower'] as const;

/** A resolved ability carrying exactly the fields the window reads off it. */
function resolved(abilityId: string, over: Partial<Record<string, number>> = {}): ResolvedAbility {
  return {
    def: { id: abilityId },
    rank: 1,
    cost: 10,
    castTime: 0,
    cooldown: 0,
    ...over,
  } as unknown as ResolvedAbility;
}

/** An ability bar slot holding `abilityId`. */
function slot(abilityId: string): HotbarAction {
  return { type: 'ability', id: abilityId };
}

/** An ITEM bar slot. The bar holds these too, and they are not ability ids. */
function itemSlot(itemId: string): HotbarAction {
  return { type: 'item', id: itemId };
}

interface Harness {
  win: SpellbookWindow;
  root: HTMLElement;
  deps: SpellbookWindowDeps;
  /** Mutable world/bar state the deps read live. */
  state: {
    known: ResolvedAbility[];
    bar: HotbarAction[];
    hasFree: boolean;
    attackOnBar: boolean;
  };
  /** How many times each dep the per-frame path can reach was called. */
  calls: Record<string, number>;
  resetCalls(): void;
  /** The row toggle for `abilityId`, resolved LIVE (a rebuild replaces the node). */
  toggle(abilityId: string): HTMLButtonElement | null;
  attackToggle(): HTMLButtonElement | null;
}

function harness(): Harness {
  document.body.innerHTML = '<div id="spellbook" class="window panel"></div>';
  const root = document.getElementById('spellbook') as HTMLElement;
  const state = {
    known: KNOWN_IDS.map((id) => resolved(id)),
    // Slot 3 holds an ITEM from the start, so the ability/item discrimination in
    // slotAbilityId is exercised by every case in this file rather than by one.
    bar: [null, null, null, itemSlot('minor_healing_potion')] as HotbarAction[],
    hasFree: true,
    attackOnBar: true,
  };
  const calls: Record<string, number> = {};
  const count = <T>(name: string, value: T): T => {
    calls[name] = (calls[name] ?? 0) + 1;
    return value;
  };
  const noop = (): void => {};
  const deps: SpellbookWindowDeps = {
    root: () => count('root', root),
    world: () =>
      count('world', {
        cfg: { playerClass: CLASS_ID },
        known: state.known,
        player: { level: 60 },
        talentSpec: null,
      } as never),
    closeOthers: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    hideTooltip: noop,
    attachTooltip: noop,
    abilitySummary: () => 'summary',
    abilityTooltip: () => '<div></div>',
    barActions: () => count('barActions', state.bar),
    hasFreeSlot: () => count('hasFreeSlot', state.hasFree),
    attackOnBar: () => count('attackOnBar', state.attackOnBar),
    setAttackOnBar: (on) => {
      state.attackOnBar = on;
    },
    addToBar: (id) => {
      const free = state.bar.indexOf(null);
      if (free === -1) return false;
      state.bar[free] = slot(id);
      return true;
    },
    removeFromBar: (id) => {
      const at = state.bar.findIndex((a) => a?.type === 'ability' && a.id === id);
      if (at === -1) return false;
      state.bar[at] = null;
      return true;
    },
    hasFormBars: () => false,
    resetFormBar: noop,
    setDragAction: noop,
    clearActionDropTargets: noop,
  };
  const win = new SpellbookWindow(deps);
  return {
    win,
    root,
    deps,
    state,
    calls,
    resetCalls(): void {
      for (const key of Object.keys(calls)) delete calls[key];
    },
    toggle: (abilityId) =>
      root.querySelector<HTMLButtonElement>(`.spell-hotbar-toggle[data-ability-id="${abilityId}"]`),
    attackToggle: () => root.querySelector<HTMLButtonElement>('[data-attack-toggle]'),
  };
}

/**
 * Record every DOM MUTATION, every per-node READ the repaint makes, and every element
 * LOOKUP, at the PROTOTYPE level.
 *
 * Prototype-level on purpose: a spy bound to the nodes a test happens to hold would miss
 * exactly the regression that matters, a repaint that re-resolves its own nodes and writes
 * those instead. Style is watched through a proxy over the `style` getter rather than by
 * naming individual properties, so a write to any CSS property counts.
 *
 * THE READ CHANNEL IS WHAT PINS THE GATE, and it is not redundant with the write channel.
 * Once every write is elided per row, an UNGATED repaint still writes nothing on an
 * unchanged frame: what it costs is the elision check itself, one `getAttribute` plus one
 * `disabled` read for every row, sixty times a second. So "no DOM write" alone would pass
 * with the fall-through gate deleted; "no DOM read either" is the assertion that does not.
 */
function watchDom(): { writes: string[]; reads: string[]; queries: string[]; stop(): void } {
  const writes: string[] = [];
  const reads: string[] = [];
  const queries: string[] = [];
  const undo: Array<() => void> = [];

  const spyMethod = (target: object, name: string, into: string[]): void => {
    const original = Reflect.get(target, name) as (...args: unknown[]) => unknown;
    if (typeof original !== 'function') throw new Error(`watchDom: ${name} is not a method`);
    Reflect.set(target, name, function (this: unknown, ...args: unknown[]) {
      into.push(`${name}(${String(args[0] ?? '')})`);
      return original.apply(this, args);
    });
    undo.push(() => {
      Reflect.set(target, name, original);
    });
  };

  const spyAccessor = (target: object, name: string, watchGet = false): void => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    const set = descriptor?.set;
    const get = descriptor?.get;
    if (!set) throw new Error(`watchDom: ${name} has no setter to watch`);
    if (watchGet && !get) throw new Error(`watchDom: ${name} has no getter to watch`);
    Object.defineProperty(target, name, {
      ...descriptor,
      get:
        watchGet && get
          ? function (this: unknown) {
              reads.push(name);
              return get.call(this);
            }
          : get,
      set(this: unknown, value: unknown) {
        writes.push(name);
        set.call(this, value);
      },
    });
    undo.push(() => Object.defineProperty(target, name, descriptor));
  };

  // Mutations.
  spyMethod(Element.prototype, 'setAttribute', writes);
  spyMethod(Element.prototype, 'removeAttribute', writes);
  spyMethod(DOMTokenList.prototype, 'toggle', writes);
  spyMethod(DOMTokenList.prototype, 'add', writes);
  spyMethod(DOMTokenList.prototype, 'remove', writes);
  spyAccessor(Node.prototype, 'textContent');
  spyAccessor(Element.prototype, 'innerHTML');
  spyAccessor(Element.prototype, 'className');
  // Both halves for `disabled`: the write is the IDL mutation RAW_WRITES cannot see, and the
  // read is the elision check an ungated repaint pays per row.
  spyAccessor(HTMLButtonElement.prototype, 'disabled', true);

  // Per-node reads the repaint makes.
  spyMethod(Element.prototype, 'getAttribute', reads);
  // Any CSS property write, without naming them: wrap the style object.
  const styleDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style');
  const styleGet = styleDescriptor?.get;
  if (!styleGet) throw new Error('watchDom: HTMLElement.style has no getter to wrap');
  Object.defineProperty(HTMLElement.prototype, 'style', {
    ...styleDescriptor,
    get(this: HTMLElement) {
      const real = styleGet.call(this) as CSSStyleDeclaration;
      return new Proxy(real, {
        get: (target, prop) => {
          const value = Reflect.get(target, prop) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set: (target, prop, value) => {
          writes.push(`style.${String(prop)}`);
          return Reflect.set(target, prop, value, target);
        },
      });
    },
  });
  undo.push(() => Object.defineProperty(HTMLElement.prototype, 'style', styleDescriptor));

  // Lookups.
  spyMethod(Element.prototype, 'querySelector', queries);
  spyMethod(Element.prototype, 'querySelectorAll', queries);
  spyMethod(Document.prototype, 'querySelector', queries);
  spyMethod(Document.prototype, 'querySelectorAll', queries);
  spyMethod(Document.prototype, 'getElementById', queries);

  return {
    writes,
    reads,
    queries,
    stop(): void {
      for (const restore of undo.reverse()) restore();
    },
  };
}

/**
 * Count the array operations that ALLOCATE, at the prototype level.
 *
 * "No per-frame allocation" is the half of the acceptance criterion Node cannot measure
 * directly, and the assertion it replaced (that the harness's own stub hands back the
 * harness's own array) was true by construction and could not fail for any state of the
 * window. This can: the shapes that reintroduce the garbage are all array operations, and
 * `Symbol.iterator` covers `for...of`, spread, and `new Set(array)`, which is the exact
 * construct the fall-through used to run every frame.
 *
 * A LIMIT, stated rather than implied: it sees array work only. A closure allocated inside
 * the tick, a boxed number, or a template literal is invisible to it, which is why the
 * comparison paths are also written as index loops that a reader can check by eye.
 */
function watchAlloc(): { calls: string[]; stop(): void } {
  const calls: string[] = [];
  const undo: Array<() => void> = [];
  const wrap = (target: object, key: string | symbol, label: string): void => {
    const original = Reflect.get(target, key) as (...args: unknown[]) => unknown;
    if (typeof original !== 'function') throw new Error(`watchAlloc: ${label} is not a method`);
    Reflect.set(target, key, function (this: unknown, ...args: unknown[]) {
      calls.push(label);
      return original.apply(this, args);
    });
    undo.push(() => {
      Reflect.set(target, key, original);
    });
  };
  for (const name of ['map', 'filter', 'flatMap', 'slice', 'concat', 'join'] as const) {
    wrap(Array.prototype, name, `Array#${name}`);
  }
  wrap(Array.prototype, Symbol.iterator, 'Array#@@iterator');
  wrap(Array, 'from', 'Array.from');
  return {
    calls,
    // An INDEX loop, not `for...of`: this teardown runs while the @@iterator spy is
    // still installed, so iterating here would record a call of its own and the
    // watcher would report one allocation the code under test never made.
    stop(): void {
      for (let i = undo.length - 1; i >= 0; i--) undo[i]();
    },
  };
}

/** Open the window and settle it: after this the retained state matches what was painted. */
function open(h: Harness): void {
  h.win.toggle();
  h.win.tickOpen();
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the DOM watcher records every channel it claims', () => {
  // A SELF-AUDIT, and it is not ceremony. Every assertion in this file that matters is
  // "this channel stayed EMPTY", and a count of zero cannot notice a watcher arm that
  // records nothing: an arm the window never exercises today (querySelectorAll, className,
  // removeAttribute, a style write) would ship dead and take the very regression it exists
  // for with it. So each arm gets a fixture here, exercised directly, and the mutation that
  // guts it fails HERE rather than nowhere.
  it('records every write, read and lookup arm, on a fixture per arm', () => {
    const watch = watchDom();
    const el = document.createElement('div');
    const btn = document.createElement('button');
    el.appendChild(btn);
    document.body.appendChild(el);

    el.setAttribute('data-x', '1');
    el.removeAttribute('data-x');
    el.classList.add('a');
    el.classList.remove('a');
    el.classList.toggle('b', true);
    el.textContent = 'text';
    el.innerHTML = '<span></span>';
    el.className = 'cls';
    btn.disabled = true;
    el.style.display = 'block';

    void el.getAttribute('data-x');
    void btn.disabled;

    void el.querySelector('span');
    void el.querySelectorAll('span');
    void document.querySelector('div');
    void document.querySelectorAll('div');
    void document.getElementById('nope');
    watch.stop();

    expect(watch.writes).toEqual([
      'setAttribute(data-x)',
      'removeAttribute(data-x)',
      'add(a)',
      'remove(a)',
      'toggle(b)',
      'textContent',
      'innerHTML',
      'className',
      'disabled',
      'style.display',
    ]);
    // The `disabled` write above also goes through its getter internally in jsdom, so the
    // read channel is asserted by membership rather than by an exact sequence.
    expect(watch.reads).toContain('getAttribute(data-x)');
    expect(watch.reads).toContain('disabled');
    expect(watch.queries).toEqual([
      'querySelector(span)',
      'querySelectorAll(span)',
      'querySelector(div)',
      'querySelectorAll(div)',
      'getElementById(nope)',
    ]);
  });

  it('puts every prototype back, so the spies cannot leak into another test', () => {
    const before = {
      setAttribute: Element.prototype.setAttribute,
      querySelectorAll: Element.prototype.querySelectorAll,
      getAttribute: Element.prototype.getAttribute,
      textContent: Object.getOwnPropertyDescriptor(Node.prototype, 'textContent'),
      style: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style'),
    };
    const watch = watchDom();
    expect(Element.prototype.setAttribute).not.toBe(before.setAttribute);
    watch.stop();
    expect(Element.prototype.setAttribute).toBe(before.setAttribute);
    expect(Element.prototype.querySelectorAll).toBe(before.querySelectorAll);
    expect(Element.prototype.getAttribute).toBe(before.getAttribute);
    expect(Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')).toEqual(
      before.textContent,
    );
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style')).toEqual(before.style);
  });
});

describe('spellbook per-frame tick: an unchanged frame costs nothing', () => {
  it('makes no DOM query, no DOM read and no DOM write across repeated identical frames', () => {
    const h = harness();
    open(h);
    const watch = watchDom();
    for (let i = 0; i < 10; i++) h.win.tickOpen();
    watch.stop();
    expect(
      watch.queries,
      `element lookups on an unchanged frame: ${watch.queries.join(', ')}`,
    ).toEqual([]);
    expect(watch.writes, `DOM writes on an unchanged frame: ${watch.writes.join(', ')}`).toEqual(
      [],
    );
    // The gate's own assertion: an ungated repaint writes nothing here either, and still
    // pays one aria-pressed read plus one `disabled` read per row on every frame.
    expect(watch.reads, `DOM reads on an unchanged frame: ${watch.reads.join(', ')}`).toEqual([]);
  });

  it('THE HARNESS HAS TEETH: the same watcher sees the writes a real change makes', () => {
    // Without this the assertion above passes just as well with a broken watcher, which is
    // the whole failure mode of a zero-expected counter.
    const h = harness();
    open(h);
    const watch = watchDom();
    // One row onto the bar AND the bar filling up, so every write channel the repaint owns
    // moves: the flipped row's text / class / attributes, and the other rows' `disabled`.
    h.state.bar[0] = slot('charge');
    h.state.hasFree = false;
    h.win.tickOpen();
    watch.stop();
    expect(watch.writes.length).toBeGreaterThan(0);
    expect(watch.writes).toContain('textContent');
    expect(watch.writes).toContain('disabled');
    expect(watch.writes).toContain('toggle(remove)');
    expect(watch.writes.some((w) => w.startsWith('setAttribute(aria-pressed'))).toBe(true);
    // ...and the read channel too, so a silently-empty read watcher cannot pass the
    // zero-read assertion above by accident.
    expect(watch.reads).toContain('getAttribute(aria-pressed)');
    expect(watch.reads).toContain('disabled');
  });

  it('elides `disabled` too: a pure on-bar flip writes no disabled at all', () => {
    // `disabled` was the one write left unelided on purpose, because it depends on hasFree,
    // which can move without an on-bar flip. It is diffed against the live property now, so a
    // repaint driven by a membership change alone must not touch it on ANY row.
    const h = harness();
    open(h);
    const watch = watchDom();
    h.state.bar[0] = slot('charge'); // hasFree stays true, so no row's disabled value moves
    h.win.tickOpen();
    watch.stop();
    expect(watch.writes.length, 'the flip itself must still paint').toBeGreaterThan(0);
    expect(watch.writes, `disabled was rewritten: ${watch.writes.join(', ')}`).not.toContain(
      'disabled',
    );
  });

  it('reads exactly four deps a frame, and allocates no array while doing it', () => {
    const h = harness();
    open(h);
    h.resetCalls();
    const alloc = watchAlloc();
    for (let i = 0; i < 5; i++) h.win.tickOpen();
    alloc.stop();
    expect(h.calls).toEqual({ world: 5, attackOnBar: 5, hasFreeSlot: 5, barActions: 5 });
    expect(alloc.calls, `the tick allocated: ${[...new Set(alloc.calls)].join(', ')}`).toEqual([]);
  });

  it('THE ALLOC WATCHER HAS TEETH: a rebuild frame does allocate, and is seen', () => {
    // Same failure mode as the DOM watcher: a channel only ever asserted EMPTY needs a case
    // that fills it. render() maps the kit and filters the slot list, so a rebuild is the
    // natural positive fixture.
    const h = harness();
    open(h);
    const alloc = watchAlloc();
    h.state.known = KNOWN_IDS.map((id) => resolved(id, id === 'charge' ? { cost: 5 } : {}));
    h.win.tickOpen();
    alloc.stop();
    expect(alloc.calls).toContain('Array#map');
    expect(alloc.calls).toContain('Array#filter');
  });

  it('does not re-resolve the window root on the fall-through', () => {
    // The issue names this too: refreshHotbarControls resolved deps.root() twice a frame, and
    // in the real Hud that dep is a live `document.querySelector('#spellbook')`.
    const h = harness();
    open(h);
    h.resetCalls();
    for (let i = 0; i < 5; i++) h.win.tickOpen();
    expect(h.calls.root ?? 0).toBe(0);
  });
});

describe('spellbook per-frame tick: a changed frame paints, without walking the subtree', () => {
  it('paints an on-bar flip without any element lookup', () => {
    const h = harness();
    open(h);
    const before = h.toggle('charge') as HTMLButtonElement;
    expect(before.getAttribute('aria-pressed')).toBe('false');
    const label = before.getAttribute('aria-label');
    const watch = watchDom();
    h.state.bar[0] = slot('charge');
    h.win.tickOpen();
    watch.stop();
    expect(watch.queries, `element lookups on a repaint: ${watch.queries.join(', ')}`).toEqual([]);
    expect(before.getAttribute('aria-pressed')).toBe('true');
    expect(before.textContent).toBe('-');
    expect(before.classList.contains('remove')).toBe(true);
    // The ACCESSIBLE NAME has to move with the state, or a screen reader announces a
    // pressed control that still says "Add ... to action bar" (WCAG 4.1.2). Asserted as
    // "it changed, and it now reads as the remove action", not against a literal English
    // string, since the copy is a t() key.
    const after = before.getAttribute('aria-label');
    expect(after, 'the toggle kept its add-state accessible name after going on-bar').not.toBe(
      label,
    );
    expect(after).toBe(
      t('hudChrome.spellbook.removeFromBarAria', {
        name: tEntity({ kind: 'ability', id: 'charge', field: 'name' }),
      }),
    );
  });

  it('writes ONLY the row that flipped, not its neighbours', () => {
    const h = harness();
    open(h);
    const flipped = h.toggle('charge') as HTMLButtonElement;
    const neighbour = h.toggle('hamstring') as HTMLButtonElement;
    const neighbourWrites = vi.spyOn(neighbour, 'setAttribute');
    h.state.bar[0] = slot('charge');
    h.win.tickOpen();
    expect(flipped.getAttribute('aria-pressed')).toBe('true');
    expect(neighbour.getAttribute('aria-pressed')).toBe('false');
    expect(neighbourWrites, 'an unflipped row must not be rewritten').not.toHaveBeenCalled();
    neighbourWrites.mockRestore();
  });

  it('settles: the frame after a repaint writes nothing again', () => {
    const h = harness();
    open(h);
    h.state.bar[0] = slot('charge');
    h.win.tickOpen();
    const watch = watchDom();
    h.win.tickOpen();
    h.win.tickOpen();
    watch.stop();
    expect(watch.writes).toEqual([]);
    expect(watch.reads).toEqual([]);
    expect(watch.queries).toEqual([]);
  });

  it('tracks a free-slot change with NO on-bar flip (the case `disabled` exists for)', () => {
    // hasFree is the input that moves without any membership change: the bar filling up
    // disables every off-bar row's add control while no row's aria-pressed moves. This is why
    // `disabled` cannot ride the aria-pressed elision, and it is the arm a gate keyed only on
    // the bar's contents would silently drop.
    const h = harness();
    open(h);
    const off = h.toggle('charge') as HTMLButtonElement;
    expect(off.disabled).toBe(false);
    h.state.hasFree = false;
    h.win.tickOpen();
    expect(off.disabled).toBe(true);
    h.state.hasFree = true;
    h.win.tickOpen();
    expect(off.disabled).toBe(false);
  });

  it('ignores an ITEM moving between bar slots (it is not an ability id)', () => {
    // The bar holds items too, and the slot reader has to discriminate. Without the type
    // check an item id lands in the latched slot list, so every potion drag reports a bar
    // change and repaints every row: exactly the per-event work this change removed. Worse,
    // the day an item id collides with an ability id, that row would render as on-bar.
    const h = harness();
    open(h);
    const watch = watchDom();
    h.state.bar[3] = null;
    h.state.bar[1] = itemSlot('minor_healing_potion');
    h.win.tickOpen();
    watch.stop();
    expect(
      watch.writes,
      `moving an item between bar slots repainted: ${watch.writes.join(', ')}`,
    ).toEqual([]);
    expect(watch.reads).toEqual([]);
  });

  it('does not treat an item id as an on-bar ability', () => {
    // The collision arm, driven directly rather than left to the id namespaces staying
    // disjoint: an item slot whose id happens to equal an ability's must leave that
    // ability's row reading as off-bar.
    const h = harness();
    open(h);
    h.state.bar[0] = itemSlot('charge');
    h.win.tickOpen();
    const toggle = h.toggle('charge') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toBe('+');
  });

  it('tracks the Attack toggle when only the showAttackButton setting flips', () => {
    // The Attack row's state comes from an Interface setting, not from the bar, so it is the
    // third independent input. The options window can flip it while the spellbook is open.
    const h = harness();
    open(h);
    const attack = h.attackToggle() as HTMLButtonElement;
    expect(attack.getAttribute('aria-pressed')).toBe('true');
    expect(attack.classList.contains('remove')).toBe(true);
    h.state.attackOnBar = false;
    h.win.tickOpen();
    expect(attack.getAttribute('aria-pressed')).toBe('false');
    expect(attack.textContent).toBe('+');
    // Its own arm of every write the row toggles get. `remove` is mobile-only styling
    // (hud.mobile.css), so a stale class leaves a button that adds wearing the remove
    // colors; and the accessible name is the same WCAG 4.1.2 pairing as the rows.
    expect(attack.classList.contains('remove')).toBe(false);
    expect(attack.getAttribute('aria-label')).toBe(
      t('hudChrome.spellbook.addToBarAria', { name: t('abilityUi.actionBar.attackName') }),
    );
  });
});

describe('spellbook per-frame tick: the cached refs follow the rebuild', () => {
  it('paints the LIVE toggles after a talent-driven rebuild, not the replaced ones', () => {
    // The lockpick lesson (#2498), in this window's shape: refs taken once and never
    // re-collected would paint a detached subtree forever after the first rebuild. A talent
    // allocation reassigns world.known with new numbers, which moves knownSig and rebuilds
    // every row, while the +/- refresh keeps running on the same instance.
    const h = harness();
    open(h);
    const stale = h.toggle('charge') as HTMLButtonElement;

    h.state.known = KNOWN_IDS.map((id) => resolved(id, id === 'charge' ? { cost: 5 } : {}));
    h.win.tickOpen(); // knownSig moved -> rerenderPreservingView()
    const fresh = h.toggle('charge') as HTMLButtonElement;
    expect(fresh, 'the rebuild should have replaced the toggle nodes').not.toBe(stale);

    h.state.bar[0] = slot('charge');
    h.win.tickOpen();
    expect(fresh.getAttribute('aria-pressed')).toBe('true');
    // ...and the detached node is not being written any more.
    expect(stale.getAttribute('aria-pressed')).toBe('false');
  });

  it('re-latches the bar state at the rebuild, so the next frame repaints nothing', () => {
    const h = harness();
    open(h);
    h.state.bar[0] = slot('charge');
    h.state.hasFree = false;
    h.state.known = KNOWN_IDS.map((id) => resolved(id, id === 'charge' ? { rank: 2 } : {}));
    h.win.tickOpen(); // rebuild, which renders the NEW bar state directly
    expect((h.toggle('charge') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    const watch = watchDom();
    h.win.tickOpen();
    watch.stop();
    expect(watch.writes, `the frame after a rebuild rewrote: ${watch.writes.join(', ')}`).toEqual(
      [],
    );
    expect(watch.reads, `the frame after a rebuild re-checked: ${watch.reads.join(', ')}`).toEqual(
      [],
    );
  });

  it('drops the refs a rebuild orphans instead of growing them', () => {
    // render() clears the collected refs before the innerHTML write that destroys the nodes,
    // so a rebuild that emits FEWER eligible rows cannot leave a detached toggle behind
    // getting painted for the rest of the session.
    const h = harness();
    open(h);
    const dropped = h.toggle('hamstring') as HTMLButtonElement;
    h.state.known = h.state.known.filter((k) => k.def.id !== 'hamstring');
    h.win.tickOpen(); // rebuild: hamstring is now an unlearned row, with no toggle
    expect(h.toggle('hamstring')).toBeNull();

    const watch = watchDom();
    h.state.hasFree = false;
    h.win.tickOpen();
    watch.stop();
    // The live rows were repainted, the orphan was not.
    expect(watch.writes.length).toBeGreaterThan(0);
    expect(dropped.disabled).toBe(false);
  });
});

describe('spellbook per-frame tick: the forced refresh Hud drives', () => {
  it('repaints immediately after an out-of-band bar change, then settles', () => {
    // Hud calls refreshHotbarControls() directly after a bar change it made itself (the
    // login-time layout restore, reset-form-bar), where waiting a frame is not an option.
    const h = harness();
    open(h);
    const toggle = h.toggle('charge') as HTMLButtonElement;
    h.state.bar[0] = slot('charge');
    h.win.refreshHotbarControls();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    const watch = watchDom();
    h.win.tickOpen();
    watch.stop();
    expect(watch.writes, 'the forced refresh must latch what it painted').toEqual([]);
    expect(watch.reads, 'the forced refresh must latch what it painted').toEqual([]);
  });

  it('routes a toggle click through the bar and reflects it without a frame', () => {
    const h = harness();
    open(h);
    const toggle = h.toggle('charge') as HTMLButtonElement;
    toggle.click();
    expect(h.state.bar.some((a) => a?.type === 'ability' && a.id === 'charge')).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    expect(h.state.bar.some((a) => a?.type === 'ability' && a.id === 'charge')).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('reads the bar LIVE on a click, so a same-frame keybind change cannot misroute it', () => {
    // The click branch used to read a derived id list; reading the latched copy instead would
    // send a press down the wrong branch when the bar moved after the last tick, and
    // addToBar-on-an-already-present-ability reports no change, so the press would do nothing.
    const h = harness();
    open(h);
    const toggle = h.toggle('charge') as HTMLButtonElement;
    // The bar changed since the last tick (a keybind drop), with no tick in between.
    h.state.bar[2] = slot('charge');
    toggle.click();
    expect(h.state.bar.some((a) => a?.type === 'ability' && a.id === 'charge')).toBe(false);
  });
});

describe('spellbook per-frame tick: the rebuild gate still watches every summary field', () => {
  // ONE case per field a row summary paints, because they are checked independently and a
  // comparison that stopped looking at any one of them moves nothing else in this file. Each
  // asserts node IDENTITY: a rebuild replaces the rows, and `toEqual` on the markup would
  // pass on a wipe-and-identical-rebuild, which is the opposite of the question.
  const FIELDS = ['rank', 'cost', 'castTime', 'cooldown'] as const;

  for (const field of FIELDS) {
    it(`rebuilds the rows when a talent moves \`${field}\` alone`, () => {
      const h = harness();
      open(h);
      const before = h.toggle('charge') as HTMLButtonElement;
      h.state.known = KNOWN_IDS.map((id) => resolved(id, id === 'charge' ? { [field]: 99 } : {}));
      h.win.tickOpen();
      expect(h.toggle('charge'), `a ${field} change did not rebuild the rows`).not.toBe(before);
    });
  }

  it('rebuilds when an ability is learned or unlearned', () => {
    const h = harness();
    open(h);
    const before = h.toggle('charge') as HTMLButtonElement;
    h.state.known = [...h.state.known, resolved('execute')];
    h.win.tickOpen();
    expect(h.toggle('charge')).not.toBe(before);
    expect(h.toggle('execute')).not.toBeNull();
  });

  it('rebuilds when the LAST known ability goes away', () => {
    // The one case only the length check catches, and the reason it is not redundant with
    // the id compare beside it. Drop from the TAIL and every surviving index still matches
    // positionally, so without the length guard the comparison reports no change and the
    // window keeps rendering an ability the player no longer has, with a live +/- toggle,
    // for the rest of the session. Dropping from the MIDDLE shifts the ids and is caught
    // either way, which is why that case cannot stand in for this one.
    const h = harness();
    open(h);
    const last = KNOWN_IDS[KNOWN_IDS.length - 1];
    expect(h.toggle(last), 'the fixture must start with the tail ability on screen').not.toBeNull();
    h.state.known = h.state.known.slice(0, -1);
    h.win.tickOpen();
    expect(h.toggle(last), 'an unlearned tail ability kept its action-bar toggle').toBeNull();
  });

  it('rebuilds when the SAME numbers arrive on a different ability id', () => {
    // The online mirror rebuilds world.known every snapshot, so identity says nothing; the id
    // has to be part of the comparison or a spec swap would paint the wrong rows.
    const h = harness();
    open(h);
    const before = h.toggle('charge') as HTMLButtonElement;
    h.state.known = h.state.known.map((k) =>
      k.def.id === 'charge' ? resolved('thunder_clap') : k,
    );
    h.win.tickOpen();
    expect(h.toggle('charge')).toBeNull();
    expect(h.toggle('thunder_clap')).not.toBeNull();
    expect(before.isConnected, 'the old row should be detached').toBe(false);
  });

  it('CONTROL: a fresh world.known array with identical numbers rebuilds nothing', () => {
    // The case reference equality would get wrong every frame online.
    const h = harness();
    open(h);
    const before = h.toggle('charge') as HTMLButtonElement;
    h.state.known = KNOWN_IDS.map((id) => resolved(id));
    const watch = watchDom();
    h.win.tickOpen();
    watch.stop();
    expect(h.toggle('charge')).toBe(before);
    expect(watch.writes, `a no-op snapshot repainted: ${watch.writes.join(', ')}`).toEqual([]);
  });
});

// #2529: everything the gate above compares is an id or a number, so a runtime
// language change moves none of it and an open spellbook kept the previous
// locale until the player happened to learn or re-rank something.
describe('spellbook: a language switch repaints through relocalize(), not through the gate', () => {
  const OTHER = 'es';

  beforeAll(async () => {
    await ensureLocaleLoaded(OTHER);
  });

  afterEach(() => {
    setLanguage('en');
  });

  it('holds the old locale through tickOpen and repaints on relocalize()', () => {
    setLanguage('en');
    const english = t('abilityUi.spellbook.title');
    setLanguage(OTHER);
    const other = t('abilityUi.spellbook.title');
    expect(other, 'the spellbook title reads the same in both locales').not.toBe(english);
    setLanguage('en');

    const h = harness();
    open(h);
    const title = (): string =>
      h.root.querySelector('.panel-title span')?.textContent?.trim() ?? '';
    expect(title().startsWith(english)).toBe(true);

    setLanguage(OTHER);
    h.win.tickOpen();
    expect(
      title().startsWith(english),
      'tickOpen repainted: this arm no longer proves the gap',
    ).toBe(true);

    h.win.relocalize();
    expect(title().startsWith(other)).toBe(true);

    // The rebuild re-latches every compared field, so the per-frame band goes
    // straight back to eliding rather than repainting on every subsequent frame.
    const settled = h.toggle('charge');
    const watch = watchDom();
    h.win.tickOpen();
    watch.stop();
    expect(h.toggle('charge')).toBe(settled);
    expect(watch.writes, `relocalize() left the gate cleared: ${watch.writes.join(', ')}`).toEqual(
      [],
    );
  });

  it('refuses while the window is closed, so the fan-out can call it unconditionally', () => {
    const h = harness();
    setLanguage(OTHER);
    h.win.relocalize();
    expect(h.root.innerHTML, 'relocalize painted a closed spellbook').toBe('');
  });
});
