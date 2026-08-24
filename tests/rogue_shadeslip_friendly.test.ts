import { describe, expect, it } from 'vitest';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { abilityRequirementKeys } from '../src/ui/hud/action_bar/ability_requirement_keys';
import { classAbilityNamesEn } from '../src/ui/i18n.catalog/abilities';

// Shadeslip repositions the CASTER and does nothing to the thing it steps to,
// so it resolves against an ally the same way it resolves against an enemy
// (peeling back to a healer, closing on a friendly flag carrier). Before this
// it carried the default enemy-only targeting and refused a friendly target
// with "You have no target."

type SimInternals = { rebucket(e: Entity): void; addEntity(e: Entity): void };

function teleport(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as SimInternals).rebucket(e);
}

function errors(events: SimEvent[]): SimEvent[] {
  return events.filter((e) => e.type === 'error');
}

function makePair(): { sim: Sim; rogue: Entity; ally: Entity; rogueId: number } {
  const sim = new Sim({ seed: 5, playerClass: 'rogue', noPlayer: true });
  const rogueId = sim.addPlayer('rogue', 'Slip');
  const allyId = sim.addPlayer('priest', 'Mender');
  const rogue = sim.entities.get(rogueId)!;
  const ally = sim.entities.get(allyId)!;
  sim.setPlayerLevel(20, rogueId);
  // Shadeslip is a row-5 talent grant, not a baseline rogue ability.
  expect(sim.applyTalents({ spec: null, rows: { 5: 'rog_r5_shadeslip' } }, rogueId)).toBe(true);
  // +x from the origin is open ground on this seed out to 12 yd, so the step
  // is never refused for line of sight (which would mask the targeting gate).
  teleport(sim, rogue, 0, 0);
  teleport(sim, ally, 12, 0);
  rogue.resource = rogue.maxResource;
  return { sim, rogue, ally, rogueId };
}

describe('Shadeslip steps to friend or foe', () => {
  it('closes on a friendly player instead of refusing the cast', () => {
    const { sim, rogue, ally, rogueId } = makePair();
    const before = dist2d(rogue.pos, ally.pos);
    expect(before).toBeGreaterThan(5);

    sim.targetEntity(ally.id, rogueId);
    sim.castAbility('shadowstep', rogueId);
    // The enemy-only gate emitted "You have no target."; the friendly cast must not.
    expect(errors(sim.tick())).toEqual([]);

    const after = dist2d(rogue.pos, ally.pos);
    expect(after).toBeLessThan(before);
    // The dispatch stops 1.5 yd short of whatever it steps to.
    expect(after).toBeCloseTo(1.5, 1);
  });

  it('still steps to a hostile mob, unchanged', () => {
    const { sim, rogue, rogueId } = makePair();
    const mob = createMob(31_000, MOBS.forest_wolf, 10, { x: 0, y: 0, z: 0 });
    mob.hostile = true;
    (sim as unknown as SimInternals).addEntity(mob);
    teleport(sim, mob, 10, 0);

    sim.targetEntity(mob.id, rogueId);
    sim.castAbility('shadowstep', rogueId);
    expect(errors(sim.tick())).toEqual([]);
    expect(dist2d(rogue.pos, mob.pos)).toBeCloseTo(1.5, 1);
  });

  it('a dead friendly target is still refused', () => {
    const { sim, rogue, ally, rogueId } = makePair();
    ally.dead = true;
    const start = { x: rogue.pos.x, z: rogue.pos.z };

    sim.targetEntity(ally.id, rogueId);
    sim.castAbility('shadowstep', rogueId);
    expect(errors(sim.tick()).length).toBeGreaterThan(0);
    expect(rogue.pos.x).toBeCloseTo(start.x);
    expect(rogue.pos.z).toBeCloseTo(start.z);
  });

  it('the tooltip says either side rather than enemy-only', () => {
    const keys = abilityRequirementKeys(ABILITIES.shadowstep, 'subtlety').map((r) => r.key);
    expect(keys).toContain('anyTarget');
    expect(keys).not.toContain('enemyTarget');
    expect(classAbilityNamesEn.entities.abilities.shadowstep.description).toContain(
      'friend or foe',
    );
    // An ordinary offensive ability is untouched.
    expect(abilityRequirementKeys(ABILITIES.eviscerate, 'subtlety').map((r) => r.key)).toContain(
      'enemyTarget',
    );
  });
});
