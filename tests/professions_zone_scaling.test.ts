// Phase 16 item 3, the zone-scaling projection's CI-assertable half
// (docs/design/professions-tuning-packet-review.md). The sim/server side of
// the projection is a verified NEGATIVE (no per-zone node registry exists, no
// per-tick sweep walks GATHER_NODES, node respawn is a lazy per-player
// comparison; recorded in the Phase 16 BUILT paragraphs), so what CI pins is
// the derivation discipline of the structures that DO exist: everything
// derives from the content tables, so a fifteenth zone grows every one of
// them linearly and none of these pins moves by hand.
//
// The client per-frame surfaces have their own homes: the minimap rim-cull
// parity arms live in tests/minimap_markers.test.ts and the painter budgets
// in tests/hud_perf_budget.test.ts. This file owns the resident-set and
// collider halves.
import { describe, expect, it } from 'vitest';
import { buildGatherNodes } from '../src/render/gather_nodes';
import type { Collider } from '../src/sim/colliders';
import { queryOpenWorldColliders } from '../src/sim/colliders';
import { GATHER_NODE_TYPES } from '../src/sim/content/gather_nodes';
import { GATHER_NODES, ZONES } from '../src/sim/data';
import { NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import { GATHER_NODE_BODIES } from '../src/sim/prop_layout';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('node meshes: one resident object per authored node, identified by id', () => {
  it('the render group holds exactly the GATHER_NODES id set, whatever the table grows to', () => {
    // The renderer builds the whole world's node meshes ONCE at construction
    // and never per frame; the linear term the projection names is this
    // resident set. The nodes are InstancedMesh batches after the v0.33.0
    // draw-call diet (one batch per type x z-band, ids in
    // userData.gatherNodeIds); in the Node host each type resolves to its
    // single fallback part, so flattening the batch id lists yields each
    // authored node exactly once. Pinned as an ID SET, not a count, so a
    // duplicated or dropped node fails even at an unchanged length.
    const { group } = buildGatherNodes(WORLD_SEED);
    const meshIds = group.children
      .flatMap((child) => (child.userData.gatherNodeIds as string[]) ?? [])
      .sort();
    const nodeIds = GATHER_NODES.map((n) => n.id).sort();
    expect(meshIds).toEqual(nodeIds);
    // Every batch sizes its instance count to its id list (the raycast
    // resolver indexes one by the other).
    for (const child of group.children) {
      const im = child as unknown as { count: number };
      expect(im.count).toBe((child.userData.gatherNodeIds as string[]).length);
    }
    // The per-zone contribution is linear by construction: every zone's
    // authored nodes appear, none minted from anywhere else.
    for (const zone of ZONES) {
      const zoneNodes = GATHER_NODES.filter((n) => n.zoneId === zone.id);
      const zoneMeshIds = meshIds.filter((id) => zoneNodes.some((n) => n.id === id));
      expect(zoneMeshIds).toHaveLength(zoneNodes.length);
    }
  });
});

describe('node colliders: solid ore and wood, soft herb, per authored node', () => {
  it('every node resolves its GATHER_NODE_BODIES arm through the real spatial grid', () => {
    // Query cost is local (the 16-yard grid), so the pin walks every node and
    // asserts presence-iff-solid at the node's exact coordinates: ore and
    // wood are permanent standable circles at their authored radii, herb
    // clusters deliberately collide with nothing.
    let solid = 0;
    let soft = 0;
    for (const node of GATHER_NODES) {
      const out: Collider[] = [];
      queryOpenWorldColliders(
        WORLD_SEED,
        node.pos.x - 1,
        node.pos.z - 1,
        node.pos.x + 1,
        node.pos.z + 1,
        out,
      );
      const body = GATHER_NODE_BODIES[node.type];
      const atNode = out.filter(
        (c) => c.type === 'circle' && c.x === node.pos.x && c.z === node.pos.z,
      );
      if (body) {
        expect(atNode.length, `solid ${node.type} node ${node.id}`).toBeGreaterThanOrEqual(1);
        expect(
          atNode.some((c) => c.type === 'circle' && c.r === body.r),
          `node ${node.id} carries its authored radius ${body.r}`,
        ).toBe(true);
        solid++;
      } else {
        expect(atNode, `soft ${node.type} node ${node.id} must not collide`).toHaveLength(0);
        soft++;
      }
    }
    // Both arms genuinely ran, at the authored type split (one third of the
    // table is herb by the per-zone type balance).
    expect(solid + soft).toBe(GATHER_NODES.length);
    expect(soft).toBe(GATHER_NODES.filter((n) => n.type === 'herb').length);
    expect(soft).toBeGreaterThan(0);
    expect(solid).toBeGreaterThan(0);
  });
});

describe('per-zone content tables derive from the zone list', () => {
  it('NODE_MATERIAL_TABLE covers exactly every type crossed with every zone', () => {
    // The one professions table that is per-zone BY SHAPE. Derived equality
    // in both directions: a fifteenth zone must add one row per type (the
    // literal-matrix restatement lives in tests/node_material_table.test.ts;
    // this arm is what fails when a zone ships without its rows).
    expect(Object.keys(NODE_MATERIAL_TABLE).sort()).toEqual([...GATHER_NODE_TYPES].sort());
    const zoneIds = ZONES.map((z) => z.id).sort();
    for (const type of GATHER_NODE_TYPES) {
      expect(Object.keys(NODE_MATERIAL_TABLE[type]).sort(), `material rows for ${type}`).toEqual(
        zoneIds,
      );
    }
  });

  it('every zone that ships nodes ships all three types (the starter-kit floor)', () => {
    // The density model the projection uses: 6 per type in a tuned zone, 2 in
    // a starter zone. This does not pin those counts (the rollout guard owns
    // them); it pins that no zone ships a PARTIAL kit, which would break the
    // per-type linearity the projection assumes.
    for (const zone of ZONES) {
      const byType = new Map<string, number>();
      for (const node of GATHER_NODES) {
        if (node.zoneId !== zone.id) continue;
        byType.set(node.type, (byType.get(node.type) ?? 0) + 1);
      }
      if (byType.size === 0) continue;
      expect([...byType.keys()].sort(), `zone ${zone.id}`).toEqual([...GATHER_NODE_TYPES].sort());
    }
  });
});
