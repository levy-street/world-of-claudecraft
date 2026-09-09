import { describe, expect, it, vi } from 'vitest';
import { groundTelegraphWireJson, groundTelegraphWorld } from '../server/ground_telegraph_wire';
import { decodeRunesOfPower } from '../src/net/ground_telegraph_wire';
import { petOf, summonPet } from '../src/sim/pet/pet_commands';
import { Sim } from '../src/sim/sim';
import { bareClient } from './helpers/bare_client';
import { EMPTY_TEST_WORLD } from './sim_shared';

function placed() {
  const sim = new Sim({
    seed: 147,
    playerClass: 'mage',
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('frost')).toBe(true);
  expect(sim.selectTalentRow(20, 'mag_r20_rune_of_power')).toBe(true);
  sim.player.pos = sim.groundPos(700, 0);
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.resource = sim.player.maxResource;
  sim.castAbility('rune_of_power');
  for (let i = 0; i < 50 && sim.activeRunesOfPower.length === 0; i++) sim.tick();
  expect(sim.activeRunesOfPower).toHaveLength(1);
  return sim;
}
function wire(sim: Sim, x: number, viewerId = sim.playerId) {
  return JSON.parse(
    `{"t":"snap","ents":[]${groundTelegraphWireJson(groundTelegraphWorld(sim, 50, 90), { x, z: 0 }, 500, viewerId)}}`,
  );
}

describe('Rune of Power authoritative field and benefit eligibility', () => {
  it('matches a real friendly pet pulse even when line of sight is blocked', () => {
    const sim = placed(),
      hunterId = sim.addPlayer('hunter', 'Friendly hunter');
    const hunter = sim.entities.get(hunterId)!;
    hunter.pos = sim.groundPos(702, 0);
    hunter.prevPos = { ...hunter.pos };
    summonPet(sim.ctx, hunter, 'forest_wolf');
    const pet = petOf(sim.ctx, hunterId)!;
    expect(pet).toBeDefined();
    pet.pos = sim.groundPos(703, 0);
    pet.prevPos = { ...pet.pos };
    const sight = vi.spyOn(sim.ctx, 'hasLineOfSight').mockReturnValue(false);
    try {
      expect(sim.runeOfPowerDispositionFor(sim.playerId, pet.id)).toBe('eligible');
      for (let i = 0; i < 45; i++) sim.tick();
      expect(pet.auras.find((a) => a.id === 'rune_of_power')?.value).toBe(0.1);
    } finally {
      sight.mockRestore();
    }
  });
  it('projects real placement without consuming RNG or changing pulses, and permits nonparty friends', () => {
    const sim = placed(),
      row = sim.activeRunesOfPower[0];
    expect(row).toMatchObject({
      sourceId: sim.playerId,
      x: 700,
      radius: 8,
      duration: 15,
      disposition: 'eligible',
    });
    expect(sim.player.auras.find((a) => a.id === 'rune_of_power')?.value).toBe(0.1);
    const friend = sim.addPlayer('warrior', 'Friendly');
    expect(sim.runeOfPowerDispositionFor(sim.playerId, friend)).toBe('eligible');
    const snapshot = JSON.stringify(sim.activeRunesOfPower);
    for (let i = 0; i < 10; i++) expect(JSON.stringify(sim.activeRunesOfPower)).toBe(snapshot);
    sim.player.jailed = true;
    sim.entities.get(friend)!.jailed = true;
    expect(wire(sim, 700, friend).runesOfPower[0].disposition).toBe('opponent');
  });

  it('keeps a dead caster field until its real expiry and restores eligibility on revival', () => {
    const sim = placed(),
      other = sim.addPlayer('warrior', 'Viewer');
    sim.player.dead = true;
    sim.player.hp = 0;
    sim.tick();
    expect(wire(sim, 700, other).runesOfPower[0].disposition).toBe('inactive');
    const remaining = sim.activeRunesOfPower[0].remaining;
    sim.player.dead = false;
    sim.player.hp = sim.player.maxHp;
    expect(wire(sim, 700, other).runesOfPower[0].disposition).toBe('eligible');
    expect(sim.activeRunesOfPower[0].remaining).toBe(remaining);
    for (let i = 0; i < 350; i++) sim.tick();
    expect(sim.activeRunesOfPower).toEqual([]);
  });

  it('reconstructs a late arrival without the caster entity, respects exactly 90 yards and clears omission', () => {
    const sim = placed();
    for (let i = 0; i < 70; i++) sim.tick();
    const client = bareClient(sim.playerId);
    const receiver = client as unknown as {
      applySnapshot(snap: unknown): void;
    };
    const snap = wire(sim, 790);
    expect(snap.runesOfPower).toHaveLength(1);
    expect(wire(sim, 790.001).runesOfPower).toBeUndefined();
    receiver.applySnapshot(snap);
    expect(client.activeRunesOfPower[0]).toMatchObject({
      id: sim.activeRunesOfPower[0].id,
      disposition: 'eligible',
    });
    expect(client.activeRunesOfPower[0].remaining).toBeLessThan(12);
    receiver.applySnapshot({ t: 'snap', ents: [] });
    expect(client.activeRunesOfPower).toEqual([]);
  });

  it('keeps unknown legacy ownership conservative and rejects invalid field geometry', () => {
    const row = { id: 'opaque', x: 1, z: 2, r: 8, dur: 15, rem: 20 };
    expect(decodeRunesOfPower([row])[0]).toMatchObject({
      sourceId: null,
      disposition: 'unknown',
      remaining: 15,
    });
    for (const override of [{ r: 0 }, { rem: NaN }, { x: Infinity }, { id: '' }])
      expect(decodeRunesOfPower([{ ...row, ...override }])).toEqual([]);
  });
});
