import { describe, expect, it } from 'vitest';
import { FULL_BODY_SKIN_VISUAL_KEYS, VISUALS } from '../src/render/characters/manifest';
import {
  CRUCIBLE_CLASS_SETS,
  CRUCIBLE_SKIN_CATALOG,
  crucibleSetCompleted,
  crucibleSkinByItemId,
  crucibleSkinDef,
  crucibleSkinForClass,
} from '../src/sim/content/crucible_skins';
import { RELIQUARY_PAGES_BY_ID } from '../src/sim/content/reliquary';
import { crucibleClaimVerdict } from '../src/sim/crucible_skin_claim';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, FULL_BODY_SKIN_CATALOGS } from '../src/sim/types';
import { armorPanelModel } from '../src/ui/reliquary_armor_view';
import { EMPTY_TEST_WORLD } from './sim_shared';

const subject = (cls: string, has: readonly string[]) =>
  ({
    cls,
    deedStats: { itemsDiscovered: new Set(has) },
    accountLedger: { relics: new Map() },
  }) as never;

describe('Inner Crucible skin catalog', () => {
  it('has one skin per class, each a real full-body catalog with a visual and a marker item', () => {
    expect(CRUCIBLE_SKIN_CATALOG).toHaveLength(9);
    expect(new Set(CRUCIBLE_SKIN_CATALOG.map((d) => d.requiredClass)).size).toBe(9);
    for (const cls of ALL_CLASSES) expect(crucibleSkinForClass(cls), cls).not.toBeNull();
    for (const def of CRUCIBLE_SKIN_CATALOG) {
      expect(FULL_BODY_SKIN_CATALOGS).toContain(def.catalog);
      const key = FULL_BODY_SKIN_VISUAL_KEYS[def.catalog];
      expect(key, def.catalog).toBeTruthy();
      expect(VISUALS[key as string], def.catalog).toBeDefined();
      expect(ITEMS[def.itemId], def.itemId).toBeDefined();
      expect(crucibleSkinDef(def.catalog)).toBe(def);
      expect(crucibleSkinByItemId(def.itemId)).toBe(def);
    }
  });

  it('derives at least one five-piece class set per class from the raid loot table', () => {
    for (const cls of ALL_CLASSES) {
      const sets = CRUCIBLE_CLASS_SETS[cls];
      expect(sets.length, cls).toBeGreaterThan(0);
      for (const set of sets) {
        expect(set.pieceIds, `${cls}/${set.setId}`).toHaveLength(5);
        for (const id of set.pieceIds) expect(ITEMS[id]?.requiredClass).toEqual([cls]);
      }
    }
  });

  it('counts a class set complete only when all five pieces of ONE set are held', () => {
    const [first, second] = CRUCIBLE_CLASS_SETS.warrior;
    const has = (ids: readonly string[]) => (id: string) => ids.includes(id);
    expect(crucibleSetCompleted('warrior', has([]))).toBe(false);
    expect(crucibleSetCompleted('warrior', has(first.pieceIds.slice(0, 4)))).toBe(false);
    expect(crucibleSetCompleted('warrior', has(first.pieceIds))).toBe(true);
    // Four pieces of each of two sets is not a complete set.
    const mixed = [...first.pieceIds.slice(0, 4), ...second.pieceIds.slice(0, 4)];
    expect(crucibleSetCompleted('warrior', has(mixed))).toBe(false);
  });
});

