// @vitest-environment happy-dom

// Crafting window bag-freshness (issue #2375). The Craft gate is derived
// entirely from the bag, but the window is a COLD painter: before this suite
// an open window only repainted on the station-range edge, the craft/train
// event arms, and the profession-surface signature, none of which carries an
// inventory term. Buying, looting, or trading for the last reagent therefore
// left the row disabled until the player closed and reopened the window.
//
// Four layers are pinned here:
//  1. craftingReagentSig (pure): it moves exactly when the bag facts
//     buildCraftingView reads move, and stays put on churn the view ignores.
//  2. The HUD probe's behavior, driven on a bare Hud prototype (the
//     hud_profession_events.test.ts precedent, since the probe is private and
//     update() is not drivable in a unit test): cold latch, elision, the
//     repro edge, and that a closed window reads nothing at all.
//  3. The wiring source pins for the three edges that call the probe, each
//     anchored to the REGION it must live in, not to the whole file.
//  4. The painter carrying the tab strip's scroll offset across the rebuild,
//     since the window now repaints from causes the player did not initiate.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { buildCraftingView, craftingReagentSig, type RecipeDefLike } from '../src/ui/crafting_view';
import { renderCraftingWindow } from '../src/ui/crafting_window';
import { Hud } from '../src/ui/hud';

const VIEWER = 'Fernando';

// Real reagent ids (the signature is scoped to what ALL_RECIPES consumes, so
// synthetic ids would be filtered out and prove nothing) plus one real item
// that is NOT any recipe's reagent, for the quiet-churn assertions.
const REAGENT_A = 'copper_ore';
const REAGENT_B = 'linen_scrap';
const NON_REAGENT = 'wolf_pelt_scrap';

function item(id: string): ItemDef {
  return { id, name: id, quality: 'common', kind: 'junk', sellValue: 0 } as unknown as ItemDef;
}

// The issue's shape: a recipe needing two reagents, one of them already held.
// Synthetic recipe (the crafting_view.test.ts idiom) over REAL reagent ids, so
// content churn cannot rewrite what this suite proves.
const STEW: RecipeDefLike = {
  id: 'recipe_test_stew',
  professionId: 'cooking',
  resultItemId: 'test_stew',
  resultCount: 1,
  reagents: [
    { itemId: REAGENT_A, count: 1 },
    { itemId: REAGENT_B, count: 1 },
  ],
  skillReq: 0,
};

const ITEMS = Object.fromEntries(
  [REAGENT_A, REAGENT_B, NON_REAGENT, 'test_stew'].map((id) => [id, item(id)]),
);

/** One of the two reagents held: the state the player is in on the way to the
 *  shopkeeper. A factory (never a shared constant) so equality assertions
 *  compare two independently built arrays. */
function oneOfTwo(): InvSlot[] {
  return [{ itemId: REAGENT_A, count: 1 }];
}

function rowFor(recipe: RecipeDefLike, inventory: InvSlot[]) {
  return buildCraftingView([recipe], inventory, ITEMS, {}, undefined, undefined, VIEWER).recipes[0];
}

function craftableOf(inventory: InvSlot[]): boolean {
  return rowFor(STEW, inventory).craftable;
}

