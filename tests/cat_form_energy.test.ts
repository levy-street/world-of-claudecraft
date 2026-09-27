// Cat Form energy is a pool you park, not a refill you can farm.
//
// Player report (v0.44): drain the energy bar in Cat Form, right-click the
// form buff away (free, no global cooldown), cast Cat Form again, and the bar
// is back at 100. In a fight that is a full bar every other global cooldown.
// The fix parks the energy you leave Cat Form with and keeps it regenerating
// at the base rate while you are out of the form, so a shift back in during a
// fight returns exactly what staying in Cat would have. Out of combat a shift
// still hands over the full bar the friendly opener always gave.

import { describe, expect, it } from 'vitest';
import {
  CAT_ENERGY_MAX,
  catFormEntryEnergy,
  PARKED_ENERGY_REGEN_PER_TICK,
  parkCatEnergy,
  regenParkedCatEnergy,
  takeCatFormEntryEnergy,
} from '../src/sim/combat/cat_form_energy';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { readyArenaFighter } from '../src/sim/social/arena';
import type { Entity, SimEvent } from '../src/sim/types';

/** Ticks per classic regen tick (updateRegen pays every 40th sim tick). */
const REGEN_TICK = 40;

function feralDruid(): { sim: Sim; p: Entity } {
  const sim = new Sim({ seed: 43, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: 'feral', rows: {} })).toBe(true);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

/** Tick while holding the druid in combat (as a live fight would). */
function fight(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    sim.player.combatTimer = 0;
    sim.player.inCombat = true;
    sim.tick();
  }
  sim.player.combatTimer = 0;
  sim.player.inCombat = true;
}

/** Tick with the druid well out of combat. */
function rest(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    sim.player.combatTimer = 99;
    sim.tick();
  }
}

function inCat(p: Entity): boolean {
  return p.auras.some((a) => a.kind === 'form_cat');
}

