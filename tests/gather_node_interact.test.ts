import { describe, expect, it } from 'vitest';
import { decideGatherNodeAction, handleGatherNodeInteract } from '../src/game/gather_node_interact';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { nodeMaterialFor } from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';
import { GATHER_CAST_ID, INTERACT_RANGE } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

describe('decideGatherNodeAction', () => {
  const nodePos = { x: 100, z: 200 };

  it('reports too_far past INTERACT_RANGE', () => {
    const playerPos = { x: 100, y: 0, z: 200 + INTERACT_RANGE + 2 };
    expect(decideGatherNodeAction(playerPos, nodePos, true)).toBe('too_far');
  });

  it("reports not_ready when in range but the caller's readiness read is false", () => {
    const playerPos = { x: 100, y: 0, z: 200 + 1 };
    expect(decideGatherNodeAction(playerPos, nodePos, false)).toBe('not_ready');
  });

  it('reports harvest when in range and ready', () => {
    const playerPos = { x: 100, y: 0, z: 200 + 1 };
    expect(decideGatherNodeAction(playerPos, nodePos, true)).toBe('harvest');
  });

  it('is inclusive right at the INTERACT_RANGE boundary', () => {
    const playerPos = { x: 100, y: 0, z: 200 + INTERACT_RANGE };
    expect(decideGatherNodeAction(playerPos, nodePos, true)).toBe('harvest');
  });

  // The tool-tier access gate, mirroring the sim's own harvestNode
  // deny order (range, then tool tier, then readiness).
  describe('tool_tier verdict', () => {
    const inRange = { x: 100, y: 0, z: 200 + 1 };
    const unmet = { nodeTier: 2, viewerToolTier: 1 };
    const met = { nodeTier: 2, viewerToolTier: 2 };

    it('an in-range locked node reports tool_tier even when it is also not ready', () => {
      // Readiness false AND tier unmet: the tool gate sits between range and
      // readiness, so the lock wins (a locked node reads locked, never
      // "not respawned").
      expect(decideGatherNodeAction(inRange, nodePos, false, unmet)).toBe('tool_tier');
      expect(decideGatherNodeAction(inRange, nodePos, true, unmet)).toBe('tool_tier');
    });

    it('too_far still wins over the tool gate out of range', () => {
      const far = { x: 100, y: 0, z: 200 + INTERACT_RANGE + 2 };
      expect(decideGatherNodeAction(far, nodePos, true, unmet)).toBe('too_far');
    });

    it('a met gate falls through to the readiness arms unchanged', () => {
      expect(decideGatherNodeAction(inRange, nodePos, false, met)).toBe('not_ready');
      expect(decideGatherNodeAction(inRange, nodePos, true, met)).toBe('harvest');
    });

    it('no toolGate keeps the legacy tier-agnostic decision', () => {
      expect(decideGatherNodeAction(inRange, nodePos, false)).toBe('not_ready');
      expect(decideGatherNodeAction(inRange, nodePos, true)).toBe('harvest');
    });
  });
});

