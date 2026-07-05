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
});
