// Server-side dispatch coverage for the Founder Salesman's two commands
// (claim_founder_pack, claim_founder_skin): the real on-chain $WOC wallet
// gate (server/woc_balance.ts cachedWocBalance, against server/db.ts
// walletForAccount's linked pubkey), the one-time whole-pack claim, the
// mount-pick and skin-pick budgets, the class restriction on skin picks, and
// the mail/deed/title side effects. tests/founder_pack.test.ts covers the
// offline Sim refusal arm and the pure content tables; this file covers the
// server dispatch (server/game.ts 'claim_founder_pack' / 'claim_founder_skin')
// that only exists online.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';

const walletForAccount = vi.fn(async (_accountId: number) => null as { pubkey: string } | null);
const claimAccountFounderPackTier = vi.fn(
  async (_accountId: number, tier: 'uncommon' | 'rare' | 'epic', claudium: number) => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
    mountSkinIds: [],
    founderSkinIds: [] as string[],
    founderPackTier: tier,
    founderPackClaudium: claudium,
  }),
);
const grantAccountFounderSkin = vi.fn(async (_accountId: number, skinId: string) => ({
  completedQuestIds: [],
  mechChromaIds: [],
  weaponSkinIds: [],
  weaponSkinLoadout: {},
  mountSkinIds: [],
  founderSkinIds: [skinId],
  founderPackTier: 'uncommon' as const,
  founderPackClaudium: 1000,
}));

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: (...args: unknown[]) => walletForAccount(...(args as [number])),
  loadAccountFlair: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountWeaponSkins: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
    mountSkinIds: [],
  })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
    mountSkinIds: [],
  })),
  grantAccountMountSkins: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
    mountSkinIds: [],
  })),
  claimAccountFounderPackTier: (...args: unknown[]) =>
    claimAccountFounderPackTier(...(args as [number, 'uncommon' | 'rare' | 'epic', number])),
  grantAccountFounderSkin: (...args: unknown[]) =>
    grantAccountFounderSkin(...(args as [number, string])),
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  setCharacterHotbarLayout: vi.fn(async () => {}),
}));

const cachedWocBalance = vi.fn(async (_pubkey: string, _fresh?: boolean) => null as number | null);
vi.mock('../server/woc_balance', () => ({
  cachedWocBalance: (...args: unknown[]) => cachedWocBalance(...(args as [string, boolean?])),
  holderInfoForPubkey: vi.fn(async () => null),
}));

import { type ClientSession, GameServer } from '../server/game';

function fakeWs() {
  return { readyState: 1, send: vi.fn(), close: vi.fn() } as unknown as WebSocket & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}

function expectJoined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  return result;
}

const baseCosmetics = () => ({
  completedQuestIds: [],
  mechChromaIds: [],
  weaponSkinIds: [],
  weaponSkinLoadout: {},
  mountSkinIds: [],
  founderSkinIds: [] as string[],
  founderPackTier: null as 'uncommon' | 'rare' | 'epic' | null,
  founderPackClaudium: 0,
});

function claimPack(
  server: GameServer,
  session: ClientSession,
  tier: unknown,
  mountPicks: unknown,
  rid = 1,
) {
  server.handleMessage(
    session,
    JSON.stringify({ t: 'cmd', rid, cmd: 'claim_founder_pack', tier, mountPicks }),
  );
}

function claimSkin(server: GameServer, session: ClientSession, catalog: unknown, rid = 1) {
  server.handleMessage(
    session,
    JSON.stringify({ t: 'cmd', rid, cmd: 'claim_founder_skin', catalog }),
  );
}

function lastOutcome(ws: ReturnType<typeof fakeWs>): boolean | undefined {
  const calls = ws.send.mock.calls as unknown[][];
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const frame = JSON.parse(String(calls[i][0])) as { t?: string; ok?: boolean };
    if (frame.t === 'commandOutcome') return frame.ok;
  }
  return undefined;
}

