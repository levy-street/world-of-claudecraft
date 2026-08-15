// keyed-pool party painter: the routing + no-magic-values source guards
// the live-slot handler contract (top-risk 3), and an
// end-to-end pool proof (no duplicate listeners across rebuilds, a recycled row
// reads the new member, every write routed through the elided writers). The pool is
// driven over a tiny fake DOM in the default `node` env (no jsdom); iconDataUrl is
// stubbed because the crest's procedural canvas path needs a real DOM.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PainterHostWriters } from '../src/ui/painter_host';
import {
  createPartyRow,
  type PartyRowAuraDeps,
  type PartyRowSlot,
  partyRowHandlers,
  petRowHandlers,
} from '../src/ui/party_frame_row';
import { DEFAULT_PARTY_FRAME_DISPLAY, type PartyFrameMember } from '../src/ui/party_frames';
import { PartyFramesPainter } from '../src/ui/party_frames_painter';

// The crest icon's procedural path needs a canvas; the pool only needs a string. A
// hoisted spy returning a key-derived stub so a test can assert the portrait gate
// repaints the crest with the recycled member's class (the live-slot crest gate).
const iconDataUrlSpy = vi.hoisted(() => vi.fn((_kind: string, key: string) => `data:${key}`));
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: iconDataUrlSpy,
}));

// ---------------------------------------------------------------------------
// Source guards
// ---------------------------------------------------------------------------

