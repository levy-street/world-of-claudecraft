// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import type { WorldQuestProgress } from '../src/sim/types';
import { generateDailyLeyPuzzle } from '../src/sim/world_quest_daily_generation';
import { worldQuestPuzzleConnectors } from '../src/sim/world_quest_puzzle';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { questEventPresentation } from '../src/ui/quest_event_view';
import { WorldQuestPuzzleWindow } from '../src/ui/world_quest_puzzle_window';

const questId = 'wq_galecrest_wisps';
function rig() {
  const quest = WORLD_QUESTS_BY_ID[questId];
  if (quest.objective.type !== 'puzzle') throw new Error('Expected beam fixture');
  const progress: WorldQuestProgress = {
    questId,
    state: 'active',
    count: 0,
    puzzleExpiresAt: 90,
    puzzleVariant: 0,
    puzzleRotations: quest.objective.puzzles[0].tiles.map((tile) => tile.initialRotation),
  };
  const world = {
    worldQuestCycle: 'cycle-a',
    worldQuestTime: 0,
    worldQuestLog: new Map([[questId, progress]]),
    rotateWorldQuestPuzzleTile: vi.fn(),
    swapWorldQuestMatch3Tiles: vi.fn(),
    resetWorldQuestMatch3: vi.fn(),
    resetWorldQuestPuzzle: vi.fn(),
  };
  const panel = new WorldQuestPuzzleWindow({
    document,
    world: () => world,
    closeOthers: vi.fn(),
    click: vi.fn(),
    openFocusTrap: () => ({ release: vi.fn(), focusFirst: vi.fn(), opener: () => null }),
  });
  panel.open(questId);
  const root = document.getElementById('world-quest-puzzle-window')!;
  return { panel, root, world, progress };
}

