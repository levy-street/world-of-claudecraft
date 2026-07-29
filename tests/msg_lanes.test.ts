// Per-class post-parse inbound lanes (server/msg_lanes.ts) and their wiring
// into GameServer.dispatchMessage at the R5 placements
// (docs/design/player-performance/packet-3-input-cadence.md): classification
// mirrors the dispatch switch, each lane holds its own budget, the two
// reserved-lane properties hold in both directions, exempt frames never
// compete for tokens, command drops are observe-then-drop while movement
// drops are drop-before-observe, and lane drops tally into the pre-parse
// gate's shared abuse window (R6) all the way to the kick verdict. The
// list-read guard's seam pins (server/list_read_guard.ts, the phase 06
// maintainer ruling) live here too, beside the other chat-surface pins.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed (the
// tests/character_lease_game.test.ts canonical shape: a partial mock stays
// green only until a test path touches a missing name, then throws).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  loadAccountFlair: vi.fn(async () => null),
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer } from '../server/game';
import {
  classifyMsgLane,
  consumeLaneToken,
  createMsgLanes,
  MSG_LANE_CHAT_BURST,
  MSG_LANE_CHAT_REFILL_PER_SECOND,
  MSG_LANE_COMMAND_BURST,
  MSG_LANE_COMMAND_REFILL_PER_SECOND,
  MSG_LANE_MOVEMENT_BURST,
  MSG_LANE_MOVEMENT_REFILL_PER_SECOND,
} from '../server/msg_lanes';
import { COMMAND_NAMES } from '../src/world_api';

describe('lane constants hold the R5 budget literals', () => {
  it('pins each refill and burst against a disagreeing literal', () => {
    expect(MSG_LANE_MOVEMENT_REFILL_PER_SECOND).toBe(90);
    expect(MSG_LANE_MOVEMENT_BURST).toBe(120);
    expect(MSG_LANE_COMMAND_REFILL_PER_SECOND).toBe(30);
    expect(MSG_LANE_COMMAND_BURST).toBe(60);
    expect(MSG_LANE_CHAT_REFILL_PER_SECOND).toBe(4);
    expect(MSG_LANE_CHAT_BURST).toBe(8);
  });
});

describe('classifyMsgLane mirrors the dispatch switch', () => {
  it('classifies input frames into the movement lane', () => {
    expect(classifyMsgLane({ t: 'input' })).toBe('movement');
    expect(classifyMsgLane({ t: 'input', seq: 5, mi: { f: 1 } })).toBe('movement');
    // t wins over a stray cmd field, exactly like the dispatch switch.
    expect(classifyMsgLane({ t: 'input', cmd: 'chat' })).toBe('movement');
  });

  it('classifies chat into its own lane', () => {
    expect(classifyMsgLane({ t: 'cmd', cmd: 'chat', text: 'hello' })).toBe('chat');
  });

  it('exempts logout, telemetry, and challengeResponse', () => {
    expect(classifyMsgLane({ t: 'logout' })).toBe('exempt');
    expect(classifyMsgLane({ t: 'cmd', cmd: 'telemetry' })).toBe('exempt');
    expect(classifyMsgLane({ t: 'cmd', cmd: 'challengeResponse' })).toBe('exempt');
  });

  it('scopes the exemptions to cmd, never to a t of the same name', () => {
    // {t: 'telemetry'} is an unknown TYPE to the dispatch switch, so it is
    // command-lane garbage; only cmd 'telemetry' rides the exemption.
    expect(classifyMsgLane({ t: 'telemetry' })).toBe('command');
    expect(classifyMsgLane({ t: 'challengeResponse' })).toBe('command');
  });

  it('classifies every other dispatched command into the command lane', () => {
    for (const name of COMMAND_NAMES) {
      if (name === 'chat' || name === 'telemetry' || name === 'challengeResponse') continue;
      expect(classifyMsgLane({ t: 'cmd', cmd: name })).toBe('command');
    }
  });

  it('classifies unknown shapes into the command lane', () => {
    expect(classifyMsgLane({ t: 'cmd', cmd: 'definitely_not_a_command' })).toBe('command');
    expect(classifyMsgLane({ t: 'cmd' })).toBe('command');
    expect(classifyMsgLane({ t: 'bogus' })).toBe('command');
    expect(classifyMsgLane({})).toBe('command');
  });

  it('classifies valid non-object JSON into the command lane', () => {
    expect(classifyMsgLane(null)).toBe('command');
    expect(classifyMsgLane(42)).toBe('command');
    expect(classifyMsgLane('a string')).toBe('command');
    expect(classifyMsgLane([1, 2, 3])).toBe('command');
    expect(classifyMsgLane(true)).toBe('command');
  });
});

