import { afterEach, describe, expect, it, vi } from 'vitest';

const { persist } = vi.hoisted(() => ({ persist: vi.fn() }));
vi.mock('../../server/db', () => ({
  grantAccountMountSkins: persist,
  grantAccountWeaponSkins: vi.fn(),
  grantAccountMechChroma: vi.fn(),
  markAccountQuestComplete: vi.fn(),
  setAccountWeaponSkinLoadout: vi.fn(),
}));

import { EMPTY_LIVE_ACCOUNT_COSMETICS } from '../../server/account_cosmetics_live';
import { AccountCosmeticsService } from '../../server/account_cosmetics_service';
import { RETIRED_MOUNT_SKIN_IDS } from '../../src/sim/content/mount_skins';

const base = () => ({ ...EMPTY_LIVE_ACCOUNT_COSMETICS, mountSkinIds: [] as string[] });
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
afterEach(() => {
  vi.restoreAllMocks();
  persist.mockReset();
});

function setup() {
  const sessions = [1, 2].map((pid) => ({ pid, accountId: 7, accountCosmetics: base() }));
  const sim = {
    meta: () => null,
    entities: new Map(),
    setWeaponSkinLoadout: vi.fn(),
    setMountSkin: vi.fn(),
  };
  const service = new AccountCosmeticsService({
    sim: () => sim as never,
    sessions: () => sessions,
    resyncQuests: vi.fn(),
  });
  service.remember(7, base());
  return { service, sessions, sim };
}

describe('durable mount skin grants', () => {
  it('never turns a collectible reins projection into a permanent paid grant', () => {
    const { service } = setup();
    service.grantMountSkins(7, ['valorsteed', 'grag_bear']);
    expect(persist).not.toHaveBeenCalled();
  });
  it('never mirrors a retired skin the economy ledger still grants', () => {
    // The service's grant ledger keeps the Rallycart RXT rows as dormant data
    // after the skin left the catalog; the mirror filters them like any id the
    // registry does not carry, so no session ever owns something it cannot wear.
    const { service, sessions } = setup();
    service.grantMountSkins(7, [...RETIRED_MOUNT_SKIN_IDS, 'not_a_skin']);
    expect(persist).not.toHaveBeenCalled();
    expect(sessions.map((s) => s.accountCosmetics.mountSkinIds)).toEqual([[], []]);
  });

  it('coalesces repeated reconciliation and publishes only a durable grant to both characters', async () => {
    let finish!: (value: unknown) => void;
    persist.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { service, sessions } = setup();
    service.grantMountSkins(7, ['goblin_rocket_sled']);
    service.grantMountSkins(7, ['goblin_rocket_sled']);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(sessions.map((s) => s.accountCosmetics.mountSkinIds)).toEqual([[], []]);
    finish({ ...base(), mountSkinIds: ['goblin_rocket_sled'] });
    await flush();
    expect(sessions.map((s) => s.accountCosmetics.mountSkinIds)).toEqual([
      ['goblin_rocket_sled'],
      ['goblin_rocket_sled'],
    ]);
    service.grantMountSkins(7, ['goblin_rocket_sled']);
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it('retries a failed database grant on the next authoritative reconciliation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    persist
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue({ ...base(), mountSkinIds: ['goblin_rocket_sled'] });
    const { service, sessions } = setup();
    service.grantMountSkins(7, ['goblin_rocket_sled']);
    await flush();
    expect(sessions[0].accountCosmetics.mountSkinIds).toEqual([]);
    service.grantMountSkins(7, ['goblin_rocket_sled']);
    await flush();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(sessions[0].accountCosmetics.mountSkinIds).toEqual(['goblin_rocket_sled']);
  });
  it('does not undo a weapon loadout change while a mount grant is saving', async () => {
    let finish!: (value: unknown) => void;
    persist.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { service, sessions } = setup();
    service.grantMountSkins(7, ['goblin_rocket_sled']);
    service.updateLive(7, {
      ...base(),
      weaponSkinIds: ['ice_fang_sword'],
      weaponSkinLoadout: { sword: 'ice_fang_sword' },
    });
    finish({ ...base(), mountSkinIds: ['goblin_rocket_sled'] });
    await flush();
    expect(sessions[0].accountCosmetics.weaponSkinLoadout).toEqual({ sword: 'ice_fang_sword' });
  });
  it('rejects forged ownership and changes only the acting character', () => {
    const { service, sessions, sim } = setup();
    service.changeMountSkin(sessions[0], 'mech_bird');
    service.changeMountSkin(sessions[0], {});
    expect(sim.setMountSkin).not.toHaveBeenCalled();
    sessions[0].accountCosmetics = { ...base(), mountSkinIds: ['mech_bird'] };
    service.changeMountSkin(sessions[0], 'mech_bird');
    service.changeMountSkin(sessions[0], null);
    expect(sim.setMountSkin.mock.calls).toEqual([
      [1, 'mech_bird'],
      [1, null],
    ]);
  });
});

describe('replaceable collectible mount cosmetics', () => {
  it('fans revocation to indexed characters, updates simulation ownership, clears worn looks, and dirties snapshots', () => {
    const metas = new Map(
      [1, 2].map((pid) => [
        pid,
        {
          questsDone: new Set<string>(),
          questLog: new Map(),
          accountMountSkinIds: [] as readonly string[],
          mountSkinId: pid === 1 ? 'valorsteed' : 'mech_bird',
        },
      ]),
    );
    const sessions = [1, 2].map((pid) => ({
      pid,
      accountId: 7,
      accountCosmetics: { ...base(), mountSkinIds: ['mech_bird'] },
      selfHeavyDirty: false,
    }));
    const setMountSkin = vi.fn();
    const realmSessions = vi.fn(() => {
      throw new Error('indexed fanout must not scan realm');
    });
    const service = new AccountCosmeticsService({
      sim: () => ({ meta: (pid: number) => metas.get(pid), setMountSkin }) as never,
      sessions: realmSessions,
      resyncQuests: vi.fn(),
    });
    service.remember(7, sessions[0].accountCosmetics);
    service.setCollectibleMountSkins(7, ['valorsteed'], sessions);
    expect(metas.get(2)?.accountMountSkinIds).toEqual(['mech_bird', 'valorsteed']);
    expect(setMountSkin).not.toHaveBeenCalled();
    service.setCollectibleMountSkins(7, [], sessions);
    expect(setMountSkin).toHaveBeenCalledExactlyOnceWith(1, null);
    expect(sessions.map((session) => session.accountCosmetics.collectibleMountSkinIds)).toEqual([
      [],
      [],
    ]);
    expect(sessions.every((session) => session.selfHeavyDirty)).toBe(true);
    expect(metas.get(1)?.accountMountSkinIds).toEqual(['mech_bird']);
    expect(realmSessions).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
