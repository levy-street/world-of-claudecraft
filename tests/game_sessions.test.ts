import { describe, expect, it, vi } from 'vitest';
import { HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { MECH_CHROMAS } from '../src/sim/content/skins';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const openPlaySession = vi.fn(async () => 1);
const closePlaySession = vi.fn(async () => {});
const markAccountQuestComplete = vi.fn(async (_accountId: number, questId: string) => ({
  completedQuestIds: [questId],
  mechChromaIds: [],
}));
const grantAccountMechChroma = vi.fn(async (_accountId: number, chromaId: string) => ({
  completedQuestIds: [],
  mechChromaIds: [chromaId],
}));
const revokeAccountMechChroma = vi.fn(async (_accountId: number, _chromaId: string) => ({
  completedQuestIds: [],
  mechChromaIds: [],
}));
const grantAccountWeaponSkins = vi.fn(async (_accountId: number, skinIds: string[]) => ({
  completedQuestIds: [],
  mechChromaIds: [],
  weaponSkinIds: [...skinIds],
  weaponSkinLoadout: {},
}));
const setAccountWeaponSkinLoadout = vi.fn(
  async (_accountId: number, loadout: Record<string, string>) => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: Object.values(loadout),
    weaponSkinLoadout: loadout,
  }),
);

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: (...args: unknown[]) => openPlaySession(...(args as [])),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: (...args: unknown[]) => closePlaySession(...(args as [])),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: (...args: unknown[]) =>
    markAccountQuestComplete(...(args as [number, string])),
  grantAccountMechChroma: (...args: unknown[]) =>
    grantAccountMechChroma(...(args as [number, string])),
  revokeAccountMechChroma: (...args: unknown[]) =>
    revokeAccountMechChroma(...(args as [number, string])),
  grantAccountWeaponSkins: (...args: unknown[]) =>
    grantAccountWeaponSkins(...(args as [number, string[]])),
  setAccountWeaponSkinLoadout: (...args: unknown[]) =>
    setAccountWeaponSkinLoadout(...(args as [number, Record<string, string>])),
  // Character load leases: leave() releases and the autosave loop heartbeats, so
  // these must exist on the mock or those paths throw on the undefined export.
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { saveCharacterAndMarketState, saveCharacterState } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';

function fakeWs() {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  } as any;
}

function expectJoined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  return result;
}

