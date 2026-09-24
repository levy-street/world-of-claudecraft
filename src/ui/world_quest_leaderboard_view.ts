// Pure view core for the World Quest rankings: which boards exist and how they
// are named, what one row's number means (waves held, seconds, or points) and
// how it formats, the medal cell, and the whole rankings window model (the
// board cards, the top-three podium, the rest of the ladder, the viewer's
// pinned best, and the loading / error / empty states). DOM-free; the painter
// (world_quest_leaderboard_window.ts) renders exactly what this shapes, and
// the legacy chip tab in leaderboard_window.ts still reads the row helpers.
import {
  WORLD_QUEST_SCOREBOARDS,
  type WorldQuestMedal,
  type WorldQuestScoreboard,
  type WorldQuestScoreboardId,
  worldQuestScoreboard,
} from '../sim/world_quest_scoreboards';
import type { WorldQuestLeaderboardEntry, WorldQuestLeaderboardPage } from '../world_api';
import { formatNumber, t } from './i18n';
import { type PodiumSlot, podiumSplit } from './leaderboard_podium_view';
import { worldQuestDisplayName } from './world_quest_view';

export interface WorldQuestBoardChip {
  id: WorldQuestScoreboardId;
  label: string;
  active: boolean;
}

/** The board selector strip above the rows: one chip per scoreboard. */
export function worldQuestBoardChips(active: WorldQuestScoreboardId): WorldQuestBoardChip[] {
  return WORLD_QUEST_SCOREBOARDS.map((board) => ({
    id: board.id,
    label: worldQuestDisplayName(board.questId),
    active: board.id === active,
  }));
}

/** The first board is the default selection (the endless cannon line). */
export const DEFAULT_WORLD_QUEST_BOARD: WorldQuestScoreboardId = WORLD_QUEST_SCOREBOARDS[0].id;

/** Column header for the board's number. */
export function worldQuestMetricHeader(board: WorldQuestScoreboard): string {
  switch (board.metric) {
    case 'waves':
      return t('hudChrome.leaderboard.wqWaves');
    case 'seconds':
      return t('hudChrome.leaderboard.wqTime');
    default:
      return t('hudChrome.leaderboard.wqPoints');
  }
}

/** The number as the player reads it: whole waves or points, seconds with the unit. */
export function worldQuestMetricText(board: WorldQuestScoreboard, metric: number): string {
  const whole = formatNumber(metric, { maximumFractionDigits: 0 });
  return board.metric === 'seconds'
    ? t('hudChrome.leaderboard.wqSeconds', {
        seconds: formatNumber(metric, { maximumFractionDigits: 1 }),
      })
    : whole;
}

export function worldQuestMedalText(medal: WorldQuestMedal | null): string {
  return medal
    ? t(`hudChrome.leaderboard.wqMedals.${medal}`)
    : t('hudChrome.leaderboard.wqNoMedal');
}

export interface WorldQuestLeaderboardRowView {
  rank: string;
  name: string;
  medal: WorldQuestMedal | null;
  medalText: string;
  metricText: string;
  me: boolean;
}

/** One painted row; `viewerName` marks the viewer's own character. */
export function worldQuestLeaderboardRow(
  board: WorldQuestScoreboard,
  entry: WorldQuestLeaderboardEntry,
  viewerName: string,
): WorldQuestLeaderboardRowView {
  return {
    rank: formatNumber(entry.rank, { maximumFractionDigits: 0 }),
    name: entry.name,
    medal: entry.medal,
    medalText: worldQuestMedalText(entry.medal),
    metricText: worldQuestMetricText(board, entry.metric),
    me: entry.name === viewerName,
  };
}

/** Resolve a stored selection, falling back to the default when it names no board. */
export function resolveWorldQuestBoard(id: string): WorldQuestScoreboard {
  return (
    worldQuestScoreboard(id) ??
    (worldQuestScoreboard(DEFAULT_WORLD_QUEST_BOARD) as WorldQuestScoreboard)
  );
}

// ---- The rankings window ----------------------------------------------------

/** Where the rankings art lives (public/, served verbatim). A missing file
 *  degrades to the stylesheet's gradient, so the window never breaks on art. */
export const WORLD_QUEST_LADDER_ART_DIR = 'ui/world-quests/leaderboard';

