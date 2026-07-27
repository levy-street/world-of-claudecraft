import { describe, expect, it } from 'vitest';
import { DEEPFEN_SHALLOWS_LAKE, ZONE2_PROPS } from '../src/sim/content/zone2';
import { clonePropsWithoutEastbrookLayout } from '../src/sim/custom_world_props';
import { PROPS } from '../src/sim/data';
import { emptyZoneProps } from '../src/sim/types';
import { terrainHeight, waterLevel } from '../src/sim/world';

// Marsh reeds are waterline dressing around the Deepfen Shallows lake: the renderer
// (src/render/props.ts) drops each clump straight onto terrainHeight() with no
// water-aware snapping and no collider, so a coordinate that drifts up the bank
// renders as a 3-yard reed bush stranded in a dry field, and one that drifts into
// deep water sinks. Authoring is the only gate, hence this pin.
const WORLD_SEED = 20061; // the shipped world's fixed seed (server/game.ts, src/main.ts)

// How far above/below waterLevel() a clump may sit and still read as shoreline.
const MAX_BANK_OFFSET = 1;
// The lake is radius 35; terrain shapes the real edge a few yards wider. Anything
// past this is not "around Deepfen Shallows" any more.
const MAX_LAKE_DISTANCE = 45;

describe('marsh reed placement (Deepfen Shallows)', () => {
  it('places every reed clump on the Deepfen Shallows waterline', () => {
    expect(ZONE2_PROPS.marshReeds.length).toBeGreaterThan(0);
    for (const [x, z] of ZONE2_PROPS.marshReeds) {
      const offset = terrainHeight(x, z, WORLD_SEED) - waterLevel();
      expect(
        Math.abs(offset),
        `reed (${x}, ${z}) sits ${offset.toFixed(2)} off the waterline`,
      ).toBeLessThanOrEqual(MAX_BANK_OFFSET);
    }
  });

  it('keeps every reed clump within the lake neighbourhood', () => {
    for (const [x, z] of ZONE2_PROPS.marshReeds) {
      const d = Math.hypot(x - DEEPFEN_SHALLOWS_LAKE.x, z - DEEPFEN_SHALLOWS_LAKE.z);
      expect(d, `reed (${x}, ${z}) is ${d.toFixed(1)} from the lake centre`).toBeLessThanOrEqual(
        MAX_LAKE_DISTANCE,
      );
    }
  });

  it('carries the zone-2 reeds through the merged world props', () => {
    // mergeProps() silently dropped delveMarkers once (src/sim/data.ts); a field the
    // merge forgets renders as "the prop never appears" with no error anywhere.
    for (const [x, z] of ZONE2_PROPS.marshReeds) {
      expect(PROPS.marshReeds.some(([px, pz]) => px === x && pz === z)).toBe(true);
    }
    expect(PROPS.marshReeds).toHaveLength(ZONE2_PROPS.marshReeds.length);
  });

  it('clones the reeds into a custom world instead of dropping or aliasing them', () => {
    const cloned = clonePropsWithoutEastbrookLayout(PROPS);
    expect(cloned.marshReeds).toEqual(PROPS.marshReeds);
    expect(cloned.marshReeds).not.toBe(PROPS.marshReeds);
    expect(cloned.marshReeds[0]).not.toBe(PROPS.marshReeds[0]);
  });

  it('gives an empty zone an empty reed list, never undefined', () => {
    // props.ts iterates props.marshReeds unguarded, so a missing field is a crash.
    expect(emptyZoneProps().marshReeds).toEqual([]);
  });
});