describe('craftingReagentSig', () => {
  it('rests on fixtures that really are (and are not) recipe reagents', () => {
    // The scoping assertions below are only meaningful while these fixture
    // ids keep their roles, and recipes.ts is live content. Fail HERE with the
    // reason rather than somewhere confusing downstream.
    const reagentIds = new Set(ALL_RECIPES.flatMap((r) => r.reagents.map((g) => g.itemId)));
    expect([...reagentIds]).toEqual(expect.arrayContaining([REAGENT_A, REAGENT_B]));
    expect(reagentIds.has(NON_REAGENT)).toBe(false);
    // The signature packs id:count:flag rows with ':' and '|', so a reagent id
    // carrying either delimiter could make two different bags share a string.
    // No authored id does; this is the guard that keeps it that way.
    for (const id of reagentIds) expect(id).not.toMatch(/[:|]/);
  });

  it('is stable across two independently built copies of the same bag', () => {
    // Distinct arrays holding distinct slot objects: a signature that only
    // ever compared a value with itself would pass here proving nothing.
    expect(craftingReagentSig(oneOfTwo(), VIEWER)).toBe(craftingReagentSig(oneOfTwo(), VIEWER));
  });

  it('moves when the LAST missing reagent lands, exactly as the Craft gate flips', () => {
    const before = oneOfTwo();
    const after = [...oneOfTwo(), { itemId: REAGENT_B, count: 1 }];
    // The bug in one place: the gate flips (the window has something new to
    // say) while nothing tells the HUD to repaint. The signature closes that
    // gap, so it must move on precisely this edge.
    expect(craftableOf(before)).toBe(false);
    expect(craftableOf(after)).toBe(true);
    expect(craftingReagentSig(after, VIEWER)).not.toBe(craftingReagentSig(before, VIEWER));
  });

  it('moves when a stack shrinks (a reagent spent or destroyed elsewhere)', () => {
    const before: InvSlot[] = [{ itemId: REAGENT_A, count: 2 }];
    const after: InvSlot[] = [{ itemId: REAGENT_A, count: 1 }];
    expect(craftingReagentSig(after, VIEWER)).not.toBe(craftingReagentSig(before, VIEWER));
  });

  // The #1145 self-signed reduction takes one off the listed count (floored at
  // 1), so it only bites on a reagent listed at 2 or more. This recipe exists
  // to make that discount observable: at count 3 the requirement drops to 2.
  const SIGNED_RECIPE: RecipeDefLike = { ...STEW, reagents: [{ itemId: REAGENT_A, count: 3 }] };

  it('moves when a stack turns SELF-signed, and the Craft gate moves with it', () => {
    const unsigned: InvSlot[] = [{ itemId: REAGENT_A, count: 2 }];
    const selfSigned: InvSlot[] = [{ itemId: REAGENT_A, count: 2, instance: { signer: VIEWER } }];
    // Same stack size, different answer: a counts-only signature would miss it.
    expect(rowFor(SIGNED_RECIPE, unsigned).reagents[0].required).toBe(3);
    expect(rowFor(SIGNED_RECIPE, unsigned).craftable).toBe(false);
    expect(rowFor(SIGNED_RECIPE, selfSigned).reagents[0].required).toBe(2);
    expect(rowFor(SIGNED_RECIPE, selfSigned).craftable).toBe(true);
    expect(craftingReagentSig(selfSigned, VIEWER)).not.toBe(craftingReagentSig(unsigned, VIEWER));
  });

  it('ignores a signer swap between two OTHER crafters (payload the view never reads)', () => {
    // holdsSelfSignedInstance only asks whether the VIEWER signed it, so a
    // stranger-signed stack changing hands must not churn a repaint.
    const alice: InvSlot[] = [{ itemId: REAGENT_A, count: 2, instance: { signer: 'Alice' } }];
    const bob: InvSlot[] = [{ itemId: REAGENT_A, count: 2, instance: { signer: 'Bob' } }];
    expect(craftingReagentSig(bob, VIEWER)).toBe(craftingReagentSig(alice, VIEWER));
    // ...and the view agrees: a stranger's signature earns no discount, so the
    // requirement stays the listed 3 (contrast the self-signed case above,
    // which drops it to 2).
    expect(rowFor(SIGNED_RECIPE, alice).reagents[0].required).toBe(3);
    expect(rowFor(SIGNED_RECIPE, bob).reagents[0].required).toBe(3);
  });

  it('sums a reagent split across stacks, exactly as countInInventory does', () => {
    const split: InvSlot[] = [
      { itemId: REAGENT_A, count: 1 },
      { itemId: REAGENT_A, count: 1 },
    ];
    const whole: InvSlot[] = [{ itemId: REAGENT_A, count: 2 }];
    expect(craftingReagentSig(split, VIEWER)).toBe(craftingReagentSig(whole, VIEWER));
    const three: InvSlot[] = [{ itemId: REAGENT_A, count: 3 }];
    expect(craftingReagentSig(three, VIEWER)).not.toBe(craftingReagentSig(whole, VIEWER));
  });

  it('stays put when a NON-reagent item is looted (no repaint under the player)', () => {
    const before = oneOfTwo();
    const after = [...oneOfTwo(), { itemId: NON_REAGENT, count: 4 }];
    expect(craftingReagentSig(after, VIEWER)).toBe(craftingReagentSig(before, VIEWER));
  });

  it('stays put when the bags are rearranged (order is not a crafting change)', () => {
    const before: InvSlot[] = [
      { itemId: REAGENT_A, count: 1, slot: 0 },
      { itemId: REAGENT_B, count: 2, slot: 1 },
    ];
    const after: InvSlot[] = [
      { itemId: REAGENT_B, count: 2, slot: 5 },
      { itemId: REAGENT_A, count: 1, slot: 9 },
    ];
    expect(craftingReagentSig(after, VIEWER)).toBe(craftingReagentSig(before, VIEWER));
  });

  it('distinguishes two different reagents held at the same count', () => {
    const a: InvSlot[] = [{ itemId: REAGENT_A, count: 1 }];
    const b: InvSlot[] = [{ itemId: REAGENT_B, count: 1 }];
    expect(craftingReagentSig(b, VIEWER)).not.toBe(craftingReagentSig(a, VIEWER));
  });
});

