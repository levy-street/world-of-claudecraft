import { expect, it } from 'vitest';
import { createWispMaze, WISP_MAZE_LAYOUT } from '../src/sim/minigames/wisp_maze';
import type { WorldQuestProgress } from '../src/sim/types';
import {
  createWispMazeHudView,
  WISP_MAZE_WON_LINGER_MS,
  wispMazeInstructionLines,
} from '../src/ui/world_quest_wisp_maze_view';

function progress(): WorldQuestProgress {
  return {
    questId: 'wq_evergarden_wisp_maze',
    state: 'active',
    count: 0,
    wispMaze: createWispMaze(42),
  };
}
function maze(p: WorldQuestProgress) {
  if (!p.wispMaze) throw new Error('Missing maze fixture');
  return p.wispMaze;
}
it('projects live collection, lives and power using authoritative ticks and reusable storage', () => {
  const p = progress(),
    s = maze(p),
    view = createWispMazeHudView();
  const first = view.tick(p);
  expect(first.cue).toBe('Starting in 3s');
  s.phase = 'active';
  s.tick = 80;
  s.lives = 2;
  s.collected = WISP_MAZE_LAYOUT.openCells.slice(0, 12);
  s.powerUntilTick = 160;
  const before = structuredClone(p);
  expect(view.tick(p)).toBe(first);
  expect(first.progress).toContain(`12/${WISP_MAZE_LAYOUT.openCells.length}`);
  expect(first.lives).toBe('Lives: 2/3');
  expect(first.powerLabel).toBe('Wisp power: 4s');
  expect(first.powerPercent).toBe(50);
  expect(first.cue).toContain('Power surge');
  expect(p).toEqual(before);
  expect(createWispMazeHudView().tick(structuredClone(p))).toEqual(first);
  s.tick = 160;
  view.tick(p);
  expect(first.powerPercent).toBe(0);
  expect(first.cue).toBe('Pick up the coin purses. Avoid shadows.');
  s.paused = true;
  expect(view.tick(p).active).toBe(false);
  expect(view.tick(p).visible).toBe(false);
  delete p.wispMaze;
  expect(view.tick(p).visible).toBe(false);
});
it('deduplicates pickups, ten-wisp milestones, hit, banish and completion without replaying snapshots', () => {
  const p = progress(),
    s = maze(p),
    view = createWispMazeHudView();
  s.phase = 'active';
  s.tick = 100;
  s.feedbackSerial = 7;
  s.collected = WISP_MAZE_LAYOUT.openCells.slice(0, 8);
  expect(view.tick(p).sound).toBeNull();
  s.collected.push(WISP_MAZE_LAYOUT.openCells[8]);
  s.feedbackSerial++;
  expect(view.tick(p).sound).toBe('ui_coin');
  expect(view.tick(p).sound).toBeNull();
  s.collected.push(WISP_MAZE_LAYOUT.openCells[9]);
  s.feedbackSerial++;
  expect(view.tick(p).sound).toBe('ui_loot_item');
  s.hits++;
  s.feedbackSerial++;
  expect(view.tick(p).sound).toBe('impact_bone');
  s.banishedCount++;
  s.feedbackSerial++;
  expect(view.tick(p).sound).toBe('impact_holy');
  s.phase = 'won';
  s.feedbackSerial++;
  expect(view.tick(p).sound).toBe('ui_quest_done');
  expect(view.tick(p).active).toBe(false);
  expect(wispMazeInstructionLines(p)).toEqual(['Every coin purse is recovered!']);
  s.tick = 0;
  s.phase = 'countdown';
  s.feedbackSerial = 0;
  expect(view.tick(p).sound).toBeNull();
});
it('closes the panel a few seconds after the maze is won, instead of lingering everywhere', () => {
  // The owner finished the maze, walked away, and the lives/power panel stayed
  // on screen: the won state stays on the quest progress until the reset.
  const p = progress(),
    s = maze(p),
    view = createWispMazeHudView();
  s.phase = 'active';
  expect(view.tick(p, 1_000).visible).toBe(true);
  s.phase = 'won';
  s.feedbackSerial++;
  const won = view.tick(p, 2_000);
  expect(won.visible).toBe(true);
  expect(won.sound).toBe('ui_quest_done');
  expect(won.cue).toBe('Every coin purse is recovered!');
  expect(view.tick(p, 2_000 + WISP_MAZE_WON_LINGER_MS - 1).visible).toBe(true);
  expect(view.tick(p, 2_000 + WISP_MAZE_WON_LINGER_MS).visible).toBe(false);
  expect(view.tick(p, 60_000).visible).toBe(false);
  // A maze already won before this view ever saw it running (a reload, a
  // relog) never pops the panel back up.
  const fresh = createWispMazeHudView();
  expect(fresh.tick(structuredClone(p), 90_000).visible).toBe(false);
  // A new run (new seed) shows it again.
  const again = progress();
  maze(again).phase = 'active';
  maze(again).seed = s.seed + 1;
  expect(view.tick(again, 95_000).visible).toBe(true);
});
