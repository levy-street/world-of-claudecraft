import { WORLD_QUESTS_BY_ID } from '../sim/data';
import type { WorldQuestMatch3Candy, WorldQuestProgress } from '../sim/types';
import {
  resolveWorldQuestMatch3Level,
  worldQuestDisplayedLevel,
} from '../sim/world_quest_daily_levels';
import { sanitizeWorldQuestMatch3Board } from '../sim/world_quest_match3';
import { formatNumber, type TranslationKey, t } from './i18n';
import { ownEntry } from './known_item';

export interface WorldQuestMatch3CellView {
  index: number;
  row: number;
  column: number;
  candy: WorldQuestMatch3Candy;
  symbol: string;
  ariaLabel: string;
}

export interface WorldQuestMatch3View {
  questId: string;
  level: number;
  columns: number;
  rows: number;
  moves: number;
  movesKnown: boolean;
  maxMoves: number;
  cleared: number;
  target: number;
  outcome: 'playing' | 'won' | 'lost';
  exhausted: boolean;
  cells: WorldQuestMatch3CellView[];
}

/** UI-only metadata distinguishes a final counter from a retained pre-win counter. */
export interface WorldQuestMatch3PresentationProgress extends WorldQuestProgress {
  movesKnown?: boolean;
}

const CANDY_SYMBOLS = ['\u25c6', '\u25cf', '\u25b2', '\u25a0', '\u2605'] as const;
const CANDY_KEYS = ['berry', 'citrus', 'mint', 'grape', 'star'] as const;

export function buildWorldQuestMatch3View(
  questId: string,
  progress: WorldQuestMatch3PresentationProgress | undefined,
): WorldQuestMatch3View | null {
  const quest = ownEntry(WORLD_QUESTS_BY_ID, questId);
  if (!quest || quest.objective.type !== 'match3' || !progress || progress.questId !== questId)
    return null;
  const level = resolveWorldQuestMatch3Level(quest, progress);
  if (!level) return null;
  const board = sanitizeWorldQuestMatch3Board(progress.match3Board, level);
  const moves = Math.max(0, progress.match3Moves ?? 0);
  const won = progress.state === 'completed' || progress.count >= level.target;
  return {
    questId,
    level: worldQuestDisplayedLevel(progress, quest.objective.levels.length),
    columns: level.columns,
    rows: level.rows,
    moves,
    movesKnown:
      progress.movesKnown ?? (progress.state === 'active' || progress.match3Moves !== undefined),
    maxMoves: level.maxMoves,
    cleared: Math.min(quest.count, progress.count),
    target: level.target,
    outcome: won ? 'won' : moves >= level.maxMoves ? 'lost' : 'playing',
    exhausted: !won && moves >= level.maxMoves,
    cells: board.map((candy, index) => ({
      index,
      row: Math.floor(index / level.columns) + 1,
      column: (index % level.columns) + 1,
      candy,
      symbol: CANDY_SYMBOLS[candy],
      ariaLabel: t('questUi.worldQuest.match3Cell', {
        row: formatNumber(Math.floor(index / level.columns) + 1, { maximumFractionDigits: 0 }),
        column: formatNumber((index % level.columns) + 1, { maximumFractionDigits: 0 }),
        candy: t(`questUi.worldQuest.match3Candy.${CANDY_KEYS[candy]}` as TranslationKey),
      }),
    })),
  };
}