// ---------------------------------------------------------------------------
// The HUD probe. refreshOpenCraftingIfReagentsChanged is private and reached
// from update(), which no unit test can drive, so it is exercised on a bare
// Hud prototype with renderCrafting stubbed (the hud_profession_events.test.ts
// precedent). The stub re-arms the latch the way the real renderCrafting does
// (hud.ts, pinned by the source region below), so the call counts here measure
// the probe's own elision and nothing else.
// ---------------------------------------------------------------------------

interface CraftingRefreshHarness {
  sim: { inventory: InvSlot[]; player: { name: string } };
  renderCrafting: ReturnType<typeof vi.fn>;
  lastCraftingReagentSig: string;
  refreshOpenCraftingIfReagentsChanged(): void;
}

function makeHud(inventory: InvSlot[]): {
  hud: CraftingRefreshHarness;
  window: HTMLElement;
  /** How many times the probe has read the bag: the "a closed window costs
   *  nothing" claim is about this, not about the repaint count. */
  inventoryReads(): number;
  setInventory(next: InvSlot[]): void;
} {
  const hud = Object.create(Hud.prototype) as unknown as CraftingRefreshHarness;
  let bag = inventory;
  let reads = 0;
  const player = { name: VIEWER };
  hud.sim = {
    get inventory() {
      reads++;
      return bag;
    },
    player,
  } as CraftingRefreshHarness['sim'];
  // Object.create skips field initializers, so seed the latch the way the real
  // field declares it ('' until the first paint arms it).
  hud.lastCraftingReagentSig = '';
  hud.renderCrafting = vi.fn(() => {
    hud.lastCraftingReagentSig = craftingReagentSig(bag, player.name);
  });
  document.getElementById('crafting-window')?.remove();
  const el = document.createElement('div');
  el.id = 'crafting-window';
  el.style.display = 'flex';
  document.body.appendChild(el);
  return {
    hud,
    window: el,
    inventoryReads: () => reads,
    setInventory: (next) => {
      bag = next;
    },
  };
}

