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
import {
  createDungeonEntryFacingFence,
  filterDungeonEntryFacing,
} from '../../server/dungeon_entry_facing';
import { type ClientSession, GameServer } from '../../server/game';
import { DUNGEONS, instanceOrigin } from '../../src/sim/data';
import { DUNGEON_ENTRY_FACING_WIRE_VERSION } from '../../src/world_api';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from '../helpers/bare_client';

describe('server dungeon entry facing fence', () => {
  it('requires the exact entry token and accepts it after the client starts turning', () => {
    let state = createDungeonEntryFacingFence(0);
    const firstStale = filterDungeonEntryFacing(state, true, 1, 0, 0, null);
    state = firstStale.state;
    expect(firstStale.facing).toBeNull();
    expect(firstStale.blockTurn).toBe(true);

    const secondStale = filterDungeonEntryFacing(state, true, 1, 0, Math.PI, null);
    state = secondStale.state;
    expect(secondStale.facing).toBeNull();

    expect(filterDungeonEntryFacing(state, true, 1, 0, 0, 2).facing).toBeNull();

    const echo = filterDungeonEntryFacing(state, true, 1, 0, Math.PI, 1);
    expect(echo.facing).toBe(0);
    expect(echo.blockTurn).toBe(true);
    expect(echo.state.requiredEntrySeq).toBeNull();
    expect(echo.state.requiredFacing).toBeNull();
  });

  it('preserves freedom after acknowledgement and re-arms on same-dungeon re-entry', () => {
    const entered = filterDungeonEntryFacing(createDungeonEntryFacingFence(0), true, 1, 0, 0, 1);
    const turned = filterDungeonEntryFacing(entered.state, true, 1, 0, 1.25, null);
    expect(turned.facing).toBe(1.25);
    const exited = filterDungeonEntryFacing(turned.state, false, 1, 1.25, Math.PI, null);
    expect(exited.facing).toBe(Math.PI);
    const reentered = filterDungeonEntryFacing(exited.state, true, 2, 0, Math.PI, null);
    expect(reentered.facing).toBeNull();
    expect(reentered.blockTurn).toBe(true);
    const staleAck = filterDungeonEntryFacing(reentered.state, true, 2, 0, 0, 1);
    expect(staleAck.facing).toBeNull();
    expect(staleAck.state.requiredEntrySeq).toBe(2);
    expect(filterDungeonEntryFacing(staleAck.state, true, 2, 0, Math.PI, 2).facing).toBe(0);
  });

  it('accepts the exact token when the client has no camera heading', () => {
    const entered = filterDungeonEntryFacing(createDungeonEntryFacingFence(0), true, 1, 0, null, 1);
    expect(entered.facing).toBe(0);
    expect(entered.state.requiredEntrySeq).toBeNull();
  });

  it('leaves legacy clients on the unfenced input path', () => {
    const legacy = filterDungeonEntryFacing(
      createDungeonEntryFacingFence(0, false),
      true,
      1,
      0,
      Math.PI,
      null,
    );
    expect(legacy).toMatchObject({ facing: Math.PI, blockTurn: false });
  });

  it('keeps forward movement but blocks stale facing and turns through GameServer', () => {
    const server = new GameServer();
    const client = fakeWs();
    const session = joinServer(server, client, 101, 'Facing Tester', 'warrior', {
      dungeonEntryFacingWireVersion: DUNGEON_ENTRY_FACING_WIRE_VERSION,
    });
    const entity = server.sim.entities.get(session.pid);
    const meta = server.sim.meta(session.pid);
    if (!entity || !meta) throw new Error('joined player missing');
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);
    broadcast(server);
    expect(lastSnap(client.sent).self.de).toBe(0);
    entity.pos = { ...entity.pos, x: origin.x + crypt.entry.x, z: origin.z + crypt.entry.z };
    entity.prevPos = { ...entity.pos };
    entity.facing = 0;
    entity.dungeonEntrySeq = 1;

    broadcast(server);
    expect(lastSnap(client.sent).self.de).toBe(1);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'input', seq: 1, mi: { f: 1, tl: 1 }, facing: 0 }),
    );
    expect(entity.facing).toBe(0);
    expect(meta.moveInput).toMatchObject({ forward: true, turnLeft: false });

    session.linkdead = true;
    const resumedClient = fakeWs();
    const resumed = server.join(
      resumedClient.ws,
      101,
      101,
      'Facing Tester',
      'warrior',
      null,
      false,
      { dungeonEntryFacingWireVersion: DUNGEON_ENTRY_FACING_WIRE_VERSION },
    );
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed).toBe(session);
    expect(session.dungeonEntryFacing.requiredEntrySeq).toBe(1);
    broadcast(server);
    expect(lastSnap(resumedClient.sent).self.de).toBe(1);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'input', seq: 2, mi: { f: 1, tr: 1 }, facing: Math.PI }),
    );
    expect(entity.facing).toBe(0);
    expect(meta.moveInput).toMatchObject({ forward: true, turnRight: false });

    server.handleMessage(
      session,
      JSON.stringify({ t: 'input', seq: 3, mi: { f: 1, tr: 1 }, facing: Math.PI, de: 1 }),
    );
    expect(entity.facing).toBe(0);
    expect(meta.moveInput).toMatchObject({ forward: true, turnRight: false });

    server.handleMessage(
      session,
      JSON.stringify({ t: 'input', seq: 4, mi: { f: 1, tr: 1 }, facing: 1.25 }),
    );
    expect(entity.facing).toBe(1.25);
    expect(meta.moveInput).toMatchObject({ forward: true, turnRight: true });
  });

  it('keeps a legacy GameServer session unfenced and omits the token wire', () => {
    const server = new GameServer();
    const client = fakeWs();
    const session = joinServer(server, client, 202, 'Legacy Facing');
    const entity = server.sim.entities.get(session.pid);
    const meta = server.sim.meta(session.pid);
    if (!entity || !meta) throw new Error('joined player missing');
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);
    entity.pos = { ...entity.pos, x: origin.x + crypt.entry.x, z: origin.z + crypt.entry.z };
    entity.dungeonEntrySeq = 1;

    server.handleMessage(
      session,
      JSON.stringify({ t: 'input', seq: 1, mi: { f: 1, tl: 1 }, facing: Math.PI }),
    );
    expect(entity.facing).toBe(Math.PI);
    expect(meta.moveInput).toMatchObject({ forward: true, turnLeft: true });
    broadcast(server);
    expect(lastSnap(client.sent).self).not.toHaveProperty('de');
  });

  it('clears a pending fence when the player leaves the dungeon', () => {
    const server = new GameServer();
    const client = fakeWs();
    const session = joinServer(server, client, 252, 'Exit Facing', 'warrior', {
      dungeonEntryFacingWireVersion: DUNGEON_ENTRY_FACING_WIRE_VERSION,
    });
    const entity = server.sim.entities.get(session.pid);
    const meta = server.sim.meta(session.pid);
    if (!entity || !meta) throw new Error('joined player missing');
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);
    entity.pos = { ...entity.pos, x: origin.x + crypt.entry.x, z: origin.z + crypt.entry.z };
    entity.dungeonEntrySeq = 1;
    server.handleMessage(
      session,
      JSON.stringify({ t: 'input', seq: 1, mi: { tr: 1 }, facing: Math.PI }),
    );
    expect(session.dungeonEntryFacing.requiredEntrySeq).toBe(1);
    expect(meta.moveInput.turnRight).toBe(false);

    entity.pos = { ...entity.pos, x: crypt.doorPos.x, z: crypt.doorPos.z };
    server.handleMessage(
      session,
      JSON.stringify({ t: 'input', seq: 2, mi: { tr: 1 }, facing: Math.PI }),
    );
    expect(session.dungeonEntryFacing.requiredEntrySeq).toBeNull();
    expect(entity.facing).toBe(Math.PI);
    expect(meta.moveInput.turnRight).toBe(true);
  });

  it('disables a pending capable fence when a resumed client omits the capability', () => {
    const server = new GameServer();
    const client = fakeWs();
    const session = joinServer(server, client, 303, 'Downgrade Facing', 'warrior', {
      dungeonEntryFacingWireVersion: DUNGEON_ENTRY_FACING_WIRE_VERSION,
    });
    const entity = server.sim.entities.get(session.pid);
    const meta = server.sim.meta(session.pid);
    if (!entity || !meta) throw new Error('joined player missing');
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);
    entity.pos = { ...entity.pos, x: origin.x + crypt.entry.x, z: origin.z + crypt.entry.z };
    entity.dungeonEntrySeq = 1;
    server.handleMessage(
      session,
      JSON.stringify({ t: 'input', seq: 1, mi: { tr: 1 }, facing: Math.PI }),
    );
    expect(session.dungeonEntryFacing.requiredEntrySeq).toBe(1);

    session.linkdead = true;
    const legacyClient = fakeWs();
    const resumed = server.join(
      legacyClient.ws,
      303,
      303,
      'Downgrade Facing',
      'warrior',
      null,
      false,
      {},
    );
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed).toBe(session);
    expect(session.dungeonEntryFacing.enabled).toBe(false);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'input', seq: 2, mi: { tr: 1 }, facing: Math.PI }),
    );
    expect(entity.facing).toBe(Math.PI);
    expect(meta.moveInput.turnRight).toBe(true);
    broadcast(server);
    expect(lastSnap(legacyClient.sent).self).not.toHaveProperty('de');
  });

  it('enables entry fencing when a legacy session resumes with the capability', () => {
    const server = new GameServer();
    const legacyClient = fakeWs();
    const session = joinServer(server, legacyClient, 353, 'Upgrade Facing');
    const entity = server.sim.entities.get(session.pid);
    const meta = server.sim.meta(session.pid);
    if (!entity || !meta) throw new Error('joined player missing');
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);
    entity.pos = { ...entity.pos, x: origin.x + crypt.entry.x, z: origin.z + crypt.entry.z };
    entity.dungeonEntrySeq = 1;

    session.linkdead = true;
    const capableClient = fakeWs();
    const resumed = server.join(
      capableClient.ws,
      353,
      353,
      'Upgrade Facing',
      'warrior',
      null,
      false,
      { dungeonEntryFacingWireVersion: DUNGEON_ENTRY_FACING_WIRE_VERSION },
    );
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed).toBe(session);
    expect(session.dungeonEntryFacing).toMatchObject({ enabled: true, entrySeq: 1 });
    broadcast(server);
    expect(lastSnap(capableClient.sent).self.de).toBe(1);

    entity.dungeonEntrySeq = 2;
    server.handleMessage(
      session,
      JSON.stringify({ t: 'input', seq: 1, mi: { tr: 1 }, facing: Math.PI }),
    );
    expect(session.dungeonEntryFacing.requiredEntrySeq).toBe(2);
    expect(meta.moveInput.turnRight).toBe(false);
  });

  it('runs the de delta lifecycle: first send, change resend, elision, and mirror preservation', () => {
    // The capability-gated `de` token registered in tests/snapshots.test.ts's
    // delta-key registry (CAPABILITY_DELTA_KEYS): a DIRECT maybeSerialized emit,
    // so this pins the delta contract the shared maybe() suite cannot reach
    // (its fixture is a legacy session by design). Legacy exclusion is pinned
    // by the legacy/downgrade tests above.
    const server = new GameServer();
    const client = fakeWs();
    const session = joinServer(server, client, 454, 'Delta Facing', 'warrior', {
      dungeonEntryFacingWireVersion: DUNGEON_ENTRY_FACING_WIRE_VERSION,
    });
    const entity = server.sim.entities.get(session.pid);
    if (!entity) throw new Error('joined player missing');

    // First send: a fresh session's lastSent has no key, so a capable session
    // receives the token even at its default generation 0.
    broadcast(server);
    const first = lastSnap(client.sent);
    expect(first.self.de).toBe(0);
    const mirror = bareClient(session.pid);
    (mirror as any).applySnapshot(first);
    expect((mirror as any).dungeonEntrySeq).toBe(0);

    // A generation bump re-sends the token with the new value.
    entity.dungeonEntrySeq = 3;
    client.sent.length = 0;
    broadcast(server);
    const bumped = lastSnap(client.sent);
    expect(bumped.self.de).toBe(3);
    (mirror as any).applySnapshot(bumped);
    expect((mirror as any).dungeonEntrySeq).toBe(3);

    // An unchanged re-broadcast elides the key entirely, and applying the
    // elided snapshot preserves the PRIOR generation on the client mirror
    // rather than resetting it (absence means unchanged, never cleared).
    client.sent.length = 0;
    broadcast(server);
    const elided = lastSnap(client.sent);
    expect(elided.self).not.toHaveProperty('de');
    (mirror as any).applySnapshot(elided);
    expect((mirror as any).dungeonEntrySeq).toBe(3);
  });

  it('keeps the dungeon entry token owned by the spectator session', () => {
    const server = new GameServer();
    const moderatorClient = fakeWs();
    const targetClient = fakeWs();
    const moderator = joinServer(server, moderatorClient, 404, 'Token Watcher', 'mage', {
      dungeonEntryFacingWireVersion: DUNGEON_ENTRY_FACING_WIRE_VERSION,
    });
    const target = joinServer(server, targetClient, 405, 'Token Target');
    const moderatorEntity = server.sim.entities.get(moderator.pid);
    const targetEntity = server.sim.entities.get(target.pid);
    if (!moderatorEntity || !targetEntity) throw new Error('joined player missing');
    moderatorEntity.dungeonEntrySeq = 2;
    targetEntity.dungeonEntrySeq = 9;

    (
      server as unknown as {
        enterSpectate(moderator: ClientSession, target: ClientSession): void;
      }
    ).enterSpectate(moderator, target);
    moderatorClient.sent.length = 0;
    broadcast(server);

    expect(lastSnap(moderatorClient.sent).self).toMatchObject({ id: target.pid, de: 2 });
  });
});
