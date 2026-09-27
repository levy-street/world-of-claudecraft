// Development-only component capture. Imports the current working UI and styles.
import '../../src/styles/index.css';
import { ensureLocaleLoaded, getLanguage } from '../../src/ui/i18n';

await ensureLocaleLoaded(getLanguage());

import { WORLD_QUESTS_BY_ID } from '../../src/sim/content/world_quests';
import { applyWorldQuestMatch3Move } from '../../src/sim/world_quest_match3';
import {
  traceWorldQuestPuzzle,
  worldQuestPuzzleConnectors,
  worldQuestPuzzleInitialRotations,
} from '../../src/sim/world_quest_puzzle';
import { DEFAULT_THEME, resolveTheme, themeCssVars } from '../../src/ui/theme';
import { WorldQuestPuzzleWindow } from '../../src/ui/world_quest_puzzle_window';

const params = new URLSearchParams(location.search);
for (const [key, value] of Object.entries(
  themeCssVars(
    resolveTheme({ ...DEFAULT_THEME, preset: params.get('theme') || DEFAULT_THEME.preset } as any),
  ),
)) {
  document.documentElement.style.setProperty(key, value);
}
document.documentElement.style.setProperty('--app-vw', `${innerWidth}px`);
// Reserve space for the local design toolbar on touch previews.
document.documentElement.style.setProperty('--app-vh', `${innerHeight - 56}px`);
document.documentElement.style.setProperty('--ui-scale', params.get('scale') || '1');
document.querySelector<HTMLElement>('#ui')!.style.zoom = params.get('scale') || '1';
if (params.has('mobile')) document.body.classList.add('mobile-touch');
const questId = params.get('board') === 'ley' ? 'wq_galecrest_wisps' : 'wq_palmreach_confections';
const quest = WORLD_QUESTS_BY_ID[questId];
const variant = Number(params.get('variant') || 0);
const level = quest.objective.type === 'match3' ? quest.objective.levels[variant] : null;
const puzzle = quest.objective.type === 'puzzle' ? quest.objective.puzzles[variant] : null;
const progress: any = {
  questId,
  state: 'active',
  count: 0,
  puzzleVariant: variant,
  ...(level ? { match3Board: [...level.board], match3Moves: 0, match3RefillIndex: 0 } : {}),
  ...(puzzle ? { puzzleRotations: worldQuestPuzzleInitialRotations(puzzle) } : {}),
};
if (puzzle && params.has('powered')) progress.puzzleRotations = [0, 1, 0, 1, 3, 2, 1, 1, 0];
const world: any = {
  worldQuestCycle: 'wq3_0',
  worldQuestLog: new Map([[questId, progress]]),
  rotateWorldQuestPuzzleTile(_id: string, index: number) {
    if (!puzzle || progress.state !== 'active') return;
    progress.puzzleRotations[index] = (progress.puzzleRotations[index] + 1) % 4;
    board.applyEventPresentation({
      updateWorldQuestPuzzle: {
        questId,
        tileIndex: index,
        rotation: progress.puzzleRotations[index],
      },
    });
    if (traceWorldQuestPuzzle(puzzle, progress.puzzleRotations).solved) {
      progress.state = 'completed';
      progress.count = 1;
      delete progress.puzzleRotations;
      delete progress.puzzleVariant;
      board.applyEventPresentation({ completeWorldQuestPuzzle: questId });
    }
    board.refreshIfChanged();
  },
  swapWorldQuestMatch3Tiles(_id: string, from: number, to: number) {
    if (!level || progress.state !== 'active' || progress.match3Moves >= level.maxMoves) return;
    const result = applyWorldQuestMatch3Move(
      level,
      progress.match3Board,
      from,
      to,
      progress.match3RefillIndex,
    );
    if (!result.accepted) return;
    progress.match3Board = result.board;
    progress.match3Moves++;
    progress.match3RefillIndex = result.refillIndex;
    progress.count = Math.min(level.target, progress.count + result.cleared);
    if (progress.count >= level.target) progress.state = 'completed';
    board.refreshIfChanged();
  },
  resetWorldQuestMatch3() {
    if (!level || progress.state !== 'active') return;
    Object.assign(progress, {
      match3Board: [...level.board],
      match3Moves: 0,
      match3RefillIndex: 0,
      count: 0,
    });
    board.refreshIfChanged();
  },
};
const board = new WorldQuestPuzzleWindow({
  document,
  world: () => world,
  closeOthers() {},
  click() {},
  openFocusTrap: () => ({ release() {}, focusFirst() {} }) as any,
});
board.open(questId);
function resetPreview() {
  board.close();
  Object.assign(progress, {
    state: 'active',
    count: 0,
    puzzleVariant: variant,
    match3Board: level ? [...level.board] : undefined,
    match3Moves: 0,
    match3RefillIndex: 0,
    puzzleRotations: puzzle ? worldQuestPuzzleInitialRotations(puzzle) : undefined,
  });
  board.open(questId);
}
function previewOutcome(outcome: 'won' | 'lost') {
  if (puzzle) {
    resetPreview();
    if (outcome === 'lost') {
      board.applyEventPresentation({ failWorldQuestPuzzle: questId });
      return;
    }
    const sides = ['north', 'east', 'south', 'west'] as const;
    function solve(
      index: number,
      incoming: any,
      rotations: number[],
      seen: Set<number>,
    ): number[] | null {
      if (seen.has(index)) return null;
      const visited = new Set([...seen, index]);
      for (let rotation = 0; rotation < 4; rotation++) {
        const connectors = worldQuestPuzzleConnectors(puzzle!.tiles[index].kind, rotation);
        if (!connectors.includes(incoming)) continue;
        const outgoing = connectors[0] === incoming ? connectors[1] : connectors[0];
        const nextRotations = [...rotations];
        nextRotations[index] = rotation;
        if (index === puzzle!.target.tileIndex && outgoing === puzzle!.target.side)
          return nextRotations;
        const x = index % puzzle!.columns,
          y = Math.floor(index / puzzle!.columns);
        const nx = x + (outgoing === 'east' ? 1 : outgoing === 'west' ? -1 : 0);
        const ny = y + (outgoing === 'south' ? 1 : outgoing === 'north' ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= puzzle!.columns || ny >= puzzle!.rows) continue;
        const result = solve(
          ny * puzzle!.columns + nx,
          sides[(sides.indexOf(outgoing) + 2) % 4],
          nextRotations,
          visited,
        );
        if (result) return result;
      }
      return null;
    }
    const solution = solve(
      puzzle.source.tileIndex,
      puzzle.source.side,
      progress.puzzleRotations,
      new Set(),
    );
    if (!solution) throw new Error('Authored puzzle has no solution');
    for (const [index, rotation] of solution.entries()) {
      while (progress.state === 'active' && progress.puzzleRotations[index] !== rotation)
        world.rotateWorldQuestPuzzleTile(questId, index);
    }
    return;
  }
  if (!level) return;
  resetPreview();
  Object.assign(progress, {
    state: outcome === 'won' ? 'completed' : 'active',
    count: outcome === 'won' ? level.target : 54,
    match3Moves: level.maxMoves,
  });
  board.refreshIfChanged();
}
function previewClear(target: number) {
  if (!level) return;
  resetPreview();
  const queue = [{ board: [...level.board], refill: 0, depth: 0 }];
  for (let cursor = 0; cursor < queue.length && cursor < 300; cursor++) {
    const before = queue[cursor];
    for (let from = 0; from < before.board.length; from++)
      for (const to of [from + 1, from + level.columns]) {
        const result = applyWorldQuestMatch3Move(level, before.board, from, to, before.refill);
        if (!result.accepted) continue;
        if (result.cleared === target || (target >= 8 && result.cleared >= target)) {
          Object.assign(progress, {
            match3Board: [...before.board],
            match3RefillIndex: before.refill,
          });
          board.refreshIfChanged();
          document.querySelector<HTMLButtonElement>(`[data-match3-cell="${from}"]`)!.click();
          document.querySelector<HTMLButtonElement>(`[data-match3-cell="${to}"]`)!.click();
          return result.cleared;
        }
        if (before.depth < 3 && queue.length < 300)
          queue.push({ board: result.board, refill: result.refillIndex, depth: before.depth + 1 });
      }
  }
  throw new Error('No authored clear example found');
}
if (level || puzzle) {
  const toolbar = document.createElement('nav');
  toolbar.setAttribute('aria-label', 'Design preview controls');
  toolbar.id = 'preview-controls';
  toolbar.innerHTML =
    '<span>DESIGN PREVIEW</span><button data-preview="reset">Reset</button><button data-clear="3">3 clear</button><button data-clear="5">5 clear</button><button data-clear="8">Cascade</button><button data-preview="won">Victory</button><button data-preview="lost">Defeat</button>';
  if (puzzle)
    toolbar.innerHTML =
      '<span>DESIGN PREVIEW</span><button data-preview="reset">Reset</button><button data-preview="won">Victory</button><button data-preview="lost">Defeat design</button>';
  toolbar.addEventListener('click', (event) => {
    const clear = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-clear]')?.dataset
      .clear;
    if (clear) previewClear(Number(clear));
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-preview]')
      ?.dataset.preview;
    if (action === 'reset') resetPreview();
    if (action === 'won' || action === 'lost') previewOutcome(action);
  });
  document.body.append(toolbar);
  const style = document.createElement('style');
  style.textContent =
    '#preview-controls{position:fixed;z-index:999999;bottom:3px;left:50%;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;background:#100e0be8;border:1px solid #78613c;border-radius:5px;padding:3px 7px;color:#c7b28d;font:12px Arial,sans-serif}#preview-controls span{font-size:9px;letter-spacing:1px}#preview-controls button{background:#352a1a;color:#fff0ca;border:1px solid #78613c;border-radius:3px;min-height:40px;min-width:40px;font:12px Arial,sans-serif;padding:4px 6px;cursor:pointer}@media(max-width:600px){#preview-controls span{display:none}#preview-controls{gap:5px}}';
  document.head.append(style);
}
(window as any).__puzzlePreview = {
  board,
  world,
  questId,
  progress,
  previewOutcome,
  resetPreview,
  previewClear,
  acceptedMove() {
    if (!level) return null;
    for (let from = 0; from < level.board.length; from++) {
      for (const to of [from + 1, from + level.columns]) {
        const result = applyWorldQuestMatch3Move(
          level,
          progress.match3Board,
          from,
          to,
          progress.match3RefillIndex,
        );
        if (result.accepted) return { from, to, result };
      }
    }
    return null;
  },
};
if (params.get('outcome') === 'won' || params.get('outcome') === 'lost')
  previewOutcome(params.get('outcome') as 'won' | 'lost');
document.documentElement.dataset.previewReady = '1';
