import { describe, expect, it } from 'vitest';
import { ZONE3_OBJECTS } from '../src/sim/content/zone3';
import { DUNGEONS, QUESTS } from '../src/sim/data';

// Regression for issue #1894: "The Bound Guardian" quest text sent players to
// the wrong side of the map. Pin the quest's compass words against the real
// world coordinates using the engine's actual convention, so a future copy
// edit can't silently reintroduce the drift.
//
// Convention (see src/sim/content/zone1.ts: "+z north, +x WEST (east is -x:
// facing 0 looks along +z and turning right decreases facing, so the
// rendered world and the corrected map both put -x on your right)", echoed
// in zone2.ts, and pinned by tests/compass.test.ts): +x is WEST, -x is EAST,
// +z is north.
describe('q_nythraxis_bound_guardian quest text direction', () => {
  function objectPos(itemId: string): { x: number; z: number } {
    const obj = ZONE3_OBJECTS.find((o) => o.itemId === itemId);
    expect(obj, `${itemId} should be a registered zone3 object`).toBeTruthy();
    const pos = obj!.positions[0];
    expect(pos).toBeTruthy();
    return pos;
  }

  it('places the ritual circle north-west of the abandoned crypt door', () => {
    const crypt = DUNGEONS.nythraxis_crypt;
    expect(crypt, 'nythraxis_crypt dungeon should be registered').toBeTruthy();
    const ritual = objectPos('crypt_ritual_circle');
    // +x is west, so a larger x than the door means further west.
    expect(ritual.x).toBeGreaterThan(crypt.doorPos.x);
    expect(ritual.z).toBeGreaterThan(crypt.doorPos.z); // north of the door
  });

  it("places the ritual circle north-east of High Priest Malric's grave", () => {
    const grave = objectPos('grave_high_priest_malric');
    const ritual = objectPos('crypt_ritual_circle');
    // -x is east, so a smaller x than the grave means further east.
    expect(ritual.x).toBeLessThan(grave.x);
    expect(ritual.z).toBeGreaterThan(grave.z); // north of the grave
  });

  it("places Voss's grave, not Malric's or Aldren's, as the easternmost of the three", () => {
    const voss = objectPos('grave_captain_voss');
    const malric = objectPos('grave_high_priest_malric');
    const aldren = objectPos('grave_sir_aldren');
    // -x is east, so the most negative x is the furthest east.
    expect(voss.x).toBeLessThan(malric.x);
    expect(voss.x).toBeLessThan(aldren.x);
  });

  it("quest text names Malric's grave explicitly and drops the ambiguous/wrong wording", () => {
    const quest = QUESTS.q_nythraxis_bound_guardian;
    expect(quest, 'q_nythraxis_bound_guardian should be registered').toBeTruthy();
    expect(quest.text).toContain('north-west of the abandoned crypt');
    expect(quest.text).toContain("north-east of High Priest Malric's grave");
    expect(quest.text).not.toContain('south-east');
    expect(quest.text).not.toContain('the western grave');
    expect(quest.text).not.toContain('east of the abandoned crypt and north-east');
  });
});
