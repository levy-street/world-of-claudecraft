import { describe, expect, it, vi } from 'vitest';
import { newFlatCustomMap } from '../src/editor/custom_map';
import { createPondCommand } from '../src/editor/pond_commands';
import { planPond, pondTerrainMatches } from '../src/editor/pond_core';
import { UndoStack } from '../src/editor/undo_core';
import { MAX_PLACEMENTS, MAX_TERRAIN_EDITS, type MapPlacement } from '../src/sim/map_doc';
import type { HeightStamp } from '../src/sim/types';

function required<T>(value: T | null): T {
  if (value === null) throw new Error('Expected a pond command');
  return value;
}

const priorStamp: HeightStamp = { x: 50, z: 60, radius: 4, delta: 1, falloff: 'smooth' };
const priorPlacement: MapPlacement = {
  assetId: 'props/crate',
  x: 0,
  z: 0,
  rotY: 0,
  scale: 1,
  collide: false,
};
const plan = required(planPond({ x: 12, z: 16, radius: 8, depth: 2 }, () => 10));

function garden() {
  const map = newFlatCustomMap('Pond command', 'pond-command', 42);
  map.terrainEdits = [{ ...priorStamp }];
  map.placements = [{ ...priorPlacement }];
  map.waterLevel = -15;
  return map;
}

describe('pond document command', () => {
  it('rolls back basin and water before recording undo when final terrain overrides the stamps', () => {
    const map = garden();
    const before = structuredClone(map);
    const changed = vi.fn();
    const stack = new UndoStack();
    const command = required(createPondCommand(map, plan, changed));
    command.redo();
    const valid = pondTerrainMatches(plan, () => 10); // Authored pad wins after stamp evaluation.
    expect(valid).toBe(false);
    if (valid) stack.push(command);
    else command.undo();
    expect(map).toEqual(before);
    expect(stack.depth).toBe(0);
    expect(stack.redoDepth).toBe(0);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('adds and undoes the complete pond in one step, retaining live arrays and unrelated content', () => {
    const map = garden();
    const terrain = map.terrainEdits;
    const placements = map.placements;
    const changed = vi.fn();
    const command = required(createPondCommand(map, plan, changed));
    expect(terrain).toEqual([priorStamp]);
    expect(placements).toEqual([priorPlacement]);
    expect(changed).not.toHaveBeenCalled();
    command.redo();
    const stack = new UndoStack();
    stack.push(command);
    expect(stack.depth).toBe(1);
    expect(terrain).toEqual([priorStamp, ...plan.stamps]);
    expect(placements).toEqual([priorPlacement, plan.water]);
    expect(changed).toHaveBeenLastCalledWith(plan.region);
    stack.undo();
    expect(terrain).toEqual([priorStamp]);
    expect(placements).toEqual([priorPlacement]);
    stack.redo();
    expect(terrain).toEqual([priorStamp, ...plan.stamps]);
    expect(placements).toEqual([priorPlacement, plan.water]);
    expect(map.terrainEdits).toBe(terrain);
    expect(map.placements).toBe(placements);
    expect(map.waterLevel).toBe(-15);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it.each([
    { terrain: MAX_TERRAIN_EDITS - 1, placements: 0 },
    { terrain: 0, placements: MAX_PLACEMENTS },
  ])('refuses the entire pond when either document cap has no room: %j', (counts) => {
    const map = garden();
    map.terrainEdits = Array(counts.terrain).fill(priorStamp);
    map.placements = Array(counts.placements).fill(priorPlacement);
    const changed = vi.fn();
    expect(createPondCommand(map, plan, changed)).toBeNull();
    expect(map.terrainEdits).toHaveLength(counts.terrain);
    expect(map.placements).toHaveLength(counts.placements);
    expect(changed).not.toHaveBeenCalled();
  });

  it('uses the final available slots and preserves them exactly over undo and redo', () => {
    const map = garden();
    map.terrainEdits = Array(MAX_TERRAIN_EDITS - 2).fill(priorStamp);
    map.placements = Array(MAX_PLACEMENTS - 1).fill(priorPlacement);
    const command = required(createPondCommand(map, plan, vi.fn()));
    command.redo();
    expect(map.terrainEdits).toHaveLength(MAX_TERRAIN_EDITS);
    expect(map.placements).toHaveLength(MAX_PLACEMENTS);
    command.undo();
    expect(map.terrainEdits).toHaveLength(MAX_TERRAIN_EDITS - 2);
    expect(map.placements).toHaveLength(MAX_PLACEMENTS - 1);
    command.redo();
    expect(map.terrainEdits.slice(-2)).toEqual(plan.stamps);
    expect(map.placements.at(-1)).toEqual(plan.water);
  });

  it('rechecks both caps before initial apply so a changed document cannot receive half a pond', () => {
    const map = garden();
    const changed = vi.fn();
    const command = required(createPondCommand(map, plan, changed));
    map.placements = Array(MAX_PLACEMENTS).fill(priorPlacement);
    command.redo();
    expect(map.terrainEdits).toEqual([priorStamp]);
    expect(map.placements).toHaveLength(MAX_PLACEMENTS);
    expect(changed).not.toHaveBeenCalled();
    command.undo();
    expect(map.terrainEdits).toEqual([priorStamp]);
  });

  it('snapshots its plan and only removes its own entries when other content is inserted', () => {
    const map = garden();
    const draft = structuredClone(plan);
    const command = required(createPondCommand(map, draft, vi.fn()));
    draft.stamps[0].delta = -150;
    draft.water.sizeY = 90;
    command.redo();
    expect(map.terrainEdits.slice(-2)).toEqual(plan.stamps);
    expect(map.placements.at(-1)).toEqual(plan.water);
    const extra = { ...priorPlacement, x: 100 };
    map.placements.unshift(extra);
    command.undo();
    expect(map.placements).toEqual([extra, priorPlacement]);
    expect(map.terrainEdits).toEqual([priorStamp]);
  });
});
