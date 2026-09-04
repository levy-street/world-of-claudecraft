import { WORLD_QUESTS_BY_ID } from '../sim/data';
import type { WorldQuestBeamSide, WorldQuestProgress } from '../sim/types';
import {
  sanitizeWorldQuestPuzzleRotations,
  traceWorldQuestPuzzle,
  worldQuestPuzzleConnectors,
} from '../sim/world_quest_puzzle';
import { formatList, formatNumber, type TranslationKey, t } from './i18n';
import { ownEntry } from './known_item';

export interface WorldQuestPuzzleTileView {
  index: number;
  rotation: number;
  connectors: readonly WorldQuestBeamSide[];
  powered: boolean;
  sourceSide?: WorldQuestBeamSide;
  targetSide?: WorldQuestBeamSide;
  ariaLabel: string;
}

export interface WorldQuestPuzzleView {
  questId: string;
  level: number;
  columns: number;
  rows: number;
  solved: boolean;
  tiles: WorldQuestPuzzleTileView[];
}

export function buildWorldQuestPuzzleView(
  questId: string,
  progress: WorldQuestProgress | undefined,
): WorldQuestPuzzleView | null {
  const quest = ownEntry(WORLD_QUESTS_BY_ID, questId);
  if (quest?.objective.type !== 'puzzle' || progress?.state !== 'active') return null;
  const level = Math.max(
    0,
    Math.min(quest.objective.puzzles.length - 1, progress.puzzleVariant ?? 0),
  );
  const puzzle = quest.objective.puzzles[level];
  if (!puzzle) return null;
  const rotations = sanitizeWorldQuestPuzzleRotations(progress.puzzleRotations, puzzle);
  const trace = traceWorldQuestPuzzle(puzzle, rotations);
  const powered = new Set(trace.path);
  return {
    questId,
    level: level + 1,
    columns: puzzle.columns,
    rows: puzzle.rows,
    solved: trace.solved,
    tiles: puzzle.tiles.map((tile, index) => {
      const connectors = worldQuestPuzzleConnectors(tile.kind, rotations[index]);
      const isPowered = powered.has(index);
      const sourceSide = puzzle.source.tileIndex === index ? puzzle.source.side : undefined;
      const targetSide = puzzle.target.tileIndex === index ? puzzle.target.side : undefined;
      const direction = (side: WorldQuestBeamSide): string =>
        t(`hud.core.mapMarkerDirections.${side}` as TranslationKey);
      const source = sourceSide
        ? t('questUi.worldQuest.puzzleSourceEndpoint', { direction: direction(sourceSide) })
        : '';
      const target = targetSide
        ? t('questUi.worldQuest.puzzleTargetEndpoint', { direction: direction(targetSide) })
        : '';
      return {
        index,
        rotation: rotations[index],
        connectors,
        powered: isPowered,
        ...(sourceSide ? { sourceSide } : {}),
        ...(targetSide ? { targetSide } : {}),
        ariaLabel: t('questUi.worldQuest.puzzleTileAria', {
          rotation: t('questUi.worldQuest.puzzleRotateTile', {
            tile: formatNumber(index + 1, { maximumFractionDigits: 0 }),
          }),
          connectors: t('questUi.worldQuest.puzzleConnectors', {
            connectors: formatList(connectors.map(direction)),
          }),
          power: t(
            isPowered ? 'questUi.worldQuest.puzzlePowered' : 'questUi.worldQuest.puzzleUnpowered',
          ),
          source,
          target,
        }),
      };
    }),
  };
}