describe('PartyFramesPainter: no raw DOM writes, no magic values', () => {
  const src = readFileSync(new URL('../src/ui/party_frames_painter.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('makes no raw style / textContent / className / classList / setAttribute / setProperty / innerHTML write', () => {
    expect(code).not.toMatch(/\.style\b/);
    expect(code).not.toMatch(/\.textContent\b/);
    expect(code).not.toMatch(/\.className\b/);
    expect(code).not.toMatch(/\.classList\b/);
    expect(code).not.toMatch(/\.setAttribute\b/);
    expect(code).not.toMatch(/\.setProperty\b/);
    expect(code).not.toMatch(/\.innerHTML\b/);
    // No per-rebuild listener churn in the hot painter (listeners live in the builder).
    expect(code).not.toMatch(/addEventListener/);
  });

  it('carries no literal hex / rgb / px value (the class color is the --cls token)', () => {
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(code.match(/\brgba?\s*\(/g) ?? []).toEqual([]);
    expect(code.match(/\b\d+px\b/g) ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Live-slot handlers (top-risk 3): the closure reads the slot, not a captured member
// ---------------------------------------------------------------------------

describe('partyRowHandlers: the closures read the LIVE slot, never a captured member', () => {
  const mk = (pid: number, name: string): PartyFrameMember => ({
    pid,
    name,
    cls: 'mage',
    level: 10,
    hp: 1,
    mhp: 1,
    absorb: 0,
    res: 0,
    mres: 0,
    rtype: 'mana',
    x: 0,
    z: 0,
    dead: 0,
    inCombat: 0,
    group: 1,
    oor: false,
  });

  it('a row recycled to a new member targets the NEW pid + name (not the stale one)', () => {
    const targets: number[] = [];
    const menus: Array<[number, string]> = [];
    const slot: PartyRowSlot = { member: mk(5, 'Alice') };
    const handlers = partyRowHandlers(slot, {
      onTarget: (pid) => targets.push(pid),
      onContextMenu: (pid, name) => menus.push([pid, name]),
      onHover: () => {},
      onTargetPet: () => {},
    });

    handlers.click();
    expect(targets).toEqual([5]);

    // Recycle the slot to a different identity reusing pid 5 (entity-id reuse).
    slot.member = mk(5, 'Bob');
    handlers.click();
    expect(targets).toEqual([5, 5]);
    handlers.contextmenu({ clientX: 4, clientY: 9, preventDefault() {} } as unknown as MouseEvent);
    // The context menu reads the LIVE name (Bob), proving no capture-by-value.
    expect(menus).toEqual([[5, 'Bob']]);
  });

  it('Enter and Space activate; the keyboard contextmenu falls back to the row box', () => {
    const targets: number[] = [];
    const menus: Array<[number, number, number]> = [];
    const slot: PartyRowSlot = { member: mk(7, 'Cora') };
    const handlers = partyRowHandlers(slot, {
      onTarget: (pid) => targets.push(pid),
      onContextMenu: (pid, _name, x, y) => menus.push([pid, x, y]),
      onHover: () => {},
      onTargetPet: () => {},
    });
    for (const key of ['Enter', ' ']) {
      handlers.keydown({ key, preventDefault() {} } as unknown as KeyboardEvent);
    }
    expect(targets).toEqual([7, 7]);
    // A keyboard contextmenu (0,0) falls back to the focused row's box (here 12,34).
    handlers.contextmenu({
      clientX: 0,
      clientY: 0,
      preventDefault() {},
      currentTarget: { getBoundingClientRect: () => ({ left: 12, bottom: 34 }) },
    } as unknown as MouseEvent);
    expect(menus).toEqual([[7, 12, 34]]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end pool: a tiny fake DOM + a recording facet drive the real painter.
// ---------------------------------------------------------------------------

interface FakeEl {
  tagName: string;
  parentNode: FakeEl | null;
  childNodes: FakeEl[];
  firstChild: FakeEl | null;
  nextSibling: FakeEl | null;
  // Count of child (re)insertions on THIS node, so a test can prove a steady-state
  // rebuild moves nothing (the keyed-pool no-churn guarantee).
  _mutations: number;
  listeners: Record<string, Array<(ev: unknown) => void>>;
  [k: string]: unknown;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  insertAdjacentHTML(pos: string, html: string): void;
  append(...kids: FakeEl[]): void;
  appendChild(kid: FakeEl): FakeEl;
  insertBefore(node: FakeEl, ref: FakeEl | null): FakeEl;
  _detach(kid: FakeEl): void;
  remove(): void;
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number };
  fire(type: string, ev: unknown): void;
}

function fakeEl(tag: string): FakeEl {
  const classNames = (el: Record<string, unknown>): string[] =>
    String(el.className ?? '')
      .split(/\s+/)
      .filter(Boolean);
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    parentNode: null as FakeEl | null,
    childNodes: [] as FakeEl[],
    _mutations: 0,
    listeners: {} as Record<string, Array<(ev: unknown) => void>>,
    // Crest images are ordinary HTMLImageElements in production. Model the small
    // class/style/loading surface used by setCrestImageWithFallback so this Node fake
    // exercises the real seam instead of bypassing it.
    classList: {
      add(...tokens: string[]) {
        const names = new Set(classNames(el as unknown as Record<string, unknown>));
        for (const token of tokens) names.add(token);
        el.className = [...names].join(' ');
      },
      remove(...tokens: string[]) {
        const removed = new Set(tokens);
        el.className = classNames(el as unknown as Record<string, unknown>)
          .filter((name) => !removed.has(name))
          .join(' ');
      },
      contains(token: string) {
        return classNames(el as unknown as Record<string, unknown>).includes(token);
      },
    },
    style: {
      backgroundImage: '',
      removeProperty(property: string) {
        if (property === 'background-image') this.backgroundImage = '';
      },
    },
    src: '',
    complete: false,
    naturalWidth: 0,
    setAttribute(k: string, v: string) {
      (el as Record<string, unknown>)[k] = v;
    },
    getAttribute(k: string) {
      return ((el as Record<string, unknown>)[k] as string) ?? null;
    },
    removeAttribute(k: string) {
      delete (el as Record<string, unknown>)[k];
    },
    addEventListener(type: string, fn: (ev: unknown) => void) {
      el.listeners[type] ??= [];
      el.listeners[type].push(fn);
    },
    // The chip builder prepends its chevron SVG via insertAdjacentHTML; the pool tests
    // never inspect the chevron markup, so a no-op keeps the fake DOM minimal.
    insertAdjacentHTML(_pos: string, _html: string) {},
    append(...kids: FakeEl[]) {
      for (const k of kids) el.appendChild(k);
    },
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
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
    fire(type: string, ev: unknown) {
      for (const fn of el.listeners[type] ?? []) fn(ev);
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

// Deterministic aura deps for the rows' mini strips: icon key = the aura id,
// name echoed, no i18n/icon runtime (the real host injects the Hud's deps).
const auraDeps: PartyRowAuraDeps = {
  view: {
    iconId: (a) => a.id,
    auraName: (a) => a.name,
    formatStacks: (n) => String(n),
    isOwn: () => false,
    durationUnits: () => ({ s: 's', m: 'm', h: 'h', d: 'd' }),
    auraEffectHtml: () => '',
  },
  painter: {
    resolveIconUrl: (k) => `url(${k})`,
    renderTooltip: (name) => name,
    attachTooltip: () => {},
  },
};

const member = (over: Partial<PartyFrameMember> & { pid: number }): PartyFrameMember => ({
  name: `P${over.pid}`,
  cls: 'priest',
  level: 20,
  hp: 50,
  mhp: 100,
  absorb: 0,
  res: 30,
  mres: 100,
  rtype: 'mana',
  x: 0,
  z: 0,
  dead: 0,
  inCombat: 0,
  group: 1,
  oor: false,
  ...over,
});

describe('createPartyRow: decorative badges + relocalize hook (a11y + live language switch)', () => {
  const build = () =>
    createPartyRow(
      fakeDoc,
      recordingFacet().writers,
      { onTarget() {}, onContextMenu() {}, onHover() {}, onTargetPet() {} },
      member({ pid: 1 }),
      auraDeps,
    );

  it('builds a keyboard-focusable button row (role=button + tabindex 0) so the global focus ring + keydown apply', () => {
    const row = build();
    // The old party div was unfocusable; createPartyRow makes each row a real SR button and a
    // tab stop. Dropping either silently kills keyboard focus AND the global
    // [tabindex="0"]:focus-visible ring with every other test still green.
    expect(row.el.getAttribute('role')).toBe('button');
    expect(row.el.tabIndex).toBe(0);
  });

  it('marks the dead/combat/oor badges aria-hidden so their glyphs do not pollute the row button name', () => {
    const row = build();
    expect(row.badges.dead.getAttribute('aria-hidden')).toBe('true');
    expect(row.badges.combat.getAttribute('aria-hidden')).toBe('true');
    expect(row.badges.oor.getAttribute('aria-hidden')).toBe('true');
  });

  it('builds the leader star as an aria-hidden span and the raid group as a visually-hidden span', () => {
    const row = build();
    // The star is decorative (aria-hidden) so it stays OUT of the row button name; the
    // group span is visually-hidden (in the a11y tree, clipped from sight) so the raid
    // group reaches a screen reader. Both attrs/classes are set ONCE here at build.
    expect(row.leadStar.getAttribute('aria-hidden')).toBe('true');
    expect(String(row.group.className)).toContain('visually-hidden');
  });

  it('relocalize() re-sets every badge tooltip (the pool reuses row DOM, so a switch needs it)', () => {
    const row = build();
    // Localized once at build.
    expect(row.badges.dead.title).toBeTruthy();
    expect(row.badges.oor.title).toBeTruthy();
    // Stale the titles, then prove relocalize re-applies them (the language-switch path).
    row.badges.dead.title = '';
    row.badges.oor.title = '';
    row.relocalize();
    expect(row.badges.dead.title).toBeTruthy();
    expect(row.badges.oor.title).toBeTruthy();
  });
});

describe('PartyFramesPainter: keyed pool over the elided writers', () => {
  let container: FakeEl;
  let calls: Call[];
  let painter: PartyFramesPainter;
  let targeted: number[];
  let toggles: number;

  beforeEach(() => {
    container = fakeEl('div');
    const facet = recordingFacet();
    calls = facet.calls;
    targeted = [];
    toggles = 0;
    painter = new PartyFramesPainter(
      facet.writers,
      container as unknown as HTMLElement,
      {
        classCss: () => 'var(--cls)',
        onTarget: (pid) => targeted.push(pid),
        onContextMenu: () => {},
        onHover: () => {},
        onTargetPet: () => {},
        petLabel: (name: string, frac: number) => `${name} ${Math.round(frac * 100)}%`,
        chipLabel: () => 'Party',
        onToggleCollapse: () => {
          toggles++;
        },
        partyAuras: auraDeps,
      },
      fakeDoc,
    );
  });

  // The member rows nest one level down in the .party-rows wrapper now (the container's
  // only DIV child is the wrapper itself). Resolve the wrapper, then its member-row DIVs.
  const wrapperOf = () =>
    container.childNodes.find((c) => String(c.className).includes('party-rows'));
  const rows = () => {
    const w = wrapperOf();
    return w ? w.childNodes.filter((c) => c.tagName === 'DIV') : [];
  };

  it('attaches click/contextmenu/keydown ONCE per pooled row across rebuilds (no dup listeners)', () => {
    painter.sync([member({ pid: 2, name: 'Alice' })], 1, false);
    const rowA = rows()[0];
    expect(rowA.listeners.click).toHaveLength(1);
    expect(rowA.listeners.contextmenu).toHaveLength(1);
    expect(rowA.listeners.keydown).toHaveLength(1);

    // Re-sync the SAME member (a stat changed): the row is reused, not rebuilt.
    painter.sync([member({ pid: 2, name: 'Alice', hp: 10, absorb: 15 })], 1, false);
    expect(rows()[0]).toBe(rowA);
    expect(rowA.listeners.click).toHaveLength(1);

    rowA.fire('click', {});
    expect(targeted).toEqual([2]);
  });

  it('recycles a departed row to a new pid and the recycled listener reads the NEW member', () => {
    painter.sync([member({ pid: 2, name: 'Alice' })], 1, false);
    const rowA = rows()[0];
    // Alice leaves: the row detaches to the free list (listeners intact).
    painter.sync([], 1, false);
    expect(rows()).toHaveLength(0);
    // A new member (pid 9) reuses the freed row node.
    painter.sync([member({ pid: 9, name: 'Bob' })], 1, false);
    const rowB = rows()[0];
    expect(rowB).toBe(rowA); // same node recycled
    expect(rowB.listeners.click).toHaveLength(1); // NOT re-attached
    rowB.fire('click', {});
    expect(targeted).toEqual([9]); // the live slot, not the stale Alice (pid 2)
  });

  it('paints each member aura strip (one icon per wire aura) and re-syncs it on a set change', () => {
    painter.sync(
      [
        member({
          pid: 2,
          auras: [
            { id: 'weapon_imbue', kind: 'imbue' },
            { id: 'well_fed', kind: 'buff_sta' },
            { id: 'arcane_intellect', kind: 'buff_int_pct' },
            { id: 'temporal_exhaustion', kind: 'sated' },
            { id: 'power_word_shield', kind: 'absorb' },
            { id: 'deep_wounds', kind: 'dot' },
          ],
        }),
      ],
      1,
      false,
    );
    const row = rows()[0];
    const strip = row.childNodes.find((c: FakeEl) =>
      String(c.className).includes('pfm-auras'),
    ) as FakeEl;
    expect(strip).toBeTruthy();
    const icons = () =>
      strip.childNodes.filter((c: FakeEl) => String(c.className).includes('buff'));
    // Passive maintenance buffs such as warrior stances do not compete with
    // actionable healer effects in the compact frame.
    expect(icons()).toHaveLength(2);
    // the shield wears off: the strip's keyed pool detaches its node
    painter.sync([member({ pid: 2, auras: [{ id: 'deep_wounds', kind: 'dot' }] })], 1, false);
    expect(icons()).toHaveLength(1);
    // a member with no auras (or an older server omitting the field) paints an empty strip
    painter.sync([member({ pid: 2 })], 1, false);
    expect(icons()).toHaveLength(0);
  });

  it('orders rows without a fixed leave button beneath the frames', () => {
    painter.sync([member({ pid: 2 }), member({ pid: 3 }), member({ pid: 4 })], 1, false);
    const kids = container.childNodes;
    expect(rows()).toHaveLength(3); // three member rows inside the wrapper
    expect(kids.some((child) => child.id === 'party-leave')).toBe(false);
  });

  it('toggles the raid-frame presentation for automatic raids and forced party use', () => {
    painter.sync([member({ pid: 2 })], 1, true, DEFAULT_PARTY_FRAME_DISPLAY);
    expect(
      calls.some(
        (call) =>
          call.m === 'toggleClass' && call.args[0] === 'party-style-raid' && call.args[1] === true,
      ),
    ).toBe(true);

    calls.length = 0;
    painter.sync([member({ pid: 2 })], 1, false, {
      ...DEFAULT_PARTY_FRAME_DISPLAY,
      presentation: 2,
    });
    expect(
      calls.some(
        (call) =>
          call.m === 'toggleClass' && call.args[0] === 'party-style-raid' && call.args[1] === true,
      ),
    ).toBe(true);

    calls.length = 0;
    painter.sync([member({ pid: 2 })], 1, true, {
      ...DEFAULT_PARTY_FRAME_DISPLAY,
      presentation: 1,
    });
    expect(
      calls.some(
        (call) =>
          call.m === 'toggleClass' && call.args[0] === 'party-style-raid' && call.args[1] === false,
      ),
    ).toBe(true);
  });

  it('honors the resource, absorb, and aura visibility toggles', () => {
    painter.sync(
      [
        member({
          pid: 2,
          hp: 50,
          mhp: 100,
          absorb: 25,
          auras: [{ id: 'power_word_shield', kind: 'absorb' }],
        }),
      ],
      1,
      false,
      {
        ...DEFAULT_PARTY_FRAME_DISPLAY,
        showResource: false,
        showAbsorbs: false,
        showAuras: false,
      },
    );
    expect(
      calls.some(
        (call) =>
          call.m === 'toggleClass' && call.args[0] === 'pf-hide-resource' && call.args[1] === true,
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.m === 'toggleClass' && call.args[0] === 'pf-hide-auras' && call.args[1] === true,
      ),
    ).toBe(true);
    expect(
      calls.some((call) => call.m === 'setTransform' && call.args[0] === 'scaleX(0.000)'),
    ).toBe(true);
  });

  it('reconciles DOM order on reorder + partial-membership churn, reusing the SAME nodes', () => {
    painter.sync([member({ pid: 2 }), member({ pid: 3 }), member({ pid: 4 })], 1, false);
    const [r2, r3, r4] = rows();
    // Reorder to 4,2,3 (e.g. a raid group-swap flips the sort): same nodes moved into
    // the new order via the minimal-move reconcile, not rebuilt.
    painter.sync([member({ pid: 4 }), member({ pid: 2 }), member({ pid: 3 })], 1, false);
    const reordered = rows();
    expect(reordered).toHaveLength(3);
    expect(reordered[0]).toBe(r4);
    expect(reordered[1]).toBe(r2);
    expect(reordered[2]).toBe(r3);
    expect(container.childNodes).toHaveLength(1);
    // The middle member (pid 2) leaves: the remaining two keep their order.
    painter.sync([member({ pid: 4 }), member({ pid: 3 })], 1, false);
    const trimmed = rows();
    expect(trimmed).toHaveLength(2);
    expect(trimmed[0]).toBe(r4);
    expect(trimmed[1]).toBe(r3);
    expect(container.childNodes).toHaveLength(1);
  });

  it('a steady-state rebuild (same members + order) moves no node, so a focused row keeps its place', () => {
    painter.sync([member({ pid: 2 }), member({ pid: 3 })], 1, false);
    const movesBefore = container._mutations;
    // Re-sync the same party with only a stat change: the reconcile must touch the DOM
    // not at all (zero detach/reinsert). That no-churn is what preserves keyboard focus
    // and avoids the per-combat-tick relocation the old unconditional appendChild caused
    // (re-appending a focused node blurs it). A regression to appendChild-every-row
    // would bump the mutation count and fail here while leaving the final order intact.
    painter.sync([member({ pid: 2, hp: 10 }), member({ pid: 3, inCombat: 1 })], 1, false);
    expect(container._mutations).toBe(movesBefore); // zero DOM moves in the hot path
    expect(rows()).toHaveLength(2);
  });

  it('repaints the crest with the recycled member class via the live slot (the portrait gate)', () => {
    iconDataUrlSpy.mockClear();
    // A mage joins: the gate fires once for class_mage on the first paint.
    painter.sync([member({ pid: 2, name: 'Mage', cls: 'mage' })], 1, false);
    expect(iconDataUrlSpy.mock.calls.some((c) => c[1] === 'class_mage')).toBe(true);
    // Re-sync the SAME mage (a stat changed): the class key is unchanged, so the gate
    // skips the crest repaint.
    iconDataUrlSpy.mockClear();
    painter.sync([member({ pid: 2, name: 'Mage', cls: 'mage', hp: 10 })], 1, false);
    expect(iconDataUrlSpy.mock.calls.some((c) => c[1] === 'class_mage')).toBe(false);
    // The mage leaves; a PRIEST reuses the freed row node. The crest repaints for the
    // NEW class, proving the gate reads the live slot, not a member captured at build.
    painter.sync([], 1, false);
    iconDataUrlSpy.mockClear();
    painter.sync([member({ pid: 9, name: 'Priest', cls: 'priest' })], 1, false);
    expect(iconDataUrlSpy.mock.calls.some((c) => c[1] === 'class_priest')).toBe(true);
  });

  it('clear() empties the container (no-party transition)', () => {
    painter.sync([member({ pid: 2 })], 1, false);
    expect(container.childNodes.length).toBeGreaterThan(0);
    painter.clear();
    expect(container.childNodes).toHaveLength(0);
  });

  it('routes EVERY write through the elided writers (--cls token, combat / state classes, badges, leave label)', () => {
    painter.setBelowTarget(true);
    painter.sync(
      [
        member({
          pid: 2,
          name: 'Alice',
          dead: 0,
          inCombat: 1,
          hp: 50,
          mhp: 100,
          absorb: 25,
          oor: false,
        }),
        member({ pid: 3, name: 'Bob', dead: 1, oor: false }),
        member({ pid: 4, name: 'Cora', dead: 0, inCombat: 0, oor: true }),
      ],
      2, // leader = pid 2 (Alice)
      false, // not a raid (no group label)
    );
    const has = (m: Call['m'], pred: (c: Call) => boolean) =>
      calls.some((c) => c.m === m && pred(c));

    // --cls custom property via setStyleProp, not a raw style write.
    expect(has('setStyleProp', (c) => c.args[0] === '--cls')).toBe(true);
    // below-target on the container via toggleClass.
    expect(has('toggleClass', (c) => c.args[0] === 'below-target' && c.args[1] === true)).toBe(
      true,
    );
    // combat (party-only), dead + oor (family state classes) all via toggleClass.
    expect(has('toggleClass', (c) => c.args[0] === 'combat' && c.args[1] === true)).toBe(true);
    expect(has('toggleClass', (c) => c.args[0] === 'dead' && c.args[1] === true)).toBe(true);
    expect(has('toggleClass', (c) => c.args[0] === 'oor' && c.args[1] === true)).toBe(true);
    // A combat member is NOT also dead (dead wins), so its combat is on but dead off.
    // The hp bar keeps the inline .toFixed(3) precision via formatScaleX.
    expect(has('setTransform', (c) => /^scaleX\(\d\.\d{3}\)$/.test(String(c.args[0])))).toBe(true);
    // Party frames reuse the shared UnitFramePainter's classic absorb overlay (a
    // left-origin scaleX to (hp + absorb) / maxHp), matching the player and target
    // frames, so there is no positioned --absorb-start segment here.
    expect(has('setStyleProp', (c) => c.args[0] === '--absorb-start')).toBe(false);
    expect(has('setTransform', (c) => c.args[0] === 'scaleX(0.750)')).toBe(true);
    // The compact party row never appends the absorb total to the HP text (that is a
    // player/target-frame affordance), so "(25)" must not appear.
    expect(has('setText', (c) => String(c.args[0]).includes('(25)'))).toBe(false);
    // The leader star is its OWN aria-hidden write (★), and the level element
    // (.lead-num) holds the bare number (20), never the old concatenated '★20'. Both
    // route through the elided setText (no raw write on the hot path).
    expect(has('setText', (c) => c.args[0] === '★')).toBe(true);
    expect(has('setText', (c) => c.args[0] === '20')).toBe(true);
    expect(has('setText', (c) => c.args[0] === '★20')).toBe(false);
    expect(has('setText', (c) => c.args[0] === 'Alice')).toBe(true);
    // Outside raid, no group label is emitted (the group span stays empty).
    expect(has('setText', (c) => c.args[0] === 'Group 1')).toBe(false);
    // Badges toggle via setDisplay (the forced-colors-safe icon cue): dead/combat/oor
    // each show at least once across the three members.
    expect(has('setDisplay', (c) => c.args[0] === '')).toBe(true);
    expect(has('setDisplay', (c) => c.args[0] === 'none')).toBe(true);
  });

  it('emits a visually-hidden "Group n" raid label per member only in raid mode', () => {
    // Non-raid: the group span is written empty, so no group label leaks into the row name.
    painter.sync([member({ pid: 2, group: 1 })], 2, false);
    expect(calls.some((c) => c.m === 'setText' && c.args[0] === 'Group 1')).toBe(false);
    // Raid: each member's group reaches a screen reader as "Group n" (formatNumber), routed
    // through the elided setText (no raw write on the hot path).
    calls.length = 0;
    painter.sync([member({ pid: 2, group: 1 }), member({ pid: 3, group: 2 })], 2, true);
    const texts = calls.filter((c) => c.m === 'setText').map((c) => c.args[0]);
    expect(texts).toContain('Group 1');
    expect(texts).toContain('Group 2');
  });

  it('relocalize() re-emits the raid-group label from the last synced raid flag (language switch)', () => {
    // A raid sync stores the raid flag; relocalize re-emits the group label in the new
    // language, since a language switch does not flip partyFrameSignature (so the Hud
    // never re-syncs us, exactly like the badge tooltips).
    painter.sync([member({ pid: 2, group: 2 })], 2, true);
    calls.length = 0;
    painter.relocalize();
    expect(calls.some((c) => c.m === 'setText' && c.args[0] === 'Group 2')).toBe(true);
  });

  // ---- The mobile collapse chip (setCollapse). ----

  // The chip's id (from party_chip.ts) so a test can find it in the container.
  const chipId = 'party-chip';
  const findChip = () => container.childNodes.find((c) => c.id === chipId);

  it('builds no chip and toggles no class off mobile (desktop party frames unchanged)', () => {
    painter.setCollapse(true, false, true, false);
    expect(findChip()).toBeUndefined();
    // The container gains neither collapse class off mobile.
    expect(
      calls.some((c) => c.m === 'toggleClass' && c.args[0] === 'has-party-chip' && c.args[1]),
    ).toBe(false);
    expect(
      calls.some((c) => c.m === 'toggleClass' && c.args[0] === 'party-expanded' && c.args[1]),
    ).toBe(false);
  });

  it('builds no chip when not in a party, even on mobile', () => {
    painter.setCollapse(false, true, true, false);
    expect(findChip()).toBeUndefined();
    expect(
      calls.some((c) => c.m === 'toggleClass' && c.args[0] === 'has-party-chip' && c.args[1]),
    ).toBe(false);
  });

  it('shows the chip in a party on mobile, collapsed by default (aria-expanded false, no expanded class)', () => {
    painter.setCollapse(true, true, true, false);
    const el = findChip();
    expect(el).toBeTruthy();
    // The chip is the container's FIRST child (the collapse header above the stack).
    expect(container.childNodes[0]).toBe(el);
    // Labeled via the elided setText, aria-expanded false (collapsed), and the container
    // carries has-party-chip but NOT party-expanded.
    expect(calls.some((c) => c.m === 'setText' && c.args[0] === 'Party')).toBe(true);
    expect(
      calls.some(
        (c) => c.m === 'setAttr' && c.args[0] === 'aria-expanded' && c.args[1] === 'false',
      ),
    ).toBe(true);
    expect(
      calls.some((c) => c.m === 'toggleClass' && c.args[0] === 'has-party-chip' && c.args[1]),
    ).toBe(true);
    expect(
      calls.some((c) => c.m === 'toggleClass' && c.args[0] === 'party-expanded' && c.args[1]),
    ).toBe(false);
  });

  it('expands (aria-expanded true + party-expanded class) when the persisted flag is not collapsed', () => {
    painter.setCollapse(true, true, false, false);
    expect(
      calls.some((c) => c.m === 'setAttr' && c.args[0] === 'aria-expanded' && c.args[1] === 'true'),
    ).toBe(true);
    expect(
      calls.some((c) => c.m === 'toggleClass' && c.args[0] === 'party-expanded' && c.args[1]),
    ).toBe(true);
  });

  it('the chip click fires onToggleCollapse (the persisted USER toggle)', () => {
    painter.setCollapse(true, true, true, false);
    const el = findChip();
    el?.fire('click', {});
    expect(toggles).toBe(1);
  });

  it('keeps the chip first even after a member sync (chip, then rows wrapper)', () => {
    painter.setCollapse(true, true, false, false);
    painter.sync([member({ pid: 2 }), member({ pid: 3 })], 1, false);
    const kids = container.childNodes;
    expect(kids[0].id).toBe(chipId);
    expect(rows()).toHaveLength(2); // the two member rows live inside the wrapper
    expect(kids[kids.length - 1]).toBe(wrapperOf());
  });

  it('F1: an expanded party seats the chip alone on its line, no member frame beside it', () => {
    // The pre-restructure grid put the chip in column 1 and auto-flowed a member frame
    // into the cell beside it (column 2 row 1). With the rows nested in the .party-rows
    // wrapper, the chip is a lone container child: its ONLY direct-child siblings are the
    // wrapper, and every member frame sits INSIDE the wrapper.
    painter.setCollapse(true, true, false, false); // mobile, expanded
    painter.sync([member({ pid: 2 }), member({ pid: 3 }), member({ pid: 4 })], 1, false);
    const kids = container.childNodes;
    expect(kids[0].id).toBe(chipId); // chip first
    const wrap = wrapperOf() as FakeEl;
    expect(wrap).toBeTruthy();
    // No member frame is a DIRECT child of the container (none flows beside the chip).
    expect(container.childNodes.some((c) => String(c.className).includes('party-frame'))).toBe(
      false,
    );
    // All three member rows nest inside the wrapper; the chip is not among them.
    expect(rows()).toHaveLength(3);
    expect(wrap.childNodes.some((c) => c.id === chipId)).toBe(false);
    expect(kids[kids.length - 1]).toBe(wrap);
  });

  it('yields entirely while mobile chat is open: chip removed, no expanded class', () => {
    // Expanded first (the player's choice), then chat opens: the chip and the frames
    // must both hide so the chat overlay owns the top-left.
    painter.setCollapse(true, true, false, false);
    expect(findChip()).toBeTruthy();
    calls.length = 0;
    painter.setCollapse(true, true, false, true);
    expect(findChip()).toBeUndefined();
    // Neither collapse class is on while chat yields (frames hidden, chip gone).
    expect(
      calls.filter((c) => c.m === 'toggleClass' && c.args[0] === 'has-party-chip').at(-1)?.args[1],
    ).toBe(false);
    expect(
      calls.filter((c) => c.m === 'toggleClass' && c.args[0] === 'party-expanded').at(-1)?.args[1],
    ).toBe(false);
  });

  it('restores the player expanded state when chat closes (the persisted choice is untouched)', () => {
    // Player expanded, chat opens (yield), chat closes: the frames re-expand from the
    // SAME collapsed=false input, proving the yield never overwrote the persisted choice.
    painter.setCollapse(true, true, false, true); // chat open: yielded
    expect(findChip()).toBeUndefined();
    calls.length = 0;
    painter.setCollapse(true, true, false, false); // chat closed: restore
    expect(findChip()).toBeTruthy();
    expect(
      calls.filter((c) => c.m === 'toggleClass' && c.args[0] === 'party-expanded').at(-1)?.args[1],
    ).toBe(true);
  });

  it('drops the chip + collapse classes when the party disbands (clear)', () => {
    painter.setCollapse(true, true, true, false);
    expect(findChip()).toBeTruthy();
    painter.clear();
    expect(findChip()).toBeUndefined();
    // clear toggles both collapse classes OFF so a future desktop stack is unstyled.
    expect(
      calls.filter((c) => c.m === 'toggleClass' && c.args[0] === 'has-party-chip').at(-1)?.args[1],
    ).toBe(false);
    expect(
      calls.filter((c) => c.m === 'toggleClass' && c.args[0] === 'party-expanded').at(-1)?.args[1],
    ).toBe(false);
  });

  it('removes the chip when the HUD switches from mobile to desktop mid-party', () => {
    painter.setCollapse(true, true, true, false);
    expect(findChip()).toBeTruthy();
    // Same party, now desktop: the chip is dropped and the collapse classes clear.
    painter.setCollapse(true, false, true, false);
    expect(findChip()).toBeUndefined();
  });

  it('relocalize() re-emits the chip caption while it is shown (language switch)', () => {
    painter.setCollapse(true, true, true, false);
    calls.length = 0;
    painter.relocalize();
    expect(calls.some((c) => c.m === 'setText' && c.args[0] === 'Party')).toBe(true);
  });
});

// The pet sliver is a control INSIDE the row button. Clicking it must select the pet,
// not the member, which means stopping propagation: without that the click bubbles to
// the row handler and the member is selected right back over the pet.
describe('petRowHandlers: the pet sliver selects the pet, not the member', () => {
  const slotFor = (pet?: { id: number }) => ({
    member: { pid: 7, name: 'Ally', pet } as unknown as PartyFrameMember,
  });
  const deps = () => {
    const calls: { member: number[]; pet: number[]; stopped: number } = {
      member: [],
      pet: [],
      stopped: 0,
    };
    return {
      calls,
      deps: {
        onTarget: (pid: number) => calls.member.push(pid),
        onContextMenu: () => {},
        onHover: () => {},
        onTargetPet: (id: number) => calls.pet.push(id),
      },
    };
  };
  const ev = (calls: { stopped: number }) =>
    ({ stopPropagation: () => calls.stopped++, preventDefault: () => {} }) as unknown as Event;

  it('targets the pet entity id, never the member pid', () => {
    const { calls, deps: d } = deps();
    petRowHandlers(slotFor({ id: 90 }), d).click(ev(calls));
    expect(calls.pet).toEqual([90]);
    expect(calls.member).toEqual([]);
  });

  it('stops propagation so the row handler does not re-select the member', () => {
    const { calls, deps: d } = deps();
    petRowHandlers(slotFor({ id: 90 }), d).click(ev(calls));
    expect(calls.stopped).toBe(1);
  });

  it('is a no-op when the member has no visible pet', () => {
    const { calls, deps: d } = deps();
    petRowHandlers(slotFor(undefined), d).click(ev(calls));
    expect(calls.pet).toEqual([]);
    expect(calls.member).toEqual([]);
  });

  it('reads the LIVE slot, so a recycled row targets its current member pet', () => {
    const { calls, deps: d } = deps();
    const slot = slotFor({ id: 90 });
    const handlers = petRowHandlers(slot, d);
    handlers.click(ev(calls));
    slot.member = { pid: 8, name: 'Other', pet: { id: 91 } } as unknown as PartyFrameMember;
    handlers.click(ev(calls));
    expect(calls.pet).toEqual([90, 91]);
  });

  // No keyboard arm by design: the sliver carries no role/tabindex, because a nested
  // interactive control inside the row button is the axe nested-interactive violation
  // and ARIA makes a button's children presentational anyway. Pin the absence so a
  // future edit cannot quietly re-add the nesting through the handler side.
  it('exposes a click affordance only, with no keyboard arm', () => {
    const { deps: d } = deps();
    const handlers = petRowHandlers(slotFor({ id: 90 }), d);
    expect(typeof handlers.click).toBe('function');
    expect('keydown' in handlers).toBe(false);
  });
});

// A language switch does NOT move partyFrameSignature (it digests data, not text), so
// the Hud never re-syncs the party frames for one. Every piece of t()-built text on a
// pooled row therefore needs an arm in relocalize(), and the pet sliver's accessible
// name is the only text the sliver has: without this a screen-reader user keeps
// hearing the pet's health in the previous language while the rest of the row
// switches. Pinned here because no data-driven test can catch it: the fixture must
// change the LANGUAGE and nothing else.
describe('PartyFramesPainter.relocalize: the pet sliver label follows a language switch', () => {
  // The facet RECORDS writes rather than mutating the fake DOM, so assert on the
  // recorded setText targeting the sliver's label node, not on textContent (which
  // stays empty here and would make every assertion vacuously pass).
  type Node = { className?: unknown; childNodes: Node[] };
  const findByClass = (root: Node, cls: string): Node | undefined => {
    for (const c of root.childNodes ?? []) {
      if (String(c.className ?? '').includes(cls)) return c;
      const deep = findByClass(c, cls);
      if (deep) return deep;
    }
    return undefined;
  };

  const setup = (withPet: boolean) => {
    const facet = recordingFacet();
    const container = fakeDoc.createElement('div');
    let lang = 'en';
    const painter = new PartyFramesPainter(
      facet.writers,
      container as unknown as HTMLElement,
      {
        classCss: () => 'var(--cls)',
        onTarget: () => {},
        onContextMenu: () => {},
        onHover: () => {},
        onTargetPet: () => {},
        // Stands in for t(): same pet data, different language.
        petLabel: (name: string, frac: number) => `${lang}:${name} ${Math.round(frac * 100)}%`,
        chipLabel: () => 'Party',
        onToggleCollapse: () => {},
        partyAuras: auraDeps,
      },
      fakeDoc,
    );
    const m = withPet
      ? member({ pid: 2, pet: { id: 90, name: 'Fang', hp: 20, maxHp: 40, dead: false } })
      : member({ pid: 2 });
    painter.sync([m], 1, false);
    const labelEl = findByClass(container as unknown as Node, 'pfm-pet-label');
    const labelWrites = () =>
      facet.calls.filter((c) => c.m === 'setText' && c.el === labelEl).map((c) => c.args[0]);
    return {
      painter,
      labelWrites,
      setLang: (l: string) => {
        lang = l;
      },
    };
  };

  it('paints the sliver label in the current language on the first sync', () => {
    const { labelWrites } = setup(true);
    expect(labelWrites()).toContain('en:Fang 50%');
  });

  it('re-emits the label on relocalize with NO party data change', () => {
    const { painter, labelWrites, setLang } = setup(true);
    const before = labelWrites().length;
    setLang('de');
    painter.relocalize();
    const after = labelWrites();
    expect(after.length).toBeGreaterThan(before);
    expect(after[after.length - 1]).toBe('de:Fang 50%');
  });

  it('blanks rather than resurrects a label for a member with no pet', () => {
    const { painter, labelWrites, setLang } = setup(false);
    setLang('de');
    painter.relocalize();
    // Every write to a petless row's label must be the empty string: a stale pet
    // name must never be announced by a row whose pet is gone.
    expect(labelWrites().every((v) => v === '')).toBe(true);
  });
});
