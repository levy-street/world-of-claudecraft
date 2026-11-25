import { DUNGEON_CHECKPOINTS } from '../../src/sim/content/dungeon_checkpoints';
import { MOBS } from '../../src/sim/data';
import type { DungeonDef } from '../../src/sim/types';
import type { ArticleTools } from './entity_format';
import { questMap } from './quest_map';

export function dungeonRecovery(
  dungeon: DungeonDef,
  w: Pick<ArticleTools, 'section' | 'bullets' | 'link' | 'titleBy'>,
): string {
  const checkpoints = DUNGEON_CHECKPOINTS[dungeon.id];
  if (!checkpoints?.length) return '';
  return (
    w.section(
      'Recovery checkpoints',
      'If you die in this dungeon, release your spirit. Then walk back in through the entrance to the same run. You come back to life at the latest safe checkpoint you have unlocked (listed below). If you walk in while alive, you start at the doorway as usual.\n\n' +
        'A checkpoint unlocks when every boss listed for it is defeated and every gate listed for it is open. A checkpoint is not safe while a fight is going on, or when enemies, hazards or obstacles are in the way. Then you come back at an earlier safe point or at the entrance instead. The coordinates below are measured inside this dungeon, not on the world map.\n\n' +
        w.bullets(
          checkpoints.map(
            (checkpoint, i) =>
              'Checkpoint ' +
              (i + 1) +
              ' at (' +
              checkpoint.pos.x +
              ', ' +
              checkpoint.pos.z +
              '). Defeat ' +
              checkpoint.bosses
                .map((id) => w.link(w.titleBy.mob.get(id)!, MOBS[id]?.name))
                .join(', ') +
              '. These gates must be open: ' +
              checkpoint.gates
                .map((id) => dungeon.gates?.find((g) => g.id === id)?.name ?? id)
                .join(', ') +
              '.',
          ),
        ),
    ) +
    questMap(
      {
        points: checkpoints.map((checkpoint, i) => ({
          step: i + 1,
          frame: dungeon.name,
          label: 'Recovery checkpoint ' + (i + 1),
          ...checkpoint.pos,
        })),
      },
      'system',
      ['The numbers on this map are recovery checkpoints, not quest steps.'],
    )
  );
}
