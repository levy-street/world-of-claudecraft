// @vitest-environment happy-dom

// Craft Cast System Phase 2: crafting window duration chip, button state,
// and the in-window cast strip. The strip is a header band ABOVE the
// scrollable body and its per-frame fill/label/timer/aria writes ride a
// CastBarPainter over craftCastStripElements through the PainterHost elided
// writers (the write-elision contract); renderCraftingWindow paints only the
// cold batch label. Announcements ride deps.announce (the static
// #crafting-live region), never a node inside the rebuilt subtree.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import { CRAFT_CAST_ID } from '../src/sim/types';
import { CastBarPainter } from '../src/ui/cast_bar_painter';
import { buildCraftCastSession, IDLE_CRAFT_CAST_SESSION } from '../src/ui/craft_cast_view';
import { buildCraftingView, type CraftingView } from '../src/ui/crafting_view';
import { craftCastStripElements, renderCraftingWindow } from '../src/ui/crafting_window';
import { makeWriterFacet } from '../src/ui/painter_host';

function item(id: string): ItemDef {
  return {
    id,
    name: id,
    quality: 'common',
    kind: 'junk',
    sellValue: 0,
  } as unknown as ItemDef;
}

const ITEMS = Object.fromEntries(['copper_ore', 'test_stew'].map((id) => [id, item(id)]));

function craftableView(oreHeld = 2): CraftingView {
  return buildCraftingView(
    [
      {
        id: 'recipe_test_stew',
        professionId: 'cooking',
        resultItemId: 'test_stew',
        resultCount: 1,
        reagents: [{ itemId: 'copper_ore', count: 1 }],
        skillReq: 0,
      },
    ],
    [{ itemId: 'copper_ore', count: oreHeld }],
    ITEMS,
  );
}

function deps(qty = 1) {
  const qtyMap = new Map<string, number>();
  return {
    hideTooltip: vi.fn(),
    onCraft: vi.fn(),
    onClose: vi.fn(),
    onOpenOrders: vi.fn(),
    itemIcon: vi.fn(() => ''),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
    commissionChecked: vi.fn(() => false),
    onToggleCommission: vi.fn(),
    craftQty: (recipeId: string) => qtyMap.get(recipeId) ?? qty,
    announce: vi.fn(),
    onCraftQty: vi.fn((recipeId: string, n: number) => {
      qtyMap.set(recipeId, n);
    }),
    selectedCraft: () => null as string | null,
    onSelectCraft: vi.fn(),
  };
}

/** A real elided-writer facet with observable write/skip counters. */
function countingWriters() {
  const counts = { writes: 0, skips: 0 };
  const writers = makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => {
      counts.writes++;
    },
    () => {
      counts.skips++;
    },
  );
  return { writers, counts };
}

/** Build the strip painter the way the HUD does after each full paint. */
function stripPainter(el: HTMLElement, label = 'Test Stew') {
  const { writers, counts } = countingWriters();
  const elements = craftCastStripElements(el);
  expect(elements).not.toBeNull();
  const painter = new CastBarPainter(writers, elements!, {
    resolveCastLabel: () => label,
    clearOnHide: true,
    shownDisplay: 'flex',
  });
  return { painter, counts, elements: elements! };
}

function castInput(fill: number, remaining: number) {
  return {
    cast: {
      visible: true,
      channel: false,
      fill,
      label: 'recipe_test_stew',
      fishing: false,
    },
    castRemaining: remaining,
  };
}

