// Thirty-two procedural daily variants, exhaustively certified by the paired tests.
// The cycle permits repetition after a month and bounds validation work.
import { Rng } from './rng';
import type {
  WorldQuestBeamPuzzleDef,
  WorldQuestBeamSide,
  WorldQuestMatch3Candy,
  WorldQuestMatch3LevelDef,
} from './types';
import { applyWorldQuestMatch3Move } from './world_quest_match3';
import { traceWorldQuestPuzzle, worldQuestPuzzleConnectors } from './world_quest_puzzle';

export const WORLD_QUEST_DAILY_GENERATION_CYCLE = 32;

function variant(day: number): number {
  const safe = Number.isSafeInteger(day) ? day : 0;
  return (
    ((safe % WORLD_QUEST_DAILY_GENERATION_CYCLE) + WORLD_QUEST_DAILY_GENERATION_CYCLE) %
    WORLD_QUEST_DAILY_GENERATION_CYCLE
  );
}

// The grid side is a parameter so the daily 4x4 and the bonus 5x5 / 6x6 boards
// share one constructor. Every draw below happens in the same order for size 4
// as it did before the parameter existed, so the certified daily catalog is
// byte-identical (tests/world_quest_daily_generation.test.ts).
function outsideSides(index: number, size = 4): WorldQuestBeamSide[] {
  const sides: WorldQuestBeamSide[] = [];
  if (index < size) sides.push('north');
  if (index % size === size - 1) sides.push('east');
  if (index >= size * (size - 1)) sides.push('south');
  if (index % size === 0) sides.push('west');
  return sides;
}

function sideToward(from: number, to: number, size = 4): WorldQuestBeamSide {
  if (to === from - size) return 'north';
  if (to === from + 1) return 'east';
  if (to === from + size) return 'south';
  return 'west';
}

function borderCells(size: number): number[] {
  const cells: number[] = [];
  for (let index = 0; index < size * size; index++)
    if (outsideSides(index, size).length > 0) cells.push(index);
  return cells;
}

/** Construct a simple route first, then scramble its connectors. */
function buildLeyCandidate(
  rng: Rng,
  size: number,
): {
  puzzle: WorldQuestBeamPuzzleDef;
  solution: number[];
} | null {
  const cellCount = size * size;
  const path = [rng.pick(borderCells(size))];
  // 7..10 on the daily 4x4; a longer route on the larger bonus boards.
  const length = rng.int(2 * size - 1, 3 * size - 2);
  while (path.length < length) {
    const current = path[path.length - 1];
    const neighbors = [current - size, current + 1, current + size, current - 1].filter(
      (next) =>
        next >= 0 &&
        next < cellCount &&
        !path.includes(next) &&
        Math.abs((next % size) - (current % size)) +
          Math.abs(Math.floor(next / size) - Math.floor(current / size)) ===
          1,
    );
    if (neighbors.length === 0) return null;
    path.push(rng.pick(neighbors));
  }
  const exits = outsideSides(path[path.length - 1], size);
  if (exits.length === 0) return null;
  const source = { tileIndex: path[0], side: rng.pick(outsideSides(path[0], size)) };
  const target = { tileIndex: path[path.length - 1], side: rng.pick(exits) };
  const tiles: Array<{ kind: 'straight' | 'corner'; initialRotation: number }> = Array.from(
    { length: cellCount },
    () => ({
      kind: rng.chance(0.5) ? 'corner' : 'straight',
      initialRotation: rng.int(0, 3),
    }),
  );
  const solution = tiles.map((tile) => tile.initialRotation);
  for (let step = 0; step < path.length; step++) {
    const index = path[step];
    const incoming: WorldQuestBeamSide =
      step === 0 ? source.side : sideToward(index, path[step - 1], size);
    const outgoing: WorldQuestBeamSide =
      step === path.length - 1 ? target.side : sideToward(index, path[step + 1], size);
    const kind =
      worldQuestPuzzleConnectors('straight', 0).includes(incoming) ===
      worldQuestPuzzleConnectors('straight', 0).includes(outgoing)
        ? 'straight'
        : 'corner';
    let rotation = 0;
    while (
      !worldQuestPuzzleConnectors(kind, rotation).includes(incoming) ||
      !worldQuestPuzzleConnectors(kind, rotation).includes(outgoing)
    )
      rotation++;
    solution[index] = rotation;
    tiles[index] = {
      kind,
      initialRotation: (rotation + rng.int(1, kind === 'straight' ? 1 : 3)) % 4,
    };
  }
  const puzzle: WorldQuestBeamPuzzleDef = {
    columns: size,
    rows: size,
    source,
    target,
    tiles,
  };
  if (
    path.filter((index) => tiles[index].kind === 'corner').length < size - 1 ||
    !traceWorldQuestPuzzle(puzzle, solution).solved ||
    traceWorldQuestPuzzle(
      puzzle,
      tiles.map((tile) => tile.initialRotation),
    ).solved
  )
    return null;
  return { puzzle, solution };
}

function buildDailyLeyCandidate(rng: Rng) {
  return buildLeyCandidate(rng, 4);
}

export function generateDailyLeyPuzzle(day: number): WorldQuestBeamPuzzleDef {
  return leyCatalog[variant(day)].puzzle;
}

export function generateDailyLeyChallenge(day: number): {
  readonly puzzle: WorldQuestBeamPuzzleDef;
  readonly solution: readonly number[];
} {
  return leyCatalog[variant(day)];
}

