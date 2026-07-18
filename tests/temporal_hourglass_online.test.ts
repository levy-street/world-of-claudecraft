import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import type { Entity } from '../src/sim/types';

function fakeWs(): Parameters<GameServer['join']>[0] {
  return {
    readyState: 1,
    send: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    close: vi.fn(),
  } as unknown as Parameters<GameServer['join']>[0];
}

function place(server: GameServer, entity: Entity, x: number): void {
  entity.pos = server.sim.groundPos(x, 0);
  entity.prevPos = { ...entity.pos };
  (server.sim as unknown as { rebucket(e: Entity): void }).rebucket(entity);
}

describe('Hourglass allied cancellation online', () => {
  it('accepts castAt through the authoritative command path and creates an empty-ground trap', () => {
    const server = new GameServer();
    const session = server.join(fakeWs(), 1, 1, 'Chrona', 'mage', null);
    if ('error' in session) throw new Error('join failed');
    server.sim.setPlayerLevel(14, session.pid);
    expect(server.sim.setSpec('arcane', session.pid)).toBe(true);
    server.sim.tick();
    const mage = server.sim.entities.get(session.pid);
    if (!mage) throw new Error('mage missing');
    place(server, mage, 700);
    mage.resource = mage.maxResource;

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'castAt', ability: 'temporal_hourglass', x: 708, z: 0 }),
    );

    expect(server.sim.activeTemporalHourglasses).toEqual([
      expect.objectContaining({ x: 708, z: 0, duration: 30, remaining: 30 }),
    ]);
  });

  it('routes cancel_aura to the authoritative simulation and stops every benefit', () => {
    const server = new GameServer();
    const mageSession = server.join(fakeWs(), 1, 1, 'Chrona', 'mage', null);
    const allySession = server.join(fakeWs(), 2, 2, 'Guard', 'warrior', null);
    if ('error' in mageSession || 'error' in allySession) throw new Error('join failed');

    server.sim.setPlayerLevel(14, mageSession.pid);
    expect(server.sim.setSpec('arcane', mageSession.pid)).toBe(true);
    server.sim.tick();
    const mage = server.sim.entities.get(mageSession.pid);
    const ally = server.sim.entities.get(allySession.pid);
    if (!mage || !ally) throw new Error('players missing');
    place(server, mage, 700);
    place(server, ally, 708);
    mage.resource = mage.maxResource;
    server.sim.partyInvite(ally.id, mage.id);
    server.sim.partyAccept(ally.id);
    ally.hp = Math.floor(ally.maxHp * 0.4);
    ally.inCombat = true;
    ally.combatTimer = 0;
    ally.cooldowns.set('charge', 20);

    server.sim.castAbility('temporal_hourglass', mage.id, { x: ally.pos.x, z: ally.pos.z });
    for (let tick = 0; tick < 40; tick++) server.sim.tick();
    const hpAtCancel = ally.hp;
    const cooldownAtCancel = ally.cooldowns.get('charge') ?? 0;
    expect(ally.auras.some((aura) => aura.id === 'temporal_hourglass')).toBe(true);

    server.handleMessage(
      allySession,
      JSON.stringify({ t: 'cmd', cmd: 'cancel_aura', aura: 'temporal_hourglass' }),
    );
    expect(ally.auras.some((aura) => aura.id === 'temporal_hourglass')).toBe(false);

    for (let tick = 0; tick < 20; tick++) server.sim.tick();
    expect(ally.hp).toBe(hpAtCancel);
    expect(ally.cooldowns.get('charge')).toBeCloseTo(cooldownAtCancel - 1, 5);
  });
});
