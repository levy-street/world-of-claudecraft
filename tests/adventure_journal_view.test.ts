// The Adventure Journal's pure cores (src/ui/hud/journal/): the catalog of
// instances and the dev gate, the navigation model (the list, the landing
// page, the neighbours, the difficulty tabs and Mythic), and the Loot tab's
// drops read off the loot roller's own index.
import { describe, expect, it } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { SMITH_HEART_DUNGEON, SMITH_HEART_PLAYABLE } from '../src/sim/content/smith_heart';
import { SMITH_HEART_ESSENCE_QUEST } from '../src/sim/content/smith_heart_rewards';
import { MOBS } from '../src/sim/data';
import {
  COUNCIL_GUARDIAN,
  COUNCIL_SEAM_SINGER,
} from '../src/sim/encounters/smith_heart/council_ids';
import { HEAT_GUARDIAN } from '../src/sim/encounters/smith_heart/heat_ids';
import { IGNIVAR_MOLTEN_ASSEMBLY_ID, IGNIVAR_RAID_ARENA_ID } from '../src/sim/ignivar_raid_ids';
import {
  JOURNAL_INSTANCES,
  journalEntryForMob,
  journalHasPage,
  journalInstance,
  journalInstanceForRoom,
  visibleJournalInstances,
} from '../src/ui/hud/journal/journal_catalog';
import { journalLoot } from '../src/ui/hud/journal/journal_loot_view';
import {
  adjacentJournalBoss,
  buildJournalNav,
  type JournalProgress,
  journalClampTier,
  journalLandingBoss,
  journalPageState,
  journalRunTier,
  journalTierDifficulty,
} from '../src/ui/hud/journal/journal_nav_view';

const heart = () => journalInstance(SMITH_HEART_DUNGEON)!;
const sanctum = () => journalInstance('gravewyrm_sanctum')!;

function heartRun(
  rows: Partial<Record<string, { defeated?: boolean; engaged?: boolean }>>,
): JournalProgress {
  return {
    dungeonId: SMITH_HEART_DUNGEON,
    difficulty: 'heroic',
    bosses: [
      COUNCIL_GUARDIAN,
      COUNCIL_SEAM_SINGER,
      'heart_breath_guardian',
      'heart_quench_guardian',
      HEAT_GUARDIAN,
      'heart_masterless_strength',
    ].map((mobId) => ({
      mobId,
      defeated: rows[mobId]?.defeated ?? false,
      engaged: rows[mobId]?.engaged ?? false,
    })),
  };
}

