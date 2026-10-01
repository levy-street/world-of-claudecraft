// The mob inspect window's pure core (src/ui/hud/mob_inspect/mob_inspect_view.ts)
// and the target-frame menu rows (mob_target_menu_view.ts): the loot-table
// model mirrors the roller's rules (independent chance rows, exclusive roll
// groups, quest and normal-only gates, the 0.6x to 1.4x coin band, the heroic
// append), the stat block comes only from the live read, and the same inputs
// give the same model whether the subject came from an offline Sim entity or
// a ClientWorld mirror.

import { describe, expect, it } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { HEROIC_DUNGEON_IDS } from '../src/sim/instances/difficulty';
import { heroicLootItemId } from '../src/sim/loot/heroic_item';
import { armorReduction, type Entity, type LootEntry } from '../src/sim/types';
import { buildMobToDungeon } from '../src/ui/hud/loot_explorer/loot_explorer_view';
import {
  buildMobInspectModel,
  mobHeroicLootEntries,
  mobInspectSubjectOf,
  mobInspectTraits,
  mobLootTable,
  mobTargetMenuRows,
} from '../src/ui/hud/mob_inspect';
import { t } from '../src/ui/i18n';
import type { MobInspectInfo } from '../src/world_api';

const WOLF = MOBS.forest_wolf;

function info(over: Partial<MobInspectInfo> = {}): MobInspectInfo {
  return {
    mobId: 5,
    templateId: 'forest_wolf',
    level: 6,
    maxHp: 150,
    weaponMin: 8,
    weaponMax: 12,
    attackSpeed: 2,
    armor: 100,
    ccImmune: false,
    slowImmune: false,
    ...over,
  };
}

const SUBJECT = { id: 5, templateId: 'forest_wolf', level: 6, maxHp: 140 };

describe('mobLootTable', () => {
  it('rolls coins in the 0.6x to 1.4x band (ceil), and sorts independent rows by chance', () => {
    const entries: LootEntry[] = [
      { copper: 100, chance: 0.9 },
      { itemId: 'a', chance: 0.1 },
      { itemId: 'b', chance: 0.5 },
      { itemId: 'c', chance: 0.1 },
    ];
    const table = mobLootTable(entries);
    expect(table.coins).toEqual([{ min: 60, max: 140, chance: 0.9 }]);
    expect(table.groups).toHaveLength(1);
    expect(table.groups[0].exclusive).toBe(false);
    // b first (highest chance), then a and c in authored order on the tie.
    expect(table.groups[0].rows.map((r) => r.itemId)).toEqual(['b', 'a', 'c']);
  });

  it('keeps each rollGroup together as one exclusive group, after the independent rows', () => {
    const entries: LootEntry[] = [
      { itemId: 'g1', chance: 0.3, rollGroup: 'x' },
      { itemId: 'solo', chance: 0.05 },
      { itemId: 'g2', chance: 0.2, rollGroup: 'x' },
      { itemId: 'h1', chance: 0.5, rollGroup: 'y' },
    ];
    const table = mobLootTable(entries);
    expect(table.groups.map((g) => [g.exclusive, g.rows.map((r) => r.itemId)])).toEqual([
      [false, ['solo']],
      [true, ['g1', 'g2']],
      [true, ['h1']],
    ]);
  });

  it('carries the quest gate and the normal-only gate', () => {
    const table = mobLootTable([
      { itemId: 'q', chance: 0.4, questId: 'some_quest' },
      { itemId: 'n', chance: 0.2, normalOnly: true },
    ]);
    const rows = table.groups[0].rows;
    expect(rows[0]).toEqual({ itemId: 'q', chance: 0.4, questId: 'some_quest', normalOnly: false });
    expect(rows[1]).toEqual({ itemId: 'n', chance: 0.2, questId: null, normalOnly: true });
  });

  it('swaps in the heroic coin base only when asked', () => {
    const entries: LootEntry[] = [{ copper: 100, heroicCopper: 1000, chance: 1 }];
    expect(mobLootTable(entries).coins[0]).toEqual({ min: 60, max: 140, chance: 1 });
    expect(mobLootTable(entries, true).coins[0]).toEqual({ min: 600, max: 1400, chance: 1 });
  });

  it('an empty table has no coins and no groups', () => {
    expect(mobLootTable([])).toEqual({ coins: [], groups: [] });
  });
});

