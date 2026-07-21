// Direct unit tests for src/sim/targeting.ts (T1). The Targeting class is exercised
// in ISOLATION against a fake SimContext (proving the module needs no Sim): the
// raid-marker store (set/toggle/symbol-uniqueness/clear/death-strip/disband) and the
// grid-backed target selectors (nearest enemy, friendly tab wrap). The slice draws no
// rng, so these assert behavior, not determinism (the parity gate pins that).

import { describe, expect, it, vi } from 'vitest';
import type { SimContext } from '../src/sim/sim_context';
import { SpatialGrid } from '../src/sim/spatial';
import { Targeting } from '../src/sim/targeting';
import type { Entity } from '../src/sim/types';

const SKULL = 0;
const STAR = 1;

// Minimal entity stub with only the fields the slice reads.
function ent(partial: Partial<Entity> & { id: number }): Entity {
  return {
    kind: 'mob',
    dead: false,
    hostile: true,
    ownerId: null,
    lootable: false,
    pos: { x: 0, y: 0, z: 0 },
    facing: 0,
    targetId: null,
    autoAttack: false,
    followTargetId: null,
    aggroTargetId: null,
    ...partial,
  } as unknown as Entity;
}

// A fake SimContext: real grid + entities, party membership keyed by pid, and the
// hostility/follow helpers as simple stubs. The actor is always resolvable by its id.
function makeCtx() {
  const entities = new Map<number, Entity>();
  const grid = new SpatialGrid();
  const parties = new Map<number, { id: number }>(); // pid -> party
  const error = vi.fn();
  const stopFollow = vi.fn();
  const ctx = {
    entities,
    grid,
    primaryId: -1,
    arenaMatches: new Map(),
    partyOf: (pid: number) => parties.get(pid) ?? null,
    resolve: (pid?: number) => {
      const e = entities.get(pid as number);
      return e ? { e, meta: { entityId: pid as number } } : null;
    },
    error,
    stopFollow,
    isHostileTo: (_a: Entity, b: Entity) => b.kind === 'mob' && b.hostile === true,
    isFriendlyTo: (a: Entity, b: Entity) => b.kind === 'player' && b.id !== a.id,
    pvpController: (e: Entity | null) => (e && e.kind === 'player' ? e : null),
    isArenaCrossTeam: () => false,
  } as unknown as SimContext;
  const joinParty = (partyId: number, ...pids: number[]) => {
    for (const pid of pids) parties.set(pid, { id: partyId });
  };
  const add = (e: Entity) => {
    entities.set(e.id, e);
    grid.insert(e);
    return e;
  };
  return { ctx, entities, grid, error, stopFollow, joinParty, add };
}