describe('per-lane budget arithmetic', () => {
  it('allows exactly the burst at one instant and drops the next frame per lane', () => {
    for (const [lane, burst] of [
      ['movement', MSG_LANE_MOVEMENT_BURST],
      ['command', MSG_LANE_COMMAND_BURST],
      ['chat', MSG_LANE_CHAT_BURST],
    ] as const) {
      const state = createMsgLanes(1000);
      for (let i = 0; i < burst; i++) {
        expect(consumeLaneToken(state, lane, 1000)).toBe('allow');
      }
      expect(consumeLaneToken(state, lane, 1000)).toBe('drop');
    }
  });

  it('refills exactly the per-second rate after a full drain per lane', () => {
    for (const [lane, burst, refill] of [
      ['movement', MSG_LANE_MOVEMENT_BURST, MSG_LANE_MOVEMENT_REFILL_PER_SECOND],
      ['command', MSG_LANE_COMMAND_BURST, MSG_LANE_COMMAND_REFILL_PER_SECOND],
      ['chat', MSG_LANE_CHAT_BURST, MSG_LANE_CHAT_REFILL_PER_SECOND],
    ] as const) {
      const state = createMsgLanes(1000);
      for (let i = 0; i < burst; i++) consumeLaneToken(state, lane, 1000);
      expect(consumeLaneToken(state, lane, 1000)).toBe('drop');
      for (let i = 0; i < refill; i++) {
        expect(consumeLaneToken(state, lane, 1001)).toBe('allow');
      }
      expect(consumeLaneToken(state, lane, 1001)).toBe('drop');
    }
  });

  it('drops on half a refilled token and allows on a whole one', () => {
    const state = createMsgLanes(1000);
    for (let i = 0; i < MSG_LANE_CHAT_BURST; i++) consumeLaneToken(state, 'chat', 1000);
    // 0.125 s at 4 tokens per second is half a token: still a drop.
    expect(consumeLaneToken(state, 'chat', 1000.125)).toBe('drop');
    // 0.25 s is one whole token: exactly one allow, then dry again.
    expect(consumeLaneToken(state, 'chat', 1000.25)).toBe('allow');
    expect(consumeLaneToken(state, 'chat', 1000.25)).toBe('drop');
  });

  it('caps a long idle refill at the burst', () => {
    const state = createMsgLanes(1000);
    for (let i = 0; i < MSG_LANE_COMMAND_BURST; i++) consumeLaneToken(state, 'command', 1000);
    for (let i = 0; i < MSG_LANE_COMMAND_BURST; i++) {
      expect(consumeLaneToken(state, 'command', 2000)).toBe('allow');
    }
    expect(consumeLaneToken(state, 'command', 2000)).toBe('drop');
  });

  it('spends nothing on a drop', () => {
    const state = createMsgLanes(1000);
    for (let i = 0; i < MSG_LANE_CHAT_BURST; i++) consumeLaneToken(state, 'chat', 1000);
    // A pile of drops must not push the bucket negative: the full next-second
    // refill is still available afterwards.
    for (let i = 0; i < 50; i++) expect(consumeLaneToken(state, 'chat', 1000)).toBe('drop');
    for (let i = 0; i < MSG_LANE_CHAT_REFILL_PER_SECOND; i++) {
      expect(consumeLaneToken(state, 'chat', 1001)).toBe('allow');
    }
    expect(consumeLaneToken(state, 'chat', 1001)).toBe('drop');
  });

  it('clamps a backwards clock step to a zero refill', () => {
    const state = createMsgLanes(1000);
    for (let i = 0; i < MSG_LANE_CHAT_BURST; i++) consumeLaneToken(state, 'chat', 1000);
    // Time stepping backwards must not mint tokens.
    expect(consumeLaneToken(state, 'chat', 990)).toBe('drop');
  });
});

