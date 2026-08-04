// @vitest-environment jsdom
// The instanced-slot bag marker (Professions 2.0): drives the real
// BagsWindow painter against a jsdom container (the vendor_window_painter
// idiom) and pins the corner treatment on the CELL itself. Exactly ONE marker
// renders per stack, chosen by bag_instance_glyph_view.ts's kind priority: a
// masterwork keeps the authored .bi-masterwork-seal, an enchanted / signed /
// bound copy each gets its own .bi-glyph-<kind>, an instanced payload matching
// none of those keeps the generic .bi-instance tab, and a plain stack renders
// nothing. Every treatment composes with the count badge, the markup is static
// (no hover, no graphics-tier gate), and the stylesheet contract is pinned
// separately below.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { bagInstanceGlyphKind } from '../src/ui/bag_instance_glyph_view';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

function fakeWorld(inventory: InvSlot[]): IWorld {
  return {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
  } as unknown as IWorld;
}

function windowFor(inventory: InvSlot[]): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: BagsWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => fakeWorld(inventory),
    wocBalanceHtml: () => '',
    claudiumLauncherHtml: () => '',
    openClaudium: noop,
    openWallet: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    cancelPetFeed: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    renderCharIfOpen: noop,
    vendorOpen: () => false,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => false,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: noop,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: noop,
    setPendingPetFeed: noop,
    resetPetBarSig: noop,
    isHotbarItemId: () => false,
    // Gathering-tool bag use (#2343): never consumes the click in this fixture.
    useGatherTool: () => false,
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => false,
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
  };
  new BagsWindow(deps).render();
  return root;
}

describe('bag_instance_glyph_view: kind priority', () => {
  it('resolves each single marker to its own kind', () => {
    expect(bagInstanceGlyphKind({ rolled: { masterwork: true, stats: { str: 1 } } })).toBe(
      'masterwork',
    );
    expect(bagInstanceGlyphKind({ enchant: 'enchant_chest_stamina' })).toBe('enchanted');
    expect(bagInstanceGlyphKind({ signer: 'Anna' })).toBe('signed');
    expect(bagInstanceGlyphKind({ bindOnTrade: true })).toBe('bound');
    expect(bagInstanceGlyphKind({ boundTo: 7 })).toBe('bound');
  });

  it('a plain fungible stack has no glyph at all', () => {
    expect(bagInstanceGlyphKind(undefined)).toBeNull();
  });

  it('an instanced payload matching no named kind keeps the generic tab', () => {
    expect(bagInstanceGlyphKind({ bindOnTrade: false })).toBe('generic');
  });

  it('a legacy enchanted copy (bare rolled.stats, no marker) reads as enchanted', () => {
    expect(bagInstanceGlyphKind({ rolled: { stats: { int: 3 } } })).toBe('enchanted');
  });

  // A single copy can carry several markers at once, so the priority has to be
  // pinned pair by pair, not just per single marker.
  it('masterwork outranks every other marker on the same copy', () => {
    expect(
      bagInstanceGlyphKind({
        signer: 'Anna',
        enchant: 'enchant_chest_stamina',
        bindOnTrade: true,
        rolled: { masterwork: true, stats: { sta: 4 } },
      }),
    ).toBe('masterwork');
  });

  it('enchanted outranks signed, and signed outranks bound', () => {
    expect(bagInstanceGlyphKind({ signer: 'Anna', enchant: 'enchant_chest_stamina' })).toBe(
      'enchanted',
    );
    expect(bagInstanceGlyphKind({ signer: 'Anna', bindOnTrade: true })).toBe('signed');
    expect(bagInstanceGlyphKind({ enchant: 'enchant_chest_stamina', bindOnTrade: true })).toBe(
      'enchanted',
    );
  });
});

