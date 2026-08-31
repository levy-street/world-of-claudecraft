import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

vi.mock('../server/unstuck_records', () => ({
  recordUnstuckEvent: vi.fn(),
}));

import { type ClientSession, GameServer } from '../server/game';
import {
  consumeMovementFramesV2,
  createMovementInputSessionState,
} from '../server/movement_input_timeline_v2';
import { recordUnstuckEvent } from '../server/unstuck_records';
import { ClientWorld } from '../src/net/online';
import { BG_GRAVEYARDS, bgFieldPlanWalls } from '../src/sim/battleground_layout';
import { resolvePosition } from '../src/sim/colliders';
import { battlegroundOrigin } from '../src/sim/data';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import type { BgMatch } from '../src/sim/social/battleground';
import type { Entity, SimEvent } from '../src/sim/types';
import {
  UNSTUCK_COOLDOWN_ID,
  UNSTUCK_COUNTDOWN_SECONDS,
  UNSTUCK_RETRY_SECONDS,
  UNSTUCK_SUCCESS_COOLDOWN_SECONDS,
} from '../src/sim/unstuck';

function fakeWs() {
  const sent: unknown[] = [];
  return {
    sent,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload)),
    },
  };
}

function join(server: GameServer, accountId = 1): { session: ClientSession; sent: unknown[] } {
  const connection = fakeWs();
  const result = server.join(
    connection.ws as unknown as Parameters<GameServer['join']>[0],
    accountId,
    accountId,
    `Player${accountId}`,
    'warrior',
    null,
  );
  if ('error' in result) throw new Error(result.error);
  result.blockListLoaded = true;
  return { session: result, sent: connection.sent };
}

function send(server: GameServer, session: ClientSession, cmd: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...cmd }));
}

