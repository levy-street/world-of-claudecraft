import { describe, expect, it, vi } from 'vitest';
import type { BankLedgerOutboxSnapshot } from '../../server/bank_ledger_outbox';
import {
  claimVaultRewardForSession,
  type VaultDirectClaimHost,
} from '../../server/vault_direct_claim_host';
import type { VaultRewardClaim } from '../../server/vault_rewards_db';
import type { RiftInstance } from '../../src/sim/rift/types';
import { Sim } from '../../src/sim/sim';

function fixture() {
  const sim = new Sim({ seed: 52, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Owner', { characterId: 7 });
  sim.setPlayerLevel(20, pid);
  sim.riftInstances.push({ vault: { attemptId: '7:1', rarity: 'common' } } as RiftInstance);
  const state = sim.serializeCharacter(pid);
  if (!state) throw new Error('missing live character state');
  const session = {
    pid,
    characterId: 7,
    left: false,
    escrowQuarantined: false,
    lastSave: 0,
  };
  const host: VaultDirectClaimHost = {
    sim,
    enqueue: async (_id, job) => job(),
    session: () => session,
    mailTakeLocked: () => false,
    hasSaveConflict: () => false,
    serialize: () => ({
      level: 20,
      state,
      storageEffects: [],
      bankLedgerSnapshot: {} as BankLedgerOutboxSnapshot,
    }),
    withPermit: async (run) => run(),
    acknowledge: vi.fn(() => true),
    quarantine: vi.fn(),
  };
  const claim: VaultRewardClaim = {
    characterId: 7,
    recipientName: 'Owner',
    items: [{ itemId: 'thorium_ore', count: 2 }],
    copper: 19,
    mailDueAt: new Date().toISOString(),
  };
  return { sim, pid, session, host, claim };
}

describe('live vault direct-claim adapter', () => {
  it('projects one committed reward into the live character and acknowledges the save', async () => {
    const f = fixture();
    const before = f.sim.meta(f.pid)!.copper;
    const commit = vi.fn(async () => 'delivered' as const);
    expect(await claimVaultRewardForSession(f.host, '7:1', f.claim, true, commit)).toBe(
      'delivered',
    );
    expect(commit).toHaveBeenCalledOnce();
    expect(f.host.acknowledge).toHaveBeenCalledOnce();
    expect(f.sim.meta(f.pid)?.copper).toBe(before + 19);
    expect(f.sim.countItem('thorium_ore', f.pid)).toBe(2);
    expect(f.session.lastSave).toBeGreaterThan(0);
    expect(f.host.quarantine).not.toHaveBeenCalled();
  });

  it('quarantines a fenced or unprojectable committed claim', async () => {
    const fenced = fixture();
    expect(
      await claimVaultRewardForSession(
        fenced.host,
        '7:1',
        fenced.claim,
        true,
        async () => 'lease_lost',
      ),
    ).toBe('lease_lost');
    expect(fenced.host.quarantine).toHaveBeenCalledWith(fenced.pid, 7, 'fenced', 'vault reward');
    const ambiguous = fixture();
    ambiguous.host.acknowledge = () => false;
    await expect(
      claimVaultRewardForSession(
        ambiguous.host,
        '7:1',
        ambiguous.claim,
        true,
        async () => 'delivered',
      ),
    ).rejects.toThrow('live projection unavailable');
    expect(ambiguous.host.quarantine).toHaveBeenCalledWith(
      ambiguous.pid,
      7,
      'ambiguous',
      'vault reward projection',
    );
  });
});
