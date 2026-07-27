// @vitest-environment jsdom

// The Town Focus repaint gate (issue #2500).
//
// The panel is repainted from Hud.update()'s 500ms slow band, and the whole
// gate used to be `if (this.townFocusOpen)`. renderTownFocusWindow is a full
// skeleton wipe (innerHTML for the title bar, then createElement/appendChild
// for the hint block and every row), so an OPEN AND IDLE panel discarded and
// rebuilt its entire subtree twice a second, forever. It carried scrollTop
// across the wipe, which is itself the evidence the wipe was known to be
// destructive; focus was the case that got missed, and a keyboard user parked
// on a +/- stepper or Save had that element destroyed under them at 2Hz.
//
// Five layers are pinned here, mirroring tests/crafting_reagent_refresh.test.ts:
//  1. townFocusRenderSig (pure): it moves on every value the painter renders
//     and stays put on churn the painter cannot see.
//  2. That the sig's term set really is the painter's read set, scanned out of
//     the painter's own source, so a row that starts rendering another view
//     field cannot silently leave the gate behind.
//  3. The HUD probe's behavior, driven on a bare Hud prototype (the
//     crafting_reagent_refresh precedent, since the probe is private and
//     update() is not drivable in a unit test): cold latch, elision, the
//     in/out-of-town edge, and that a closed panel reads nothing at all.
//  4. The real painter in a real DOM: an unchanged poll rebuilds nothing and
//     keyboard focus survives it, and the rebuild that DOES happen (a step)
//     hands focus back to the rebuilt equivalent instead of dropping it to
//     <body>.
//  5. The wiring source pins for the three edges (the slow band, the paint
//     re-arm, the language switch), each anchored to the REGION it has to live
//     in rather than to the whole file.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HARVEST_COMPONENT_ITEMS } from '../src/sim/content/professions';
import { FOCUS_POINT_BUDGET } from '../src/sim/professions/focus';
import { Hud } from '../src/ui/hud';
import {
  buildTownFocusView,
  TOWN_FOCUS_COMPONENTS,
  type TownFocusView,
  townFocusRenderSig,
} from '../src/ui/town_focus_view';
import { renderTownFocusWindow } from '../src/ui/town_focus_window';

const COMPONENT = TOWN_FOCUS_COMPONENTS[0];
const OTHER_COMPONENT = TOWN_FOCUS_COMPONENTS[1];

/** A view built from real inputs, never hand-written, so the assertions below
 *  keep testing what the panel is actually handed. */
function viewOf(allocation: Record<string, number>, inTown = true): TownFocusView {
  return buildTownFocusView(allocation, FOCUS_POINT_BUDGET, inTown);
}

// ---------------------------------------------------------------------------
// 1. The pure signature.
// ---------------------------------------------------------------------------

