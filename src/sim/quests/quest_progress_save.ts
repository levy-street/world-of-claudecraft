import type { CharacterState } from '../character_state';
import type { PlayerMeta } from '../sim';

/** Detached quest progress for transactional character snapshots. */
export function savedQuestProgress(
  meta: Pick<PlayerMeta, 'questLog' | 'questsDone'>,
): Pick<CharacterState, 'questLog' | 'questsDone'> {
  return {
    questLog: [...meta.questLog.values()].map((q) => ({
      questId: q.questId,
      counts: [...q.counts],
      state: q.state,
      ...(q.selection === undefined ? {} : { selection: q.selection }),
      ...(q.resolvedCounts === undefined ? {} : { resolvedCounts: [...q.resolvedCounts] }),
      ...(q.burnedObjects === undefined
        ? {}
        : { burnedObjects: q.burnedObjects.map((b) => ({ key: b.key, at: b.at })) }),
      // Absent until the first interact credit (parity-stable saves).
      ...(q.creditedObjects === undefined ? {} : { creditedObjects: [...q.creditedObjects] }),
      ...(q.rev === undefined ? {} : { rev: q.rev }),
    })),
    questsDone: [...meta.questsDone],
  };
}
