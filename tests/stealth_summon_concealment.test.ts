// A stealthed player's summons (pet, demon, elemental, undead) must not give the
// owner away. Before this rule the snapshot filter (canObserveEntity, now in
// server/interest_policy.ts) hid only the PLAYER, so an enemy with /pvp on could
// spot an invisible owner from across the field by the pet still standing at
// their heel. Driven through the real server broadcast, the real /pvp flag and
// the real Potion of Invisibility use path.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed: only the snapshot pass is under test.
vi.mock('../server/db', () => ({
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
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  // The branch's db surface (integration/world-quests-v0440): every export
  // server/game.ts imports, so a future arm of this file never trips
  // "No X export is defined on the mock" (the canonical shape is
  // tests/character_lease_game.test.ts).
  grantAccountMountSkins: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountWeaponSkins: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  saveMarketState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadRiftState: vi.fn(async () => null),
  saveRiftState: vi.fn(async () => {}),
  loadGuildBankRow: vi.fn(async () => null),
  loadGuildBankRows: vi.fn(async () => []),
  saveCharacterAndGuildBankState: vi.fn(async () => {}),
  GUILD_BANK_ROW_MAX_BYTES: 262144,
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
}));

import type { ClientSession, GameServer as GameServerType } from '../server/game';
import { GameServer } from '../server/game';
import { summonPet } from '../src/sim/pet/pet_commands';
import { worldPvpZonePolicyAt } from '../src/sim/pvp/world_pvp_zones';
import type { Entity } from '../src/sim/types';
import { broadcast, type FakeClient, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

// Every id the last snapshot keeps alive: rows plus the bare `keep` ids.
function presentIds(fc: FakeClient): number[] {
  const snap = lastSnap(fc.sent) as { ents: { id: number }[]; keep?: number[] };
  return [...snap.ents.map((row) => row.id), ...(snap.keep ?? [])];
}

function placeAt(server: GameServerType, e: Entity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  server.sim.ctx.rebucket(e);
}

// The first contested (non-sanctuary, non-ffa) ground near the origin, so the
// /pvp flags, not the zone, decide hostility.
function contestedSpot(): { x: number; z: number } {
  for (let r = 0; r <= 2000; r += 50) {
    for (const [x, z] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ]) {
      if (
        worldPvpZonePolicyAt(x, z) === 'contested' &&
        worldPvpZonePolicyAt(x + 60, z) === 'contested'
      )
        return { x, z };
    }
  }
  throw new Error('no contested ground found');
}

interface Scene {
  server: GameServer;
  owner: Entity;
  pet: Entity;
  enemy: Entity;
  ownerWs: FakeClient;
  enemyWs: FakeClient;
  ownerSession: ClientSession;
}

function scene(flagged: boolean): Scene {
  const server = new GameServer();
  const ownerWs = fakeWs();
  const enemyWs = fakeWs();
  const ownerSession = joinServer(server, ownerWs, 301, 'Sneaky', 'warlock');
  const enemySession = joinServer(server, enemyWs, 302, 'Hunter', 'warrior');
  const sim = server.sim;
  sim.setPlayerLevel(20, ownerSession.pid);
  sim.setPlayerLevel(20, enemySession.pid);
  const owner = sim.entities.get(ownerSession.pid) as Entity;
  const enemy = sim.entities.get(enemySession.pid) as Entity;
  const spot = contestedSpot();
  placeAt(server, owner, spot.x, spot.z);
  // 60yd: inside ordinary interest (90yd), far beyond the 22.5yd same-level
  // stealth detection radius, so "seen from afar" is exactly what is tested
  placeAt(server, enemy, spot.x + 60, spot.z);
  if (flagged) {
    sim.setWorldPvpFlag(true, owner.id);
    sim.setWorldPvpFlag(true, enemy.id);
  }
  summonPet(sim.ctx, owner, 'emberkin');
  const pet = sim.petOf(owner.id);
  if (!pet) throw new Error('expected a summoned demon');
  placeAt(server, pet, spot.x + 2, spot.z);
  pet.inCombat = false;
  pet.combatTimer = 99;
  return { server, owner, pet, enemy, ownerWs, enemyWs, ownerSession };
}

function drinkInvisibility(s: Scene): void {
  s.server.sim.addItem('potion_of_invisibility', 1, s.owner.id);
  s.server.sim.useItem('potion_of_invisibility', s.owner.id);
  expect(s.owner.stealthed).toBe(true);
  expect(s.owner.auras.some((a) => a.id === 'invisibility' && a.kind === 'stealth')).toBe(true);
}

describe('a stealthed owner hides their summons from enemies', () => {
  it('/pvp on: the flagged enemy loses both owner and pet at any range after the potion', () => {
    const s = scene(true);
    expect(s.server.sim.isHostileTo(s.enemy, s.owner)).toBe(true);
    broadcast(s.server);
    expect(presentIds(s.enemyWs)).toContain(s.owner.id);
    expect(presentIds(s.enemyWs)).toContain(s.pet.id);

    drinkInvisibility(s);
    broadcast(s.server);
    expect(presentIds(s.enemyWs)).not.toContain(s.owner.id);
    expect(presentIds(s.enemyWs)).not.toContain(s.pet.id);
    // the owner keeps their own pet
    expect(presentIds(s.ownerWs)).toContain(s.pet.id);

    // even standing on top of the pet, a hostile never sees it while it idles
    placeAt(s.server, s.enemy, s.pet.pos.x + 1, s.pet.pos.z);
    broadcast(s.server);
    expect(presentIds(s.enemyWs)).not.toContain(s.pet.id);
  });

  it('/pvp off: a non-hostile player out past detection range cannot spot the pet either', () => {
    const s = scene(false);
    expect(s.server.sim.isHostileTo(s.enemy, s.owner)).toBe(false);
    broadcast(s.server);
    expect(presentIds(s.enemyWs)).toContain(s.pet.id);
    drinkInvisibility(s);
    broadcast(s.server);
    expect(presentIds(s.enemyWs)).not.toContain(s.owner.id);
    expect(presentIds(s.enemyWs)).not.toContain(s.pet.id);
  });

  it('the pet reappears for the enemy the moment it is struck', () => {
    const s = scene(true);
    drinkInvisibility(s);
    broadcast(s.server);
    expect(presentIds(s.enemyWs)).not.toContain(s.pet.id);
    s.server.sim.dealDamage(s.enemy, s.pet, 1, false, 'physical', null, 'hit');
    s.pet.inCombat = false; // isolate the combat-clock arm from the AI flag
    broadcast(s.server);
    expect(presentIds(s.enemyWs)).toContain(s.pet.id);
    expect(presentIds(s.enemyWs)).not.toContain(s.owner.id);
  });
});
