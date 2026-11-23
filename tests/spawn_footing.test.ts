import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, NPCS, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { Sim } from '../src/sim/sim';
import { spawnProbeStandsOnFloor } from '../src/sim/spawn_footing';
import type { WorldContent } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

// Spawn placement (Sim.findSafePos) beside a walk-in town building. The
// building's baked upper storey and eaves overhang its walls; a height-blind
// probe walls them to the ground and shoves a spawn standing under them away,
// so the built-in world stands its probes on the floor there, and only there.

afterEach(() => setActiveWorldContent(BUILTIN_WORLD));

describe('the spawn probe footing', () => {
  it('stands on the floor round a walk-in town building, and nowhere else in the built-in world', () => {
    const apothecary = EASTBROOK_LAYOUT.buildings.find(
      (building) => building.id === 'eastbrook_apothecary',
    );
    if (!apothecary) throw new Error('missing the Eastbrook apothecary');
    expect(apothecary.walkIn).toBe(true);
    expect(spawnProbeStandsOnFloor(apothecary.position.x, apothecary.position.z)).toBe(true);
    // open country, the Wolf Run garrison and the road between the towns
    for (const [x, z] of [
      [0, 0],
      [17.5, -5.5],
      [0, 100],
    ]) {
      expect(spawnProbeStandsOnFloor(x, z), `${x}, ${z}`).toBe(false);
    }
  });

  it('stands on the floor everywhere on an authored map', () => {
    setActiveWorldContent({ ...BUILTIN_WORLD, placements: [] } as WorldContent);
    expect(spawnProbeStandsOnFloor(0, 0)).toBe(true);
  });

  it("leaves Farmer Jessica on her authored spot under the apothecary's eaves", () => {
    // her spot is clear at the ground; half a yard east the shop's upper storey
    // and roof overhang its wall line, which a height-blind probe walls
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    const { x, z } = NPCS.farmer_jessica.pos;
    expect(sim.findSafePos(x, z, -Infinity)).toEqual({ x, z });
  });
});
