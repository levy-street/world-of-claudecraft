// The Duskfall Passage's two cave mouths are OVERWORLD site dressing standing
// on REALM_PORTALS' fixed coordinates. On the Deepglass/Tidehold map those
// coordinates land on the island's north quay, and Troy asked twice why a
// dungeon portal kept appearing on his city map (2026-09-09). The art
// (render/hollow_gates.ts) and the three collider circles per mouth
// (sim/colliders.ts) now answer to the same rule the ore veins and camp
// braziers already do.
import { describe, expect, it } from 'vitest';
import { PORTALS, setActiveWorldContent } from '../src/sim/data';

import { buildDeepglassWorld, DEEPGLASS_MAP_ENTRY } from '../src/sim/deepglass/world';
import { usesOverworldSiteDressing } from '../src/sim/map_presentation';
import { queryOpenWorldColliders } from '../src/sim/colliders';

describe('no overworld cave mouths on an authored map', () => {
  it('the rule is off for an authored map and on for the shipped world', () => {
    expect(usesOverworldSiteDressing(undefined)).toBe(true); // the shipped overworld
    expect(usesOverworldSiteDressing('deepglass')).toBe(false);
    expect(usesOverworldSiteDressing('blank')).toBe(false);
  });

  it('no gate collider stands near a portal mouth on the Deepglass map', () => {
    const world = buildDeepglassWorld();
    setActiveWorldContent(world);
    const mouth = PORTALS[0]?.a;
    expect(mouth, 'the shipped world still declares a portal').toBeTruthy();
    if (!mouth) return;
    // The flanks sit within ~4yd of the mouth; sweep a generous box round it.
    const near = queryOpenWorldColliders(
      DEEPGLASS_MAP_ENTRY.seed,
      mouth.x - 12,
      mouth.z - 12,
      mouth.x + 12,
      mouth.z + 12,
      [],
    ).filter((c) => c.type === 'circle' && Math.hypot(c.x - mouth.x, c.z - mouth.z) < 6);
    expect(near, `colliders left at the mouth ${mouth.x},${mouth.z}`).toHaveLength(0);
  });
});
