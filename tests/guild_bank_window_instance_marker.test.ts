// @vitest-environment jsdom
//
// Guild-bank instanced-slot markers: a guild-banked masterwork must keep the
// authored seal and the other per-copy kinds must paint the same corner marks
// bags and the personal bank use (the shared item_instance_glyph_mark helper).
// Drives the REAL BankWindow with its composed GuildBankTab pane, the
// guild_bank_window.test.ts harness idiom. The guild-specific composition is
// what this suite exists for: the dormant lock mark coexisting with a corner
// mark while the dormant aria wording outranks the per-copy flag, and the
// unknown-id cell keeping the KNOWN key family with the localized label (the
// personal bank announces the raw id instead; that divergence is deliberate
// and pinned here so it cannot flip unnoticed).

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot, ItemInstancePayload } from '../src/sim/types';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import type { BankInfo, GuildBankInfo, GuildBankLogView, IWorld } from '../src/world_api';

// Real merged-table ids, derived so a content rename cannot rot this suite
// into the unknown-id path: a plain tradeable def and a soulbound def (the
// soulbound one is dormant in the guild bank, which is the composition case).
const plainId = Object.keys(ITEMS).find((id) => {
  const d = ITEMS[id];
  // Mirrors guildBankSlotDormant's def dimensions: all three must be absent or
  // the "plain" fixture would render dormant and the exact aria pins would lie.
  return !d.soulbound && !d.noMarketList && d.kind !== 'quest';
}) as string;
const soulboundId = Object.keys(ITEMS).find(
  (id) => ITEMS[id].soulbound && ITEMS[id].kind !== 'quest',
) as string;
const plainName = ITEMS[plainId].name;
const soulboundName = ITEMS[soulboundId].name;

const MASTERWORK: ItemInstancePayload = { rolled: { masterwork: true, stats: { sta: 1 } } };

function guildInfo(slots: InvSlot[]): GuildBankInfo {
  return {
    treasury: 60_000,
    slots,
    capacity: 12,
    purchasedSlots: 24,
    nextExpansionPrice: null,
    canEdit: true,
  };
}

function harness(slots: InvSlot[]): HTMLElement {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const root = document.createElement('div');
  root.id = 'bank-window';
  document.body.appendChild(root);
  const personal: BankInfo = {
    slots: [],
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    bonusSources: [],
  };
  const world = {
    bankInfo: personal,
    guildBankInfo: guildInfo(slots),
    inventory: [] as InvSlot[],
    copper: 5_000,
    logView: { state: 'loading', entries: [] } as GuildBankLogView,
    guildBankLog: () => world.logView,
    bankDeposit: () => {},
    bankWithdraw: () => {},
    bankBuySlots: () => {},
    guildBankDepositGold: () => {},
    guildBankWithdrawGold: () => {},
    guildBankDeposit: () => {},
    guildBankWithdraw: () => {},
    guildBankBuySlots: () => {},
  };
  const noop = (): void => {};
  const deps: BankWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: (c: number) => `<span class="money-inline">${c}</span>`,
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
  (root.querySelector('.bank-tab[data-tab="guild"]') as HTMLElement).click();
  return root;
}

const cellsOf = (root: HTMLElement) =>
  root.querySelectorAll<HTMLElement>('.bank-grid .bank-item:not(.empty)');

beforeEach(() => {
  localStorage.clear();
});