describe('journal catalog', () => {
  it('lists the five dungeons, then the three raid instances', () => {
    expect(JOURNAL_INSTANCES.filter((i) => i.kind === 'dungeon').map((i) => i.id)).toEqual([
      'hollow_crypt',
      'sunken_bastion',
      'drowned_temple',
      'gravewyrm_sanctum',
      'wildheart_basin',
    ]);
    expect(JOURNAL_INSTANCES.filter((i) => i.kind === 'raid').map((i) => i.id)).toEqual([
      IGNIVAR_RAID_ARENA_ID,
      'nythraxis_boss_arena',
      SMITH_HEART_DUNGEON,
    ]);
    expect(journalInstance(IGNIVAR_RAID_ARENA_ID)?.source.bossKeys).toEqual(['ignivar', 'varkhul']);
  });

  it("gives the Smith's Heart five pages, the council as one page with both members", () => {
    expect(heart().source.bossKeys).toHaveLength(5);
    expect(heart().source.view(COUNCIL_GUARDIAN, 'normal').members).toEqual([
      COUNCIL_GUARDIAN,
      COUNCIL_SEAM_SINGER,
    ]);
    // Either council member opens the council page.
    expect(journalEntryForMob(COUNCIL_SEAM_SINGER)).toEqual({
      instanceId: SMITH_HEART_DUNGEON,
      bossKey: COUNCIL_GUARDIAN,
    });
    expect(journalEntryForMob('varkhul_forgefather_of_the_last_flame')).toEqual({
      instanceId: IGNIVAR_RAID_ARENA_ID,
      bossKey: 'varkhul',
    });
    expect(journalEntryForMob('a_mob_with_no_page')).toBeNull();
    expect(journalHasPage(SMITH_HEART_DUNGEON, COUNCIL_SEAM_SINGER)).toBe(true);
    expect(journalHasPage('gravewyrm_sanctum', COUNCIL_SEAM_SINGER)).toBe(false);
  });

  it('offers Mythic (Coming soon) only on the raid that has one', () => {
    expect(heart().tiers).toEqual(['normal', 'heroic', 'mythic']);
    for (const instance of JOURNAL_INSTANCES) {
      if (instance.id === SMITH_HEART_DUNGEON) continue;
      expect(instance.tiers, instance.id).toEqual(['normal', 'heroic']);
    }
    expect(journalClampTier(sanctum(), 'mythic')).toBe('heroic');
    expect(journalClampTier(heart(), 'mythic')).toBe('mythic');
    expect(journalTierDifficulty('mythic')).toBeNull();
    expect(journalTierDifficulty('heroic')).toBe('heroic');
  });

  it("gates the dev-only Smith's Heart behind dev tools or standing inside it", () => {
    expect(heart().released).toBe(SMITH_HEART_PLAYABLE);
    const ids = (list: { id: string }[]) => list.map((i) => i.id);
    if (!SMITH_HEART_PLAYABLE) {
      expect(ids(visibleJournalInstances(false, null))).not.toContain(SMITH_HEART_DUNGEON);
    }
    expect(ids(visibleJournalInstances(true, null))).toContain(SMITH_HEART_DUNGEON);
    expect(ids(visibleJournalInstances(false, SMITH_HEART_DUNGEON))).toContain(SMITH_HEART_DUNGEON);
  });

  it('maps every Crucible room to its instance, and an unknown room to none', () => {
    expect(journalInstanceForRoom(IGNIVAR_MOLTEN_ASSEMBLY_ID)?.id).toBe(IGNIVAR_RAID_ARENA_ID);
    expect(journalInstanceForRoom(SMITH_HEART_DUNGEON)?.id).toBe(SMITH_HEART_DUNGEON);
    expect(journalInstanceForRoom('nowhere')).toBeNull();
    expect(journalInstanceForRoom(null)).toBeNull();
  });
});

