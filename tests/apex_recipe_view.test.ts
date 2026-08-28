// @vitest-environment happy-dom
//
// Deliverable C of Masterwrought phase 14: the apex-recipe surfacing in the
// crafting window. The pure half (apex_recipe_view.ts) decides membership and
// the content-derived pattern-provenance channel; the painter half renders
// the restrained chip, the provenance line, the title-bar Perfecting entry
// and the per-row Perfecting link. Every decision is proven against REAL
// content (the R8 channel doctrine's own tables), and every affordance
// renders only on rows the viewer already sees (the known-recipes ruling:
// nothing here can reveal an unlearned recipe, because the painter only ever
// decorates rows the view already built).

import { describe, expect, it, vi } from 'vitest';
import {
  APEX_ARMOR_RECIPES,
  APEX_CONSUMABLE_RECIPES,
  APEX_GEAR_RECIPES,
  ROD_RECIPES,
} from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import {
  APEX_TIER_SKILL_REQ,
  apexPatternChannel,
  apexRecipePresentation,
} from '../src/ui/hud/professions/apex_recipe_view';
import { buildCraftingView } from '../src/ui/hud/professions/crafting_view';
import { renderCraftingWindow } from '../src/ui/hud/professions/crafting_window';

const GEAR = APEX_GEAR_RECIPES[0]; // raid channel by the R8 doctrine
const ARMOR = APEX_ARMOR_RECIPES[0]; // rift channel
const CONSUMABLE = APEX_CONSUMABLE_RECIPES[0]; // quartermaster channel

describe('apexRecipePresentation (content-derived, never invented)', () => {
  it('classifies the three R8 channels off their own tables', () => {
    expect(apexPatternChannel(GEAR.id)).toBe('raid');
    expect(apexPatternChannel(ARMOR.id)).toBe('rift');
    expect(apexPatternChannel(CONSUMABLE.id)).toBe('vendor');
  });

  it('marks the Perfecting track only for masterwrought outputs', () => {
    const gear = apexRecipePresentation(GEAR.id, GEAR.resultItemId, GEAR.skillReq);
    expect(gear).toEqual({ apex: true, perfectingTrack: true, channel: 'raid' });
    // Apex armor is masterwrought-flagged content too, so it earns the link
    // as well; its pattern channel is the rift per the R8 doctrine.
    const armor = apexRecipePresentation(ARMOR.id, ARMOR.resultItemId, ARMOR.skillReq);
    expect(armor).toEqual({ apex: true, perfectingTrack: true, channel: 'rift' });
    // The consumable rung is on the apex tier without a Perfecting-track
    // output (a flask is never a masterwrought piece).
    const flask = apexRecipePresentation(
      CONSUMABLE.id,
      CONSUMABLE.resultItemId,
      CONSUMABLE.skillReq,
    );
    expect(flask.apex).toBe(true);
    expect(flask.perfectingTrack).toBe(false);
    expect(flask.channel).toBe('vendor');
  });

  it('an ordinary trainer recipe is neither apex nor hinted', () => {
    const plain = apexRecipePresentation('recipe_minor_healing_potion', 'minor_healing_potion', 1);
    expect(plain).toEqual({ apex: false, perfectingTrack: false, channel: null });
    expect(ITEMS.minor_healing_potion.masterwrought).toBeUndefined();
  });

  it('the apex floor matches the authored tier', () => {
    expect(GEAR.skillReq).toBe(APEX_TIER_SKILL_REQ);
  });

  it('the rod membership arm fires on its own (the defense-in-depth disjunct, pinned direct)', () => {
    // The live caller always passes the recipe's own skillReq, which for
    // every apex rod already clears the tier floor, so through the wrapper
    // this disjunct can never decide the outcome (the same-predicate class).
    // Pin it DIRECTLY at a sub-tier skillReq so deleting the arm reds: it is
    // the guard for a future caller that resolves skillReq differently (a
    // discounted or scaled rung).
    const apexRod = ROD_RECIPES.find((r) => r.skillReq >= APEX_TIER_SKILL_REQ);
    expect(apexRod).toBeDefined();
    const viaRodSet = apexRecipePresentation(apexRod!.id, apexRod!.resultItemId, 1);
    expect(viaRodSet.apex).toBe(true);
    // And the set really is selective: a sub-tier rod stays plain.
    const plainRod = ROD_RECIPES.find((r) => r.skillReq < APEX_TIER_SKILL_REQ);
    if (plainRod) {
      expect(apexRecipePresentation(plainRod.id, plainRod.resultItemId, 1).apex).toBe(false);
    }
  });
});