describe('buildMobInspectModel', () => {
  it('is null for an unknown template', () => {
    expect(
      buildMobInspectModel({
        subject: { ...SUBJECT, templateId: 'no_such_mob' },
        viewerLevel: 6,
        info: null,
        pending: false,
      }),
    ).toBeNull();
  });

  it('shows pending, then live stats computed from the live read', () => {
    const pending = buildMobInspectModel({
      subject: SUBJECT,
      viewerLevel: 6,
      info: null,
      pending: true,
    });
    expect(pending?.statsState).toBe('pending');
    expect(pending?.stats).toBeNull();
    expect(pending?.maxHp).toBe(140); // the mirrored entity until the read lands

    const live = buildMobInspectModel({
      subject: SUBJECT,
      viewerLevel: 10,
      info: info(),
      pending: false,
    });
    expect(live?.statsState).toBe('live');
    expect(live?.maxHp).toBe(150); // the authoritative read wins
    expect(live?.stats).toEqual({
      weaponMin: 8,
      weaponMax: 12,
      attackSpeed: 2,
      dps: 5,
      armor: 100,
      armorReduction: armorReduction(100, 10),
    });
  });

  it('reads unavailable when the read settled empty, or answered for another mob', () => {
    const empty = buildMobInspectModel({
      subject: SUBJECT,
      viewerLevel: 6,
      info: null,
      pending: false,
    });
    expect(empty?.statsState).toBe('unavailable');
    const wrong = buildMobInspectModel({
      subject: SUBJECT,
      viewerLevel: 6,
      info: info({ mobId: 99, weaponMax: 999 }),
      pending: false,
    });
    expect(wrong?.statsState).toBe('unavailable');
    expect(wrong?.stats).toBeNull();
  });

  it('builds the base loot table from the template and no heroic table for a trash mob', () => {
    const m = buildMobInspectModel({ subject: SUBJECT, viewerLevel: 6, info: null, pending: true });
    expect(m?.loot).toEqual(mobLootTable(WOLF.loot));
    expect(m?.heroicLoot).toBeNull();
    expect(m?.familyLabel).toBe(t(`guide.family.${WOLF.family}.name` as never));
  });

  it('adds the heroic-only table for a boss with HEROIC_BOSS_LOOT rows', () => {
    const bossId = Object.keys(HEROIC_BOSS_LOOT).find(
      (id) => MOBS[id] && HEROIC_BOSS_LOOT[id].length > 0,
    );
    if (!bossId) throw new Error('content has at least one heroic boss table');
    const boss = MOBS[bossId];
    const m = buildMobInspectModel({
      subject: { id: 1, templateId: bossId, level: boss.maxLevel, maxHp: 1 },
      viewerLevel: 60,
      info: null,
      pending: false,
    });
    const heroic = m?.heroicLoot;
    if (!heroic) throw new Error('heroic table present');
    const heroicItemIds = [
      ...new Set(heroic.groups.flatMap((g) => g.rows.map((r) => r.itemId))),
    ].sort();
    // The roller's heroic path: base rows minus normalOnly, swapped to their
    // Heroic variant, then the heroic-only append (a box lists an item once).
    const expected = [
      ...new Set([
        ...boss.loot
          .filter((e) => !e.normalOnly)
          .flatMap((e) => (e.itemId ? [heroicLootItemId(e.itemId, true)] : [])),
        ...HEROIC_BOSS_LOOT[bossId].flatMap((e) => (e.itemId ? [e.itemId] : [])),
      ]),
    ].sort();
    expect(heroicItemIds).toEqual(expected);
    expect(m?.rank).toBe(boss.boss ? 'boss' : boss.elite ? 'elite' : 'normal');
  });

  it('skips a normalOnly row in the heroic table but keeps it in the base one', () => {
    const bossId = Object.keys(HEROIC_BOSS_LOOT).find((id) => MOBS[id]);
    if (!bossId) throw new Error('content has at least one heroic boss table');
    const probe: LootEntry = { itemId: 'normal_only_probe', chance: 1, normalOnly: true };
    const withGate = { ...MOBS[bossId], loot: [...MOBS[bossId].loot, probe] };
    const heroic = mobHeroicLootEntries(withGate) ?? [];
    expect(heroic.some((e) => e.itemId === 'normal_only_probe')).toBe(false);
    expect(
      mobLootTable(withGate.loot).groups.flatMap((g) => g.rows.map((r) => r.itemId)),
    ).toContain('normal_only_probe');
  });

  it('shows the Heroic variant of a heroic-dungeon trash drop, and no heroic table in the open world', () => {
    const mobToDungeon = buildMobToDungeon();
    const trash = Object.values(MOBS).find((mob) => {
      const dungeon = mobToDungeon.get(mob.id);
      return (
        dungeon !== undefined &&
        HEROIC_DUNGEON_IDS.has(dungeon) &&
        mob.loot.some((e) => e.itemId && heroicLootItemId(e.itemId, true) !== e.itemId)
      );
    });
    if (!trash) throw new Error('content has a heroic-dungeon mob with a Heroic variant drop');
    const entry = trash.loot.find(
      (e) => e.itemId && heroicLootItemId(e.itemId, true) !== e.itemId,
    ) as LootEntry & { itemId: string };
    const variant = heroicLootItemId(entry.itemId, true);
    const heroicIds = (mobHeroicLootEntries(trash) ?? []).map((e) => e.itemId);
    expect(heroicIds).toContain(variant);
    expect(heroicIds).not.toContain(entry.itemId);
    // Open-world wolves are never under a Heroic claim.
    expect(mobHeroicLootEntries(WOLF)).toBeNull();
  });
});