describe('journal navigation', () => {
  it('lands on the engaged boss before the next one standing', () => {
    const engaged = heartRun({
      [COUNCIL_GUARDIAN]: { defeated: true },
      [COUNCIL_SEAM_SINGER]: { defeated: true },
      [HEAT_GUARDIAN]: { engaged: true },
    });
    expect(journalLandingBoss(heart(), engaged, null)).toBe(HEAT_GUARDIAN);
    const idle = heartRun({
      [COUNCIL_GUARDIAN]: { defeated: true },
      [COUNCIL_SEAM_SINGER]: { defeated: true },
    });
    expect(journalLandingBoss(heart(), idle, null)).toBe('heart_breath_guardian');
    expect(journalRunTier(heart(), idle)).toBe('heroic');
    // A council page is down only with BOTH members down.
    const half = heartRun({ [COUNCIL_GUARDIAN]: { defeated: true } });
    expect(journalPageState(heart(), COUNCIL_GUARDIAN, half).defeated).toBe(false);
    expect(journalLandingBoss(heart(), half, null)).toBe(COUNCIL_GUARDIAN);
    // A dead body is never engaged.
    expect(
      journalPageState(
        heart(),
        HEAT_GUARDIAN,
        heartRun({ [HEAT_GUARDIAN]: { defeated: true, engaged: true } }),
      ),
    ).toEqual({ defeated: true, engaged: false, tracked: true });
  });

  it('passes an untracked miniboss once a later tracked page is down', () => {
    const keys = sanctum().source.bossKeys;
    const run = (defeated: string[]): JournalProgress => ({
      dungeonId: 'gravewyrm_sanctum',
      difficulty: 'normal',
      // The first page (a miniboss) is not a run row at all.
      bosses: keys.slice(1).map((mobId) => ({ mobId, defeated: defeated.includes(mobId) })),
    });
    expect(journalPageState(sanctum(), keys[0], run([])).tracked).toBe(false);
    expect(journalLandingBoss(sanctum(), run([]), null)).toBe(keys[0]);
    expect(journalLandingBoss(sanctum(), run([keys[1]]), null)).toBe(keys[2]);
  });

  it('lands on a shipped raid room boss, and on the first page with no run', () => {
    const crucible = journalInstance(IGNIVAR_RAID_ARENA_ID)!;
    expect(journalLandingBoss(crucible, null, 'varkhul')).toBe('varkhul');
    expect(journalLandingBoss(sanctum(), null, null)).toBe(sanctum().source.bossKeys[0]);
    // Another instance's run does not move this one.
    expect(journalLandingBoss(sanctum(), heartRun({}), null)).toBe(sanctum().source.bossKeys[0]);
    expect(journalRunTier(sanctum(), heartRun({}))).toBeNull();
  });

  it('steps to the previous and next page inside the instance only', () => {
    const keys = heart().source.bossKeys;
    expect(adjacentJournalBoss(heart(), keys[0], -1)).toBeNull();
    expect(adjacentJournalBoss(heart(), keys[0], 1)).toBe(keys[1]);
    expect(adjacentJournalBoss(heart(), keys[4], 1)).toBeNull();
    expect(adjacentJournalBoss(heart(), 'not_a_page', 1)).toBeNull();
  });

  it('builds the grouped list with the selection, progress and the room', () => {
    const groups = buildJournalNav(
      JOURNAL_INSTANCES,
      { instanceId: SMITH_HEART_DUNGEON, bossKey: HEAT_GUARDIAN },
      new Set([SMITH_HEART_DUNGEON]),
      heartRun({
        [COUNCIL_GUARDIAN]: { defeated: true },
        [COUNCIL_SEAM_SINGER]: { defeated: true },
      }),
      SMITH_HEART_DUNGEON,
    );
    expect(groups.map((g) => g.kind)).toEqual(['dungeon', 'raid']);
    const raid = groups[1].instances.find((i) => i.id === SMITH_HEART_DUNGEON)!;
    expect(raid).toMatchObject({
      expanded: true,
      current: true,
      holdsSelection: true,
      defeatedCount: 1,
    });
    expect(raid.bosses.filter((b) => b.selected).map((b) => b.key)).toEqual([HEAT_GUARDIAN]);
    expect(raid.bosses[0]).toMatchObject({
      defeated: true,
      members: [COUNCIL_GUARDIAN, COUNCIL_SEAM_SINGER],
    });
    expect(raid.bosses.at(-1)?.rank).toBe('final');
    const other = groups[0].instances[0];
    expect(other).toMatchObject({ expanded: false, current: false, holdsSelection: false });
    // A group with nothing visible is left out.
    expect(
      buildJournalNav(JOURNAL_INSTANCES.slice(0, 1), null, new Set(), null, null).map(
        (g) => g.kind,
      ),
    ).toEqual(['dungeon']);
  });
});

describe('journal loot', () => {
  it('lists the real drops per difficulty, heroic-only drops on Heroic only', () => {
    const boss = Object.keys(HEROIC_BOSS_LOOT).find((id) => journalEntryForMob(id))!;
    expect(boss).toBeTruthy();
    const heroicOnly = HEROIC_BOSS_LOOT[boss].map((e) => e.itemId);
    const normal = journalLoot([boss], 'normal').map((r) => r.itemId);
    const heroic = journalLoot([boss], 'heroic').map((r) => r.itemId);
    for (const id of heroicOnly) {
      expect(heroic).toContain(id);
      expect(normal).not.toContain(id);
    }
    for (const entry of MOBS[boss].loot ?? []) {
      if (entry.itemId && !entry.normalOnly) expect(heroic).toContain(entry.itemId);
    }
  });

  it("marks the Smith's Heart essence as a quest drop and merges a council's tables", () => {
    const rows = journalLoot(['heart_masterless_strength'], 'normal');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.gatedByQuestId === SMITH_HEART_ESSENCE_QUEST)).toBe(true);
    expect(journalLoot([COUNCIL_GUARDIAN, COUNCIL_SEAM_SINGER], 'heroic')).toEqual(
      [
        ...journalLoot([COUNCIL_GUARDIAN], 'heroic'),
        ...journalLoot([COUNCIL_SEAM_SINGER], 'heroic'),
      ].filter((row, i, all) => all.findIndex((r) => r.itemId === row.itemId) === i),
    );
  });
});
