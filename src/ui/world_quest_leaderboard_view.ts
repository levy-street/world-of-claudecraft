// Pure view core for the World Quest rankings: which boards exist and how they
// are named, what one row's number means (waves held, seconds, or points) and
// how it formats, the medal cell, and the whole rankings window model (the
// board cards, the top-three podium, the rest of the ladder, the viewer's
// pinned best, and the loading / error / empty states), plus Fire and Fly's
// group switch (trials, missions, Mastery). DOM-free; the painter
// (world_quest_leaderboard_window.ts) renders exactly what this shapes, and
// the legacy chip tab in leaderboard_window.ts still reads the row helpers.

import { FIRE_AND_FLY_QUEST_ID } from '../sim/content/world_quest_fire_and_fly';
import { GLIDER_QUEST_ID } from '../sim/content/world_quest_glider';
import {
  type FireAndFlyRecruitment,
  fireAndFlyScenarioUnlocked,
  freshFireAndFlyRecruitment,
} from '../sim/fire_and_fly_recruitment';
import {
  FIRE_AND_FLY_BOARD_GROUPS,
  type FireAndFlyBoardGroup,
  fireAndFlyBoardGroup,
  fireAndFlyScoreboardInfo,
} from '../sim/fire_and_fly_scoreboards';
import { gliderScoreboardInfo } from '../sim/glider_scoreboards';
import {
  WORLD_QUEST_SCOREBOARDS,
  type WorldQuestMedal,
  type WorldQuestScoreboard,
  type WorldQuestScoreboardId,
  worldQuestScoreboard,
} from '../sim/world_quest_scoreboards';
import type { WorldQuestLeaderboardEntry, WorldQuestLeaderboardPage } from '../world_api';
import { fireAndFlyTrialName } from './fire_and_fly_trial_view';
import { formatNumber, type TranslationKey, t, tPlural } from './i18n';
import { type PodiumSlot, podiumSplit } from './leaderboard_podium_view';
import { worldQuestDisplayName } from './world_quest_view';

/** Which ladders a window shows together: the glider's courses, Fire and Fly's
 *  boards, or the quest-wide boards of every other medal world quest. */
export type WorldQuestBoardFamily = 'quests' | 'glider' | 'fireAndFly';

export function worldQuestBoardFamily(boardId: string): WorldQuestBoardFamily {
  if (gliderScoreboardInfo(boardId)) return 'glider';
  if (fireAndFlyBoardGroup(boardId)) return 'fireAndFly';
  return 'quests';
}

/** The boards shown beside `active`: its family's, and within Fire and Fly its group's. */
function siblingBoards(active: string): WorldQuestScoreboard[] {
  const family = worldQuestBoardFamily(active);
  const group = fireAndFlyBoardGroup(active);
  return WORLD_QUEST_SCOREBOARDS.filter(
    (board) =>
      worldQuestBoardFamily(board.id) === family && fireAndFlyBoardGroup(board.id) === group,
  );
}

const GROUP_LABEL: Record<FireAndFlyBoardGroup, TranslationKey> = {
  trials: 'hudChrome.leaderboard.fireAndFlyGroups.trials',
  missions: 'hudChrome.leaderboard.fireAndFlyGroups.missions',
  mastery: 'hudChrome.leaderboard.fireAndFlyGroups.mastery',
};

export interface WorldQuestBoardGroupView {
  group: FireAndFlyBoardGroup;
  label: string;
  /** The board a pick opens: the active one inside its own group, else the group's first. */
  board: WorldQuestScoreboardId;
  active: boolean;
}

/** Fire and Fly's group switch, in the instructor's order; empty for every other family. */
export function worldQuestBoardGroups(active: WorldQuestScoreboardId): WorldQuestBoardGroupView[] {
  const current = fireAndFlyBoardGroup(active);
  if (!current) return [];
  return FIRE_AND_FLY_BOARD_GROUPS.flatMap((group) => {
    const first = WORLD_QUEST_SCOREBOARDS.find((board) => fireAndFlyBoardGroup(board.id) === group);
    if (!first) return [];
    return [
      {
        group,
        label: t(GROUP_LABEL[group]),
        board: group === current ? active : first.id,
        active: group === current,
      },
    ];
  });
}