describe('GameServer Founder Pack commands', () => {
  beforeEach(() => {
    walletForAccount.mockReset().mockResolvedValue(null);
    cachedWocBalance.mockReset().mockResolvedValue(null);
    claimAccountFounderPackTier.mockClear();
    grantAccountFounderSkin.mockClear();
  });

  it('refuses the whole-pack claim with no linked wallet', async () => {
    const ws = fakeWs();
    const server = new GameServer();
    const session = expectJoined(
      server.join(ws, 11, 101, 'Founder', 'priest', null, false, {
        accountCosmetics: baseCosmetics(),
      }),
    );
    claimPack(server, session, 'uncommon', ['cinderjaw_rex']);
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(false));
    expect(claimAccountFounderPackTier).not.toHaveBeenCalled();
    expect(session.accountCosmetics.founderPackTier).toBeNull();
  });

  it('refuses the whole-pack claim when the linked wallet balance is below the tier threshold', async () => {
    walletForAccount.mockResolvedValue({ pubkey: 'pub1' });
    cachedWocBalance.mockResolvedValue(999_999); // one under the uncommon 1,000,000 floor
    const ws = fakeWs();
    const server = new GameServer();
    const session = expectJoined(
      server.join(ws, 11, 101, 'Founder', 'priest', null, false, {
        accountCosmetics: baseCosmetics(),
      }),
    );
    claimPack(server, session, 'uncommon', ['cinderjaw_rex']);
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(false));
    expect(claimAccountFounderPackTier).not.toHaveBeenCalled();
  });

  it('accepts the whole-pack claim at exactly the threshold, mails the mount reins and bag, grants the deed and title', async () => {
    walletForAccount.mockResolvedValue({ pubkey: 'pub1' });
    cachedWocBalance.mockResolvedValue(1_000_000); // exact floor
    const ws = fakeWs();
    const server = new GameServer();
    const session = expectJoined(
      server.join(ws, 11, 101, 'Founder', 'priest', null, false, {
        accountCosmetics: baseCosmetics(),
      }),
    );
    claimPack(server, session, 'uncommon', ['cinderjaw_rex']);
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(true));
    expect(claimAccountFounderPackTier).toHaveBeenCalledWith(11, 'uncommon', 1000);
    expect(session.accountCosmetics.founderPackTier).toBe('uncommon');

    const meta = server.sim.meta(session.pid);
    if (!meta) throw new Error('missing meta');
    expect(meta.deedsEarned.has('feat_founder_emberborn')).toBe(true);
    expect(meta.activeTitle).toBe('feat_founder_emberborn');
    expect(server.sim.ctx.mailboxHoldsItem(meta, 'founder_reins_cinderjaw_rex')).toBe(true);
    expect(server.sim.ctx.mailboxHoldsItem(meta, 'founder_bag_phantom')).toBe(true);
    // Neither of the other two mounts' reins were mailed (only the pick).
    expect(server.sim.ctx.mailboxHoldsItem(meta, 'founder_reins_ancient_devourer')).toBe(false);
    expect(server.sim.ctx.mailboxHoldsItem(meta, 'founder_reins_shiba_inu')).toBe(false);
  });

  it('refuses a second whole-pack claim once a tier is already on the account', async () => {
    walletForAccount.mockResolvedValue({ pubkey: 'pub1' });
    cachedWocBalance.mockResolvedValue(10_000_000);
    const ws = fakeWs();
    const server = new GameServer();
    const session = expectJoined(
      server.join(ws, 11, 101, 'Founder', 'priest', null, false, {
        accountCosmetics: { ...baseCosmetics(), founderPackTier: 'uncommon' },
      }),
    );
    claimPack(server, session, 'epic', ['cinderjaw_rex', 'ancient_devourer', 'shiba_inu']);
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(false));
    expect(claimAccountFounderPackTier).not.toHaveBeenCalled();
  });

  it('refuses a mount-pick count that does not match the tier budget, and a duplicate pick', async () => {
    walletForAccount.mockResolvedValue({ pubkey: 'pub1' });
    cachedWocBalance.mockResolvedValue(10_000_000);
    const ws = fakeWs();
    const server = new GameServer();
    const session = expectJoined(
      server.join(ws, 11, 101, 'Founder', 'priest', null, false, {
        accountCosmetics: baseCosmetics(),
      }),
    );
    // uncommon wants exactly 1 pick: 2 is refused before any wallet check runs
    // (join() itself calls walletForAccount once, for the holder-tier
    // refresh, so the count is reset here rather than asserted at zero).
    walletForAccount.mockClear();
    claimPack(server, session, 'uncommon', ['cinderjaw_rex', 'ancient_devourer'], 1);
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(false));
    expect(walletForAccount).not.toHaveBeenCalled();
    // A duplicate id in a 1-pick claim also fails the distinctness check.
    claimPack(server, session, 'uncommon', ['cinderjaw_rex', 'cinderjaw_rex'], 2);
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(false));
  });

  it('refuses an unknown tier and an unknown mount key', async () => {
    walletForAccount.mockResolvedValue({ pubkey: 'pub1' });
    cachedWocBalance.mockResolvedValue(10_000_000);
    const ws = fakeWs();
    const server = new GameServer();
    const session = expectJoined(
      server.join(ws, 11, 101, 'Founder', 'priest', null, false, {
        accountCosmetics: baseCosmetics(),
      }),
    );
    claimPack(server, session, 'mythic', ['cinderjaw_rex'], 1);
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(false));
    claimPack(server, session, 'uncommon', ['valorsteed'], 2); // a real mount, not a Founder Pack pick
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(false));
    expect(claimAccountFounderPackTier).not.toHaveBeenCalled();
  });

  it('refuses a class-matched, unowned skin pick once the tier budget is exhausted', async () => {
    const ws = fakeWs();
    const server = new GameServer();
    const session = expectJoined(
      server.join(ws, 11, 101, 'Founder', 'warrior', null, false, {
        // Uncommon's budget is 3; already at 3 distinct picks.
        accountCosmetics: {
          ...baseCosmetics(),
          founderPackTier: 'uncommon',
          founderSkinIds: ['altherion', 'bonehunter', 'eclipse_wildheart'],
        },
      }),
    );
    // boneforged is the warrior skin (class-matched, not yet owned) but the
    // budget is spent.
    claimSkin(server, session, 'boneforged', 1);
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(false));
    expect(grantAccountFounderSkin).not.toHaveBeenCalled();
  });

  it('grants a class-matched skin pick within budget, refuses a wrong-class pick, and a repeat', async () => {
    const ws = fakeWs();
    const server = new GameServer();
    const session = expectJoined(
      server.join(ws, 11, 101, 'Founder', 'priest', null, false, {
        // Already holding an uncommon tier (skinPicks: 3), no skins picked yet.
        accountCosmetics: { ...baseCosmetics(), founderPackTier: 'uncommon' },
      }),
    );
    // altherion is the priest skin: matches this character's class.
    claimSkin(server, session, 'altherion', 1);
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(true));
    expect(grantAccountFounderSkin).toHaveBeenCalledWith(11, 'altherion');
    expect(session.accountCosmetics.founderSkinIds).toEqual(['altherion']);

    // boneforged is restricted to warrior; this character is a priest.
    grantAccountFounderSkin.mockClear();
    claimSkin(server, session, 'boneforged', 2);
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(false));
    expect(grantAccountFounderSkin).not.toHaveBeenCalled();

    // Re-claiming the same skin (already owned per the mocked db round trip) is refused.
    claimSkin(server, session, 'altherion', 3);
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(false));
  });

  it('refuses a skin pick with no pack claimed yet, and an unknown catalog id', async () => {
    const ws = fakeWs();
    const server = new GameServer();
    const session = expectJoined(
      server.join(ws, 11, 101, 'Founder', 'priest', null, false, {
        accountCosmetics: baseCosmetics(),
      }),
    );
    claimSkin(server, session, 'altherion', 1);
    await vi.waitFor(() => expect(lastOutcome(ws)).toBe(false));
    expect(grantAccountFounderSkin).not.toHaveBeenCalled();

    const claimedSession = expectJoined(
      server.join(fakeWs(), 12, 102, 'Founder2', 'priest', null, false, {
        accountCosmetics: { ...baseCosmetics(), founderPackTier: 'uncommon' },
      }),
    );
    claimSkin(server, claimedSession, 'not_a_real_skin', 1);
    expect(grantAccountFounderSkin).not.toHaveBeenCalled();
  });
});
