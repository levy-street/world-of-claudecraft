// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import type { WorldQuestProgress } from '../src/sim/types';
import { applyWorldQuestMatch3Move } from '../src/sim/world_quest_match3';
import { setLanguage } from '../src/ui/i18n';
import { questEventPresentation } from '../src/ui/quest_event_view';
import { WorldQuestPuzzleWindow } from '../src/ui/world_quest_puzzle_window';

const quest = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
if (quest.objective.type !== 'match3') throw new Error('Expected match-three fixture');
const level = quest.objective.levels[0];

function setup() {
  const progress: WorldQuestProgress = {
    questId: quest.id,
    state: 'active',
    count: 0,
    puzzleVariant: 0,
    match3Board: [...level.board],
    match3Moves: 0,
    match3RefillIndex: 0,
  };
  const worldQuestLog = new Map([[quest.id, progress]]);
  const swap = vi.fn();
  const reset = vi.fn();
  const world = {
    worldQuestCycle: 'test-cycle-1',
    worldQuestLog,
    swapWorldQuestMatch3Tiles: swap,
    resetWorldQuestMatch3: reset,
    rotateWorldQuestPuzzleTile: vi.fn(),
    resetWorldQuestPuzzle: vi.fn(),
  };
  const puzzle = new WorldQuestPuzzleWindow({
    document,
    world: () => world,
    closeOthers: vi.fn(),
    click: vi.fn(),
    openFocusTrap: () => ({ focusFirst: vi.fn(), release: vi.fn(), opener: () => null }),
  });
  puzzle.open(quest.id);
  const root = document.getElementById('world-quest-puzzle-window')!;
  const click = (index: number) =>
    root.querySelector<HTMLButtonElement>(`[data-match3-cell="${index}"]`)!.click();
  const move = () => {
    click(2);
    click(3);
  };
  const confirm = () => {
    const result = applyWorldQuestMatch3Move(level, level.board, 2, 3, 0);
    worldQuestLog.set(quest.id, {
      ...progress,
      count: result.cleared,
      match3Moves: 1,
      match3Board: result.board,
      match3RefillIndex: result.refillIndex,
    });
    puzzle.refreshIfChanged();
    return result;
  };
  return { puzzle, root, progress, world, worldQuestLog, move, confirm, click, swap, reset };
}

