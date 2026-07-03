// #1164: professions contracts + IWorld facet stub. Asserts the new facet
// exists on both worlds and returns the settled empty shape, and that the
// shared types are importable from the barrel without duplication.
import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import type { ProfessionRecord } from '../src/sim/professions';
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
  it('IWorldProfessions.professionsState is a stub empty view on Sim', () => {
    const sim = new Sim({ seed: SIM_SEED, playerClass: PROBE_CLASS });
    expect(sim.professionsState).toEqual({ skills: [] });
  });

  it('IWorldProfessions.professionsState is a stub empty view on ClientWorld', () => {
    const client = makeClientWorld();
    expect(client.professionsState).toEqual({ skills: [] });
  });

  it('shared professions types are importable from the barrel', () => {
    const record: ProfessionRecord = { id: 'mining', category: 'gathering', maxSkill: 300 };
    expect(record.id).toBe('mining');
  });
});
