import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import {
  CRAFT_CAST_ID,
  DISENCHANT_CAST_ID,
  ENCHANT_CAST_ID,
  FISHING_CAST_ID,
  GATHER_CAST_ID,
  SALVAGE_CAST_ID,
  type SimEvent,
  TOOL_RECHARGE_CAST_ID,
} from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'mage', noPlayer: true });
}

function errorText(events: SimEvent[]): string | undefined {
  return events.find((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')?.text;
}

function casting(sim: Sim, pid: number): string | undefined {
  sim.chat('/casting', pid);
  return errorText(sim.tick());
}

describe('/casting command', () => {
  it('reports nothing when the player is idle', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    expect(casting(sim, a)).toBe('You are not casting anything.');
  });

  it('reports a normal cast with the ability name and fractional times', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.castingAbility = 'fireball';
    e.castTotal = 2.5;
    e.castRemaining = 1.8;
    e.channeling = false;
    expect(casting(sim, a)).toBe('Casting Cinderbolt — 1.8s of 2.5s remaining.');
  });

  it('uses "Channeling" for a channelled spell', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.castingAbility = 'arcane_missiles';
    e.castTotal = 6.0;
    e.castRemaining = 4.2;
    e.channeling = true;
    expect(casting(sim, a)).toBe('Channeling Aether Darts — 4.2s of 6.0s remaining.');
  });

  it('special-cases the fishing sentinel with no countdown (no bite leak)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.castingAbility = FISHING_CAST_ID;
    e.castTotal = 15.0;
    e.castRemaining = 3.1;
    e.channeling = false;
    // The fixed-cast countdown died with the bite minigame; the
    // readout names the waiting state and deliberately prints NO seconds
    // (a countdown would leak session timing). The old grandfathered em dash
    // died with the reword (repo no-dash rule).
    expect(casting(sim, a)).toBe('You are fishing. Waiting for a bite.');
  });

  it('special-cases the gathering sentinel with an honest countdown', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.castingAbility = GATHER_CAST_ID;
    e.castTotal = 2.5;
    e.castRemaining = 1.8;
    e.channeling = false;
    // The gather cast is public state (castRemaining/castTotal broadcast),
    // so its readout keeps the fractional countdown.
    expect(casting(sim, a)).toBe('You are gathering: 1.8s of 2.5s remaining.');
  });

  // The five profession sentinels (Craft Cast System). Each is a non-spell
  // cast with no ABILITIES row, so a missing arm here falls through to the
  // generic "Casting <name>" tail and prints the raw sentinel id at the player.
  // Exact literals, one per kind, because that fallback still reads like a
  // sentence and only the wording tells the two apart.
  it('names the crafting sentinel with its countdown', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.castingAbility = CRAFT_CAST_ID;
    e.castTotal = 2.5;
    e.castRemaining = 1.8;
    e.channeling = false;
    expect(casting(sim, a)).toBe('You are crafting: 1.8s of 2.5s remaining.');
  });

  it('names the disenchanting sentinel with its countdown', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.castingAbility = DISENCHANT_CAST_ID;
    e.castTotal = 3.0;
    e.castRemaining = 0.5;
    e.channeling = false;
    expect(casting(sim, a)).toBe('You are disenchanting: 0.5s of 3.0s remaining.');
  });

  it('names the enchant-apply sentinel as enchanting, not by its id', () => {
    // The sentinel id is 'enchanting_apply'; the readout says "enchanting", so
    // a dropped arm would surface the id itself in the fallback tail.
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.castingAbility = ENCHANT_CAST_ID;
    e.castTotal = 4.0;
    e.castRemaining = 2.4;
    e.channeling = false;
    expect(casting(sim, a)).toBe('You are enchanting: 2.4s of 4.0s remaining.');
  });

  it('names the salvaging sentinel with its countdown', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.castingAbility = SALVAGE_CAST_ID;
    e.castTotal = 2.0;
    e.castRemaining = 1.2;
    e.channeling = false;
    expect(casting(sim, a)).toBe('You are salvaging: 1.2s of 2.0s remaining.');
  });

  it('names the tool-recharge sentinel by what it is recharging', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.castingAbility = TOOL_RECHARGE_CAST_ID;
    e.castTotal = 6.0;
    e.castRemaining = 3.7;
    e.channeling = false;
    expect(casting(sim, a)).toBe('You are recharging a tool effect: 3.7s of 6.0s remaining.');
  });

  it('responds to the /cast and /castbar aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    sim.chat('/cast', a);
    expect(errorText(sim.tick())).toBe('You are not casting anything.');
    sim.chat('/castbar', a);
    expect(errorText(sim.tick())).toBe('You are not casting anything.');
  });
});
