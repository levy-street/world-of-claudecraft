import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { duelInfoFor } from '../src/sim/social/duel';

describe('duel info projection', () => {
  it('projects both opponents and immediately hides an ended duel', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const a = sim.player.id;
    const b = sim.addPlayer('mage', 'Opponent');
    expect(sim.duelInfo).toBeNull();
    const duel = { a, b, state: 'countdown', timer: 3, controlled: new Map() } as const;
    sim.ctx.duels.set(a, duel);
    sim.ctx.duels.set(b, duel);
    expect(sim.duelInfo).toEqual({ otherPid: b, otherName: 'Opponent', state: 'countdown' });
    expect(duelInfoFor(sim.ctx, b)).toEqual({
      otherPid: a,
      otherName: sim.players.get(a)!.name,
      state: 'countdown',
    });
    sim.ctx.duels.get(a)!.endedTick = sim.tickCount;
    expect(sim.duelInfo).toBeNull();
  });
});