describe('Ley Beam Alignment presentation', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="ui"></main>';
    setLanguage('en');
  });
  afterEach(() => setLanguage('en'));

  it('opens visibly different daily boards through puzzle events and repeats day 1 on day 33', () => {
    const { panel, root, progress } = rig();
    const signatures: string[] = [];
    try {
      for (const day of [1, 2, 16, 33]) {
        const puzzle = generateDailyLeyPuzzle(day - 1);
        progress.puzzleDay = day - 1;
        progress.puzzleRotations = puzzle.tiles.map((tile) => tile.initialRotation);
        panel.applyEventPresentation(
          questEventPresentation({ type: 'worldQuestPuzzleOpened', questId })!,
        );
        expect(root.style.display).toBe('flex');
        expect(root.querySelector('.wql-timer')?.textContent).toBe('90s');
        const tiles = [...root.querySelectorAll<HTMLElement>('[data-puzzle-tile]')];
        expect(tiles).toHaveLength(16);
        for (const [kind, endpoint] of [
          ['source', puzzle.source],
          ['target', puzzle.target],
        ] as const) {
          const edge = root.querySelector(`.wqp-edge.${kind}`);
          expect(edge?.parentElement?.dataset.puzzleTile).toBe(String(endpoint.tileIndex));
          expect(edge?.classList.contains(endpoint.side)).toBe(true);
        }
        const visible = tiles.map((tile, index) => {
          const arms = [...tile.querySelectorAll<HTMLElement>('.wqp-arm')]
            .filter((arm) => !arm.hidden)
            .map((arm) => [...arm.classList].find((name) => name !== 'wqp-arm'));
          expect(arms.sort()).toEqual(
            [
              ...worldQuestPuzzleConnectors(
                puzzle.tiles[index].kind,
                puzzle.tiles[index].initialRotation,
              ),
            ].sort(),
          );
          return {
            arms,
            edges: [...tile.querySelectorAll('.wqp-edge')].map((edge) => edge.className),
          };
        });
        signatures.push(JSON.stringify(visible));
      }
      expect(new Set(signatures.slice(0, 3)).size).toBe(3);
      expect(signatures[3]).toBe(signatures[0]);
    } finally {
      panel.close();
    }
  });

  it('starts each alignment attempt with 90 seconds remaining', () => {
    const { panel, root } = rig();
    expect(root.querySelector('.wql-timer')?.textContent).toBe('90s');
    panel.close();
  });

  it('counts down once per second and releases the timer when closed', () => {
    vi.useFakeTimers();
    try {
      const { panel, root } = rig();
      const timer = root.querySelector('.wql-timer');
      vi.advanceTimersByTime(1_000);
      expect(timer?.textContent).toBe('89s');
      panel.close();
      vi.advanceTimersByTime(5_000);
      expect(timer?.textContent).toBe('89s');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the observed winning circuit after authoritative completion removes rotations', () => {
    const { panel, root, world } = rig();
    for (const [tileIndex, rotation] of [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 3],
    ]) {
      panel.applyEventPresentation(
        questEventPresentation({
          type: 'worldQuestPuzzleUpdated',
          questId,
          pid: 1,
          tileIndex,
          rotation,
        })!,
      );
    }
    world.worldQuestLog.set(questId, { questId, state: 'completed', count: 1 });
    panel.applyEventPresentation(
      questEventPresentation({ type: 'worldQuestDone', questId, pid: 1 })!,
    );
    panel.refreshIfChanged();
    expect(root.style.display).toBe('flex');
    expect(root.dataset.leyOutcome).toBe('won');
    expect(root.querySelectorAll('.wqp-tile')).toHaveLength(9);
    expect(
      [...root.querySelectorAll('.wqp-tile.powered')].map((e) =>
        e.getAttribute('data-puzzle-tile'),
      ),
    ).toEqual(['1', '2', '3', '4']);
    expect(root.querySelector('.wql-result-title')?.textContent).toBe('Perfect alignment');
    expect(document.activeElement).toBe(root.querySelector('.wql-result'));
    expect(root.querySelectorAll('.wqp-tile:disabled')).toHaveLength(9);
    panel.close();
  });

  it('never awards a visual victory to an unconfirmed solved active board', () => {
    const { panel, root, world, progress } = rig();
    const rotations = [...progress.puzzleRotations!];
    for (const [index, rotation] of [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 3],
    ])
      rotations[index] = rotation;
    world.worldQuestLog.set(questId, { ...progress, puzzleRotations: rotations });
    panel.refreshIfChanged();
    expect(root.dataset.leyOutcome).toBe('playing');
    expect((root.querySelector('.wql-result') as HTMLElement).hidden).toBe(true);
    panel.close();
  });
  it('shows defeat from an authoritative expired snapshot even when its event was missed', () => {
    const { panel, root, world, progress } = rig();
    progress.puzzleExpiresAt = 0;
    world.worldQuestTime = 90;
    panel.refreshIfChanged();
    const timer = root.querySelector<HTMLElement>('.wql-timer');
    expect(root.dataset.leyOutcome).toBe('lost');
    expect(timer?.hidden).toBe(true);
    expect(timer?.getAttribute('aria-label')).toBeNull();
    panel.close();
  });
  it('provides defeat only through the design hook and clears it on a new cycle', () => {
    const { panel, root, world, progress } = rig();
    panel.applyEventPresentation({ failWorldQuestPuzzle: questId });
    expect(root.dataset.leyOutcome).toBe('lost');
    expect(progress.state).toBe('active');
    expect(root.querySelector('.wql-result-title')?.textContent).toBe('Alignment lost');
    const retryBtn = root.querySelector<HTMLButtonElement>('[data-ley-retry]')!;
    expect(retryBtn.hidden).toBe(false);
    retryBtn.click();
    expect(world.resetWorldQuestPuzzle).toHaveBeenCalledWith(questId);
    expect(root.dataset.leyOutcome).toBe('lost');
    progress.puzzleExpiresAt = 180;
    world.worldQuestTime = 90;
    panel.refreshIfChanged();
    expect(root.dataset.leyOutcome).toBe('playing');
    expect(root.querySelector('.wql-timer')?.textContent).toBe('90s');
    world.worldQuestCycle = 'cycle-b';
    panel.refreshIfChanged();
    expect(root.style.display).toBe('none');
    expect(root.dataset.leyOutcome).toBeUndefined();
  });
  it('preserves a focused tile across confirmed turns and closes normally during play', () => {
    const { panel, root, progress } = rig();
    const tile = root.querySelector<HTMLButtonElement>('[data-puzzle-tile="3"]')!;
    tile.focus();
    progress.puzzleRotations![3] = 1;
    panel.refreshIfChanged();
    expect(root.querySelector('[data-puzzle-tile="3"]')).toBe(tile);
    expect(document.activeElement).toBe(tile);
    expect(tile.classList.contains('powered')).toBe(true);
    panel.applyEventPresentation({ closeWorldQuestPuzzle: questId });
    expect(root.style.display).toBe('none');
  });
  it('relocalizes tile labels while preserving the terminal board and focused result', async () => {
    const { panel, root } = rig();
    panel.applyEventPresentation({ completeWorldQuestPuzzle: questId });
    const tile = root.querySelector<HTMLButtonElement>('[data-puzzle-tile="3"]')!;
    const english = tile.getAttribute('aria-label');
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    panel.relocalize();
    expect(tile.getAttribute('aria-label')).not.toBe(english);
    expect(root.dataset.leyOutcome).toBe('won');
    expect(document.activeElement).toBe(root.querySelector('.wql-result'));
    panel.close();
  });
});
