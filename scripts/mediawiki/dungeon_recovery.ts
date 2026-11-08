import { DUNGEON_CHECKPOINTS } from '../../src/sim/content/dungeon_checkpoints';
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
      'After dying in this dungeon, release your spirit and return through the entrance to the same run. You revive at the latest unlocked, safe checkpoint below. A normal living entrance still uses the doorway.\n\n' +
        'A checkpoint requires every listed boss to be defeated and every listed gate to be open. During an active fight, or if enemies, hazards or obstacles make a checkpoint unsafe, you return to an earlier safe point or the entrance. The coordinates below are local to this dungeon.\n\n' +
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
              checkpoint.bosses.map((id) => w.link(w.titleBy.mob.get(id)!)).join(', ') +
              '. Open gates: ' +
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
      ['The numbered points below are recovery checkpoints, not quest objectives.'],
    )
  );
}
