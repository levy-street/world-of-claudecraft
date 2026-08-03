import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';

// ClientWorld.nodeHarvestableByMe (#1866): the online mirror of the offline
// Sim.nodeHarvestableByMeFor readiness check, sourced from the `ncd`
// self-wire delta (server/game.ts, see tests/snapshots.test.ts's full
// self-state fixture for the server-to-client round trip). This file covers
// the ClientWorld-only edges that fixture doesn't: the unset-before-any-
// snapshot default and a cooldown clearing on a later snapshot.
describe('ClientWorld.nodeHarvestableByMe', () => {
  // Kept bespoke on purpose (issue #2088): this suite needs the truly UNSET
  // prototype (no nodeCooldowns), unlike the shared tests/helpers/bare_client.ts
  // bareClient(), which always initializes it.
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

// The countdown read of the same mirror (the UX pass's respawn tooltip
// line): the map entry IS the remaining seconds, so the read is a lookup,
// and it answers null exactly where nodeHarvestableByMe answers true.
describe('ClientWorld.nodeRespawnSeconds', () => {
  function bareClient(): ClientWorld {
    return Object.create(ClientWorld.prototype);
  }

  it('answers null (no throw) before any snapshot has been applied', () => {
    expect(bareClient().nodeRespawnSeconds('any_node')).toBeNull();
  });

  it('answers the mirrored remaining seconds while cooling, null otherwise', () => {
    const client = bareClient();
    (client as any).nodeCooldowns = new Map([['node_a', 12.5]]);
    expect(client.nodeRespawnSeconds('node_a')).toBe(12.5);
    expect(client.nodeRespawnSeconds('node_b')).toBeNull();
    (client as any).nodeCooldowns = new Map();
    expect(client.nodeRespawnSeconds('node_a')).toBeNull();
  });

  it('agrees with nodeHarvestableByMe: null exactly when the node reads ready', () => {
    const client = bareClient();
    (client as any).nodeCooldowns = new Map([['node_a', 3]]);
    for (const nodeId of ['node_a', 'node_b']) {
      expect(client.nodeRespawnSeconds(nodeId) === null).toBe(client.nodeHarvestableByMe(nodeId));
    }
  });
});

// The R40 consent on the WIRE, sender side: confirmEffectUse true rides as
// confirmUse: true; omitted or false sends the byte-identical pre-flow
// frame (no key at all). The server half is pinned through the real router
// in tests/gather_node_harvest.test.ts.
describe('ClientWorld.harvestNode confirm flag (sender)', () => {
  it('sends confirmUse only when explicitly true', () => {
    const client = Object.create(ClientWorld.prototype) as ClientWorld;
    const sent: Record<string, unknown>[] = [];
    (
      client as unknown as { cmdWithOutcome(msg: Record<string, unknown>): Promise<boolean> }
    ).cmdWithOutcome = (msg) => {
      sent.push(msg);
      return Promise.resolve(true);
    };
    void client.harvestNode('node_a');
    void client.harvestNode('node_a', false);
    void client.harvestNode('node_a', true);
    expect(sent).toHaveLength(3);
    expect('confirmUse' in sent[0]).toBe(false);
    expect('confirmUse' in sent[1]).toBe(false);
    expect(sent[2].confirmUse).toBe(true);
    expect(sent[2]).toMatchObject({ cmd: 'harvest_node', node: 'node_a' });
  });
});