describe('handleGatherNodeInteract', () => {
  const nodePos = { x: 0, z: 0 };
  const tooFarText = 'too far';
  const notReadyText = 'not ready';

  function fakeWorld(ready: boolean) {
    const calls: string[] = [];
    return {
      world: {
        nodeHarvestableByMe: (_nodeId: string) => ready,
        harvestNode: (nodeId: string) => {
          calls.push(nodeId);
          return true;
        },
      },
      calls,
    };
  }

  function fakeHud() {
    const errors: string[] = [];
    return { hud: { showError: (text: string) => errors.push(text) }, errors };
  }

  it('sends harvestNode and shows no error when in range and ready', () => {
    const { world, calls } = fakeWorld(true);
    const { hud, errors } = fakeHud();
    expect(
      handleGatherNodeInteract(
        world,
        hud,
        { x: 0, y: 0, z: 0 },
        'node_a',
        nodePos,
        tooFarText,
        notReadyText,
      ),
    ).toBe(true);
    expect(calls).toEqual(['node_a']);
    expect(errors).toEqual([]);
  });

  it('shows the too-far error and never calls harvestNode when out of range', () => {
    const { world, calls } = fakeWorld(true);
    const { hud, errors } = fakeHud();
    expect(
      handleGatherNodeInteract(
        world,
        hud,
        { x: 0, y: 0, z: INTERACT_RANGE + 5 },
        'node_a',
        nodePos,
        tooFarText,
        notReadyText,
      ),
    ).toBe(false);
    expect(calls).toEqual([]);
    expect(errors).toEqual([tooFarText]);
  });

  it('shows the not-ready error and never calls harvestNode when on cooldown', () => {
    const { world, calls } = fakeWorld(false);
    const { hud, errors } = fakeHud();
    expect(
      handleGatherNodeInteract(
        world,
        hud,
        { x: 0, y: 0, z: 0 },
        'node_a',
        nodePos,
        tooFarText,
        notReadyText,
      ),
    ).toBe(false);
    expect(calls).toEqual([]);
    expect(errors).toEqual([notReadyText]);
  });

  it('shows the pre-resolved unmet line and never sends harvestNode on a locked node', () => {
    // ready=false too: the lock must win over the not-ready feedback, exactly
    // like the sim's own deny order.
    const { world, calls } = fakeWorld(false);
    const { hud, errors } = fakeHud();
    expect(
      handleGatherNodeInteract(
        world,
        hud,
        { x: 0, y: 0, z: 0 },
        'node_a',
        nodePos,
        tooFarText,
        notReadyText,
        {
          nodeTier: 2,
          viewerToolTier: 1,
          unmetText: 'needs a tier 2 pick',
        },
      ),
    ).toBe(false);
    expect(calls).toEqual([]);
    // The caller-resolved localized line surfaces verbatim (tier + profession
    // were baked in by gatherNodeToolGateFor), and it wins over not-ready.
    expect(errors).toEqual(['needs a tier 2 pick']);
  });

  it('a met toolGate leaves the harvest path untouched', () => {
    const { world, calls } = fakeWorld(true);
    const { hud, errors } = fakeHud();
    expect(
      handleGatherNodeInteract(
        world,
        hud,
        { x: 0, y: 0, z: 0 },
        'node_a',
        nodePos,
        tooFarText,
        notReadyText,
        {
          nodeTier: 2,
          viewerToolTier: 3,
          unmetText: 'needs a tier 2 pick',
        },
      ),
    ).toBe(true);
    expect(calls).toEqual(['node_a']);
    expect(errors).toEqual([]);
  });

  it('returns the authoritative harvest result', async () => {
    const calls: string[] = [];
    const world = {
      nodeHarvestableByMe: () => true,
      harvestNode: async (nodeId: string) => {
        calls.push(nodeId);
        return false;
      },
    };
    const { hud, errors } = fakeHud();

    await expect(
      handleGatherNodeInteract(
        world,
        hud,
        { x: 0, y: 0, z: 0 },
        'node_a',
        nodePos,
        tooFarText,
        notReadyText,
      ),
    ).resolves.toBe(false);
    expect(calls).toEqual(['node_a']);
    expect(errors).toEqual([]);
  });
});

// The sim command behind the interact helper starts a gather CAST
// and still returns true (starting the cast IS the successful interaction for
// the #1982 autorun-stop contract the helper relies on). The pure decision
// helpers above are cast-agnostic by design; this arm pins the seam they sit
// on against the real Sim.
describe('the real harvestNode behind the helper (cast start)', () => {
  it('a successful interact starts the gather cast and returns true before any grant', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Interactor');
    const node = GATHER_NODES[0];
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing entity');
    p.pos.x = node.pos.x;
    p.pos.z = node.pos.z;
    p.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    expect(sim.harvestNode(node.id, pid)).toBe(true);
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    // Fresh player, bare hands, band 0, tier-1 node: the 2.5 s base literal.
    expect(p.castTotal).toBe(2.5);
    // The grant has NOT landed yet: it belongs to cast completion.
    expect(sim.countItem(nodeMaterialFor(node.type, node.zoneId).itemId, pid)).toBe(0);
  });
});