function spawnMob(sim: Sim, distance: number): Entity {
  const player = sim.player;
  const mob = createMob(9931, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + distance,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  player.facing = 0;
  return mob;
}

describe('cancel-form then re-shift no longer refills Cat energy mid-fight (the report)', () => {
  it('returns the energy you left with, not a fresh 100', () => {
    const { sim, p } = feralDruid();
    fight(sim, 1);
    sim.castAbility('cat_form');
    fight(sim, 40); // out of the shift's global cooldown
    expect(inCat(p)).toBe(true);
    p.resource = 0; // the bar spent down on the fight

    sim.cancelAura('cat_form'); // right-click the buff: free, no GCD
    expect(inCat(p)).toBe(false);
    expect(p.resourceType).toBe('mana');
    sim.castAbility('cat_form');

    expect(inCat(p)).toBe(true);
    expect(p.resourceType).toBe('energy');
    expect(p.resource).toBe(0);
  });

  it('keeps the parked pool regenerating at the base rate while out of Cat', () => {
    const { sim, p } = feralDruid();
    fight(sim, 1);
    sim.castAbility('cat_form');
    fight(sim, 40);
    p.resource = 0;
    sim.cancelAura('cat_form');

    // Exactly two classic regen ticks land in any 80 consecutive sim ticks.
    fight(sim, 2 * REGEN_TICK);
    sim.castAbility('cat_form');

    expect(inCat(p)).toBe(true);
    expect(p.resource).toBe(2 * PARKED_ENERGY_REGEN_PER_TICK);
  });

  it('regenerates the parked pool all the way back to full', () => {
    const { sim, p } = feralDruid();
    fight(sim, 1);
    sim.castAbility('cat_form');
    fight(sim, 40);
    p.resource = 0;
    sim.cancelAura('cat_form');

    fight(sim, 12 * REGEN_TICK);
    sim.castAbility('cat_form');

    expect(p.resource).toBe(CAT_ENERGY_MAX);
  });

  it('does not refill through a Cat to Bruin to Cat powershift either', () => {
    const { sim, p } = feralDruid();
    fight(sim, 1);
    sim.castAbility('cat_form');
    fight(sim, 40);
    p.resource = 0;

    sim.castAbility('bear_form');
    expect(p.resourceType).toBe('rage');
    // Any 40 consecutive sim ticks hold exactly one classic regen tick.
    fight(sim, REGEN_TICK);
    sim.castAbility('cat_form');

    expect(inCat(p)).toBe(true);
    expect(p.resource).toBe(PARKED_ENERGY_REGEN_PER_TICK);
  });

  it('still hands a fresh druid a full bar on the first shift of a fight', () => {
    const { sim, p } = feralDruid();
    fight(sim, 1);
    sim.castAbility('cat_form');
    expect(p.resource).toBe(CAT_ENERGY_MAX);
  });

  it('still hands over a full bar on any shift out of combat (the friendly opener)', () => {
    const { sim, p } = feralDruid();
    sim.castAbility('cat_form');
    rest(sim, 40);
    p.resource = 0;
    sim.cancelAura('cat_form');
    expect(p.inCombat).toBe(false);

    sim.castAbility('cat_form');

    expect(p.resource).toBe(CAT_ENERGY_MAX);
  });

  it('is deterministic', () => {
    const run = () => {
      const { sim, p } = feralDruid();
      fight(sim, 1);
      sim.castAbility('cat_form');
      fight(sim, 40);
      p.resource = 13;
      sim.cancelAura('cat_form');
      fight(sim, 57);
      sim.castAbility('cat_form');
      return [p.resource, p.resourceType, p.parkedEnergyDeficit ?? 0];
    };
    expect(run()).toEqual(run());
  });
});

describe('parked Cat energy: the edges', () => {
  it('pins the base tick at 20 and matches staying in Cat over the same window', () => {
    expect(PARKED_ENERGY_REGEN_PER_TICK).toBe(20);
    const stayer = feralDruid();
    const leaver = feralDruid();
    for (const { sim, p } of [stayer, leaver]) {
      fight(sim, 1);
      sim.castAbility('cat_form');
      fight(sim, 40);
      p.resource = 0;
    }
    leaver.sim.cancelAura('cat_form');
    fight(stayer.sim, 2 * REGEN_TICK);
    fight(leaver.sim, 2 * REGEN_TICK);
    leaver.sim.castAbility('cat_form');
    expect(leaver.p.resource).toBe(stayer.p.resource);
    expect(leaver.p.resource).toBe(40);
  });

  it('never parks anything for a rogue, whose bar is energy without a form', () => {
    const sim = new Sim({ seed: 44, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    const p = sim.player;
    p.resource = 30;
    expect(sim.selectTalentRow(8, 'rog_r8_ghostfoot_ward')).toBe(true); // a stat recalc
    fight(sim, REGEN_TICK);
    expect(p.parkedEnergyDeficit).toBeUndefined();
    expect(p.resourceType).toBe('energy');
  });

  it('refills the parked pool on the arena top-off', () => {
    const { sim, p } = feralDruid();
    fight(sim, 1);
    sim.castAbility('cat_form');
    fight(sim, 40);
    p.resource = 10;
    sim.cancelAura('cat_form');
    expect(p.parkedEnergyDeficit).toBe(90);

    readyArenaFighter((sim as unknown as { ctx: never }).ctx, p, { clearPrep: true });

    expect(p.parkedEnergyDeficit).toBe(0);
    fight(sim, 1);
    sim.castAbility('cat_form');
    expect(p.resource).toBe(CAT_ENERGY_MAX);
  });

  it('still lets Bruin Rush shift a caster druid mid-fight (its 0 cost vs an empty rage bar)', () => {
    const { sim, p } = feralDruid();
    spawnMob(sim, 14);
    fight(sim, 1);
    sim.castAbility('bear_charge');
    fight(sim, 5);
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(p.resourceType).toBe('rage');
  });
});

describe('Lunge from caster form is billed against the parked Cat energy', () => {
  it('refuses a mid-fight Lunge the parked pool cannot pay, without shifting', () => {
    const { sim, p } = feralDruid();
    fight(sim, 1);
    sim.castAbility('cat_form');
    fight(sim, 40);
    p.resource = 0;
    sim.cancelAura('cat_form');
    spawnMob(sim, 10);
    sim.drainEvents();

    // Slinkstrike action-replaces to Lunge out of stealth.
    sim.castAbility('pounce');

    expect(inCat(p)).toBe(false);
    expect(p.cooldowns.has('lunge')).toBe(false);
    const err = sim
      .drainEvents()
      .find((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
    expect(err?.text).toBe('Not enough energy!');
  });

  it('lets it through once the parked pool has regenerated the 40 it costs', () => {
    const { sim, p } = feralDruid();
    fight(sim, 1);
    sim.castAbility('cat_form');
    fight(sim, 40);
    p.resource = 0;
    sim.cancelAura('cat_form');
    spawnMob(sim, 10);
    fight(sim, 2 * REGEN_TICK); // parked pool: exactly 40

    sim.castAbility('pounce');

    expect(inCat(p)).toBe(true);
    expect(p.resource).toBe(0); // 40 handed over, 40 billed
  });
});

describe('cat_form_energy pure core', () => {
  const entity = (over: Partial<Entity> = {}) =>
    ({ inCombat: false, parkedEnergyDeficit: undefined, ...over }) as Pick<
      Entity,
      'inCombat' | 'parkedEnergyDeficit'
    >;

  it('parks the shortfall from full, clamped to the bar', () => {
    const e = entity();
    parkCatEnergy(e, 35);
    expect(e.parkedEnergyDeficit).toBe(65);
    parkCatEnergy(e, 140);
    expect(e.parkedEnergyDeficit).toBe(0);
    parkCatEnergy(e, -5);
    expect(e.parkedEnergyDeficit).toBe(CAT_ENERGY_MAX);
  });

  it('hands the full bar out of combat and the parked pool in combat', () => {
    expect(catFormEntryEnergy(entity({ parkedEnergyDeficit: 70 }))).toBe(CAT_ENERGY_MAX);
    expect(catFormEntryEnergy(entity({ inCombat: true, parkedEnergyDeficit: 70 }))).toBe(30);
    expect(catFormEntryEnergy(entity({ inCombat: true }))).toBe(CAT_ENERGY_MAX);
  });

  it('regenerates the parked pool one base tick at a time, never past full', () => {
    const e = entity({ parkedEnergyDeficit: 30 });
    regenParkedCatEnergy(e);
    expect(e.parkedEnergyDeficit).toBe(30 - PARKED_ENERGY_REGEN_PER_TICK);
    regenParkedCatEnergy(e);
    expect(e.parkedEnergyDeficit).toBe(0);
    regenParkedCatEnergy(e);
    expect(e.parkedEnergyDeficit).toBe(0);
  });

  it('clears the parked pool once it is handed over', () => {
    const e = entity({ inCombat: true, parkedEnergyDeficit: 55 });
    expect(takeCatFormEntryEnergy(e)).toBe(45);
    expect(e.parkedEnergyDeficit ?? 0).toBe(0);
  });
});