export function worldQuestBoardArt(boardId: string): string {
  return `${WORLD_QUEST_LADDER_ART_DIR}/${boardId}.webp`;
}

export function worldQuestMedalArt(medal: WorldQuestMedal): string {
  return `${WORLD_QUEST_LADDER_ART_DIR}/medal_${medal}.webp`;
}

export interface WorldQuestLadderCardView {
  id: WorldQuestScoreboardId;
  label: string;
  metricHeader: string;
  art: string;
  active: boolean;
}

export type WorldQuestPodiumPlace = 1 | 2 | 3;

export interface WorldQuestPodiumSlotView {
  place: WorldQuestPodiumPlace;
  /** False for a place nobody holds yet: the plinth still stands, unclaimed. */
  filled: boolean;
  rank: string;
  name: string;
  medal: WorldQuestMedal | null;
  medalText: string;
  /** The medal this character EARNED in the quest (two places can both hold gold). */
  medalArt: string | null;
  metricText: string;
  me: boolean;
}

export interface WorldQuestLadderRowView extends WorldQuestLeaderboardRowView {
  medalArt: string | null;
}

export type WorldQuestLadderSelfView =
  | {
      kind: 'ranked';
      label: string;
      rankText: string;
      name: string;
      medal: WorldQuestMedal | null;
      medalText: string;
      medalArt: string | null;
      metricText: string;
    }
  | { kind: 'none'; label: string; text: string };

export interface WorldQuestLadderPagerView {
  page: number;
  pageCount: number;
  prevDisabled: boolean;
  nextDisabled: boolean;
  status: string;
  prevLabel: string;
  nextLabel: string;
}

export type WorldQuestLadderState = 'loading' | 'error' | 'empty' | 'ranked';

export type WorldQuestLadderInput =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'page'; page: WorldQuestLeaderboardPage };

export interface WorldQuestLadderView {
  title: string;
  subtitle: string;
  closeLabel: string;
  boardsLabel: string;
  cards: WorldQuestLadderCardView[];
  boardId: WorldQuestScoreboardId;
  boardTitle: string;
  boardRule: string;
  state: WorldQuestLadderState;
  /** The loading / error / empty line; '' once ranked. */
  message: string;
  /** How many characters hold a row on the board; '' until ranked. */
  totalText: string;
  podiumLabel: string;
  /** Display order silver, gold, bronze; empty off page 0 or before a page lands. */
  podium: WorldQuestPodiumSlotView[];
  rows: WorldQuestLadderRowView[];
  columns: { rank: string; name: string; medal: string; metric: string };
  youLabel: string;
  /** The pinned "your best" bar; null while loading or on an error. */
  self: WorldQuestLadderSelfView | null;
  pager: WorldQuestLadderPagerView | null;
}

/** The board cards: one per scoreboard, in scoreboard order. */
export function worldQuestLadderCards(active: WorldQuestScoreboardId): WorldQuestLadderCardView[] {
  return WORLD_QUEST_SCOREBOARDS.map((board) => ({
    id: board.id,
    label: worldQuestDisplayName(board.questId),
    metricHeader: worldQuestMetricHeader(board),
    art: worldQuestBoardArt(board.id),
    active: board.id === active,
  }));
}

/** How the board orders its rows, as the player reads it. */
export function worldQuestBoardRule(board: WorldQuestScoreboard): string {
  return board.primary === 'metric'
    ? t(`hudChrome.wqLadder.rankedBy.${board.metric}`)
    : t(`hudChrome.wqLadder.rankedByMedal.${board.metric}`);
}

