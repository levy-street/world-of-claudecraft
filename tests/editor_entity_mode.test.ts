import { describe, expect, it } from 'vitest';
import {
  findRuntimeCampIndex,
  moveRuntimeMapEntity,
  moveRuntimeMobsById,
  pickMovableEntity,
  setRuntimeNpcFacing,
  splitCampIntoIndividuals,
  toggledMobSelection,
} from '../src/editor/entity_edit_core';
import type { EditorEntity } from '../src/editor/model';

const entity = (key: string, kind: EditorEntity['kind'], x: number, z: number): EditorEntity => ({
  key,
  kind,
  label: key,
  zoneId: null,
  radius: 2,
  point: { x, z },
});

describe('pickMovableEntity', () => {
  it('only picks NPCs and mob camps', () => {
    const entities = [
      entity('object:0:0', 'object', 0, 0),
      entity('npc:keeper', 'npc', 1, 0),
      entity('camp:0', 'camp', 8, 0),
    ];
    expect(pickMovableEntity(entities, { x: 0, z: 0 })?.key).toBe('npc:keeper');
    expect(pickMovableEntity(entities, { x: 8, z: 0 })?.key).toBe('camp:0');
  });

  it('returns null when no movable entity is close enough', () => {
    expect(pickMovableEntity([entity('npc:keeper', 'npc', 0, 0)], { x: 20, z: 20 })).toBeNull();
  });
});

describe('moveRuntimeMapEntity', () => {
  it('moves the matching live NPC without rebuilding the world', () => {
    const npc = {
      kind: 'npc',
      templateId: 'keeper',
      pos: { x: 1, y: 2, z: 3 },
      prevPos: { x: 1, y: 2, z: 3 },
      spawnPos: { x: 1, y: 2, z: 3 },
      leashAnchor: null,
      wanderTarget: null,
    };
    expect(
      moveRuntimeMapEntity([npc], 'npc:keeper', [], { x: 1, z: 3 }, { x: 8, z: 9 }, () => 4),
    ).toBe(1);
    expect(npc.pos).toEqual({ x: 8, y: 4, z: 9 });
    expect(npc.prevPos).toEqual(npc.pos);
    expect(npc.spawnPos).toEqual(npc.pos);
  });

  it('translates the matching camp mobs and their home positions', () => {
    const mob = {
      kind: 'mob',
      templateId: 'boar',
      pos: { x: 12, y: 1, z: 11 },
      prevPos: { x: 12, y: 1, z: 11 },
      spawnPos: { x: 12, y: 1, z: 11 },
      leashAnchor: { x: 12, y: 1, z: 11 },
      wanderTarget: { x: 13, y: 1, z: 12 },
    };
    const camps = [{ mobId: 'boar', center: { x: 10, z: 10 }, radius: 5, count: 1 }];
    expect(
      moveRuntimeMapEntity([mob], 'camp:0', camps, { x: 10, z: 10 }, { x: 20, z: 30 }, () => 6),
    ).toBe(1);
    expect(mob.pos).toEqual({ x: 22, y: 6, z: 31 });
    expect(mob.spawnPos).toEqual({ x: 22, y: 6, z: 31 });
    expect(mob.leashAnchor).toEqual({ x: 22, y: 6, z: 31 });
    expect(mob.wanderTarget).toEqual({ x: 23, y: 6, z: 32 });
  });
});

describe('setRuntimeNpcFacing', () => {
  it('rotates only the matching live NPC and keeps interpolation in sync', () => {
    const keeper = {
      kind: 'npc',
      templateId: 'keeper',
      facing: 0,
      prevFacing: 0,
    };
    const merchant = {
      kind: 'npc',
      templateId: 'merchant',
      facing: 1,
      prevFacing: 1,
    };

    expect(setRuntimeNpcFacing([keeper, merchant], 'npc:keeper', Math.PI / 2)).toBe(1);
    expect(keeper.facing).toBe(Math.PI / 2);
    expect(keeper.prevFacing).toBe(Math.PI / 2);
    expect(merchant.facing).toBe(1);
  });
});

describe('individual mob selection', () => {
  it('resolves a wandered mob to its exported one-mob camp by visible position', () => {
    const camps = [{ mobId: 'boar', center: { x: 30, z: 40 }, radius: 0.5, count: 1 }];
    const mob = {
      templateId: 'boar',
      pos: { x: 30.2, z: 39.9 },
      spawnPos: { x: 10, z: 10 },
    };

    expect(findRuntimeCampIndex(camps, mob)).toBe(0);
  });

  it('moves every selected mob by one shared drag delta', () => {
    const mob = (id: number) => ({
      id,
      kind: 'mob',
      templateId: 'boar',
      ownerId: null,
      pos: { x: id, y: 0, z: id },
      prevPos: { x: id, y: 0, z: id },
      spawnPos: { x: id, y: 0, z: id },
      leashAnchor: null,
      wanderTarget: null,
    });
    const mobs = [mob(1), mob(2), mob(3)];

    expect(moveRuntimeMobsById(mobs, new Set([1, 3]), 5, -2, () => 4)).toBe(2);
    expect(mobs[0].pos).toEqual({ x: 6, y: 4, z: -1 });
    expect(mobs[1].pos).toEqual({ x: 2, y: 0, z: 2 });
    expect(mobs[2].pos).toEqual({ x: 8, y: 4, z: 1 });
  });

  it('unpacks one generated camp into exportable one-mob camps', () => {
    const camp = {
      mobId: 'boar',
      center: { x: 10, z: 10 },
      radius: 12,
      count: 3,
    };
    expect(
      splitCampIntoIndividuals(camp, [
        { x: 7, z: 8 },
        { x: 11, z: 9 },
        { x: 14, z: 13 },
      ]),
    ).toEqual([
      { mobId: 'boar', center: { x: 7, z: 8 }, radius: 0.5, count: 1 },
      { mobId: 'boar', center: { x: 11, z: 9 }, radius: 0.5, count: 1 },
      { mobId: 'boar', center: { x: 14, z: 13 }, radius: 0.5, count: 1 },
    ]);
  });

  it('plain click selects one while Ctrl-click toggles a multi-selection', () => {
    expect(toggledMobSelection(new Set([1, 2]), 3, false)).toEqual(new Set([3]));
    expect(toggledMobSelection(new Set([1, 2]), 2, false)).toEqual(new Set([1, 2]));
    expect(toggledMobSelection(new Set([1, 2]), 3, true)).toEqual(new Set([1, 2, 3]));
    expect(toggledMobSelection(new Set([1, 2]), 2, true)).toEqual(new Set([1]));
  });
});
