// The Seeker Genesis Token promotional mount grant (server/seeker_mount_grant.ts):
// the pure reins grant against a real Sim, the join-time arm through
// GameServer.join carrying the ws_auth-stamped account fact, and the
// claim-success arm over live sessions. Ownership is the reins item in bags OR
// bank (src/sim/mounts.ts mountOwned), so the guard is that and no ledger.

// server/db.ts constructs a pg Pool at module load and throws if DATABASE_URL
// is unset. The pool never connects: every db-touching path here is mocked.
process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:9/unused';

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async (_accountId: number, questId: string) => ({
    completedQuestIds: [questId],
    mechChromaIds: [],
  })),
  grantAccountMechChroma: vi.fn(async (_accountId: number, chromaId: string) => ({
    completedQuestIds: [],
    mechChromaIds: [chromaId],
  })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountWeaponSkins: vi.fn(async (_accountId: number, skinIds: string[]) => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [...skinIds],
    weaponSkinLoadout: {},
  })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer } from '../../server/game';
import {
  applySeekerMountAtJoin,
  grantSeekerBoardIfMissing,
  grantSeekerMountToLiveSessions,
  SEEKER_MOUNT_KEY,
  SEEKER_REINS_ITEM_ID,
} from '../../server/seeker_mount_grant';
import { ITEMS } from '../../src/sim/data';
import { mountItemId, mountOwned } from '../../src/sim/mounts';
import { Sim } from '../../src/sim/sim';

function fakeWs() {
  return { readyState: 1, send: vi.fn(), close: vi.fn() } as any;
}

function expectJoined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  return result;
}

function freshSim(): { sim: Sim; pid: number } {
  const sim = new Sim({ seed: 3628, playerClass: 'warrior', playerName: 'Seekertest' });
  return { sim, pid: sim.playerId };
}

describe('grantSeekerBoardIfMissing (the pure grant)', () => {
  it('names the catalog reins whose mount is the board, and the reins cannot leave', () => {
    // The guard reads mountOwned, which only holds if the reins can never be
    // anywhere but this character's bags or bank: every transfer and destroy
    // rail is closed at the item layer.
    // Literal on purpose: the export derives from the catalog so the grant and
    // the guard agree, and this line keeps that derivation honest.
    expect(SEEKER_REINS_ITEM_ID).toBe('reins_seeker_board');
    expect(mountItemId(SEEKER_MOUNT_KEY)).toBe(SEEKER_REINS_ITEM_ID);
    const reins = ITEMS[SEEKER_REINS_ITEM_ID];
    expect(reins).toMatchObject({
      kind: 'mount',
      mount: SEEKER_MOUNT_KEY,
      soulbound: true,
      noDiscard: true,
      noVendorSell: true,
      noMarketList: true,
    });
  });

  it('grants exactly one reins, and never a second while the first is in the bags', () => {
    const { sim, pid } = freshSim();
    const meta = sim.meta(pid)!;
    expect(mountOwned(meta, SEEKER_MOUNT_KEY)).toBe(false);

    expect(grantSeekerBoardIfMissing(sim, pid), 'first grant applies').toBe(true);
    expect(sim.countItem(SEEKER_REINS_ITEM_ID, pid)).toBe(1);
    expect(mountOwned(meta, SEEKER_MOUNT_KEY)).toBe(true);

    expect(grantSeekerBoardIfMissing(sim, pid), 'second grant is a no-op').toBe(false);
    expect(sim.countItem(SEEKER_REINS_ITEM_ID, pid)).toBe(1);
  });

  it('counts a BANKED reins as owned (bags-only countItem would re-grant every login)', () => {
    const { sim, pid } = freshSim();
    const meta = sim.meta(pid)!;
    expect(grantSeekerBoardIfMissing(sim, pid)).toBe(true);
    // Park the reins in the bank: the slot moves containers, nothing is minted.
    const idx = meta.inventory.findIndex((s) => s.itemId === SEEKER_REINS_ITEM_ID);
    expect(idx).toBeGreaterThanOrEqual(0);
    meta.bank.inventory.push(meta.inventory[idx]);
    meta.inventory.splice(idx, 1);
    expect(sim.countItem(SEEKER_REINS_ITEM_ID, pid), 'bags are empty of it').toBe(0);

    expect(grantSeekerBoardIfMissing(sim, pid), 'banked still owns').toBe(false);
    expect(sim.countItem(SEEKER_REINS_ITEM_ID, pid)).toBe(0);
    expect(meta.bank.inventory.filter((s) => s.itemId === SEEKER_REINS_ITEM_ID)).toHaveLength(1);
  });

  it('goes through the inventory hub: the deed ledger discovers the reins', () => {
    const { sim, pid } = freshSim();
    const meta = sim.meta(pid)!;
    expect(meta.deedStats.itemsDiscovered.has(SEEKER_REINS_ITEM_ID)).toBe(false);
    grantSeekerBoardIfMissing(sim, pid);
    expect(meta.deedStats.itemsDiscovered.has(SEEKER_REINS_ITEM_ID)).toBe(true);
  });

  it('answers false for an unknown player rather than throwing', () => {
    const { sim } = freshSim();
    expect(grantSeekerBoardIfMissing(sim, 999_999)).toBe(false);
  });
});

