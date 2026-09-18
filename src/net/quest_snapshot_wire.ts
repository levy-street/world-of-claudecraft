// Delta-safe decode for the ordinary and world-quest owner snapshot keys.
// ClientWorld-free by design: malformed/version-skewed world-quest rows are
// dropped without throwing or partially replacing the last good mirror.

import type { QuestProgress, WorldQuestProgress } from '../sim/types';
import { decodeForgeState } from '../sim/world_quest_forge_wire';
import { decodeGliderState } from '../sim/world_quest_glider_wire';
import { decodeInvestigationState } from '../sim/world_quest_investigation_wire';
import { decodeShadowState } from '../sim/world_quest_shadow_wire';
import { decodeWorldQuestProgressTrace } from '../sim/world_quest_trace_wire';
import { decodeWispMazeState } from '../sim/world_quest_wisp_maze_wire';
import { sanitizeWorldQuestCycle, sanitizeWorldQuestProgress } from '../sim/world_quests';
import { applyFactionSelfWire, type FactionSelfMirrors } from './faction_snapshot_wire';

export interface QuestSelfMirrors extends Partial<FactionSelfMirrors> {
  questLog: Map<string, QuestProgress>;
  questsDone: Set<string>;
  worldQuestCycle: string;
  worldQuestExpiresAtMs: number;
  worldQuestTime?: number;
  worldQuestLog: ReadonlyMap<string, WorldQuestProgress>;
}

function isQuestProgress(value: unknown): value is QuestProgress {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<QuestProgress>;
  return (
    typeof row.questId === 'string' && Array.isArray(row.counts) && typeof row.state === 'string'
  );
}

/** Apply the four quest-family self keys. Omission retains the previous mirror;
 *  a malformed container does too, while malformed world-quest rows inside a
 *  valid array are individually discarded by the catalog-aware sanitizer. */
export function applyQuestSelfWire(
  target: QuestSelfMirrors,
  self: {
    qlog?: unknown;
    qdone?: unknown;
    wqday?: unknown;
    wqexp?: unknown;
    wqlog?: unknown;
    fac?: unknown;
    wqrr?: unknown;
    wqrep?: unknown;
  },
  simTime?: unknown,
): void {
  if (typeof simTime === 'number' && Number.isFinite(simTime) && simTime >= 0) {
    target.worldQuestTime = simTime;
  }
  if (Array.isArray(self.qlog)) {
    target.questLog = new Map(
      self.qlog.filter(isQuestProgress).map((progress) => [progress.questId, progress]),
    );
  }
  if (Array.isArray(self.qdone)) {
    target.questsDone = new Set(self.qdone.filter((id): id is string => typeof id === 'string'));
  }
  const incomingCycle =
    self.wqday === undefined ? target.worldQuestCycle : sanitizeWorldQuestCycle(self.wqday);
  const malformedExplicitCycle = self.wqday !== undefined && incomingCycle === '';
  if (
    !malformedExplicitCycle &&
    typeof self.wqexp === 'number' &&
    Number.isSafeInteger(self.wqexp) &&
    self.wqexp > 0
  ) {
    target.worldQuestExpiresAtMs = self.wqexp;
  }
  if (Array.isArray(self.wqlog) && !malformedExplicitCycle) {
    const rawRows = self.wqlog;
    target.worldQuestLog = new Map(
      sanitizeWorldQuestProgress(rawRows, incomingCycle, true).map((progress) => {
        const raw = rawRows.find(
          (row) =>
            row &&
            typeof row === 'object' &&
            row.questId === progress.questId &&
            (row.state === 'active' || row.state === 'completed'),
        );
        const tracing = decodeWorldQuestProgressTrace(raw?.tracing, progress);
        const forging = decodeForgeState(raw?.forging, progress.questId);
        const wispMaze = decodeWispMazeState(raw?.wispMaze, progress.questId);
        const glider = decodeGliderState(raw?.glider, progress.questId);
        const shadow =
          progress.state === 'active'
            ? decodeShadowState(raw?.shadow, progress.questId)
            : undefined;
        const investigation = decodeInvestigationState(raw?.investigation, progress.questId);
        return [
          progress.questId,
          {
            ...progress,
            ...(tracing ? { tracing } : {}),
            ...(forging ? { forging } : {}),
            ...(wispMaze ? { wispMaze } : {}),
            ...(glider ? { glider } : {}),
            ...(investigation ? { investigation } : {}),
            ...(shadow ? { shadow } : {}),
          },
        ];
      }),
    );
    if (incomingCycle) target.worldQuestCycle = incomingCycle;
  } else if (
    !malformedExplicitCycle &&
    incomingCycle &&
    (incomingCycle === target.worldQuestCycle || target.worldQuestLog.size === 0)
  ) {
    // A realm rollover can legitimately omit an unchanged empty array. Never
    // adopt a new cycle beside a retained non-empty log from the old cycle.
    target.worldQuestCycle = incomingCycle;
  }
  // Faction standing and the daily reroll, after the cycle above is settled.
  applyFactionSelfWire(target, self);
}
