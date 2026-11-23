import { describe, expect, it } from 'vitest';
import {
  addEntity,
  cloneDraft,
  type DungeonDraft,
  draftFromLayout,
  draftToLayout,
  entityBounds,
  moveEntity,
  pickEntity,
  pickEntityCycle,
  removeEntity,
  resizeRoomEdge,
  snapCoord,
  updateEntityFields,
} from '../src/editor/dungeon/dungeon_draft_core';
import { AUTHORED_DUNGEON_FIXTURE } from './fixtures/authored_dungeon_layout';

// Pure dungeon-editing model: draft round-trip against an authored room-graph
// layout fixture, deep-clone isolation, hit testing, and mutations.

function smallDraft(): DungeonDraft {
  return {
    rooms: [
      { id: 'entry', x0: 0, x1: 20, z0: 0, z1: 20 },
      { id: 'hall', x0: 4, x1: 12, z0: 4, z1: 12 },
    ],
    doors: [{ x: 10, z: 20, hw: 3.6, hd: 1 }],
    barriers: [{ x: 2, z: 10, hw: 1, hd: 4, style: 'maze' }],
    visualOpenings: [],
    decor: [
      { key: 'lava_brazier', x: 8, z: 8, yaw: 0, r: 0.9 },
      { key: 'volcanic_spire_cluster', x: 8, z: 8, yaw: 0.4, r: 1.8 },
    ],
    dais: { x: 10, z: 16, r: 3 },
  };
}