/** Bonus boards past the daily solve: level 1 is 5x5, level 2 is 6x6. */
export const WORLD_QUEST_LEY_BONUS_SIZES = [5, 6] as const;
export const WORLD_QUEST_LEY_BONUS_LEVELS = WORLD_QUEST_LEY_BONUS_SIZES.length;

export function generateBonusLeyChallenge(
  day: number,
  level: number,
): {
  readonly puzzle: WorldQuestBeamPuzzleDef;
  readonly solution: readonly number[];
} {
  const index = Math.max(1, Math.min(WORLD_QUEST_LEY_BONUS_LEVELS, Math.floor(level))) - 1;
  return leyBonusCatalogs[index][variant(day)];
}

export function generateBonusLeyPuzzle(day: number, level: number): WorldQuestBeamPuzzleDef {
  return generateBonusLeyChallenge(day, level).puzzle;
}

export type DailyMatch3Move = readonly [number, number];

/** Bounded constructive witness using the real swap, gravity and refill rules. */
export function solveDailyMatch3Level(level: WorldQuestMatch3LevelDef): DailyMatch3Move[] | null {
  let board = [...level.board];
  let refillIndex = 0;
  let cleared = 0;
  const witness: DailyMatch3Move[] = [];
  for (let move = 0; move < level.maxMoves; move++) {
    let best: ReturnType<typeof applyWorldQuestMatch3Move> | undefined;
    let bestPair: DailyMatch3Move = [0, 0];
    for (let from = 0; from < board.length; from++) {
      for (const to of [
        (from % level.columns) + 1 < level.columns ? from + 1 : -1,
        from + level.columns,
      ]) {
        if (to < 0 || to >= board.length || board[from] === board[to]) continue;
        const result = applyWorldQuestMatch3Move(level, board, from, to, refillIndex);
        if (result.accepted && (!best || result.cleared > best.cleared)) {
          best = result;
          bestPair = [from, to];
        }
      }
    }
    if (!best) return null;
    witness.push(bestPair);
    board = best.board;
    refillIndex = best.refillIndex;
    cleared += best.cleared;
    if (cleared >= level.target) return witness;
  }
  return null;
}

function buildDailyMatch3Level(day: number): WorldQuestMatch3LevelDef {
  const rng = new Rng(0xca7d0000 + variant(day));
  for (let attempt = 0; attempt < 32; attempt++) {
    const board: WorldQuestMatch3Candy[] = [];
    for (let index = 0; index < 36; index++) {
      const choices: WorldQuestMatch3Candy[] = [0, 1, 2, 3, 4];
      const allowed = choices.filter(
        (candy) =>
          !(index % 6 >= 2 && board[index - 1] === candy && board[index - 2] === candy) &&
          !(index >= 12 && board[index - 6] === candy && board[index - 12] === candy),
      );
      board.push(rng.pick(allowed));
    }
    const level: WorldQuestMatch3LevelDef = {
      columns: 6,
      rows: 6,
      board,
      refill: Array.from({ length: 128 }, () => rng.int(0, 4) as WorldQuestMatch3Candy),
      target: 72,
      maxMoves: 20,
    };
    if (solveDailyMatch3Level(level)) {
      Object.freeze(level.board);
      Object.freeze(level.refill);
      return Object.freeze(level);
    }
  }
  // Every possible cycle member is exercised in tests. Never ship a candidate
  // without a winning witness if the rules change and invalidate that contract.
  throw new Error('Daily match-three generator failed its solvability contract');
}

// Immutable derived content, built and certified once per host. Repeated UI,
// snapshot and command reads are O(1), without any mutable module-global memo.
function buildLeyCatalog(size: number, seedBase: number) {
  // Construction-only uniqueness state: lookup never mutates the frozen catalog.
  const routes = new Set<string>();
  return Object.freeze(
    Array.from({ length: WORLD_QUEST_DAILY_GENERATION_CYCLE }, (_, day) => {
      const rng = new Rng(seedBase + day);
      for (let attempt = 0; attempt < 256; attempt++) {
        const challenge = size === 4 ? buildDailyLeyCandidate(rng) : buildLeyCandidate(rng, size);
        if (!challenge) continue;
        const path = traceWorldQuestPuzzle(challenge.puzzle, challenge.solution).path;
        const signature = [path.join(','), [...path].reverse().join(',')].sort()[0];
        if (routes.has(signature)) continue;
        routes.add(signature);
        for (const tile of challenge.puzzle.tiles) Object.freeze(tile);
        Object.freeze(challenge.puzzle.tiles);
        Object.freeze(challenge.puzzle.source);
        Object.freeze(challenge.puzzle.target);
        Object.freeze(challenge.puzzle);
        Object.freeze(challenge.solution);
        return Object.freeze(challenge);
      }
      throw new Error('Daily ley generator failed its distinct solvable route contract');
    }),
  );
}
const leyCatalog = buildLeyCatalog(4, 0x1e7be000);
// Bonus catalogs: their own seed lanes, so neither depends on the daily draws.
const leyBonusCatalogs = Object.freeze(
  WORLD_QUEST_LEY_BONUS_SIZES.map((size) => buildLeyCatalog(size, 0x1e7be000 + size * 0x10000)),
);
const match3Catalog = Object.freeze(
  Array.from({ length: WORLD_QUEST_DAILY_GENERATION_CYCLE }, (_, day) =>
    buildDailyMatch3Level(day),
  ),
);

export function generateDailyMatch3Level(day: number): WorldQuestMatch3LevelDef {
  return match3Catalog[variant(day)];
}
