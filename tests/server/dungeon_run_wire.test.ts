vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountWeaponSkins: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  setCharacterHotbarLayout: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadRiftState: vi.fn(async () => null),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  saveRiftState: vi.fn(async () => {}),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
}));

// The `dgrun` self key end to end: the authoritative server encodes the sim's
// dungeon run (server/dungeon_run_wire.ts over src/sim/instances/dungeon_run.ts),
// the delta gate ships it only when it changes, and the online ClientWorld
// decodes it onto IWorld.dungeonRun (src/net/dungeon_run_wire.ts through
// QuestWorldWireState). What the HUD's dungeon objectives tracker shows online
// is exactly what survives this trip.
import { describe, expect, it, vi } from 'vitest';
import { dungeonRunWireJson } from '../../server/dungeon_run_wire';
import { GameServer } from '../../server/game';
import { decodeDungeonRun, nextDungeonRun, sameDungeonRun } from '../../src/net/dungeon_run_wire';
import { MERE_HYDRA_HEAD_IDS } from '../../src/sim/content/drowned_temple';
import { DUNGEONS } from '../../src/sim/data';
import { regrowHead } from '../../src/sim/encounters/drowned_temple/hydra_regrowth';
import { dungeonRunForPlayer } from '../../src/sim/instances/dungeon_run';
import { claimedInstanceAt, enterDungeon, leaveDungeon } from '../../src/sim/instances/dungeons';
import type { Entity } from '../../src/sim/types';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from '../helpers/bare_client';

function rig(characterId = 301, name = 'Cryptwalker') {
  const server = new GameServer();
  const fc = fakeWs();
  const session = joinServer(server, fc, characterId, name, 'warrior');
  const sim = server.sim;
  sim.setPlayerLevel(20, session.pid);
  const client = bareClient(session.pid);
  // One server pass, applied to the client the way the socket would.
  const pass = () => {
    fc.sent.length = 0;
    broadcast(server);
    const snap = lastSnap(fc.sent);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is ClientWorld's private decode door
    (client as any).applySnapshot(snap);
    return snap;
  };
  const killPlaced = (mobId: string) => {
    const player = sim.entities.get(session.pid) as Entity;
    const inst = claimedInstanceAt(sim.ctx, player.pos);
    if (!inst) throw new Error('no claim');
    const index = DUNGEONS[inst.dungeonId].spawns.findIndex((s) => s.mobId === mobId);
    sim.ctx.handleDeath(sim.ctx.entities.get(inst.mobIds[index]) as Entity, player);
  };
  return { server, sim, session, fc, client, pass, killPlaced };
}

