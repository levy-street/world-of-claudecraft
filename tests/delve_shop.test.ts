// Delve Marks vendor (Brother Halven's shop): gate unlock logic + the
// server-authoritative buy path (gate + balance re-validated in the Sim).
import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { DELVE_SHOPS, ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

// autoEquip:false so a bought wearable stays in the bags where we can count it
// (mirrors the chest-loot test in delves.test.ts).
const makeSim = (cls: PlayerClass = 'warrior', seed = 7) =>
  new Sim({ seed, playerClass: cls, autoEquip: false });
const metaOf = (sim: Sim) => (sim as any).players.get(sim.playerId);
const countOf = (sim: Sim, id: string) =>
  sim.inventory.filter((s) => s.itemId === id).reduce((n, s) => n + s.count, 0);

const shop = DELVE_SHOPS.collapsed_reliquary;
const availableEntry = shop.find((e) => e.gate === 'available')!;
const clearsEntry = shop.find((e) => e.gate === 'clears:3')!;
const heroicEntry = shop.find((e) => e.gate === 'heroicClear')!;

describe('delve shop, gate logic', () => {
  it('available is always open', () => {
    const sim = makeSim();
    expect(sim.delveShopGateMet(metaOf(sim), 'collapsed_reliquary', 'available')).toBe(true);
  });

  it('clears:N counts this delve at any difficulty (normal + heroic), not other delves', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    expect(sim.delveShopGateMet(meta, 'collapsed_reliquary', 'clears:3')).toBe(false);
    meta.delveClears['collapsed_reliquary:normal'] = 2;
    meta.delveClears['collapsed_reliquary:heroic'] = 1;
    expect(sim.delveShopGateMet(meta, 'collapsed_reliquary', 'clears:3')).toBe(true);
    // A different delve's clears must not bleed into this gate.
    meta.delveClears['collapsed_reliquary:normal'] = 0;
    meta.delveClears['collapsed_reliquary:heroic'] = 0;
    meta.delveClears['some_other_delve:normal'] = 9;
    expect(sim.delveShopGateMet(meta, 'collapsed_reliquary', 'clears:3')).toBe(false);
  });

  it('heroicClear needs at least one heroic completion', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.delveClears['collapsed_reliquary:normal'] = 5; // normal clears do not unlock it
    expect(sim.delveShopGateMet(meta, 'collapsed_reliquary', 'heroicClear')).toBe(false);
    meta.delveClears['collapsed_reliquary:heroic'] = 1;
    expect(sim.delveShopGateMet(meta, 'collapsed_reliquary', 'heroicClear')).toBe(true);
  });
});

