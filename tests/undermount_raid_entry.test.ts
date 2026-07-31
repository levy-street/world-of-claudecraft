import { describe, expect, it } from 'vitest';
import { enterDungeon, instanceKeyFor } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';

describe('Undermount raid entry', () => {
  it('allows a raid group to enter wing 1', () => {
    const sim = new Sim({ seed: 99, playerClass: 'warrior', noPlayer: true });
    const leaderPid = sim.addPlayer('warrior', 'Tank');
    for (let i = 0; i < 4; i++) {
      const pid = sim.addPlayer('mage', `D${i}`);
      sim.partyInvite(pid, leaderPid);
      sim.partyAccept(pid);
    }
    sim.convertPartyToRaid(leaderPid);

    enterDungeon(sim.ctx, 'undermount_wing1', leaderPid);

    const partyKey = instanceKeyFor(sim.ctx, leaderPid);
    expect(
      sim.instances.some(
        (instance) => instance.dungeonId === 'undermount_wing1' && instance.partyKey === partyKey,
      ),
    ).toBe(true);
  });
});