describe('guild bank grid instanced-slot marker', () => {
  it('a masterwork uses the authored seal and announces masterwork', () => {
    const root = harness([
      { itemId: plainId, count: 1, instance: MASTERWORK },
      { itemId: plainId, count: 1 },
    ]);
    const cells = cellsOf(root);
    expect(cells.length).toBe(2);
    const seal = cells[0].querySelector<HTMLImageElement>('.bi-masterwork-seal');
    expect(seal?.getAttribute('src')).toBe('/ui/professions/masterwork_seal.webp');
    expect(seal?.getAttribute('aria-hidden')).toBe('true');
    // Exact full string: the template wording is pinned around the derived
    // def name, so a key-family swap or a template reword goes red.
    expect(cells[0].getAttribute('aria-label')).toBe(`${plainName}, quantity 1, masterwork`);
    // Plain sibling keeps no marker and the plain aria wording.
    expect(cells[1].querySelector('.bi-masterwork-seal')).toBeNull();
    expect(cells[1].querySelector('.bi-glyph')).toBeNull();
    expect(cells[1].querySelector('.bi-instance')).toBeNull();
    expect(cells[1].getAttribute('aria-label')).toBe(`${plainName}, quantity 1`);
  });

  it('a signed copy paints the signed glyph with the maker-marked wording', () => {
    const root = harness([{ itemId: plainId, count: 1, instance: { signer: 'Anna' } }]);
    const cell = cellsOf(root)[0];
    expect(cell.querySelector('.bi-glyph-signed')).not.toBeNull();
    expect(cell.querySelectorAll('.bi-glyph, .bi-instance, .bi-masterwork-seal').length).toBe(1);
    expect(cell.getAttribute('aria-label')).toBe(`${plainName}, quantity 1, maker-marked copy`);
  });

  it('dormant outranks the per-copy flag while both marks coexist', () => {
    // A soulbound def is dormant (pipe-refused) in the guild bank; give it a
    // masterwork payload so the aria branch has to CHOOSE. The lock is the
    // action fact, so the dormant wording wins, but the seal still paints
    // (top-left) beside the lock mark (top-right).
    const root = harness([{ itemId: soulboundId, count: 1, instance: MASTERWORK }]);
    const cell = cellsOf(root)[0];
    expect(cell.classList.contains('gbank-dormant')).toBe(true);
    expect(cell.querySelector('.gbank-dormant-mark')).not.toBeNull();
    expect(cell.querySelector('.bi-masterwork-seal')).not.toBeNull();
    expect(cell.getAttribute('aria-label')).toBe(
      `${soulboundName}, quantity 1, cannot be withdrawn`,
    );
    expect(cell.getAttribute('aria-label')).not.toContain('masterwork');
  });

  it('an unknown-id instanced slot keeps the mark and the localized label wording', () => {
    // The guild pane deliberately stays on the KNOWN key family here: the
    // label already carries the unknown fact and the raw id lives in the
    // tooltip, where the personal bank announces the raw id instead. This
    // exact string is the pin that keeps the divergence a decision.
    const root = harness([{ itemId: 'zz_removed_item', count: 1, instance: MASTERWORK }]);
    const cell = cellsOf(root)[0];
    expect(cell.classList.contains('gbank-unknown')).toBe(true);
    expect(cell.querySelector('.bi-masterwork-seal')).not.toBeNull();
    expect(cell.getAttribute('aria-label')).toBe('Unknown item, quantity 1, masterwork');
  });

  it('a guild-banked fine material wears the rim class and the fine corner seal', () => {
    // The grade is an item fact, not a bag fact: depositing into the guild
    // bank must not strip the mark bags painted (the fix that extended the
    // bags-only fine mark to both banks). Fine ids are tradeable common
    // reagents, so the fixture is never dormant and the plain aria pin holds.
    const root = harness([
      { itemId: 'fine_copper_ore', count: 2 },
      { itemId: 'copper_ore', count: 2 },
    ]);
    const cells = cellsOf(root);
    expect(cells.length).toBe(2);
    expect(cells[0].classList.contains('bag-fine')).toBe(true);
    const seal = cells[0].querySelector('.bi-fine-seal');
    expect(seal).not.toBeNull();
    expect(seal?.getAttribute('aria-hidden')).toBe('true');
    // Aria stays the plain wording: the item NAME carries the grade word.
    expect(cells[0].getAttribute('aria-label')).toBe('Fine Copper Ore, quantity 2');
    // The base-grade sibling gets neither the rim nor the seal.
    expect(cells[1].classList.contains('bag-fine')).toBe(false);
    expect(cells[1].querySelector('.bi-fine-seal')).toBeNull();
  });

  it('masterwork wins the corner over fine in the guild grid while the rim stays', () => {
    const root = harness([{ itemId: 'fine_copper_ore', count: 1, instance: MASTERWORK }]);
    const cell = cellsOf(root)[0];
    expect(cell.classList.contains('bag-fine')).toBe(true);
    expect(cell.querySelector('.bi-masterwork-seal')).not.toBeNull();
    expect(cell.querySelector('.bi-fine-seal')).toBeNull();
    expect(
      cell.querySelectorAll('.bi-glyph, .bi-instance, .bi-masterwork-seal, .bi-fine-seal').length,
    ).toBe(1);
  });

  it('an unknown fine-looking id never composes the fine mark', () => {
    // Not in the local grade table means no grade guess: the removed-def cell
    // keeps its unknown styling with no rim and no seal.
    const root = harness([{ itemId: 'fine_unmapped_future_material', count: 1 }]);
    const cell = cellsOf(root)[0];
    expect(cell.classList.contains('gbank-unknown')).toBe(true);
    expect(cell.classList.contains('bag-fine')).toBe(false);
    expect(cell.querySelector('.bi-fine-seal')).toBeNull();
  });
});

describe('guild bank painter mark contract (source pins)', () => {
  it('mints marks through the shared helper, not a private fork', () => {
    // Comment-stripped so prose naming the seal class can neither satisfy a
    // positive pin nor false-fail a negative.
    const painter = readFileSync('src/ui/guild_bank_window.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(painter).toContain('cornerMarkHtml(cornerMark)');
    expect(painter).toContain('bagInstanceGlyphKind(slot.instance)');
    expect(painter).toMatch(/(?<!UNKNOWN_)INSTANCE_GLYPH_ARIA_KEYS\[glyphKind\]/);
    // The guild pane never uses the UNKNOWN_ key family (see the aria case
    // above); a switch to it must be a deliberate edit, not drift.
    expect(painter).not.toContain('UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS');
    // The fine mark composes through the same pure cores and the one
    // exhaustive cornerMarkHtml dispatch the bags and personal-bank painters
    // use (quest arm pinned null: quest items cannot enter the guild bank).
    // Both arms of the known/unknown branch emit the rim through
    // bagRimClasses, so the seal and rim can never split across the branch.
    expect(painter).toContain('bagFineMark(slot.itemId)');
    expect(painter).toContain('bagCornerMark(glyphKind, null, fineMark)');
    expect(painter.split('${bagRimClasses(null, fineMark)}').length).toBe(3);
    expect(painter).not.toContain('instanceGlyphMarkHtml');
    expect(painter).not.toContain('fineSealMarkHtml');
    // No private seal URL or class fork that could drift from bags.
    expect(painter).not.toContain('MASTERWORK_SEAL_IMAGE_URL');
    expect(painter).not.toContain('bi-masterwork-seal');
    expect(painter).not.toContain('bi-fine-seal');
  });
});
