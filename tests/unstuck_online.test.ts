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
import { recordUnstuckEvent } from '../server/unstuck_records';
import { ClientWorld } from '../src/net/online';
import type { SimEvent } from '../src/sim/types';
import {
  UNSTUCK_COOLDOWN_ID,
  UNSTUCK_COUNTDOWN_SECONDS,
  UNSTUCK_RETRY_SECONDS,
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