describe('townFocusRenderSig', () => {
  it('rests on component ids that carry none of its delimiters', () => {
    // The sig packs component:points:flags rows with ':', '|' and '/'. An id
    // carrying one could make two different allocations share a string, which
    // is the one way a signature gate goes quietly wrong. No authored id does;
    // this is the guard that keeps it that way, iterated over the real content
    // table rather than over the fixtures below.
    const ids = Object.keys(HARVEST_COMPONENT_ITEMS);
    expect(ids.length).toBeGreaterThan(1);
    for (const id of ids) expect(id).not.toMatch(/[:|/]/);
    // Since #2511 the panel re-exports the sim's single definition rather than
    // deriving its own, so this line no longer proves two derivations agree,
    // only that the one definition is still the content table's key order. The
    // membership itself is pinned against literals in tests/focus.test.ts.
    expect([...TOWN_FOCUS_COMPONENTS]).toEqual(ids);
    // The painter's focus keys share ONE flat namespace with the two singleton
    // keys, so a component literally named `save` or `close` would route the
    // Save/X button's key into the stepper ladder. A different hazard from the
    // delimiter one above, and it needs saying separately.
    expect(ids).not.toContain('save');
    expect(ids).not.toContain('close');
  });

  it('is never the empty string, so the cold latch cannot collide with a real panel', () => {
    // Hud arms `lastTownFocusSig` from '' and every guard in the family leans
    // on that sentinel being unreachable.
    expect(townFocusRenderSig(viewOf({}))).not.toBe('');
    expect(townFocusRenderSig(viewOf({ [COMPONENT]: FOCUS_POINT_BUDGET }, false))).not.toBe('');
  });

  it('is stable across two independently built identical views', () => {
    expect(townFocusRenderSig(viewOf({ [COMPONENT]: 3 }))).toBe(
      townFocusRenderSig(viewOf({ [COMPONENT]: 3 })),
    );
  });

  it('moves when a point is spent (the panel really did change)', () => {
    expect(townFocusRenderSig(viewOf({ [COMPONENT]: 3 }))).not.toBe(
      townFocusRenderSig(viewOf({ [COMPONENT]: 4 })),
    );
  });

  it('moves when the same total is spent on a DIFFERENT component', () => {
    // remaining is identical in both, so a sig built from the budget alone
    // would tie: the per-row terms are what separate them.
    expect(townFocusRenderSig(viewOf({ [COMPONENT]: 2 }))).not.toBe(
      townFocusRenderSig(viewOf({ [OTHER_COMPONENT]: 2 })),
    );
  });

  it('moves when the player walks out of town (every control disables)', () => {
    expect(townFocusRenderSig(viewOf({ [COMPONENT]: 2 }, false))).not.toBe(
      townFocusRenderSig(viewOf({ [COMPONENT]: 2 }, true)),
    );
  });

  it('stays put on allocation churn the panel cannot see', () => {
    // Negative points clamp to 0 and an unknown key is not a row, so neither
    // renders: a sig that stringified the raw allocation would repaint for
    // both. Key ORDER is the same trap and is covered by the fixed component
    // walk, asserted here rather than assumed.
    const base = { [COMPONENT]: 2 };
    expect(townFocusRenderSig(viewOf({ ...base, [OTHER_COMPONENT]: -4 }))).toBe(
      townFocusRenderSig(viewOf(base)),
    );
    expect(townFocusRenderSig(viewOf({ ...base, not_a_component: 3 }))).toBe(
      townFocusRenderSig(viewOf(base)),
    );
    expect(townFocusRenderSig(viewOf({ [OTHER_COMPONENT]: 1, [COMPONENT]: 2 }))).toBe(
      townFocusRenderSig(viewOf({ [COMPONENT]: 2, [OTHER_COMPONENT]: 1 })),
    );
  });

  // Per-DIMENSION negative cases: mutate one rendered field of an otherwise
  // identical view and require the sig to move. A sig that dropped any single
  // term would pass every whole-view assertion above and fail exactly here.
  const MUTATIONS: ReadonlyArray<readonly [string, (v: TownFocusView) => TownFocusView]> = [
    ['inTown', (v) => ({ ...v, inTown: !v.inTown })],
    ['budget', (v) => ({ ...v, budget: v.budget + 1 })],
    ['remaining', (v) => ({ ...v, remaining: v.remaining - 1 })],
    [
      'rows[].component',
      (v) => ({ ...v, rows: [{ ...v.rows[0], component: 'renamed' }, ...v.rows.slice(1)] }),
    ],
    [
      'rows[].points',
      (v) => ({ ...v, rows: [{ ...v.rows[0], points: v.rows[0].points + 1 }, ...v.rows.slice(1)] }),
    ],
    [
      'rows[].canIncrease',
      (v) => ({
        ...v,
        rows: [{ ...v.rows[0], canIncrease: !v.rows[0].canIncrease }, ...v.rows.slice(1)],
      }),
    ],
    [
      'rows[].canDecrease',
      (v) => ({
        ...v,
        rows: [{ ...v.rows[0], canDecrease: !v.rows[0].canDecrease }, ...v.rows.slice(1)],
      }),
    ],
    ['rows (a row disappears)', (v) => ({ ...v, rows: v.rows.slice(1) })],
  ];

  for (const [field, mutate] of MUTATIONS) {
    it(`moves when ${field} changes and nothing else does`, () => {
      const base = viewOf({ [COMPONENT]: 2 });
      expect(townFocusRenderSig(mutate(base))).not.toBe(townFocusRenderSig(base));
    });
  }

  it('ignores totalSpent, the one view field nothing renders', () => {
    // Stated out loud rather than left as an omission: remaining already
    // carries it, and the completeness pin below is what keeps that true.
    const base = viewOf({ [COMPONENT]: 2 });
    expect(townFocusRenderSig({ ...base, totalSpent: base.totalSpent + 99 })).toBe(
      townFocusRenderSig(base),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Completeness: the sig's terms ARE the painter's read set.
//
// The gate is only as good as this correspondence, and nothing else checks it:
// a new `${view.totalSpent}` in the painter would render a number the sig does
// not carry, and the panel would sit stale until something else moved. Scan
// the painter's real source for what it reads off the view and off a row, and
// require both sets to match the sig exactly.
//
// WHERE THIS STOPS, stated rather than implied: both scans are NAME-based, so
// they see `view.<field>` and `row.<field>` and nothing else. Destructuring and
// renaming the loop variable both REMOVE matches, so they fail loudly and are
// safe; rebinding (`const v = view`) keeps the count intact and is refused
// separately below. What escapes both is a field read off an INDEXED expression
// (`view.rows[i].newField`), which names no receiver at all. The instrument for
// that is the per-dimension mutation table above, which is behavioral.
// ---------------------------------------------------------------------------

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const painterSrc = stripComments(
  readFileSync(path.resolve(process.cwd(), 'src/ui/town_focus_window.ts'), 'utf8'),
);
const sigSrc = stripComments(
  readFileSync(path.resolve(process.cwd(), 'src/ui/town_focus_view.ts'), 'utf8'),
);

function readsOf(src: string, receiver: string): string[] {
  const found = new Set<string>();
  for (const m of src.matchAll(new RegExp(`\\b${receiver}\\.([A-Za-z_][\\w]*)`, 'g')))
    found.add(m[1]);
  return [...found].sort();
}

/**
 * The ONE way the read scans above can be defeated: bind the view (or a row) to
 * another name and read the field off that. Destructuring and renaming both
 * REMOVE matches and so fail the scans loudly, but `const v = view;` leaves the
 * counted set untouched while a fifth field renders behind the gate.
 */
function aliasesOf(src: string, receiver: string): string[] {
  return [...src.matchAll(new RegExp(`=\\s*(${receiver})\\b(?!\\.)`, 'g'))].map((m) => m[0].trim());
}

describe('the signature covers exactly what the painter renders', () => {
  it('reads only the view fields the signature carries', () => {
    // `rows` is the container the row terms come from, so it belongs here too.
    expect(readsOf(painterSrc, 'view')).toEqual(['budget', 'inTown', 'remaining', 'rows']);
  });

  it('never aliases the view or a row past the scans above', () => {
    expect(aliasesOf(painterSrc, 'view')).toEqual([]);
    expect(aliasesOf(painterSrc, 'row')).toEqual([]);
  });

  it('and that alias refusal really would catch one', () => {
    // Driven over synthetic source with a planted alias, because a refusal
    // proven only against the tree it already passes on proves nothing: this is
    // the arm that would be dead if the pattern were wrong.
    expect(aliasesOf('const v = view;\nfoo(v.totalSpent);', 'view')).toEqual(['= view']);
    expect(aliasesOf('let r;\nr = row;', 'row')).toEqual(['= row']);
    // ...and does not fire on the legitimate shapes the painter really uses.
    expect(aliasesOf('function f(view: TownFocusView) { return view.budget; }', 'view')).toEqual(
      [],
    );
  });

  it('reads only the row fields the signature carries', () => {
    // File-wide, so `row` is reserved for the view row the painter walks: an
    // unrelated local named `row` fails here and the fix is to rename it (the
    // focus ladder's stepper pair is called `pair` for exactly this reason).
    expect(readsOf(painterSrc, 'row')).toEqual([
      'canDecrease',
      'canIncrease',
      'component',
      'points',
    ]);
  });

  it('the signature builder really names every one of them', () => {
    // Guards the other direction: the scan above proves the painter reads no
    // MORE than these, this proves the sig reads no LESS. Both are needed, and
    // a sig term deleted while the painter kept rendering the field would show
    // up only here and in the per-dimension mutations above.
    //
    // BOUNDED at the next export, not run to end of file: an unbounded slice
    // would let any later code in the module satisfy a term the signature
    // itself had dropped.
    const start = sigSrc.indexOf('export function townFocusRenderSig');
    expect(
      start,
      'townFocusRenderSig is no longer exported from town_focus_view.ts',
    ).toBeGreaterThan(-1);
    const end = sigSrc.indexOf('export function', start + 1);
    expect(end, 'no export follows townFocusRenderSig, so the slice is unbounded').toBeGreaterThan(
      start,
    );
    const sigBody = sigSrc.slice(start, end);
    for (const term of ['view.inTown', 'view.budget', 'view.remaining', 'view.rows'])
      expect(sigBody).toContain(term);
    for (const term of ['r.component', 'r.points', 'r.canIncrease', 'r.canDecrease'])
      expect(sigBody).toContain(term);
  });
});

// ---------------------------------------------------------------------------
// 3. The HUD probe, on a bare Hud prototype.
// ---------------------------------------------------------------------------

interface TownFocusProbeHarness {
  sim: { townFocus: Record<string, number> };
  townFocusDraft: Record<string, number> | null;
  lastTownFocusSig: string;
  isInTown(): boolean;
  renderTownFocus(): void;
  refreshOpenTownFocusIfChanged(): void;
  readonly townFocusOpen: boolean;
}

function makeProbeHud(draft: Record<string, number> | null = {}): {
  hud: TownFocusProbeHarness;
  window: HTMLElement;
  /** How many times the probe has read the allocation: the "a closed panel
   *  costs nothing" claim is about this, not about the repaint count. */
  allocationReads(): number;
  townChecks(): number;
  setInTown(next: boolean): void;
} {
  const hud = Object.create(Hud.prototype) as unknown as TownFocusProbeHarness;
  let reads = 0;
  let townChecks = 0;
  let inTown = true;
  hud.sim = {
    get townFocus() {
      reads++;
      return {};
    },
  } as TownFocusProbeHarness['sim'];
  hud.townFocusDraft = draft;
  // Object.create skips field initializers, so seed the latch the way the real
  // field declares it ('' until the first paint arms it).
  hud.lastTownFocusSig = '';
  hud.isInTown = () => {
    townChecks++;
    return inTown;
  };
  hud.renderTownFocus = vi.fn(() => {
    hud.lastTownFocusSig = townFocusRenderSig(
      buildTownFocusView(hud.townFocusDraft ?? {}, FOCUS_POINT_BUDGET, inTown),
    );
  }) as unknown as TownFocusProbeHarness['renderTownFocus'];
  document.getElementById('town-focus-window')?.remove();
  const el = document.createElement('div');
  el.id = 'town-focus-window';
  el.style.display = 'block';
  document.body.appendChild(el);
  return {
    hud,
    window: el,
    allocationReads: () => reads,
    townChecks: () => townChecks,
    setInTown: (next) => {
      inTown = next;
    },
  };
}

describe('refreshOpenTownFocusIfChanged', () => {
  it('latches on the first probe, then elides an unchanged panel', () => {
    const { hud } = makeProbeHud({ [COMPONENT]: 2 });
    hud.refreshOpenTownFocusIfChanged();
    expect(hud.renderTownFocus).toHaveBeenCalledTimes(1);
    hud.refreshOpenTownFocusIfChanged();
    hud.refreshOpenTownFocusIfChanged();
    hud.refreshOpenTownFocusIfChanged();
    // The whole issue: four slow ticks over an idle panel, one rebuild.
    expect(hud.renderTownFocus).toHaveBeenCalledTimes(1);
  });

  it('repaints when the draft moves under it', () => {
    const { hud } = makeProbeHud({ [COMPONENT]: 2 });
    hud.refreshOpenTownFocusIfChanged();
    hud.townFocusDraft = { [COMPONENT]: 3 };
    hud.refreshOpenTownFocusIfChanged();
    expect(hud.renderTownFocus).toHaveBeenCalledTimes(2);
  });

  it('repaints when the player walks out of town (the panel disables)', () => {
    const { hud, setInTown } = makeProbeHud({ [COMPONENT]: 2 });
    hud.refreshOpenTownFocusIfChanged();
    setInTown(false);
    hud.refreshOpenTownFocusIfChanged();
    expect(hud.renderTownFocus).toHaveBeenCalledTimes(2);
    // ...and then settles again rather than repainting every tick out of town.
    hud.refreshOpenTownFocusIfChanged();
    expect(hud.renderTownFocus).toHaveBeenCalledTimes(2);
  });

  it('falls back to the sim allocation when there is no draft', () => {
    const { hud, allocationReads } = makeProbeHud(null);
    hud.refreshOpenTownFocusIfChanged();
    expect(hud.renderTownFocus).toHaveBeenCalledTimes(1);
    expect(allocationReads()).toBeGreaterThan(0);
  });

  it('reads nothing at all while the panel is CLOSED', () => {
    const { hud, window, allocationReads, townChecks } = makeProbeHud(null);
    window.style.display = 'none';
    hud.refreshOpenTownFocusIfChanged();
    hud.townFocusDraft = { [COMPONENT]: 5 };
    hud.refreshOpenTownFocusIfChanged();
    expect(hud.renderTownFocus).not.toHaveBeenCalled();
    // The open check must come FIRST: a guard reorder that built the signature
    // before testing display would cost every closed player a zone check and an
    // allocation fold per slow tick, and a repaint-count assertion alone would
    // not notice.
    expect(allocationReads()).toBe(0);
    expect(townChecks()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. The real painter, the real gate, a real DOM.
// ---------------------------------------------------------------------------

interface TownFocusRenderHarness {
  sim: { townFocus: Record<string, number>; setTownFocus(next: Record<string, number>): void };
  townFocusDraft: Record<string, number> | null;
  lastTownFocusSig: string;
  isInTown(): boolean;
  renderTownFocus(): void;
  refreshOpenTownFocusIfChanged(): void;
  closeTownFocus(): void;
  hideTooltip(): void;
}

/** The real Hud methods on a bare prototype: no stubbed painter, so what these
 *  assert is the shipped render path end to end. */
function makeRenderHud(allocation: Record<string, number>): {
  hud: TownFocusRenderHarness;
  el: HTMLElement;
  setInTown(next: boolean): void;
} {
  const hud = Object.create(Hud.prototype) as unknown as TownFocusRenderHarness;
  let inTown = true;
  hud.sim = { townFocus: {}, setTownFocus: vi.fn() } as unknown as TownFocusRenderHarness['sim'];
  hud.townFocusDraft = { ...allocation };
  hud.lastTownFocusSig = '';
  hud.isInTown = () => inTown;
  hud.closeTownFocus = vi.fn() as unknown as TownFocusRenderHarness['closeTownFocus'];
  hud.hideTooltip = vi.fn() as unknown as TownFocusRenderHarness['hideTooltip'];
  document.getElementById('town-focus-window')?.remove();
  const el = document.createElement('div');
  el.id = 'town-focus-window';
  document.body.appendChild(el);
  return {
    hud,
    el,
    setInTown: (next) => {
      inTown = next;
    },
  };
}

const stepButton = (el: HTMLElement, component: string, role: 'dec' | 'inc'): HTMLButtonElement => {
  const btn = el.querySelector<HTMLButtonElement>(`[data-focus-key="${component}:${role}"]`);
  expect(btn, `no ${role} stepper for ${component}`).not.toBeNull();
  return btn as HTMLButtonElement;
};

/**
 * Assert the subtree was NOT rebuilt: same nodes, by IDENTITY.
 *
 * `toEqual` is the wrong instrument and passes here for the wrong reason: it
 * compares two node arrays STRUCTURALLY, so a full wipe followed by a
 * byte-identical rebuild satisfies it, which is exactly the bug. Every claim
 * about "did not repaint" in this file goes through per-node `toBe`.
 */
function expectSameNodes(after: readonly Element[], before: readonly Element[]): void {
  expect(after.length).toBe(before.length);
  expect(before.length).toBeGreaterThan(0);
  for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]);
}

describe('an open Town Focus panel on the slow band', () => {
  it('is a full wipe when it does repaint, which is why the gate matters', () => {
    // The premise, asserted rather than assumed: the painter really does throw
    // its subtree away. Without a gate this is what ran twice a second. It is
    // also what makes the identity comparisons below the only honest ones: a
    // rebuild here is structurally indistinguishable from no rebuild at all.
    const { hud, el } = makeRenderHud({ [COMPONENT]: 2 });
    hud.renderTownFocus();
    const first = [...el.children];
    hud.renderTownFocus();
    const second = [...el.children];
    expect(second.length).toBe(first.length);
    for (let i = 0; i < first.length; i++) expect(second[i]).not.toBe(first[i]);
    // ...and the structural comparison really cannot tell those two apart, so
    // the helper above is not a stylistic preference.
    expect(second).toEqual(first);
  });

  it('rebuilds NOTHING across repeated idle polls', () => {
    const { hud, el } = makeRenderHud({ [COMPONENT]: 2 });
    hud.renderTownFocus();
    const before = [...el.querySelectorAll('*')];
    hud.refreshOpenTownFocusIfChanged();
    hud.refreshOpenTownFocusIfChanged();
    hud.refreshOpenTownFocusIfChanged();
    expectSameNodes([...el.querySelectorAll('*')], before);
  });

  it('leaves a keyboard user parked on a stepper exactly where they were', () => {
    // The consequence the issue is really about: the element under the
    // keyboard user was destroyed and replaced on a timer.
    const { hud, el } = makeRenderHud({ [COMPONENT]: 2 });
    hud.renderTownFocus();
    const plus = stepButton(el, COMPONENT, 'inc');
    plus.focus();
    expect(document.activeElement).toBe(plus);
    hud.refreshOpenTownFocusIfChanged();
    hud.refreshOpenTownFocusIfChanged();
    expect(document.activeElement).toBe(plus);
    expect(plus.isConnected).toBe(true);
  });

  it('still converges the panel when the player leaves town', () => {
    const { hud, el, setInTown } = makeRenderHud({ [COMPONENT]: 2 });
    hud.renderTownFocus();
    expect(stepButton(el, COMPONENT, 'inc').disabled).toBe(false);
    setInTown(false);
    hud.refreshOpenTownFocusIfChanged();
    expect(stepButton(el, COMPONENT, 'inc').disabled).toBe(true);
    expect(el.querySelector('.town-focus-not-in-town')).not.toBeNull();
  });

  it('repaints once, not twice, for one real change', () => {
    const { hud, el } = makeRenderHud({ [COMPONENT]: 2 });
    hud.renderTownFocus();
    hud.townFocusDraft = { [COMPONENT]: 3 };
    hud.refreshOpenTownFocusIfChanged();
    const painted = [...el.querySelectorAll('*')];
    hud.refreshOpenTownFocusIfChanged();
    expectSameNodes([...el.querySelectorAll('*')], painted);
  });
});

// ---------------------------------------------------------------------------
// 4b. Focus across the rebuild that DOES happen.
// ---------------------------------------------------------------------------

describe('renderTownFocusWindow carries keyboard focus across its own wipe', () => {
  function paint(
    view: TownFocusView,
    onStep = vi.fn(),
  ): { el: HTMLElement; onStep: typeof onStep } {
    document.getElementById('town-focus-window')?.remove();
    const el = document.createElement('div');
    el.id = 'town-focus-window';
    document.body.appendChild(el);
    renderTownFocusWindow(el, view, { onStep, onSave: vi.fn(), onClose: vi.fn() });
    return { el, onStep };
  }

  it('hands focus to the rebuilt equivalent of the stepper that was pressed', () => {
    const { el } = paint(viewOf({ [COMPONENT]: 2 }));
    stepButton(el, COMPONENT, 'inc').focus();
    // The step handler repaints the panel, exactly as Hud.renderTownFocus does.
    renderTownFocusWindow(el, viewOf({ [COMPONENT]: 3 }), {
      onStep: vi.fn(),
      onSave: vi.fn(),
      onClose: vi.fn(),
    });
    expect(document.activeElement).toBe(stepButton(el, COMPONENT, 'inc'));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('falls back to the other stepper in the row when the pressed one comes back disabled', () => {
    // Stepping the last point off a component disables its `-`, and a disabled
    // button cannot take focus. Without the ladder this is where a keyboard
    // player lands on <body> and cannot continue.
    const { el } = paint(viewOf({ [COMPONENT]: 1 }));
    stepButton(el, COMPONENT, 'dec').focus();
    renderTownFocusWindow(el, viewOf({}), {
      onStep: vi.fn(),
      onSave: vi.fn(),
      onClose: vi.fn(),
    });
    expect(stepButton(el, COMPONENT, 'dec').disabled).toBe(true);
    expect(document.activeElement).toBe(stepButton(el, COMPONENT, 'inc'));
  });

  it('falls back past a disabled Save to Close when the whole panel disables', () => {
    const { el } = paint(viewOf({ [COMPONENT]: 1 }));
    stepButton(el, COMPONENT, 'dec').focus();
    // Walking out of town disables every stepper AND Save.
    renderTownFocusWindow(el, viewOf({ [COMPONENT]: 1 }, false), {
      onStep: vi.fn(),
      onSave: vi.fn(),
      onClose: vi.fn(),
    });
    expect(document.activeElement).toBe(el.querySelector('[data-close]'));
  });

  it('keeps the Save button when Save had focus', () => {
    const { el } = paint(viewOf({ [COMPONENT]: 1 }));
    const save = el.querySelector<HTMLButtonElement>('.town-focus-save');
    save?.focus();
    renderTownFocusWindow(el, viewOf({ [COMPONENT]: 2 }), {
      onStep: vi.fn(),
      onSave: vi.fn(),
      onClose: vi.fn(),
    });
    expect(document.activeElement).toBe(el.querySelector('.town-focus-save'));
  });

  it('keeps the X on Close rather than jumping the player onto Save', () => {
    // The Close-first arm. Painted IN TOWN so Save is enabled and is a live
    // competitor: without the arm the key falls through the stepper ladder
    // (`steppers.get('close')` is undefined) and lands on Save, which is a
    // destructive control to hand a player who was dismissing the panel.
    const { el } = paint(viewOf({ [COMPONENT]: 1 }));
    el.querySelector<HTMLButtonElement>('[data-close]')?.focus();
    renderTownFocusWindow(el, viewOf({ [COMPONENT]: 2 }), {
      onStep: vi.fn(),
      onSave: vi.fn(),
      onClose: vi.fn(),
    });
    expect(el.querySelector<HTMLButtonElement>('.town-focus-save')?.disabled).toBe(false);
    expect(document.activeElement).toBe(el.querySelector('[data-close]'));
    expect(document.activeElement).not.toBe(el.querySelector('.town-focus-save'));
  });

  it('takes focus from NOBODY when the player was not in the panel', () => {
    // The open path: focus is on the minimap button, outside the panel, and a
    // repaint must not steal it.
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const { el } = paint(viewOf({ [COMPONENT]: 1 }));
    outside.focus();
    renderTownFocusWindow(el, viewOf({ [COMPONENT]: 2 }), {
      onStep: vi.fn(),
      onSave: vi.fn(),
      onClose: vi.fn(),
    });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('never reads a focus key off a control OUTSIDE the panel', () => {
    // The containment half, which the test above cannot reach because its
    // outside button carries no key at all. mailbox_window keys its parcel
    // steppers with the SAME `data-focus-key` attribute in the SAME
    // `<id>:<role>` shape, so an unguarded read would let a slow-band Town
    // Focus repaint pull focus out of another open window.
    const outside = document.createElement('button');
    outside.dataset.focusKey = `${COMPONENT}:inc`;
    document.body.appendChild(outside);
    const { el } = paint(viewOf({ [COMPONENT]: 1 }));
    outside.focus();
    renderTownFocusWindow(el, viewOf({ [COMPONENT]: 2 }), {
      onStep: vi.fn(),
      onSave: vi.fn(),
      onClose: vi.fn(),
    });
    expect(document.activeElement).toBe(outside);
    expect(document.activeElement).not.toBe(stepButton(el, COMPONENT, 'inc'));
    outside.remove();
  });

  it('keys every stepper by component AND direction, so no two share an identity', () => {
    const { el } = paint(viewOf({}));
    const keys = [...el.querySelectorAll<HTMLElement>('[data-focus-key]')].map(
      (n) => n.dataset.focusKey,
    );
    expect(keys.length).toBe(TOWN_FOCUS_COMPONENTS.length * 2 + 2);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// 5. Wiring. The three call sites live in code paths a unit test cannot run
// (the slow band of update(), the paint itself, the language fan-out), so they
// are pinned against comment-stripped source: prose alone must never satisfy a
// pin. Each pin is scoped to the REGION the call has to live in, so moving the
// code somewhere that changes its meaning reds the pin.
// ---------------------------------------------------------------------------

const hudSrc = stripComments(readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8'));

/** Source between two unique anchors, asserted to exist so a rename fails
 *  loudly here instead of silently slicing an empty (vacuously passing) span. */
function region(from: string, to: string): string {
  const start = hudSrc.indexOf(from);
  expect(start, `anchor not found: ${from}`).toBeGreaterThan(-1);
  const end = hudSrc.indexOf(to, start + from.length);
  expect(end, `anchor not found after ${from}: ${to}`).toBeGreaterThan(start);
  return hudSrc.slice(start, end);
}

describe('Town Focus repaint-gate wiring (source pins)', () => {
  it('renderTownFocus re-arms the latch on EVERY paint, whatever caused it', () => {
    // Scoped to the method: moving the re-arm into the probe would leave every
    // other paint cause (the open, a step, the language switch) un-armed, so
    // the next poll would repaint once for no reason, and a whole-file pin
    // would not notice.
    const render = region('private renderTownFocus(): void {', 'private refreshOpenTownFocus');
    expect(render).toContain('this.lastTownFocusSig = townFocusRenderSig(view);');
  });

  it('the slow band drives the PROBE, never the bare painter', () => {
    // Anchored INSIDE the `if (slowHud)` guard. The whole issue was that this
    // line used to be the unguarded `if (this.townFocusOpen)
    // this.renderTownFocus();`, so pin both halves: the probe is here, and the
    // unguarded call is not.
    //
    // The two NEGATIVE halves are the weak ones and are deliberately kept as
    // belt to the registry's braces: the exact-text refusal is defeated by the
    // same call written across two lines, and the per-frame refusal only spans
    // the ~30 lines between the divider and the slow block, so a probe moved
    // anywhere else on the per-frame path passes it. What actually enforces the
    // band is tests/hud_update_drive.test.ts, which diffs every call update()
    // evaluates against an AST walk BOTH ways: mutation testing confirmed it is
    // the gate that kills both of those, not these two lines.
    const slowBand = region('if (slowHud) {', 'this.playerFramePainter');
    expect(slowBand).toContain('this.refreshOpenTownFocusIfChanged();');
    expect(slowBand).not.toContain('if (this.townFocusOpen) this.renderTownFocus();');
    const perFrame = region('const slowHud =', 'if (slowHud) {');
    expect(perFrame).not.toContain('refreshOpenTownFocusIfChanged');
  });

  it('declares the cold latch as the empty sentinel no real signature can spell', () => {
    // Both harnesses build the Hud with Object.create, which skips field
    // initializers, so they seed the latch by hand and no behavioral test in
    // this file can see the DECLARED value. Pin the declaration itself, or
    // changing it to a plausible-looking non-empty string would arm the panel
    // with a signature it never painted and leave the suite green.
    expect(hudSrc).toContain("private lastTownFocusSig = '';");
  });

  it('the probe tests the open flag before it reads anything', () => {
    const probe = region(
      'private refreshOpenTownFocusIfChanged(): void {',
      'closeTownFocus(): void {',
    );
    expect(probe.indexOf('if (!this.townFocusOpen) return;')).toBeGreaterThan(-1);
    expect(probe.indexOf('if (!this.townFocusOpen) return;')).toBeLessThan(
      probe.indexOf('townFocusRenderSig'),
    );
    expect(probe).toContain('if (sig === this.lastTownFocusSig) return;');
  });

  it('a language switch still repaints the open panel', () => {
    // The signature is text-independent, so the switch alone never moves it.
    // Without this arm the gate would freeze the panel in the old locale until
    // the player edited the allocation, which is the regression a naive gate
    // ships. Scoped to the relocalizer, since the point is WHERE it runs.
    const relocalize = region(
      'private refreshLocalizedDynamicUi(): void {',
      'private previewResolvedAbility(',
    );
    expect(relocalize).toContain('if (this.townFocusOpen) this.renderTownFocus();');
  });
});
