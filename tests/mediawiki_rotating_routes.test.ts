import { describe, expect, it } from 'vitest';
import { weeklyRoute, worldRoute } from '../scripts/mediawiki/rotating_routes';
import { WEEKLY_QUESTS } from '../src/sim/content/weekly_quests';
import { GLIDER_COURSES } from '../src/sim/content/world_quest_glider_levels';
import { WORLD_QUESTS } from '../src/sim/content/world_quests';
import { MOBS } from '../src/sim/data';
import { FINAL_BOSS_DUNGEONS } from '../src/sim/deeds';
import { isRaidRoom } from '../src/sim/raid_rooms';

const find = (type: string) => worldRoute(WORLD_QUESTS.find((q) => q.objective.type === type)!);
describe('Weekly and world quest walkthroughs', () => {
  it('builds a finite route and states the automatic payment for every rotating offer', () => {
    for (const q of WORLD_QUESTS) {
      const text = worldRoute(q);
      expect(text, q.id).toContain('You get paid as soon as you finish');
      expect(text, q.id).toContain('woc-pin');
      expect(text, q.id).not.toMatch(/undefined|NaN/);
    }
  });
  it('places actual ore nodes inside the Willowfen gathering area', () => {
    const route = find('gather');
    expect(route).toContain('ore node (');
    expect(route).not.toContain('Do the activity inside this circle');
  });
  it('plots every ring on its own course and names the landing condition', () => {
    const flight = find('glider');
    expect(flight.match(/flight route ==/g)).toHaveLength(GLIDER_COURSES.length);
    for (const c of GLIDER_COURSES)
      for (const r of c.rings)
        expect(flight).toContain(
          'Ring ' + r.id + ' at height ' + r.y + ' yd (' + r.x + ', ' + r.z + ')',
        );
    expect(flight).toContain('within 3 yd of the ground');
  });
  it('gives the live forge inputs, carrier steal gate and evidence requirement', () => {
    expect(find('forging')).toContain('strike the anvil 10 times');
    expect(find('forging')).not.toContain('Click the supplies I call for');
    expect(find('shadow')).toContain('under 50% suspicion');
    expect(find('investigation')).toContain('all four suspects');
  });
  it('uses the weekly credit roster and traverses the physical entrances for internal raids', () => {
    const raids = weeklyRoute(WEEKLY_QUESTS.find((q) => q.kind === 'raid')!);
    const dungeons = weeklyRoute(WEEKLY_QUESTS.find((q) => q.kind === 'dungeons')!);
    expect(raids).toContain('Abandoned Crypt → Nythraxis Raid Arena');
    expect(raids).toContain('The Forge-Lift → Halls of the First Tempering');
    for (const [boss, id] of Object.entries(FINAL_BOSS_DUNGEONS)) {
      expect(isRaidRoom(id) ? raids : dungeons).toContain(MOBS[boss].name);
      expect(isRaidRoom(id) ? dungeons : raids).not.toContain('Defeat ' + MOBS[boss].name);
    }
  });
});
