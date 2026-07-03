import { describe, expect, it } from 'vitest';
import { COMBO_PIP_MAX, comboPipsFor } from '../src/render/nameplate_combo';
import { Sim } from '../src/sim/sim';

function makeWorld() {
  const sim = new Sim({ seed: 42, playerClass: 'rogue', noPlayer: true });
  const pid = sim.addPlayer('rogue', 'Aleph');
  const foe = sim.addPlayer('warrior', 'Bet');
  sim.tick();
  return { player: sim.entities.get(pid)!, foe: sim.entities.get(foe)! };
}

// Combo points are character-bound (retail-style): the nameplate pips follow the
// player's CURRENT target (the entity the next finisher spends them on), not the
// entity the points were built against.
describe('comboPipsFor', () => {
  it('lights one pip per combo point on the current target', () => {
    const { player, foe } = makeWorld();
    player.comboPoints = 3;
    player.targetId = foe.id;
    expect(comboPipsFor(player, foe)).toBe(3);
  });

  it('follows a target swap: the new target shows the banked points', () => {
    const { player, foe } = makeWorld();
    player.comboPoints = 4;
    player.targetId = player.id; // points banked, looking elsewhere
    expect(comboPipsFor(player, foe)).toBe(0);
    player.targetId = foe.id; // swap onto foe: the pool follows
    expect(comboPipsFor(player, foe)).toBe(4);
  });

  it('shows nothing when no points are built', () => {
    const { player, foe } = makeWorld();
    player.comboPoints = 0;
    player.targetId = foe.id;
    expect(comboPipsFor(player, foe)).toBe(0);
  });

  it('clears pips once the target is dead', () => {
    const { player, foe } = makeWorld();
    player.comboPoints = 5;
    player.targetId = foe.id;
    foe.dead = true;
    expect(comboPipsFor(player, foe)).toBe(0);
  });

  it('never exceeds the pip cap even on a transient overshoot', () => {
    const { player, foe } = makeWorld();
    player.comboPoints = 99;
    player.targetId = foe.id;
    expect(comboPipsFor(player, foe)).toBe(COMBO_PIP_MAX);
  });
});