function whole(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

function sameName(a: string, b: string): boolean {
  return b !== '' && a.toLowerCase() === b.toLowerCase();
}

function podiumSlot(
  board: WorldQuestScoreboard,
  slot: PodiumSlot<WorldQuestLeaderboardEntry>,
  viewerName: string,
): WorldQuestPodiumSlotView {
  const entry = slot.entry;
  if (!entry) {
    return {
      place: slot.place,
      filled: false,
      rank: slot.rankText,
      name: t('hudChrome.wqLadder.unclaimed'),
      medal: null,
      medalText: '',
      medalArt: null,
      metricText: '',
      me: false,
    };
  }
  return {
    place: slot.place,
    filled: true,
    rank: slot.rankText,
    name: entry.name,
    medal: entry.medal,
    medalText: worldQuestMedalText(entry.medal),
    medalArt: entry.medal ? worldQuestMedalArt(entry.medal) : null,
    metricText: worldQuestMetricText(board, entry.metric),
    me: sameName(entry.name, viewerName),
  };
}

function ladderRow(
  board: WorldQuestScoreboard,
  entry: WorldQuestLeaderboardEntry,
  viewerName: string,
): WorldQuestLadderRowView {
  return {
    ...worldQuestLeaderboardRow(board, entry, viewerName),
    me: sameName(entry.name, viewerName),
    medalArt: entry.medal ? worldQuestMedalArt(entry.medal) : null,
  };
}

function selfView(
  board: WorldQuestScoreboard,
  page: WorldQuestLeaderboardPage,
  viewerName: string,
): WorldQuestLadderSelfView {
  const label = t('hudChrome.wqLadder.selfLabel');
  // The server resolves `self` over the whole ladder; an older server that
  // omits the field still finds the viewer when the row is on this page.
  const entry =
    page.self === undefined
      ? page.leaders.find((row) => sameName(row.name, viewerName))
      : (page.self ?? undefined);
  if (!entry) return { kind: 'none', label, text: t('hudChrome.wqLadder.selfNone') };
  return {
    kind: 'ranked',
    label,
    rankText: t('hudChrome.wqLadder.selfRank', { rank: whole(entry.rank) }),
    name: entry.name,
    medal: entry.medal,
    medalText: worldQuestMedalText(entry.medal),
    medalArt: entry.medal ? worldQuestMedalArt(entry.medal) : null,
    metricText: worldQuestMetricText(board, entry.metric),
  };
}

/** The whole rankings window for one board and one fetch state. */
export function buildWorldQuestLadderView(
  boardId: string,
  input: WorldQuestLadderInput,
  viewerName: string,
): WorldQuestLadderView {
  const board = resolveWorldQuestBoard(boardId);
  const metric = worldQuestMetricHeader(board);
  const base: WorldQuestLadderView = {
    title: t('hudChrome.wqLadder.title'),
    subtitle: t('hudChrome.wqLadder.subtitle'),
    closeLabel: t('hudChrome.wqLadder.close'),
    boardsLabel: t('hudChrome.leaderboard.wqBoardsLabel'),
    cards: worldQuestLadderCards(board.id),
    boardId: board.id,
    boardTitle: worldQuestDisplayName(board.questId),
    boardRule: worldQuestBoardRule(board),
    state: 'loading',
    message: t('game.leaderboard.loading'),
    totalText: '',
    podiumLabel: t('hudChrome.wqLadder.podiumLabel'),
    podium: [],
    rows: [],
    columns: {
      rank: t('game.leaderboard.rank'),
      name: t('game.leaderboard.name'),
      medal: t('hudChrome.leaderboard.wqMedal'),
      metric,
    },
    youLabel: t('game.leaderboard.you'),
    self: null,
    pager: null,
  };
  if (input.kind === 'loading') return base;
  if (input.kind === 'error') {
    return { ...base, state: 'error', message: t('game.leaderboard.retry') };
  }
  const page = input.page;
  const self = selfView(board, page, viewerName);
  if (page.leaders.length === 0) {
    return { ...base, state: 'empty', message: t('hudChrome.leaderboard.wqEmpty'), self };
  }
  const split = podiumSplit(page.page, page.leaders, (entry) => entry.rank);
  const podium = split.podium.map((slot) => podiumSlot(board, slot, viewerName));
  const listed = split.listed;
  return {
    ...base,
    state: 'ranked',
    message: '',
    totalText:
      page.total === 1
        ? t('hudChrome.wqLadder.totalOne')
        : t('hudChrome.wqLadder.totalMany', { count: whole(page.total) }),
    podium,
    rows: listed.map((entry) => ladderRow(board, entry, viewerName)),
    self,
    pager:
      page.pageCount > 1
        ? {
            page: page.page,
            pageCount: page.pageCount,
            prevDisabled: page.page <= 0,
            nextDisabled: page.page >= page.pageCount - 1,
            status: t('itemUi.market.pageStatus', {
              current: whole(page.page + 1),
              total: whole(page.pageCount),
            }),
            prevLabel: t('itemUi.market.pagePrev'),
            nextLabel: t('itemUi.market.pageNext'),
          }
        : null,
  };
}
