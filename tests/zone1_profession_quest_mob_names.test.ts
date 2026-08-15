import { describe, expect, it } from 'vitest';
import { ZONE1_QUESTS } from '../src/sim/content/zone1';
import { en } from '../src/ui/i18n.resolved.generated/en';

// Regression: zone1's webwood_spider and tunnel_rat mobs were renamed to the
// display names "Sableweb Lurker" and "Deeprock Digger" (see the zone's main
// leveling quests q_prof_amends_outfitter's sibling q_prof_attune_outfitter,
// and q_supplies/q_mogger-style quests), but three profession quests kept
// the old generic species names in their giver text and kill-objective
// labels: q_prof_attune_outfitter, q_prof_amends_outfitter (both webwood
// spiders) and q_prof_amends_bombardier (tunnel rats). Pin both the content
// record AND the resolved i18n table (the quest log reads the resolved
// table, not the content record directly, so a catalog override could drift
// independently, per the zone1_quest_directions.test.ts precedent).
describe('zone1 profession quests use the current mob display names', () => {
  it('q_prof_attune_outfitter names Sableweb Lurkers, not webwood spiders', () => {
    const quest = ZONE1_QUESTS.q_prof_attune_outfitter;
    expect(quest, 'q_prof_attune_outfitter should be registered').toBeTruthy();
    expect(quest.text).toContain('Sableweb Lurkers');
    expect(quest.text).not.toContain('webwood spider');
    expect(quest.objectives[0].label).toBe('Sableweb Lurker culled');

    const resolved = en.entities.quests.q_prof_attune_outfitter;
    expect(resolved.text).toContain('Sableweb Lurkers');
    expect(resolved.text).not.toContain('webwood spider');
    expect(resolved.objectives[0].label).toBe('Sableweb Lurker culled');
  });

  it('q_prof_amends_outfitter names Sableweb Lurkers, not webwood spiders', () => {
    const quest = ZONE1_QUESTS.q_prof_amends_outfitter;
    expect(quest, 'q_prof_amends_outfitter should be registered').toBeTruthy();
    expect(quest.text).toContain('Sableweb Lurkers');
    expect(quest.text).not.toContain('webwood spider');
    expect(quest.objectives[0].label).toBe('Sableweb Lurker culled');

    const resolved = en.entities.quests.q_prof_amends_outfitter;
    expect(resolved.text).toContain('Sableweb Lurkers');
    expect(resolved.text).not.toContain('webwood spider');
    expect(resolved.objectives[0].label).toBe('Sableweb Lurker culled');
  });

  it('q_prof_amends_bombardier names Deeprock Diggers, not tunnel rats', () => {
    const quest = ZONE1_QUESTS.q_prof_amends_bombardier;
    expect(quest, 'q_prof_amends_bombardier should be registered').toBeTruthy();
    expect(quest.text).toContain('Deeprock Diggers');
    expect(quest.text).not.toContain('tunnel rat');
    expect(quest.objectives[0].label).toBe('Deeprock Digger exterminated');

    const resolved = en.entities.quests.q_prof_amends_bombardier;
    expect(resolved.text).toContain('Deeprock Diggers');
    expect(resolved.text).not.toContain('tunnel rat');
    expect(resolved.objectives[0].label).toBe('Deeprock Digger exterminated');
  });
});
