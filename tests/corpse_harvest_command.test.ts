// Intentional Gathering PR3: the public corpse-harvest COMMAND/LIFECYCLE
// integration: the thin production wrapper over the already-wired
// `startCorpseHarvest` session module (src/sim/professions/
// corpse_harvest_session.ts), exercised end to end.
//
// Frozen contracts pinned here:
//   - offline `Sim.harvestCorpse(id: number, pid?: number): boolean`, a thin
//     wrapper over `startCorpseHarvest`: no per-call `components` override,
//     `meta.harvestPreference` is the sole source of what gets extracted (the
//     legacy per-corpse town-focus default no longer applies).
//   - the online `harvestCorpse` wire command: id only, ABSENT `components`
//     is the only accepted shape (a legacy `components` field, even `[]` or
//     `null`, is refused outright with no admission/roll/grant/reservation/
//     cast), pid is derived from the authenticated session only, and a
//     positive `rid` answers through the existing `sendCommandOutcome`/
//     `commandOutcome` seam exactly like `loot`/`pickup`/`harvest_node`.
//   - `GameServer.socketClosed` must cancel an in-flight corpse harvest and
//     release its reservation SYNCHRONOUSLY (before the linkdead grace's
//     later save flush), scoped to corpse harvest only: an unrelated cast
//     and an obsolete/already-resumed socket close must not be touched.
//
// Real `Sim`/`GameServer`/ticks throughout: no stubbed harvest body. The
// underlying `startCorpseHarvest`/`validateCorpseHarvestCast`/
// `completeCorpseHarvestCast` session module is already wired into
// `combat/casting_lifecycle.ts` and exercised here completely unstubbed;
// only the PUBLIC entry points (Sim facade, wire command, disconnect arm) are
// this file's own subject.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import type { ClientSession } from '../server/game';
import { GameServer } from '../server/game';
import { MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { HARVEST_CAST_SECONDS } from '../src/sim/professions/harvest_admission';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import {
  CORPSE_HARVEST_CAST_ID,
  DT,
  type Entity,
  type SimEvent,
  type WorldContent,
} from '../src/sim/types';
import { fakeWs, joinServer } from './helpers/bare_client';
import { expectDefined } from './helpers/defined';
import { EMPTY_TEST_WORLD } from './sim_shared';

// The reviewed core rig (tests/corpse_harvest_cast.test.ts): EMPTY_TEST_WORLD
// plus roads:[] so a plain sim.tick() has no ambient rng-drawing systems
// beyond the harvest path itself.
const CORPSE_TEST_WORLD: WorldContent = { ...EMPTY_TEST_WORLD, roads: [] };

const TICKS_PER_CAST = Math.round(HARVEST_CAST_SECONDS / DT);

// A killable wolf corpse: real content (MOBS.forest_wolf, componentTags
// ['hide','fang']), hand-placed dead rather than fought down, so the rig
// exercises the real startCorpseHarvest/admission/grant chain without RNG
// combat noise. Positioned via sim.groundPos with a matching prevPos, zero
// velocity, and onGround true (the same coherent-rest rig
// corpse_harvest_cast.test.ts uses), never a bare y:0 (a fresh
// EMPTY_TEST_WORLD Sim still runs the real terrain heightfield; a hand-set
// y:0 corpse/player would silently mismatch it and read as spurious
// "movement" to the cast's own displacement check, a fixture bug, not a
// production physics one).

describe('Sim.harvestCorpse (offline, real ticks, EMPTY_TEST_WORLD)', () => {
  beforeAll(() => setActiveWorldContent(CORPSE_TEST_WORLD));
  afterAll(() => setActiveWorldContent(null));

  function placeCoherently(sim: Sim, e: Entity, x: number, z: number): void {
    e.pos = sim.groundPos(x, z);
    e.prevPos = { ...e.pos };
    e.vx = 0;
    e.vy = 0;
    e.vz = 0;
    e.onGround = true;
  }

  function rig(seed = 401) {
    const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: CORPSE_TEST_WORLD });
    const a = sim.addPlayer('warrior', 'Harvester');
    const b = sim.addPlayer('warrior', 'Bystander');
    // Distinct spots (never the exact same x,z as each other or the corpse
    // below) so nothing here relies on same-tile behavior being harmless.
    placeCoherently(sim, expectDefined(sim.entities.get(a), 'player entity a'), 0, 0);
    placeCoherently(sim, expectDefined(sim.entities.get(b), 'player entity b'), 20, 0);
    return { sim, a, b };
  }

  function spawnWolfCorpse(sim: Sim, id: number, near: { x: number; z: number }): Entity {
    const pos = sim.groundPos(near.x, near.z);
    const mob = createMob(id, MOBS.forest_wolf, MOBS.forest_wolf.maxLevel, pos);
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    sim.entities.set(mob.id, mob);
    return mob;
  }

  function mustMeta(sim: Sim, pid: number): PlayerMeta {
    return expectDefined(sim.players.get(pid), `player meta ${pid}`);
  }

  it('starts the cast and returns true before anything is granted (no instant loot)', () => {
    const { sim, a } = rig();
    sim.addItem('field_kit', 1, a);
    const mob = spawnWolfCorpse(sim, 9001, { x: 0, z: 0 });
    sim.drainEvents();

    const started = sim.harvestCorpse(mob.id, a);

    expect(started).toBe(true);
    // No material has landed yet: the cast has not ticked at all.
    expect(sim.countItem('rough_hide', a)).toBe(0);
    expect(sim.countItem('wolf_fang', a)).toBe(0);
    const actor = expectDefined(sim.entities.get(a));
    expect(actor.castingAbility).toBe(CORPSE_HARVEST_CAST_ID);
    expect(mob.corpseHarvestState?.reservedBy).toBe(a);
  });

  it('grants nothing one tick short of HARVEST_CAST_SECONDS, then completes on the final tick', () => {
    const { sim, a } = rig();
    sim.addItem('field_kit', 1, a);
    const mob = spawnWolfCorpse(sim, 9002, { x: 0, z: 0 });
    sim.drainEvents();

    expect(sim.harvestCorpse(mob.id, a)).toBe(true);

    // One tick short of completion: still casting, nothing granted yet. This
    // is the actual duration boundary (HARVEST_CAST_SECONDS / DT), not merely
    // an upper bound: a cast that finished early would fail this assertion.
    for (let i = 0; i < TICKS_PER_CAST - 1; i++) sim.tick();
    expect(expectDefined(sim.entities.get(a)).castingAbility).toBe(CORPSE_HARVEST_CAST_ID);
    expect(sim.countItem('rough_hide', a) + sim.countItem('wolf_fang', a)).toBe(0);
    expect(mob.harvestClaimedBy).toBeNull();

    // The final tick completes the cast and lands the grant, in exactly one
    // more tick, not two or more.
    let harvestResult: Extract<SimEvent, { type: 'harvestResult' }> | undefined;
    let castStopped = false;
    for (const ev of sim.tick()) {
      if (ev.type === 'harvestResult') harvestResult = ev;
      if (ev.type === 'castStop') castStopped = true;
    }

    expect(castStopped).toBe(true);
    expect(harvestResult).toBeDefined();
    expect(harvestResult?.yields.length).toBeGreaterThan(0);
    expect(sim.countItem('rough_hide', a) + sim.countItem('wolf_fang', a)).toBeGreaterThan(0);
    expect(mob.harvestClaimedBy).not.toBeNull();
    expect(mob.corpseHarvestState?.reservedBy).toBeNull();
    const actor = expectDefined(sim.entities.get(a));
    expect(actor.castingAbility).toBeNull();
  });

  it('refuses a second attempt on an already-claimed corpse: zero rng, zero further grant', () => {
    const { sim, a } = rig();
    sim.addItem('field_kit', 1, a);
    const mob = spawnWolfCorpse(sim, 9003, { x: 0, z: 0 });
    expect(sim.harvestCorpse(mob.id, a)).toBe(true);
    for (let i = 0; i < TICKS_PER_CAST; i++) sim.tick();
    sim.drainEvents();
    const grantedBefore = sim.countItem('rough_hide', a) + sim.countItem('wolf_fang', a);

    const draws: number[] = [];
    sim.rng.setObserver((v) => draws.push(v));
    const secondAttempt = sim.harvestCorpse(mob.id, a);
    sim.rng.setObserver(null);

    expect(secondAttempt).toBe(false);
    expect(draws).toEqual([]);
    expect(sim.countItem('rough_hide', a) + sim.countItem('wolf_fang', a)).toBe(grantedBefore);
  });

  it('refuses with no Field Kit: false before any mutation, reservation, or rng draw', () => {
    const { sim, a } = rig();
    const mob = spawnWolfCorpse(sim, 9004, { x: 0, z: 0 });
    sim.drainEvents();

    const draws: number[] = [];
    sim.rng.setObserver((v) => draws.push(v));
    const started = sim.harvestCorpse(mob.id, a);
    sim.rng.setObserver(null);

    expect(started).toBe(false);
    expect(draws).toEqual([]);
    expect(mob.corpseHarvestState?.reservedBy ?? null).toBeNull();
    const actor = expectDefined(sim.entities.get(a));
    expect(actor.castingAbility).toBeNull();
  });

  // NOT a payload-forgery test (the wire command test below owns that): this
  // is two distinct real players, both driven through the trusted `pid`
  // parameter directly, proving the reservation itself is exclusive rather
  // than proving anything about untrusted wire input.
  it('a second real player cannot start a harvest on a corpse another player already reserved', () => {
    const { sim, a, b } = rig();
    sim.addItem('field_kit', 1, a);
    sim.addItem('field_kit', 1, b);
    const mob = spawnWolfCorpse(sim, 9005, { x: 0, z: 0 });
    sim.drainEvents();

    // a starts and holds the reservation; b (a distinct real player) can never
    // be routed into a's in-flight attempt, and their own attempt on the SAME
    // reserved corpse is refused rather than silently reassigning it.
    expect(sim.harvestCorpse(mob.id, a)).toBe(true);
    expect(sim.harvestCorpse(mob.id, b)).toBe(false);
    expect(mob.corpseHarvestState?.reservedBy).toBe(a);
    const bEntity = expectDefined(sim.entities.get(b));
    expect(bEntity.castingAbility).toBeNull();
  });

  it('ordinary corpse loot is granted independently of an in-flight harvest cast', () => {
    const { sim, a } = rig();
    sim.addItem('field_kit', 1, a);
    const mob = spawnWolfCorpse(sim, 9006, { x: 0, z: 0 });
    mob.lootable = true;
    mob.loot = { copper: 50, items: [] };
    sim.drainEvents();
    const meta = mustMeta(sim, a);
    const copperBefore = meta.copper;

    expect(sim.harvestCorpse(mob.id, a)).toBe(true);
    // Loot mid-cast: the ordinary loot path shares no gate with the harvest
    // session and must not be blocked, delayed, or double-spent by it.
    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    expect(meta.copper).toBe(copperBefore + 50);
    // The harvest cast itself is unaffected by the loot action.
    const actor = expectDefined(sim.entities.get(a));
    expect(actor.castingAbility).toBe(CORPSE_HARVEST_CAST_ID);

    let harvestResult: unknown;
    for (let i = 0; i < TICKS_PER_CAST && !harvestResult; i++) {
      for (const ev of sim.tick()) if (ev.type === 'harvestResult') harvestResult = ev;
    }
    expect(harvestResult).toBeDefined();
  });

  it("the stored harvest preference alone resolves extraction; a caller's town-focus allocation is never consulted", () => {
    const { sim, a } = rig();
    sim.addItem('field_kit', 1, a);
    const meta = mustMeta(sim, a);
    // A pre-PR3 caller narrowed to this single tag via town focus; the
    // current command must never read it at all. `meta.harvestPreference` is
    // left at its default (All), which resolves to the empty "spread every
    // tag" pick.
    meta.townFocus.fang = 5;
    const mob = spawnWolfCorpse(sim, 9007, { x: 0, z: 0 });
    sim.drainEvents();

    expect(sim.harvestCorpse(mob.id, a)).toBe(true);

    expect(meta.corpseHarvestSession?.grant.inputs.chosenComponents).toEqual([]);
  });
});

