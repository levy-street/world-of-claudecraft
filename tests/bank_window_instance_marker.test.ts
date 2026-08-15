// @vitest-environment happy-dom
//
// Bank grid instanced-slot markers (Professions 2.0): a banked masterwork must
// keep the authored seal, and every other per-copy kind (enchanted / signed /
// bound / generic) must paint the same corner mark bags use. Drives the real
// BankWindow painter against a stubbed IWorld bank mirror (the bank_window_search_reset
// harness idiom). CSS coverage for bank-item shares the bags stylesheet pins.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InvSlot, ItemInstancePayload } from '../src/sim/types';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import type { BankInfo, IWorld } from '../src/world_api';

function bankInfo(slots: InvSlot[], capacity = 12): BankInfo {
  return {
    slots,
    capacity,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 1000,
    bonusSources: [],
  };
}

interface HarnessWorld {
  bankInfo: BankInfo | null;
  inventory: InvSlot[];
  bankDeposit(): void;
  bankWithdraw(): void;
  bankBuySlots(): void;
}

function windowFor(slots: InvSlot[]): HTMLElement {
  const world: HarnessWorld = {
    bankInfo: bankInfo(slots),
    inventory: [],
    bankDeposit: () => {},
    bankWithdraw: () => {},
    bankBuySlots: () => {},
  };
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: BankWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: noop,
    onClosed: noop,
    onInventoryChanged: noop,
  };
  const w = new BankWindow(deps);
  w.open();
  return root;
}

function slot(itemId: string, instance?: ItemInstancePayload, count = 1): InvSlot {
  return instance ? { itemId, count, instance } : { itemId, count };
}

describe('bank grid instanced-slot marker', () => {
  it('a masterwork uses the authored seal and announces masterwork', () => {
    const root = windowFor([
      slot('worn_sword', { signer: 'Anna', rolled: { masterwork: true, stats: { sta: 1 } } }),
      slot('worn_sword'),
    ]);
    const cells = root.querySelectorAll('button.bank-item');
    expect(cells.length).toBe(2);
    const seal = cells[0].querySelector<HTMLImageElement>('.bi-masterwork-seal');
    expect(seal?.getAttribute('src')).toBe('/ui/professions/masterwork_seal.webp');
    expect(seal?.getAttribute('alt')).toBe('');
    expect(seal?.getAttribute('aria-hidden')).toBe('true');
    // happy-dom may not surface the reflected .draggable boolean from
    // innerHTML; pin the attribute the painter wrote.
    expect(seal?.getAttribute('draggable')).toBe('false');
    expect(cells[0].querySelector('.bi-instance')).toBeNull();
    expect(cells[0].querySelector('.bi-glyph')).toBeNull();
    // Exact full string: the UNKNOWN key family shares the ', masterwork'
    // tail, so only the resolved display name plus the whole wording proves
    // the KNOWN family ran (a key-map swap in the painter cannot mint this).
    expect(cells[0].getAttribute('aria-label')).toBe('Pitted Shortsword, quantity 1, masterwork');
    // Plain sibling keeps no marker and the plain aria wording.
    expect(cells[1].querySelector('.bi-masterwork-seal')).toBeNull();
    expect(cells[1].querySelector('.bi-glyph')).toBeNull();
    expect(cells[1].querySelector('.bi-instance')).toBeNull();
    expect(cells[1].getAttribute('aria-label')).toBe('Pitted Shortsword, quantity 1');
  });

  it('each kind paints its own distinct glyph, exactly one per cell', () => {
    const root = windowFor([
      slot('copper_ore', { enchant: 'enchant_chest_stamina' }),
      slot('copper_ore', { signer: 'Anna' }),
      slot('copper_ore', { bindOnTrade: true }),
      slot('copper_ore', { bindOnTrade: false }),
      slot('copper_ore', { rolled: { masterwork: true, stats: { sta: 1 } } }),
    ]);
    const cells = root.querySelectorAll('button.bank-item');
    expect(cells.length).toBe(5);
    expect(cells[0].querySelector('.bi-glyph-enchanted')).not.toBeNull();
    expect(cells[1].querySelector('.bi-glyph-signed')).not.toBeNull();
    expect(cells[2].querySelector('.bi-glyph-bound')).not.toBeNull();
    expect(cells[3].querySelector('.bi-instance')).not.toBeNull();
    expect(cells[4].querySelector('.bi-masterwork-seal')).not.toBeNull();
    for (const cell of cells) {
      const markers = cell.querySelectorAll('.bi-glyph, .bi-instance, .bi-masterwork-seal');
      expect(markers.length).toBe(1);
    }
    // Exact strings, not regexes: the unknown-key siblings carry the same
    // per-kind tail wording, so only the full string (display name included)
    // proves the KNOWN family ran. signed and the generic fallback share the
    // maker-marked wording by design.
    const names = [...cells].map((c) => c.getAttribute('aria-label') ?? '');
    expect(names[0]).toBe('Copper Ore, quantity 1, enchanted copy');
    expect(names[1]).toBe('Copper Ore, quantity 1, maker-marked copy');
    expect(names[2]).toBe('Copper Ore, quantity 1, bound copy');
    expect(names[3]).toBe('Copper Ore, quantity 1, maker-marked copy');
    expect(names[4]).toBe('Copper Ore, quantity 1, masterwork');
  });

  it('an unknown-id instanced slot keeps the mark and the UNKNOWN aria wording', () => {
    // Stale-client guard (R34) meets the per-copy flag: the raw id is the only
    // handle the player has for an unknown stack, so the UNKNOWN wording keeps
    // it while the flag still announces. No key-family swap can mint this
    // exact string, which is what makes the assertion decisive.
    const root = windowFor([
      slot('not_a_real_item_id', { rolled: { masterwork: true, stats: { sta: 1 } } }),
    ]);
    const cell = root.querySelector('button.bank-item');
    expect(cell?.querySelector('.bi-masterwork-seal')).not.toBeNull();
    expect(cell?.getAttribute('aria-label')).toBe(
      'Unknown item not_a_real_item_id, quantity 1, masterwork',
    );
  });

  it('a counted masterwork keeps its count badge without restoring the generic marker', () => {
    const root = windowFor([
      slot('copper_ore', { rolled: { masterwork: true, stats: { sta: 1 } } }, 2),
    ]);
    const cell = root.querySelector('button.bank-item');
    expect(cell?.querySelector('.bi-masterwork-seal')).not.toBeNull();
    expect(cell?.querySelector('.bi-instance')).toBeNull();
    expect(cell?.querySelector('.bi-glyph')).toBeNull();
    expect(cell?.querySelector('.bank-count')?.textContent).toContain('2');
  });

  it('a plain counted stack keeps the count badge and no marker', () => {
    const root = windowFor([slot('copper_ore', undefined, 5)]);
    const cell = root.querySelector('button.bank-item');
    expect(cell?.querySelector('.bank-count')?.textContent).toContain('5');
    expect(cell?.querySelector('.bi-instance')).toBeNull();
    expect(cell?.querySelector('.bi-glyph')).toBeNull();
    expect(cell?.querySelector('.bi-masterwork-seal')).toBeNull();
  });
});