describe('renderCraftingWindow craft-cast UX', () => {
  it('paints a duration chip and ready craft button when idle', () => {
    const el = document.createElement('div');
    renderCraftingWindow(
      el,
      craftableView(),
      deps(),
      undefined,
      new Map(),
      IDLE_CRAFT_CAST_SESSION,
    );
    const chip = el.querySelector('.crafting-duration-chip');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toMatch(/1\.75/);
    const btn = el.querySelector<HTMLButtonElement>('.crafting-recipe-btn');
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(false);
    expect(btn!.getAttribute('aria-busy')).toBeNull();
    expect(btn!.querySelector('.crafting-craft-chip')!.textContent).toMatch(/Create/);
    // Phase 3 batch controls.
    expect(el.querySelector('.crafting-qty-row')).not.toBeNull();
    expect(el.querySelector('.crafting-create-all-btn')).not.toBeNull();
    expect(el.querySelector('.crafting-create-all-btn')!.textContent).toMatch(/Create All/);
  });

  it('places the strip as a header band above the body, never inside the scroller', () => {
    const el = document.createElement('div');
    renderCraftingWindow(el, craftableView(), deps());
    const progress = el.querySelector<HTMLElement>('.crafting-cast-progress');
    expect(progress).not.toBeNull();
    // Not inside the scrollable body (a strip in the scroller could scroll
    // the live cast out of view), and directly before it.
    expect(el.querySelector('.crafting-body .crafting-cast-progress')).toBeNull();
    expect(progress!.nextElementSibling?.classList.contains('crafting-body')).toBe(true);
    // Programmatic focus target for the mid-cast focus ladder, never in the
    // Tab cycle.
    expect(progress!.tabIndex).toBe(-1);
    expect(progress!.dataset.focusKey).toBe('cast-strip');
    // Idle build: CSS keeps the strip display:none, so the ladder never picks
    // a hidden node when no cast runs (no inline display is written).
    expect(progress!.style.display).toBe('');
    // The live region no longer lives in the rebuilt subtree (it would be
    // wiped by the same task that writes it): announcements ride
    // deps.announce into the static #crafting-live node.
    expect(el.querySelector('.crafting-live')).toBeNull();
  });

  it('marks the active recipe casting with aria-busy; the strip painter shows progress', () => {
    const el = document.createElement('div');
    const session = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 0.875,
      castTotal: 1.75,
      craftCastRecipeId: 'recipe_test_stew',
    });
    renderCraftingWindow(el, craftableView(), deps(), undefined, new Map(), session);
    const btn = el.querySelector<HTMLButtonElement>('.crafting-recipe-btn');
    expect(btn!.disabled).toBe(true);
    expect(btn!.getAttribute('aria-busy')).toBe('true');
    expect(btn!.classList.contains('casting')).toBe(true);
    expect(btn!.querySelector('.crafting-craft-chip')!.textContent).toMatch(/Crafting/);
    // The build itself renders the strip when a session is ACTIVE: the focus
    // ladder runs inside renderCraftingWindow, and focus() on a display:none
    // node is a no-op in a real browser (focus would fall to body and the
    // Tab trap would let go), so the inline flex must exist BEFORE any
    // painter frame.
    expect(el.querySelector<HTMLElement>('.crafting-cast-progress')!.style.display).toBe('flex');
    const { painter, elements } = stripPainter(el);
    painter.paint(castInput(session.progress, session.remainingSec));
    expect(elements.bar.style.display).toBe('flex');
    expect(elements.bar.getAttribute('aria-valuenow')).toBe('50');
    expect(elements.fill.style.width).toBe('50.0%');
    expect(elements.label.textContent).toBe('Test Stew');
    expect(elements.timer.textContent).toMatch(/0\.9/);
  });

  it('elides identical frames: a repeat paint performs zero DOM writes', () => {
    const el = document.createElement('div');
    const session = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 0.875,
      castTotal: 1.75,
      craftCastRecipeId: 'recipe_test_stew',
    });
    renderCraftingWindow(el, craftableView(), deps(), undefined, new Map(), session);
    const { painter, counts, elements } = stripPainter(el);
    painter.paint(castInput(0.5, 0.875));
    const writesAfterFirst = counts.writes;
    expect(writesAfterFirst).toBeGreaterThan(0);
    // Out-of-band DOM mutation: an elided repeat paint must NOT restore it,
    // proving the guard skipped the write rather than re-writing same-value.
    elements.fill.style.width = '13%';
    elements.timer.textContent = 'sentinel';
    painter.paint(castInput(0.5, 0.875));
    expect(counts.writes).toBe(writesAfterFirst);
    expect(counts.skips).toBeGreaterThan(0);
    expect(elements.fill.style.width).toBe('13%');
    expect(elements.timer.textContent).toBe('sentinel');
    // A REAL change still writes.
    painter.paint(castInput(0.6, 0.7));
    expect(elements.fill.style.width).toBe('60.0%');
    expect(counts.writes).toBeGreaterThan(writesAfterFirst);
  });

  it('hides the strip and clears its inner state when the session ends', () => {
    const el = document.createElement('div');
    const session = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 0.875,
      castTotal: 1.75,
      craftCastRecipeId: 'recipe_test_stew',
    });
    renderCraftingWindow(el, craftableView(), deps(), undefined, new Map(), session);
    const { painter, elements } = stripPainter(el);
    painter.paint(castInput(0.5, 0.875));
    painter.paint({
      cast: { visible: false, channel: false, fill: 0, label: '', fishing: false },
      castRemaining: 0,
    });
    expect(elements.bar.style.display).toBe('none');
    expect(elements.fill.style.width).toBe('0%');
    expect(elements.label.textContent).toBe('');
    expect(elements.timer.textContent).toBe('');
  });

  it('announces the craft start once per session edge through deps.announce', () => {
    const el = document.createElement('div');
    const d = deps();
    const session = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 1.75,
      castTotal: 1.75,
      craftCastRecipeId: 'recipe_test_stew',
    });
    renderCraftingWindow(el, craftableView(), d, undefined, new Map(), session);
    expect(d.announce).toHaveBeenCalledTimes(1);
    expect(String(d.announce.mock.calls[0][0])).toMatch(/Crafting/);
    // A mid-cast rebuild (bag-driven) must NOT re-announce the same start.
    renderCraftingWindow(el, craftableView(), d, undefined, new Map(), session);
    expect(d.announce).toHaveBeenCalledTimes(1);
  });

  it('duration is present in the accessible name (fairness: not color-only)', () => {
    const el = document.createElement('div');
    renderCraftingWindow(el, craftableView(), deps());
    const aria = el.querySelector('.crafting-recipe-btn')!.getAttribute('aria-label') ?? '';
    expect(aria).toMatch(/1\.75/);
    expect(aria.toLowerCase()).toMatch(/cast/);
  });

  it('Create sends the row qty and Create All sends mats-fit, decisively different', () => {
    const el = document.createElement('div');
    // Row qty 1 against 4 ore held for a 1-cost recipe: the two controls must
    // send DIFFERENT counts (1 vs 4), so a wiring swap cannot pass.
    const d = deps(1);
    renderCraftingWindow(el, craftableView(4), d);
    el.querySelector<HTMLButtonElement>('.crafting-recipe-btn')!.click();
    expect(d.onCraft).toHaveBeenCalledWith('recipe_test_stew', 1);
    d.onCraft.mockClear();
    el.querySelector<HTMLButtonElement>('.crafting-create-all-btn')!.click();
    expect(d.onCraft).toHaveBeenCalledWith('recipe_test_stew', 4);
  });

  it('disables qty stepper while casting and paints the cold batch label', () => {
    const el = document.createElement('div');
    const session = buildCraftCastSession({
      castingAbility: CRAFT_CAST_ID,
      castRemaining: 1,
      castTotal: 2,
      craftCastRecipeId: 'recipe_test_stew',
      craftCastBatchRemaining: 2,
      craftCastBatchTotal: 3,
    });
    renderCraftingWindow(el, craftableView(), deps(), undefined, new Map(), session);
    const dec = el.querySelector<HTMLButtonElement>('[data-focus-key^="qty-dec:"]');
    const inc = el.querySelector<HTMLButtonElement>('[data-focus-key^="qty-inc:"]');
    expect(dec!.disabled).toBe(true);
    expect(inc!.disabled).toBe(true);
    const batch = el.querySelector<HTMLElement>('.crafting-cast-progress-batch');
    expect(batch!.hidden).toBe(false);
    expect(batch!.textContent).toMatch(/2/);
    expect(batch!.textContent).toMatch(/3/);
  });

  it('folds the current qty into the stepper button names and echoes changes politely', () => {
    const el = document.createElement('div');
    const d = deps(2);
    renderCraftingWindow(el, craftableView(4), d);
    const dec = el.querySelector<HTMLButtonElement>('[data-focus-key^="qty-dec:"]');
    const inc = el.querySelector<HTMLButtonElement>('[data-focus-key^="qty-inc:"]');
    // A bare span exposes no accessible name, so the value rides the button
    // labels and the visible span is aria-hidden.
    expect(dec!.getAttribute('aria-label')).toMatch(/2/);
    expect(inc!.getAttribute('aria-label')).toMatch(/2/);
    expect(el.querySelector('.crafting-qty-value')!.getAttribute('aria-hidden')).toBe('true');
    inc!.click();
    expect(d.onCraftQty).toHaveBeenCalledWith('recipe_test_stew', 3);
    expect(d.announce).toHaveBeenCalledWith(expect.stringMatching(/3/));
  });
});

