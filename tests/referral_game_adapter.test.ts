import { expect, it, vi } from 'vitest';
import type { ClientSession } from '../server/game';
import { type ReferralAdapterHost, ReferralGameAdapter } from '../server/referral_game_adapter';
import type { ReferralGameHost } from '../server/referral_game_services';
import type { ReferralRewardDeliveryHost } from '../server/referral_reward_delivery';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

const captured = vi.hoisted(() => ({
  host: null as ReferralGameHost | null,
  delivery: null as ReferralRewardDeliveryHost | null,
  command: (): Promise<void> => Promise.resolve(),
}));
vi.mock('../server/db', () => ({ pool: {} }));
vi.mock('../server/referral_store_db', () => ({
  PgReferralStore: class {
    async accountRewards() {
      return 0;
    }
  },
}));
vi.mock('../server/referral_game_services', () => ({
  ReferralGameServices: class {
    constructor(host: ReferralGameHost) {
      captured.host = host;
    }
    attach() {}
    updateEntitlements() {}
    command() {
      return captured.command();
    }
    stop() {}
  },
}));
vi.mock('../server/referral_character_save_db', () => ({
  saveReferralCharacter: vi.fn(),
  saveOfflineReferralCharacter: vi.fn(),
}));
vi.mock('../server/referral_reward_delivery', () => ({
  ReferralRewardDelivery: class {
    constructor(host: ReferralRewardDeliveryHost) {
      captured.delivery = host;
    }
    attach() {}
    async stop() {}
  },
}));
vi.mock('../server/referral_invites_db', () => ({ getOrCreateReferralInvite: vi.fn() }));

it('the production adapter refuses reward mutations during an established trade', async () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const a = sim.addPlayer('warrior', 'One');
  const b = sim.addPlayer('priest', 'Two');
  const actor = { pid: a, characterId: 100, accountId: 10 } as ClientSession;
  const conflict = vi.fn(() => false);
  const adapter = new ReferralGameAdapter({
    sim,
    session: () => actor,
    conflict,
  } as unknown as ReferralAdapterHost);
  expect(captured.host!.conflict(100)).toBe(false);
  sim.tradeRequest(b, a);
  sim.tradeAccept(b);
  expect(sim.ctx.trades.has(a)).toBe(true);
  expect(captured.host!.conflict(100)).toBe(true);
  sim.tradeCancel(a);
  expect(captured.host!.conflict(100)).toBe(false);
  conflict.mockReturnValue(true);
  expect(captured.host!.conflict(100)).toBe(true);
  await adapter.stop();
});

it('selects the bound friend character in the acting party when both old and new characters are online', async () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const sessions = [10, 20, 20].map((accountId, i) => {
    const characterId = 100 + i;
    const pid = sim.addPlayer('warrior', `Player${i}`, { characterId });
    sim.meta(pid)!.accountId = accountId;
    sim.syncBuddyOwnershipFor(pid, ['sapling']);
    return { pid, accountId, characterId, left: false, escrowQuarantined: false } as ClientSession;
  });
  const [actor, old, replacement] = sessions;
  sim.partyInvite(replacement.pid, actor.pid);
  sim.partyAccept(replacement.pid);
  const adapter = new ReferralGameAdapter({
    sim,
    session: (id: number) => sessions.find((s) => s.characterId === id) ?? null,
    withPermit: async (run: () => Promise<unknown>) => run(),
    observeCost: () => {},
  } as unknown as ReferralAdapterHost);
  for (const session of sessions) adapter.attach(session);
  const partyId = captured.host!.character(actor)!.partyId!;
  expect(captured.host!.sessionForAccount(20, old.characterId)).toBe(old);
  expect(captured.host!.sessionForAccount(20, old.characterId, partyId)).toBe(replacement);
  await Promise.resolve();
  await adapter.stop();
});

it('bills a full 25-recipient outbox projection through the production adapter', async () => {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const sessions = Array.from({ length: 25 }, (_, i) => {
    const characterId = 500 + i,
      accountId = 1000 + i;
    const pid = sim.addPlayer('warrior', `Friend${i}`, { characterId });
    sim.meta(pid)!.accountId = accountId;
    sim.syncBuddyOwnershipFor(pid, ['sapling']);
    return { pid, characterId, accountId, left: false, escrowQuarantined: false } as ClientSession;
  });
  const costs: number[] = [];
  const adapter = new ReferralGameAdapter({
    sim,
    session: (id: number) => sessions.find((s) => s.characterId === id) ?? null,
    withPermit: async (run: () => Promise<unknown>) => run(),
    observeCost: (ms: number) => costs.push(ms),
  } as unknown as ReferralAdapterHost);
  for (const session of sessions) adapter.attach(session);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const previousRecipient = sessions[0];
  sim.meta(previousRecipient.pid)!.referralInviterRewards = 3;
  sim.addItem('reins_referral_raptor', 1, previousRecipient.pid);
  for (let replay = 0; replay < 2; replay++) {
    captured.delivery!.applyEntitlements(previousRecipient.accountId, 16);
    expect([...sim.ownedBuddiesFor(previousRecipient.pid)].sort()).toEqual(['sapling', 'sprites']);
  }
  costs.length = 0;
  for (const session of sessions.slice(1))
    expect(sim.ownedBuddiesFor(session.pid)).not.toContain('sprites');
  for (const session of sessions) captured.delivery!.applyEntitlements(session.accountId, 19);
  expect(costs).toHaveLength(25);
  for (const session of sessions) {
    const state = sim.serializeCharacter(session.pid)!;
    expect(state.inventory.some((item) => item.itemId === 'reins_referral_raptor')).toBe(true);
    expect([...sim.ownedBuddiesFor(session.pid)].sort()).toEqual(['sapling', 'sprites']);
    expect(sim.meta(session.pid)!.bankBonusSources).toContainEqual({
      id: 'referral_cards',
      slots: 20,
      maxSlots: 20,
    });
  }
  process.stdout.write(
    JSON.stringify({
      referralProjection: {
        recipients: costs.length,
        totalMs: costs.reduce((a, b) => a + b, 0),
        maxMs: Math.max(...costs),
      },
    }) + '\n',
  );
  await adapter.stop();
});

it('logs a rejected card command instead of leaking an unhandled rejection', async () => {
  // A page request while the account friend index is still warming rejects
  // after scheduling its own retry; the adapter's fire-and-forget entry point
  // must catch it, or Node sees an unhandled rejection on a live realm.
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Pager', { characterId: 700 });
  const session = {
    pid,
    characterId: 700,
    accountId: 70,
    left: false,
    escrowQuarantined: false,
  } as ClientSession;
  const adapter = new ReferralGameAdapter({
    sim,
    session: () => session,
    withPermit: async (run: () => Promise<unknown>) => run(),
    observeCost: () => {},
  } as unknown as ReferralAdapterHost);
  const failure = new Error('Account friend index is not ready');
  captured.command = () => Promise.reject(failure);
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    adapter.command(session, { type: 'page', after: 0 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
    expect(logged).toHaveBeenCalledWith('referral card operation failed:', failure);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    logged.mockRestore();
    captured.command = () => Promise.resolve();
    await adapter.stop();
  }
});
