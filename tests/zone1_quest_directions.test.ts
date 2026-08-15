import { describe, expect, it } from 'vitest';
import { ZONE1_CAMPS, ZONE1_QUESTS, ZONE1_ZONE } from '../src/sim/content/zone1';
import { en } from '../src/ui/i18n.resolved.generated/en';

// Regression for issue #2680: several Eastbrook Vale (zone 1) quest strings
// named the opposite east/west (or east/west diagonal) direction from their
// real destination. The engine convention (see src/sim/content/zone1.ts and
// src/ui/compass.ts): +z is north, +x is WEST, so east is -x. The map,
// minimap, and compass already follow this convention correctly; only the
// quest text had drifted. Pin each corrected quest's wording against the
// real world coordinates so a future copy edit can't silently reintroduce
// the flip.
describe('zone1 quest text direction (issue #2680)', () => {
  function poi(id: string): { x: number; z: number } {
    const found = ZONE1_ZONE.pois.find((p) => p.id === id);
    expect(found, `${id} should be a registered zone1 POI`).toBeTruthy();
    return found!;
  }

  function campCenter(mobId: string): { x: number; z: number } {
    const camp = ZONE1_CAMPS.find((c) => c.mobId === mobId);
    expect(camp, `${mobId} should be a registered zone1 camp`).toBeTruthy();
    return camp?.center as { x: number; z: number };
  }

  it('places the Copper Dig southeast of town (negative x, negative z)', () => {
    const dig = poi('copper_dig');
    expect(dig.x).toBeLessThan(0); // -x is east
    expect(dig.z).toBeLessThan(0); // south
  });

  it("names the Copper Dig's real direction in Foreman Odell's quest text", () => {
    const quest = ZONE1_QUESTS.q_prof_intro;
    expect(quest, 'q_prof_intro should be registered').toBeTruthy();
    expect(quest.text).toContain('Copper Dig, southeast of town');
    expect(quest.text).not.toContain('Copper Dig, southwest of town');
    // Pin the RENDERED English too: the quest log reads the resolved i18n
    // table, not the content record directly, so a catalog override that
    // drifts from src/sim/content/zone1.ts would slip past a content-only
    // assertion (issue #2680 review, finding 1).
    const resolved = en.entities.quests.q_prof_intro.text;
    expect(resolved).toContain('Copper Dig, southeast of town');
    expect(resolved).not.toContain('Copper Dig, southwest of town');
  });

  it('places the Bandit Camp southwest of town (positive x, negative z)', () => {
    const camp = poi('bandit_camp');
    expect(camp.x).toBeGreaterThan(0); // +x is west
    expect(camp.z).toBeLessThan(0); // south
  });

  it("names the bandit camp's real direction in Trader Wilkes's quest text", () => {
    const quest = ZONE1_QUESTS.q_supplies;
    expect(quest, 'q_supplies should be registered').toBeTruthy();
    expect(quest.text).toContain('camp in the southwest hills');
    expect(quest.text).not.toContain('camp in the southeast hills');
    const resolved = en.entities.quests.q_supplies.text;
    expect(resolved).toContain('camp in the southwest hills');
    expect(resolved).not.toContain('camp in the southeast hills');
  });

  it('places Mogger west of town (positive x)', () => {
    const mogger = campCenter('mogger');
    expect(mogger.x).toBeGreaterThan(0); // +x is west
  });

  it("names Mogger's real direction in Marshal Redbrook's quest text", () => {
    const quest = ZONE1_QUESTS.q_mogger;
    expect(quest, 'q_mogger should be registered').toBeTruthy();
    expect(quest.text).toContain('into the western meadow');
    expect(quest.text).not.toContain('into the eastern meadow');
    // q_mogger has a hand-authored English override in
    // src/ui/i18n.catalog/merge.ts that used to win over the content
    // record and keep the flipped wording live in the quest log even
    // after zone1.ts was corrected. Pin the resolved English so a future
    // override drift is caught here too.
    const resolved = en.entities.quests.q_mogger.text;
    expect(resolved).toContain('into the western meadow');
    expect(resolved).not.toContain('into the eastern meadow');
  });

  it('places the webwood spiders east of town (negative x)', () => {
    const spiders = campCenter('webwood_spider');
    expect(spiders.x).toBeLessThan(0); // -x is east
  });

  it("names the spiders' real direction in Weaver Ottilie's quest text", () => {
    const quest = ZONE1_QUESTS.q_prof_amends_outfitter;
    expect(quest, 'q_prof_amends_outfitter should be registered').toBeTruthy();
    expect(quest.text).toContain('crowding the eastern woods');
    expect(quest.text).not.toContain('crowding the western woods');
    const resolved = en.entities.quests.q_prof_amends_outfitter.text;
    expect(resolved).toContain('crowding the eastern woods');
    expect(resolved).not.toContain('crowding the western woods');
  });

  it('places the wild boars west of town (positive x)', () => {
    const boars = campCenter('wild_boar');
    expect(boars.x).toBeGreaterThan(0); // +x is west
  });

  it("names the boars' real direction in Cook Marlow's quest text", () => {
    const quest = ZONE1_QUESTS.q_prof_amends_apothecary;
    expect(quest, 'q_prof_amends_apothecary should be registered').toBeTruthy();
    expect(quest.text).toContain('wild boars in the west meadow');
    expect(quest.text).not.toContain('wild boars in the east meadow');
    const resolved = en.entities.quests.q_prof_amends_apothecary.text;
    expect(resolved).toContain('wild boars in the west meadow');
    expect(resolved).not.toContain('wild boars in the east meadow');
  });
});