describe('GameServer sessions', () => {
  it('keeps dev quest completion commands gated behind ALLOW_DEV_COMMANDS', () => {
    const previous = process.env.ALLOW_DEV_COMMANDS;
    delete process.env.ALLOW_DEV_COMMANDS;
    try {
      const server = new GameServer();
      const session = expectJoined(server.join(fakeWs(), 11, 101, 'Nodev', 'warrior', null));

      server.handleMessage(
        session,
        JSON.stringify({ t: 'cmd', cmd: 'dev_complete_quest', quest: 'q_wolves' }),
      );

      expect(server.sim.meta(session.pid)?.questsDone.has('q_wolves')).toBe(false);
      expect(server.sim.meta(session.pid)?.questLog.has('q_wolves')).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = previous;
    }
  });

  it('applies account-wide quest lockouts when a character joins', () => {
    const server = new GameServer();
    const session = expectJoined(
      server.join(fakeWs(), 11, 101, 'Lockedout', 'warrior', null, false, {
        accountCosmetics: {
          completedQuestIds: ['q_aldrics_fallen_star'],
          mechChromaIds: [],
          weaponSkinIds: [],
          weaponSkinLoadout: {},
        },
      }),
    );

    expect(server.sim.questState('q_aldrics_fallen_star', session.pid)).toBe('done');
    expect(server.sim.meta(session.pid)?.questsDone.has('q_aldrics_fallen_star')).toBe(true);
  });

  it('marks Aldric quest completion account-wide when a character turns it in', () => {
    markAccountQuestComplete.mockClear();
    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Aldricdone', 'warrior', null));
    const meta = server.sim.meta(session.pid)!;
    const player = server.sim.entities.get(session.pid)!;
    const aldric = [...server.sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'brother_aldric_fen',
    )!;
    const pos = server.sim.groundPos(aldric.pos.x + 1, aldric.pos.z);
    player.pos = { ...pos };
    player.prevPos = { ...pos };
    meta.questLog.set('q_aldrics_fallen_star', {
      questId: 'q_aldrics_fallen_star',
      counts: [1],
      state: 'ready',
    });
    server.sim.addItem('unknown_alien_weaponry', 1, session.pid);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'turnin', quest: 'q_aldrics_fallen_star' }),
    );

    expect(markAccountQuestComplete).toHaveBeenCalledWith(11, 'q_aldrics_fallen_star');
    expect(session.accountCosmetics.completedQuestIds).toContain('q_aldrics_fallen_star');
    expect(server.sim.meta(session.pid)?.questsDone.has('q_aldrics_fallen_star')).toBe(true);
  });

  it('marks Aldric quest completion account-wide through the dev quest command', () => {
    const previous = process.env.ALLOW_DEV_COMMANDS;
    process.env.ALLOW_DEV_COMMANDS = '1';
    try {
      markAccountQuestComplete.mockClear();
      const server = new GameServer();
      const session = expectJoined(server.join(fakeWs(), 11, 101, 'Aldricdev', 'warrior', null));
      const meta = server.sim.meta(session.pid)!;
      meta.questLog.set('q_aldrics_fallen_star', {
        questId: 'q_aldrics_fallen_star',
        counts: [1],
        state: 'ready',
      });
      server.sim.addItem('unknown_alien_weaponry', 1, session.pid);

      server.handleMessage(
        session,
        JSON.stringify({ t: 'cmd', cmd: 'dev_complete_quest', quest: 'q_aldrics_fallen_star' }),
      );

      expect(markAccountQuestComplete).toHaveBeenCalledWith(11, 'q_aldrics_fallen_star');
      expect(session.accountCosmetics.completedQuestIds).toContain('q_aldrics_fallen_star');
      expect(server.sim.meta(session.pid)?.questsDone.has('q_aldrics_fallen_star')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = previous;
    }
  });

  it('stores the mech chroma on the account after claiming from the Aldric spinner item', () => {
    grantAccountMechChroma.mockClear();
    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Mechclaim', 'mage', null));
    const choice = MECH_CHROMAS.findIndex((chroma) => chroma.id === 'amber_crimson');
    expect(choice).toBeGreaterThanOrEqual(0);
    server.sim.addItem('alien_armor_plate', 1, session.pid);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'use', item: 'alien_armor_plate' }),
    );

    expect(grantAccountMechChroma).not.toHaveBeenCalled();
    expect(session.accountCosmetics.mechChromaIds).not.toContain(MECH_CHROMAS[choice].id);
    expect(server.sim.countItem('alien_armor_plate', session.pid)).toBe(1);
    expect(server.sim.entities.get(session.pid)?.skinCatalog).not.toBe('mech');

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'claim_event_skin', skin: choice }),
    );

    expect(grantAccountMechChroma).toHaveBeenCalledWith(11, MECH_CHROMAS[choice].id);
    expect(session.accountCosmetics.mechChromaIds).toContain(MECH_CHROMAS[choice].id);
    expect(server.sim.countItem('alien_armor_plate', session.pid)).toBe(0);
    expect(server.sim.entities.get(session.pid)?.skinCatalog).toBe('mech');
  });

  it('grantMechChromaToAccount persists the swag grant and pushes it to the live session', async () => {
    // The Discord swag-claim hook (configureDiscordRuntime wires the route's
    // grantCosmetic to this method): persist by account id, then best-effort push the
    // refreshed cosmetics onto any online session of that account.
    grantAccountMechChroma.mockClear();
    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Swaggrant', 'mage', null));
    expect(session.accountCosmetics.mechChromaIds).not.toContain('amber_crimson');

    server.grantMechChromaToAccount(11, 'amber_crimson');
    // The grant chain is fire-and-forget (void promise); flush the microtask queue.
    await new Promise((resolve) => setImmediate(resolve));

    expect(grantAccountMechChroma).toHaveBeenCalledWith(11, 'amber_crimson');
    expect(session.accountCosmetics.mechChromaIds).toContain('amber_crimson');
  });

  it('grantMechChromaToAccount still persists when the account has no live session (offline no-op push)', async () => {
    grantAccountMechChroma.mockClear();
    const server = new GameServer();

    server.grantMechChromaToAccount(42, 'amber_crimson');
    await new Promise((resolve) => setImmediate(resolve));

    // The durable grant runs regardless; with no online session the live push is a
    // no-op and nothing throws.
    expect(grantAccountMechChroma).toHaveBeenCalledWith(42, 'amber_crimson');
  });

  it('equips a live mech appearance only when the account owns the chroma', () => {
    const server = new GameServer();
    const allowed = expectJoined(
      server.join(fakeWs(), 11, 101, 'Mechwearer', 'shaman', null, false, {
        accountCosmetics: {
          completedQuestIds: [],
          mechChromaIds: ['amber_crimson'],
          weaponSkinIds: [],
          weaponSkinLoadout: {},
        },
      }),
    );
    const blocked = expectJoined(server.join(fakeWs(), 12, 102, 'Blockedmech', 'shaman', null));

    server.handleMessage(
      allowed,
      JSON.stringify({ t: 'cmd', cmd: 'change_skin', skin: 0, catalog: 'mech' }),
    );
    server.handleMessage(
      blocked,
      JSON.stringify({ t: 'cmd', cmd: 'change_skin', skin: 0, catalog: 'mech' }),
    );

    expect(server.sim.entities.get(allowed.pid)?.skinCatalog).toBe('mech');
    expect(server.sim.entities.get(blocked.pid)?.skinCatalog).not.toBe('mech');
  });

  it('unequips a mech chroma from every live character on the account and returns its item', () => {
    revokeAccountMechChroma.mockClear();
    const server = new GameServer();
    const cosmetics = {
      completedQuestIds: [],
      mechChromaIds: ['amber_crimson'],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
    };
    const first = expectJoined(
      server.join(fakeWs(), 11, 101, 'Mechone', 'shaman', null, false, {
        accountCosmetics: cosmetics,
      }),
    );
    // The second live character rides the GM exemption: the session cap allows
    // one non-GM character per account, and the account-wide sweep under test
    // is the same either way.
    const second = expectJoined(
      server.join(fakeWs(), 11, 102, 'Mechtwo', 'mage', null, true, {
        accountCosmetics: cosmetics,
      }),
    );

    server.handleMessage(
      first,
      JSON.stringify({ t: 'cmd', cmd: 'change_skin', skin: 0, catalog: 'mech' }),
    );
    server.handleMessage(
      second,
      JSON.stringify({ t: 'cmd', cmd: 'change_skin', skin: 0, catalog: 'mech' }),
    );
    server.handleMessage(
      first,
      JSON.stringify({ t: 'cmd', cmd: 'unequip_mech_chroma', chroma: 'amber_crimson' }),
    );

    expect(revokeAccountMechChroma).toHaveBeenCalledWith(11, 'amber_crimson');
    expect(first.accountCosmetics.mechChromaIds).not.toContain('amber_crimson');
    expect(second.accountCosmetics.mechChromaIds).not.toContain('amber_crimson');
    expect(server.sim.entities.get(first.pid)?.skinCatalog).toBe('class');
    expect(server.sim.entities.get(second.pid)?.skinCatalog).toBe('class');
    expect(server.sim.countItem('amber_crimson_armor_plate', first.pid)).toBe(1);
    expect(server.sim.countItem('amber_crimson_armor_plate', second.pid)).toBe(0);
  });

  it('keeps the character-id session index coherent across join, duplicate join, leave, and rejoin', async () => {
    const server = new GameServer();
    const first = expectJoined(server.join(fakeWs(), 11, 101, 'Indexa', 'warrior', null));
    const second = expectJoined(server.join(fakeWs(), 12, 102, 'Indexb', 'warrior', null));

    expect((server as any).sessionByCharacterId(101)).toBe(first);
    expect((server as any).sessionByCharacterId(102)).toBe(second);
    expect(server.join(fakeWs(), 13, 101, 'Indexa', 'warrior', null)).toEqual({
      error: 'character already in world',
    });

    await server.leave(first, 'test');

    expect((server as any).sessionByCharacterId(101)).toBeNull();
    expect((server as any).sessionByCharacterId(102)).toBe(second);

    const rejoined = expectJoined(server.join(fakeWs(), 13, 101, 'Indexa', 'warrior', null));
    expect((server as any).sessionByCharacterId(101)).toBe(rejoined);
  });

  it('blocks a fast relog until the disconnect save releases the character id', async () => {
    const server = new GameServer();
    const first = expectJoined(server.join(fakeWs(), 11, 101, 'Indexa', 'warrior', null));

    let resolveSave!: () => void;
    const slowSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    vi.mocked(saveCharacterAndMarketState).mockImplementationOnce(() => slowSave.then(() => true));

    const leaving = server.leave(first, 'test');
    await vi.waitFor(() => {
      expect(saveCharacterAndMarketState).toHaveBeenCalled();
    });

    expect((server as any).sessionByCharacterId(101)).toBe(first);
    expect(server.join(fakeWs(), 13, 101, 'Indexa', 'warrior', null)).toEqual({
      error: 'character already in world',
    });

    resolveSave();
    await leaving;

    expect((server as any).sessionByCharacterId(101)).toBeNull();
    const rejoined = expectJoined(server.join(fakeWs(), 13, 101, 'Indexa', 'warrior', null));
    expect((server as any).sessionByCharacterId(101)).toBe(rejoined);
  });

  it('cancels an active trade before the disconnect snapshot can yield', async () => {
    const server = new GameServer();
    const leaver = expectJoined(server.join(fakeWs(), 11, 101, 'Leaver', 'warrior', null));
    const stayer = expectJoined(server.join(fakeWs(), 12, 102, 'Stayer', 'mage', null));
    server.sim.addItem('wolf_fang', 1, leaver.pid);
    server.sim.tradeRequest(stayer.pid, leaver.pid);
    server.sim.tradeAccept(stayer.pid);
    server.sim.tradeSetOffer([{ itemId: 'wolf_fang', count: 1 }], 0, leaver.pid);
    server.sim.tradeConfirm(leaver.pid);

    let resolveSave!: () => void;
    const slowSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const savesBefore = vi.mocked(saveCharacterAndMarketState).mock.calls.length;
    vi.mocked(saveCharacterAndMarketState).mockImplementationOnce(() => slowSave.then(() => true));

    const leaving = server.leave(leaver, 'test');
    await vi.waitFor(() => {
      expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(savesBefore + 1);
    });

    // The counterparty must not be able to complete a non-escrowed trade after
    // the leaver's bags were serialized, otherwise both the save and recipient
    // retain the same item.
    server.handleMessage(stayer, JSON.stringify({ t: 'cmd', cmd: 'trade_confirm' }));
    const stateDuringSave = {
      tradeOpen: server.sim.tradeFor(stayer.pid) !== null,
      stayerItems: server.sim.countItem('wolf_fang', stayer.pid),
    };

    resolveSave();
    await leaving;

    expect(stateDuringSave).toEqual({ tradeOpen: false, stayerItems: 0 });
  });

  it('ignores commands from a session after its disconnect teardown starts', async () => {
    const server = new GameServer();
    const leaver = expectJoined(server.join(fakeWs(), 11, 101, 'Leaver', 'warrior', null));
    const stayer = expectJoined(server.join(fakeWs(), 12, 102, 'Stayer', 'mage', null));

    let resolveSave!: () => void;
    const slowSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const savesBefore = vi.mocked(saveCharacterAndMarketState).mock.calls.length;
    vi.mocked(saveCharacterAndMarketState).mockImplementationOnce(() => slowSave.then(() => true));

    const leaving = server.leave(leaver, 'test');
    await vi.waitFor(() => {
      expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(savesBefore + 1);
    });

    server.handleMessage(leaver, JSON.stringify({ t: 'cmd', cmd: 'trade_req', id: stayer.pid }));
    server.sim.tradeAccept(stayer.pid);
    const staleCommandOpenedTrade = server.sim.tradeFor(stayer.pid) !== null;

    resolveSave();
    await leaving;

    expect(staleCommandOpenedTrade).toBe(false);
  });

  it('forfeits pending loot rolls before the disconnect save can yield', async () => {
    const server = new GameServer();
    const leaver = expectJoined(server.join(fakeWs(), 11, 101, 'Leaver', 'warrior', null));
    const stayer = expectJoined(server.join(fakeWs(), 12, 102, 'Stayer', 'mage', null));
    const third = expectJoined(server.join(fakeWs(), 13, 103, 'Third', 'rogue', null));
    server.sim.partyInvite(stayer.pid, leaver.pid);
    server.sim.partyAccept(stayer.pid);
    server.sim.partyInvite(third.pid, leaver.pid);
    server.sim.partyAccept(third.pid);

    const mob = createMob(server.sim.nextId++, MOBS.forest_wolf, 2, { x: 0, y: 0, z: 0 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = leaver.pid;
    mob.lootRecipientIds = [leaver.pid, stayer.pid, third.pid];
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    server.sim.entities.set(mob.id, mob);
    const lateMob = createMob(server.sim.nextId++, MOBS.forest_wolf, 2, {
      x: 0,
      y: 0,
      z: 0,
    });
    lateMob.dead = true;
    lateMob.lootable = true;
    lateMob.tappedById = leaver.pid;
    lateMob.lootRecipientIds = [leaver.pid, stayer.pid, third.pid];
    lateMob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    server.sim.entities.set(lateMob.id, lateMob);
    server.sim.lootCorpse(mob.id, leaver.pid);
    const roll = server.sim.drainEvents().find((event) => event.type === 'lootRoll');
    if (!roll || roll.type !== 'lootRoll') throw new Error('expected pending loot roll');
    server.sim.submitLootRoll(roll.rollId, 'need', leaver.pid);
    // Existing roll stays need/greed, but any later corpse will use the
    // departing leader as its explicitly pinned master looter.
    server.sim.setPartyLootMaster(true, leaver.pid, 'uncommon', leaver.pid);

    let resolveSave!: () => void;
    const slowSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const savesBefore = vi.mocked(saveCharacterAndMarketState).mock.calls.length;
    vi.mocked(saveCharacterAndMarketState).mockImplementationOnce(() => slowSave.then(() => true));

    const leaving = server.leave(leaver, 'test');
    await vi.waitFor(() => {
      expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(savesBefore + 1);
    });

    // Resolve the roll while leave() is parked on its first persistence await.
    // The departing need choice must already be gone, otherwise this awards an
    // item after the leave snapshot and removePlayer later destroys it.
    server.sim.submitLootRoll(roll.rollId, 'pass', stayer.pid);
    server.sim.submitLootRoll(roll.rollId, 'pass', third.pid);
    expect(server.sim.countItem('greyjaw_hide_boots', leaver.pid)).toBe(0);
    expect(mob.loot?.items.find((slot) => slot.itemId === 'greyjaw_hide_boots')).toMatchObject({
      count: 1,
      openToAll: true,
    });

    // A corpse looted only after leave begins must not rehydrate the departing
    // pid from its death-time recipient snapshot or strand a brand-new master
    // roll on that departing leader. The two live candidates get Need/Greed.
    server.sim.lootCorpse(lateMob.id, stayer.pid);
    expect(server.sim.activeLootRolls(leaver.pid)).toHaveLength(0);
    expect(server.sim.activeLootRolls(stayer.pid)).toHaveLength(1);
    expect(server.sim.activeLootRolls(third.pid)).toHaveLength(1);
    const lateRoll = server.sim.activeLootRolls(stayer.pid)[0];
    server.sim.submitLootRoll(lateRoll.rollId, 'need', stayer.pid);
    server.sim.submitLootRoll(lateRoll.rollId, 'pass', third.pid);
    expect(server.sim.countItem('greyjaw_hide_boots', stayer.pid)).toBe(1);

    resolveSave();
    await leaving;
  });

  it('preserves corpse loot rights and strategy after the original tapper leaves', async () => {
    const server = new GameServer();
    const leaver = expectJoined(server.join(fakeWs(), 11, 101, 'Leaver', 'warrior', null));
    const stayer = expectJoined(server.join(fakeWs(), 12, 102, 'Stayer', 'mage', null));
    const third = expectJoined(server.join(fakeWs(), 13, 103, 'Third', 'rogue', null));
    server.sim.partyInvite(stayer.pid, leaver.pid);
    server.sim.partyAccept(stayer.pid);
    server.sim.partyInvite(third.pid, leaver.pid);
    server.sim.partyAccept(third.pid);

    const mob = createMob(server.sim.nextId++, MOBS.forest_wolf, 2, { x: 0, y: 0, z: 0 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = leaver.pid;
    mob.lootRecipientIds = [leaver.pid, stayer.pid, third.pid];
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    server.sim.entities.set(mob.id, mob);

    await server.leave(leaver, 'test');
    server.sim.lootCorpse(mob.id, stayer.pid);

    expect(server.sim.activeLootRolls(stayer.pid)).toHaveLength(1);
    expect(server.sim.activeLootRolls(third.pid)).toHaveLength(1);
    const roll = server.sim.activeLootRolls(stayer.pid)[0];
    server.sim.submitLootRoll(roll.rollId, 'need', stayer.pid);
    server.sim.submitLootRoll(roll.rollId, 'pass', third.pid);
    expect(server.sim.countItem('greyjaw_hide_boots', stayer.pid)).toBe(1);
  });

  it('excludes a departing player from heroic rewards after the leave snapshot', async () => {
    const server = new GameServer();
    const leaver = expectJoined(server.join(fakeWs(), 11, 101, 'Leaver', 'warrior', null));
    const stayer = expectJoined(server.join(fakeWs(), 12, 102, 'Stayer', 'mage', null));
    server.sim.partyInvite(stayer.pid, leaver.pid);
    server.sim.partyAccept(stayer.pid);
    server.sim.setDungeonDifficulty('heroic', leaver.pid);
    server.sim.enterDungeon('hollow_crypt', leaver.pid);
    server.sim.enterDungeon('hollow_crypt', stayer.pid);

    const inst = server.sim.ctx.instances.find(
      (slot) => slot.partyKey !== null && slot.dungeonId === 'hollow_crypt',
    );
    if (!inst) throw new Error('expected claimed heroic instance');
    expect(inst.difficulty).toBe('heroic');
    const boss = inst.mobIds
      .map((id) => server.sim.entities.get(id))
      .find((entity) => entity?.templateId === 'morthen');
    const leaverEntity = server.sim.entities.get(leaver.pid);
    const stayerEntity = server.sim.entities.get(stayer.pid);
    if (!boss || !leaverEntity || !stayerEntity) throw new Error('expected heroic actors');
    leaverEntity.pos = { x: boss.pos.x - 1, y: boss.pos.y, z: boss.pos.z };
    leaverEntity.prevPos = { ...leaverEntity.pos };
    stayerEntity.pos = { x: boss.pos.x + 1, y: boss.pos.y, z: boss.pos.z };
    stayerEntity.prevPos = { ...stayerEntity.pos };
    (server.sim as any).dealDamage(leaverEntity, boss, 10, false, 'physical', null, 'hit');
    expect(boss.tappedById).toBe(leaver.pid);
    const stayerPet = createMob(server.sim.nextId++, MOBS.forest_wolf, 2, {
      x: boss.pos.x + 2,
      y: boss.pos.y,
      z: boss.pos.z,
    });
    stayerPet.ownerId = stayer.pid;
    stayerPet.hostile = false;
    server.sim.entities.set(stayerPet.id, stayerPet);

    let resolveSave!: () => void;
    const slowSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const savesBefore = vi.mocked(saveCharacterAndMarketState).mock.calls.length;
    vi.mocked(saveCharacterAndMarketState).mockImplementationOnce(() => slowSave.then(() => true));

    const leaving = server.leave(leaver, 'test');
    await vi.waitFor(() => {
      expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(savesBefore + 1);
    });

    // A queued DoT tick from the departing player must not reacquire the tap
    // after preparePlayerLeave transferred it to the eligible stayer.
    (server.sim as any).dealDamage(leaverEntity, boss, 1, false, 'physical', null, 'hit');
    expect(boss.tappedById).toBe(stayer.pid);

    // Kill the final boss while leave() is parked after serializing the leaver.
    // No reward or lockout may mutate that stale, soon-to-be-discarded state.
    (server.sim as any).dealDamage(stayerPet, boss, boss.hp + 10, false, 'physical', null, 'hit');
    expect(boss.dead).toBe(true);
    expect({
      stayerMarks: server.sim.countItem(HEROIC_MARK_ITEM_ID, stayer.pid),
      leaverMarks: server.sim.countItem(HEROIC_MARK_ITEM_ID, leaver.pid),
      stayerLocked: server.sim.meta(stayer.pid)?.raidLockouts.has('hollow_crypt:heroic'),
      leaverLocked: server.sim.meta(leaver.pid)?.raidLockouts.has('hollow_crypt:heroic'),
    }).toEqual({
      stayerMarks: 1,
      leaverMarks: 0,
      stayerLocked: true,
      leaverLocked: false,
    });

    resolveSave();
    await leaving;
  });

  it("delegates a departing killer's fatal queued hit to the remaining heroic party", async () => {
    const server = new GameServer();
    const leaver = expectJoined(server.join(fakeWs(), 11, 101, 'Leaver', 'warrior', null));
    const stayer = expectJoined(server.join(fakeWs(), 12, 102, 'Stayer', 'mage', null));
    server.sim.partyInvite(stayer.pid, leaver.pid);
    server.sim.partyAccept(stayer.pid);
    server.sim.setDungeonDifficulty('heroic', leaver.pid);
    server.sim.enterDungeon('hollow_crypt', leaver.pid);
    server.sim.enterDungeon('hollow_crypt', stayer.pid);

    const inst = server.sim.ctx.instances.find(
      (slot) => slot.partyKey !== null && slot.dungeonId === 'hollow_crypt',
    );
    if (!inst) throw new Error('expected claimed heroic instance');
    const boss = inst.mobIds
      .map((id) => server.sim.entities.get(id))
      .find((entity) => entity?.templateId === 'morthen');
    const leaverEntity = server.sim.entities.get(leaver.pid);
    const stayerEntity = server.sim.entities.get(stayer.pid);
    if (!boss || !leaverEntity || !stayerEntity) throw new Error('expected heroic actors');
    leaverEntity.pos = { x: boss.pos.x - 1, y: boss.pos.y, z: boss.pos.z };
    leaverEntity.prevPos = { ...leaverEntity.pos };
    stayerEntity.pos = { x: boss.pos.x + 1, y: boss.pos.y, z: boss.pos.z };
    stayerEntity.prevPos = { ...stayerEntity.pos };
    (server.sim as any).dealDamage(leaverEntity, boss, 10, false, 'shadow', 'Leaving DoT', 'hit');
    expect(boss.tappedById).toBe(leaver.pid);

    let resolveSave!: () => void;
    const slowSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const savesBefore = vi.mocked(saveCharacterAndMarketState).mock.calls.length;
    vi.mocked(saveCharacterAndMarketState).mockImplementationOnce(() => slowSave.then(() => true));

    const leaving = server.leave(leaver, 'test');
    await vi.waitFor(() => {
      expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(savesBefore + 1);
    });

    (server.sim as any).dealDamage(
      leaverEntity,
      boss,
      boss.hp + 10,
      false,
      'shadow',
      'Leaving DoT',
      'hit',
      true,
    );
    const result = {
      bossDead: boss.dead,
      recipients: boss.lootRecipientIds,
      stayerMarks: server.sim.countItem(HEROIC_MARK_ITEM_ID, stayer.pid),
      leaverMarks: server.sim.countItem(HEROIC_MARK_ITEM_ID, leaver.pid),
      stayerLocked: server.sim.meta(stayer.pid)?.raidLockouts.has('hollow_crypt:heroic'),
      leaverLocked: server.sim.meta(leaver.pid)?.raidLockouts.has('hollow_crypt:heroic'),
    };

    resolveSave();
    await leaving;

    expect(result).toEqual({
      bossDead: true,
      recipients: [stayer.pid],
      stayerMarks: 1,
      leaverMarks: 0,
      stayerLocked: true,
      leaverLocked: false,
    });
  });

  it('retries failed disconnect saves before releasing the character for rejoin', async () => {
    vi.useFakeTimers();
    vi.mocked(saveCharacterAndMarketState).mockReset();
    vi.mocked(saveCharacterAndMarketState)
      .mockRejectedValueOnce(new Error('temporary database outage'))
      .mockRejectedValueOnce(new Error('temporary database outage'))
      .mockResolvedValueOnce(true);

    try {
      const server = new GameServer();
      const session = expectJoined(server.join(fakeWs(), 11, 101, 'Indexa', 'warrior', null));
      const leaving = server.leave(session, 'test');

      await vi.waitFor(() => {
        expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1);
      });
      expect(server.join(fakeWs(), 12, 101, 'Indexa', 'warrior', null)).toEqual({
        error: 'character already in world',
      });

      await vi.runOnlyPendingTimersAsync();
      await vi.waitFor(() => {
        expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(2);
      });

      await vi.runOnlyPendingTimersAsync();
      await leaving;

      expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(3);
      expect((server as any).sessionByCharacterId(101)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes overlapping saves for one character so an older write cannot land last', async () => {
    vi.mocked(saveCharacterState).mockReset();
    vi.mocked(saveCharacterState).mockResolvedValue(true);

    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Saverace', 'warrior', null));

    let resolveFirstSave!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve;
    });
    vi.mocked(saveCharacterState).mockImplementationOnce(() => firstSave.then(() => true));

    const first = server.saveCharacter(session);
    await vi.waitFor(() => {
      expect(saveCharacterState).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(saveCharacterState).mock.calls[0][2].questsDone).not.toContain('q_wolves');

    server.sim.meta(session.pid)!.questsDone.add('q_wolves');
    const second = server.saveCharacter(session);
    await Promise.resolve();
    expect(saveCharacterState).toHaveBeenCalledTimes(1);

    resolveFirstSave();
    await first;
    await second;

    expect(saveCharacterState).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveCharacterState).mock.calls[1][2].questsDone).toContain('q_wolves');
  });

  it('closes the play session even when the open insert lands after the player has left', async () => {
    openPlaySession.mockReset();
    closePlaySession.mockReset();
    closePlaySession.mockResolvedValue(undefined);

    // Defer the openPlaySession insert so the player can disconnect first.
    let resolveOpen!: (id: number) => void;
    openPlaySession.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 21, 201, 'Racer', 'warrior', null));
    expect(session.dbSessionId).toBeNull();

    // Player disconnects before the insert resolves: leave() sees a null id.
    await server.leave(session, 'test');
    expect(closePlaySession).not.toHaveBeenCalled();

    // The insert finally lands; the late callback must close the orphaned row.
    resolveOpen(99);
    await Promise.resolve();
    await Promise.resolve();
    expect(closePlaySession).toHaveBeenCalledWith(99, 1);
  });

  it('closes the session with the highest level reached for first-session activation', async () => {
    openPlaySession.mockReset();
    openPlaySession.mockResolvedValue(77);
    closePlaySession.mockReset();
    closePlaySession.mockResolvedValue(undefined);
    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 22, 202, 'Levelmetric', 'warrior', null));
    await vi.waitFor(() => expect(session.dbSessionId).toBe(77));

    (server as any).detectActivity([{ type: 'levelup', level: 5, pid: session.pid }]);
    await server.leave(session, 'test');

    expect(closePlaySession).toHaveBeenCalledWith(77, 5);
  });

  it('seeds session metrics from the loaded character level', async () => {
    openPlaySession.mockReset();
    openPlaySession.mockResolvedValue(78);
    const server = new GameServer();
    const seedPid = server.sim.addPlayer('warrior', 'Metricseed');
    const saved = server.sim.serializeCharacter(seedPid);
    server.sim.removePlayer(seedPid);
    if (!saved) throw new Error('seed character state missing');

    const session = expectJoined(
      server.join(fakeWs(), 23, 203, 'Veteranmetric', 'warrior', { ...saved, level: 12 }),
    );

    await vi.waitFor(() => expect(openPlaySession).toHaveBeenCalledOnce());
    expect(openPlaySession).toHaveBeenCalledWith(23, 203, 'Veteranmetric', {}, 12);
    expect(session.metricsMaxLevel).toBe(12);
  });

  it('closes sessions at shutdown with their highest observed level', async () => {
    openPlaySession.mockReset();
    openPlaySession.mockResolvedValue(79);
    closePlaySession.mockReset();
    closePlaySession.mockResolvedValue(undefined);
    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 24, 204, 'Shutdownmetric', 'mage', null));
    await vi.waitFor(() => expect(session.dbSessionId).toBe(79));

    (server as any).detectActivity([{ type: 'levelup', level: 6, pid: session.pid }]);
    await server.endAllPlaySessions();

    expect(closePlaySession).toHaveBeenCalledWith(79, 6);
  });

  it('allows one ONLINE character per account, and lets the account back in once it leaves', async () => {
    const server = new GameServer();
    const a = expectJoined(server.join(fakeWs(), 20, 201, 'Aone', 'warrior', null));

    expect((server as any).sessionByCharacterId(201)).toBe(a);

    // same account, a second character is rejected while one is online (Ravenpost
    // mail moves goods between an account's characters, so dual-boxing is gone)
    expect(server.join(fakeWs(), 20, 202, 'Atwo', 'mage', null)).toEqual({
      error: 'too many characters on this account are already in the world',
    });

    // a different account is unaffected
    const b = expectJoined(server.join(fakeWs(), 21, 203, 'Bone', 'priest', null));
    expect((server as any).sessionByCharacterId(203)).toBe(b);

    // once the account's online character leaves, another of its characters may join
    await server.leave(a, 'test');
    const a2 = expectJoined(server.join(fakeWs(), 20, 202, 'Atwo', 'mage', null));
    expect((server as any).sessionByCharacterId(202)).toBe(a2);
  });

  it('exempts GM characters from the per-account session cap (for supervision)', () => {
    const server = new GameServer();
    expectJoined(server.join(fakeWs(), 30, 301, 'Gmaa', 'warrior', null));
    // a second character on the same account joins because it is flagged GM
    expectJoined(server.join(fakeWs(), 30, 303, 'Gmcc', 'warrior', null, true));
    expect((server as any).sessionByCharacterId(303)).not.toBeNull();
    // and the cap still applies to a non-GM sibling
    expect(server.join(fakeWs(), 30, 302, 'Gmbb', 'warrior', null)).toEqual({
      error: 'too many characters on this account are already in the world',
    });
  });

  // The per-IP session count backs the hard connection cap (countIpSessions in
  // main.ts). It is bookkeeping no other test now drives, so pin it directly.
  it('tracks per-IP session counts across join/leave and deletes the entry at zero', async () => {
    vi.mocked(saveCharacterState).mockResolvedValue(true);
    const server = new GameServer();
    const ip = '203.0.113.7';
    expect(server.countIpSessions(ip)).toBe(0);

    const a = expectJoined(server.join(fakeWs(), 41, 401, 'Ipone', 'warrior', null, false, { ip }));
    expect(server.countIpSessions(ip)).toBe(1);
    const b = expectJoined(server.join(fakeWs(), 42, 402, 'Iptwo', 'mage', null, false, { ip }));
    expect(server.countIpSessions(ip)).toBe(2);

    await server.leave(a, 'test');
    expect(server.countIpSessions(ip)).toBe(1);
    expect((server as any).ipSessionCounts.has(ip)).toBe(true);

    await server.leave(b, 'test');
    expect(server.countIpSessions(ip)).toBe(0);
    // deleted at zero so a churning IP cannot leak map entries
    expect((server as any).ipSessionCounts.has(ip)).toBe(false);
  });

  it('decrements a per-IP count only once when leave runs twice (kick then socket close)', async () => {
    // A kick that both closes the socket and calls leave() must not
    // double-decrement, or the count would drift below the live total and
    // weaken the hard cap. leave() is guarded by session.left, so it is idempotent.
    vi.mocked(saveCharacterState).mockResolvedValue(true);
    const server = new GameServer();
    const ip = '203.0.113.8';
    const a = expectJoined(
      server.join(fakeWs(), 43, 403, 'Ipsolo', 'warrior', null, false, { ip }),
    );
    const b = expectJoined(server.join(fakeWs(), 44, 404, 'Ipkick', 'rogue', null, false, { ip }));
    expect(server.countIpSessions(ip)).toBe(2);

    await server.leave(b, 'kick');
    await server.leave(b, 'socket close'); // second call is a no-op
    expect(server.countIpSessions(ip)).toBe(1);

    await server.leave(a, 'test');
    expect(server.countIpSessions(ip)).toBe(0);
  });

  it('keeps per-IP session counts independent across different IPs', async () => {
    vi.mocked(saveCharacterState).mockResolvedValue(true);
    const server = new GameServer();
    const ip1 = '198.51.100.1';
    const ip2 = '198.51.100.2';
    const a = expectJoined(
      server.join(fakeWs(), 45, 405, 'Neta', 'warrior', null, false, { ip: ip1 }),
    );
    expectJoined(server.join(fakeWs(), 46, 406, 'Netb', 'mage', null, false, { ip: ip2 }));
    expect(server.countIpSessions(ip1)).toBe(1);
    expect(server.countIpSessions(ip2)).toBe(1);

    await server.leave(a, 'test');
    expect(server.countIpSessions(ip1)).toBe(0);
    expect(server.countIpSessions(ip2)).toBe(1);
  });

  it('takeOverCharacter frees a live session and lets the same character re-join', async () => {
    vi.mocked(saveCharacterState).mockResolvedValue(true);
    const server = new GameServer();
    const ws = fakeWs();
    expectJoined(server.join(ws, 70, 700, 'Takeoverme', 'warrior', null));
    // A second join for the same character is rejected while it is online.
    expect(server.join(fakeWs(), 70, 700, 'Takeoverme', 'warrior', null)).toEqual({
      error: 'character already in world',
    });

    const result = await server.takeOverCharacter(70, 700);
    expect(result).toBe('taken-over');
    expect(ws.close).toHaveBeenCalled();
    // Slot is freed: the character can now enter the world again.
    expectJoined(server.join(fakeWs(), 70, 700, 'Takeoverme', 'warrior', null));
  });

  it('takeOverCharacter is a no-op when the character is offline', async () => {
    const server = new GameServer();
    expect(await server.takeOverCharacter(71, 710)).toBe('not-online');
  });

  it('takeOverCharacter refuses to disconnect a session owned by another account', async () => {
    vi.mocked(saveCharacterState).mockResolvedValue(true);
    const server = new GameServer();
    const ws = fakeWs();
    expectJoined(server.join(ws, 80, 800, 'Owned', 'mage', null));
    // A different account must never be able to kick this session.
    expect(await server.takeOverCharacter(81, 800)).toBe('not-online');
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('an anti-bot kick notifies the client and closes the socket so the player can rejoin', async () => {
    // Regression: the anti-bot kick used to call leave() WITHOUT sending an error
    // frame or closing the socket (unlike disconnectAccount/takeOverCharacter).
    // The character was removed from the world but the client stayed wedged
    // "connected" — no onclose/error fired, so the app never returned to
    // character select and the player could not rejoin.
    vi.mocked(saveCharacterState).mockResolvedValue(true);
    const server = new GameServer();
    const ws = fakeWs();
    expectJoined(server.join(ws, 90, 900, 'Imdutha', 'warrior', null));

    // Force the bot detector to kick on the next anti-bot tick.
    (server as any).botDetector = {
      ...(server as any).botDetector,
      handleTick: () => 'kick',
      releaseTrackingContext: () => {},
    };
    (server as any).runAntibotTick();
    await vi.waitFor(() => {
      expect((server as any).sessionByCharacterId(900)).toBeNull();
    });

    // The client is told why and the socket is torn down (mirrors the other
    // kick paths), so net/online.ts surfaces the disconnect and the app can
    // return to character select.
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ t: 'error', error: 'rejected by server' }),
    );
    expect(ws.close).toHaveBeenCalled();

    // The character slot is freed: the same character can enter the world again.
    expectJoined(server.join(fakeWs(), 90, 900, 'Imdutha', 'warrior', null));
  });
});

