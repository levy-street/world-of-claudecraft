// The Adventure Journal's catalog: every instance the journal lists, grouped
// as Dungeons and Raids, each wrapping one journal SOURCE (src/ui/boss_journal/)
// that owns its bosses, phases and per-difficulty numbers. This module only
// arranges what already exists: the five-player dungeon pages
// (boss_journal/registry.ts), the shipped raid guide (raid_boss_guide_view.ts,
// split here by the instance each boss lives in) and the Smith's Heart's
// data-as-code page (boss_journal/raids/smith_heart.ts). Pure: content imports
// and string keys only, no DOM and no world read.

import { SMITH_HEART_DUNGEON, SMITH_HEART_PLAYABLE } from '../../../sim/content/smith_heart';
import { IGNIVAR_RAID_ARENA_ID } from '../../../sim/ignivar_raid_ids';
import type { JournalSource } from '../../boss_journal/journal_view';
import { dungeonJournalSource, RAID_JOURNAL_SOURCE } from '../../boss_journal/journal_view';
import { SMITH_HEART_JOURNAL } from '../../boss_journal/raids/smith_heart';
import { DUNGEON_JOURNALS, dungeonJournalSourceFor } from '../../boss_journal/registry';
import {
  NYTHRAXIS_BOSS_ARENA_ID,
  type RaidBossGuideBoss,
  raidBossGuideBossForDungeon,
} from '../../raid_boss_guide_view';

/** The journal's difficulty tabs. Mythic is a tier the sim does not run yet:
 *  an instance that lists it shows a Coming soon panel there. */
export type JournalTier = 'normal' | 'heroic' | 'mythic';
export type JournalInstanceKind = 'dungeon' | 'raid';

export interface JournalInstance {
  /** The instance id (a dungeon id; a raid's finder dungeon id). */
  id: string;
  kind: JournalInstanceKind;
  source: JournalSource;
  /** The difficulty tabs this instance offers, in order. */
  tiers: readonly JournalTier[];
  /** False while the instance is dev-gated: the journal lists it only when
   *  the client may offer dev tools, or while the player stands inside it. */
  released: boolean;
  /** The shipped raid guide's pages keep their own number formatting. */
  legacyFormat: boolean;
}

const LIVE_TIERS: readonly JournalTier[] = ['normal', 'heroic'];
const WITH_MYTHIC: readonly JournalTier[] = ['normal', 'heroic', 'mythic'];

/** One instance's slice of the shipped raid guide (its bosses only). */
function raidGuideSlice(id: string, bosses: readonly RaidBossGuideBoss[]): JournalSource {
  return { id, kind: 'raid', bossKeys: bosses, view: RAID_JOURNAL_SOURCE.view };
}

const DUNGEON_INSTANCES: readonly JournalInstance[] = DUNGEON_JOURNALS.map((def) => ({
  id: def.dungeonId,
  kind: 'dungeon',
  source: dungeonJournalSourceFor(def.dungeonId) ?? dungeonJournalSource(def),
  tiers: LIVE_TIERS,
  released: true,
  legacyFormat: false,
}));

// The Raids list reads top to bottom in this order (the owner's call): the
// Nythraxis Raid Arena above the Crucible of the Last Spring, then the
// Smith's Heart. Pinned by tests/adventure_journal_view.test.ts.
const RAID_INSTANCES: readonly JournalInstance[] = [
  {
    id: NYTHRAXIS_BOSS_ARENA_ID,
    kind: 'raid',
    source: raidGuideSlice(NYTHRAXIS_BOSS_ARENA_ID, ['nythraxis']),
    tiers: LIVE_TIERS,
    released: true,
    legacyFormat: true,
  },
  {
    id: IGNIVAR_RAID_ARENA_ID,
    kind: 'raid',
    source: raidGuideSlice(IGNIVAR_RAID_ARENA_ID, ['ignivar', 'varkhul']),
    tiers: LIVE_TIERS,
    released: true,
    legacyFormat: true,
  },
  {
    id: SMITH_HEART_DUNGEON,
    kind: 'raid',
    source: dungeonJournalSource(SMITH_HEART_JOURNAL, 'raid'),
    tiers: WITH_MYTHIC,
    released: SMITH_HEART_PLAYABLE,
    legacyFormat: false,
  },
];

/** Every instance the journal knows, Dungeons first, each group in its order. */
export const JOURNAL_INSTANCES: readonly JournalInstance[] = [
  ...DUNGEON_INSTANCES,
  ...RAID_INSTANCES,
];

const BY_ID = new Map(JOURNAL_INSTANCES.map((instance) => [instance.id, instance]));

export function journalInstance(id: string): JournalInstance | null {
  return BY_ID.get(id) ?? null;
}

/** The journal instance a room belongs to: a dungeon, the Smith's Heart, or a
 *  shipped raid room (the Crucible's four rooms, the Nythraxis arena). */
export function journalInstanceForRoom(dungeonId: string | null): JournalInstance | null {
  if (!dungeonId) return null;
  const own = BY_ID.get(dungeonId);
  if (own) return own;
  const raidBoss = raidBossGuideBossForDungeon(dungeonId);
  if (!raidBoss) return null;
  return RAID_INSTANCES.find((instance) => instance.source.bossKeys.includes(raidBoss)) ?? null;
}

/** The boss a shipped raid ROOM is about (the guide's room-to-boss rule), so a
 *  page opens on the Crucible boss whose room the player stands in. */
export function journalRoomBoss(dungeonId: string | null): string | null {
  return raidBossGuideBossForDungeon(dungeonId);
}

/** Every body a page covers: a council's members, else the page's boss. */
export function journalPageBodies(source: JournalSource, bossKey: string): readonly string[] {
  const view = source.view(bossKey, 'normal');
  return view.members ?? [view.mobId];
}

/** Whether an instance's journal has a page covering this mob (the Dungeon
 *  Finder's Boss Guide button). */
export function journalHasPage(dungeonId: string, mobId: string): boolean {
  const instance = BY_ID.get(dungeonId);
  if (!instance) return false;
  return instance.source.bossKeys.some((key) =>
    journalPageBodies(instance.source, key).includes(mobId),
  );
}

export interface JournalEntryRef {
  instanceId: string;
  bossKey: string;
}

let byMob: Map<string, JournalEntryRef> | null = null;

/** The journal page a mob template has (a council member opens its council's
 *  page), or null. Built once from the static catalog. */
export function journalEntryForMob(mobId: string): JournalEntryRef | null {
  if (!byMob) {
    byMob = new Map();
    for (const instance of JOURNAL_INSTANCES) {
      for (const bossKey of instance.source.bossKeys) {
        for (const body of journalPageBodies(instance.source, bossKey)) {
          if (!byMob.has(body)) byMob.set(body, { instanceId: instance.id, bossKey });
        }
      }
    }
  }
  return byMob.get(mobId) ?? null;
}

/** The instances a player may browse: released ones, plus a gated one while
 *  dev tools are on or while the player stands inside it. */
export function visibleJournalInstances(
  showUnreleased: boolean,
  currentInstanceId: string | null,
): JournalInstance[] {
  return JOURNAL_INSTANCES.filter(
    (instance) => instance.released || showUnreleased || instance.id === currentInstanceId,
  );
}