function isMastery(board: WorldQuestScoreboard): boolean {
  return fireAndFlyBoardGroup(board.id) === 'mastery';
}

const FAMILY_TITLE: Record<WorldQuestBoardFamily, TranslationKey> = {
  quests: 'hudChrome.wqLadder.title',
  glider: 'hudChrome.leaderboard.gliderRankings',
  fireAndFly: 'hudChrome.leaderboard.fireAndFlyRankings',
};

const GROUP_RULES: Record<FireAndFlyBoardGroup, [TranslationKey, TranslationKey]> = {
  trials: [
    'hudChrome.leaderboard.fireAndFlyRules',
    'hudChrome.leaderboard.fireAndFlyPersonalRules',
  ],
  missions: [
    'hudChrome.leaderboard.fireAndFlyMissionRules',
    'hudChrome.leaderboard.fireAndFlyMissionPersonalRules',
  ],
  mastery: [
    'hudChrome.leaderboard.fireAndFlyMasteryRules',
    'hudChrome.leaderboard.fireAndFlyMasteryPersonalRules',
  ],
};

function familySubtitle(boardId: string, personal: boolean): TranslationKey {
  if (worldQuestBoardFamily(boardId) === 'glider')
    return personal
      ? 'hudChrome.leaderboard.gliderPersonalRules'
      : 'hudChrome.leaderboard.gliderRules';
  const group = fireAndFlyBoardGroup(boardId);
  if (group) return GROUP_RULES[group][personal ? 1 : 0];
  return 'hudChrome.wqLadder.subtitle';
}

export function worldQuestBoardLabel(board: WorldQuestScoreboard): string {
  if (isMastery(board)) return t('hudChrome.leaderboard.fireAndFlyMastery');
  const trial = fireAndFlyScoreboardInfo(board.id);
  if (trial) {
    const name = fireAndFlyTrialName(trial.scenarioId) ?? worldQuestDisplayName(board.questId);
    return t(
      trial.period === 'daily'
        ? 'hudChrome.leaderboard.fireAndFlyDaily'
        : 'hudChrome.leaderboard.fireAndFlyLifetime',
      { trial: name },
    );
  }
  const glider = gliderScoreboardInfo(board.id);
  if (!glider) return worldQuestDisplayName(board.questId);
  const course = t(`hudChrome.leaderboard.gliderCourseNames.${glider.key}`);
  return t(
    glider.period === 'daily'
      ? 'hudChrome.leaderboard.gliderDaily'
      : 'hudChrome.leaderboard.gliderLifetime',
    { course },
  );
}

export interface WorldQuestBoardChip {
  id: WorldQuestScoreboardId;
  label: string;
  active: boolean;
}

