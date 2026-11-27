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

// The `rdrun` self key end to end: the server encodes the sim's raid run
// (server/dungeon_run_wire.ts over src/sim/instances/raid_run.ts), the delta
// gate ships it only when it changes, and the online ClientWorld decodes it
// onto IWorld.raidRun (QuestWorldWireState). The Adventure Journal lands online
// on exactly what survives this trip.
import { describe, expect, it, vi } from 'vitest';
import { GameServer } from '../../server/game';
import { SMITH_HEART_DUNGEON } from '../../src/sim/content/smith_heart';
import { DUNGEONS } from '../../src/sim/data';
import { COUNCIL_SEAM_SINGER } from '../../src/sim/encounters/smith_heart/council_ids';
import { claimedInstanceAt, enterDungeon, leaveDungeon } from '../../src/sim/instances/dungeons';
import { raidRunForPlayer } from '../../src/sim/instances/raid_run';
import type { Entity } from '../../src/sim/types';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from '../helpers/bare_client';

function rig() {
  const server = new GameServer();
  const fc = fakeWs();
  const session = joinServer(server, fc, 411, 'Heartwalker', 'warrior');
  const sim = server.sim;
  sim.setPlayerLevel(20, session.pid);
  // The raid is dev-gated until it ships (smithHeartEntryOpen): open its door here.
  (sim as unknown as { devCommands: boolean }).devCommands = true;
  const client = bareClient(session.pid);
  const pass = () => {
    fc.sent.length = 0;
    broadcast(server);
    const snap = lastSnap(fc.sent);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is ClientWorld's private decode door
    (client as any).applySnapshot(snap);
    return snap;
  };
  const placed = (mobId: string) => {
    const player = sim.entities.get(session.pid) as Entity;
    const inst = claimedInstanceAt(sim.ctx, player.pos);
    if (!inst) throw new Error('no claim');
    const index = DUNGEONS[inst.dungeonId].spawns.findIndex((s) => s.mobId === mobId);
    return { body: sim.ctx.entities.get(inst.mobIds[index]) as Entity, player, inst };
  };
  return { sim, session, client, pass, placed };
}

describe('rdrun: the raid run on the wire', () => {
  it('a fresh session outside any raid gets an explicit null, then silence', () => {
    const { client, pass } = rig();
    expect(pass().self).toHaveProperty('rdrun', null);
    expect(client.raidRun).toBeNull();
    expect(pass().self).not.toHaveProperty('rdrun');
  });

  it('round-trips entry, a tier change, a pull, a kill and leaving, shipping only on a change', () => {
    const { sim, session, client, pass, placed } = rig();
    pass();
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, session.pid, true)).toBe(true);
    const entered = pass();
    expect(entered.self.rdrun.dungeonId).toBe(SMITH_HEART_DUNGEON);
    expect(entered.self.rdrun.bosses).toHaveLength(6);
    expect(client.raidRun).toEqual(raidRunForPlayer(sim.ctx, session.pid));
    const mirrored = client.raidRun;
    expect(pass().self).not.toHaveProperty('rdrun');
    expect(client.raidRun).toBe(mirrored);

    // The claim's tier is part of the view: a Heroic claim ships a new one.
    const { inst } = placed(COUNCIL_SEAM_SINGER);
    inst.difficulty = 'heroic';
    expect(pass().self.rdrun.difficulty).toBe('heroic');
    expect(client.raidRun?.difficulty).toBe('heroic');
    expect(client.raidRun).not.toBe(mirrored);

    const { body, player } = placed(COUNCIL_SEAM_SINGER);
    body.inCombat = true;
    body.aiState = 'chase';
    expect(pass().self.rdrun).toBeTruthy();
    expect(client.raidRun?.bosses.find((b) => b.mobId === COUNCIL_SEAM_SINGER)?.engaged).toBe(true);

    sim.ctx.handleDeath(body, player);
    pass();
    expect(client.raidRun?.bosses.find((b) => b.mobId === COUNCIL_SEAM_SINGER)).toEqual({
      mobId: COUNCIL_SEAM_SINGER,
      defeated: true,
      engaged: false,
    });

    expect(leaveDungeon(sim.ctx, session.pid)).toBe(true);
    expect(pass().self).toHaveProperty('rdrun', null);
    expect(client.raidRun).toBeNull();
  });
});