describe('bags grid instanced-slot marker', () => {
  it('a signed slot renders the maker glyph; a plain slot renders no marker', () => {
    const root = windowFor([
      { itemId: 'copper_ore', count: 1, instance: { signer: 'Anna' } },
      { itemId: 'copper_ore', count: 1 },
    ]);
    const cells = root.querySelectorAll('button.bag-item');
    expect(cells.length).toBe(2);
    expect(cells[0].querySelector('.bi-glyph-signed')).not.toBeNull();
    expect(cells[1].querySelector('.bi-glyph')).toBeNull();
    expect(cells[1].querySelector('.bi-instance')).toBeNull();
    // The marker is decorative for AT (the long-press/hover tooltip stays the
    // detail surface), so it must not add a phantom accessible node.
    expect(cells[0].querySelector('.bi-glyph')?.getAttribute('aria-hidden')).toBe('true');
    // The per-copy flag the aria-hidden glyph shows sighted players rides the
    // CELL's accessible name instead (the review's a11y arm): the instanced
    // cell uses the maker-marked label, the plain cell keeps the pre-12d one.
    expect(cells[0].getAttribute('aria-label')).toContain('maker-marked copy');
    expect(cells[1].getAttribute('aria-label')).not.toContain('maker-marked copy');
  });

  it('every glyph kind gives the CELL its own accessible name, never one label for all', () => {
    // The glyph is aria-hidden, so the cell name is the only channel AT gets:
    // three distinguishable glyphs must not collapse into one wording.
    const root = windowFor([
      { itemId: 'copper_ore', count: 1, instance: { enchant: 'enchant_chest_stamina' } },
      { itemId: 'copper_ore', count: 1, instance: { signer: 'Anna' } },
      { itemId: 'copper_ore', count: 1, instance: { bindOnTrade: true } },
      {
        itemId: 'copper_ore',
        count: 1,
        instance: { rolled: { masterwork: true, stats: { sta: 1 } } },
      },
      { itemId: 'copper_ore', count: 1 },
    ]);
    const names = [...root.querySelectorAll('button.bag-item')].map((c) =>
      c.getAttribute('aria-label'),
    );
    expect(names[0]).toBe('Copper Ore, quantity 1, enchanted copy');
    expect(names[1]).toBe('Copper Ore, quantity 1, maker-marked copy');
    expect(names[2]).toBe('Copper Ore, quantity 1, bound copy');
    expect(names[3]).toBe('Copper Ore, quantity 1, masterwork');
    expect(names[4]).toBe('Copper Ore, quantity 1');
    // The four marked kinds are all distinct from each other.
    expect(new Set(names.slice(0, 4)).size).toBe(4);
  });

  it('each kind paints its own distinct glyph, exactly one per cell', () => {
    const root = windowFor([
      { itemId: 'copper_ore', count: 1, instance: { enchant: 'enchant_chest_stamina' } },
      { itemId: 'copper_ore', count: 1, instance: { signer: 'Anna' } },
      { itemId: 'copper_ore', count: 1, instance: { bindOnTrade: true } },
      { itemId: 'copper_ore', count: 1, instance: { bindOnTrade: false } },
    ]);
    const cells = root.querySelectorAll('button.bag-item');
    expect(cells.length).toBe(4);
    expect(cells[0].querySelector('.bi-glyph-enchanted')).not.toBeNull();
    expect(cells[1].querySelector('.bi-glyph-signed')).not.toBeNull();
    expect(cells[2].querySelector('.bi-glyph-bound')).not.toBeNull();
    // The unclassified payload keeps the pre-existing generic wedge.
    expect(cells[3].querySelector('.bi-glyph')).toBeNull();
    expect(cells[3].querySelector('.bi-instance')).not.toBeNull();
    for (const cell of cells) {
      const markers = cell.querySelectorAll('.bi-glyph, .bi-instance, .bi-masterwork-seal');
      expect(markers.length).toBe(1);
    }
    // The three glyphs are genuinely different art, not one shape recolored.
    const svg = (i: number) => cells[i].querySelector('.bi-glyph svg')?.innerHTML ?? '';
    expect(new Set([svg(0), svg(1), svg(2)]).size).toBe(3);
    expect(svg(0)).not.toBe('');
  });

  it('a counted instanced stack renders the glyph AND the standard count badge', () => {
    const root = windowFor([{ itemId: 'copper_ore', count: 3, instance: { signer: 'Anna' } }]);
    const cell = root.querySelector('button.bag-item');
    expect(cell).not.toBeNull();
    expect(cell?.querySelector('.bi-glyph-signed')).not.toBeNull();
    expect(cell?.querySelector('.bi-count')?.textContent).toContain('3');
  });

  it('a masterwork uses the authored seal instead of the generic marker, never both', () => {
    const root = windowFor([
      {
        itemId: 'copper_ore',
        count: 1,
        instance: { signer: 'Anna', rolled: { masterwork: true, stats: { sta: 1 } } },
      },
    ]);
    const cell = root.querySelector('button.bag-item');
    const seal = cell?.querySelector<HTMLImageElement>('.bi-masterwork-seal');
    expect(seal?.getAttribute('src')).toBe('/ui/professions/masterwork_seal.webp');
    expect(seal?.getAttribute('alt')).toBe('');
    expect(seal?.getAttribute('aria-hidden')).toBe('true');
    expect(seal?.draggable).toBe(false);
    expect(cell?.querySelector('.bi-instance')).toBeNull();
    expect(cell?.querySelector('.bi-glyph')).toBeNull();
    expect(cell?.getAttribute('aria-label')).toBe('Copper Ore, quantity 1, masterwork');
    expect(cell?.getAttribute('aria-label')).not.toContain('maker-marked copy');
  });

  it('a counted masterwork keeps its count badge without restoring the generic marker', () => {
    const root = windowFor([
      {
        itemId: 'copper_ore',
        count: 2,
        instance: { rolled: { masterwork: true, stats: { sta: 1 } } },
      },
    ]);
    const cell = root.querySelector('button.bag-item');
    expect(cell?.querySelector('.bi-masterwork-seal')).not.toBeNull();
    expect(cell?.querySelector('.bi-instance')).toBeNull();
    expect(cell?.querySelector('.bi-glyph')).toBeNull();
    expect(cell?.querySelector('.bi-count')?.textContent).toContain('2');
  });

  it('a plain counted stack keeps the count badge and no marker', () => {
    const root = windowFor([{ itemId: 'copper_ore', count: 5 }]);
    const cell = root.querySelector('button.bag-item');
    expect(cell?.querySelector('.bi-count')?.textContent).toContain('5');
    expect(cell?.querySelector('.bi-instance')).toBeNull();
    expect(cell?.querySelector('.bi-glyph')).toBeNull();
  });
});

