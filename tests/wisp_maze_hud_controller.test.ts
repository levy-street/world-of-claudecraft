// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createWispMaze } from '../src/sim/minigames/wisp_maze';
import type { WorldQuestProgress } from '../src/sim/types';
import { WispMazeHudController } from '../src/ui/hud/quest/wisp_maze_hud_controller';
import { makeWriterFacet } from '../src/ui/painter_host';

afterEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
});
it('renders only a leave control, elides identical frames, respects host ownership and restores chrome', () => {
  document.body.innerHTML = '<div id="ui"></div>';
  const writes = vi.fn(),
    sound = vi.fn();
  const leave = vi.fn();
  const hud = new WispMazeHudController(
    document,
    makeWriterFacet(new Map(), new Map(), new Map(), new Map(), writes, () => {}),
    sound,
    leave,
  );
  const p: WorldQuestProgress = {
    questId: 'wq_evergarden_wisp_maze',
    state: 'active',
    count: 0,
    wispMaze: createWispMaze(42),
  };
  hud.update(p, true);
  expect(document.querySelectorAll('button')).toHaveLength(1);
  const button = document.querySelector<HTMLButtonElement>('button')!;
  expect(button.textContent).toBe('Leave maze');
  button.click();
  expect(leave).toHaveBeenCalledTimes(1);
  expect(document.body.classList.contains('playing-wisp-maze')).toBe(true);
  expect(sound).not.toHaveBeenCalled();
  writes.mockClear();
  hud.update(p, true);
  expect(writes).not.toHaveBeenCalled();
  p.wispMaze!.phase = 'active';
  p.wispMaze!.tick = 100;
  p.wispMaze!.powerUntilTick = 180;
  hud.update(p, true);
  expect(document.querySelector('[role="meter"]')!.getAttribute('aria-valuenow')).toBe('50');
  hud.update(p, false);
  expect(document.body.classList.contains('playing-wisp-maze')).toBe(false);
  p.wispMaze!.paused = true;
  hud.update(p, false);
  expect(document.getElementById('wisp-maze-hud')!.style.display).toBe('none');
  button.click();
  expect(leave).toHaveBeenCalledTimes(1);
  hud.update();
  expect(document.body.classList.contains('playing-wisp-maze')).toBe(false);
});
