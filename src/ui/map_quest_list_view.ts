// Pure model for the world-map quest side list (the WoW-style numbered quest
// panel next to the map): which quests to list, their 1-based numbers in
// acceptance order (the quest log's insertion order, which both the offline
// Sim and the online ClientWorld mirror preserve), and whether each is
// tracked (painted as a blue objective area + numbered badge on the map).
// DOM-free / i18n-free: the HUD resolves titles and button labels; this module
// owns the ordering rules and the localStorage parse/serialize for the
// player's untracked set (default = tracked, so a new quest shows at once).

import type { QuestProgress } from '../sim/types';

export interface MapQuestListEntry {
  questId: string;
  /** 1-based position in acceptance order; also the map badge number. */
  number: number;
  /** Turn-in ready: listed and numbered, but it has no objective areas left. */
  ready: boolean;
  /** false = the player hid this quest's areas from the map. */
  tracked: boolean;
}

/** 1-based quest number by acceptance order, for every quest in the log. */
export function questNumbersByLog(
  questLog: ReadonlyMap<string, QuestProgress>,
): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const questId of questLog.keys()) numbers.set(questId, numbers.size + 1);
  return numbers;
}

/** The side-list rows, in acceptance order. */
export function mapQuestListView(
  questLog: ReadonlyMap<string, QuestProgress>,
  untracked: ReadonlySet<string>,
): MapQuestListEntry[] {
  const out: MapQuestListEntry[] = [];
  for (const qp of questLog.values()) {
    out.push({
      questId: qp.questId,
      number: out.length + 1,
      ready: qp.state !== 'active',
      tracked: !untracked.has(qp.questId),
    });
  }
  return out;
}

// Persistence: the set of quest ids the player untracked. Parsing is
// defensive (corrupt or forward-version blobs fall back to "track all")
// and drops non-string entries, mirroring parseChatTabs.
export function parseUntrackedQuests(raw: string | null): Set<string> {
  if (!raw) return new Set();
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(arr)) return new Set();
  const out = new Set<string>();
  for (const v of arr) if (typeof v === 'string') out.add(v);
  return out;
}

export function serializeUntrackedQuests(untracked: ReadonlySet<string>): string {
  return JSON.stringify([...untracked]);
}