describe('dgrun: the dungeon run on the wire', () => {
  it('a fresh session outside any dungeon gets an explicit null, then silence', () => {
    const { client, pass } = rig();
    const first = pass();
    expect(first.self).toHaveProperty('dgrun', null);
    expect(client.dungeonRun).toBeNull();
    expect(pass().self).not.toHaveProperty('dgrun');
  });

  it('round-trips entry, a boss kill, and leaving, shipping only on a change', () => {
    const { sim, session, client, pass, killPlaced } = rig();
    pass();
    sim.setDungeonDifficulty('heroic', session.pid);
    expect(enterDungeon(sim.ctx, 'sunken_bastion', session.pid, true)).toBe(true);

    const entered = pass();
    expect(entered.self.dgrun).toEqual({
      dungeonId: 'sunken_bastion',
      difficulty: 'heroic',
      bosses: [
        { mobId: 'knight_commander_olen', defeated: false },
        { mobId: 'gaol_turnkey', defeated: false },
        { mobId: 'gaoler_ossick', defeated: false },
        { mobId: 'vael_the_mistcaller', defeated: false },
      ],
    });
    // The client's read is the server's, value for value.
    expect(client.dungeonRun).toEqual(dungeonRunForPlayer(sim.ctx, session.pid));
    const mirrored = client.dungeonRun;

    // Nothing changed: the key is elided and the mirror is left alone, by reference.
    for (let i = 0; i < 5; i++) {
      sim.tick();
      expect(pass().self).not.toHaveProperty('dgrun');
    }
    expect(client.dungeonRun).toBe(mirrored);

    killPlaced('knight_commander_olen');
    const afterKill = pass();
    expect(afterKill.self.dgrun.bosses[0]).toEqual({
      mobId: 'knight_commander_olen',
      defeated: true,
    });
    expect(client.dungeonRun?.bosses.map((b) => b.defeated)).toEqual([true, false, false, false]);
    expect(client.dungeonRun).not.toBe(mirrored);
    expect(pass().self).not.toHaveProperty('dgrun');

    expect(leaveDungeon(sim.ctx, session.pid)).toBe(true);
    expect(pass().self).toHaveProperty('dgrun', null);
    expect(client.dungeonRun).toBeNull();
  });

  it('serializes one claim view once, however many members read it', () => {
    const { server, sim, session } = rig(302, 'Leader');
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 303, 'Second', 'mage');
    sim.setPlayerLevel(20, other.pid);
    sim.partyInvite(other.pid, session.pid);
    sim.partyAccept(other.pid);
    expect(enterDungeon(sim.ctx, 'hollow_crypt', session.pid, true)).toBe(true);
    expect(enterDungeon(sim.ctx, 'hollow_crypt', other.pid, true)).toBe(true);
    const spy = vi.spyOn(JSON, 'stringify');
    try {
      const a = dungeonRunWireJson(sim.ctx, session.pid);
      const b = dungeonRunWireJson(sim.ctx, other.pid);
      const again = dungeonRunWireJson(sim.ctx, session.pid);
      expect(a).toBe(b);
      expect(again).toBe(a);
      expect(a).toContain('"dungeonId":"hollow_crypt"');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    expect(dungeonRunWireJson(sim.ctx, 424242)).toBe('null');
  });

  it('a full re-send of an unchanged run keeps the mirrored object', () => {
    // The server re-sends every delta key to a session whose cache it reset (a
    // resume, a spectate flip). The run did not change, so the mirror must not
    // either: the seam promises a consumer may diff it by identity.
    const { sim, session, client, pass } = rig(305, 'Resender');
    expect(enterDungeon(sim.ctx, 'gravewyrm_sanctum', session.pid, true)).toBe(true);
    pass();
    const held = client.dungeonRun;
    expect(held).not.toBeNull();
    session.lastSent = {};
    const resent = pass();
    expect(resent.self.dgrun).toEqual(held);
    expect(client.dungeonRun).toBe(held);
  });

  it('a reconnect clears the stale mirror and the resumed session restores the run', () => {
    const { server, sim, session, client, pass, killPlaced } = rig(304, 'Relinker');
    expect(enterDungeon(sim.ctx, 'drowned_temple', session.pid, true)).toBe(true);
    pass();
    killPlaced('choirmother_selthe');
    pass();
    const flags = () => client.dungeonRun?.bosses.map((boss) => boss.defeated);
    expect(flags()).toEqual([true, false, false, false]);
    // Settled: the server has nothing more to say about the run.
    expect(pass().self).not.toHaveProperty('dgrun');

    // The socket drops and the same character joins again: the server's real
    // resume path (GameServer.resumeSession, which wipes the delta cache).
    session.linkdead = true;
    const socket = fakeWs();
    const resumed = server.join(socket.ws, 304, 304, 'Relinker', 'warrior', null, false, {});
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed).toBe(session);
    // The client resets every delta-omitted mirror before the resumed
    // session's first self record lands (ClientWorld's hello handler)...
    client.resetQuestWorldWireState();
    expect(client.dungeonRun).toBeNull();
    // ...and that first record carries the run again, kills and all, although
    // nothing about it changed since the last one the old socket was sent.
    socket.sent.length = 0;
    broadcast(server);
    const snap = lastSnap(socket.sent);
    expect(snap.self.dgrun).toEqual({
      dungeonId: 'drowned_temple',
      difficulty: 'normal',
      bosses: [
        { mobId: 'choirmother_selthe', defeated: true },
        { mobId: 'mere_hydra_head_center', defeated: false },
        { mobId: 'tideglass_colossus', defeated: false },
        { mobId: 'ysolei', defeated: false },
      ],
    });
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is ClientWorld's private decode door
    (client as any).applySnapshot(snap);
    expect(client.dungeonRun).toEqual(dungeonRunForPlayer(sim.ctx, session.pid));
    expect(flags()).toEqual([true, false, false, false]);
  });

  it('ships the Mere Hydra as one row, and only when its third head falls', () => {
    // A boss of three placed bodies is still one row on the wire, keyed on the
    // centre head (whose mob name is the boss's). The server decides when it
    // is down, so the mirror needs no notion of the other two heads, and a
    // head falling short of the kill moves nothing and ships nothing.
    const { sim, session, client, pass, killPlaced } = rig(306, 'Poolwader');
    pass();
    sim.setDungeonDifficulty('heroic', session.pid);
    expect(enterDungeon(sim.ctx, 'drowned_temple', session.pid, true)).toBe(true);
    const entered = pass();
    expect(entered.self.dgrun).toEqual({
      dungeonId: 'drowned_temple',
      difficulty: 'heroic',
      bosses: [
        { mobId: 'choirmother_selthe', defeated: false },
        { mobId: 'mere_hydra_head_center', defeated: false },
        { mobId: 'tideglass_colossus', defeated: false },
        { mobId: 'ysolei', defeated: false },
      ],
    });
    // Row count and order are the sim's own, on both hosts.
    expect(client.dungeonRun).toEqual(dungeonRunForPlayer(sim.ctx, session.pid));
    const mirrored = client.dungeonRun;
    const flags = () => client.dungeonRun?.bosses.map((boss) => boss.defeated);

    // The centre head (the row's own id) and then a second head: no frame.
    for (const head of ['mere_hydra_head_center', 'mere_hydra_head_left']) {
      killPlaced(head);
      expect(pass().self, head).not.toHaveProperty('dgrun');
      expect(client.dungeonRun, head).toBe(mirrored);
      expect(flags(), head).toEqual([false, false, false, false]);
    }

    killPlaced('mere_hydra_head_right');
    const afterKill = pass();
    expect(afterKill.self.dgrun.bosses[1]).toEqual({
      mobId: 'mere_hydra_head_center',
      defeated: true,
    });
    expect(flags()).toEqual([false, true, false, false]);
    expect(client.dungeonRun).toEqual(dungeonRunForPlayer(sim.ctx, session.pid));
    expect(pass().self).not.toHaveProperty('dgrun');
  });

  it('a Hydra row that reopens ships again and the mirror follows it back', () => {
    // The row is a live read (a head standing again reopens it), so the wire
    // must carry a row going back to open exactly like one closing.
    const { sim, session, client, pass, killPlaced } = rig(307, 'Rimewader');
    expect(enterDungeon(sim.ctx, 'drowned_temple', session.pid, true)).toBe(true);
    pass();
    for (const head of MERE_HYDRA_HEAD_IDS) killPlaced(head);
    pass();
    expect(client.dungeonRun?.bosses[1].defeated).toBe(true);
    const player = sim.entities.get(session.pid) as Entity;
    const inst = claimedInstanceAt(sim.ctx, player.pos);
    if (!inst) throw new Error('no claim');
    const index = DUNGEONS.drowned_temple.spawns.findIndex(
      (s) => s.mobId === 'mere_hydra_head_left',
    );
    regrowHead(sim.ctx, sim.ctx.entities.get(inst.mobIds[index]) as Entity, 1);
    const reopened = pass();
    expect(reopened.self.dgrun.bosses[1]).toEqual({
      mobId: 'mere_hydra_head_center',
      defeated: false,
    });
    expect(client.dungeonRun?.bosses.map((boss) => boss.defeated)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(client.dungeonRun).toEqual(dungeonRunForPlayer(sim.ctx, session.pid));
  });
});

