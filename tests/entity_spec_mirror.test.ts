// Entity.specId, the render-only mirror of the chosen talent spec the
// mouseover tooltip reads (and the identity wire ships as `spc`). It is
// stamped by recalcPlayerStats, the pass every talent re-bake runs, so this
// drives the REAL Sim paths that change a spec (pick, switch, clear, loadout,
// restore on login) and checks the mirror follows each one, on the primary
// player AND a second player (the server hosts many players in one Sim).
import { describe, expect, it } from 'vitest';
import { classSpecs } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';

const newSim = () => new Sim({ seed: 11, playerClass: 'priest', autoEquip: false });

describe('Entity.specId mirror', () => {
  it('starts null for an unspecced character and follows every spec pick', () => {
    const sim = newSim();
    sim.setPlayerLevel(20);
    expect(sim.player.specId).toBeNull();
    const [first, second] = classSpecs('priest');
    expect(sim.setSpec(first)).toBe(true);
    expect(sim.player.specId).toBe(first);
    expect(sim.setSpec(second)).toBe(true);
    expect(sim.player.specId).toBe(second);
    // The mirror always equals the authority, never a stale copy.
    expect(sim.player.specId).toBe(sim.talentSpec);
  });

  it('follows a spec clear back to null', () => {
    const sim = newSim();
    sim.setPlayerLevel(20);
    sim.setSpec(classSpecs('priest')[0]);
    expect(sim.player.specId).not.toBeNull();
    expect(sim.setSpec(null)).toBe(true);
    expect(sim.player.specId).toBeNull();
    expect(sim.talentSpec).toBeNull();
  });

  it('keeps the spec across a talent respec, which retains the spec', () => {
    const sim = newSim();
    sim.setPlayerLevel(20);
    const spec = classSpecs('priest')[1];
    sim.setSpec(spec);
    sim.respec();
    expect(sim.player.specId).toBe(spec);
    expect(sim.player.specId).toBe(sim.talentSpec);
  });

  it('follows a loadout switch to the saved build', () => {
    const sim = newSim();
    sim.setPlayerLevel(20);
    const [a, b] = classSpecs('priest');
    sim.setSpec(a);
    const idxA = sim.saveLoadout('A', []);
    sim.setSpec(b);
    expect(sim.player.specId).toBe(b);
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(sim.switchLoadout(idxA)).toBe(true);
    expect(sim.player.specId).toBe(a);
  });

  it('is restored on login from the saved talents, for a second player in the same world', () => {
    const src = newSim();
    src.setPlayerLevel(20);
    const spec = classSpecs('priest')[2] ?? classSpecs('priest')[0];
    src.setSpec(spec);
    const state = src.serializeCharacter(src.playerId);
    if (!state) throw new Error('serializeCharacter returned no state');

    const host = new Sim({ seed: 12, playerClass: 'warrior', autoEquip: false });
    const pid = host.addPlayer('priest', 'Second', { state, autoEquip: false });
    expect(host.entities.get(pid)?.specId).toBe(spec);
    // Only the joined character carries it; the host's own unspecced warrior does not.
    expect(host.player.specId).toBeNull();
  });

  it('never stamps a mob (the shared entity default stays null)', () => {
    const template = Object.values(MOBS)[0];
    if (!template) throw new Error('no mob templates');
    const mob = createMob(1, template, 5, { x: 0, y: 0, z: 0 });
    expect(mob.specId).toBeNull();
  });

  it('is deterministic: the same seed and picks give the same mirror', () => {
    const run = () => {
      const sim = newSim();
      sim.setPlayerLevel(20);
      sim.setSpec(classSpecs('priest')[1]);
      for (let i = 0; i < 5; i++) sim.tick();
      return sim.player.specId;
    };
    expect(run()).toBe(run());
  });
});