/** The board selector strip above the rows: one chip per scoreboard. */
export function worldQuestBoardChips(active: WorldQuestScoreboardId): WorldQuestBoardChip[] {
  return siblingBoards(active).map((board) => ({
    id: board.id,
    label: worldQuestBoardLabel(board),
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

/** The medal column's text: the medal, or on the Mastery the stars it sums. */
function medalCellText(board: WorldQuestScoreboard, entry: WorldQuestLeaderboardEntry): string {
  if (!isMastery(board)) return worldQuestMedalText(entry.medal);
  const stars = entry.stars;
  if (stars === undefined) return worldQuestMedalText(null);
  return tPlural('hudChrome.plurals.fireAndFlyStars', stars, { count: whole(stars) });
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
    medalText: medalCellText(board, entry),
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
 *  degrades to the stylesheet's gradient, so the window never breaks on art.
 *  Root-absolute on purpose: the window hands these paths to the stylesheet
 *  through `--wql-art` / `--wql-medal`, and a relative url() inside a custom
 *  property resolves against the stylesheet that consumes it. In a built client
 *  that is /assets/main-*.css, so a relative path asks for /assets/ui/... (404);
 *  the dev server injects CSS inline, which is why it only broke once deployed. */
export const WORLD_QUEST_LADDER_ART_DIR = '/ui/world-quests/leaderboard';

/** A family of per-period ladders shares one piece of art. */
const FAMILY_ART: Record<Exclude<WorldQuestBoardFamily, 'quests'>, string> = {
  glider: 'slalom',
  fireAndFly: 'barricade',
};

export function worldQuestBoardArt(boardId: string): string {
  const family = worldQuestBoardFamily(boardId);
  return `${WORLD_QUEST_LADDER_ART_DIR}/${family === 'quests' ? boardId : FAMILY_ART[family]}.webp`;
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

/** The button that takes the selected course, trial or mission: what it starts and its label. */
export interface WorldQuestLadderStartView {
  questId: string;
  courseId: string;
  label: string;
}

export interface WorldQuestLadderView {
  title: string;
  subtitle: string;
  closeLabel: string;
  groupsLabel: string;
  /** Fire and Fly's group switch; empty for every other family. */
  groups: WorldQuestBoardGroupView[];
  boardsLabel: string;
  cards: WorldQuestLadderCardView[];
  /** Null on a board with nothing to take, or a trial or mission the character has not unlocked. */
  start: WorldQuestLadderStartView | null;
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

/** The board cards: one per scoreboard of the active family (and group), in scoreboard order. */
export function worldQuestLadderCards(active: WorldQuestScoreboardId): WorldQuestLadderCardView[] {
  return siblingBoards(active).map((board) => ({
    id: board.id,
    label: worldQuestBoardLabel(board),
    metricHeader: worldQuestMetricHeader(board),
    art: worldQuestBoardArt(board.id),
    active: board.id === active,
  }));
}

function startView(
  board: WorldQuestScoreboard,
  recruitment: Readonly<FireAndFlyRecruitment>,
): WorldQuestLadderStartView | null {
  const course = gliderScoreboardInfo(board.id);
  if (course)
    return {
      questId: GLIDER_QUEST_ID,
      courseId: course.courseId,
      label: t('hudChrome.leaderboard.gliderStart'),
    };
  const scenario = fireAndFlyScoreboardInfo(board.id);
  if (!scenario || !fireAndFlyScenarioUnlocked(recruitment, scenario.scenarioId)) return null;
  return {
    questId: FIRE_AND_FLY_QUEST_ID,
    courseId: scenario.scenarioId,
    label: t(
      scenario.kind === 'mission'
        ? 'hudChrome.leaderboard.fireAndFlyMissionStart'
        : 'hudChrome.leaderboard.fireAndFlyStart',
    ),
  };
}

/** How the board orders its rows, as the player reads it. */
export function worldQuestBoardRule(board: WorldQuestScoreboard): string {
  if (isMastery(board)) return t('hudChrome.wqLadder.rankedByStars');
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
    medalText: medalCellText(board, entry),
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
    medalText: medalCellText(board, entry),
    medalArt: entry.medal ? worldQuestMedalArt(entry.medal) : null,
    metricText: worldQuestMetricText(board, entry.metric),
  };
}

/** The whole rankings window for one board and one fetch state; `recruitment` gates the start button. */
export function buildWorldQuestLadderView(
  boardId: string,
  input: WorldQuestLadderInput,
  viewerName: string,
  recruitment: Readonly<FireAndFlyRecruitment> = freshFireAndFlyRecruitment(),
): WorldQuestLadderView {
  const board = resolveWorldQuestBoard(boardId);
  const metric = worldQuestMetricHeader(board);
  const family = worldQuestBoardFamily(board.id);
  const base: WorldQuestLadderView = {
    title: t(FAMILY_TITLE[family]),
    subtitle: t(familySubtitle(board.id, input.kind === 'page' && !!input.page.personal)),
    closeLabel: t('hudChrome.wqLadder.close'),
    groupsLabel: t('hudChrome.leaderboard.fireAndFlyGroupsLabel'),
    groups: worldQuestBoardGroups(board.id),
    boardsLabel: t('hudChrome.leaderboard.wqBoardsLabel'),
    cards: worldQuestLadderCards(board.id),
    start: startView(board, recruitment),
    boardId: board.id,
    boardTitle: worldQuestBoardLabel(board),
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
      medal: t(
        isMastery(board) ? 'hudChrome.leaderboard.wqStars' : 'hudChrome.leaderboard.wqMedal',
      ),
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
