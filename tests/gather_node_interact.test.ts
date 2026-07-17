import { describe, expect, it } from 'vitest';
import { decideGatherNodeAction, handleGatherNodeInteract } from '../src/game/gather_node_interact';
import { INTERACT_RANGE } from '../src/sim/types';

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
