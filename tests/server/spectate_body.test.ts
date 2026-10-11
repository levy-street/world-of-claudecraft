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

import { describe, expect, it, vi } from 'vitest';
import { type ClientSession, GameServer } from '../../server/game';
import { HILL_ACCRUAL_SECONDS, spawnHillNow } from '../../src/sim/pvp';
import { DT, emptyMoveInput } from '../../src/sim/types';
import { fakeWs, joinServer } from '../helpers/bare_client';

// server/spectate_body.ts: /spectate moves only the camera. The moderator's
// body stays where it stands, keeps its own GM flag (none for an ordinary
// admin), and so stays in the world: counted on the King of the Hill and open
// to attack. Regression: the body used to be parked in a far-off limbo (and
// made GM), so an admin holding the hill dropped off it the moment they
// opened /spectate on another player.

interface SpectateArms {
  enterSpectate(moderator: ClientSession, target: ClientSession): void;
  exitSpectate(moderator: ClientSession, announce?: boolean): void;
  jailSession(moderator: ClientSession, target: ClientSession, minutes: number): void;
}

function tickSeconds(server: GameServer, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) server.sim.tick();
}

function rig() {
  const server = new GameServer();
  const moderator = joinServer(server, fakeWs(), 701, 'Hill Warden');
  const target = joinServer(server, fakeWs(), 702, 'Far Wanderer');
  const body = server.sim.entities.get(moderator.pid);
  if (!body) throw new Error('moderator entity missing');
  return { server, moderator, target, body, arms: server as unknown as SpectateArms };
}

describe('/spectate leaves the moderator body in the world', () => {
  it('a hill holder who spectates another player keeps the hill and earns its Honor', () => {
    const { server, moderator, target, body, arms } = rig();
    const hill = spawnHillNow(server.sim.ctx, 'drakelands');
    if (!hill) throw new Error('no hill spot');
    body.pos = server.sim.groundPos(hill.x, hill.z);
    body.prevPos = { ...body.pos };
    body.gm = false;
    // Attackable means the zone's mobs may well attack it: a pool deep enough to
    // outlast the minute keeps this case about presence, not survival.
    body.maxHp = 1e9;
    body.hp = 1e9;
    hill.holder = `solo:${moderator.pid}`;
    const spot = { ...body.pos };

    arms.enterSpectate(moderator, target);
    expect(body.pos).toEqual(spot);
    expect(body.gm).toBe(false);

    const honorBefore = server.sim.meta(moderator.pid)!.honor;
    tickSeconds(server, HILL_ACCRUAL_SECONDS + 2);
    expect(hill.insideKeys.get(moderator.pid)).toBe(`solo:${moderator.pid}`);
    expect(hill.holder).toBe(`solo:${moderator.pid}`);
    expect(server.sim.meta(moderator.pid)!.honor).toBeGreaterThan(honorBefore);
  });

  it('a spectating admin without GM can still be hurt', () => {
    const { server, moderator, target, body, arms } = rig();
    body.gm = false;
    arms.enterSpectate(moderator, target);
    const hp = body.hp;
    server.sim.dealDamage(null, body, 10, false, 'physical', null, 'hit', true);
    expect(body.hp).toBe(hp - 10);
  });

  it('entry idles the body; retargeting and exit never move it', () => {
    const { server, moderator, target, body, arms } = rig();
    const second = joinServer(server, fakeWs(), 703, 'Second Watched');
    const meta = server.sim.meta(moderator.pid)!;
    body.autoAttack = true;
    meta.moveInput.forward = true;
    const home = { ...body.pos };

    arms.enterSpectate(moderator, target);
    expect(body.autoAttack).toBe(false);
    expect(meta.moveInput).toEqual(emptyMoveInput());
    arms.enterSpectate(moderator, second);
    expect(moderator.spectating?.characterId).toBe(second.characterId);
    expect(body.pos).toEqual(home);
    arms.exitSpectate(moderator, false);
    expect(moderator.spectating).toBeNull();
    expect(body.pos).toEqual(home);
  });

  it('a moderator jailed while spectating is still in the cage after /unspectate', () => {
    const { server, moderator, target, body, arms } = rig();
    const outside = { ...body.pos };
    arms.enterSpectate(moderator, target);
    arms.jailSession(target, moderator, 10);
    const cell = { ...body.pos };
    expect(cell).not.toEqual(outside);
    arms.exitSpectate(moderator, false);
    expect(body.pos).toEqual(cell);
    expect(moderator.jailed).not.toBeNull();
  });
});