describe('the reserved-lane properties hold in both directions', () => {
  it('a saturated movement stream never consumes a command or chat token', () => {
    const state = createMsgLanes(1000);
    for (let i = 0; i < MSG_LANE_MOVEMENT_BURST; i++) {
      expect(consumeLaneToken(state, 'movement', 1000)).toBe('allow');
    }
    for (let i = 0; i < 200; i++) {
      expect(consumeLaneToken(state, 'movement', 1000)).toBe('drop');
    }
    // The other lanes are untouched by both the allows and the drops.
    expect(state.commandTokens).toBe(MSG_LANE_COMMAND_BURST);
    expect(state.chatTokens).toBe(MSG_LANE_CHAT_BURST);
    expect(consumeLaneToken(state, 'command', 1000)).toBe('allow');
    expect(consumeLaneToken(state, 'chat', 1000)).toBe('allow');
  });

  it('a command flood never consumes a movement token', () => {
    const state = createMsgLanes(1000);
    for (let i = 0; i < 300; i++) consumeLaneToken(state, 'command', 1000);
    expect(state.movementTokens).toBe(MSG_LANE_MOVEMENT_BURST);
    expect(consumeLaneToken(state, 'movement', 1000)).toBe('allow');
  });

  it('a chat flood never consumes a movement or command token', () => {
    const state = createMsgLanes(1000);
    for (let i = 0; i < 100; i++) consumeLaneToken(state, 'chat', 1000);
    expect(state.movementTokens).toBe(MSG_LANE_MOVEMENT_BURST);
    expect(state.commandTokens).toBe(MSG_LANE_COMMAND_BURST);
    expect(consumeLaneToken(state, 'movement', 1000)).toBe('allow');
    expect(consumeLaneToken(state, 'command', 1000)).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// Integration pins at the GameServer seam: the R5 placements inside
// dispatchMessage, driven through the real handleMessage with a fake detector
// sink and a fake Date clock.
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;

interface DetectorSink {
  inputs: number;
  commands: string[];
  anomalies: string[];
}

function fakeWs() {
  return { readyState: 1, send: vi.fn(), close: vi.fn() } as never;
}

function join(server: GameServer, meta?: object): ClientSession {
  const result = server.join(fakeWs(), 11, 101, 'Lanes', 'warrior', null, false, meta as never);
  if ('error' in result) throw new Error(result.error);
  return result;
}

/** Replace the observe methods with a recording sink, after join so the real
 *  tracking context exists (the game_sessions spread pattern). */
function sinkDetector(server: GameServer): DetectorSink {
  const sink: DetectorSink = { inputs: 0, commands: [], anomalies: [] };
  const host = server as unknown as { botDetector: object };
  host.botDetector = {
    ...host.botDetector,
    observeInput: () => {
      sink.inputs++;
    },
    observeCommand: (_ctx: unknown, cmd: string) => {
      sink.commands.push(cmd);
    },
    observeProtocolAnomaly: (_ctx: unknown, kind: string) => {
      sink.anomalies.push(kind);
    },
  };
  return sink;
}

function sendInput(server: GameServer, session: ClientSession, seq: number, facing = 0.25): void {
  server.handleMessage(session, JSON.stringify({ t: 'input', seq, mi: { f: 1 }, facing }));
}

function sendCast(server: GameServer, session: ClientSession): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'castSlot', slot: 0 }));
}

function sendChat(server: GameServer, session: ClientSession, text: string): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));
}