// Season 1 Armory weapon skins: the change_weapon_skin dispatch is the whole
// server-authoritative surface (ownership from account cosmetics, the equipped
// weapon-type gate re-validated by the Sim, FIFO account-wide persistence).
// Warriors join holding worn_sword, a sword; ice_fang_sword is a sword
// skin and glaciersplit_axe an axe skin.
describe('GameServer weapon skin commands', () => {
  const ownedSkins = (weaponSkinIds: string[], weaponSkinLoadout: Record<string, string> = {}) => ({
    accountCosmetics: {
      completedQuestIds: [],
      mechChromaIds: [],
      weaponSkinIds,
      weaponSkinLoadout,
    },
  });

  function changeSkin(server: GameServer, session: ClientSession, skin: unknown, wtype?: unknown) {
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'change_weapon_skin', skin, wtype }),
    );
  }

  it('applies an owned skin of the equipped weapon type and persists the loadout', async () => {
    setAccountWeaponSkinLoadout.mockClear();
    const server = new GameServer();
    const session = expectJoined(
      server.join(fakeWs(), 11, 101, 'Skinner', 'warrior', null, false, {
        ...ownedSkins(['ice_fang_sword']),
      }),
    );

    changeSkin(server, session, 'ice_fang_sword', 'sword');

    // The skin attaches live on the entity, mirrors into the account loadout,
    // and the single atomic jsonb_set write fires for the account.
    expect(server.sim.entities.get(session.pid)?.weaponSkinId).toBe('ice_fang_sword');
    expect(session.accountCosmetics.weaponSkinLoadout.sword).toBe('ice_fang_sword');
    await vi.waitFor(() => {
      expect(setAccountWeaponSkinLoadout).toHaveBeenCalledWith(11, {
        sword: 'ice_fang_sword',
      });
    });
  });

  it('keeps hunter bow and crossbow selections mutually exclusive on the server', async () => {
    setAccountWeaponSkinLoadout.mockClear();
    const server = new GameServer();
    const session = expectJoined(
      server.join(fakeWs(), 11, 101, 'Ranger', 'hunter', null, false, {
        ...ownedSkins(['winterbite', 'meteorlatch_crossbow']),
      }),
    );

    changeSkin(server, session, 'winterbite', 'bow');
    changeSkin(server, session, 'meteorlatch_crossbow', 'crossbow');

    expect(server.sim.entities.get(session.pid)?.weaponSkinId).toBe('meteorlatch_crossbow');
    expect(session.accountCosmetics.weaponSkinLoadout).toEqual({
      crossbow: 'meteorlatch_crossbow',
    });
    await vi.waitFor(() => {
      expect(setAccountWeaponSkinLoadout).toHaveBeenLastCalledWith(11, {
        crossbow: 'meteorlatch_crossbow',
      });
    });

    changeSkin(server, session, 'winterbite', 'bow');

    expect(server.sim.entities.get(session.pid)?.weaponSkinId).toBe('winterbite');
    expect(session.accountCosmetics.weaponSkinLoadout).toEqual({ bow: 'winterbite' });
    await vi.waitFor(() => {
      expect(setAccountWeaponSkinLoadout).toHaveBeenLastCalledWith(11, { bow: 'winterbite' });
    });
  });

  it('rejects applying a skin the account does not own (anti-forge), with no db write', () => {
    setAccountWeaponSkinLoadout.mockClear();
    const server = new GameServer();
    const session = expectJoined(
      server.join(fakeWs(), 11, 101, 'Forger', 'warrior', null, false, {
        ...ownedSkins([]),
      }),
    );

    changeSkin(server, session, 'ice_fang_sword', 'sword');

    expect(server.sim.entities.get(session.pid)?.weaponSkinId).toBeNull();
    expect(session.accountCosmetics.weaponSkinLoadout).toEqual({});
    expect(setAccountWeaponSkinLoadout).not.toHaveBeenCalled();
  });

  it('rejects an owned skin whose type does not match the equipped weapon', () => {
    setAccountWeaponSkinLoadout.mockClear();
    const server = new GameServer();
    // Owns the axe skin, but the warrior is holding worn_sword (a sword), so
    // the Sim's equipped-type gate must refuse the apply.
    const session = expectJoined(
      server.join(fakeWs(), 11, 101, 'Mismatch', 'warrior', null, false, {
        ...ownedSkins(['glaciersplit_axe']),
      }),
    );

    changeSkin(server, session, 'glaciersplit_axe', 'axe');

    expect(server.sim.entities.get(session.pid)?.weaponSkinId).toBeNull();
    expect(session.accountCosmetics.weaponSkinLoadout).toEqual({});
    expect(setAccountWeaponSkinLoadout).not.toHaveBeenCalled();
  });

  it('detaches an applied skin (skin null + wtype) and persists the emptied loadout', async () => {
    setAccountWeaponSkinLoadout.mockClear();
    const server = new GameServer();
    const session = expectJoined(
      server.join(fakeWs(), 11, 101, 'Detacher', 'warrior', null, false, {
        ...ownedSkins(['ice_fang_sword'], { sword: 'ice_fang_sword' }),
      }),
    );
    // The join seeds the account loadout onto the fresh sim entity.
    expect(server.sim.entities.get(session.pid)?.weaponSkinId).toBe('ice_fang_sword');

    changeSkin(server, session, 'ice_fang_sword', 'sword');
    changeSkin(server, session, null, 'sword');

    expect(server.sim.entities.get(session.pid)?.weaponSkinId).toBeNull();
    expect(session.accountCosmetics.weaponSkinLoadout).toEqual({});
    await vi.waitFor(() => {
      expect(setAccountWeaponSkinLoadout).toHaveBeenLastCalledWith(11, {});
    });
  });

  it('ignores junk change_weapon_skin input without touching the loadout or the db', () => {
    setAccountWeaponSkinLoadout.mockClear();
    const server = new GameServer();
    const session = expectJoined(
      server.join(fakeWs(), 11, 101, 'Junkproof', 'warrior', null, false, {
        ...ownedSkins(['ice_fang_sword'], { sword: 'ice_fang_sword' }),
      }),
    );

    changeSkin(server, session, 123); // non-string skin, no wtype: not dispatched
    changeSkin(server, session, null, 'polearm'); // no skins target polearms
    changeSkin(server, session, null, 7); // non-string wtype: not dispatched

    // The applied skin survives every malformed request and nothing is saved.
    expect(server.sim.entities.get(session.pid)?.weaponSkinId).toBe('ice_fang_sword');
    expect(session.accountCosmetics.weaponSkinLoadout).toEqual({ sword: 'ice_fang_sword' });
    expect(setAccountWeaponSkinLoadout).not.toHaveBeenCalled();
  });

  it('applies the loadout to every live character on the account', async () => {
    setAccountWeaponSkinLoadout.mockClear();
    const server = new GameServer();
    const cosmetics = {
      completedQuestIds: [],
      mechChromaIds: [],
      weaponSkinIds: ['ice_fang_sword'],
      weaponSkinLoadout: {},
    };
    const first = expectJoined(
      server.join(fakeWs(), 11, 101, 'Skinone', 'warrior', null, false, {
        accountCosmetics: cosmetics,
      }),
    );
    // The second live character rides the GM exemption from the per-account
    // session cap (same trick as the mech-chroma sweep test); both are
    // warriors, so both hold worn_sword and the sword skin applies to each.
    const second = expectJoined(
      server.join(fakeWs(), 11, 102, 'Skintwo', 'warrior', null, true, {
        accountCosmetics: cosmetics,
      }),
    );

    changeSkin(server, first, 'ice_fang_sword', 'sword');

    expect(server.sim.entities.get(first.pid)?.weaponSkinId).toBe('ice_fang_sword');
    expect(server.sim.entities.get(second.pid)?.weaponSkinId).toBe('ice_fang_sword');
    expect(second.accountCosmetics.weaponSkinLoadout.sword).toBe('ice_fang_sword');
    await vi.waitFor(() => {
      expect(setAccountWeaponSkinLoadout).toHaveBeenCalledTimes(1);
      expect(setAccountWeaponSkinLoadout).toHaveBeenCalledWith(11, {
        sword: 'ice_fang_sword',
      });
    });
  });

  it('serializes rapid whole-loadout writes so the newest state cannot commit first', async () => {
    setAccountWeaponSkinLoadout.mockClear();
    let releaseFirst: (() => void) | undefined;
    setAccountWeaponSkinLoadout.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () =>
            resolve({
              completedQuestIds: [],
              mechChromaIds: [],
              weaponSkinIds: ['ice_fang_sword'],
              weaponSkinLoadout: { sword: 'ice_fang_sword' },
            });
        }),
    );
    const server = new GameServer();
    const session = expectJoined(
      server.join(fakeWs(), 11, 101, 'RapidSkinner', 'warrior', null, false, {
        ...ownedSkins(['ice_fang_sword']),
      }),
    );

    changeSkin(server, session, 'ice_fang_sword', 'sword');
    changeSkin(server, session, null, 'sword');

    await vi.waitFor(() => expect(setAccountWeaponSkinLoadout).toHaveBeenCalledTimes(1));
    expect(setAccountWeaponSkinLoadout).toHaveBeenNthCalledWith(1, 11, {
      sword: 'ice_fang_sword',
    });
    releaseFirst?.();
    await vi.waitFor(() => expect(setAccountWeaponSkinLoadout).toHaveBeenCalledTimes(2));
    expect(setAccountWeaponSkinLoadout).toHaveBeenNthCalledWith(2, 11, {});
    expect(session.accountCosmetics.weaponSkinLoadout).toEqual({});
  });
});