describe('delve shop, buying', () => {
  it('grants the item and debits Marks on a valid purchase', () => {
    const sim = makeSim();
    metaOf(sim).delveMarks = 100;
    const before = countOf(sim, availableEntry.itemId);
    sim.delveBuyShopItem('collapsed_reliquary', availableEntry.itemId);
    expect(countOf(sim, availableEntry.itemId) - before).toBe(1);
    expect(sim.delveMarks).toBe(100 - availableEntry.marks);
  });

  it('rejects when Marks are insufficient, no item, no debit', () => {
    const sim = makeSim();
    metaOf(sim).delveMarks = availableEntry.marks - 1;
    const before = countOf(sim, availableEntry.itemId);
    sim.delveBuyShopItem('collapsed_reliquary', availableEntry.itemId);
    expect(countOf(sim, availableEntry.itemId)).toBe(before);
    expect(sim.delveMarks).toBe(availableEntry.marks - 1);
  });

  it('rejects a full-bag purchase BEFORE the spend: no Marks debit, no overflow grant', () => {
    // The grant hub deliberately never capacity-caps (a mid-flight grant must
    // not vanish), so the buy path itself has to gate, exactly like buyItem:
    // without the gate the purchase landed past capacity and the counter was
    // an overflow loophole.
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.delveMarks = 100;
    const capacity = bagCapacity(meta.bags);
    const fillerStack = ITEMS.bone_fragments.stackSize ?? 20;
    while (meta.inventory.length < capacity)
      sim.addItem('bone_fragments', fillerStack, sim.playerId);
    expect(meta.inventory.length).toBe(capacity);
    expect(sim.ctx.canAddItem(availableEntry.itemId, 1, sim.playerId)).toBe(false);

    sim.drainEvents();
    sim.delveBuyShopItem('collapsed_reliquary', availableEntry.itemId);
    expect(countOf(sim, availableEntry.itemId)).toBe(0);
    expect(sim.delveMarks, 'the Marks must survive the refusal').toBe(100);
    expect(meta.inventory.length).toBe(capacity);
    // The refusal is TOLD to the player, the same bags-full idiom buyItem
    // uses: a silent early return would keep every absence assert above green
    // while the counter just ate the click.
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
  });

  it('rejects a locked clears:3 item until the clears requirement is met', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.delveMarks = 100;
    sim.delveBuyShopItem('collapsed_reliquary', clearsEntry.itemId);
    expect(countOf(sim, clearsEntry.itemId)).toBe(0);
    expect(sim.delveMarks).toBe(100); // gate blocks BEFORE any debit

    meta.delveClears['collapsed_reliquary:normal'] = 3;
    sim.delveBuyShopItem('collapsed_reliquary', clearsEntry.itemId);
    expect(countOf(sim, clearsEntry.itemId)).toBe(1);
    expect(sim.delveMarks).toBe(100 - clearsEntry.marks);
  });

  it('rejects a Heroic-gated rare until a heroic clear is recorded', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.delveMarks = 100;
    sim.delveBuyShopItem('collapsed_reliquary', heroicEntry.itemId);
    expect(countOf(sim, heroicEntry.itemId)).toBe(0);
    expect(sim.delveMarks).toBe(100);

    meta.delveClears['collapsed_reliquary:heroic'] = 1;
    sim.delveBuyShopItem('collapsed_reliquary', heroicEntry.itemId);
    expect(countOf(sim, heroicEntry.itemId)).toBe(1);
    expect(sim.delveMarks).toBe(100 - heroicEntry.marks);
  });

  it('rejects an item that is not in the shop / wrong delve, no debit', () => {
    const sim = makeSim();
    metaOf(sim).delveMarks = 100;
    sim.delveBuyShopItem('collapsed_reliquary', 'worn_sword');
    sim.delveBuyShopItem('no_such_delve', availableEntry.itemId);
    expect(sim.delveMarks).toBe(100);
    expect(countOf(sim, 'worn_sword')).toBe(0);
  });
});

// The shop tab (hud.ts) renders from this IWorld view; the same resolver backs the
// online ClientWorld off its mirrored delveClears, so the lock badge it shows
// matches the gate the server-authoritative buy enforces.
describe('delve shop, delveShopOffers view', () => {
  it('mirrors the stock and resolves lock state + gate breakdown from clears', () => {
    const sim = makeSim();
    const offers = sim.delveShopOffers('collapsed_reliquary');
    expect(offers).toHaveLength(shop.length);

    const clearsOffer = offers.find((o) => o.itemId === clearsEntry.itemId)!;
    expect(clearsOffer.requiresClears).toBe(3);
    expect(clearsOffer.requiresHeroicClear).toBe(false);
    const heroicOffer = offers.find((o) => o.itemId === heroicEntry.itemId)!;
    expect(heroicOffer.requiresHeroicClear).toBe(true);
    expect(heroicOffer.requiresClears).toBe(0);

    // Fresh character: available open, gated entries locked.
    expect(offers.find((o) => o.itemId === availableEntry.itemId)?.unlocked).toBe(true);
    expect(clearsOffer.unlocked).toBe(false);
    expect(heroicOffer.unlocked).toBe(false);
  });

  it('unlocks gated offers once the clears requirement is met', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.delveClears['collapsed_reliquary:normal'] = 3;
    meta.delveClears['collapsed_reliquary:heroic'] = 1;
    const offers = sim.delveShopOffers('collapsed_reliquary');
    expect(offers.find((o) => o.itemId === clearsEntry.itemId)?.unlocked).toBe(true);
    expect(offers.find((o) => o.itemId === heroicEntry.itemId)?.unlocked).toBe(true);
  });

  it('returns an empty list for an unknown delve', () => {
    expect(makeSim().delveShopOffers('no_such_delve')).toEqual([]);
  });
});