describe('dispatchMessage lane wiring at the R5 placements', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers every cast intact through a 300 per second movement flood', () => {
    const server = new GameServer();
    const session = join(server);
    const sink = sinkDetector(server);
    const castSpy = vi.spyOn(server.sim, 'castAbilityBySlot');

    // One receive-time second of 300 movement frames with six casts
    // interleaved at a human-plausible spread. The pre-parse gate passes the
    // early burst whole; the movement LANE saturates partway through and
    // sheds movement frames, while the command lane stays untouched.
    let cast = 0;
    for (let i = 0; i < 300; i++) {
      vi.setSystemTime(T0 + Math.floor((i * 1000) / 300));
      sendInput(server, session, i + 1);
      if (i > 0 && i % 45 === 0) {
        sendCast(server, session);
        cast++;
      }
    }

    // THE reserved-capacity pin: every cast reached the sim.
    expect(cast).toBe(6);
    expect(castSpy).toHaveBeenCalledTimes(6);
    // Movement frames were shed by the lane: the sim and detector saw fewer
    // than offered, and the movement bucket ended the second dry.
    expect(sink.inputs).toBeLessThan(300);
    expect(sink.inputs).toBeGreaterThan(0);
    expect(session.msgLanes.movementTokens).toBeLessThan(1);
    // The shed frames tallied one abusive second, far below the kick verdict:
    // the session is still connected.
    expect(session.msgRate.abusiveSeconds.length).toBe(1);
    expect(server.clients.has(session.pid)).toBe(true);
  });

  it('keeps a 30 per second cast mash entirely drop-free with beats riding along', () => {
    const server = new GameServer();
    const session = join(server);
    sinkDetector(server);
    const castSpy = vi.spyOn(server.sim, 'castAbilityBySlot');

    // Three seconds of 30 per second casting, one telemetry beat per second,
    // and a challengeResponse mid-stream: the command lane refill absorbs the
    // mash whole and nothing tallies a single drop.
    for (let i = 0; i < 90; i++) {
      vi.setSystemTime(T0 + Math.floor((i * 1000) / 30));
      sendCast(server, session);
      if (i === 15 || i === 45 || i === 75) {
        server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'telemetry', apm: 42 }));
      }
      if (i === 50) {
        server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'challengeResponse' }));
      }
    }

    expect(castSpy).toHaveBeenCalledTimes(90);
    expect(session.msgRate.dropsThisSecond).toBe(0);
    expect(session.msgRate.abusiveSeconds.length).toBe(0);
    expect(server.clients.has(session.pid)).toBe(true);
  });

  it('processes telemetry and challenge responses with the command lane exhausted', () => {
    const server = new GameServer();
    const session = join(server);
    const sink = sinkDetector(server);

    // Drain the command lane at one instant, then prove it is dry with a
    // control cast that lane-drops.
    for (let i = 0; i < 60; i++) sendCast(server, session);
    sendCast(server, session);
    expect(session.msgRate.dropsThisSecond).toBe(1);

    // The exemption contract: a telemetry beat and a challengeResponse are
    // never lane-checked, so they neither drop nor touch lane state even
    // with the lane dry.
    const lanesBefore = { ...session.msgLanes };
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'telemetry', apm: 42 }));
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'challengeResponse' }));
    expect(session.msgRate.dropsThisSecond).toBe(1);
    expect(session.msgLanes).toEqual(lanesBefore);
    // Both still reached the detector through observeCommand.
    expect(sink.commands).toContain('telemetry');
    expect(sink.commands).toContain('challengeResponse');
  });

  it('processes a logout with the command lane exhausted', () => {
    const server = new GameServer();
    const session = join(server);
    sinkDetector(server);

    // Dry the command lane and prove it with a control drop: a mis-lane of
    // logout into the every-other-shape command rule would drop it here.
    for (let i = 0; i < 61; i++) sendCast(server, session);
    expect(session.msgRate.dropsThisSecond).toBe(1);

    server.handleMessage(session, JSON.stringify({ t: 'logout' }));
    expect(session.left).toBe(true);
    expect(server.clients.has(session.pid)).toBe(false);
  });

  it('never lane-drops list readouts or moderation commands with the chat lane exhausted', () => {
    const server = new GameServer();
    const session = join(server, { adminPermissions: ['moderation.act'] });
    sinkDetector(server);
    const host = server as unknown as {
      social: { ignoreList: (actor: unknown) => Promise<void> };
      moderation: { handleChatCommand: (session: unknown, text: string) => boolean };
    };
    const ignoreSpy = vi.spyOn(host.social, 'ignoreList').mockResolvedValue(undefined);
    // Claim only the staff command so the plain drain messages still fall
    // through the router to the ladder path, as they do for the real router.
    const moderationSpy = vi
      .spyOn(host.moderation, 'handleChatCommand')
      .mockImplementation((_session: unknown, text: string) => text.startsWith('/kick'));

    // Drain the chat lane: eight sends draw its whole burst even though the
    // in-handler ladder starts refusing at six, then a control message
    // lane-drops.
    for (let i = 0; i < 8; i++) sendChat(server, session, `hello ${i}`);
    sendChat(server, session, 'one too many');
    expect(session.msgRate.dropsThisSecond).toBe(1);

    // A burst of list readouts and moderation commands rides ABOVE the lane
    // check (the router and filter management stay unthrottled): every one is
    // handled and none tallies a drop. Ten readouts sit exactly AT the
    // list-read guard burst, so this arm exercises the lane bypass, not the
    // guard; a lowered guard burst would fail here first, deliberately.
    for (let i = 0; i < 10; i++) sendChat(server, session, '/ignorelist');
    expect(ignoreSpy).toHaveBeenCalledTimes(10);
    moderationSpy.mockClear();
    for (let i = 0; i < 10; i++) sendChat(server, session, '/kick Somebody');
    expect(moderationSpy).toHaveBeenCalledTimes(10);
    expect(session.msgRate.dropsThisSecond).toBe(1);
  });

  it('still fires the chat ladder cooldown messaging on what the lane passes', () => {
    const server = new GameServer();
    const session = join(server);
    sinkDetector(server);
    const ws = session.ws as unknown as { send: ReturnType<typeof vi.fn> };

    // The ladder burst is five; the lane burst is eight. Send six: the sixth
    // passes the LANE and the LADDER refuses it with its player-facing rate
    // copy, proving the lane pre-guard did not swallow the ladder messaging.
    for (let i = 0; i < 6; i++) sendChat(server, session, `hello ${i}`);
    const rateFrames = ws.send.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('sending messages too quickly'),
    );
    expect(rateFrames.length).toBe(1);
    expect(session.msgRate.dropsThisSecond).toBe(0);
  });

  it('observes a command through observeCommand before the lane drops it', () => {
    const server = new GameServer();
    const session = join(server);
    const sink = sinkDetector(server);
    const castSpy = vi.spyOn(server.sim, 'castAbilityBySlot');

    // Sixty-one casts at one instant: the sixty-first is lane-dropped, but
    // the detector saw all sixty-one (observe-then-drop, R5).
    for (let i = 0; i < 61; i++) sendCast(server, session);
    expect(sink.commands.filter((cmd) => cmd === 'castSlot').length).toBe(61);
    expect(castSpy).toHaveBeenCalledTimes(60);
    expect(session.msgRate.dropsThisSecond).toBe(1);
  });

  it('drops a movement frame before both the sim and observeInput', () => {
    const server = new GameServer();
    const session = join(server);
    const sink = sinkDetector(server);

    // One hundred twenty-one input frames at one instant: the last is
    // lane-dropped BEFORE the sim assignment and BEFORE observeInput
    // (drop-before-observe, R5), so neither its seq nor its facing lands.
    for (let i = 1; i <= 120; i++) sendInput(server, session, i, 0.25);
    sendInput(server, session, 121, 0.9);

    expect(sink.inputs).toBe(120);
    expect(session.lastInputSeq).toBe(120);
    expect(server.sim.entities.get(session.pid)?.facing).toBe(0.25);
    expect(session.msgRate.dropsThisSecond).toBe(1);
  });

  it('draws a command-lane token for garbage only after its anomaly observation', () => {
    const server = new GameServer();
    const session = join(server);
    const sink = sinkDetector(server);

    // Drain the command lane, then send each unknown shape once. Every one
    // still reaches the protocol-anomaly channel (the lane never mutes it)
    // AND tallies a lane drop into the abuse window.
    for (let i = 0; i < 60; i++) sendCast(server, session);
    const dropsBefore = session.msgRate.dropsThisSecond;
    server.handleMessage(session, '"a bare string"');
    server.handleMessage(session, JSON.stringify({ t: 'bogus' }));
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'no_such_command' }));
    expect(sink.anomalies).toEqual(['non_object', 'unknown_type', 'unknown_command']);
    expect(session.msgRate.dropsThisSecond).toBe(dropsBefore + 3);
  });

  it('adds gate drops and lane drops into one abusive second across causes', () => {
    const server = new GameServer();
    const session = join(server);
    sinkDetector(server);

    // All at one instant: 135 inputs spend 135 gate tokens and shed 15 at the
    // movement LANE; 45 casts drain the gate to exactly zero; 20 more inputs
    // then drop at the pre-parse GATE. Neither cause alone reaches the
    // 30-drop abuse floor, but the shared window sums them (R6).
    for (let i = 0; i < 135; i++) sendInput(server, session, i + 1);
    expect(session.msgRate.dropsThisSecond).toBe(15);
    for (let i = 0; i < 45; i++) sendCast(server, session);
    expect(session.msgRate.dropsThisSecond).toBe(15);
    for (let i = 0; i < 20; i++) sendInput(server, session, 200 + i);
    expect(session.msgRate.dropsThisSecond).toBe(35);
    expect(session.msgRate.abusiveSeconds.length).toBe(1);
    expect(server.clients.has(session.pid)).toBe(true);
  });

  it('kicks a sustained movement lane flood through the shared abuse window', () => {
    const server = new GameServer();
    const session = join(server);
    sinkDetector(server);
    const ws = session.ws as unknown as {
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };

    // A 150 per second movement stream stays under the pre-parse burst for
    // the first six seconds, so the early shedding is the movement LANE's: 60
    // drops per receive-time second, each tallied into the gate's shared
    // window by the consumer seam (R6). Five abusive seconds later the kick
    // verdict fires through the identical path as a gate flood.
    for (let i = 0; i < 150 * 8 && !session.left; i++) {
      vi.setSystemTime(T0 + Math.floor((i * 1000) / 150));
      sendInput(server, session, i + 1);
    }

    expect(session.left).toBe(true);
    expect(server.clients.has(session.pid)).toBe(false);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ t: 'error', error: 'message rate exceeded' }),
    );
    expect(ws.close).toHaveBeenCalled();
  });

  it('kicks a sustained cast flood through the same shared abuse window', () => {
    const server = new GameServer();
    const session = join(server);
    sinkDetector(server);
    const ws = session.ws as unknown as {
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };

    // A 100 per second cast flood stays under the pre-parse refill entirely,
    // so every drop is the command LANE's: the burst drains inside the first
    // second, then 70 drops per receive-time second mark seconds abusive
    // until the shared window kicks. Proves the R6 kick path is not
    // movement-specific.
    for (let i = 0; i < 100 * 8 && !session.left; i++) {
      vi.setSystemTime(T0 + Math.floor((i * 1000) / 100));
      sendCast(server, session);
    }

    expect(session.left).toBe(true);
    expect(server.clients.has(session.pid)).toBe(false);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ t: 'error', error: 'message rate exceeded' }),
    );
    expect(ws.close).toHaveBeenCalled();
  });

  it('kicks a sustained chat flood through the same shared abuse window', () => {
    const server = new GameServer();
    const session = join(server);
    sinkDetector(server);
    const ws = session.ws as unknown as {
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };

    // A 45 per second plain-text chat flood: far under the pre-parse gate, so
    // every drop is the chat LANE's (burst 8, refill 4), about 33 or more per
    // receive-time second from the first. The third lane rides the identical
    // consumeLane kick path as movement and command.
    for (let i = 0; i < 45 * 8 && !session.left; i++) {
      vi.setSystemTime(T0 + Math.floor((i * 1000) / 45));
      sendChat(server, session, 'hello there');
    }

    expect(session.left).toBe(true);
    expect(server.clients.has(session.pid)).toBe(false);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ t: 'error', error: 'message rate exceeded' }),
    );
    expect(ws.close).toHaveBeenCalled();
  });

  it('guards the list readouts above the read budget and returns before the read', () => {
    const server = new GameServer();
    const session = join(server);
    sinkDetector(server);
    const host = server as unknown as {
      social: {
        ignoreList: (actor: unknown) => Promise<void>;
        ignoreAdd: (actor: unknown, name: string) => Promise<void>;
      };
    };
    const listSpy = vi.spyOn(host.social, 'ignoreList').mockResolvedValue(undefined);
    const addSpy = vi.spyOn(host.social, 'ignoreAdd').mockResolvedValue(undefined);

    // Twelve readouts at one instant: the guard passes exactly its burst of
    // ten and refuses the two above it BEFORE the DB read runs, each refusal
    // tallying into the shared abuse window (the phase 06 maintainer ruling).
    for (let i = 0; i < 12; i++) sendChat(server, session, '/ignorelist');
    expect(listSpy).toHaveBeenCalledTimes(10);
    expect(session.msgRate.dropsThisSecond).toBe(2);

    // The guard is read-scoped: a WRITE still runs (its metering is the
    // ladder token, untouched), and a plain chat line still rides the lane
    // and ladder with no further drops.
    sendChat(server, session, '/ignore Somebody');
    expect(addSpy).toHaveBeenCalledTimes(1);
    sendChat(server, session, 'hello there');
    expect(session.msgRate.dropsThisSecond).toBe(2);
  });

  it('carries the drained list-read guard across a linkdead resume', () => {
    const server = new GameServer();
    const session = join(server);
    sinkDetector(server);
    const host = server as unknown as {
      social: { ignoreList: (actor: unknown) => Promise<void> };
    };
    const listSpy = vi.spyOn(host.social, 'ignoreList').mockResolvedValue(undefined);

    // Drain the guard, go linkdead, and resume through the REAL join path:
    // the same session object keeps the drained bucket (the R2 carry, the
    // exact lifecycle of msgRate and msgLanes), so a reconnect can never
    // reset the read budget.
    for (let i = 0; i < 10; i++) sendChat(server, session, '/ignorelist');
    expect(listSpy).toHaveBeenCalledTimes(10);
    server.socketClosed(session, session.ws as never);
    expect(session.linkdead).toBe(true);
    const resumed = join(server);
    expect(resumed).toBe(session);

    sendChat(server, session, '/ignorelist');
    expect(listSpy).toHaveBeenCalledTimes(10);
    expect(session.msgRate.dropsThisSecond).toBe(1);
  });

  it('kicks a sustained list-read flood through the same shared abuse window', () => {
    const server = new GameServer();
    const session = join(server);
    sinkDetector(server);
    const host = server as unknown as {
      social: { blockList: (actor: unknown) => Promise<void> };
    };
    vi.spyOn(host.social, 'blockList').mockResolvedValue(undefined);
    const ws = session.ws as unknown as {
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };

    // A 45 per second readout flood sits far under the pre-parse gate, so
    // before the guard this stream was structurally unkickable: it booked
    // zero drops. Now every refusal is the guard's, about 34 or more per
    // receive-time second, and the shared window kicks it like any other
    // flood (the phase 06 maintainer ruling).
    for (let i = 0; i < 45 * 8 && !session.left; i++) {
      vi.setSystemTime(T0 + Math.floor((i * 1000) / 45));
      sendChat(server, session, '/blocklist');
    }

    expect(session.left).toBe(true);
    expect(server.clients.has(session.pid)).toBe(false);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ t: 'error', error: 'message rate exceeded' }),
    );
    expect(ws.close).toHaveBeenCalled();
  });

  it('kicks a mixed cause flood through the shared abuse window across seconds', () => {
    const server = new GameServer();
    const session = join(server);
    sinkDetector(server);
    const ws = session.ws as unknown as {
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };

    // The cross-cause additivity arm extended to the kick verdict: every
    // receive-time second books movement-LANE drops and pre-parse GATE drops
    // together, neither cause pinned as the sole driver, and the shared
    // window still kicks on the fifth abusive second (R6 is cause-blind end
    // to end). Second zero replays the additivity arm's exact 15 plus 20
    // split as the mixed-composition proof.
    let seq = 0;
    for (let sec = 0; sec < 8 && !session.left; sec++) {
      vi.setSystemTime(T0 + sec * 1000);
      for (let i = 0; i < 135 && !session.left; i++) sendInput(server, session, ++seq);
      if (sec === 0) expect(session.msgRate.dropsThisSecond).toBe(15);
      for (let i = 0; i < 45 && !session.left; i++) sendCast(server, session);
      for (let i = 0; i < 20 && !session.left; i++) sendInput(server, session, ++seq);
      if (sec === 0) expect(session.msgRate.dropsThisSecond).toBe(35);
    }

    expect(session.left).toBe(true);
    expect(server.clients.has(session.pid)).toBe(false);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ t: 'error', error: 'message rate exceeded' }),
    );
    expect(ws.close).toHaveBeenCalled();
  });
});
