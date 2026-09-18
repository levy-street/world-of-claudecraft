// PartyPidsCache (party_pids_core.ts): the meters' party set, rebuilt only
// when the viewer, the member list, or the entity roster changed, and always
// equal to the plain computation.
import { describe, expect, it, vi } from 'vitest';
import { collectPartyPids, PartyPidsCache, type PartyPidsWorld } from '../src/ui/party_pids_core';

type Row = { id: number; kind: string; ownerId: number | null };

function world(
  members: number[] = [],
  pets: [number, number][] = [],
): PartyPidsWorld & {
  entities: Map<number, Row>;
} {
  const entities = new Map<number, Row>();
  entities.set(1, { id: 1, kind: 'player', ownerId: null });
  for (const pid of members) entities.set(pid, { id: pid, kind: 'player', ownerId: null });
  entities.set(50, { id: 50, kind: 'mob', ownerId: null });
  entities.set(51, { id: 51, kind: 'mob', ownerId: 99 });
  for (const [id, owner] of pets) entities.set(id, { id, kind: 'mob', ownerId: owner });
  return {
    player: { id: 1 },
    partyInfo: members.length ? { members: members.map((pid) => ({ pid })) } : null,
    entities,
    entityRosterVersion: 1,
  };
}

describe('collectPartyPids', () => {
  it('is the viewer, the members, and the pets any of them own', () => {
    expect([...collectPartyPids(world())]).toEqual([1]);
    expect([
      ...collectPartyPids(
        world(
          [2, 3],
          [
            [60, 2],
            [61, 99],
          ],
        ),
      ),
    ]).toEqual([1, 2, 3, 60]);
  });
});

describe('PartyPidsCache', () => {
  it('answers the plain computation and keeps the same set while nothing changed', () => {
    const w = world([2], [[60, 2]]);
    const plain = [...collectPartyPids(w)];
    const cache = new PartyPidsCache();
    const values = vi.spyOn(w.entities, 'values');
    const first = cache.get(w);
    expect([...first]).toEqual(plain);
    for (let frame = 0; frame < 30; frame++) expect(cache.get(w)).toBe(first);
    expect(values).toHaveBeenCalledTimes(1);
  });

  it('rebuilds on a roster change, so a fresh pet counts on the very next read', () => {
    const w = world([2]);
    const cache = new PartyPidsCache();
    const before = cache.get(w);
    expect(before.has(60)).toBe(false);
    w.entities.set(60, { id: 60, kind: 'mob', ownerId: 2 });
    w.entityRosterVersion = 2;
    const after = cache.get(w);
    expect(after).not.toBe(before);
    expect([...after]).toEqual([...collectPartyPids(w)]);
    expect(after.has(60)).toBe(true);
  });

  it('rebuilds when the member list or the viewer changes, even with the roster unchanged', () => {
    const w = world([2]);
    const cache = new PartyPidsCache();
    const solo = cache.get(w);
    w.partyInfo = { members: [{ pid: 2 }, { pid: 3 }] };
    const joined = cache.get(w);
    expect(joined).not.toBe(solo);
    expect([...joined]).toEqual([1, 2, 3]);
    // A fresh member array with the same pids is not a change.
    w.partyInfo = { members: [{ pid: 2 }, { pid: 3 }] };
    expect(cache.get(w)).toBe(joined);
    w.partyInfo = null;
    expect([...cache.get(w)]).toEqual([1]);
    w.player = { id: 3 };
    expect([...cache.get(w)]).toEqual([3]);
  });

  it('rebuilds on a same-length swap (one raider replaced by another between two reads)', () => {
    const w = world([2, 3]);
    const cache = new PartyPidsCache();
    const before = cache.get(w);
    expect([...before]).toEqual([1, 2, 3]);
    w.partyInfo = { members: [{ pid: 2 }, { pid: 4 }] };
    const after = cache.get(w);
    expect(after).not.toBe(before);
    expect([...after]).toEqual([1, 2, 4]);
    expect(after.has(3)).toBe(false);
  });
});
