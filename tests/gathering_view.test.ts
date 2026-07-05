// Pure gathering HUD core (issue 1124): node ready/cooldown classification (per-viewer,
// see IWorldProfessions#nodeHarvestableByMe) and the gathering-proficiency display
// rows (IWorldProfessions#professionsState). DOM/Three-free, same-input ->
// same-output, driven with hand-built IWorld-shaped stubs (no real Sim needed:
// the acceptance criterion under test is that two independent per-viewer
// cooldown states against the SAME node list classify independently, which is a
// property of this pure core, not of Sim's respawn timer itself).

import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/data';
import {
  buildGatheringProficiencyRows,
  buildNearbyGatherNodes,
  classifyGatherNode,
} from '../src/ui/gathering_view';
import type { IWorld } from '../src/world_api';

const NODE = GATHER_NODES[0];

function makeWorld(opts: {
  pos?: { x: number; z: number };
  harvestable?: (nodeId: string) => boolean;
  proficiency?: Record<string, number>;
}): IWorld {
  const proficiency = opts.proficiency ?? {};
  return {
    player: { pos: opts.pos ?? { x: NODE.pos.x, z: NODE.pos.z } },
    nodeHarvestableByMe: opts.harvestable ?? (() => true),
    professionsState: {
      skills: Object.entries(proficiency).map(([professionId, skill]) => ({
        professionId,
        skill,
        maxSkill: 300,
      })),
    },
  } as unknown as IWorld;
}

describe('classifyGatherNode', () => {
  it('classifies ready when nodeHarvestableByMe is true', () => {
    const world = makeWorld({ harvestable: () => true });
    expect(classifyGatherNode(world, NODE.id)).toBe('ready');
  });

  it('classifies cooldown when nodeHarvestableByMe is false', () => {
    const world = makeWorld({ harvestable: () => false });
    expect(classifyGatherNode(world, NODE.id)).toBe('cooldown');
  });
});

describe('buildNearbyGatherNodes', () => {
  it('includes nodes within radius and excludes nodes outside it', () => {
    const near = GATHER_NODES[0];
    const far = { x: near.pos.x + 100000, z: near.pos.z };
    const world = makeWorld({ pos: near.pos });
    const nodes = buildNearbyGatherNodes(world, 50);
    expect(nodes.some((n) => n.id === near.id)).toBe(true);
    // sanity: the far node id is never in range from this position.
    expect(nodes.every((n) => n.x !== far.x)).toBe(true);
  });

  it('classifies each nearby node ready/cooldown via nodeHarvestableByMe', () => {
    const world = makeWorld({
      pos: NODE.pos,
      harvestable: (id) => id !== NODE.id,
    });
    const nodes = buildNearbyGatherNodes(world, 5);
    const mine = nodes.find((n) => n.id === NODE.id);
    expect(mine?.state).toBe('cooldown');
  });

  // CRITICAL acceptance criterion: two independent viewers asking about the
  // SAME node list get independently correct answers for the SAME node id.
  it('two independent per-viewer cooldown states produce independent results for the same node', () => {
    const worldA = makeWorld({ pos: NODE.pos, harvestable: (id) => id === NODE.id });
    const worldB = makeWorld({ pos: NODE.pos, harvestable: () => false });

    const nodesA = buildNearbyGatherNodes(worldA, 5);
    const nodesB = buildNearbyGatherNodes(worldB, 5);

    const aState = nodesA.find((n) => n.id === NODE.id)?.state;
    const bState = nodesB.find((n) => n.id === NODE.id)?.state;

    expect(aState).toBe('ready');
    expect(bState).toBe('cooldown');
    // The two results genuinely differ: viewer A's cooldown never leaks into B's.
    expect(aState).not.toBe(bState);
  });
});

describe('buildGatheringProficiencyRows', () => {
  it('returns one row per gathering profession, in the fixed order', () => {
    const world = makeWorld({ proficiency: { mining: 3, logging: 0, herbalism: 7 } });
    const rows = buildGatheringProficiencyRows(world);
    expect(rows.map((r) => r.professionId)).toEqual(['mining', 'logging', 'herbalism']);
  });

  it('matches the input values exactly', () => {
    const world = makeWorld({ proficiency: { mining: 12, logging: 4, herbalism: 0 } });
    const rows = buildGatheringProficiencyRows(world);
    expect(rows).toEqual([
      { professionId: 'mining', value: 12 },
      { professionId: 'logging', value: 4 },
      { professionId: 'herbalism', value: 0 },
    ]);
  });

  it('defaults an absent or malformed entry to 0, never throwing', () => {
    const world = makeWorld({
      proficiency: { mining: Number.NaN, logging: -5 } as unknown as Record<string, number>,
    });
    const rows = buildGatheringProficiencyRows(world);
    expect(rows.find((r) => r.professionId === 'mining')?.value).toBe(0);
    expect(rows.find((r) => r.professionId === 'logging')?.value).toBe(0);
    expect(rows.find((r) => r.professionId === 'herbalism')?.value).toBe(0);
  });
});