describe('bank grid fine-grade mark', () => {
  // The fine mark (rim/wash class + corner seal) followed the stack into the
  // bank: the grade is an item fact, not a bag fact, so depositing must not
  // strip it (the fix that extended the bags-only mark to both banks). The
  // on/off decision itself is pinned in bag_fine_mark_view.test.ts; these
  // cases pin the bank painter's composition of it.
  it('a banked fine material wears the rim class and the fine corner seal', () => {
    const root = windowFor([
      slot('fine_copper_ore', undefined, 3),
      slot('copper_ore', undefined, 3),
    ]);
    const cells = root.querySelectorAll('button.bank-item');
    expect(cells.length).toBe(2);
    expect(cells[0].classList.contains('bag-fine')).toBe(true);
    const seal = cells[0].querySelector('.bi-fine-seal');
    expect(seal).not.toBeNull();
    expect(seal?.getAttribute('aria-hidden')).toBe('true');
    // Exactly one corner treatment, and the quality class survives the rim.
    expect(
      cells[0].querySelectorAll(
        '.bi-glyph, .bi-instance, .bi-masterwork-seal, .bi-quest-seal, .bi-fine-seal',
      ).length,
    ).toBe(1);
    expect(cells[0].classList.contains('q-common')).toBe(true);
    // Aria stays the plain wording: the item NAME carries the grade word, so
    // no dedicated grade sentence exists (the bags decision, pinned here too).
    expect(cells[0].getAttribute('aria-label')).toBe('Fine Copper Ore, quantity 3');
    // The base-grade sibling gets neither the rim nor the seal.
    expect(cells[1].classList.contains('bag-fine')).toBe(false);
    expect(cells[1].querySelector('.bi-fine-seal')).toBeNull();
  });

  it('masterwork wins the corner over fine while the rim stays', () => {
    const root = windowFor([
      slot('fine_copper_ore', { rolled: { masterwork: true, stats: { sta: 1 } } }),
    ]);
    const cell = root.querySelector('button.bank-item');
    expect(cell?.classList.contains('bag-fine')).toBe(true);
    expect(cell?.querySelector('.bi-masterwork-seal')).not.toBeNull();
    expect(cell?.querySelector('.bi-fine-seal')).toBeNull();
  });

  it('fine outranks the per-copy glyphs in the corner, keeping the per-copy aria', () => {
    const root = windowFor([slot('fine_copper_ore', { signer: 'Anna' })]);
    const cell = root.querySelector('button.bank-item');
    expect(cell?.querySelector('.bi-fine-seal')).not.toBeNull();
    expect(cell?.querySelector('.bi-glyph')).toBeNull();
    expect(cell?.querySelector('.bi-instance')).toBeNull();
    expect(cell?.getAttribute('aria-label')).toBe('Fine Copper Ore, quantity 1, maker-marked copy');
  });

  it('an unknown id never composes the fine mark', () => {
    // A fine-looking id this bundle predates is not in the local grade table:
    // the stale-client cell stays unmarked instead of guessing a grade.
    const root = windowFor([slot('fine_unmapped_future_material')]);
    const cell = root.querySelector('button.bank-item');
    expect(cell?.classList.contains('bag-fine')).toBe(false);
    expect(cell?.querySelector('.bi-fine-seal')).toBeNull();
  });
});

