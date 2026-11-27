// Pure navigation model of the Adventure Journal: the Dungeons and Raids list
// with its expandable instances and boss rows, the selected page, the previous
// and next boss, the difficulty tabs an instance offers, and where the journal
// lands when it opens (the room's instance, on the engaged boss, else the next
// one standing). DOM-free and world-free: the window hands in the instances it
// may show and the run it reads off IWorld (dungeonRun / raidRun) as plain data.

import type { DungeonDifficulty } from '../../../sim/types';
import type { JournalDifficulty, JournalRank } from '../../boss_journal/journal_view';
import type { JournalInstance, JournalInstanceKind, JournalTier } from './journal_catalog';
import { journalPageBodies } from './journal_catalog';

export type JournalTab = 'overview' | 'abilities' | 'loot';
export const JOURNAL_TABS: readonly JournalTab[] = ['overview', 'abilities', 'loot'];

/** One boss body's state in the run the player stands in. */
export interface JournalProgressRow {
  mobId: string;
  defeated: boolean;
  engaged?: boolean;
}

/** The run the player stands in (IWorld.dungeonRun or IWorld.raidRun). */
export interface JournalProgress {
  dungeonId: string;
  difficulty: DungeonDifficulty;
  bosses: readonly JournalProgressRow[];
}

export interface JournalPageState {
  defeated: boolean;
  engaged: boolean;
  /** Whether the run tracks this page at all (an untracked miniboss is not). */
  tracked: boolean;
}

/** A page's state in a run: defeated once every body is down, engaged while
 *  any body fights. A page whose bodies the run does not list is untracked. */
export function journalPageState(
  instance: JournalInstance,
  bossKey: string,
  progress: JournalProgress | null,
): JournalPageState {
  const own = progress && progress.dungeonId === instance.id ? progress : null;
  if (!own) return { defeated: false, engaged: false, tracked: false };
  let tracked = false;
  let defeated = true;
  let engaged = false;
  for (const body of journalPageBodies(instance.source, bossKey)) {
    const row = own.bosses.find((r) => r.mobId === body);
    if (!row) {
      defeated = false;
      continue;
    }
    tracked = true;
    if (!row.defeated) defeated = false;
    if (row.engaged && !row.defeated) engaged = true;
  }
  return { defeated: tracked && defeated, engaged, tracked };
}

/** Where the journal lands inside an instance: the shipped raid room's own
 *  boss, else the engaged page, else the first page still standing (an
 *  untracked miniboss counts as passed once a later tracked page is down),
 *  else the first page. */
export function journalLandingBoss(
  instance: JournalInstance,
  progress: JournalProgress | null,
  roomBoss: string | null,
): string {
  const keys = instance.source.bossKeys;
  if (roomBoss && keys.includes(roomBoss)) return roomBoss;
  const states = keys.map((key) => journalPageState(instance, key, progress));
  const engaged = keys.findIndex((_, i) => states[i].engaged);
  if (engaged >= 0) return keys[engaged];
  const next = keys.findIndex((_, i) => {
    if (states[i].tracked) return !states[i].defeated;
    return !states.slice(i + 1).some((later) => later.defeated);
  });
  return keys[next >= 0 ? next : 0];
}

/** The difficulty tab a run plays on, when the run is this instance's. */
export function journalRunTier(
  instance: JournalInstance,
  progress: JournalProgress | null,
): JournalTier | null {
  if (!progress || progress.dungeonId !== instance.id) return null;
  return progress.difficulty === 'heroic' ? 'heroic' : 'normal';
}

/** A tier the instance offers (an instance without Mythic falls back to Heroic). */
export function journalClampTier(instance: JournalInstance, tier: JournalTier): JournalTier {
  if (instance.tiers.includes(tier)) return tier;
  return tier === 'mythic' ? 'heroic' : instance.tiers[0];
}

/** The sim difficulty a tab reads its numbers on; null for a tier with no
 *  content yet (Mythic: the Coming soon panel). */
export function journalTierDifficulty(tier: JournalTier): JournalDifficulty | null {
  return tier === 'mythic' ? null : tier;
}

/** The page before or after `bossKey` inside its instance, or null at an end. */
export function adjacentJournalBoss(
  instance: JournalInstance,
  bossKey: string,
  step: -1 | 1,
): string | null {
  const keys = instance.source.bossKeys;
  const at = keys.indexOf(bossKey);
  if (at < 0) return null;
  return keys[at + step] ?? null;
}

export interface JournalNavBoss {
  key: string;
  /** The page's lead body (its name and portrait). */
  mobId: string;
  /** Every body the page covers (two for a council). */
  members: readonly string[];
  portraitUrl: string;
  rank: JournalRank;
  selected: boolean;
  defeated: boolean;
  engaged: boolean;
}

export interface JournalNavInstance {
  id: string;
  kind: JournalInstanceKind;
  expanded: boolean;
  /** The player stands inside this instance. */
  current: boolean;
  /** The selected page belongs to this instance. */
  holdsSelection: boolean;
  bosses: readonly JournalNavBoss[];
  defeatedCount: number;
}

export interface JournalNavGroup {
  kind: JournalInstanceKind;
  instances: readonly JournalNavInstance[];
}

export interface JournalSelection {
  instanceId: string;
  bossKey: string;
}

/** The navigation list: Dungeons then Raids (a group with nothing to show is
 *  left out), each instance with its boss rows in route order. */
export function buildJournalNav(
  instances: readonly JournalInstance[],
  selection: JournalSelection | null,
  expanded: ReadonlySet<string>,
  progress: JournalProgress | null,
  currentInstanceId: string | null,
): JournalNavGroup[] {
  const groups: JournalNavGroup[] = [];
  for (const kind of ['dungeon', 'raid'] as const) {
    const rows: JournalNavInstance[] = instances
      .filter((instance) => instance.kind === kind)
      .map((instance) => {
        const bosses = instance.source.bossKeys.map((key): JournalNavBoss => {
          const view = instance.source.view(key, 'normal');
          const state = journalPageState(instance, key, progress);
          return {
            key,
            mobId: view.mobId,
            members: view.members ?? [view.mobId],
            portraitUrl: view.portraitUrl,
            rank: view.rank ?? 'boss',
            selected: selection?.instanceId === instance.id && selection.bossKey === key,
            defeated: state.defeated,
            engaged: state.engaged,
          };
        });
        return {
          id: instance.id,
          kind,
          expanded: expanded.has(instance.id),
          current: instance.id === currentInstanceId,
          holdsSelection: selection?.instanceId === instance.id,
          bosses,
          defeatedCount: bosses.filter((boss) => boss.defeated).length,
        };
      });
    if (rows.length > 0) groups.push({ kind, instances: rows });
  }
  return groups;
}
