// Loot Explorer painter behavior: the shared "chance vs Guaranteed" label
// rule (src/ui/hud/loot_explorer/loot_explorer_window.ts's
// sourceQualifierBits), which both the flat "By Item" view and the
// "By Encounter" grouping read from, and the gatedByQuestId/restrictedToClass
// carry-through groupLootExplorerBySource performs so the encounter view can
// apply that rule correctly. Regression coverage for the review defect: the
// encounter card used to label every undefined-chance drop "Guaranteed",
// including rift pool entries the flat item view correctly left unlabelled,
// because grouping silently dropped gatedByQuestId/restrictedToClass off
// each drop.

import { beforeEach, describe, expect, it } from 'vitest';
import { tEntity } from '../src/ui/entity_i18n';
import {
  buildLootExplorerIndex,
  groupLootExplorerBySource,
  resetLootExplorerIndexCache,
} from '../src/ui/hud/loot_explorer/loot_explorer_view';
import { sourceQualifierBits } from '../src/ui/hud/loot_explorer/loot_explorer_window';
import { formatNumber, t } from '../src/ui/i18n';

beforeEach(() => resetLootExplorerIndexCache());

const GUARANTEED = t('hudChrome.lootExplorer.guaranteed');

describe('sourceQualifierBits: chance vs Guaranteed semantics', () => {
  it('labels a plain undefined-chance source Guaranteed', () => {
    const bits = sourceQualifierBits({ category: 'vendor', chance: undefined });
    expect(bits).toContain(GUARANTEED);
  });

  it('never labels a rift pool pick (undefined chance) Guaranteed', () => {
    const bits = sourceQualifierBits({ category: 'rift', chance: undefined });
    expect(bits).not.toContain(GUARANTEED);
  });

  it('never labels a quest-collect objective Guaranteed', () => {
    const bits = sourceQualifierBits({ category: 'quest_objective', chance: undefined });
    expect(bits).not.toContain(GUARANTEED);
  });

  it('never labels a quest-gated source Guaranteed, and states the gate instead', () => {
    const bits = sourceQualifierBits({
      category: 'vendor',
      chance: undefined,
      gatedByQuestId: 'q_ps_pouch_and_purse',
    });
    expect(bits).not.toContain(GUARANTEED);
    expect(bits).toContain(
      t('hudChrome.lootExplorer.gatedByQuest', {
        quest: tEntity({ kind: 'quest', id: 'q_ps_pouch_and_purse', field: 'title' }),
      }),
    );
  });

  it('always states a numeric chance as a percentage, even for rift', () => {
    const bits = sourceQualifierBits({ category: 'rift', chance: 0.5 });
    expect(bits).toEqual([
      t('hudChrome.lootExplorer.chance', {
        pct: formatNumber(50, { maximumFractionDigits: 1 }),
      }),
    ]);
  });
});

describe('groupLootExplorerBySource: preserves per-drop conditional metadata', () => {
  it('carries gatedByQuestId onto the grouped drop for a gated vendor source', () => {
    const { items } = buildLootExplorerIndex();
    const linenPouch = items.find((i) => i.itemId === 'linen_pouch');
    expect(linenPouch).toBeDefined();
    const groups = groupLootExplorerBySource([linenPouch!]);
    const vendorGroup = groups.find(
      (g) => g.category === 'vendor' && g.sourceId === 'quartermaster_finch',
    );
    expect(vendorGroup).toBeDefined();
    const drop = vendorGroup!.drops.find((d) => d.itemId === 'linen_pouch');
    expect(drop?.gatedByQuestId).toBe('q_ps_pouch_and_purse');
    // The encounter card must therefore never call this drop Guaranteed.
    const bits = sourceQualifierBits({
      category: vendorGroup!.category,
      chance: drop?.chance,
      gatedByQuestId: drop?.gatedByQuestId,
    });
    expect(bits).not.toContain(GUARANTEED);
  });

  it('carries restrictedToClass onto the grouped drop for a class-restricted quest reward', () => {
    const { items } = buildLootExplorerIndex();
    const staff = items.find((i) => i.itemId === 'apprentice_staff');
    expect(staff).toBeDefined();
    const groups = groupLootExplorerBySource([staff!]);
    const rewardGroup = groups.find(
      (g) => g.category === 'quest_reward' && g.sourceId === 'q_bandits',
    );
    expect(rewardGroup).toBeDefined();
    const restrictedDrops = rewardGroup!.drops.filter((d) => d.itemId === 'apprentice_staff');
    expect(restrictedDrops.length).toBeGreaterThan(0);
    for (const drop of restrictedDrops) expect(drop.restrictedToClass).toBeDefined();
    expect(restrictedDrops.map((d) => d.restrictedToClass).sort()).toEqual([
      'druid',
      'mage',
      'priest',
      'warlock',
    ]);
  });

  it('a real rift pool encounter never reads Guaranteed; a real guaranteed encounter still does', () => {
    const { items } = buildLootExplorerIndex();
    const groups = groupLootExplorerBySource(items);

    const riftGroup = groups.find((g) => g.category === 'rift');
    expect(riftGroup).toBeDefined();
    expect(riftGroup!.drops.length).toBeGreaterThan(0);
    for (const drop of riftGroup!.drops) {
      expect(drop.chance).toBeUndefined();
      const bits = sourceQualifierBits({
        category: riftGroup!.category,
        chance: drop.chance,
        gatedByQuestId: drop.gatedByQuestId,
      });
      expect(bits).not.toContain(GUARANTEED);
    }

    // An ungated vendor stock source in the same real catalogue is exactly
    // the shape the review defect conflated with the rift case above: same
    // "undefined chance" input, opposite correct label.
    const ungatedVendorGroup = groups.find((g) => {
      if (g.category !== 'vendor') return false;
      return g.drops.some((d) => d.chance === undefined && !d.gatedByQuestId);
    });
    expect(ungatedVendorGroup).toBeDefined();
    const ungatedDrop = ungatedVendorGroup!.drops.find(
      (d) => d.chance === undefined && !d.gatedByQuestId,
    );
    const bits = sourceQualifierBits({
      category: ungatedVendorGroup!.category,
      chance: ungatedDrop?.chance,
      gatedByQuestId: ungatedDrop?.gatedByQuestId,
    });
    expect(bits).toContain(GUARANTEED);
  });
});
