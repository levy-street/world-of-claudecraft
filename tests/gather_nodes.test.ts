import { describe, expect, it } from 'vitest';
import { NODE_COLOR, NODE_GEOMETRY_KEYS } from '../src/render/gather_nodes_lookup';
import { GATHER_NODE_TYPES, GATHER_NODES, ZONES } from '../src/sim/data';

describe('gather node content', () => {
  const zonesById = new Map(ZONES.map((z) => [z.id, z]));

  it('every node references a valid zone id', () => {
    for (const node of GATHER_NODES) {
      expect(zonesById.has(node.zoneId)).toBe(true);
    }
  });

  it('every node position falls within its claimed zone band', () => {
    for (const node of GATHER_NODES) {
      const zone = zonesById.get(node.zoneId);
      if (!zone) throw new Error(`unknown zone ${node.zoneId}`);
      expect(node.pos.z).toBeGreaterThanOrEqual(zone.zMin);
      expect(node.pos.z).toBeLessThanOrEqual(zone.zMax);
    }
  });

  it('every node type is one of the known gather node types', () => {
    for (const node of GATHER_NODES) {
      expect(GATHER_NODE_TYPES).toContain(node.type);
    }
  });

  it('has no duplicate node ids', () => {
    const ids = GATHER_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('render lookup table covers every node type used in content', () => {
    const usedTypes = new Set(GATHER_NODES.map((n) => n.type));
    for (const type of usedTypes) {
      expect(NODE_GEOMETRY_KEYS).toContain(type);
      expect(NODE_COLOR[type]).toBeDefined();
    }
  });

  it("Eastbrook Vale ore nodes sit near the Copper Dig POI, the zone's only mine-themed landmark", () => {
    // Regression: the ore veins for q_prof_intro ("A Trade for Every Hand") used
    // to sit near Boar Meadow, a wolf/boar mob area with no mining flavor and no
    // discoverable landmark, so players could not find them. They now cluster
    // around Copper Dig, the zone's actual mine-themed POI.
    const zone = zonesById.get('eastbrook_vale');
    if (!zone) throw new Error('unknown zone eastbrook_vale');
    const copperDig = zone.pois.find((p) => p.label === 'Copper Dig');
    expect(copperDig).toBeDefined();
    if (!copperDig) throw new Error('missing Copper Dig POI');

    const oreNodes = GATHER_NODES.filter((n) => n.zoneId === 'eastbrook_vale' && n.type === 'ore');
    expect(oreNodes.length).toBeGreaterThan(0);
    for (const node of oreNodes) {
      const dist = Math.hypot(node.pos.x - copperDig.x, node.pos.z - copperDig.z);
      expect(dist).toBeLessThanOrEqual(20);
    }
  });

  it('every zone offers all three gather node types, so players are not forced back to one zone', () => {
    // Regression: thornpeak_heights had zero gather nodes of any type, and
    // mirefen_marsh had fewer than eastbrook_vale, so every player past the
    // starting zone had to backtrack to eastbrook_vale for ore (nodes respawn
    // per player and session-only, see gathering.ts, so this was never about
    // node camping contention, just discoverability and travel distance).
    for (const zone of ZONES) {
      for (const type of GATHER_NODE_TYPES) {
        const count = GATHER_NODES.filter((n) => n.zoneId === zone.id && n.type === type).length;
        expect(count, `${zone.id} should have at least one ${type} node`).toBeGreaterThan(0);
      }
    }
  });
});