describe('Drowned Litany shop stock (data pins)', () => {
  it('pins the Marks price ladder, gates, and item ids (2x the Reliquary slots)', () => {
    // The whole stock as literals: a price, gate, or id change must be a
    // deliberate edit here, not silent drift.
    expect(DELVE_SHOPS.drowned_litany).toEqual([
      { itemId: 'litany_legs', marks: 16, gate: 'available' },
      { itemId: 'litany_shoulder', marks: 16, gate: 'available' },
      { itemId: 'litany_gloves_rog', marks: 16, gate: 'available' },
      { itemId: 'litany_cloth_chest', marks: 20, gate: 'available' },
      { itemId: 'litany_leather_chest', marks: 20, gate: 'available' },
      { itemId: 'litany_plate_chest', marks: 20, gate: 'available' },
      { itemId: 'litany_helm', marks: 24, gate: 'clears:3' },
      { itemId: 'sister_nhalia_choir_plate', marks: 56, gate: 'heroicClear' },
      { itemId: 'drowned_choir_fang', marks: 56, gate: 'heroicClear' },
      // The crafted top-tier tools, a non-crafter's route to the tool ladder.
      // Tier 4 on the commitment rung, tier 5 on the Heroic rung.
      { itemId: 'thorium_mining_pick', marks: 24, gate: 'clears:3' },
      { itemId: 'ashwood_axe', marks: 24, gate: 'clears:3' },
      { itemId: 'goldleaf_sickle', marks: 24, gate: 'clears:3' },
      { itemId: 'stormreel_fishing_rod', marks: 24, gate: 'clears:3' },
      { itemId: 'arcanite_mining_pick', marks: 56, gate: 'heroicClear' },
      { itemId: 'elderwood_axe', marks: 56, gate: 'heroicClear' },
      { itemId: 'sunpetal_sickle', marks: 56, gate: 'heroicClear' },
      { itemId: 'tidewrought_fishing_rod', marks: 56, gate: 'heroicClear' },
    ]);
  });

  it('stocks every crafted tier-4/5 tool, each on the rung its tier earns', () => {
    // DERIVED from the item table, never a second hand-written list: a ninth
    // crafted tool added to content and forgotten here fails, which is the
    // whole point of the route existing.
    const craftedTools = Object.values(ITEMS).filter(
      (def) => def.use?.type === 'gatherTool' && def.use.tier > 3,
    );
    // At-least, not exactly: a ninth crafted tool added WITH its Marks row is
    // a legitimate content addition, and an exact pin would red on it with a
    // misleading message. The per-tool loop below is what actually guards the
    // claim, and the literal stock pin above already fixes today's count.
    expect(craftedTools.length).toBeGreaterThanOrEqual(8);
    const rows = new Map(DELVE_SHOPS.drowned_litany.map((e) => [e.itemId, e]));
    for (const tool of craftedTools) {
      const row = rows.get(tool.id);
      expect(row, `${tool.id} must have a Marks route`).toBeDefined();
      const tier = tool.use?.type === 'gatherTool' ? tool.use.tier : 0;
      // Tier decides the rung, and the two rungs are genuinely different, so
      // this cannot pass by every tool landing on one price.
      expect([row?.marks, row?.gate], tool.id).toEqual(
        tier === 4 ? [24, 'clears:3'] : [56, 'heroicClear'],
      );
    }
    // Both arms are populated, so neither branch above is dead.
    expect(
      craftedTools.filter((t) => t.use?.type === 'gatherTool' && t.use.tier === 4),
    ).toHaveLength(4);
    expect(
      craftedTools.filter((t) => t.use?.type === 'gatherTool' && t.use.tier === 5),
    ).toHaveLength(4);
  });

  it('every Litany slot costs exactly 2x its Collapsed Reliquary price tier', () => {
    const reliquary = DELVE_SHOPS.collapsed_reliquary;
    const litany = DELVE_SHOPS.drowned_litany;
    const tiers = (entries: typeof reliquary) =>
      [...new Set(entries.map((e) => e.marks))].sort((a, b) => a - b);
    expect(tiers(litany)).toEqual(tiers(reliquary).map((m) => m * 2));
  });
});