describe('refreshOpenCraftingIfReagentsChanged', () => {
  it('latches on the first probe, then elides an unchanged bag', () => {
    const { hud } = makeHud(oneOfTwo());
    hud.refreshOpenCraftingIfReagentsChanged();
    expect(hud.renderCrafting).toHaveBeenCalledTimes(1);
    hud.refreshOpenCraftingIfReagentsChanged();
    hud.refreshOpenCraftingIfReagentsChanged();
    expect(hud.renderCrafting).toHaveBeenCalledTimes(1);
  });

  it('repaints when the last reagent lands (the issue #2375 repro)', () => {
    const { hud, setInventory } = makeHud(oneOfTwo());
    hud.refreshOpenCraftingIfReagentsChanged();
    expect(hud.renderCrafting).toHaveBeenCalledTimes(1);
    // The shopkeeper hands over the missing reagent.
    const stocked = [...oneOfTwo(), { itemId: REAGENT_B, count: 1 }];
    setInventory(stocked);
    hud.refreshOpenCraftingIfReagentsChanged();
    expect(hud.renderCrafting).toHaveBeenCalledTimes(2);
    expect(craftableOf(stocked)).toBe(true);
  });

  it('reads nothing at all while the window is CLOSED', () => {
    const { hud, window, inventoryReads, setInventory } = makeHud(oneOfTwo());
    window.style.display = 'none';
    hud.refreshOpenCraftingIfReagentsChanged();
    setInventory([...oneOfTwo(), { itemId: REAGENT_B, count: 1 }]);
    hud.refreshOpenCraftingIfReagentsChanged();
    expect(hud.renderCrafting).not.toHaveBeenCalled();
    // The open-check must come FIRST: a guard reorder that built the signature
    // before testing display would cost every closed player a bag sweep per
    // slow tick, and a repaint-count assertion alone would not notice.
    expect(inventoryReads()).toBe(0);
  });

  it('does not repaint for a non-reagent pickup', () => {
    const { hud, setInventory } = makeHud(oneOfTwo());
    hud.refreshOpenCraftingIfReagentsChanged();
    setInventory([...oneOfTwo(), { itemId: NON_REAGENT, count: 1 }]);
    hud.refreshOpenCraftingIfReagentsChanged();
    expect(hud.renderCrafting).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Wiring. The three call sites live in code paths a unit test cannot execute
// (the per-frame update band, the online delta hook, the vendor closure), so
// they are pinned against comment-stripped source: prose alone must never
// satisfy a pin. Each pin is scoped to the REGION the call has to live in, so
// moving the code somewhere that changes its meaning reds the pin.
// ---------------------------------------------------------------------------

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const hud = stripComments(readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8'));

/** Source between two unique anchors, asserted to exist so a rename fails
 *  loudly here instead of silently slicing an empty (vacuously passing) span. */
function region(from: string, to: string): string {
  const start = hud.indexOf(from);
  expect(start, `anchor not found: ${from}`).toBeGreaterThan(-1);
  const end = hud.indexOf(to, start + from.length);
  expect(end, `anchor not found after ${from}: ${to}`).toBeGreaterThan(start);
  return hud.slice(start, end);
}

describe('crafting window bag-freshness wiring (source pins)', () => {
  it('renderCrafting re-arms the latch on EVERY paint, whatever caused it', () => {
    // Scoped to the method: moving the latch into the probe would leave every
    // other paint cause (the station edge, a craft, a tab switch, the open
    // itself) un-armed, and a whole-file pin would not notice.
    const renderCrafting = region(
      'private renderCrafting(focusReturnRecipeId = ',
      'closeCrafting(): void {',
    );
    expect(renderCrafting).toContain(
      'this.lastCraftingReagentSig = craftingReagentSig(this.sim.inventory, this.sim.player.name);',
    );
  });

  it('the slow band converges an open window in BOTH hosts', () => {
    // Anchored INSIDE the `if (slowHud)` guard: hoisted above it, the probe
    // would sweep the whole bag every frame with the window open.
    const slowBand = region('if (slowHud) {', 'this.playerFramePainter');
    expect(slowBand).toContain('this.refreshOpenCraftingIfReagentsChanged();');
    const perFrame = region('const slowHud =', 'if (slowHud) {');
    expect(perFrame).not.toContain('refreshOpenCraftingIfReagentsChanged');
  });

  it('keeps the station-range edge it is layered on top of', () => {
    // The two staleness edges are independent. Pin the station COMPARISON, not
    // the re-arm assignment: deleting the slow-band station block on the
    // theory that the bag edge now covers staleness would otherwise stay green
    // while walking into forge range stopped enabling station-bound rows.
    const slowBand = region('if (slowHud) {', 'this.playerFramePainter');
    expect(slowBand).toContain('!== this.lastCraftingStationSig');
    expect(slowBand).toContain('this.renderCrafting();');
  });

  it('the online authoritative inventory delta converges it on the same frame', () => {
    // Bounded at the METHOD's own two-space closing brace rather than a flat
    // [^}]* reach from the opener (#2931 made that break this pin once) or
    // the next definition (whose gap a future method could squat in): inner
    // blocks close at deeper indents, so the slice is exactly the hook body.
    const arm = region('onInventoryChanged(): void {', '\n  }');
    expect(arm).toContain('this.refreshOpenCraftingIfReagentsChanged();');
  });

  it('the offline vendor buy converges it on the click', () => {
    expect(hud).toMatch(
      /const buyAndRefresh = \(buy: \(\) => void\) => \{[^}]*this\.refreshOpenCraftingIfReagentsChanged\(\);\s*\};/,
    );
  });
});

// ---------------------------------------------------------------------------
// The painter. The window now repaints from causes the player did not
// initiate, so a rebuild must not move what they are looking at.
// ---------------------------------------------------------------------------

function craftingDeps() {
  return {
    hideTooltip: vi.fn(),
    onCraft: vi.fn(),
    onClose: vi.fn(),
    onOpenOrders: vi.fn(),
    itemIcon: vi.fn(() => ''),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
    commissionChecked: vi.fn((_recipeId: string) => false),
    onToggleCommission: vi.fn(),
    craftQty: () => 1,
    onCraftQty: vi.fn(),
    announce: vi.fn(),
    selectedCraft: () => null as string | null,
    onSelectCraft: vi.fn(),
  };
}

function paint(el: HTMLElement, inventory: InvSlot[]): void {
  renderCraftingWindow(
    el,
    buildCraftingView([STEW], inventory, ITEMS, {}, undefined, undefined, VIEWER),
    craftingDeps(),
  );
}

const BOTH_REAGENTS: InvSlot[] = [
  { itemId: REAGENT_A, count: 3 },
  { itemId: REAGENT_B, count: 3 },
];

describe('the fine-substitution suffix renders on BOTH claimed surfaces', () => {
  it('paints the suffix span and folds the same text into the row aria name', () => {
    // The phase 14 QA: the visible-line-AND-aria-fold claim had zero
    // rendered arms (only the view's number was pinned). Base copper is
    // absent and one fine copy covers the bill, so the reagent row must
    // carry the suffix in the .crafting-fine-sub span and in the row's
    // composed aria name.
    const el = document.createElement('div');
    document.body.appendChild(el);
    paint(el, [
      { itemId: 'fine_copper_ore', count: 1 },
      { itemId: REAGENT_B, count: 1 },
    ]);
    const sub = el.querySelector('.crafting-fine-sub');
    expect(sub?.textContent?.trim()).toBe('(spends 1 fine-grade)');
    expect(el.querySelector('[aria-label*="spends 1 fine-grade"]')).not.toBeNull();
    el.remove();
  });
});

describe('crafting window repaint preserves the player position', () => {
  it('keeps the tab strip scrolled where the player left it', () => {
    // The strip is its own horizontal scroller on mobile, so a repaint that
    // reset it would scroll the craft the player is reading off the screen
    // (visible in the mobile before/after capture for this issue).
    const el = document.createElement('div');
    document.body.appendChild(el);
    paint(el, BOTH_REAGENTS);
    const strip = el.querySelector('.crafting-tabs') as HTMLElement | null;
    expect(strip).not.toBeNull();
    (strip as HTMLElement).scrollLeft = 120;

    paint(el, [
      { itemId: REAGENT_A, count: 2 },
      { itemId: REAGENT_B, count: 2 },
    ]);
    const fresh = el.querySelector('.crafting-tabs') as HTMLElement;
    expect(fresh).not.toBe(strip); // rebuilt, not reused
    expect(fresh.scrollLeft).toBe(120);
    el.remove();
  });

  it('keeps the recipe list scrolled where the player left it', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    paint(el, BOTH_REAGENTS);
    (el.querySelector('.crafting-body') as HTMLElement).scrollTop = 64;

    paint(el, [
      { itemId: REAGENT_A, count: 2 },
      { itemId: REAGENT_B, count: 2 },
    ]);
    expect((el.querySelector('.crafting-body') as HTMLElement).scrollTop).toBe(64);
    el.remove();
  });
});
