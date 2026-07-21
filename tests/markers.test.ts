import { describe, expect, it, vi } from 'vitest';

// The server self-wire tests pull in server/game.ts, which imports the db
// layer — mock it so no Postgres is required (vi.mock is hoisted).
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
import type { Entity } from '../src/sim/types';

// Raid marker ids (0..7), the classic raid-marker order: Star, Circle, Diamond, Triangle, Moon,
// Square, Cross, Skull.
const STAR = 0;
const SKULL = 7;

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// Wild, live, hostile mobs are spawned from CAMPS in the Sim constructor.
function liveMobs(sim: Sim, n: number): Entity[] {
  const mobs = [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && !e.dead && e.hostile && e.ownerId === null,
  );
  if (mobs.length < n) throw new Error(`test needs ${n} mobs, found ${mobs.length}`);
  return mobs.slice(0, n);
}

// Build a party led by pids[0] with the rest as members.
function makeParty(sim: Sim, ...pids: number[]): void {
  for (let i = 1; i < pids.length; i++) {
    sim.partyInvite(pids[i], pids[0]);
    sim.partyAccept(pids[i]);
  }
}

describe('target markers — sim layer', () => {
  it('a marker set by one party member is visible to the whole party, not outsiders', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel'); // outsider
    makeParty(sim, a, b);
    const [mob] = liveMobs(sim, 1);

    sim.setMarker(mob.id, SKULL, a);

    expect(sim.markersFor(a)).toEqual({ [mob.id]: SKULL });
    expect(sim.markersFor(b)).toEqual({ [mob.id]: SKULL });
    expect(sim.markersFor(c)).toEqual({}); // outsider sees nothing
  });

  it('two separate parties can mark the same mob independently', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    const d = sim.addPlayer('priest', 'Dalet');
    makeParty(sim, a, b);
    makeParty(sim, c, d);
    const [mob] = liveMobs(sim, 1);

    sim.setMarker(mob.id, SKULL, a);
    sim.setMarker(mob.id, STAR, c);

    expect(sim.markersFor(a)[mob.id]).toBe(SKULL);
    expect(sim.markersFor(c)[mob.id]).toBe(STAR);
  });

  it('a symbol is unique within a party — re-assigning it moves it off the old mob', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    makeParty(sim, a, b);
    const [mob1, mob2] = liveMobs(sim, 2);

    sim.setMarker(mob1.id, SKULL, a);
    sim.setMarker(mob2.id, SKULL, b); // same symbol, different mob

    expect(sim.markersFor(a)).toEqual({ [mob2.id]: SKULL }); // moved, not duplicated
  });

  it('re-applying the same symbol to the same mob toggles it off', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    makeParty(sim, a, b);
    const [mob] = liveMobs(sim, 1);

    sim.setMarker(mob.id, SKULL, a);
    sim.setMarker(mob.id, SKULL, a); // toggle

    expect(sim.markersFor(a)).toEqual({});
  });

  it('clearMarker removes a mark for the party', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    makeParty(sim, a, b);
    const [mob] = liveMobs(sim, 1);

    sim.setMarker(mob.id, SKULL, a);
    sim.clearMarker(mob.id, b);

    expect(sim.markersFor(a)).toEqual({});
    expect(sim.markersFor(b)).toEqual({});
  });

  describe('validation', () => {
    it('does nothing when the actor has no party', () => {
      const sim = makeWorld();
      const lone = sim.addPlayer('warrior', 'Aleph');
      const [mob] = liveMobs(sim, 1);

      sim.setMarker(mob.id, SKULL, lone);

      expect(sim.markersFor(lone)).toEqual({});
    });

    it('rejects out-of-range and non-integer marker ids', () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      const b = sim.addPlayer('mage', 'Bet');
      makeParty(sim, a, b);
      const [mob] = liveMobs(sim, 1);

      sim.setMarker(mob.id, 8, a);
      sim.setMarker(mob.id, -1, a);
      sim.setMarker(mob.id, 1.5, a);

      expect(sim.markersFor(a)).toEqual({});
    });

    it('refuses to mark a non-mob (e.g. a player)', () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      const b = sim.addPlayer('mage', 'Bet');
      makeParty(sim, a, b);

      sim.setMarker(b, SKULL, a); // b is a player entity

      expect(sim.markersFor(a)).toEqual({});
    });

    it('refuses to mark a dead mob', () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      const b = sim.addPlayer('mage', 'Bet');
      makeParty(sim, a, b);
      const [mob] = liveMobs(sim, 1);
      mob.dead = true;

      sim.setMarker(mob.id, SKULL, a);

      expect(sim.markersFor(a)).toEqual({});
    });

    it('refuses to mark an owned pet/summon (ownerId set)', () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      const b = sim.addPlayer('mage', 'Bet');
      makeParty(sim, a, b);
      const [mob] = liveMobs(sim, 1);
      mob.ownerId = b; // now a controlled pet, not a wild enemy

      sim.setMarker(mob.id, SKULL, a);

      expect(sim.markersFor(a)).toEqual({});
    });
  });

  describe('lifecycle cleanup', () => {
    it('clears a mark when the marked mob dies (so it cannot reappear on respawn)', () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      const b = sim.addPlayer('mage', 'Bet');
      makeParty(sim, a, b);
      const [mob] = liveMobs(sim, 1);

      sim.setMarker(mob.id, SKULL, a);
      // respawnMob reuses the same entity id, so the mark must be cleared on death
      (sim as unknown as { handleDeath(e: Entity, killer: Entity | null): void }).handleDeath(
        mob,
        null,
      );

      expect(sim.markersFor(a)).toEqual({});
    });

    it('clears a mark when the marked entity despawns', () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      const b = sim.addPlayer('mage', 'Bet');
      makeParty(sim, a, b);
      const [mob] = liveMobs(sim, 1);

      sim.setMarker(mob.id, SKULL, a);
      (sim as unknown as { dropEntity(id: number): void }).dropEntity(mob.id);

      expect(sim.markersFor(a)).toEqual({});
    });

    it('clears a mark when the marked mob is tamed into a pet', () => {
      const sim = makeWorld();
      const hunter = sim.addPlayer('hunter', 'Aleph');
      const b = sim.addPlayer('mage', 'Bet');
      makeParty(sim, hunter, b);
      const wolf = [...sim.entities.values()].find(
        (e) =>
          e.kind === 'mob' &&
          !e.dead &&
          e.hostile &&
          e.ownerId === null &&
          e.templateId === 'forest_wolf',
      );
      if (!wolf) throw new Error('expected a tameable forest_wolf in the overworld');
      const hunterE = sim.entities.get(hunter)!;
      hunterE.level = 20; // out-level the wolf so taming is permitted

      sim.setMarker(wolf.id, SKULL, hunter);
      expect(sim.markersFor(hunter)).toEqual({ [wolf.id]: SKULL });

      (sim as unknown as { completeTame(p: Entity, target: Entity): void }).completeTame(
        hunterE,
        wolf,
      );

      const pet = sim.petOf(hunter);
      expect(pet?.ownerId).toBe(hunter); // it created an owned pet copy
      expect(pet?.id).not.toBe(wolf.id);
      expect(sim.entities.has(wolf.id)).toBe(false);
      expect(sim.markersFor(hunter)).toEqual({}); // and the stale mark is gone
    });
  });

  describe('party lifecycle', () => {
    it('marks survive a non-fatal member departure', () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      const b = sim.addPlayer('mage', 'Bet');
      const c = sim.addPlayer('rogue', 'Gimel');
      makeParty(sim, a, b, c);
      const [mob] = liveMobs(sim, 1);

      sim.setMarker(mob.id, SKULL, a);
      sim.partyLeave(c); // party still has a + b

      expect(sim.markersFor(a)).toEqual({ [mob.id]: SKULL });
    });

    it('clears all marks when the party disbands', () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      const b = sim.addPlayer('mage', 'Bet');
      makeParty(sim, a, b);
      const [mob] = liveMobs(sim, 1);

      sim.setMarker(mob.id, SKULL, a);
      sim.partyLeave(b); // drops to 1 member -> disband

      expect(sim.markersFor(a)).toEqual({});
    });
  });
});