function deps(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function paint(recipes: (typeof GEAR)[], overrides: Record<string, unknown> = {}): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  renderCraftingWindow(el, buildCraftingView(recipes, [], ITEMS), deps(overrides));
  return el;
}

describe('the painter affordances', () => {
  it('the title-bar Perfecting entry renders beside the orders button when wired', () => {
    const onOpenPerfecting = vi.fn();
    const el = paint([GEAR], { onOpenPerfecting });
    const btn = el.querySelector('[data-open-perfecting]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.previousElementSibling?.id).toBe(
      (el.querySelector('.panel-title > span') as HTMLElement).id,
    );
    expect(el.querySelector('[data-open-orders]')).not.toBeNull();
    btn.click();
    expect(onOpenPerfecting).toHaveBeenCalledTimes(1);
  });

  it('an unwired composition renders neither perfecting affordance', () => {
    const el = paint([GEAR]);
    expect(el.querySelector('[data-open-perfecting]')).toBeNull();
    expect(el.querySelector('.crafting-perfecting-link')).toBeNull();
  });

  it('an apex GEAR row carries the chip, the raid provenance line, and the link', () => {
    const onOpenPerfecting = vi.fn();
    const el = paint([GEAR], { onOpenPerfecting });
    expect((el.querySelector('.crafting-apex-chip') as HTMLElement).textContent).toBe('Apex');
    expect((el.querySelector('.crafting-apex-line') as HTMLElement).textContent).toContain('raid');
    expect(el.querySelector('.crafting-recipe-socket.apex')).not.toBeNull();
    const link = el.querySelector('.crafting-perfecting-link') as HTMLButtonElement;
    // Outside the craft button (nested-interactive is the axe violation).
    expect(link.closest('.crafting-recipe-btn')).toBeNull();
    // WCAG 2.5.3: the accessible name contains the visible label. The
    // truthiness guard keeps the containment check from passing vacuously
    // over an empty label (''.includes('') is true).
    expect(link.textContent).toBeTruthy();
    expect(link.getAttribute('aria-label')).toContain(link.textContent);
    link.click();
    expect(onOpenPerfecting).toHaveBeenCalledTimes(1);
  });

  it('an apex ARMOR row renders the rift provenance line (the third channel at the painter)', () => {
    // raid and vendor each had a painter case; a broken rift line-key
    // mapping surfaced only in the pure-core test until this arm.
    const el = paint([ARMOR], { onOpenPerfecting: vi.fn() });
    expect((el.querySelector('.crafting-apex-line') as HTMLElement).textContent).toMatch(/rift/i);
  });

  it('an apex non-gear row hints its channel but never links to Perfecting', () => {
    const el = paint([CONSUMABLE], { onOpenPerfecting: vi.fn() });
    expect(el.querySelector('.crafting-apex-chip')).not.toBeNull();
    expect((el.querySelector('.crafting-apex-line') as HTMLElement).textContent).toContain(
      'Quartermaster',
    );
    expect(el.querySelector('.crafting-perfecting-link')).toBeNull();
  });

  it('an ordinary row renders none of the apex treatment', () => {
    const plain = { ...GEAR, id: 'qa_plain', resultItemId: 'minor_healing_potion', skillReq: 1 };
    const el = paint([plain], { onOpenPerfecting: vi.fn() });
    expect(el.querySelector('.crafting-apex-chip')).toBeNull();
    expect(el.querySelector('.crafting-apex-line')).toBeNull();
    expect(el.querySelector('.crafting-perfecting-link')).toBeNull();
  });
});
