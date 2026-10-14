import { describe, expect, it } from 'vitest';
import { addAccountPlayer } from '../../server/account_player_join';
import { Sim } from '../../src/sim/sim';

describe('trusted account player admission', () => {
  it('stamps authenticated identity after loading and never persists it', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = addAccountPlayer(
      sim,
      42,
      7,
      'warrior',
      'Aldric',
      {
        ...sim.serializeCharacter(sim.addPlayer('warrior', 'Saved'))!,
        accountId: 999,
        referralArmour: { inviterAccountId: 888, inviterName: 'Forged' },
      } as Parameters<typeof addAccountPlayer>[5],
      {},
    );
    expect(sim.meta(pid)?.accountId).toBe(42);
    expect(sim.meta(pid)?.referralArmour).toBeUndefined();
    expect(sim.serializeCharacter(pid)).not.toHaveProperty('accountId');
  });

  it('stamps new characters while preserving the trusted bank grant and tutorial state', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = addAccountPlayer(sim, 42, 7, 'warrior', 'Aldric', null, {
      bankBonus: { bonusSlots: 2, sources: [] },
    });
    expect(sim.meta(pid)?.accountId).toBe(42);
    expect(sim.meta(pid)?.bank.bonusSlots).toBe(2);
  });
});