describe('marker stylesheet contract (source pins)', () => {
  // jsdom gives import.meta.url an http URL, which readFileSync(new URL(...))
  // rejects (the vendor_window_painter precedent): resolve from __dirname.
  const components = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');
  const start = components.indexOf('.bag-item .bi-instance');
  const block = components.slice(start, components.indexOf('}', start));
  const sealStart = components.indexOf('.bag-item .bi-masterwork-seal');
  const sealBlock = components.slice(sealStart, components.indexOf('}', sealStart));

  it('is styled once, from a static color token, never an --fx-* tier knob', () => {
    expect(start).toBeGreaterThan(-1);
    expect(components.indexOf('.bag-item .bi-instance', start + 1)).toBe(-1);
    expect(block).toContain('var(--color-accent)');
    expect(block).not.toContain('--fx-');
    // Always-on visibility: the marker never hides behind hover or media state.
    expect(components).not.toContain('.bag-item:hover .bi-instance');
  });

  it('keeps the authored masterwork seal a static 16px corner overlay', () => {
    expect(sealStart).toBeGreaterThan(-1);
    expect(components.indexOf('.bag-item .bi-masterwork-seal', sealStart + 1)).toBe(-1);
    expect(sealBlock).toContain('width: 16px');
    expect(sealBlock).toContain('height: 16px');
    expect(sealBlock).toContain('object-fit: contain');
    expect(sealBlock).not.toContain('--fx-');
    expect(components).not.toContain('.bag-item:hover .bi-masterwork-seal');
  });

  it('the per-kind glyphs share the same always-on, preset-independent contract', () => {
    const glyphStart = components.indexOf('.bag-item .bi-glyph {');
    expect(glyphStart).toBeGreaterThan(-1);
    const glyphBlock = components.slice(glyphStart, components.indexOf('}', glyphStart));
    expect(glyphBlock).toContain('position: absolute');
    expect(glyphBlock).toContain('top: 1px');
    expect(glyphBlock).toContain('left: 1px');
    // No graphics-tier gate and no hover reveal: the glyph is information-add
    // and must render identically on every preset (fairness).
    expect(glyphBlock).not.toContain('--fx-');
    expect(components).not.toContain('.bag-item:hover .bi-glyph');
    // Each kind's tint comes from a token, never a literal in CSS or the painter.
    const tokens = readFileSync(join(__dirname, '../src/styles/tokens.css'), 'utf8');
    for (const kind of ['enchanted', 'signed', 'bound']) {
      const rule = `.bag-item .bi-glyph-${kind}`;
      const at = components.indexOf(rule);
      expect(at, `${rule} styled`).toBeGreaterThan(-1);
      expect(components.slice(at, components.indexOf('}', at))).toContain(
        `var(--color-bag-glyph-${kind})`,
      );
      expect(tokens, `--color-bag-glyph-${kind} token`).toContain(`--color-bag-glyph-${kind}:`);
    }
    // The painter carries no inline color for the glyphs.
    const painter = readFileSync(join(__dirname, '../src/ui/bags_window.ts'), 'utf8');
    expect(painter).not.toContain('bi-glyph" style=');
  });
});
