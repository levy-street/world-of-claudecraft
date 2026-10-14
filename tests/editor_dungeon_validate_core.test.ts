import { describe, expect, it } from 'vitest';
import { type DungeonDraft, draftFromLayout } from '../src/editor/dungeon/dungeon_draft_core';
import { validateDraft } from '../src/editor/dungeon/dungeon_validate_core';
import { AUTHORED_DUNGEON_FIXTURE } from './fixtures/authored_dungeon_layout';

// Draft validation: room sanity errors, door-graph reachability, floating
// doors, decor blocking a doorway, and an authored room-graph layout fixture
// as the zero-error baseline.

function baseDraft(partial: Partial<DungeonDraft>): DungeonDraft {
  return {
    rooms: [
      { id: 'entry', x0: -10, x1: 10, z0: 0, z1: 20 },
      { id: 'hall', x0: -10, x1: 10, z0: 20, z1: 40 },
    ],
    doors: [{ x: 0, z: 20, hw: 3.6, hd: 1 }],
    barriers: [],
    visualOpenings: [],
    decor: [],
    dais: { x: 0, z: 30, r: 4 },
    ...partial,
  };
}

function errors(draft: DungeonDraft): string[] {
  return validateDraft(draft)
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message);
}

function warnings(draft: DungeonDraft): string[] {
  return validateDraft(draft)
    .filter((issue) => issue.severity === 'warning')
    .map((issue) => issue.message);
}

describe('editor dungeon validate core', () => {
  it('flags inverted bounds, empty ids, and duplicate ids as errors', () => {
    const draft = baseDraft({
      rooms: [
        { id: 'entry', x0: -10, x1: 10, z0: 0, z1: 20 },
        { id: 'entry', x0: 10, x1: -10, z0: 20, z1: 40 },
        { id: '', x0: 0, x1: 8, z0: 40, z1: 30 },
      ],
      doors: [],
    });
    const found = errors(draft);
    expect(found.some((m) => m.includes("'entry'") && m.includes('inverted'))).toBe(true);
    expect(found.some((m) => m.includes("Duplicate room id 'entry'"))).toBe(true);
    expect(found.some((m) => m.includes('Room #2 has an empty id'))).toBe(true);
  });

  it('reports rooms unreachable from the entrance through the door graph', () => {
    const draft = baseDraft({
      rooms: [
        { id: 'entry', x0: -10, x1: 10, z0: 0, z1: 20 },
        { id: 'isolated', x0: 30, x1: 50, z0: 0, z1: 20 },
      ],
      doors: [],
      dais: { x: 0, z: 10, r: 4 },
    });
    const found = errors(draft);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("Room 'isolated' (#1) is unreachable from room 'entry'");
  });

  it('connects rooms through a shared-wall door and accepts an exterior entrance door', () => {
    const draft = baseDraft({
      doors: [
        { x: 0, z: 20, hw: 3.6, hd: 1 }, // entry <-> hall shared wall
        { x: 0, z: 0, hw: 3.6, hd: 1 }, // exterior entrance: opens entry only
      ],
    });
    expect(errors(draft)).toEqual([]);
    expect(warnings(draft)).toEqual([]);
  });

  it('warns about a door that touches no room wall', () => {
    const draft = baseDraft({
      doors: [
        { x: 0, z: 20, hw: 3.6, hd: 1 },
        { x: 100, z: 100, hw: 3.6, hd: 1 },
      ],
    });
    expect(errors(draft)).toEqual([]);
    expect(warnings(draft)).toEqual(['Door #1 does not touch any room wall']);
  });

  it('warns when colliding decor overlaps a door opening', () => {
    const draft = baseDraft({
      decor: [
        { key: 'lava_brazier', x: 1, z: 20, yaw: 0, r: 0.9 },
        { key: 'floor_plate', x: 0, z: 19, yaw: 0 }, // no collision: fine
      ],
    });
    const found = warnings(draft);
    expect(found).toEqual(["Decor #0 ('lava_brazier') collision overlaps door #0 opening"]);
  });

  it('warns when decor or the dais sit outside every room', () => {
    const draft = baseDraft({
      decor: [{ key: 'lava_brazier', x: 60, z: 60, yaw: 0, r: 0.9 }],
      dais: { x: 60, z: -30, r: 4 },
    });
    const found = warnings(draft);
    expect(found).toContain("Decor #0 ('lava_brazier') center is outside every room");
    expect(found).toContain('Dais is outside every room');
  });

  it('accepts an authored room-graph layout with zero errors', () => {
    const draft = draftFromLayout(AUTHORED_DUNGEON_FIXTURE);
    expect(errors(draft)).toEqual([]);
  });
});