describe('Targeting: raid marker store', () => {
  it('markersFor is empty and setMarker errors when the actor is not in a party', () => {
    const t = makeCtx();
    t.add(ent({ id: 1, kind: 'player' }));
    t.add(ent({ id: 10, kind: 'mob', hostile: true }));
    const targeting = new Targeting(t.ctx);
    targeting.setMarker(10, SKULL, 1);
    expect(t.error).toHaveBeenCalledWith(1, 'You must be in a party to use raid markers.');
    expect(targeting.markersFor(1)).toEqual({});
  });

  it('sets a mark, toggles it off with the same symbol, and re-applies', () => {
    const t = makeCtx();
    t.add(ent({ id: 1, kind: 'player' }));
    t.add(ent({ id: 10 }));
    t.joinParty(7, 1);
    const targeting = new Targeting(t.ctx);
    targeting.setMarker(10, SKULL, 1);
    expect(targeting.markersFor(1)).toEqual({ 10: SKULL });
    targeting.setMarker(10, SKULL, 1); // same symbol, same mob -> off
    expect(targeting.markersFor(1)).toEqual({});
    targeting.setMarker(10, SKULL, 1);
    expect(targeting.markersFor(1)).toEqual({ 10: SKULL });
  });

  it('keeps a symbol unique within the party (it moves, not duplicates)', () => {
    const t = makeCtx();
    t.add(ent({ id: 1, kind: 'player' }));
    t.add(ent({ id: 10 }));
    t.add(ent({ id: 11 }));
    t.joinParty(7, 1);
    const targeting = new Targeting(t.ctx);
    targeting.setMarker(10, SKULL, 1);
    targeting.setMarker(11, SKULL, 1); // SKULL leaves 10, lands on 11
    expect(targeting.markersFor(1)).toEqual({ 11: SKULL });
  });

  it('rejects non-integer / out-of-range marker ids and unmarkable targets', () => {
    const t = makeCtx();
    t.add(ent({ id: 1, kind: 'player' }));
    t.add(ent({ id: 2, kind: 'player' })); // a player is not markable
    t.add(ent({ id: 10, dead: true })); // a dead mob is not markable
    t.add(ent({ id: 11, hostile: false })); // a friendly mob is not markable
    t.add(ent({ id: 12, ownerId: 1 })); // a pet (owned) is not markable
    t.add(ent({ id: 13, hostile: true })); // markable
    t.joinParty(7, 1);
    const targeting = new Targeting(t.ctx);
    targeting.setMarker(13, 8, 1); // out of range
    targeting.setMarker(13, -1, 1);
    targeting.setMarker(13, 1.5, 1);
    expect(targeting.markersFor(1)).toEqual({});
    for (const bad of [2, 10, 11, 12]) targeting.setMarker(bad, SKULL, 1);
    expect(targeting.markersFor(1)).toEqual({});
    targeting.setMarker(13, SKULL, 1);
    expect(targeting.markersFor(1)).toEqual({ 13: SKULL });
  });

  it('clearMarker removes one mark; clearEntityMarker strips a dead entity across every party', () => {
    const t = makeCtx();
    t.add(ent({ id: 1, kind: 'player' }));
    t.add(ent({ id: 2, kind: 'player' }));
    t.add(ent({ id: 10 }));
    t.joinParty(7, 1); // party 7
    t.joinParty(8, 2); // party 8
    const targeting = new Targeting(t.ctx);
    targeting.setMarker(10, SKULL, 1);
    targeting.setMarker(10, STAR, 2); // same mob marked by two different parties
    targeting.clearMarker(10, 1);
    expect(targeting.markersFor(1)).toEqual({});
    expect(targeting.markersFor(2)).toEqual({ 10: STAR });
    // the mob dies/despawns -> its mark is gone everywhere.
    targeting.clearEntityMarker(10);
    expect(targeting.markersFor(2)).toEqual({});
  });

  it('dropPartyMarkers drops a disbanded party whole, leaving other parties intact', () => {
    const t = makeCtx();
    t.add(ent({ id: 1, kind: 'player' }));
    t.add(ent({ id: 2, kind: 'player' }));
    t.add(ent({ id: 10 }));
    t.add(ent({ id: 11 }));
    t.joinParty(7, 1);
    t.joinParty(8, 2);
    const targeting = new Targeting(t.ctx);
    targeting.setMarker(10, SKULL, 1);
    targeting.setMarker(11, STAR, 2);
    targeting.dropPartyMarkers(7);
    expect(targeting.markersFor(1)).toEqual({});
    expect(targeting.markersFor(2)).toEqual({ 11: STAR });
  });
});

describe('Targeting: target selection', () => {
  it('targetNearestEnemy picks the closest hostile mob in range', () => {
    const t = makeCtx();
    const actor = t.add(ent({ id: 1, kind: 'player', pos: { x: 0, y: 0, z: 0 } }));
    t.add(ent({ id: 10, hostile: true, pos: { x: 5, y: 0, z: 0 } }));
    t.add(ent({ id: 11, hostile: true, pos: { x: 3, y: 0, z: 0 } }));
    const targeting = new Targeting(t.ctx);
    targeting.targetNearestEnemy(1);
    expect(actor.targetId).toBe(11); // the nearer mob
  });

  it('friendlyTabTarget cycles party-mates by distance and wraps', () => {
    const t = makeCtx();
    const actor = t.add(ent({ id: 1, kind: 'player', pos: { x: 0, y: 0, z: 0 } }));
    t.add(ent({ id: 2, kind: 'player', pos: { x: 2, y: 0, z: 0 } })); // nearest
    t.add(ent({ id: 3, kind: 'player', pos: { x: 6, y: 0, z: 0 } })); // farther
    const targeting = new Targeting(t.ctx);
    targeting.friendlyTabTarget(1); // no current target -> first (nearest)
    expect(actor.targetId).toBe(2);
    targeting.friendlyTabTarget(1); // step to the next-nearest
    expect(actor.targetId).toBe(3);
    targeting.friendlyTabTarget(1); // wrap back to the nearest
    expect(actor.targetId).toBe(2);
  });

  it('targetEntity ends a follow and clears auto-attack on a non-hostile pick', () => {
    const t = makeCtx();
    const actor = t.add(ent({ id: 1, kind: 'player', followTargetId: 99, autoAttack: true }));
    const ally = t.add(ent({ id: 2, kind: 'player' }));
    const targeting = new Targeting(t.ctx);
    targeting.targetEntity(2, 1);
    expect(t.stopFollow).toHaveBeenCalledWith(actor, 'You stop following.');
    expect(actor.targetId).toBe(2);
    expect(actor.autoAttack).toBe(false); // ally is not hostile -> auto-attack off
  });
});
