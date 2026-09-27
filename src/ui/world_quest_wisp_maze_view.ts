import {
  WISP_MAZE_COUNTDOWN_TICKS,
  WISP_MAZE_LAYOUT,
  WISP_MAZE_PROFILES,
} from '../sim/minigames/wisp_maze';
import { TICK_RATE, type WorldQuestProgress } from '../sim/types';
import { formatNumber, t } from './i18n';

export function wispMazeInstructionLines(progress: WorldQuestProgress): string[] {
  const state = progress.wispMaze;
  if (!state) return [t('questUi.worldQuest.wispMaze.ready')];
  if (state.phase === 'won') return [t('questUi.worldQuest.wispMaze.finished')];
  return [
    t('questUi.worldQuest.wispMaze.collected', {
      count: formatNumber(state.collected.length),
      total: formatNumber(WISP_MAZE_LAYOUT.openCells.length),
    }),
    t(
      state.powerUntilTick > state.tick
        ? 'questUi.worldQuest.wispMaze.powered'
        : 'questUi.worldQuest.wispMaze.collect',
    ),
  ];
}

/** A reused projection and feedback cursor; attaching to a snapshot never replays old sounds. */
export function createWispMazeHudView() {
  const view = {
    visible: false,
    active: false,
    title: '',
    progress: '',
    lives: '',
    powerLabel: '',
    powerPercent: 0,
    cue: '',
    sound: null as string | null,
  };
  let lastSeed: number | undefined;
  let lastTick = -1,
    lastSerial = -1,
    lastCollected = 0,
    lastHits = 0,
    lastBanished = 0;
  return {
    tick(progress?: WorldQuestProgress) {
      const state = progress?.wispMaze;
      view.sound = null;
      view.visible = !!state && !state.paused;
      view.active = view.visible && state?.phase !== 'won';
      if (!state) {
        lastSeed = undefined;
        return view;
      }
      const fresh =
        lastSeed !== state.seed || state.tick < lastTick || state.feedbackSerial < lastSerial;
      if (!fresh && view.visible && state.feedbackSerial !== lastSerial) {
        view.sound =
          state.phase === 'won'
            ? 'ui_quest_done'
            : state.hits > lastHits
              ? 'impact_bone'
              : state.banishedCount > lastBanished
                ? 'impact_holy'
                : state.feedback === 'power'
                  ? 'buff_apply'
                  : Math.floor(state.collected.length / 10) > Math.floor(lastCollected / 10)
                    ? 'ui_loot_item'
                    : state.collected.length > lastCollected
                      ? 'ui_coin'
                      : null;
      }
      lastSeed = state.seed;
      lastTick = state.tick;
      lastSerial = state.feedbackSerial;
      lastCollected = state.collected.length;
      lastHits = state.hits;
      lastBanished = state.banishedCount;
      const seconds = Math.max(0, state.powerUntilTick - state.tick) / TICK_RATE;
      view.title = t('questUi.worldQuest.wispMaze.title');
      view.progress = t('questUi.worldQuest.wispMaze.collected', {
        count: formatNumber(state.collected.length),
        total: formatNumber(WISP_MAZE_LAYOUT.openCells.length),
      });
      view.lives = t('questUi.worldQuest.wispMaze.lives', { count: formatNumber(state.lives) });
      view.powerLabel = t('questUi.worldQuest.wispMaze.power', {
        seconds: formatNumber(Math.ceil(seconds)),
      });
      view.powerPercent = Math.min(
        100,
        (seconds / WISP_MAZE_PROFILES[state.difficulty].powerSeconds) * 100,
      );
      view.cue =
        state.phase === 'countdown'
          ? t('questUi.worldQuest.wispMaze.countdown', {
              seconds: formatNumber(
                Math.max(0, Math.ceil((WISP_MAZE_COUNTDOWN_TICKS - state.tick) / TICK_RATE)),
              ),
            })
          : state.phase === 'won'
            ? t('questUi.worldQuest.wispMaze.finished')
            : state.feedback === 'reset'
              ? t('questUi.worldQuest.wispMaze.retry')
              : t(
                  seconds > 0
                    ? 'questUi.worldQuest.wispMaze.powered'
                    : 'questUi.worldQuest.wispMaze.collect',
                );
      return view;
    },
  };
}
