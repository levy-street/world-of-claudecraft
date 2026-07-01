import { describe, expect, it } from 'vitest';
import { propPreloadInternalsForTest } from '../src/render/props';
import { GATHER_NODE_PLACEMENTS, GATHER_NODE_TYPES, PROPS, ZONES } from '../src/sim/data';

const PROFESSIONS = new Set(['mining', 'logging', 'herbalism']);
const VISUALS = new Set(['ore', 'wood', 'herb']);

describe('gather node content', () => {
  it('defines a complete ore, wood, and herb node catalog', () => {
    const defs = Object.values(GATHER_NODE_TYPES);
    expect(defs).not.toHaveLength(0);
    expect(new Set(defs.map((def) => def.profession))).toEqual(PROFESSIONS);
    expect(new Set(defs.map((def) => def.visual))).toEqual(VISUALS);
    expect(
      defs.every(
        (def) =>
          def.id === Object.keys(GATHER_NODE_TYPES).find((id) => GATHER_NODE_TYPES[id] === def),
      ),
    ).toBe(true);
    expect(defs.every((def) => Number.isInteger(def.tier) && def.tier >= 1)).toBe(true);
  });

  it('keeps placements unique, typed, and inside their declared zone band', () => {
    const ids = new Set<string>();
    for (const placement of GATHER_NODE_PLACEMENTS) {
      expect(ids.has(placement.id), placement.id).toBe(false);
      ids.add(placement.id);

      const def = GATHER_NODE_TYPES[placement.nodeId];
      expect(def, `${placement.id} node type`).toBeTruthy();
      const zone = ZONES.find((entry) => entry.id === placement.zoneId);
      if (!zone) throw new Error(`Unknown zone for ${placement.id}: ${placement.zoneId}`);
      expect(placement.z, placement.id).toBeGreaterThanOrEqual(zone.zMin);
      expect(placement.z, placement.id).toBeLessThan(zone.zMax);
      expect(Math.abs(placement.x), placement.id).toBeLessThanOrEqual(180);
    }
  });

  it('places every profession in every overworld zone and merges them into props', () => {
    for (const zone of ZONES) {
      const zonePlacements = GATHER_NODE_PLACEMENTS.filter(
        (placement) => placement.zoneId === zone.id,
      );
      expect(
        zonePlacements.map((placement) => GATHER_NODE_TYPES[placement.nodeId].profession).sort(),
      ).toEqual(['herbalism', 'herbalism', 'logging', 'logging', 'mining', 'mining']);
    }

    expect(PROPS.gatherNodes).toEqual(GATHER_NODE_PLACEMENTS);
  });

  it('preloads the gather node render assets on every graphics tier', () => {
    const { lowTierPropKeys, preloadPropKeys } = propPreloadInternalsForTest;
    expect(lowTierPropKeys).toEqual(
      expect.arrayContaining(['oreRocks', 'resourceWoodStack', 'resourceHerb']),
    );
    expect([...preloadPropKeys(false)]).toEqual(
      expect.arrayContaining(['oreRocks', 'resourceWoodStack', 'resourceHerb']),
    );
    expect([...preloadPropKeys(true)]).toEqual(
      expect.arrayContaining(['oreRocks', 'resourceWoodStack', 'resourceHerb']),
    );
  });
});
