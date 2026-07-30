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
  walletForAccount: vi.fn(async () => null),
}));

import { GameServer, wireEntity } from '../server/game';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
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

function finishFireballFormCast(server: GameServer, mage: Entity): void {
  expect(mage.castingAbility).toBe('fireball_form');
  expect(mage.auras.some((aura) => aura.kind === 'form_fireball')).toBe(false);
  for (let tick = 0; tick < 40; tick++) server.sim.tick();
  expect(mage.castingAbility).toBeNull();
  expect(mage.auras.some((aura) => aura.kind === 'form_fireball')).toBe(true);
}

describe('Mage Fireball Form online authority', () => {
  it('casts through the authoritative command path and serializes the form aura', () => {
    const server = new GameServer();
    const session = server.join(fakeWs(), 1, 1, 'Ember', 'mage', null);
    if ('error' in session) throw new Error('join failed');
    server.sim.setPlayerLevel(11, session.pid);
    expect(server.sim.setSpec('arcane', session.pid)).toBe(true);
    server.sim.tick();
    const mage = server.sim.entities.get(session.pid);
    if (!mage) throw new Error('mage missing');
    mage.resource = mage.maxResource;
    mage.gcdRemaining = 0;
    expect(server.sim.resolvedAbility('fireball_form', session.pid)).not.toBeNull();
    expect(mage.auras.some((aura) => aura.id === 'fireball_form')).toBe(false);
    expect(mage.castingAbility).toBeNull();
    expect(mage.cooldowns.has('fireball_form')).toBe(false);
    expect(mage.dead).toBe(false);
    expect(mage.auras.filter((aura) => aura.kind === 'stasis')).toEqual([]);
    server.sim.drainEvents();

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'cast', ability: 'fireball_form' }),
    );

    expect(server.sim.drainEvents()).not.toContainEqual(expect.objectContaining({ type: 'error' }));
    finishFireballFormCast(server, mage);
    expect(mage.auras.find((aura) => aura.id === 'fireball_form')).toMatchObject({
      kind: 'form_fireball',
      value: 1.4,
    });
    expect(server.sim.moveSpeedMult(mage)).toBeCloseTo(1.4, 5);
    expect(wireEntity(mage)).toMatchObject({
      auras: [expect.objectContaining({ id: 'fireball_form', kind: 'form_fireball', value: 1.4 })],
    });
  });

  it('rejects the online Attack command while the form is active', () => {
    const server = new GameServer();
    const session = server.join(fakeWs(), 1, 1, 'Ember', 'mage', null);
    if ('error' in session) throw new Error('join failed');
    server.sim.setPlayerLevel(11, session.pid);
    server.sim.tick();
    const mage = server.sim.entities.get(session.pid);
    if (!mage) throw new Error('mage missing');
    mage.resource = mage.maxResource;
    mage.gcdRemaining = 0;
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'cast', ability: 'fireball_form' }),
    );
    finishFireballFormCast(server, mage);
    const target = createMob(94001, MOBS.training_dummy, 11, {
      x: mage.pos.x,
      y: mage.pos.y,
      z: mage.pos.z + 4,
    });
    (server.sim as unknown as { addEntity(entity: Entity): void }).addEntity(target);
    server.sim.targetEntity(target.id, session.pid);

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'attack' }));

    expect(mage.autoAttack).toBe(false);
  });

  it('blocks online spell casts and restores control when toggled off authoritatively', () => {
    const server = new GameServer();
    const session = server.join(fakeWs(), 1, 1, 'Ember', 'mage', null);
    if ('error' in session) throw new Error('join failed');
    server.sim.setPlayerLevel(11, session.pid);
    server.sim.tick();
    const mage = server.sim.entities.get(session.pid);
    if (!mage) throw new Error('mage missing');
    mage.resource = mage.maxResource;
    mage.gcdRemaining = 0;
    const target = createMob(94002, MOBS.training_dummy, 11, {
      x: mage.pos.x,
      y: mage.pos.y,
      z: mage.pos.z + 4,
    });
    (server.sim as unknown as { addEntity(entity: Entity): void }).addEntity(target);
    server.sim.targetEntity(target.id, session.pid);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'cast', ability: 'fireball_form' }),
    );
    finishFireballFormCast(server, mage);
    mage.gcdRemaining = 0;

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'cast', ability: 'fireball' }));

    expect(mage.castingAbility).toBeNull();
    expect(server.sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'error', text: "You can't do that while shapeshifted." }),
    );

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'cast', ability: 'fireball_form' }),
    );

    expect(mage.auras.some((aura) => aura.kind === 'form_fireball')).toBe(false);
    expect(server.sim.moveSpeedMult(mage)).toBeCloseTo(1, 5);
    mage.gcdRemaining = 0;
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'cast', ability: 'fireball' }));
    expect(mage.castingAbility).toBe('fireball');
  });
});
