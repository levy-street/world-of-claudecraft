import { describe, expect, it, vi } from 'vitest';
import type { BankLedgerOutboxSnapshot } from '../../server/bank_ledger_outbox';
import { commitVaultDirectClaim } from '../../server/vault_direct_claim';
import {
  claimVaultRewardForSession,
  type VaultDirectClaimHost,
} from '../../server/vault_direct_claim_host';
import { VaultRewardService } from '../../server/vault_reward_service';
import type { VaultRewardClaim, VaultRewardClient } from '../../server/vault_rewards_db';
import type { CharacterState } from '../../src/sim/character_state';
import { spendHeroicMarks } from '../../src/sim/heroic_marks';
import { spawnHoardRewardChest } from '../../src/sim/rift/hoard_reward_chest';
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
  it('auto-equips a prepared plain epic while retaining its committed identity', async () => {
    const f = fixture();
    const meta = f.sim.meta(f.pid)!;
    meta.autoEquip = true;
    delete meta.equipment.helmet;
    delete meta.equipmentInstance.helmet;
    f.claim.items = [{ itemId: 'slagbreaker_helmet', count: 1 }];
    let guid: string | undefined;
    const commit: typeof commitVaultDirectClaim = async (_deps, args) => {
      guid = args.preparedItems?.[0].instance?.guid;
      return 'delivered';
    };
    expect(await claimVaultRewardForSession(f.host, '7:1', f.claim, true, commit)).toBe(
      'delivered',
    );
    expect(typeof guid).toBe('string');
    expect(meta.equipment.helmet).toBe('slagbreaker_helmet');
    expect(f.sim.meta(f.pid)!.equipmentInstance.helmet?.guid).toBe(guid);
  });

  it('commits the exact tracked copies before granting or publishing their mint events', async () => {
    const f = fixture();
    const itemId = 'slagbreaker_helmet';
    f.sim.meta(f.pid)!.autoEquip = false;
    f.claim.items = [
      { itemId, count: 2, lootQuality: { version: 1, tier: 3, weights: [5, 4, 3, 2, 1] } },
    ];
    f.sim.drainEvents();
    const beforeClaim = structuredClone(f.claim);
    const client: VaultRewardClient = {
      query: vi.fn(async () => ({ rows: [{ character_id: 7 }], rowCount: 1 })),
      release: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    let saved: ReturnType<Sim['serializeCharacter']>;
    const save = vi.fn(async (_client: VaultRewardClient, state: CharacterState) => {
      saved = structuredClone(state);
      expect(f.sim.countItem(itemId, f.pid)).toBe(0);
      expect(f.sim.drainEvents().filter((e) => e.type === 'itemTracked')).toEqual([]);
      return true;
    });
    const commit: typeof commitVaultDirectClaim = (_deps, args) =>
      commitVaultDirectClaim({ pool: { connect: async () => client }, saveCharacter: save }, args);
    const next = vi.spyOn(f.sim.rng, 'next');
    expect(await claimVaultRewardForSession(f.host, '7:1', f.claim, true, commit)).toBe(
      'delivered',
    );
    expect(next).not.toHaveBeenCalled();
    next.mockRestore();
    const live = f.sim.serializeCharacter(f.pid)!;
    expect(saved!.inventory).toEqual(live.inventory);
    const copies = live.inventory.filter((s) => s.itemId === itemId);
    expect(copies).toHaveLength(2);
    const guids = copies.map((s) => s.instance?.guid);
    expect(new Set(guids).size).toBe(2);
    expect(guids.every((guid) => typeof guid === 'string')).toBe(true);
    const minted = f.sim.drainEvents().filter((e) => e.type === 'itemTracked');
    expect(minted.map((e) => e.guid)).toEqual(guids);
    expect(minted.every((e) => e.kind === 'mint')).toBe(true);
    expect(f.claim).toEqual(beforeClaim);
  });

  it.each(['retry', 'already_claimed', 'lease_lost'] as const)(
    'does not grant or publish speculative tracked copies on %s',
    async (result) => {
      const f = fixture();
      f.claim.items = [{ itemId: 'slagbreaker_helmet', count: 2 }];
      f.sim.drainEvents();
      const before = f.sim.serializeCharacter(f.pid);
      expect(
        await claimVaultRewardForSession(f.host, '7:1', f.claim, true, async () => result),
      ).toBe(result);
      expect(f.sim.serializeCharacter(f.pid)).toEqual(before);
      expect(f.sim.drainEvents().filter((e) => e.type === 'itemTracked')).toEqual([]);
    },
  );

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

describe('live vault direct claim capacity refusal', () => {
  it('keeps a full-balance claim retryable without connecting, saving or quarantining', async () => {
    const f = fixture();
    const meta = f.sim.meta(f.pid)!;
    meta.heroicMarks = Number.MAX_SAFE_INTEGER;
    const snap = f.host.serialize(7)!;
    snap.state.heroicMarks = Number.MAX_SAFE_INTEGER;
    f.claim.items.push({ itemId: 'heroic_mark', count: 1 });
    const stateBefore = structuredClone(snap.state);
    const claimBefore = structuredClone(f.claim);
    const client: VaultRewardClient = {
      query: vi.fn(async () => ({ rows: [{ character_id: 7 }], rowCount: 1 })),
      release: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const connect = vi.fn(async () => client);
    const save = vi.fn(async () => true);
    const commit: typeof commitVaultDirectClaim = (_deps, args) =>
      commitVaultDirectClaim({ pool: { connect }, saveCharacter: save }, args);
    const inst = f.sim.riftInstances.find((slot) => slot.vault?.attemptId === '7:1')!;
    const player = f.sim.entities.get(f.pid)!;
    spawnHoardRewardChest(f.sim.ctx, inst, [f.pid], player.pos);
    const chest = inst.vault!.chest!;
    f.sim.cfg.vaultRewardNeedsSave = true;
    const claimDirect = vi.fn((attemptId: string, claim: VaultRewardClaim, owner: boolean) =>
      claimVaultRewardForSession(f.host, attemptId, claim, owner, commit),
    );
    const onClaimFailure = vi.fn();
    const service = new VaultRewardService(
      {
        sim: f.sim,
        withPermit: async (run) => run(),
        saveOwner: async () => true,
        claimDirect,
        characterPid: () => f.pid,
        onClaimFailure,
      },
      {
        deferVaultRewardClaim: vi.fn(async () => true),
        wakeOldestVaultRewardClaim: vi.fn(async () => null),
        commitVaultOutcome: vi.fn(),
        loadVaultOutcome: vi.fn(async () => ({
          attemptId: '7:1',
          ownerCharacterId: 7,
          claims: [f.claim],
          completedAt: new Date(),
        })),
        dueVaultRewardClaims: vi.fn(async () => []),
      },
    );
    const draws: number[] = [];
    f.sim.rng.setObserver((value) => draws.push(value));
    expect(f.sim.pickUpObject(chest.entityId, f.pid)).toBe(true);
    service.observe(f.sim.drainEvents());
    await vi.waitFor(() => expect(chest.claiming).toEqual([]));
    expect(chest.claimed).toEqual([]);
    expect(claimDirect).toHaveBeenCalledOnce();
    await expect(claimDirect.mock.results[0].value).resolves.toBe('retry');
    expect(connect).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(f.host.quarantine).not.toHaveBeenCalled();
    expect(f.host.acknowledge).not.toHaveBeenCalled();
    expect(snap.state).toEqual(stateBefore);
    expect(f.claim).toEqual(claimBefore);
    expect(f.sim.serializeCharacter(f.pid)?.heroicMarks).toBe(Number.MAX_SAFE_INTEGER);
    expect(spendHeroicMarks(meta, 1)).toBe(true);
    snap.state.heroicMarks = meta.heroicMarks;
    expect(f.sim.pickUpObject(chest.entityId, f.pid)).toBe(true);
    service.observe(f.sim.drainEvents());
    await vi.waitFor(() => expect(chest.claimed).toEqual([f.pid]));
    await expect(claimDirect.mock.results[1].value).resolves.toBe('delivered');
    expect(connect).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(f.host.acknowledge).toHaveBeenCalledOnce();
    expect(meta.heroicMarks).toBe(Number.MAX_SAFE_INTEGER);
    expect(f.sim.countItem('thorium_ore', f.pid)).toBe(2);
    expect(f.host.quarantine).not.toHaveBeenCalled();
    f.sim.pickUpObject(chest.entityId, f.pid);
    service.observe(f.sim.drainEvents());
    expect(claimDirect).toHaveBeenCalledTimes(2);
    expect(chest.claimed).toEqual([f.pid]);
    expect(draws).toEqual([]);
    expect(onClaimFailure).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'malformed', 'mixed_malformed'] as const)(
    'still quarantines a precommit %s error',
    async (kind) => {
      const f = fixture();
      if (kind === 'malformed')
        f.claim.items.push({ itemId: 'heroic_mark', count: Number.MAX_SAFE_INTEGER + 1 });
      if (kind === 'mixed_malformed') {
        f.host.serialize(7)!.state.heroicMarks = Number.MAX_SAFE_INTEGER;
        f.claim.items.push(
          { itemId: 'heroic_mark', count: 1 },
          { itemId: 'heroic_mark', count: Number.MAX_SAFE_INTEGER + 1 },
        );
      }
      const commit: typeof commitVaultDirectClaim =
        kind === 'unknown'
          ? async () => {
              throw new Error('unknown commit failure');
            }
          : commitVaultDirectClaim;
      await expect(
        claimVaultRewardForSession(f.host, '7:1', f.claim, true, commit),
      ).rejects.toThrow();
      expect(f.host.quarantine).toHaveBeenCalledWith(f.pid, 7, 'ambiguous', 'vault reward');
    },
  );
});

describe('live vault direct claim post-write ambiguity', () => {
  it('still quarantines a failed commit after the character save and claim write', async () => {
    const f = fixture();
    f.claim.items.push({ itemId: 'slagbreaker_helmet', count: 1 });
    f.sim.drainEvents();
    const before = f.sim.serializeCharacter(f.pid);
    const queries: string[] = [];
    const client: VaultRewardClient = {
      query: vi.fn(async (sql) => {
        queries.push(sql);
        if (sql === 'COMMIT') throw new Error('ambiguous commit');
        return { rows: [{ character_id: 7 }], rowCount: 1 };
      }),
      release: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const save = vi.fn(async () => true);
    const commit: typeof commitVaultDirectClaim = (_deps, args) =>
      commitVaultDirectClaim({ pool: { connect: async () => client }, saveCharacter: save }, args);
    await expect(claimVaultRewardForSession(f.host, '7:1', f.claim, true, commit)).rejects.toThrow(
      'ambiguous commit',
    );
    expect(save).toHaveBeenCalledOnce();
    expect(queries.some((sql) => sql.includes('UPDATE vault_reward_claims'))).toBe(true);
    expect(queries).toContain('COMMIT');
    expect(f.host.quarantine).toHaveBeenCalledWith(f.pid, 7, 'ambiguous', 'vault reward');
    expect(f.host.acknowledge).not.toHaveBeenCalled();
    expect(f.sim.serializeCharacter(f.pid)).toEqual(before);
    expect(f.sim.drainEvents().filter((e) => e.type === 'itemTracked')).toEqual([]);
  });
});
