// Pure, deterministic match-three rules. The authoritative sim owns every
// swap; authored refill tapes replace RNG and keep offline/server parity exact.

import type { WorldQuestMatch3Candy, WorldQuestMatch3LevelDef } from './types';

const CANDY_KINDS = 5;
const MAX_CASCADE_PASSES = 32;

function validCandy(value: unknown): value is WorldQuestMatch3Candy {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < CANDY_KINDS;
}

export function worldQuestMatch3InitialBoard(
  level: WorldQuestMatch3LevelDef,
): WorldQuestMatch3Candy[] {
  return level.board.map((value) => value);
}

export function sanitizeWorldQuestMatch3Board(
  value: unknown,
  level: WorldQuestMatch3LevelDef,
): WorldQuestMatch3Candy[] {
  if (!Array.isArray(value) || value.length !== level.columns * level.rows) {
    return worldQuestMatch3InitialBoard(level);
  }
  return value.every(validCandy) ? [...value] : worldQuestMatch3InitialBoard(level);
}

export function worldQuestMatch3Matches(
  board: readonly (WorldQuestMatch3Candy | null)[],
  columns: number,
  rows: number,
): Set<number> {
  const matches = new Set<number>();
  for (let row = 0; row < rows; row++) {
    let start = 0;
    for (let column = 1; column <= columns; column++) {
      const first = board[row * columns + start];
      const same = column < columns && first !== null && board[row * columns + column] === first;
      if (same) continue;
      if (first !== null && column - start >= 3) {
        for (let x = start; x < column; x++) matches.add(row * columns + x);
      }
      start = column;
    }
  }
  for (let column = 0; column < columns; column++) {
    let start = 0;
    for (let row = 1; row <= rows; row++) {
      const first = board[start * columns + column];
      const same = row < rows && first !== null && board[row * columns + column] === first;
      if (same) continue;
      if (first !== null && row - start >= 3) {
        for (let y = start; y < row; y++) matches.add(y * columns + column);
      }
      start = row;
    }
  }
  return matches;
}

function adjacent(a: number, b: number, columns: number): boolean {
  if (a === b) return false;
  const ax = a % columns;
  const ay = Math.floor(a / columns);
  const bx = b % columns;
  const by = Math.floor(b / columns);
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
}

function refillWithoutMatch(
  board: Array<WorldQuestMatch3Candy | null>,
  index: number,
  level: WorldQuestMatch3LevelDef,
  refillIndex: number,
): { candy: WorldQuestMatch3Candy; refillIndex: number } {
  for (let attempt = 0; attempt < CANDY_KINDS; attempt++) {
    const tape = level.refill[(refillIndex + attempt) % level.refill.length];
    const candy = validCandy(tape) ? tape : ((attempt % CANDY_KINDS) as WorldQuestMatch3Candy);
    board[index] = candy;
    if (worldQuestMatch3Matches(board, level.columns, level.rows).size === 0) {
      return { candy, refillIndex: refillIndex + attempt + 1 };
    }
  }
  const candy = (refillIndex % CANDY_KINDS) as WorldQuestMatch3Candy;
  return { candy, refillIndex: refillIndex + 1 };
}

export interface WorldQuestMatch3MoveResult {
  accepted: boolean;
  board: WorldQuestMatch3Candy[];
  cleared: number;
  refillIndex: number;
}

/** Swap adjacent candies, clear all lines and resolve deterministic cascades. */
export function applyWorldQuestMatch3Move(
  level: WorldQuestMatch3LevelDef,
  current: readonly WorldQuestMatch3Candy[],
  fromIndex: number,
  toIndex: number,
  refillIndex: number,
): WorldQuestMatch3MoveResult {
  const board = sanitizeWorldQuestMatch3Board(current, level);
  if (
    !Number.isSafeInteger(fromIndex) ||
    !Number.isSafeInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= board.length ||
    toIndex >= board.length ||
    !adjacent(fromIndex, toIndex, level.columns)
  ) {
    return { accepted: false, board, cleared: 0, refillIndex };
  }
  [board[fromIndex], board[toIndex]] = [board[toIndex], board[fromIndex]];
  let matches = worldQuestMatch3Matches(board, level.columns, level.rows);
  if (matches.size === 0) {
    [board[fromIndex], board[toIndex]] = [board[toIndex], board[fromIndex]];
    return { accepted: false, board, cleared: 0, refillIndex };
  }
  let cleared = 0;
  let nextRefill = Math.max(0, Number.isSafeInteger(refillIndex) ? refillIndex : 0);
  for (let pass = 0; pass < MAX_CASCADE_PASSES && matches.size > 0; pass++) {
    cleared += matches.size;
    const falling: Array<WorldQuestMatch3Candy | null> = board.map((value, index) =>
      matches.has(index) ? null : value,
    );
    for (let column = 0; column < level.columns; column++) {
      const kept: WorldQuestMatch3Candy[] = [];
      for (let row = level.rows - 1; row >= 0; row--) {
        const value = falling[row * level.columns + column];
        if (value !== null) kept.push(value);
      }
      let keptIndex = 0;
      for (let row = level.rows - 1; row >= 0; row--) {
        falling[row * level.columns + column] = keptIndex < kept.length ? kept[keptIndex++] : null;
      }
    }
    for (let index = 0; index < falling.length; index++) {
      if (falling[index] !== null) continue;
      const filled = refillWithoutMatch(falling, index, level, nextRefill);
      falling[index] = filled.candy;
      nextRefill = filled.refillIndex;
    }
    for (let index = 0; index < board.length; index++)
      board[index] = falling[index] as WorldQuestMatch3Candy;
    matches = worldQuestMatch3Matches(board, level.columns, level.rows);
  }
  return { accepted: true, board, cleared, refillIndex: nextRefill };
}