describe('mobInspectTraits', () => {
  it('lists crowd-control immunity, slow immunity, and a harvestable corpse', () => {
    expect(
      mobInspectTraits({ ...WOLF, ccImmune: true, slowImmune: true, componentTags: ['hide'] }),
    ).toEqual(['ccImmune', 'slowImmune', 'harvestable']);
    expect(
      mobInspectTraits({ ...WOLF, ccImmune: false, slowImmune: false, componentTags: [] }),
    ).toEqual([]);
  });

  it('takes the immunities from the live read, which carries spawn-level flags', () => {
    const bare = { ...WOLF, ccImmune: false, slowImmune: false, componentTags: [] };
    // A promoted miniboss: the template has neither flag, the spawn has both.
    expect(mobInspectTraits(bare, { ccImmune: true, slowImmune: true })).toEqual([
      'ccImmune',
      'slowImmune',
    ]);
    // Each flag stands alone.
    expect(mobInspectTraits(bare, { ccImmune: false, slowImmune: true })).toEqual(['slowImmune']);
    // And the live model uses them.
    const m = buildMobInspectModel({
      subject: SUBJECT,
      viewerLevel: 6,
      info: info({ ccImmune: true, slowImmune: true }),
      pending: false,
    });
    expect(m?.traits).toEqual(expect.arrayContaining(['ccImmune', 'slowImmune']));
  });
});

describe('mobInspectSubjectOf', () => {
  it('accepts only an unowned mob with a template', () => {
    const mob = createMob(5, WOLF, 6, { x: 0, y: 0, z: 0 });
    expect(mobInspectSubjectOf(mob)).toEqual({
      id: 5,
      templateId: 'forest_wolf',
      level: 6,
      maxHp: mob.maxHp,
    });
    expect(mobInspectSubjectOf({ ...mob, ownerId: 3 })).toBeNull();
    expect(mobInspectSubjectOf({ ...mob, kind: 'player' })).toBeNull();
    expect(mobInspectSubjectOf({ ...mob, templateId: 'no_such_mob' })).toBeNull();
    expect(mobInspectSubjectOf(undefined)).toBeNull();
  });

  it('gives the same model for a Sim-shaped and a ClientWorld-shaped subject', () => {
    // Offline: the full sim Entity. Online: a mirror carrying only the wire
    // identity fields (tid, lv, mhp) the model reads.
    const simEntity: Entity = createMob(5, WOLF, 6, { x: 0, y: 0, z: 0 });
    const mirror = {
      id: 5,
      kind: 'mob' as const,
      ownerId: null,
      templateId: 'forest_wolf',
      level: 6,
      maxHp: simEntity.maxHp,
    };
    const a = mobInspectSubjectOf(simEntity);
    const b = mobInspectSubjectOf(mirror);
    if (!a || !b) throw new Error('both subjects resolve');
    const input = { viewerLevel: 6, info: info(), pending: false };
    expect(buildMobInspectModel({ subject: a, ...input })).toEqual(
      buildMobInspectModel({ subject: b, ...input }),
    );
  });
});

describe('mobTargetMenuRows', () => {
  it('offers Inspect and Cancel only when the mob is not markable', () => {
    const rows = mobTargetMenuRows({ markable: false, currentMarker: null });
    expect(rows.map((r) => r.act)).toEqual(['inspect', 'close']);
    expect(rows[0].label).toBe(t('hudChrome.mobInspect.menuInspect'));
  });

  it('keeps the full marker picker for a markable mob, checking the current marker', () => {
    const rows = mobTargetMenuRows({ markable: true, currentMarker: 2 });
    const acts = rows.map((r) => r.act);
    expect(acts[0]).toBe('inspect');
    expect(acts.slice(1, 9)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
    expect(acts.slice(9)).toEqual(['clear', 'close']);
    expect(rows.filter((r) => r.selected).map((r) => r.act)).toEqual(['m2']);
    expect(rows[3].aria).toContain(rows[3].label);
  });
});
