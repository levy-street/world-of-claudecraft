// Auto-unshift over the wire: the online arm of tests/druid_form_auto_unshift.
//
// Two things have to survive the server/client split. The cast itself is
// authoritative, so pressing a heal from Bruin Form through the real command
// path must drop the form server-side. And the action bar has to be able to
// tell the slot is live, which it can only do if it knows the mana the form
// parked, so the self snapshot carries it (sparse `sm`) and ClientWorld mirrors
// it back onto savedMana.

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

import { GameServer } from '../server/game';
import type { Entity } from '../src/sim/types';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

function joinDruid(server: GameServer, fc: ReturnType<typeof fakeWs>) {
  const session = joinServer(server, fc, 1, 'Thornmane', 'druid');
  server.sim.setPlayerLevel(20, session.pid);
  server.sim.tick();
  const druid = server.sim.entities.get(session.pid);
  if (!druid) throw new Error('druid missing');
  druid.resource = druid.maxResource;
  druid.gcdRemaining = 0;
  return { session, druid };
}

function enterBearForm(server: GameServer, session: { pid: number }, druid: Entity): void {
  server.handleMessage(
    session as never,
    JSON.stringify({ t: 'cmd', cmd: 'cast', ability: 'bear_form' }),
  );
  for (let tick = 0; tick < 40; tick++) server.sim.tick();
  expect(druid.auras.some((aura) => aura.kind === 'form_bear')).toBe(true);
  expect(druid.resourceType).toBe('rage');
  druid.gcdRemaining = 0;
  server.sim.drainEvents();
}

describe('druid auto-unshift, online', () => {
  it('drops the form server-side when the client presses a heal from Bruin Form', () => {
    const server = new GameServer();
    const { session, druid } = joinDruid(server, fakeWs());
    enterBearForm(server, session, druid);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'cast', ability: 'healing_touch' }),
    );

    // The server decides, not the client: the form is gone, the mana bar is
    // back, and the heal is casting.
    expect(server.sim.drainEvents()).not.toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(druid.auras.some((aura) => aura.kind === 'form_bear')).toBe(false);
    expect(druid.resourceType).toBe('mana');
    expect(druid.castingAbility).toBe('healing_touch');
  });

  it('mirrors the parked mana onto the client so the bar can price the cast', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const { session, druid } = joinDruid(server, fc);
    enterBearForm(server, session, druid);
    const parked = druid.savedMana;
    expect(parked).toBeGreaterThan(0);

    broadcast(server);
    const shifted = lastSnap(fc.sent);
    expect(shifted.self.sm).toBe(Math.floor(parked));

    const client = bareClient(session.pid, { playerClass: 'druid' });
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(shifted);
    expect(client.player.savedMana).toBe(Math.floor(parked));
  });

  it('floors the parked pool so the bar never lights a slot the server refuses', () => {
    // The mirrored pool must never read HIGHER than the real one: the bar
    // refuses at "pool < cost" and costs are whole numbers, so flooring makes
    // the client's test exactly the server's. Rounding a 24.6 pool up to 25
    // would paint a 25-cost heal live and then have the cast refused.
    const server = new GameServer();
    const fc = fakeWs();
    const { session, druid } = joinDruid(server, fc);
    enterBearForm(server, session, druid);
    druid.savedMana = 24.6;

    broadcast(server);
    expect(lastSnap(fc.sent).self.sm).toBe(24);
  });

  it('omits the parked pool at rest and clears a stale mirror on unshift', () => {
    // Omit-when-default: an unshifted player must not pay for the field, and the
    // client must read its absence as zero rather than stranding the last
    // parked pool on a druid who is back in caster form.
    const server = new GameServer();
    const fc = fakeWs();
    const { session, druid } = joinDruid(server, fc);

    broadcast(server);
    expect(lastSnap(fc.sent).self.sm).toBeUndefined();

    enterBearForm(server, session, druid);
    broadcast(server);
    const client = bareClient(session.pid, { playerClass: 'druid' });
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(lastSnap(fc.sent));
    expect(client.player.savedMana).toBeGreaterThan(0);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'cast', ability: 'healing_touch' }),
    );
    server.sim.tick();
    broadcast(server);
    const unshifted = lastSnap(fc.sent);
    expect(unshifted.self.sm).toBeUndefined();
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(unshifted);
    expect(client.player.savedMana).toBe(0);
  });
});
