// Pure gathering HUD core (issue 1124): node ready/cooldown classification (per-viewer,
// see IWorldProfessions#nodeHarvestableByMe) and the gathering-proficiency display
// rows (IWorldProfessions#professionsState). DOM/Three-free, same-input ->
// same-output, driven with hand-built IWorld-shaped stubs (no real Sim needed:
// the acceptance criterion under test is that two independent per-viewer
// cooldown states against the SAME node list classify independently, which is a
// property of this pure core, not of Sim's respawn timer itself).

import { describe, expect, it } from 'vitest';
import { GATHERING_PROFESSIONS, type GatheringProfessionId } from '../src/sim/content/professions';
import { GATHER_NODES } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import {
  buildGatheringProficiencyRows,
  buildGatherNodeTooltip,
  buildNearbyGatherNodes,
  classifyGatherNode,
  gatherDeniedLineKey,
  gatherDowngradeLineKey,
  isNodeToolLockedFor,
  viewerBestToolTier,
} from '../src/ui/gathering_view';
import type { IWorld } from '../src/world_api';

const NODE = GATHER_NODES[0];

function makeWorld(opts: {
  pos?: { x: number; z: number };
  harvestable?: (nodeId: string) => boolean;
  proficiency?: Record<string, number>;
  inventory?: InvSlot[];
}): IWorld {
  const proficiency = opts.proficiency ?? {};
  return {
    player: { pos: opts.pos ?? { x: NODE.pos.x, z: NODE.pos.z } },
    // Phase 12: buildNearbyGatherNodes resolves the locked dimension from the
    // viewer's bags; an empty bag reads as the bare-hands tier-1 floor.
    inventory: opts.inventory ?? [],
    nodeHarvestableByMe: opts.harvestable ?? (() => true),
    professionsState: {
      // The rows carry the RESOLVED per-profession content caps (Phase 12c:
      // 100 gathering, 200 fishing), matching what both worlds now emit.
      skills: Object.entries(proficiency).map(([professionId, skill]) => ({
        professionId,
        skill,
        maxSkill: GATHERING_PROFESSIONS[professionId as GatheringProfessionId]?.maxSkill ?? 100,
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

// Phase 12: the tool-tier access dimension. `locked` is SEPARATE from the
// ready/cooldown respawn state so the minimap can compose both; the lock
// resolves through the sim's own canGatherTier comparator against the
// viewer's owned-best bag scan (bare hands floor to tier 1).
describe('tool-tier lock dimension (Phase 12)', () => {
  // A literal NEW tier-2 vein (the Phase 12 ramp); GATHER_NODES[0] stays the
  // tier-1 arm.
  const T2 = GATHER_NODES.find((n) => n.id === 'ore_mirefen_t2');
  if (!T2) throw new Error('missing ore_mirefen_t2');
  const PICK: InvSlot[] = [{ itemId: 'iron_mining_pick', count: 1 }];

  it('viewerBestToolTier reads the IWorld bags: empty floors to 1, the pick lifts mining only', () => {
    expect(viewerBestToolTier(makeWorld({}), 'mining')).toBe(1);
    const world = makeWorld({ inventory: PICK });
    expect(viewerBestToolTier(world, 'mining')).toBe(2);
    expect(viewerBestToolTier(world, 'logging')).toBe(1);
  });

  it('isNodeToolLockedFor: a tier-2 node locks bare hands, unlocks with the pick; tier 1 never locks', () => {
    expect(isNodeToolLockedFor(makeWorld({}), { type: 'ore', tier: 2 })).toBe(true);
    expect(isNodeToolLockedFor(makeWorld({ inventory: PICK }), { type: 'ore', tier: 2 })).toBe(
      false,
    );
    expect(isNodeToolLockedFor(makeWorld({}), { type: 'ore', tier: 1 })).toBe(false);
  });

  it('buildNearbyGatherNodes carries tier and both lock arms, independent of respawn state', () => {
    const bare = buildNearbyGatherNodes(makeWorld({ pos: T2.pos }), 5);
    const bareT2 = bare.find((n) => n.id === T2.id);
    expect(bareT2).toMatchObject({ tier: 2, locked: true, state: 'ready' });
    const tooled = buildNearbyGatherNodes(makeWorld({ pos: T2.pos, inventory: PICK }), 5);
    expect(tooled.find((n) => n.id === T2.id)).toMatchObject({ tier: 2, locked: false });
    // The tier-1 arm: never locked, even bare-handed.
    const t1 = buildNearbyGatherNodes(makeWorld({}), 5).find((n) => n.id === NODE.id);
    expect(t1).toMatchObject({ tier: 1, locked: false });
    // Lock and respawn compose: a cooling t2 node reads locked AND cooldown.
    const cooling = buildNearbyGatherNodes(
      makeWorld({ pos: T2.pos, harvestable: (id) => id !== T2.id }),
      5,
    ).find((n) => n.id === T2.id);
    expect(cooling).toMatchObject({ locked: true, state: 'cooldown' });
  });

  it('buildGatherNodeTooltip resolves the full model, and null for an unknown id', () => {
    expect(buildGatherNodeTooltip(makeWorld({ pos: T2.pos }), T2.id)).toEqual({
      type: 'ore',
      professionId: 'mining',
      tier: 2,
      locked: true,
      state: 'ready',
    });
    expect(
      buildGatherNodeTooltip(makeWorld({ pos: T2.pos, inventory: PICK }), T2.id),
    ).toMatchObject({ locked: false });
    // A stale pick after a content change resolves to null, never a throw.
    expect(buildGatherNodeTooltip(makeWorld({}), 'no_such_node_id')).toBeNull();
  });

  it('gatherDeniedLineKey maps surface + professionId to the exact key, falling back safely', () => {
    expect(gatherDeniedLineKey('node', 'mining')).toBe('hudChrome.gathering.toolTierUnmet.mining');
    expect(gatherDeniedLineKey('node', 'logging')).toBe(
      'hudChrome.gathering.toolTierUnmet.logging',
    );
    expect(gatherDeniedLineKey('node', 'herbalism')).toBe(
      'hudChrome.gathering.toolTierUnmet.herbalism',
    );
    expect(gatherDeniedLineKey('corpse')).toBe('hudChrome.gathering.toolTierUnmetCorpse');
    // Unexpected shapes never reach t() with an untracked key: a node surface
    // with fishing (no fishing world nodes) or a missing professionId falls
    // back to the profession-neutral corpse line.
    expect(gatherDeniedLineKey('node', 'fishing')).toBe('hudChrome.gathering.toolTierUnmetCorpse');
    expect(gatherDeniedLineKey('node')).toBe('hudChrome.gathering.toolTierUnmetCorpse');
  });

  it('gatherDowngradeLineKey maps each lost arm to its exact key (Phase 12d)', () => {
    expect(gatherDowngradeLineKey('mark')).toBe('hudChrome.gathering.downgradeMark');
    expect(gatherDowngradeLineKey('find')).toBe('hudChrome.gathering.downgradeFind');
  });
});

describe('buildGatheringProficiencyRows', () => {
  it('returns one row per gathering profession, in the fixed order', () => {
    const world = makeWorld({ proficiency: { mining: 3, logging: 0, herbalism: 7 } });
    const rows = buildGatheringProficiencyRows(world);
    expect(rows.map((r) => r.professionId)).toEqual(['mining', 'logging', 'herbalism', 'fishing']);
  });

  it('matches the input values exactly', () => {
    const world = makeWorld({ proficiency: { mining: 12, logging: 4, herbalism: 0 } });
    const rows = buildGatheringProficiencyRows(world);
    expect(rows).toEqual([
      { professionId: 'mining', value: 12 },
      { professionId: 'logging', value: 4 },
      { professionId: 'herbalism', value: 0 },
      { professionId: 'fishing', value: 0 },
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