describe('the harvestCorpse wire command (real GameServer.handleMessage)', () => {
  function joinedServer(
    characterId: number,
    name: string,
  ): { server: GameServer; session: ClientSession; fc: ReturnType<typeof fakeWs> } {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, characterId, name);
    return { server, session, fc };
  }

  function spawnCorpseAtSession(server: GameServer, session: ClientSession, id: number): Entity {
    const player = expectDefined(server.sim.entities.get(session.pid), 'player entity');
    // Placed exactly at the player's own real (already-grounded) spawn
    // position: range is trivially satisfied without touching y at all.
    const mob = createMob(id, MOBS.forest_wolf, MOBS.forest_wolf.maxLevel, { ...player.pos });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    server.sim.entities.set(mob.id, mob);
    return mob;
  }

  function sendHarvest(
    server: GameServer,
    session: ClientSession,
    extra: Record<string, unknown>,
  ): void {
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'harvestCorpse', ...extra }));
  }

  it('a valid id-only command answers the outcome true before any grant lands', () => {
    const { server, session, fc } = joinedServer(1, 'Wired');
    server.sim.addItem('field_kit', 1, session.pid);
    const mob = spawnCorpseAtSession(server, session, 9101);
    fc.sent.length = 0;

    sendHarvest(server, session, { id: mob.id, rid: 1 });

    const outcome = fc.sent.find((f) => f.t === 'commandOutcome');
    expect(outcome).toEqual({ t: 'commandOutcome', rid: 1, ok: true });
    expect(
      server.sim.countItem('rough_hide', session.pid) +
        server.sim.countItem('wolf_fang', session.pid),
    ).toBe(0);
    expect(mob.corpseHarvestState?.reservedBy).toBe(session.pid);
  });

  it('derives pid from the session, never a forged payload pid', () => {
    const { server, session: a } = joinedServer(1, 'Alpha');
    server.sim.addItem('field_kit', 1, a.pid);
    const fcB = fakeWs();
    const b = joinServer(server, fcB, 2, 'Beta');
    const mob = spawnCorpseAtSession(server, a, 9102);

    sendHarvest(server, a, { id: mob.id, pid: b.pid, characterId: b.characterId });

    expect(mob.corpseHarvestState?.reservedBy).toBe(a.pid);
    expect(mob.corpseHarvestState?.reservedBy).not.toBe(b.pid);
  });

  const legacyComponentPayloads: unknown[] = [[], null, ['hide'], ['hide', 'fang']];
  for (const components of legacyComponentPayloads) {
    it(`rejects a legacy components field (${JSON.stringify(components)}): no admission, reservation, cast, or rng`, () => {
      const { server, session, fc } = joinedServer(1, 'Legacy');
      server.sim.addItem('field_kit', 1, session.pid);
      const mob = spawnCorpseAtSession(server, session, 9103);
      fc.sent.length = 0;
      const draws: number[] = [];
      server.sim.rng.setObserver((v) => draws.push(v));

      sendHarvest(server, session, { id: mob.id, components, rid: 2 });

      server.sim.rng.setObserver(null);
      expect(draws).toEqual([]);
      expect(mob.corpseHarvestState?.reservedBy ?? null).toBeNull();
      expect(mob.harvestClaimedBy).toBeNull();
      const actor = expectDefined(server.sim.entities.get(session.pid));
      expect(actor.castingAbility).toBeNull();
      const outcome = fc.sent.find((f) => f.t === 'commandOutcome');
      expect(outcome).toEqual({ t: 'commandOutcome', rid: 2, ok: false });
    });
  }

  it('a missing id is a no-op: no reservation, no cast, no rng, and a false outcome', () => {
    const { server, session, fc } = joinedServer(1, 'NoId');
    server.sim.addItem('field_kit', 1, session.pid);
    fc.sent.length = 0;
    const draws: number[] = [];
    server.sim.rng.setObserver((v) => draws.push(v));

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'harvestCorpse', rid: 3 }));

    server.sim.rng.setObserver(null);
    expect(draws).toEqual([]);
    const actor = expectDefined(server.sim.entities.get(session.pid));
    expect(actor.castingAbility).toBeNull();
    const outcome = fc.sent.find((f) => f.t === 'commandOutcome');
    expect(outcome).toEqual({ t: 'commandOutcome', rid: 3, ok: false });
  });
});

