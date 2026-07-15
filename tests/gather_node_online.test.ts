import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';

// ClientWorld.nodeHarvestableByMe (#1866): the online mirror of the offline
// Sim.nodeHarvestableByMeFor readiness check, sourced from the `ncd`
// self-wire delta (server/game.ts, see tests/snapshots.test.ts's full
// self-state fixture for the server-to-client round trip). This file covers
// the ClientWorld-only edges that fixture doesn't: the unset-before-any-
// snapshot default and a cooldown clearing on a later snapshot.
describe('ClientWorld.nodeHarvestableByMe', () => {
  function bareClient(): ClientWorld {
    return Object.create(ClientWorld.prototype);
  }

  it('reports ready (no throw) before any snapshot has been applied', () => {
    const client = bareClient();
    expect(client.nodeHarvestableByMe('any_node')).toBe(true);
  });

  it('reports not ready for a node present in the mirrored cooldown map', () => {
    const client = bareClient();
    (client as any).nodeCooldowns = new Map([['node_a', 12.5]]);
    expect(client.nodeHarvestableByMe('node_a')).toBe(false);
  });

  it('reports ready for a node absent from the mirrored cooldown map', () => {
    const client = bareClient();
    (client as any).nodeCooldowns = new Map([['node_a', 12.5]]);
    expect(client.nodeHarvestableByMe('node_b')).toBe(true);
  });

  it('reports ready again once a later snapshot drops the node from the map', () => {
    const client = bareClient();
    (client as any).nodeCooldowns = new Map([['node_a', 0.1]]);
    expect(client.nodeHarvestableByMe('node_a')).toBe(false);
    // the server omits an elapsed timer's key entirely (see server/game.ts
    // `ncd`'s filter), so the client's own reassignment on the next snapshot
    // reflects that node clearing, not decrementing to zero.
    (client as any).nodeCooldowns = new Map();
    expect(client.nodeHarvestableByMe('node_a')).toBe(true);
  });
});
