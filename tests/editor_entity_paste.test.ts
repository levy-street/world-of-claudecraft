// Studio's Ctrl+V for copied mobs and NPCs (src/editor/entity_paste.ts).
// Pinned here:
//  - a paste lands the copied group centred on the cursor (keeping its
//    layout), or two yards off the originals when no cursor is over the map;
//  - it updates the editor in place through the host's camp and NPC hooks
//    (the host has no full-world reload to call, so a paste can never
//    rebuild the whole 3D world again, which on a world-size map looked like
//    the editor reloading);
//  - undo and redo remove and restore exactly the pasted entries;
//  - the map's caps still hold, and pasted NPCs get fresh unique ids.
import { describe, expect, it } from 'vitest';
import { type EntityPasteHost, pasteMobs, pasteNpcs } from '../src/editor/entity_paste';
import { copyCampSelection, copyNpcSelection } from '../src/editor/selection_clipboard';
import type { CampDef, NpcDef } from '../src/sim/types';

const camp = (mobId: string, x: number, z: number): CampDef =>
  ({ mobId, count: 3, radius: 6, center: { x, z } }) as CampDef;
const npc = (id: string, x: number, z: number): NpcDef =>
  ({ id, name: id, pos: { x, z }, facing: 0, color: 0, questIds: [] }) as unknown as NpcDef;

function host(camps: CampDef[], npcs: Record<string, NpcDef>) {
  const calls = { campsChanged: 0, added: [] as string[], removed: [] as string[] };
  const h: EntityPasteHost = {
    camps: () => camps,
    npcs: () => npcs,
    campsChanged: () => {
      calls.campsChanged++;
    },
    npcAdded: (def) => {
      calls.added.push(def.id);
    },
    npcRemoved: (id) => {
      calls.removed.push(id);
    },
  };
  return { h, calls };
}

describe('pasting copied mobs', () => {
  it('centres the group on the cursor, keeping its layout, in place', () => {
    const camps = [camp('wolf', 10, 10), camp('boar', 20, 14)];
    const { h, calls } = host(camps, {});
    const copied = copyCampSelection(camps);
    const done = pasteMobs(h, copied, { x: 100, z: -50 }, 100);
    if (!done) throw new Error('nothing pasted');
    expect(done.count).toBe(2);
    expect(done.capped).toBe(false);
    // Centroid (15, 12) moves to (100, -50): offset (85, -62).
    expect(camps.slice(2).map((c) => c.center)).toEqual([
      { x: 95, z: -52 },
      { x: 105, z: -48 },
    ]);
    expect(calls.campsChanged).toBe(1);
    // The copies are new objects, not the originals moved.
    expect(camps[0].center).toEqual({ x: 10, z: 10 });
  });

  it('falls back to two yards off the originals with no cursor', () => {
    const camps = [camp('wolf', 10, 10)];
    const { h } = host(camps, {});
    pasteMobs(h, copyCampSelection(camps), null, 100);
    expect(camps[1].center).toEqual({ x: 12, z: 12 });
  });

  it('undo removes exactly the pasted camps and redo restores them', () => {
    const camps = [camp('wolf', 10, 10), camp('boar', 20, 14)];
    const { h, calls } = host(camps, {});
    const done = pasteMobs(h, copyCampSelection(camps.slice(0, 1)), { x: 0, z: 0 }, 100);
    if (!done) throw new Error('nothing pasted');
    expect(camps).toHaveLength(3);
    done.undo();
    expect(camps.map((c) => c.mobId)).toEqual(['wolf', 'boar']);
    done.redo();
    expect(camps.map((c) => c.center)).toEqual([
      { x: 10, z: 10 },
      { x: 20, z: 14 },
      { x: 0, z: 0 },
    ]);
    expect(calls.campsChanged).toBe(3);
  });

  it('keeps the camp cap and reports when it trimmed the paste', () => {
    const camps = [camp('wolf', 0, 0), camp('boar', 5, 5)];
    const { h } = host(camps, {});
    const done = pasteMobs(h, copyCampSelection(camps), { x: 50, z: 50 }, 3);
    expect(done?.count).toBe(1);
    expect(done?.capped).toBe(true);
    expect(camps).toHaveLength(3);
    const none = pasteMobs(h, copyCampSelection(camps), { x: 50, z: 50 }, 3);
    expect(none).toBeNull();
    expect(camps).toHaveLength(3);
  });
});

describe('pasting copied NPCs', () => {
  it('adds each NPC to the live view under a fresh id, at the cursor', () => {
    const npcs: Record<string, NpcDef> = { smith: npc('smith', 4, 6) };
    const { h, calls } = host([], npcs);
    const copied = copyNpcSelection(npcs, new Set(['npc:smith']));
    const done = pasteNpcs(h, copied, { x: -20, z: 30 }, 200);
    if (!done) throw new Error('nothing pasted');
    expect(done.keys).toEqual(['smith_copy']);
    expect(npcs.smith_copy.pos).toEqual({ x: -20, z: 30 });
    expect(npcs.smith.pos).toEqual({ x: 4, z: 6 });
    expect(calls.added).toEqual(['smith_copy']);
    done.undo();
    expect(npcs.smith_copy).toBeUndefined();
    expect(calls.removed).toEqual(['smith_copy']);
    done.redo();
    expect(npcs.smith_copy.pos).toEqual({ x: -20, z: 30 });
    expect(calls.added).toEqual(['smith_copy', 'smith_copy']);
  });

  it('keeps the NPC cap', () => {
    const npcs: Record<string, NpcDef> = { a: npc('a', 0, 0), b: npc('b', 1, 1) };
    const { h } = host([], npcs);
    const done = pasteNpcs(h, copyNpcSelection(npcs, new Set(['npc:a', 'npc:b'])), null, 3);
    expect(done?.keys).toEqual(['a_copy']);
    expect(done?.capped).toBe(true);
  });
});
