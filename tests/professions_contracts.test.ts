// #1164: professions contracts + IWorld facet. Asserts the facet exists on
// both worlds and (as of #1119) returns the real gathering-profession skills
// on a fresh Sim (all-zero, but present, not the pre-#1119 empty stub); the
// stub-empty shape survives only on ClientWorld before a snapshot lands, and
// the shared types are importable from the barrel without duplication.
import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import type { ProfessionRecord } from '../src/sim/professions';
import { emptyCraftSkills } from '../src/sim/professions/wheel';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

const SIM_SEED = 1;
const PROBE_CLASS: PlayerClass = 'warrior';

// A DOM-less, network-free WebSocket stand-in for the ClientWorld ctor (see
// tests/world_api_parity.test.ts for the full-featured version this mirrors).
class StubWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  constructor(public readonly url: string) {}
  send(): void {
    /* no-op: this gate never sends */
  }
  close(): void {
    /* no-op: there is no real socket */
  }
}

function withDomStubs<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const prevWebSocket = g.WebSocket;
  const prevWindow = g.window;
  g.WebSocket = StubWebSocket as unknown;
  g.window = { setInterval: () => 0, clearInterval: () => undefined };
  try {
    return fn();
  } finally {
    g.WebSocket = prevWebSocket;
    g.window = prevWindow;
  }
}

function makeClientWorld(): ClientWorld {
  return withDomStubs(() => {
    const world = new ClientWorld('professions-probe-token', 1, PROBE_CLASS, 'http://localhost');
    world.close();
    return world;
  });
}

describe('professions contracts (#1164)', () => {
  it('IWorldProfessions.professionsState carries the four all-zero gathering skills on a fresh Sim', () => {
    const sim = new Sim({ seed: SIM_SEED, playerClass: PROBE_CLASS });
    // Pins the enforced per-profession caps
    // (mining/logging/herbalism 100, fishing 200) replace the old uniform 300.
    expect(sim.professionsState).toEqual({
      skills: [
        { professionId: 'mining', skill: 0, maxSkill: 100 },
        { professionId: 'logging', skill: 0, maxSkill: 100 },
        { professionId: 'herbalism', skill: 0, maxSkill: 100 },
        { professionId: 'fishing', skill: 0, maxSkill: 200 },
      ],
    });
  });

  it('IWorldProfessions.professionsState is a stub empty view on ClientWorld (not yet mirrored from a snapshot)', () => {
    const client = makeClientWorld();
    expect(client.professionsState).toEqual({ skills: [] });
  });

  it('a fresh pre-sync ClientWorld exposes empty-but-well-formed craft skills', () => {
    // The real field initializers, not the bareClient Object.create idiom
    // (which skips them): before any cprof snapshot the identity is unsynced
    // and every CRAFT_RING craft reads exactly 0, so pre-sync consumers can
    // index the record without existence checks on either read path.
    // emptyCraftSkills mints a fresh object per call, so these expectations
    // are never the aliased live reference.
    const client = makeClientWorld();
    expect(client.craftingIdentity.synced).toBe(false);
    expect(client.craftSkills).toEqual(emptyCraftSkills());
    expect(Object.values(client.craftSkills).every((v) => v === 0)).toBe(true);
    expect(client.craftingIdentity.craftSkills).toEqual(emptyCraftSkills());
    // The derived scalars read the same pre-sync mirror: null until cprof
    // lands (the retired member-by-member projections behaved identically).
    expect(client.hobbyCraft).toBeNull();
    expect(client.archetypeTitle).toBeNull();
  });

  it('shared professions types are importable from the barrel', () => {
    const record: ProfessionRecord = { id: 'mining', category: 'gathering', maxSkill: 300 };
    expect(record.id).toBe('mining');
  });
});
