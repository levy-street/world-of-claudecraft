import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'hunter', noPlayer: true });
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

// Adopt a living wild mob as the player's pet: petOf() only requires a
// non-dead mob whose ownerId is the owner pid.
function givePet(sim: Sim, ownerPid: number): Entity {
  const mob = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && !e.dead && e.ownerId === null,
  )!;
  mob.ownerId = ownerPid;
  mob.hostile = false;
  mob.hp = mob.maxHp;
  return mob;
}

describe('/pettaunt command', () => {
  it('reports no pet when the player has none', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('hunter', 'Aleph');
    sim.tick();
    sim.chat('/pettaunt', a);
    expect(errorTexts(sim.tick())).toContain('You do not have a pet.');
  });

  it('reports Growl ready when the taunt timer is spent', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('hunter', 'Aleph');
    sim.tick();
    const pet = givePet(sim, a);
    pet.petTauntTimer = 0;
    sim.chat('/growl', a);
    expect(errorTexts(sim.tick())).toContain(`Your pet's Growl is ready. Auto-taunt is off.`);
  });

  it('reports when Growl autocast is enabled', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('hunter', 'Aleph');
    sim.tick();
    const pet = givePet(sim, a);
    pet.petTauntTimer = 0;
    sim.setPetAutoTaunt(true, a);
    sim.chat('/growl', a);
    expect(errorTexts(sim.tick())).toContain(`Your pet's Growl is ready. Auto-taunt is on.`);
  });

  it('reports remaining cooldown rounded up while Growl recharges', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('hunter', 'Aleph');
    sim.tick();
    const pet = givePet(sim, a);
    pet.petTauntTimer = 4.2;
    sim.chat('/petgrowl', a);
    expect(errorTexts(sim.tick())).toContain(
      `Your pet's Growl is on cooldown. Auto-taunt is off. Ready in 5s.`,
    );
  });
});