function must<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label}`);
  return value;
}

function unstuckEvents(sent: unknown[]): Record<string, unknown>[] {
  return sent
    .flatMap((frame) => {
      const value = frame as { t?: string; list?: Record<string, unknown>[] };
      return value.t === 'events' ? (value.list ?? []) : [];
    })
    .filter((event) => event.type === 'unstuck');
}

function armUnstuck(server: GameServer, session: ClientSession): void {
  const player = server.sim.entities.get(session.pid);
  const meta = server.sim.meta(session.pid);
  if (!player || !meta) throw new Error('Expected joined player');
  meta.pendingUnstuck = {
    startedAt: server.sim.time,
    endsAt: server.sim.time + UNSTUCK_COUNTDOWN_SECONDS,
    origin: { ...player.pos, localX: player.pos.x, localZ: player.pos.z },
    area: { kind: 'overworld', id: 'eastbrook_vale' },
    damageTaken: meta.counters.damageTaken,
    lastAnnouncedSecond: UNSTUCK_COUNTDOWN_SECONDS,
    startedDead: player.dead || player.ghost,
  };
  player.cooldowns.set(UNSTUCK_COOLDOWN_ID, UNSTUCK_RETRY_SECONDS);
}

function placeOnGround(server: GameServer, pid: number, x: number, z: number): void {
  const player = must(server.sim.entities.get(pid), 'player to place');
  player.pos = server.sim.ctx.groundPos(x, z);
  player.prevPos = { ...player.pos };
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.onGround = true;
  player.jumping = false;
  player.inCombat = false;
  player.combatTimer = 999;
  server.sim.ctx.rebucket(player);
}

function activeBattlegroundForSession(
  server: GameServer,
  session: ClientSession,
): { match: BgMatch; pid: number } {
  const pids = [session.pid];
  const classes = ['warrior', 'mage', 'priest', 'rogue', 'hunter'] as const;
  for (let i = 1; i < 10; i++)
    pids.push(server.sim.addPlayer(classes[i % classes.length], `BG${i}`));
  pids.forEach((pid, i) => {
    const player = must(server.sim.entities.get(pid), 'battleground player');
    player.level = 20;
    placeOnGround(server, pid, (i % 5) * 2 - 4, -40);
    server.sim.bgQueueJoin(pid);
  });
  server.sim.tick();
  for (const pid of pids) server.sim.bgRespond(true, pid);
  const match = must(server.sim.bgMatchFor(session.pid), 'accepted battleground match');
  for (let i = 0; i < 20 * 12 && match.state !== 'active'; i++) server.sim.tick();
  expect(match.state).toBe('active');
  server.sim.drainEvents();
  return { match, pid: session.pid };
}

function forceIntoBgWallTrap(server: GameServer, match: BgMatch, pid: number): Entity {
  const wall = must(
    bgFieldPlanWalls().find((candidate) => candidate.height >= 3),
    'battleground wall collider',
  );
  const origin = battlegroundOrigin(match.slot);
  const player = must(server.sim.entities.get(pid), 'trapped battleground player');
  player.pos = server.sim.ctx.groundPos(origin.x + wall.x, origin.z + wall.z);
  player.prevPos = { ...player.pos };
  player.vx = 0.25;
  player.vy = 0;
  player.vz = 0;
  player.onGround = false;
  player.jumping = true;
  player.inCombat = false;
  player.combatTimer = 999;
  server.sim.ctx.rebucket(player);
  const resolved = resolvePosition(
    server.sim.cfg.seed,
    player.pos.x,
    player.pos.z,
    PLAYER_BODY_RADIUS,
  );
  expect(Math.hypot(resolved.x - player.pos.x, resolved.z - player.pos.z)).toBeGreaterThan(0.01);
  return player;
}

function forceIntoBgWallContact(
  server: GameServer,
  match: BgMatch,
  pid: number,
  heldMovement = true,
): Entity {
  const origin = battlegroundOrigin(match.slot);
  const player = must(server.sim.entities.get(pid), 'wall-contact battleground player');
  player.pos = server.sim.ctx.groundPos(origin.x - 48.5, origin.z - 133.5);
  player.prevPos = { ...player.pos };
  player.facing = -Math.PI / 2;
  player.prevFacing = player.facing;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.onGround = true;
  player.jumping = false;
  player.inCombat = false;
  player.combatTimer = 999;
  must(server.sim.meta(pid), 'wall-contact player meta').moveInput.forward = heldMovement;
  server.sim.ctx.rebucket(player);
  const resolved = resolvePosition(
    server.sim.cfg.seed,
    player.pos.x,
    player.pos.z,
    PLAYER_BODY_RADIUS,
  );
  expect(Math.hypot(resolved.x - player.pos.x, resolved.z - player.pos.z)).toBeLessThanOrEqual(
    1e-6,
  );
  return player;
}

function inBgGraveyard(server: GameServer, match: BgMatch, pid: number): boolean {
  const origin = battlegroundOrigin(match.slot);
  const plot = BG_GRAVEYARDS[0];
  const player = must(server.sim.entities.get(pid), 'battleground player');
  return (
    Math.abs(player.pos.x - (origin.x + plot.x)) <= plot.hw &&
    Math.abs(player.pos.z - (origin.z + plot.z)) <= plot.hd
  );
}

describe('online unstuck command wiring', () => {
  beforeEach(() => {
    vi.mocked(recordUnstuckEvent).mockReset();
  });

  it('ClientWorld sends the dedicated append-only wire command', () => {
    const cmd = vi.fn();
    ClientWorld.prototype.unstuck.call({ cmd } as never);
    expect(cmd).toHaveBeenCalledWith({ cmd: 'unstuck' });
  });

  it('snaps the local entity to a completed authoritative recovery', () => {
    const player = {
      pos: { x: 1, y: 2, z: 3 },
      prevPos: { x: 0, y: 1, z: 2 },
      vx: 4,
      vy: 5,
      vz: 6,
    };
    const world = { entities: new Map([[7, player]]), playerId: 7 };
    const event: SimEvent = {
      type: 'unstuck',
      phase: 'completed',
      reason: 'moved_to_graveyard',
      pid: 7,
      area: { kind: 'overworld', id: 'world' },
      origin: { x: 1, y: 2, z: 3, localX: 1, localZ: 3 },
      destination: { x: 4, y: 2, z: 6, localX: 4, localZ: 6 },
      duration: 10,
      distance: Math.sqrt(18),
    };
    const apply = (
      ClientWorld.prototype as unknown as {
        applyUnstuckEvent(event: SimEvent): void;
      }
    ).applyUnstuckEvent;

    apply.call(world, event);

    expect(player.pos).toEqual({ x: 4, y: 2, z: 6 });
    expect(player.prevPos).toEqual(player.pos);
    expect([player.vx, player.vy, player.vz]).toEqual([0, 0, 0]);
  });

  it('routes both the Settings command and muted slash command into the same sim method', () => {
    const server = new GameServer();
    const { session } = join(server);
    const unstuck = vi.spyOn(server.sim, 'unstuck').mockReturnValue(true);

    send(server, session, { cmd: 'unstuck' });
    session.chatMutedUntil = Date.now() + 60_000;
    send(server, session, { cmd: 'chat', text: '/unstuck' });

    expect(unstuck).toHaveBeenNthCalledWith(1, session.pid);
    expect(unstuck).toHaveBeenNthCalledWith(2, session.pid);
  });

  it('the Settings command completes for a battleground wall-trapped fighter', () => {
    const server = new GameServer();
    const { session } = join(server, 21);
    const { match, pid } = activeBattlegroundForSession(server, session);
    const player = forceIntoBgWallTrap(server, match, pid);

    send(server, session, { cmd: 'unstuck' });

    expect(server.sim.meta(pid)?.pendingUnstuck).toMatchObject({
      area: {
        kind: 'battleground',
        id: 'thornhollow_fields',
        instanceId: String(match.id),
        slot: match.slot,
      },
    });

    const events: SimEvent[] = [];
    for (let i = 0; i < UNSTUCK_COUNTDOWN_SECONDS * 20; i++) events.push(...server.sim.tick());

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'completed', pid }),
    );
    expect(server.sim.bgMatchFor(pid)).toBe(match);
    expect(player.dead).toBe(false);
    expect(player.ghost).toBe(false);
    expect(inBgGraveyard(server, match, pid)).toBe(true);
    const resolved = resolvePosition(
      server.sim.cfg.seed,
      player.pos.x,
      player.pos.z,
      PLAYER_BODY_RADIUS,
    );
    expect(Math.hypot(resolved.x - player.pos.x, resolved.z - player.pos.z)).toBeLessThanOrEqual(
      1e-6,
    );
    expect(player.cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(UNSTUCK_SUCCESS_COOLDOWN_SECONDS);
  });

  it('the Settings command completes for a battleground wall-contact fighter holding movement', () => {
    const server = new GameServer();
    const { session } = join(server, 22);
    const { match, pid } = activeBattlegroundForSession(server, session);
    const player = forceIntoBgWallContact(server, match, pid);

    send(server, session, { cmd: 'unstuck' });

    expect(server.sim.meta(pid)?.pendingUnstuck).toMatchObject({
      area: {
        kind: 'battleground',
        id: 'thornhollow_fields',
        instanceId: String(match.id),
        slot: match.slot,
      },
    });

    const events: SimEvent[] = [];
    for (let i = 0; i < UNSTUCK_COUNTDOWN_SECONDS * 20; i++) events.push(...server.sim.tick());

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'completed', pid }),
    );
    expect(server.sim.bgMatchFor(pid)).toBe(match);
    expect(inBgGraveyard(server, match, pid)).toBe(true);
    expect(player.vx).toBe(0);
    expect(player.vz).toBe(0);
    expect(server.sim.meta(pid)?.moveInput.forward).toBe(false);
  });

  it('the Settings command completes for recent battleground wall-contact after ESC clears movement', () => {
    const server = new GameServer();
    const { session } = join(server, 25);
    const { match, pid } = activeBattlegroundForSession(server, session);
    const player = forceIntoBgWallContact(server, match, pid);
    const meta = must(server.sim.meta(pid), 'wall-contact player meta');

    server.sim.tick();
    meta.moveInput.forward = false;
    server.sim.drainEvents();

    send(server, session, { cmd: 'unstuck' });

    expect(meta.pendingUnstuck).toMatchObject({
      area: {
        kind: 'battleground',
        id: 'thornhollow_fields',
        instanceId: String(match.id),
        slot: match.slot,
      },
    });

    const events: SimEvent[] = [];
    for (let i = 0; i < UNSTUCK_COUNTDOWN_SECONDS * 20; i++) events.push(...server.sim.tick());

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'completed', pid }),
    );
    expect(server.sim.bgMatchFor(pid)).toBe(match);
    expect(inBgGraveyard(server, match, pid)).toBe(true);
    expect(player.vx).toBe(0);
    expect(player.vz).toBe(0);
    expect(meta.moveInput.forward).toBe(false);
  });

  it('the Settings command keeps wall-contact eligibility when ESC neutral input wins the race', () => {
    const server = new GameServer();
    const { session } = join(server, 26);
    Object.assign(session, createMovementInputSessionState(2));
    const { match, pid } = activeBattlegroundForSession(server, session);
    const player = forceIntoBgWallContact(server, match, pid);
    const meta = must(server.sim.meta(pid), 'wall-contact player meta');

    server.handleMessage(session, JSON.stringify({ t: 'input', seq: 1, ct: 0, mi: { f: 0 } }));
    consumeMovementFramesV2(server.sim, [session]);
    expect(meta.moveInput.forward).toBe(false);

    send(server, session, { cmd: 'unstuck' });

    expect(meta.pendingUnstuck).toMatchObject({
      area: {
        kind: 'battleground',
        id: 'thornhollow_fields',
        instanceId: String(match.id),
        slot: match.slot,
      },
    });

    const events: SimEvent[] = [];
    for (let i = 0; i < UNSTUCK_COUNTDOWN_SECONDS * 20; i++) events.push(...server.sim.tick());

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'completed', pid }),
    );
    expect(server.sim.bgMatchFor(pid)).toBe(match);
    expect(inBgGraveyard(server, match, pid)).toBe(true);
    expect(player.vx).toBe(0);
    expect(player.vz).toBe(0);
    expect(meta.moveInput.forward).toBe(false);
  });

  it('the Settings command completes for a penetrated battleground wall trap after ESC clears movement', () => {
    const server = new GameServer();
    const { session } = join(server, 23);
    const { match, pid } = activeBattlegroundForSession(server, session);
    forceIntoBgWallTrap(server, match, pid);
    must(server.sim.meta(pid), 'wall-trapped player meta').moveInput.forward = false;

    send(server, session, { cmd: 'unstuck' });

    expect(server.sim.meta(pid)?.pendingUnstuck).toMatchObject({
      area: {
        kind: 'battleground',
        id: 'thornhollow_fields',
        instanceId: String(match.id),
        slot: match.slot,
      },
    });

    const events: SimEvent[] = [];
    for (let i = 0; i < UNSTUCK_COUNTDOWN_SECONDS * 20; i++) events.push(...server.sim.tick());

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'completed', pid }),
    );
    expect(server.sim.bgMatchFor(pid)).toBe(match);
    expect(inBgGraveyard(server, match, pid)).toBe(true);
  });

  it('the Settings command refuses idle clear battleground wall-contact as a shortcut', () => {
    const server = new GameServer();
    const { session } = join(server, 24);
    const { match, pid } = activeBattlegroundForSession(server, session);
    forceIntoBgWallContact(server, match, pid, false);

    send(server, session, { cmd: 'unstuck' });

    expect(server.sim.meta(pid)?.pendingUnstuck).toBeNull();
    expect(server.sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'unstuck',
        phase: 'blocked',
        reason: 'competitive',
        pid,
      }),
    );
    expect(server.sim.bgMatchFor(pid)).toBe(match);
  });

  it('the slash alias pays the command lane (a drained lane refuses it)', () => {
    // The alias rides the chat case, which the top-of-dispatch command-lane
    // draw classifies as 'chat', and it deliberately sits ahead of the chat
    // token bucket so a muted player can still recover. Without its own
    // command-lane draw it reached the sim with ZERO tokens drawn on any
    // lane (the release-merge audit's finding): pin that a drained command
    // lane refuses the alias exactly as it refuses the dedicated command.
    const server = new GameServer();
    const { session } = join(server);
    const unstuck = vi.spyOn(server.sim, 'unstuck').mockReturnValue(true);
    const lanes = session.msgLanes as unknown as {
      commandTokens: number;
      lastRefillSec: number;
    };
    lanes.commandTokens = 0;
    lanes.lastRefillSec = Date.now() / 1000 + 3600; // no refill within the test
    send(server, session, { cmd: 'chat', text: '/unstuck' });
    expect(unstuck).not.toHaveBeenCalled();
  });

  it('a drained CHAT lane still permits the alias (the muted-recovery claim, token half)', () => {
    // The mute half is pinned above; this is the token-bucket half of "a
    // muted or chat-flooded player can still recover": the alias sits ahead
    // of the chat lane and the chat ladder, drawing only the command lane,
    // so drying chat must not strand a stuck player.
    const server = new GameServer();
    const { session } = join(server);
    const unstuck = vi.spyOn(server.sim, 'unstuck').mockReturnValue(true);
    const lanes = session.msgLanes as unknown as {
      chatTokens: number;
      lastRefillSec: number;
    };
    lanes.chatTokens = 0;
    lanes.lastRefillSec = Date.now() / 1000 + 3600;
    send(server, session, { cmd: 'chat', text: '/unstuck' });
    expect(unstuck).toHaveBeenCalledWith(session.pid);
  });

  it('returns structured localized blockers for spectating and jailed Settings use', () => {
    const server = new GameServer();
    const spectator = join(server, 1);
    spectator.session.spectating = {
      characterId: 2,
      name: 'Target',
      savedPos: { x: 0, y: 0, z: 0 },
      priorGm: false,
      stowedPet: null,
    };
    send(server, spectator.session, { cmd: 'unstuck' });
    expect(unstuckEvents(spectator.sent)).toContainEqual({
      type: 'unstuck',
      phase: 'blocked',
      reason: 'spectating',
    });

    const jailed = join(server, 3);
    jailed.session.jailed = {} as never;
    send(server, jailed.session, { cmd: 'unstuck' });
    expect(unstuckEvents(jailed.sent)).toContainEqual({
      type: 'unstuck',
      phase: 'blocked',
      reason: 'jailed',
    });
  });

  it('records a linkdead cancellation once while preserving session grace and cooldown', async () => {
    const server = new GameServer();
    const { session } = join(server, 7);
    armUnstuck(server, session);

    expect(server.socketClosed(session, session.ws)).toBe(true);

    expect(session.linkdead).toBe(true);
    expect(server.clients.get(session.pid)).toBe(session);
    expect(server.sim.meta(session.pid)?.pendingUnstuck).toBeNull();
    expect(
      server.sim.serializeCharacter(session.pid)?.cooldowns?.abilities?.[UNSTUCK_COOLDOWN_ID],
    ).toBe(UNSTUCK_RETRY_SECONDS);
    expect(recordUnstuckEvent).toHaveBeenCalledTimes(1);
    expect(recordUnstuckEvent).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 7, characterId: 7 }),
      expect.objectContaining({
        type: 'unstuck',
        phase: 'cancelled',
        reason: 'disconnected',
        pid: session.pid,
      }),
    );

    expect(server.socketClosed(session, session.ws)).toBe(false);
    await server.leave(session, 'test teardown');
    expect(recordUnstuckEvent).toHaveBeenCalledTimes(1);
  });

  it('drains pending attempts before shutdown, blocks new commands, and is idempotent', async () => {
    const server = new GameServer();
    const { session } = join(server, 9);
    armUnstuck(server, session);
    const recordedWithLiveIdentity: boolean[] = [];
    vi.mocked(recordUnstuckEvent).mockImplementation(() => {
      recordedWithLiveIdentity.push(server.clients.get(session.pid) === session);
    });

    expect(server.beginShutdown()).toBe(1);
    expect(server.beginShutdown()).toBe(0);
    expect(recordedWithLiveIdentity).toEqual([true]);
    expect(
      server.sim.serializeCharacter(session.pid)?.cooldowns?.abilities?.[UNSTUCK_COOLDOWN_ID],
    ).toBe(UNSTUCK_RETRY_SECONDS);

    const unstuck = vi.spyOn(server.sim, 'unstuck');
    send(server, session, { cmd: 'unstuck' });
    send(server, session, { cmd: 'chat', text: '/unstuck' });
    expect(unstuck).not.toHaveBeenCalled();
    expect(server.sim.meta(session.pid)?.pendingUnstuck).toBeNull();

    await server.leave(session, 'shutdown');
    expect(recordUnstuckEvent).toHaveBeenCalledTimes(1);
  });
});