describe('decodeDungeonRun', () => {
  const good = {
    dungeonId: 'hollow_crypt',
    difficulty: 'normal',
    bosses: [
      { mobId: 'sexton_marrow', defeated: true },
      { mobId: 'morthen', defeated: false },
    ],
  };

  it('decodes a well-formed frame into a frozen view', () => {
    const run = decodeDungeonRun(JSON.parse(JSON.stringify(good)));
    expect(run).toEqual(good);
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run?.bosses)).toBe(true);
    expect(Object.isFrozen(run?.bosses[0])).toBe(true);
  });

  it('carries nothing but the three known fields', () => {
    const run = decodeDungeonRun({
      ...good,
      extra: 'x',
      bosses: [{ ...good.bosses[0], hp: 9 }],
    });
    expect(Object.keys(run ?? {})).toEqual(['dungeonId', 'difficulty', 'bosses']);
    expect(Object.keys(run?.bosses[0] ?? {})).toEqual(['mobId', 'defeated']);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'hollow_crypt'],
    ['an array', [good]],
    ['an unknown dungeon', { ...good, dungeonId: 'crypt_of_next_patch' }],
    ['a prototype key as the dungeon', { ...good, dungeonId: 'constructor' }],
    ['a non-string dungeon', { ...good, dungeonId: 7 }],
    ['an unknown difficulty', { ...good, difficulty: 'mythic' }],
    ['a missing difficulty', { dungeonId: good.dungeonId, bosses: good.bosses }],
    ['bosses not a list', { ...good, bosses: { 0: good.bosses[0] } }],
    ['an empty boss list', { ...good, bosses: [] }],
    [
      'an oversized boss list',
      { ...good, bosses: Array.from({ length: 17 }, () => good.bosses[0]) },
    ],
    ['a boss that is not a record', { ...good, bosses: ['sexton_marrow'] }],
    ['an unknown boss', { ...good, bosses: [{ mobId: 'boss_of_next_patch', defeated: false }] }],
    ['a prototype key as the boss', { ...good, bosses: [{ mobId: 'toString', defeated: false }] }],
    ['a non-boolean defeated flag', { ...good, bosses: [{ mobId: 'morthen', defeated: 1 }] }],
    ['a missing defeated flag', { ...good, bosses: [{ mobId: 'morthen' }] }],
  ])('drops the whole run for %s', (_label, frame) => {
    expect(decodeDungeonRun(frame)).toBeNull();
  });

  it('sameDungeonRun compares the dungeon, the difficulty and every row', () => {
    const a = decodeDungeonRun(good) as NonNullable<ReturnType<typeof decodeDungeonRun>>;
    expect(sameDungeonRun(a, { ...a })).toBe(true);
    expect(sameDungeonRun(a, { ...a, dungeonId: 'sunken_bastion' })).toBe(false);
    expect(sameDungeonRun(a, { ...a, difficulty: 'heroic' })).toBe(false);
    expect(sameDungeonRun(a, { ...a, bosses: a.bosses.slice(0, 1) })).toBe(false);
    expect(
      sameDungeonRun(a, {
        ...a,
        bosses: [a.bosses[0], { mobId: 'morthen', defeated: true }],
      }),
    ).toBe(false);
    expect(
      sameDungeonRun(a, {
        ...a,
        bosses: [a.bosses[0], { mobId: 'rimeweb', defeated: false }],
      }),
    ).toBe(false);
  });

  it('nextDungeonRun keeps the held run only for an identical frame', () => {
    const held = decodeDungeonRun(good);
    expect(nextDungeonRun(held, JSON.parse(JSON.stringify(good)))).toBe(held);
    const changed = nextDungeonRun(held, {
      ...good,
      bosses: good.bosses.map((boss) => ({ ...boss, defeated: true })),
    });
    expect(changed).not.toBe(held);
    expect(changed?.bosses.every((boss) => boss.defeated)).toBe(true);
    expect(nextDungeonRun(held, null)).toBeNull();
    expect(nextDungeonRun(null, good)).toEqual(good);
    // A malformed frame clears, it never keeps a stale run on screen.
    expect(nextDungeonRun(held, { ...good, difficulty: 'mythic' })).toBeNull();
  });

  it('one unknown boss drops the run rather than rendering a short list', () => {
    const run = decodeDungeonRun({
      ...good,
      bosses: [...good.bosses, { mobId: 'boss_of_next_patch', defeated: false }],
    });
    expect(run).toBeNull();
  });
});