describe('Confection Cascade presentation', () => {
  let animations: Array<{
    cancel: ReturnType<typeof vi.fn>;
    onfinish: (() => void) | null;
    oncancel: (() => void) | null;
    options: KeyframeAnimationOptions | number | undefined;
  }>;
  let images: HTMLImageElement[];
  let originalAnimate: PropertyDescriptor | undefined;

  beforeEach(() => {
    document.body.innerHTML = '<main id="ui"></main>';
    document.body.className = '';
    document.documentElement.dataset.fxLevel = 'high';
    setLanguage('en');
    animations = [];
    images = [];
    originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn((_frames: Keyframe[], options?: KeyframeAnimationOptions | number) => {
        const animation = { cancel: vi.fn(), onfinish: null, oncancel: null, options };
        animations.push(animation);
        return animation as unknown as Animation;
      }),
    });
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
      const element = create(tag, options);
      if (tag === 'img') images.push(element as HTMLImageElement);
      return element;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
    else Reflect.deleteProperty(Element.prototype, 'animate');
    delete document.documentElement.dataset.fxLevel;
  });

  it('retains the actionable cells, focuses them, and paints confirmed data before starting decorative effects', () => {
    const { puzzle, root, move, confirm, swap } = setup();
    const cell = root.querySelector<HTMLButtonElement>('[data-match3-cell="2"]')!;
    cell.focus();
    move();
    expect(swap).toHaveBeenCalledWith(quest.id, 2, 3);
    expect(animations).toHaveLength(0);
    expect(root.querySelector('[data-match3-cell="2"]')).toBe(cell);
    const result = confirm();
    expect(document.activeElement).toBe(cell);
    expect(root.querySelector('[data-match3-cell="2"]')).toBe(cell);
    expect(cell.classList.contains(`candy-${result.board[2]}`)).toBe(true);
    expect(root.querySelectorAll('[data-match3-cell]:not(:disabled)')).toHaveLength(36);
    expect(root.querySelector('.wqm-moves')?.textContent).toBe('Moves: 1/20');
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      String(result.cleared),
    );
    expect(animations.length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.wqm-effect[aria-hidden="true"]').length).toBe(animations.length);
    for (const animation of animations) animation.onfinish?.();
    expect(root.querySelector('.wqm-effect')).toBeNull();
    puzzle.close();
  });

  it('keeps each cosmetic effect finite and ends the entire flourish within a short beat', () => {
    const state = setup();
    state.move();
    state.confirm();
    expect(animations.length).toBeGreaterThan(0);
    for (const { options } of animations) {
      const timing = typeof options === 'number' ? { duration: options } : options;
      expect(timing).toBeDefined();
      const duration = Number(timing?.duration);
      const delay = timing?.delay ?? 0;
      const endDelay = timing?.endDelay ?? 0;
      expect(Number.isFinite(duration)).toBe(true);
      expect(duration).toBeGreaterThan(0);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(endDelay).toBeGreaterThanOrEqual(0);
      expect(timing?.iterations ?? 1).toBe(1);
      expect(delay + duration + endDelay).toBeLessThanOrEqual(950);
    }
    state.puzzle.close();
  });

  it.each(['reset', 'close', 'switch', 'move'] as const)(
    'cancels finite effects on %s',
    (action) => {
      const state = setup();
      state.move();
      state.confirm();
      expect(animations.length).toBeGreaterThan(0);
      if (action === 'reset')
        state.root.querySelector<HTMLButtonElement>('[data-match3-reset]')!.click();
      if (action === 'close') state.puzzle.close();
      if (action === 'switch') state.puzzle.open('wq_galecrest_wisps');
      if (action === 'move') {
        state.click(0);
        state.click(1);
      }
      expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
      expect(state.root.querySelector('.wqm-effect')).toBeNull();
      if (action === 'switch')
        expect(state.root.classList.contains('confection-cascade')).toBe(false);
      state.puzzle.close();
    },
  );

  it('handles an immediately mutated offline world without losing the before-board receipt', () => {
    const state = setup();
    state.swap.mockImplementation(() => {
      const result = applyWorldQuestMatch3Move(level, level.board, 2, 3, 0);
      Object.assign(state.progress, {
        count: result.cleared,
        match3Moves: 1,
        match3RefillIndex: result.refillIndex,
        match3Board: result.board,
      });
    });
    state.move();
    expect(state.root.querySelector('.wqm-moves')?.textContent).toBe('Moves: 1/20');
    expect(animations.length).toBeGreaterThan(0);
    state.puzzle.close();
  });

  it.each(['reset', 'reopen'] as const)(
    'does not revive cancelled effects from a late server reply after %s',
    (action) => {
      const state = setup();
      state.move();
      expect(animations).toHaveLength(0);
      if (action === 'reset')
        state.root.querySelector<HTMLButtonElement>('[data-match3-reset]')!.click();
      else {
        state.puzzle.close();
        state.puzzle.open(quest.id);
      }
      state.confirm();
      expect(animations).toHaveLength(0);
      expect(state.root.querySelector('.wqm-moves')?.textContent).toBe('Moves: 1/20');
      state.puzzle.close();
    },
  );

  it('discards a receipt when a different authoritative board arrives', () => {
    const state = setup();
    state.move();
    state.worldQuestLog.set(quest.id, { ...state.progress, count: 3, match3Moves: 1 });
    state.puzzle.refreshIfChanged();
    expect(animations).toHaveLength(0);
    expect(state.root.querySelector('.wqm-moves')?.textContent).toBe('Moves: 1/20');
    state.confirm();
    expect(animations).toHaveLength(0);
    state.puzzle.close();
  });

  it.each(['setting', 'system', 'low'] as const)(
    'shows the same confirmed board with no effects under %s motion suppression',
    (mode) => {
      if (mode === 'system')
        vi.spyOn(window, 'matchMedia').mockReturnValue({
          matches: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as unknown as MediaQueryList);
      if (mode === 'setting') document.body.classList.add('reduce-motion');
      if (mode === 'low') document.documentElement.dataset.fxLevel = 'low';
      const state = setup();
      state.move();
      const result = state.confirm();
      expect(animations).toHaveLength(0);
      expect(state.root.querySelector('.wqm-moves')?.textContent).toBe('Moves: 1/20');
      expect(
        [...state.root.querySelectorAll('.wqm-cell')].every((cell, index) =>
          cell.classList.contains(`candy-${result.board[index]}`),
        ),
      ).toBe(true);
      state.puzzle.close();
    },
  );

  it('cancels current effects when reduced motion changes and leaves reset usable', async () => {
    const state = setup();
    state.move();
    state.confirm();
    document.body.classList.add('reduce-motion');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
    state.root.querySelector<HTMLButtonElement>('[data-match3-reset]')!.click();
    expect(state.reset).toHaveBeenCalledOnce();
    state.puzzle.close();
  });

  it.each(['system reduced motion', 'low effects tier'] as const)(
    'cancels existing effects when the player changes to %s',
    async (setting) => {
      const media = Object.assign(new EventTarget(), { matches: false });
      vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
      const state = setup();
      state.move();
      const result = state.confirm();
      expect(animations.length).toBeGreaterThan(0);
      if (setting === 'system reduced motion') {
        media.matches = true;
        media.dispatchEvent(new Event('change'));
      } else document.documentElement.dataset.fxLevel = 'low';
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
      expect(state.root.querySelector('.wqm-effect')).toBeNull();
      expect(state.root.querySelector('.wqm-moves')?.textContent).toBe('Moves: 1/20');
      expect(
        [...state.root.querySelectorAll('.wqm-cell')].every((cell, index) =>
          cell.classList.contains(`candy-${result.board[index]}`),
        ),
      ).toBe(true);
      state.puzzle.close();
    },
  );

  it('keeps shape fallbacks until the one shared atlas loads and removes art state for the Ley board', () => {
    const { root, puzzle } = setup();
    expect(images).toHaveLength(1);
    expect(root.dataset.candyArt).toBeUndefined();
    expect(root.querySelectorAll('.wqm-candy-symbol')).toHaveLength(36);
    images[0].dispatchEvent(new Event('load'));
    expect(root.dataset.candyArt).toBe('ready');
    puzzle.open('wq_galecrest_wisps');
    expect(root.dataset.candyArt).toBeUndefined();
    puzzle.open(quest.id);
    expect(images).toHaveLength(1);
    expect(root.dataset.candyArt).toBe('ready');
    images[0].dispatchEvent(new Event('error'));
    expect(root.dataset.candyArt).toBeUndefined();
    puzzle.close();
  });

  it('does no queries or writes on repeated unchanged refreshes', () => {
    const { root, puzzle } = setup();
    const query = vi.spyOn(root, 'querySelector');
    const queryAll = vi.spyOn(root, 'querySelectorAll');
    const attr = vi.spyOn(Element.prototype, 'setAttribute');
    const text = vi.spyOn(Node.prototype, 'textContent', 'set');
    for (let tick = 0; tick < 10; tick++) puzzle.refreshIfChanged();
    expect(query).not.toHaveBeenCalled();
    expect(queryAll).not.toHaveBeenCalled();
    expect(attr).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    puzzle.close();
  });

  it('shows an immediate victory instead of a loss when the last move reaches the target', () => {
    const state = setup();
    state.worldQuestLog.set(quest.id, { ...state.progress, count: 72, match3Moves: 20 });
    state.puzzle.refreshIfChanged();
    expect(state.root.dataset.outcome).toBe('won');
    expect(state.root.querySelector<HTMLElement>('.wqm-result')?.hidden).toBe(false);
    expect(state.root.querySelector('.wqm-result-title')?.textContent).toBe('Sweet victory');
    expect(state.root.textContent).not.toContain('No moves remain.');
    expect(state.root.querySelectorAll('[data-match3-cell]:not(:disabled)')).toHaveLength(0);
    expect(state.root.querySelector<HTMLElement>('.wqm-moves')?.hidden).toBe(false);
    expect(document.activeElement).toBe(state.root.querySelector('.wqm-result'));
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Sweet victory');
    state.root.querySelector<HTMLButtonElement>('.wqm-reset')!.click();
    expect(state.root.style.display).toBe('none');
    expect(state.reset).not.toHaveBeenCalled();
  });

  it.each(['event first', 'snapshot first'] as const)(
    'keeps victory visible with stripped completion data, %s',
    (order) => {
      const state = setup();
      const board = [...level.board].reverse();
      state.worldQuestLog.set(quest.id, {
        ...state.progress,
        count: 69,
        match3Moves: 19,
        match3Board: board,
      });
      state.puzzle.refreshIfChanged();
      const snapshot = () => {
        state.worldQuestLog.set(quest.id, { questId: quest.id, state: 'completed', count: 72 });
        state.puzzle.refreshIfChanged();
      };
      const event = () =>
        state.puzzle.applyEventPresentation(
          questEventPresentation({ type: 'worldQuestDone', questId: quest.id, pid: 1 })!,
        );
      if (order === 'event first') {
        event();
        expect(state.root.querySelector<HTMLElement>('.wqm-moves')?.hidden).toBe(true);
        expect(document.querySelector('[role="status"]')?.textContent).not.toContain('Moves:');
        snapshot();
      } else {
        snapshot();
        event();
      }
      expect(state.root.style.display).toBe('flex');
      expect(state.root.dataset.outcome).toBe('won');
      expect(state.root.querySelector<HTMLElement>('.wqm-moves')?.hidden).toBe(true);
      expect(document.querySelector('[role="status"]')?.textContent).not.toContain('Moves:');
      expect(
        [...state.root.querySelectorAll('.wqm-cell')].every((cell, index) =>
          cell.classList.contains(`candy-${board[index]}`),
        ),
      ).toBe(true);
      const effectCount = animations.length;
      event();
      state.puzzle.relocalize();
      state.puzzle.refreshIfChanged();
      expect(animations).toHaveLength(effectCount);
      expect(state.root.dataset.outcome).toBe('won');
      state.puzzle.close();
    },
  );

  it('uses an authoritative completed board when one is supplied and does not reopen dismissed victory', () => {
    const state = setup();
    const board = [...level.board].reverse();
    state.worldQuestLog.set(quest.id, {
      ...state.progress,
      state: 'completed',
      count: 72,
      match3Moves: 13,
      match3Board: board,
    });
    state.puzzle.refreshIfChanged();
    expect(state.root.querySelector('.wqm-moves')?.textContent).toBe('Moves: 13/20');
    expect(state.root.querySelector<HTMLElement>('.wqm-moves')?.hidden).toBe(false);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Moves: 13/20');
    state.worldQuestLog.set(quest.id, { questId: quest.id, state: 'completed', count: 72 });
    state.puzzle.refreshIfChanged();
    expect(state.root.querySelector('.wqm-moves')?.textContent).toBe('Moves: 13/20');
    expect(state.root.querySelector<HTMLElement>('.wqm-moves')?.hidden).toBe(false);
    expect(
      [...state.root.querySelectorAll('.wqm-cell')].every((cell, index) =>
        cell.classList.contains(`candy-${board[index]}`),
      ),
    ).toBe(true);
    state.puzzle.close();
    state.puzzle.applyEventPresentation(
      questEventPresentation({ type: 'worldQuestDone', questId: quest.id, pid: 1 })!,
    );
    state.puzzle.refreshIfChanged();
    expect(state.root.style.display).toBe('none');
  });

  it('keeps a distinct loss result and resets it only when the world confirms the reset', () => {
    const state = setup();
    state.worldQuestLog.set(quest.id, { ...state.progress, count: 69, match3Moves: 20 });
    state.puzzle.refreshIfChanged();
    expect(state.root.dataset.outcome).toBe('lost');
    expect(state.root.querySelector<HTMLElement>('.wqm-moves')?.hidden).toBe(false);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Moves: 20/20');
    expect(state.root.querySelector('.wqm-result-title')?.textContent).toBe('Bitter defeat');
    state.root.querySelector<HTMLButtonElement>('[data-match3-reset]')!.click();
    expect(state.reset).toHaveBeenCalledWith(quest.id);
    expect(state.root.dataset.outcome).toBe('lost');
    state.worldQuestLog.set(quest.id, { ...state.progress });
    state.puzzle.refreshIfChanged();
    expect(state.root.dataset.outcome).toBe('playing');
    expect(state.root.querySelector<HTMLElement>('.wqm-result')?.hidden).toBe(true);
    state.puzzle.close();
  });

  it.each(['setting', 'system', 'low'] as const)(
    'keeps terminal information and the action immediate under %s motion suppression',
    (mode) => {
      if (mode === 'setting') document.body.classList.add('reduce-motion');
      if (mode === 'low') document.documentElement.dataset.fxLevel = 'low';
      if (mode === 'system')
        vi.spyOn(window, 'matchMedia').mockReturnValue({
          matches: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as unknown as MediaQueryList);
      const state = setup();
      state.worldQuestLog.set(quest.id, { ...state.progress, count: 72, match3Moves: 20 });
      state.puzzle.refreshIfChanged();
      expect(animations).toHaveLength(0);
      expect(state.root.querySelector<HTMLElement>('.wqm-result')?.hidden).toBe(false);
      expect(document.activeElement).toBe(state.root.querySelector('.wqm-result'));
      expect(state.root.querySelector<HTMLButtonElement>('.wqm-reset')?.disabled).toBe(false);
      expect(document.querySelector('[role="status"]')?.textContent).toContain('Sweet victory');
      state.puzzle.close();
    },
  );

  it('does not carry completion across quest switches, close/reopen, or a new world quest cycle', () => {
    const state = setup();
    const done = questEventPresentation({ type: 'worldQuestDone', questId: quest.id, pid: 1 })!;
    state.puzzle.applyEventPresentation(done);
    expect(state.root.dataset.outcome).toBe('won');
    state.world.worldQuestCycle = 'test-cycle-2';
    state.puzzle.refreshIfChanged();
    expect(state.root.style.display).toBe('none');
    expect(state.root.dataset.outcome).toBeUndefined();
    state.puzzle.refreshIfChanged();
    expect(state.root.style.display).toBe('none');
    state.puzzle.open(quest.id);
    expect(state.root.dataset.outcome).toBe('playing');
    state.puzzle.open('wq_galecrest_wisps');
    state.puzzle.applyEventPresentation(done);
    expect(state.root.dataset.outcome).toBeUndefined();
    state.puzzle.open(quest.id);
    expect(state.root.dataset.outcome).toBe('playing');
    state.puzzle.applyEventPresentation(done);
    state.puzzle.close();
    state.puzzle.open(quest.id);
    expect(state.root.dataset.outcome).toBe('playing');
    state.puzzle.close();
  });

  it('ignores a prior-cycle completion event arriving with a changed cycle', () => {
    const state = setup();
    state.world.worldQuestCycle = 'test-cycle-2';
    state.puzzle.applyEventPresentation(
      questEventPresentation({ type: 'worldQuestDone', questId: quest.id, pid: 1 })!,
    );
    expect(state.root.style.display).toBe('none');
    expect(state.root.dataset.outcome).toBeUndefined();
    expect(animations).toHaveLength(0);
    state.puzzle.open(quest.id);
    expect(state.root.dataset.outcome).toBe('playing');
    state.puzzle.close();
  });

  it.each(['new cycle', 'removed quest'] as const)(
    'closes retained victory when the quest log is empty after %s',
    (reason) => {
      const state = setup();
      state.puzzle.applyEventPresentation(
        questEventPresentation({ type: 'worldQuestDone', questId: quest.id, pid: 1 })!,
      );
      expect(state.root.dataset.outcome).toBe('won');
      if (reason === 'new cycle') state.world.worldQuestCycle = 'test-cycle-2';
      state.worldQuestLog.clear();
      state.puzzle.refreshIfChanged();
      expect(state.root.style.display).toBe('none');
      expect(state.root.dataset.outcome).toBeUndefined();
      expect(state.root.textContent).not.toContain('Ley Beam Alignment');
      expect(state.root.querySelector('.wqm-effect')).toBeNull();
      state.puzzle.close();
    },
  );

  it('does not steal focus from the outcome action when a duplicate completion or relocalization arrives', () => {
    const state = setup();
    const done = questEventPresentation({ type: 'worldQuestDone', questId: quest.id, pid: 1 })!;
    state.puzzle.applyEventPresentation(done);
    const action = state.root.querySelector<HTMLButtonElement>('.wqm-reset')!;
    action.focus();
    state.puzzle.applyEventPresentation(done);
    state.puzzle.relocalize();
    state.puzzle.refreshIfChanged();
    expect(document.activeElement).toBe(action);
    state.puzzle.close();
  });

  it('keeps victory visible through an area-close event until the player dismisses it', () => {
    const state = setup();
    state.puzzle.applyEventPresentation(
      questEventPresentation({ type: 'worldQuestDone', questId: quest.id, pid: 1 })!,
    );
    state.puzzle.applyEventPresentation({ closeWorldQuestPuzzle: quest.id });
    expect(state.root.style.display).toBe('flex');
    expect(state.root.dataset.outcome).toBe('won');
    state.root.querySelector<HTMLButtonElement>('.wqm-reset')!.click();
    expect(state.root.style.display).toBe('none');
    state.puzzle.open(quest.id);
    state.puzzle.applyEventPresentation({ closeWorldQuestPuzzle: quest.id });
    expect(state.root.style.display).toBe('none');
  });
});