describe('applySeekerMountAtJoin (the fresh-join arm)', () => {
  it('grants only for an entitled account fact, never for absent or false', () => {
    for (const fact of [undefined, false] as const) {
      const { sim, pid } = freshSim();
      applySeekerMountAtJoin(sim, pid, fact, 'Seekertest', 100);
      expect(sim.countItem(SEEKER_REINS_ITEM_ID, pid), String(fact)).toBe(0);
    }
    const { sim, pid } = freshSim();
    applySeekerMountAtJoin(sim, pid, true, 'Seekertest', 100);
    expect(sim.countItem(SEEKER_REINS_ITEM_ID, pid)).toBe(1);
  });

  it('never fails the join: a throwing sim is logged and swallowed', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const broken = {
        meta: () => {
          throw new Error('sim exploded');
        },
      } as unknown as Sim;
      expect(() => applySeekerMountAtJoin(broken, 1, true, 'Seekertest', 100)).not.toThrow();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('grantSeekerMountToLiveSessions (the claim-success arm)', () => {
  it('grants into every live session on the account, saves each, and skips other accounts', async () => {
    const { sim, pid } = freshSim();
    const alt = sim.addPlayer('rogue', 'Seekeralt');
    const other = sim.addPlayer('mage', 'Bystander');
    const sessions = [
      { accountId: 1, pid, name: 'Seekertest' },
      { accountId: 2, pid: other, name: 'Bystander' },
      { accountId: 1, pid: alt, name: 'Seekeralt' },
    ];
    const save = vi.fn(async () => true);

    // EVERY session on the account, not the first one found (a GM, or a
    // linkdead sibling, can hold two).
    expect(grantSeekerMountToLiveSessions(sessions, 1, sim, save)).toBe(2);
    expect(sim.countItem(SEEKER_REINS_ITEM_ID, pid)).toBe(1);
    expect(sim.countItem(SEEKER_REINS_ITEM_ID, alt)).toBe(1);
    expect(sim.countItem(SEEKER_REINS_ITEM_ID, other), 'other account untouched').toBe(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(1, sessions[0]);
    expect(save).toHaveBeenNthCalledWith(2, sessions[2]);

    // Idempotent: a second push grants nothing and saves nothing.
    expect(grantSeekerMountToLiveSessions(sessions, 1, sim, save)).toBe(0);
    expect(save).toHaveBeenCalledTimes(2);
    // Offline account: a no-op (the join arm is the backstop).
    expect(grantSeekerMountToLiveSessions(sessions, 3, sim, save)).toBe(0);
  });

  it('a grant that throws for one session is logged and the next session still gets its reins', () => {
    const { sim, pid } = freshSim();
    const alt = sim.addPlayer('rogue', 'Seekeralt');
    // A sim whose meta() read explodes for ONE pid only; everything else is real.
    const flaky = {
      meta: (id: number) => {
        if (id === pid) throw new Error('sim exploded');
        return sim.meta(id);
      },
      addItem: (...args: Parameters<Sim['addItem']>) => sim.addItem(...args),
    } as unknown as Sim;
    const save = vi.fn(async () => true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const sessions = [
        { accountId: 1, pid, name: 'Seekertest' },
        { accountId: 1, pid: alt, name: 'Seekeralt' },
      ];
      expect(grantSeekerMountToLiveSessions(sessions, 1, flaky, save)).toBe(1);
      expect(sim.countItem(SEEKER_REINS_ITEM_ID, alt)).toBe(1);
      expect(sim.countItem(SEEKER_REINS_ITEM_ID, pid)).toBe(0);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith(sessions[1]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs a fenced or failing save and never throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fenced = freshSim();
      const fencedSessions = [{ accountId: 1, pid: fenced.pid, name: 'Fenced' }];
      expect(grantSeekerMountToLiveSessions(fencedSessions, 1, fenced.sim, async () => false)).toBe(
        1,
      );
      await Promise.resolve();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain('re-grants at the next login');

      const failing = freshSim();
      const failingSessions = [{ accountId: 1, pid: failing.pid, name: 'Failing' }];
      expect(
        grantSeekerMountToLiveSessions(failingSessions, 1, failing.sim, async () => {
          throw new Error('db down');
        }),
      ).toBe(1);
      await Promise.resolve();
      await Promise.resolve();
      expect(errorSpy).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('GameServer.join (the arm wired into the real join)', () => {
  it('hands an entitled account the reins at join, and a plain join gets nothing', () => {
    const entitled = new GameServer();
    const session = expectJoined(
      entitled.join(fakeWs(), 10, 100, 'Seekerjoin', 'warrior', null, false, {
        seekerEntitled: true,
      }),
    );
    expect(mountOwned(entitled.sim.meta(session.pid)!, SEEKER_MOUNT_KEY)).toBe(true);
    expect(entitled.sim.countItem(SEEKER_REINS_ITEM_ID, session.pid)).toBe(1);

    // The composition that costs a duplicate on every login if it regresses:
    // the saved state hydrates BEFORE the grant runs, so a returning owner
    // (reins in the bags, or parked in the bank) is a no-op at the next join.
    const saved = entitled.sim.serializeCharacter(session.pid);
    expect(saved).toBeTruthy();
    const again = new GameServer();
    const back = expectJoined(
      again.join(fakeWs(), 10, 100, 'Seekerjoin', 'warrior', saved, false, {
        seekerEntitled: true,
      }),
    );
    expect(again.sim.countItem(SEEKER_REINS_ITEM_ID, back.pid)).toBe(1);
    const bankedMeta = again.sim.meta(back.pid)!;
    const idx = bankedMeta.inventory.findIndex((s) => s.itemId === SEEKER_REINS_ITEM_ID);
    bankedMeta.bank.inventory.push(bankedMeta.inventory[idx]);
    bankedMeta.inventory.splice(idx, 1);
    const banked = again.sim.serializeCharacter(back.pid);
    const third = new GameServer();
    const fromBank = expectJoined(
      third.join(fakeWs(), 10, 100, 'Seekerjoin', 'warrior', banked, false, {
        seekerEntitled: true,
      }),
    );
    expect(third.sim.countItem(SEEKER_REINS_ITEM_ID, fromBank.pid), 'bags stay empty').toBe(0);
    expect(mountOwned(third.sim.meta(fromBank.pid)!, SEEKER_MOUNT_KEY), 'banked owns').toBe(true);

    const plain = new GameServer();
    const plainSession = expectJoined(plain.join(fakeWs(), 11, 101, 'Plainjoin', 'warrior', null));
    expect(mountOwned(plain.sim.meta(plainSession.pid)!, SEEKER_MOUNT_KEY)).toBe(false);

    // The live push over the server's own session map reaches the plain
    // character and is a no-op for the one that already owns the reins.
    expect(
      grantSeekerMountToLiveSessions(plain.clients.values(), 11, plain.sim, (s) =>
        plain.saveCharacter(s),
      ),
    ).toBe(1);
    expect(plain.sim.countItem(SEEKER_REINS_ITEM_ID, plainSession.pid)).toBe(1);
    expect(
      grantSeekerMountToLiveSessions(entitled.clients.values(), 10, entitled.sim, (s) =>
        entitled.saveCharacter(s),
      ),
    ).toBe(0);
  });
});