describe('bank-item instance mark stylesheet contract', () => {
  const components = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');

  it('bank cells share the always-on masterwork seal and glyph rules with bags', () => {
    // Dual-selector rules keep one definition; bank never needs a hover reveal
    // or an --fx gate (fairness: the seal is information-add). No bags-only
    // fork: a solo `.bank-item .bi-masterwork-seal {` block would be a second
    // definition that can drift.
    expect(components).toMatch(
      /\.bag-item \.bi-masterwork-seal,\s*\.bank-item \.bi-masterwork-seal \{/,
    );
    // The glyph box is a wider family rule (the quest seal rides it bag-only,
    // the fine seal with its bank twin); the pin is each bank twin sitting
    // right beside its bag half.
    expect(components).toMatch(/\.bag-item \.bi-glyph,\s*\.bank-item \.bi-glyph,/);
    expect(components).toMatch(/\.bag-item \.bi-fine-seal,\s*\.bank-item \.bi-fine-seal \{/);
    expect(components).toMatch(/\.bag-item\.bag-fine,\s*\.bank-item\.bag-fine \{/);
    expect(components).toMatch(/\.bag-item \.bi-instance,\s*\.bank-item \.bi-instance \{/);
    expect(components).not.toContain('.bank-item:hover .bi-masterwork-seal');
    expect(components).not.toContain('.bank-item:hover .bi-glyph');
    // Tokenized per-kind tints ride the same bag tokens. Each rule is sliced
    // to its first closing brace before asserting the token, so the match
    // cannot drift across rule boundaries.
    for (const kind of ['enchanted', 'signed', 'bound']) {
      const start = components.indexOf(`.bag-item .bi-glyph-${kind},`);
      expect(start).toBeGreaterThan(-1);
      const rule = components.slice(start, components.indexOf('}', start));
      expect(rule).toContain(`.bank-item .bi-glyph-${kind}`);
      expect(rule).toContain(`var(--color-bag-glyph-${kind})`);
    }
  });

  it('the bank painter mints marks through the shared helper, not a private fork', () => {
    // Comment-stripped (the bank_window.test.ts idiom) so prose naming the
    // seal class can neither satisfy a positive pin nor false-fail a negative.
    const painter = readFileSync(join(__dirname, '../src/ui/bank_window.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(painter).toContain('cornerMarkHtml(cornerMark)');
    expect(painter).toContain('bagInstanceGlyphKind(slot.instance)');
    // The KNOWN key family must be used on its own: the lookbehind skips the
    // UNKNOWN_ sibling, whose name contains this one as a substring (a bare
    // contain could never fail while the import line exists).
    expect(painter).toMatch(/(?<!UNKNOWN_)INSTANCE_GLYPH_ARIA_KEYS\[glyphKind\]/);
    expect(painter).toContain('UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS[glyphKind]');
    // The fine mark composes through the same pure cores and shared mint bags
    // use: id-based decision, corner priority from bag_corner_mark_view, rim
    // class from bagRimClasses (quest arm pinned null: quest items cannot
    // enter the bank), markup from the one exhaustive cornerMarkHtml dispatch
    // pinned above (no fineSealMarkHtml or glyph call here: a painter that
    // re-derived the corner from the raw glyph kind is the drift this closes).
    expect(painter).toContain('bagFineMark(slot.itemId)');
    expect(painter).toContain('bagCornerMark(glyphKind, null, fineMark)');
    expect(painter).toContain('${bagRimClasses(null, fineMark)}');
    expect(painter).not.toContain('instanceGlyphMarkHtml');
    expect(painter).not.toContain('fineSealMarkHtml');
    // No private seal URL or class fork that could drift from bags.
    expect(painter).not.toContain('MASTERWORK_SEAL_IMAGE_URL');
    expect(painter).not.toContain('bi-masterwork-seal');
    expect(painter).not.toContain('bi-fine-seal');
  });
});