describe('target markers — server self-wire', () => {
  function fakeWs() {
    const sent: any[] = [];
    return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
  }
  function lastSnap(sent: any[]): any {
    for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === 'snap') return sent[i];
    return null;
  }
  function serverMob(server: GameServer): Entity {
    const mob = [...server.sim.entities.values()].find(
      (e) => e.kind === 'mob' && !e.dead && e.hostile && e.ownerId === null,
    );
    if (!mob) throw new Error('no wild mob in server sim');
    return mob;
  }
  function join(server: GameServer, fc: { ws: any }, id: number, name: string) {
    const s = server.join(fc.ws, id, id, name, 'warrior', null);
    if ('error' in s) throw new Error(s.error);
    return s;
  }
  function cmd(server: GameServer, session: unknown, payload: object) {
    server.handleMessage(session as never, JSON.stringify({ t: 'cmd', ...payload }));
  }

  it('delivers a mark to the whole party via the self-wire, and not to outsiders', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const sA = join(server, fcA, 1, 'Aleph');
    const fcB = fakeWs();
    const sB = join(server, fcB, 2, 'Bet');
    const fcC = fakeWs();
    join(server, fcC, 3, 'Gimel'); // outsider, never in a party
    cmd(server, sA, { cmd: 'pinvite', id: sB.pid });
    cmd(server, sB, { cmd: 'paccept' });
    const mob = serverMob(server);

    cmd(server, sA, { cmd: 'setMarker', id: mob.id, marker: SKULL });
    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();

    expect(lastSnap(fcA.sent).self.marks).toEqual({ [mob.id]: SKULL });
    expect(lastSnap(fcB.sent).self.marks).toEqual({ [mob.id]: SKULL });
    expect(lastSnap(fcC.sent).self.marks).toBeNull(); // no party -> null on the wire
  });

  it('sends a clear (null) when the party disbands', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const sA = join(server, fcA, 1, 'Aleph');
    const fcB = fakeWs();
    const sB = join(server, fcB, 2, 'Bet');
    cmd(server, sA, { cmd: 'pinvite', id: sB.pid });
    cmd(server, sB, { cmd: 'paccept' });
    const mob = serverMob(server);
    cmd(server, sA, { cmd: 'setMarker', id: mob.id, marker: SKULL });
    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
    expect(lastSnap(fcA.sent).self.marks).toEqual({ [mob.id]: SKULL });

    cmd(server, sB, { cmd: 'pleave' }); // drops party to 1 -> disband
    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();

    expect(lastSnap(fcA.sent).self.marks).toBeNull();
  });
});
