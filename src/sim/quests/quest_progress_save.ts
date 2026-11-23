import type { CharacterState } from '../character_state';
import type { PlayerMeta } from '../sim';
import { savedQuestLog } from './quest_log_persist';

/** Detached quest progress for transactional character snapshots. */
export function savedQuestProgress(
  meta: Pick<PlayerMeta, 'questLog' | 'questsDone'>,
): Pick<CharacterState, 'questLog' | 'questsDone'> {
  return {
    questLog: savedQuestLog(meta),
    questsDone: [...meta.questsDone],
  };
}