describe('GameServer.socketClosed cancels an in-flight corpse harvest before the grace save flush', () => {
  function fakeWsForClose() {
    const ws: any = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(() => {
        ws.readyState = 3;
      }),
    };
    return ws;
  }

  function joinAndHarvest(): { server: GameServer; session: ClientSession; ws: any; mob: Entity } {
    const server = new GameServer();
    const ws = fakeWsForClose();
    const joined = server.join(ws, 11, 101, 'Linkdead', 'warrior', null);
    if ('error' in joined) throw new Error(joined.error);
    const session = joined;
    server.sim.addItem('field_kit', 1, session.pid);
    const player = expectDefined(server.sim.entities.get(session.pid));
    const mob = createMob(9201, MOBS.forest_wolf, MOBS.forest_wolf.maxLevel, { ...player.pos });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    server.sim.entities.set(mob.id, mob);
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'harvestCorpse', id: mob.id, rid: 1 }),
    );
    return { server, session, ws, mob };
  }

  it('releases the reservation and clears the cast synchronously, strictly before the real GameServer.saveCharacter entry point runs', () => {
    const { server, session, ws, mob } = joinAndHarvest();
    expect(mob.corpseHarvestState?.reservedBy).toBe(session.pid);
    const actor = expectDefined(server.sim.entities.get(session.pid));
    expect(actor.castingAbility).toBe(CORPSE_HARVEST_CAST_ID);

    // Spy on the REAL `GameServer.saveCharacter` entry point via a narrow
    // sanctioned test cast: this rig's socketClosed path never reaches the
    // mocked DB layer synchronously (it is queued behind a serial writer), so
    // a DB-level spy proves nothing about ordering. Record the live state
    // synchronously at entry, then resolve immediately; the assertion itself
    // stays OUTSIDE the callback because the server catches a rejected save
    // callback (a failed `expect` inside it would be swallowed, not fail the
    // test).
    let recordedAtSaveEntry: { reservedBy: number | null; castingAbility: string | null } | null =
      null;
    const serverForSave = server as unknown as {
      saveCharacter(session: ClientSession, opts: unknown): Promise<void>;
    };
    const saveSpy = vi.spyOn(serverForSave, 'saveCharacter').mockImplementation(() => {
      recordedAtSaveEntry = {
        reservedBy: mob.corpseHarvestState?.reservedBy ?? null,
        castingAbility: actor.castingAbility,
      };
      return Promise.resolve();
    });

    ws.readyState = 3;
    server.socketClosed(session, ws);

    // Also true synchronously, immediately after socketClosed returns: no
    // tick, no await, no expiry sweep has run yet.
    expect(mob.corpseHarvestState?.reservedBy ?? null).toBeNull();
    expect(actor.castingAbility).not.toBe(CORPSE_HARVEST_CAST_ID);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(recordedAtSaveEntry).toEqual({ reservedBy: null, castingAbility: null });

    saveSpy.mockRestore();
  });

  it('grants nothing even after the full grace window expires and the leave/save flush finally runs', async () => {
    const { server, session, ws, mob } = joinAndHarvest();

    ws.readyState = 3;
    server.socketClosed(session, ws);
    for (let i = 0; i < TICKS_PER_CAST; i++) server.sim.tick();
    session.graceUntil = Date.now() - 1;
    (server as unknown as { expireLinkdeadSessions(): void }).expireLinkdeadSessions();

    await vi.waitFor(() => {
      expect(
        (server as unknown as { sessionByCharacterId(id: number): unknown }).sessionByCharacterId(
          101,
        ),
      ).toBeNull();
    });
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it("an obsolete close from a pre-resume socket is a no-op and never touches the resumed session's live harvest", () => {
    const { server, session, ws, mob } = joinAndHarvest();
    ws.readyState = 3;
    server.socketClosed(session, ws); // first (valid) drop: cancels the harvest

    const ws2 = fakeWsForClose();
    const resumed = server.join(ws2, 11, 101, 'Linkdead', 'warrior', null);
    if ('error' in resumed) throw new Error(resumed.error);
    // Start a FRESH harvest on the resumed connection.
    server.handleMessage(
      resumed,
      JSON.stringify({ t: 'cmd', cmd: 'harvestCorpse', id: mob.id, rid: 2 }),
    );
    expect(mob.corpseHarvestState?.reservedBy).toBe(resumed.pid);

    // The stale FIRST socket's close arrives late (a real double-close race):
    // must be a no-op, never touching the resumed session's fresh reservation.
    expect(server.socketClosed(session, ws)).toBe(false);
    expect(mob.corpseHarvestState?.reservedBy).toBe(resumed.pid);
    const actor = expectDefined(server.sim.entities.get(resumed.pid));
    expect(actor.castingAbility).toBe(CORPSE_HARVEST_CAST_ID);
  });

  it('a genuine drop cancels ONLY the corpse harvest, leaving an unrelated concurrent cast untouched', () => {
    const { server, session } = joinAndHarvest();
    const actor = expectDefined(server.sim.entities.get(session.pid));
    // Stamp an unrelated ordinary cast directly (no real ability needed to
    // prove scope): the new disconnect arm must be scoped to
    // CORPSE_HARVEST_CAST_ID specifically, never a blanket "any cast" cancel.
    // The corpse-harvest cast is already occupying castingAbility from
    // joinAndHarvest, so this test drives a SECOND session with its own
    // unrelated cast instead of overwriting the first.
    const fc2 = fakeWsForClose();
    const other = server.join(fc2, 12, 102, 'Caster', 'mage', null);
    if ('error' in other) throw new Error(other.error);
    const otherActor = expectDefined(server.sim.entities.get(other.pid));
    otherActor.castingAbility = 'fireball';
    otherActor.castRemaining = 2;
    otherActor.castTotal = 3;

    fc2.readyState = 3;
    server.socketClosed(other, fc2);

    // The unrelated session's own cast is untouched by this arm (whatever the
    // pre-existing linkdead behavior for an ordinary cast is, it must not be
    // this new corpse-harvest-specific hook that changes it).
    expect(otherActor.castingAbility).toBe('fireball');
    // Meanwhile the ORIGINAL session's corpse harvest is unaffected by a
    // different session's drop.
    expect(actor.castingAbility).toBe(CORPSE_HARVEST_CAST_ID);
  });
});
