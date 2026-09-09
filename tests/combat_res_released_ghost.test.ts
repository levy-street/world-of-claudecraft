// A combat resurrection must reach a group/raid member who has RELEASED.
//
// Releasing does not undo the death: `dead` stays true and `ghost` goes true while
// the body is left where it fell (src/sim/spirit.ts), and resurrection reach is
// measured to that BODY (src/sim/combat/resurrection_reach.ts). So a released raider
// is exactly as raisable as one who is still lying on the floor, and the caster
// standing over the corpse is in reach even though the spirit is at a graveyard on
// the other side of the zone.
//
// Pinned end to end here (offline Sim, the mouseover override, and the
// authoritative online server), because the player-facing failure had NO sim
// symptom: the online client dropped the ghost's entity out of interest scope and
// its mouseover cast then fell through to the current target. See
// tests/mouseover_cast_core.test.ts for that arm.

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
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type SimEvent, type Vec3 } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;

const COMBAT_REZ = 'temporal_reversal';

// An arcane mage of 20 owns the single-target combat resurrection.
function chronomancer(seed = 91): { sim: AnySim; mage: Entity } {
  const sim = new Sim({ seed, playerClass: 'mage' }) as AnySim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const mage = sim.player as Entity;
  mage.resource = mage.maxResource;
  return { sim, mage };
}

function addToGroup(sim: AnySim, leader: Entity, name: string): Entity {
  const pid = sim.addPlayer('warrior', name);
  sim.partyInvite(pid, leader.id);
  sim.partyAccept(pid);
  return sim.entities.get(pid) as Entity;
}

// Kill the member on top of the caster, then release: the spirit is teleported to a
// graveyard and the corpse stays at the caster's feet.
function killAndRelease(sim: AnySim, caster: Entity, member: Entity): void {
  member.pos = { ...caster.pos };
  member.prevPos = { ...member.pos };
  member.dead = true;
  member.hp = 0;
  member.resource = 0;
  member.corpsePos = { ...member.pos };
  sim.releaseSpirit(member.id);
  expect(member.ghost).toBe(true);
  expect(member.dead).toBe(true);
  // The spirit really did leave: the ghost is nowhere near its own body.
  expect(dist2d(member.pos, member.corpsePos as Vec3)).toBeGreaterThan(30);
}

function errorTexts(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

function runCast(sim: AnySim): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < 60; i++) events.push(...sim.tick());
  return events;
}

describe('combat resurrection on a released ghost', () => {
  it('offers, and the accepted offer stands the ghost back up at the caster', () => {
    const { sim, mage } = chronomancer();
    const ally = addToGroup(sim, mage, 'Fallen');
    killAndRelease(sim, mage, ally);

    sim.targetEntity(ally.id, mage.id);
    expect(mage.targetId).toBe(ally.id);
    sim.castAbility(COMBAT_REZ, mage.id);
    expect(mage.castingAbility).toBe(COMBAT_REZ);

    const events = runCast(sim);
    expect(errorTexts(events)).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'resurrectionOffer', pid: ally.id }),
    );
    expect(sim.pendingResurrections.has(ally.id)).toBe(true);

    sim.respondToResurrection(true, ally.id);
    expect(ally.dead).toBe(false);
    expect(ally.ghost).toBe(false);
    expect(ally.hp).toBeGreaterThan(0);
    expect(dist2d(ally.pos, mage.pos)).toBeLessThan(1);
  });

  it('accepts the mouseover override with no current target selected', () => {
    // The path the party/raid frame drives (castAbilityOn): the caster never
    // selects the ghost, the hovered member's pid rides the cast itself.
    const { sim, mage } = chronomancer(92);
    const ally = addToGroup(sim, mage, 'Fallen');
    killAndRelease(sim, mage, ally);
    mage.targetId = null;

    sim.castAbilityOn(COMBAT_REZ, ally.id, mage.id);
    expect(mage.castingAbility).toBe(COMBAT_REZ);
    const events = runCast(sim);
    expect(errorTexts(events)).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'resurrectionOffer', pid: ally.id }),
    );
  });

  it('still refuses a released member whose BODY is out of reach', () => {
    // Reach is the body, not the spirit: moving the corpse (not the ghost) out of
    // range must still refuse, so this fix never became a cross-map resurrection.
    const { sim, mage } = chronomancer(93);
    const ally = addToGroup(sim, mage, 'Fallen');
    killAndRelease(sim, mage, ally);
    ally.corpsePos = { x: mage.pos.x + 400, y: mage.pos.y, z: mage.pos.z };

    sim.targetEntity(ally.id, mage.id);
    sim.castAbility(COMBAT_REZ, mage.id);
    expect(mage.castingAbility).toBe(null);
    expect(errorTexts(sim.tick())).toContain('Out of range.');
    expect(sim.pendingResurrections.has(ally.id)).toBe(false);
  });
});

function fakeWs(): Parameters<GameServer['join']>[0] {
  return {
    readyState: 1,
    send: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    close: vi.fn(),
  } as unknown as Parameters<GameServer['join']>[0];
}

describe('combat resurrection on a released ghost, authoritative online path', () => {
  it('raises a raider who released, straight off the target + cast commands', () => {
    const server = new GameServer();
    const mageWs = fakeWs();
    const allyWs = fakeWs();
    const mageSession = server.join(mageWs, 1, 1, 'Chrona', 'mage', null);
    const allySession = server.join(allyWs, 2, 2, 'Fallen', 'priest', null);
    if ('error' in mageSession || 'error' in allySession) throw new Error('join failed');

    server.sim.setPlayerLevel(20, mageSession.pid);
    expect(server.sim.setSpec('arcane', mageSession.pid)).toBe(true);
    server.sim.tick();
    const mage = server.sim.entities.get(mageSession.pid);
    const ally = server.sim.entities.get(allySession.pid);
    if (!mage || !ally) throw new Error('players missing');
    mage.resource = mage.maxResource;
    server.sim.partyInvite(ally.id, mage.id);
    server.sim.partyAccept(ally.id);
    killAndRelease(server.sim as unknown as AnySim, mage, ally);

    server.handleMessage(mageSession, JSON.stringify({ t: 'cmd', cmd: 'target', id: ally.id }));
    expect(mage.targetId).toBe(ally.id);
    server.handleMessage(
      mageSession,
      JSON.stringify({ t: 'cmd', cmd: 'cast', ability: COMBAT_REZ }),
    );
    expect(mage.castingAbility).toBe(COMBAT_REZ);

    for (let tick = 0; tick < 60; tick++) {
      (
        server as unknown as { routeEvents(events: ReturnType<typeof server.sim.tick>): void }
      ).routeEvents(server.sim.tick());
    }

    const sent = (allyWs.send as ReturnType<typeof vi.fn>).mock.calls.map(([raw]) =>
      JSON.parse(String(raw)),
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        t: 'events',
        list: expect.arrayContaining([
          expect.objectContaining({
            type: 'resurrectionOffer',
            pid: ally.id,
            fromName: mage.name,
          }),
        ]),
      }),
    );

    server.handleMessage(
      allySession,
      JSON.stringify({ t: 'cmd', cmd: 'resurrect_respond', accept: true }),
    );
    expect(ally.dead).toBe(false);
    expect(ally.ghost).toBe(false);
    expect(dist2d(ally.pos, mage.pos)).toBeLessThan(1);
  });
});
