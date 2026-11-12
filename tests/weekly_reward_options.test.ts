import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_WORLD, ITEMS, NPCS } from '../src/sim/data';
import { requiredLevelFor } from '../src/sim/item_level_req';
import { Sim } from '../src/sim/sim';
import {
  parseWeeklyTableSelection,
  selectedWeeklyRewardTables,
  WEEKLY_TABLE_SELECTION_LIMIT,
  weeklyItemWithinLevel,
  weeklyNormalPool,
  weeklyRewardTableOptions,
  weeklyTableSource,
  weeklyTableSourceId,
} from '../src/sim/weekly_reward_options';
import { WEEKLY_BOSS_TABLES, weeklyBossLootPool } from '../src/sim/weekly_reward_tables';
import {
  emptyWeeklyRewards,
  finishWeeklyRewardOpen,
  prepareWeeklyRewardOpen,
  sanitizeWeeklyRewards,
  WEEKLY_KEEPER_ID,
  type WeeklyVaultBatch,
  weeklyRewardInfoFor,
} from '../src/sim/weekly_rewards';

const batch = (): WeeklyVaultBatch => ({
  resetAtMs: 1000,
  bossUnlocks: { sexton_marrow: 1, morthen: 2, vael_the_mistcaller: 1 },
  choices: [{ pool: 'dungeon' }],
});
function setup() {
  const sim = new Sim({
    seed: 42,
    noPlayer: true,
    playerClass: 'mage',
    lockoutNowMs: () => 2000,
    world: {
      ...BUILTIN_WORLD,
      camps: [],
      groundObjects: [],
      npcs: { [WEEKLY_KEEPER_ID]: NPCS[WEEKLY_KEEPER_ID] },
    },
  });
  const pid = sim.addPlayer('mage', 'Collector');
  const player = sim.entities.get(pid)!;
  player.level = 20;
  player.pos = {
    ...[...sim.entities.values()].find((e) => e.templateId === WEEKLY_KEEPER_ID)!.pos,
  };
  const state = emptyWeeklyRewards(604800000);
  state.vaults = [batch()];
  sim.players.get(pid)!.weeklyRewards = state;
  return { sim, pid, player, state, batch: state.vaults[0] };
}
describe('weekly reward table options', () => {
  it('never offers a cleared raid boss on a dungeon slot, or a dungeon boss on a raid slot', () => {
    const h = setup();
    const pick = vi.spyOn(h.sim.ctx.rng, 'pick');
    h.batch.bossUnlocks = { nythraxis_scourge_of_thornpeak: 2 };
    expect(weeklyRewardTableOptions(h.batch, h.batch.choices[0], 'mage', 20)).toEqual([]);
    expect(
      prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, [
        'nythraxis_scourge_of_thornpeak',
      ]),
    ).toBeNull();
    expect(pick).not.toHaveBeenCalled();
    h.batch.choices[0].pool = 'raid';
    expect(
      prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, [
        'nythraxis_scourge_of_thornpeak',
      ]),
    ).not.toBeNull();
    h.batch.choices = [{ pool: 'raid' }];
    h.batch.bossUnlocks = { vael_the_mistcaller: 2 };
    pick.mockClear();
    expect(weeklyRewardTableOptions(h.batch, h.batch.choices[0], 'mage', 20)).toEqual([]);
    expect(
      prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, ['sunken_bastion']),
    ).toBeNull();
    expect(pick).not.toHaveBeenCalled();
  });

  it('filters over-level dungeon boss items before constructing authoritative roll candidates', () => {
    const h = setup();
    h.batch.bossUnlocks = { ysolei: 2 };
    h.batch.choices = [{ pool: 'dungeon_heroic' }];
    const itemId = weeklyBossLootPool('ysolei', 'dungeon_heroic', 'mage').find(
      (id) => requiredLevelFor(ITEMS[id]) === 20,
    );
    expect(itemId).toBeDefined();
    h.player.level = 16;
    const pick = vi.spyOn(h.sim.ctx.rng, 'pick');
    const options = weeklyRewardTableOptions(h.batch, h.batch.choices[0], 'mage', 16);
    expect(options.flatMap((table) => table.items)).not.toContain(itemId);
    prepareWeeklyRewardOpen(
      h.sim.ctx,
      '1000:0',
      h.pid,
      undefined,
      options.map((table) => table.id),
    );
    for (const [items] of pick.mock.calls) expect(items).not.toContain(itemId);
    h.batch.choices = [{ pool: 'dungeon_heroic' }];
    expect(
      weeklyRewardTableOptions(h.batch, h.batch.choices[0], 'mage', 17).flatMap(
        (table) => table.items,
      ),
    ).toContain(itemId);
  });

  it.each(['world', ['world']] as const)(
    'opens via the offline Sim entry point with selection %j',
    (table) => {
      const h = setup();
      h.batch.choices = [{ pool: 'world' }];
      h.sim.openWeeklyReward('1000:0', table, h.pid);
      expect(h.batch.choices[0]).toMatchObject({ tableId: 'world', opened: true });
      expect(h.batch.choices[0].itemId).toBeTruthy();
      expect(h.batch.choices[0].pendingSave).toBeUndefined();
    },
  );

  it('retries a fixed reward via the offline Sim entry point without a selection', () => {
    const h = setup();
    h.batch.choices = [{ pool: 'world', itemId: 'wraithfire_orb', tableId: 'world' }];
    const pick = vi.spyOn(h.sim.ctx.rng, 'pick');
    h.sim.openWeeklyReward('1000:0', undefined, h.pid);
    expect(h.batch.choices[0]).toMatchObject({
      itemId: 'wraithfire_orb',
      tableId: 'world',
      opened: true,
    });
    expect(pick).not.toHaveBeenCalled();
  });
  it('uses derived equip requirements and enforces the exact plus-three boundary', () => {
    const id = 'wraithfire_orb';
    const level = requiredLevelFor(ITEMS[id]);
    expect(level).toBeGreaterThan(3);
    expect(weeklyItemWithinLevel(id, level - 3)).toBe(true);
    expect(weeklyItemWithinLevel(id, level - 4)).toBe(false);
    expect(weeklyItemWithinLevel(id, NaN)).toBe(false);
    const b = batch();
    b.choices = [{ pool: 'world' }];
    expect(weeklyRewardTableOptions(b, b.choices[0], 'mage', level - 4)).toEqual([]);
    expect(weeklyRewardTableOptions(b, b.choices[0], 'mage', level - 3)[0].items).toContain(id);
  });
  it('groups only cleared dungeon bosses at the earned difficulty', () => {
    const b = batch();
    const normal = weeklyRewardTableOptions(b, b.choices[0], 'mage', 20);
    expect(normal.map((t) => t.id)).toEqual(['hollow_crypt', 'sunken_bastion']);
    expect(normal[0].items).toEqual(
      [
        ...new Set(
          ['sexton_marrow', 'morthen'].flatMap((id) => weeklyBossLootPool(id, 'dungeon', 'mage')),
        ),
      ].sort(),
    );
    b.choices[0].pool = 'dungeon_heroic';
    // The earned Heroic table holds only the Heroic clear; the Normal tables a
    // Heroic vault may roll instead are exactly a Normal vault's, under marked ids.
    expect(weeklyRewardTableOptions(b, b.choices[0], 'mage', 20)).toEqual([
      {
        id: 'hollow_crypt',
        kind: 'dungeon',
        items: weeklyBossLootPool('morthen', 'dungeon_heroic', 'mage'),
      },
      ...normal.map((table) => ({ ...table, id: `${table.id}:normal`, difficulty: 'normal' })),
    ]);
  });
  it('lets a Heroic vault roll a Normal table, and never a Normal vault a Heroic one', () => {
    const h = setup();
    const pick = vi.spyOn(h.sim.ctx.rng, 'pick');
    // A Normal vault has no marked alternative, and its bare id is its own table.
    expect(
      prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, ['hollow_crypt:normal']),
    ).toBeNull();
    expect(pick).not.toHaveBeenCalled();
    h.batch.choices[0].pool = 'dungeon_heroic';
    // sunken_bastion was cleared on Normal only: no Heroic table, a Normal one.
    expect(
      prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, ['sunken_bastion']),
    ).toBeNull();
    expect(pick).not.toHaveBeenCalled();
    const normalItems = weeklyBossLootPool('vael_the_mistcaller', 'dungeon', 'mage');
    const heroicItems = new Set(weeklyBossLootPool('morthen', 'dungeon_heroic', 'mage'));
    const opening = prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, [
      'sunken_bastion:normal',
    ])!;
    expect(pick).toHaveBeenCalledExactlyOnceWith(normalItems);
    expect(normalItems).toContain(opening.itemId);
    expect(heroicItems.has(opening.itemId)).toBe(false);
    // The vault stays the Heroic one it was earned as; the source records Normal.
    expect(opening.choice.pool).toBe('dungeon_heroic');
    expect(opening.choice.tableId).toBe('sunken_bastion:normal');
    finishWeeklyRewardOpen(opening, true);
    const rolled = {
      pool: 'dungeon_heroic',
      tableId: 'sunken_bastion:normal',
      itemId: opening.itemId,
      opened: true,
    };
    const saved = h.sim.serializeCharacter(h.pid)!.weeklyRewards;
    expect(sanitizeWeeklyRewards(saved)!.vaults[0].choices[0]).toEqual(rolled);
    // The owner's wire view and its client decode keep the marked source too.
    expect(sanitizeWeeklyRewards(saved, true)!.vaults[0].choices[0]).toEqual(rolled);
    expect(weeklyRewardInfoFor(h.sim.ctx, h.pid)!.state.vaults[0].choices[0]).toEqual(rolled);
  });
  it('refuses a roll that mixes difficulties, and a Normal table of an uncleared boss', () => {
    const h = setup();
    h.batch.choices[0].pool = 'dungeon_heroic';
    const pick = vi.spyOn(h.sim.ctx.rng, 'pick');
    for (const forged of [
      ['hollow_crypt', 'hollow_crypt:normal'],
      ['hollow_crypt', 'sunken_bastion:normal'],
      // drowned_temple has no clear at either difficulty in this batch.
      ['drowned_temple:normal'],
      ['hollow_crypt:normal', 'drowned_temple:normal'],
    ])
      expect(prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, forged)).toBeNull();
    expect(pick).not.toHaveBeenCalled();
    expect(h.batch.choices[0]).toEqual({ pool: 'dungeon_heroic' });
    // Several tables of one difficulty still roll as one union.
    expect(
      prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, [
        'hollow_crypt:normal',
        'sunken_bastion:normal',
      ]),
    ).not.toBeNull();
    expect(pick).toHaveBeenCalledOnce();
  });
  it('blocks the claim while a spent Heroic slot can still roll Normal', () => {
    const h = setup();
    const heroicItems = weeklyBossLootPool('morthen', 'dungeon_heroic', 'mage');
    h.batch.bossUnlocks = { morthen: 2 };
    // Every Heroic item is already rolled, so the last slot has only Normal left.
    h.batch.choices = [
      ...heroicItems.map((itemId) => ({
        pool: 'dungeon_heroic' as const,
        itemId,
        opened: true as const,
      })),
      { pool: 'dungeon_heroic' },
    ];
    const last = h.batch.choices.length - 1;
    expect(
      weeklyRewardTableOptions(h.batch, h.batch.choices[last], 'mage', 20).map((t) => t.id),
    ).toEqual(['hollow_crypt:normal']);
    h.sim.claimWeeklyReward('1000:0', h.pid);
    expect(h.state.vaults).toHaveLength(1);
    const opening = prepareWeeklyRewardOpen(h.sim.ctx, `1000:${last}`, h.pid, undefined, [
      'hollow_crypt:normal',
    ])!;
    finishWeeklyRewardOpen(opening, true);
    h.sim.claimWeeklyReward('1000:0', h.pid);
    expect(h.state.vaults).toHaveLength(0);
    expect(h.sim.ctx.countItem(heroicItems[0], h.pid)).toBe(1);
  });
  it('offers a Heroic raid vault each cleared boss at both difficulties', () => {
    const b = batch();
    b.bossUnlocks = { nythraxis_scourge_of_thornpeak: 2, ignivar_herald_of_the_last_flame: 1 };
    b.choices = [{ pool: 'raid_heroic' }];
    const options = weeklyRewardTableOptions(b, b.choices[0], 'mage', 60);
    expect(options.map((t) => [t.id, t.kind, t.difficulty])).toEqual([
      ['nythraxis_scourge_of_thornpeak', 'mob', undefined],
      ...WEEKLY_BOSS_TABLES.filter(
        (table) => table.category === 'raid' && (b.bossUnlocks![table.bossId] ?? 0) >= 1,
      ).map((table) => [`${table.bossId}:normal`, 'mob', 'normal']),
    ]);
    expect(options.filter((t) => t.difficulty)).toHaveLength(2);
    b.choices = [{ pool: 'raid' }];
    expect(weeklyRewardTableOptions(b, b.choices[0], 'mage', 60).map((t) => t.difficulty)).toEqual([
      undefined,
      undefined,
    ]);
  });
  it('recognises a marked Normal source only on a real boss or dungeon table', () => {
    expect(weeklyTableSource('hollow_crypt:normal')).toEqual({
      id: 'hollow_crypt:normal',
      kind: 'dungeon',
    });
    expect(weeklyTableSource('morthen:normal')).toEqual({ id: 'morthen:normal', kind: 'mob' });
    for (const id of ['world:normal', 'pvp:normal', 'fake:normal', ':normal', 'morthen:heroic'])
      expect(weeklyTableSource(id)).toBeUndefined();
    expect(weeklyTableSourceId('hollow_crypt:normal')).toBe('hollow_crypt');
    expect(weeklyTableSourceId('hollow_crypt')).toBe('hollow_crypt');
    expect([weeklyNormalPool('raid_heroic'), weeklyNormalPool('dungeon_heroic')]).toEqual([
      'raid',
      'dungeon',
    ]);
    for (const pool of ['raid', 'dungeon', 'world', 'pvp'] as const)
      expect(weeklyNormalPool(pool)).toBeUndefined();
    // The marker is unambiguous only while no source id carries a colon.
    for (const { bossId, dungeonId } of WEEKLY_BOSS_TABLES)
      expect(`${bossId}${dungeonId}`).not.toContain(':');
    // Both difficulties of every boss table, plus the two pool tables, fit one request.
    expect(WEEKLY_TABLE_SELECTION_LIMIT).toBe(WEEKLY_BOSS_TABLES.length * 2 + 2);
  });
  it('rejects missing, malformed, oversized and partly forged selections before any roll', () => {
    const h = setup();
    const pick = vi.spyOn(h.sim.ctx.rng, 'pick');
    const bad = [
      undefined,
      [],
      ['hollow_crypt', 'fake'],
      ['nythraxis_scourge_of_thornpeak'],
      ['morthen'],
      [3],
      Array(WEEKLY_TABLE_SELECTION_LIMIT + 1).fill('hollow_crypt'),
      ['x'.repeat(129)],
    ];
    for (const ids of bad)
      expect(
        prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, ids as string[]),
      ).toBeNull();
    expect(pick).not.toHaveBeenCalled();
    expect(h.batch.choices[0]).toEqual({ pool: 'dungeon' });
    expect(parseWeeklyTableSelection(['b', 'a', 'b'])).toEqual(['a', 'b']);
  });
  it('gives each item one chance regardless of duplicate or reordered selected tables', () => {
    const h = setup();
    const options = weeklyRewardTableOptions(h.batch, h.batch.choices[0], 'mage', 20);
    const selected = ['sunken_bastion', 'hollow_crypt', 'sunken_bastion'];
    expect(selectedWeeklyRewardTables(options, selected)).toEqual(
      selectedWeeklyRewardTables(options, [...selected].reverse()),
    );
    const pick = vi.spyOn(h.sim.ctx.rng, 'pick');
    const opening = prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, selected)!;
    expect(pick).toHaveBeenCalledWith([...new Set(options.flatMap((t) => t.items))].sort());
    const source = opening.choice.tableId;
    expect(options.find((t) => t.id === source)!.items).toContain(opening.itemId);
    finishWeeklyRewardOpen(opening, false);
    h.player.level = 1;
    const retry = prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid)!;
    expect(retry.itemId).toBe(opening.itemId);
    expect(retry.choice.tableId).toBe(source);
    expect(pick).toHaveBeenCalledOnce();
    finishWeeklyRewardOpen(retry, true);
    expect(
      sanitizeWeeklyRewards(h.sim.serializeCharacter(h.pid)!.weeklyRewards)!.vaults[0].choices[0]
        .tableId,
    ).toBe(source);
  });
  it('allows claiming revealed loot when other pools have only over-level items, without rolling those pools', () => {
    const h = setup();
    h.player.level = 1;
    h.batch.choices = [
      { pool: 'dungeon', itemId: 'orb_of_the_last_spring', opened: true },
      { pool: 'world' },
    ];
    const pick = vi.spyOn(h.sim.ctx.rng, 'pick');
    h.sim.claimWeeklyReward('1000:0', h.pid);
    expect(h.state.vaults).toHaveLength(0);
    expect(pick).not.toHaveBeenCalled();
  });
  it.each(['world', 'pvp'] as const)(
    'blocks over-level %s rolls on the authoritative path',
    (pool) => {
      const h = setup();
      h.batch.choices = [{ pool }];
      h.player.level = 1;
      const pick = vi.spyOn(h.sim.ctx.rng, 'pick');
      expect(prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, [pool])).toBeNull();
      expect(pick).not.toHaveBeenCalled();
      h.player.level = 20;
      const opening = prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, [pool])!;
      expect(requiredLevelFor(ITEMS[opening.itemId])).toBeLessThanOrEqual(23);
    },
  );
});