describe('editor dungeon draft core', () => {
  it('round-trips an authored layout and recomputes the derived shell', () => {
    const draft = draftFromLayout(AUTHORED_DUNGEON_FIXTURE);
    const out = draftToLayout(AUTHORED_DUNGEON_FIXTURE, draft);
    expect(out.zMin).toBe(-25);
    expect(out.zMax).toBe(232);
    expect(out.wallX).toBe(82);
    expect(out.endWallHw).toBe(82);
    expect(out.floorHalfX).toBe(82);
    expect(out.sideWallZ).toBe(103.5);
    expect(out.sideWallHd).toBe(128.5);
    expect(out.rooms).toEqual(AUTHORED_DUNGEON_FIXTURE.rooms);
    expect(out.doors).toEqual(AUTHORED_DUNGEON_FIXTURE.doors);
    expect(out.barriers).toEqual(AUTHORED_DUNGEON_FIXTURE.barriers);
    expect(out.visualOpenings).toEqual(AUTHORED_DUNGEON_FIXTURE.visualOpenings);
    expect(out.decor).toEqual(AUTHORED_DUNGEON_FIXTURE.decor);
    expect(out.dais).toEqual(AUTHORED_DUNGEON_FIXTURE.dais);
  });

  it('fills missing authored lists with empty arrays', () => {
    const draft = draftFromLayout({
      zMin: 0,
      zMax: 10,
      sideWallZ: 5,
      sideWallHd: 5,
      pillars: [],
      tombs: [],
      stubs: [],
      dais: { x: 0, z: 5, r: 2 },
    });
    expect(draft.rooms).toEqual([]);
    expect(draft.doors).toEqual([]);
    expect(draft.barriers).toEqual([]);
    expect(draft.visualOpenings).toEqual([]);
    expect(draft.decor).toEqual([]);
  });

  it('deep-clones so mutations never alias the source layout or snapshot', () => {
    const draft = draftFromLayout(AUTHORED_DUNGEON_FIXTURE);
    const snapshot = cloneDraft(draft);
    moveEntity(draft, { kind: 'room', index: 0 }, 2, 3);
    moveEntity(draft, { kind: 'decor', index: 0 }, 1, 0);
    moveEntity(draft, { kind: 'dais', index: 0 }, 5, 0);
    expect(AUTHORED_DUNGEON_FIXTURE.rooms?.[0]).toEqual({
      id: 'ashen_descent_entrance',
      x0: -18,
      x1: 18,
      z0: -25,
      z1: 5,
    });
    expect(AUTHORED_DUNGEON_FIXTURE.decor?.[0].x).toBe(-12);
    expect(AUTHORED_DUNGEON_FIXTURE.dais).toEqual({ x: 0, z: 222, r: 18 });
    expect(snapshot.rooms[0]).toEqual({
      id: 'ashen_descent_entrance',
      x0: -18,
      x1: 18,
      z0: -25,
      z1: 5,
    });
    expect(draft.rooms[0]).toEqual({
      id: 'ashen_descent_entrance',
      x0: -16,
      x1: 20,
      z0: -22,
      z1: 8,
    });
    expect(draft.decor[0].x).toBe(-11);
    expect(draft.dais).toEqual({ x: 5, z: 222, r: 18 });
  });

  it('snaps coordinates to the half-unit grid by default', () => {
    expect(snapCoord(3.26)).toBe(3.5);
    expect(snapCoord(-1.1)).toBe(-1);
    expect(snapCoord(7, 2)).toBe(8);
  });

  it('computes decor bounds from the largest footprint extent', () => {
    const draft = smallDraft();
    expect(entityBounds(draft, { kind: 'decor', index: 1 })).toEqual({
      x0: 6.2,
      x1: 9.8,
      z0: 6.2,
      z1: 9.8,
    });
    expect(entityBounds(draft, { kind: 'door', index: 0 })).toEqual({
      x0: 6.4,
      x1: 13.6,
      z0: 19,
      z1: 21,
    });
    expect(entityBounds(draft, { kind: 'dais', index: 0 })).toEqual({
      x0: 7,
      x1: 13,
      z0: 13,
      z1: 19,
    });
  });

  it('pickEntity prioritizes decor over the containing room', () => {
    const draft = smallDraft();
    expect(pickEntity(draft, 8, 8)).toEqual({ kind: 'decor', index: 0 });
  });

  it('pickEntity picks the smallest containing room when several overlap', () => {
    const draft = smallDraft();
    expect(pickEntity(draft, 5, 11)).toEqual({ kind: 'room', index: 1 });
  });

  it('pickEntityCycle cycles through stacked candidates and wraps', () => {
    const draft = smallDraft();
    const first = pickEntityCycle(draft, 8, 8, null);
    expect(first).toEqual({ kind: 'decor', index: 0 });
    const second = pickEntityCycle(draft, 8, 8, first);
    expect(second).toEqual({ kind: 'decor', index: 1 });
    const third = pickEntityCycle(draft, 8, 8, second);
    expect(third).toEqual({ kind: 'room', index: 1 });
    const fourth = pickEntityCycle(draft, 8, 8, third);
    expect(fourth).toEqual({ kind: 'room', index: 0 });
    expect(pickEntityCycle(draft, 8, 8, fourth)).toEqual({ kind: 'decor', index: 0 });
    // A stale previous ref not under the point restarts at the top candidate.
    expect(pickEntityCycle(draft, 8, 8, { kind: 'door', index: 0 })).toEqual({
      kind: 'decor',
      index: 0,
    });
    expect(pickEntityCycle(draft, -50, -50, null)).toBeNull();
  });

  it('resizeRoomEdge clamps to a minimum 4-unit span and never inverts', () => {
    const draft = smallDraft();
    resizeRoomEdge(draft, 0, 'x1', 2);
    expect(draft.rooms[0].x1).toBe(4);
    resizeRoomEdge(draft, 0, 'x0', 3);
    expect(draft.rooms[0].x0).toBe(0);
    resizeRoomEdge(draft, 0, 'z0', 30);
    expect(draft.rooms[0].z0).toBe(16);
    resizeRoomEdge(draft, 0, 'z1', 40);
    expect(draft.rooms[0].z1).toBe(40);
  });

  it('updateEntityFields clamps sizes, deletes optional decor fields, ignores unknown keys', () => {
    const draft = smallDraft();
    updateEntityFields(draft, { kind: 'door', index: 0 }, { hw: -5, x: 11, bogus: 9 });
    expect(draft.doors[0].hw).toBe(0.1);
    expect(draft.doors[0].x).toBe(11);
    expect('bogus' in draft.doors[0]).toBe(false);
    updateEntityFields(draft, { kind: 'decor', index: 0 }, { r: undefined, yaw: 1.2 });
    expect('r' in draft.decor[0]).toBe(false);
    expect(draft.decor[0].yaw).toBe(1.2);
    updateEntityFields(draft, { kind: 'room', index: 0 }, { x1: 2, id: 'renamed' });
    expect(draft.rooms[0].x1).toBe(4);
    expect(draft.rooms[0].id).toBe('renamed');
    updateEntityFields(draft, { kind: 'barrier', index: 0 }, { style: 'pit' });
    expect(draft.barriers[0].style).toBe('pit');
    updateEntityFields(draft, { kind: 'barrier', index: 0 }, { style: undefined });
    expect('style' in draft.barriers[0]).toBe(false);
    updateEntityFields(draft, { kind: 'dais', index: 0 }, { r: -2 });
    expect(draft.dais.r).toBe(0.1);
  });

  it('addEntity applies defaults, snaps coordinates, and mints unique room ids', () => {
    const draft = smallDraft();
    draft.rooms.push({ id: 'room_1', x0: 30, x1: 40, z0: 0, z1: 10 });
    const roomRef = addEntity(draft, 'room', { x: 3.26, z: 1.1 });
    expect(roomRef).toEqual({ kind: 'room', index: 3 });
    expect(draft.rooms[3]).toEqual({ id: 'room_2', x0: -4.5, x1: 11.5, z0: -7, z1: 9 });
    const again = addEntity(draft, 'room', { x: 0, z: 0 });
    expect(draft.rooms[again.index].id).toBe('room_3');
    const doorRef = addEntity(draft, 'door', { x: 1.2, z: 2 });
    expect(draft.doors[doorRef.index]).toEqual({ x: 1, z: 2, hw: 3.6, hd: 1 });
    const barrierRef = addEntity(draft, 'barrier', { x: 0, z: 0 });
    expect(draft.barriers[barrierRef.index]).toEqual({ x: 0, z: 0, hw: 6, hd: 1, style: 'maze' });
    const openingRef = addEntity(draft, 'opening', { x: 0, z: 0 });
    expect(draft.visualOpenings[openingRef.index]).toEqual({ x: 0, z: 0, hw: 1, hd: 6 });
    const decorRef = addEntity(draft, 'decor', { x: 5, z: 5 });
    expect(draft.decor[decorRef.index]).toEqual({
      key: 'lava_brazier',
      x: 5,
      z: 5,
      yaw: 0,
      r: 0.9,
    });
  });

  it('removeEntity deletes list entities but never the dais', () => {
    const draft = smallDraft();
    removeEntity(draft, { kind: 'decor', index: 0 });
    expect(draft.decor).toHaveLength(1);
    expect(draft.decor[0].key).toBe('volcanic_spire_cluster');
    removeEntity(draft, { kind: 'dais', index: 0 });
    expect(draft.dais).toEqual({ x: 10, z: 16, r: 3 });
  });
});
