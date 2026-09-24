// The map rail's "world quests today" section, pure: the character's board for
// the current cycle (the shared rotation with this character's personal
// replacements applied, the same list src/sim/world_quest_reroll.ts uses to
// credit progress), each row's state, the selected row (shared with the map's
// marker selection), and whether the one daily replacement is still available.
// DOM-free and clock-free; the controller hands in `nowMs` and the world.
import type { FactionId } from '../../../sim/factions';
import { worldQuestFaction } from '../../../sim/factions';
import type { WorldQuestProgress } from '../../../sim/types';
import { playerActiveWorldQuests } from '../../../sim/world_quest_reroll';

export type WorldQuestRailState = 'available' | 'active' | 'completed';

export interface WorldQuestRailRow {
  readonly questId: string;
  readonly zoneId: string;
  readonly factionId: FactionId;
  readonly state: WorldQuestRailState;
  readonly selected: boolean;
  /** True when this row replaced another quest through today's reroll. */
  readonly replacement: boolean;
  /** True when the character's level is below the quest's minimum. */
  readonly belowLevel: boolean;
}

/** The sim's refusal reasons, re-localized by identity (never shown as English). */
export type WorldQuestRerollReason =
  | 'noCycle'
  | 'usedToday'
  | 'completed'
  | 'inProgress'
  | 'notActive'
  | 'noAlternative'
  | 'unknown';

export interface WorldQuestRailRerollView {
  /** The selected row the button acts on; null when nothing is selected. */
  readonly questId: string | null;
  readonly canReroll: boolean;
  /** Why not, when `canReroll` is false and a row is selected. */
  readonly reason: WorldQuestRerollReason | null;
  /** Whether today's single replacement has already been spent. */
  readonly usedToday: boolean;
}

export interface WorldQuestRailView {
  readonly rows: readonly WorldQuestRailRow[];
  readonly completed: number;
  readonly total: number;
  readonly expiresAtMs: number;
  readonly reroll: WorldQuestRailRerollView;
}

export interface WorldQuestRailInput {
  readonly worldQuestCycle: string;
  readonly worldQuestLog: ReadonlyMap<string, WorldQuestProgress>;
  readonly worldQuestReplacements?: Readonly<Record<string, string>>;
  readonly worldQuestRerollCycle?: string;
  readonly worldQuestExpiresAtMs: number;
  readonly playerLevel: number;
  readonly selectedWorldQuestId: string | null;
  /** The host's authoritative check (IWorld.canRerollWorldQuest); absent on a host without it. */
  readonly canReroll?: (questId: string) => { canReroll: boolean; reason?: string };
}

const REASON_BY_TEXT: ReadonlyMap<string, WorldQuestRerollReason> = new Map([
  ['No active world quest cycle.', 'noCycle'],
  ['Daily world quest reroll already used today.', 'usedToday'],
  ['Completed world quests cannot be rerolled.', 'completed'],
  ['In-progress world quests cannot be rerolled.', 'inProgress'],
  ['This world quest is not currently active for you.', 'notActive'],
  ['No alternative assignments available in this zone today.', 'noAlternative'],
]);

/** Map a sim refusal text to its identity; unknown wording degrades to `unknown`. */
export function worldQuestRerollReason(text: string | undefined): WorldQuestRerollReason {
  if (!text) return 'unknown';
  return REASON_BY_TEXT.get(text) ?? 'unknown';
}

export function buildWorldQuestRailView(input: WorldQuestRailInput): WorldQuestRailView {
  const replacements = input.worldQuestReplacements ?? {};
  const replacementIds = new Set(Object.values(replacements));
  const board = input.worldQuestCycle
    ? playerActiveWorldQuests({
        worldQuestCycle: input.worldQuestCycle,
        worldQuestReplacements: { ...replacements },
      })
    : [];
  const rows: WorldQuestRailRow[] = [];
  let completed = 0;
  for (const quest of board) {
    const progress = input.worldQuestLog.get(quest.id);
    const state: WorldQuestRailState =
      progress?.state === 'completed'
        ? 'completed'
        : progress?.state === 'active'
          ? 'active'
          : 'available';
    if (state === 'completed') completed++;
    rows.push({
      questId: quest.id,
      zoneId: quest.zoneId,
      factionId: worldQuestFaction(quest),
      state,
      selected: quest.id === input.selectedWorldQuestId,
      replacement: replacementIds.has(quest.id),
      belowLevel: input.playerLevel < quest.minLevel,
    });
  }
  const usedToday =
    Boolean(input.worldQuestCycle) && input.worldQuestRerollCycle === input.worldQuestCycle;
  const selected = rows.find((row) => row.selected) ?? null;
  let reroll: WorldQuestRailRerollView;
  if (!selected) {
    reroll = { questId: null, canReroll: false, reason: null, usedToday };
  } else if (!input.canReroll) {
    reroll = { questId: selected.questId, canReroll: false, reason: 'unknown', usedToday };
  } else {
    const check = input.canReroll(selected.questId);
    reroll = {
      questId: selected.questId,
      canReroll: check.canReroll,
      reason: check.canReroll ? null : worldQuestRerollReason(check.reason),
      usedToday,
    };
  }
  return { rows, completed, total: rows.length, expiresAtMs: input.worldQuestExpiresAtMs, reroll };
}