// ---------------------------------------------------------------------------
// Craft-from-vault render sink (Bank Storage Phase 04): the vault-draw suffix
// is stated in WORDS on the visible reagent line AND the aria fold (never
// color alone), exactly like the fine-substitution suffix it sits beside.
// ---------------------------------------------------------------------------
describe('renderCraftingWindow vault-draw suffix (Phase 04)', () => {
  function vaultBackedView(): CraftingView {
    // 0 carried, 2 in the vault, 1 required: the whole requirement is a
    // vault draw, so the suffix must render with count 1.
    return buildCraftingView(
      [
        {
          id: 'recipe_test_stew',
          professionId: 'cooking',
          resultItemId: 'test_stew',
          resultCount: 1,
          reagents: [{ itemId: 'copper_ore', count: 1 }],
          skillReq: 0,
        },
      ],
      [],
      ITEMS,
      {},
      { synced: true, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
      new Set(),
      null,
      { copper_ore: 2 },
    );
  }

  it('renders the suffix in the visible line and the aria fold, and enables the Craft button', () => {
    const el = document.createElement('div');
    renderCraftingWindow(el, vaultBackedView(), deps());
    const marker = el.querySelector('.crafting-vault-draw');
    expect(marker).not.toBeNull();
    // The resolved ENGLISH copy (hudChrome.crafting.reagentVaultDraw), a
    // literal so a key rename or param break reds here.
    expect(marker?.textContent).toContain('(draws 1 from your vault)');
    // The aria fold carries the same words (the fairness rule: never a
    // visual-only signal).
    const ariaCarrier = el.querySelector('[aria-label*="draws 1 from your vault"]');
    expect(ariaCarrier, 'no element carries the suffix in its aria-label').not.toBeNull();
    // The vault-backed row is CRAFTABLE: the send gate agrees with the sim.
    const craftBtn = el.querySelector<HTMLButtonElement>('button.crafting-recipe-btn');
    expect(craftBtn).not.toBeNull();
    expect(craftBtn?.disabled).toBe(false);
  });

  it('a carried-only view renders NO vault-draw marker (the control)', () => {
    const el = document.createElement('div');
    renderCraftingWindow(el, craftableView(), deps());
    expect(el.querySelector('.crafting-vault-draw')).toBeNull();
  });

  it('BOTH suffixes compose when the same units are fine-grade AND vault-drawn (reviewed order)', () => {
    // The overlap the two docblocks call deliberate (one suffix warns about
    // grade VALUE, the other about SOURCE): a vault holding only fine-grade
    // units against a bags-empty requirement makes fineSubstituted and
    // vaultDrawn describe the SAME three units. This pin makes the wording
    // and order a reviewed decision (fine first, vault second, matching the
    // painter's concatenation) rather than an emergent one; if the copy is
    // ever judged double-counting, this is the arm to move with the fix.
    const bothItems = Object.fromEntries(
      ['copper_ore', 'fine_copper_ore', 'test_stew'].map((id) => [id, item(id)]),
    );
    const view = buildCraftingView(
      [
        {
          id: 'recipe_test_stew',
          professionId: 'cooking',
          resultItemId: 'test_stew',
          resultCount: 1,
          reagents: [{ itemId: 'copper_ore', count: 3 }],
          skillReq: 0,
        },
      ],
      [],
      bothItems,
      {},
      { synced: true, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
      new Set(),
      null,
      { fine_copper_ore: 3 },
    );
    const reagent = view.recipes[0].reagents[0];
    expect(reagent).toMatchObject({ fineSubstituted: 3, vaultDrawn: 3, satisfied: true });

    const el = document.createElement('div');
    renderCraftingWindow(el, view, deps());
    const line = el.querySelector('.crafting-reagent-line, .crafting-vault-draw')?.parentElement;
    const text = (line ?? el).textContent ?? '';
    const fineAt = text.indexOf('(spends 3 fine-grade)');
    const vaultAt = text.indexOf('(draws 3 from your vault)');
    expect(fineAt).toBeGreaterThan(-1);
    expect(vaultAt).toBeGreaterThan(fineAt); // fine first, vault second
    const ariaCarrier = el.querySelector('[aria-label*="draws 3 from your vault"]');
    expect(ariaCarrier?.getAttribute('aria-label') ?? '').toContain('(spends 3 fine-grade)');
  });

  it('renders the vault-unreachable note once, OUTSIDE the scroll body, on a short visible tab', () => {
    // The place-blocked reason (Phase 04 QA, the stationOutOfRange
    // precedent): stated in words, location-scoped (one note for the
    // window), rendered only when the core derived it AND the visible
    // section has a short row (the fix-round scoping), and a SIBLING of the
    // scroll body (a first child would hide above the restored scrollTop on
    // the very repaint that introduces it, the fix-round S2 finding).
    const blockedShort = buildCraftingView(
      [
        {
          id: 'recipe_test_stew',
          professionId: 'cooking',
          resultItemId: 'test_stew',
          resultCount: 1,
          reagents: [{ itemId: 'copper_ore', count: 3 }],
          skillReq: 0,
        },
      ],
      [],
      ITEMS,
      {},
      { synced: true, activeArchetype: null, pairedMajor: null, hobbyCraft: null },
      new Set(),
      null,
      null,
      true,
    );
    expect(blockedShort.vaultNote).toBe(true);
    const el = document.createElement('div');
    renderCraftingWindow(el, blockedShort, deps());
    const notes = el.querySelectorAll('.crafting-vault-note');
    expect(notes).toHaveLength(1);
    // The resolved ENGLISH copy (hudChrome.crafting.vaultUnreachable): a
    // literal so a key rename or a fallback idiom reds here.
    expect(notes[0]?.textContent).toBe('The Materials Vault is out of reach here.');
    // Outside the scroll container, before it in document order.
    expect(notes[0]?.closest('.crafting-body')).toBeNull();
    const body = el.querySelector('.crafting-body');
    expect(body).not.toBeNull();
    expect(
      notes[0] && body
        ? notes[0].compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).toBeTruthy();

    // Satisfied visible tab: the note stays quiet even when the core flag is
    // set (a short recipe on ANOTHER tab is not this tab's business).
    const noted = { ...vaultBackedView(), vaultNote: true };
    const control = document.createElement('div');
    renderCraftingWindow(control, noted, deps());
    expect(control.querySelector('.crafting-vault-note')).toBeNull();

    // And without the core flag, a short tab renders no note either.
    const unflagged = { ...blockedShort, vaultNote: false };
    const control2 = document.createElement('div');
    renderCraftingWindow(control2, unflagged, deps());
    expect(control2.querySelector('.crafting-vault-note')).toBeNull();
  });

  it('both suffix classes carry their token rule in components.css (deleting either reds)', () => {
    // The render tests above assert the CLASS lands on the span; without this
    // pin, deleting the CSS rule renders both suffixes in inherited grey with
    // every suite still green. The two rules are deliberately separate
    // duplicates (divergence hooks under the rule of three); each is pinned
    // to the same token so a silent drop of either one reds by name.
    const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
    for (const cls of ['.crafting-fine-sub', '.crafting-vault-draw']) {
      const at = css.indexOf(`${cls} {`);
      expect(at, `${cls} rule missing from components.css`).toBeGreaterThan(-1);
      const body = css.slice(at, css.indexOf('}', at));
      expect(body, `${cls} lost its token tint`).toContain('color: var(--gold-dim)');
    }
    // The vault note's own rule (the fix-round S1 finding: the family
    // selector is direct-child scoped to the recipe item and cannot reach a
    // window-level sibling, so a bare class here rendered UNstyled).
    const noteAt = css.indexOf('.crafting-vault-note {');
    expect(noteAt, '.crafting-vault-note rule missing from components.css').toBeGreaterThan(-1);
    const noteBody = css.slice(noteAt, css.indexOf('}', noteAt));
    expect(noteBody).toContain('color: var(--color-text-muted)');
  });
});
