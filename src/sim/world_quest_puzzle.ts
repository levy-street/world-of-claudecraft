// Pure beam-puzzle rules shared by the authoritative sim and presentation.
// Rotations are quarter-turns clockwise; every tile has exactly two connectors.

import type { WorldQuestBeamPuzzleDef, WorldQuestBeamSide } from './types';

const SIDES: readonly WorldQuestBeamSide[] = ['north', 'east', 'south', 'west'];

function normalizedRotation(value: unknown): number {
  return Number.isInteger(value) ? (((value as number) % 4) + 4) % 4 : 0;
}

export function worldQuestPuzzleInitialRotations(puzzle: WorldQuestBeamPuzzleDef): number[] {
  return puzzle.tiles.map((tile) => normalizedRotation(tile.initialRotation));
}

export function sanitizeWorldQuestPuzzleRotations(
  value: unknown,
  puzzle: WorldQuestBeamPuzzleDef,
): number[] {
  const fallback = worldQuestPuzzleInitialRotations(puzzle);
  if (!Array.isArray(value) || value.length !== puzzle.tiles.length) return fallback;
  return value.map((rotation, index) =>
    Number.isInteger(rotation) ? normalizedRotation(rotation) : fallback[index],
  );
}

export function worldQuestPuzzleConnectors(
  kind: 'straight' | 'corner',
  rotation: number,
): readonly [WorldQuestBeamSide, WorldQuestBeamSide] {
  const turn = normalizedRotation(rotation);
  if (kind === 'straight') {
    return turn % 2 === 0 ? ['north', 'south'] : ['east', 'west'];
  }
  return [SIDES[turn], SIDES[(turn + 1) % 4]];
}

function opposite(side: WorldQuestBeamSide): WorldQuestBeamSide {
  return SIDES[(SIDES.indexOf(side) + 2) % 4];
}

function adjacentTile(
  tileIndex: number,
  outgoing: WorldQuestBeamSide,
  columns: number,
  rows: number,
): number | null {
  const x = tileIndex % columns;
  const y = Math.floor(tileIndex / columns);
  if (outgoing === 'north') return y > 0 ? tileIndex - columns : null;
  if (outgoing === 'east') return x + 1 < columns ? tileIndex + 1 : null;
  if (outgoing === 'south') return y + 1 < rows ? tileIndex + columns : null;
  return x > 0 ? tileIndex - 1 : null;
}

export interface WorldQuestPuzzleTrace {
  path: number[];
  solved: boolean;
}

/** Follow the beam until it leaves the board, reaches the target, or loops. */
export function traceWorldQuestPuzzle(
  puzzle: WorldQuestBeamPuzzleDef,
  rotations: readonly number[],
): WorldQuestPuzzleTrace {
  if (
    puzzle.columns <= 0 ||
    puzzle.rows <= 0 ||
    puzzle.tiles.length !== puzzle.columns * puzzle.rows ||
    rotations.length !== puzzle.tiles.length
  ) {
    return { path: [], solved: false };
  }
  let tileIndex = puzzle.source.tileIndex;
  let incoming = puzzle.source.side;
  const path: number[] = [];
  const visited = new Set<string>();
  while (tileIndex >= 0 && tileIndex < puzzle.tiles.length) {
    const visitKey = `${tileIndex}:${incoming}`;
    if (visited.has(visitKey)) break;
    visited.add(visitKey);
    const connectors = worldQuestPuzzleConnectors(
      puzzle.tiles[tileIndex].kind,
      rotations[tileIndex],
    );
    if (!connectors.includes(incoming)) break;
    path.push(tileIndex);
    const outgoing = connectors[0] === incoming ? connectors[1] : connectors[0];
    if (tileIndex === puzzle.target.tileIndex && outgoing === puzzle.target.side) {
      return { path, solved: true };
    }
    const next = adjacentTile(tileIndex, outgoing, puzzle.columns, puzzle.rows);
    if (next === null) break;
    tileIndex = next;
    incoming = opposite(outgoing);
  }
  return { path, solved: false };
}
