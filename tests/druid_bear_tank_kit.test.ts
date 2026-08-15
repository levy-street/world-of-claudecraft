// Bruin Form's in-form heal (Savage Mending). It was authored for the Talents
// 2.0 L17 druid row, but that row shipped granting Gladesong instead, so the
// ability was defined, painted and HUD-wired yet granted by nothing and
// unreachable in play. It is a Wildfang spec ability now.
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function feralDruid(seed = 42): { sim: Sim; druid: Entity } {
  const sim = new Sim({ seed, playerClass: 'druid' });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('feral')).toBe(true);
  return { sim, druid: sim.player };
}

function wolves(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && e.templateId === 'forest_wolf' && !e.dead,
  );
}

function teleport(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function knownIds(spec: string): string[] {
  const mods = computeTalentModifiers('druid', { spec, rows: {} } as never, 20);
  return abilitiesKnownAt('druid', 20, mods).map((entry) => entry.def.id);
}

function shiftToBear(sim: Sim, druid: Entity): void {
  sim.castAbility('bear_form');
  // Clear the shift's global cooldown before the next cast, or the ability
  // under test is refused for a reason that has nothing to do with it.
  for (let tick = 0; tick < 40; tick++) sim.tick();
  expect(druid.auras.some((aura) => aura.kind === 'form_bear')).toBe(true);
}

describe('Bruin Form tank kit', () => {
  it('gives the in-form heal to Wildfang only', () => {
    expect(knownIds('feral')).toContain('frenzied_regeneration');
    expect(knownIds('balance')).not.toContain('frenzied_regeneration');
    expect(knownIds('restoration')).not.toContain('frenzied_regeneration');
  });

  it('is refused in caster form, where a druid keeps its real heals', () => {
    const { sim, druid } = feralDruid(7);
    const wolf = wolves(sim)[0];
    wolf.maxHp = wolf.hp = 5000;
    teleport(sim, druid, wolf.pos.x + 3, wolf.pos.z);
    druid.resource = druid.maxResource;

    const before = druid.hp;
    sim.castAbility('frenzied_regeneration');
    for (let tick = 0; tick < 20 * 12; tick++) sim.tick();
    expect(druid.auras.some((aura) => aura.id === 'frenzied_regeneration')).toBe(false);
    expect(druid.hp).toBe(before);
  });

  it('heals its authored total over the full window in Bruin Form', () => {
    const { sim, druid } = feralDruid(11);
    shiftToBear(sim, druid);
    // Out of combat and unwounded by anything else, so the only healing in the
    // window is the HoT itself.
    druid.hp = Math.round(druid.maxHp * 0.4);
    druid.resource = druid.maxResource;
    sim.drainEvents();

    sim.castAbility('frenzied_regeneration');
    const hot = druid.auras.find((aura) => aura.id === 'frenzied_regeneration');
    expect(hot?.kind).toBe('hot');
    expect(hot?.remaining).toBe(10);

    let healed = 0;
    for (let tick = 0; tick < 20 * 12; tick++) {
      for (const event of sim.tick()) {
        if (event.type === 'heal2' && event.targetId === druid.id) healed += event.amount;
      }
    }
    // Authored as 180 over 10 sec; healing modifiers may lift it, but it must
    // land in the window rather than arriving as one lump or not at all.
    expect(healed).toBeGreaterThanOrEqual(180);
    expect(healed).toBeLessThanOrEqual(320);
    expect(druid.hp).toBeLessThanOrEqual(druid.maxHp);
    // The cooldown is real: a second cast inside the window is refused.
    druid.resource = druid.maxResource;
    sim.castAbility('frenzied_regeneration');
    expect(druid.auras.some((aura) => aura.id === 'frenzied_regeneration')).toBe(false);
  });
});