describe('crucibleClaimVerdict', () => {
  const warriorSet = CRUCIBLE_CLASS_SETS.warrior[0].pieceIds;
  it('rules on the skin, the class, prior ownership, and the set', () => {
    expect(crucibleClaimVerdict(subject('warrior', warriorSet), 'nope', [])).toBe('unknown_skin');
    expect(crucibleClaimVerdict(subject('mage', warriorSet), 'magmaraith', [])).toBe('wrong_class');
    expect(crucibleClaimVerdict(subject('warrior', warriorSet), 'magmaraith', ['magmaraith'])).toBe(
      'already_owned',
    );
    expect(crucibleClaimVerdict(subject('warrior', warriorSet.slice(0, 4)), 'magmaraith', [])).toBe(
      'set_incomplete',
    );
    expect(crucibleClaimVerdict(subject('warrior', warriorSet), 'magmaraith', [])).toBe('ok');
  });

  it('also honors the account ledger (a sibling character completed the set)', () => {
    const ledger = new Map(warriorSet.map((id) => [`item:${id}`, []]));
    const viaLedger = {
      cls: 'warrior',
      deedStats: { itemsDiscovered: new Set<string>() },
      accountLedger: { relics: ledger },
    } as never;
    expect(crucibleClaimVerdict(viaLedger, 'magmaraith', [])).toBe('ok');
  });
});

describe('Sim.claimCrucibleSkin (offline)', () => {
  const newSim = () =>
    new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, world: EMPTY_TEST_WORLD });

  it('refuses until a full set is held, then grants the skin and the collection-log marker', () => {
    const sim = newSim();
    const meta = sim.meta(sim.playerId)!;
    const pieces = CRUCIBLE_CLASS_SETS.warrior[0].pieceIds;
    for (const id of pieces.slice(0, 4)) sim.ctx.markItemDiscovered(meta, id);

    sim.claimCrucibleSkin('magmaraith');
    expect(sim.accountCosmetics.founderSkinIds ?? []).not.toContain('magmaraith');
    expect(sim.drainEvents().some((e) => e.type === 'error')).toBe(true);

    sim.ctx.markItemDiscovered(meta, pieces[4]);
    sim.claimCrucibleSkin('magmaraith');
    expect(sim.accountCosmetics.founderSkinIds).toContain('magmaraith');
    expect(meta.deedStats.itemsDiscovered.has('crucible_skin_magmaraith')).toBe(true);
  });

  it('refuses another class skin even with the set held, and never double-grants', () => {
    const sim = newSim();
    const meta = sim.meta(sim.playerId)!;
    for (const id of CRUCIBLE_CLASS_SETS.warrior[0].pieceIds) sim.ctx.markItemDiscovered(meta, id);
    sim.claimCrucibleSkin('emberstone');
    expect(sim.accountCosmetics.founderSkinIds ?? []).not.toContain('emberstone');
    sim.claimCrucibleSkin('magmaraith');
    sim.claimCrucibleSkin('magmaraith');
    expect(
      (sim.accountCosmetics.founderSkinIds ?? []).filter((c) => c === 'magmaraith'),
    ).toHaveLength(1);
  });
});

describe('Armor Cosmetics Reliquary page and panel model', () => {
  it('lists the nine marker items on a Horizons page that never gates Curator completion', () => {
    const page = RELIQUARY_PAGES_BY_ID.horizons_armor_cosmetics;
    expect(page.shelf).toBe('horizons');
    expect(page.excludeFromCompletion).toBe('personal');
    expect(page.relics.map((r) => (r.kind === 'item' ? r.itemId : ''))).toEqual(
      CRUCIBLE_SKIN_CATALOG.map((d) => d.itemId),
    );
  });

  it('moves locked, claimable, claimed with the set and the entitlement', () => {
    const set = CRUCIBLE_CLASS_SETS.mage[0].pieceIds;
    const base = { playerClass: 'mage' as const, ownedSkinIds: [] as string[] };
    expect(armorPanelModel({ ...base, has: () => false }).state).toBe('locked');
    expect(armorPanelModel({ ...base, has: (id) => id === set[0] }).sets[0].owned).toBe(1);
    expect(armorPanelModel({ ...base, has: (id) => set.includes(id) }).state).toBe('claimable');
    expect(armorPanelModel({ ...base, ownedSkinIds: ['emberstone'], has: () => false }).state).toBe(
      'claimed',
    );
  });
});
