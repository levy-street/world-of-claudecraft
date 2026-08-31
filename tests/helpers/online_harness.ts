// One REAL client and one REAL server, in-process, talking over the simulated
// LatencyLink under the VirtualClock: the rig a movement-feel measurement needs
// in order to be about the game rather than about a model of it.
//
// What is real here:
//   - `new GameServer()` with a character joined the ordinary way, stepped by
//     the same four calls its own loop makes (clearStaleInputs, sim.tick,
//     routeEvents, broadcastSnapshots), exactly as movement_ground_truth.ts.
//   - `new ClientWorld(...)`, constructed against a stubbed WebSocket class.
//     Server frames enter through `socket.onmessage`, the honest production
//     door into the private onMessage, and client sends leave through
//     `socket.send`. Nothing reaches into ClientWorld's private decode.
//   - The client's fixed-tick v2 sampler and the legacy timer, both registered
//     against the VirtualClock, so each negotiated wire follows its real lane.
//   - The client frame pipeline: the four extracted seams (snapshotAlpha,
//     InputEchoTracker, selfMotionPredictionEnabled, updateSelfRenderPosition)
//     driven in the ORDER src/main.ts's online arm drives them, which is
//     load-bearing: alpha is read before this frame's echo samples are folded,
//     the fold happens before the SelfMotionFrame is built, and the drawn pose
//     comes out of the same updateSelfRenderPosition call renderer.ts makes.
//
// The ground-truth convention, stated once because every measurement rests on
// it: the reference trajectory is what the server would do RECEIVING EACH WIRE
// FRAME AT ITS SEND INSTANT with zero latency. Not the per-frame held intent:
// the client's flush gate (src/net/input_send_cadence.ts) admits only some of
// those frames to the wire, so scoring against the held intent would compare
// the server under test to a twin steering on a finer timeline than any server
// ever received, and charge the difference to latency. The timeline is
// therefore recorded where the frames enter the link and parsed with the
// server's own parser (parseMoveInputFrame), so the fidelity is exact rather
// than re-derived.
//
// Direct mode keeps the original resolved-intent seam. Optional key-timeline
// mode composes the real keyboard turn, mouselook release, movement visual,
// renderer self-yaw, and camera-facing producers in main.ts order.
//
// A suite using this helper must mock Postgres itself, hoisted above its own
// import of this module (it pulls in server/game); copy the superset factory at
// the top of tests/unstuck_online.test.ts.

import type { ClientSession, GameServer } from '../../server/game';
import { consumeMovementFramesV2 } from '../../server/movement_input_timeline_v2';
import { updateMovementOverrideEpochs } from '../../server/movement_override_epoch';
import {
  type KeyboardTurnArgs,
  newKeyboardTurnState,
  seedKeyboardTurnRelease,
  stepKeyboardTurnFacing,
} from '../../src/game/keyboard_turn_facing';
import { mouselookReleaseFacing } from '../../src/game/mouselook_release';
import { diagonalMovementVisualFacing } from '../../src/game/movement_visual';
import { interpolatedOnlineSelfFacing } from '../../src/game/online_facing_mirror';
import { adaptiveSelfAlphaLead } from '../../src/game/self_alpha_lead';
import { SelfMotionFrameBuffer } from '../../src/game/self_motion_frame_buffer';
import {
  isMovementFrozen,
  isPlayerImmobilized,
  type SelfMotionGateArgs,
  selfMotionPredictionEnabled,
} from '../../src/game/self_motion_gate';
import { InputEchoTracker } from '../../src/net/input_echo_tracker';
import { ClientWorld } from '../../src/net/online';
import { snapshotAlpha } from '../../src/net/snapshot_alpha';
import { advanceSelfFacing, releaseSelfFacing } from '../../src/render/facing_smooth';
import { hasAuthoritativeSelfPositionDiscontinuity } from '../../src/render/self_motion';
import { MovementPredictionPipeline } from '../../src/render/self_prediction';
import {
  createSelfRenderPositionState,
  noteSelfIdentity,
  updateSelfRenderPosition,
} from '../../src/render/self_render_position_core';
import { parseMoveInputFrame } from '../../src/sim/move_input';
import { type Entity, emptyMoveInput, type MoveInput, type PlayerClass } from '../../src/sim/types';
import { ONLINE_WORLD_AUTH_TYPE } from '../../src/world_api';
import type { LatencyLinkConfig } from './latency_link';
import { LatencyLink } from './latency_link';
import {
  COLLIDER_FREE_LANE,
  joinGroundTruthCharacter,
  type MoveScript,
  type MoveScriptEntry,
  teleportEntity,
} from './movement_ground_truth';
import type { CommandSample, ReconcileMode } from './movement_metrics';
import { VirtualClock } from './virtual_clock';

/** The authoritative world loop period; the sim tick is 20 Hz. */
export const SERVER_TICK_MS = 50;
/** The previous-frame cadence a 60 Hz display gives the render loop. */
export const DEFAULT_FRAME_MS = 1000 / 60;
/** main.ts clamps a long frame's dt before anything consumes it. */
const MAX_FRAME_DT_SEC = 0.25;

/** One scripted change of held intent, at a FRAME-time offset in ms. */
export interface FrameScriptEntry {
  atMs: number;
  /** Merged into the held intent (held until the next entry changes it). */
  mi?: Partial<MoveInput>;
  /** The wire facing from this moment on (radians). */
  facing?: number | null;
}

export type FrameScript = readonly FrameScriptEntry[];

/** A scenario-time side effect: a link stall, an aura, a latency change. */
export interface ScriptedAction {
  atMs: number;
  run: () => void;
}

export interface RunScriptOptions {
  durationMs: number;
  script?: FrameScript;
  /** Continuous heading, sampled every frame (the mouselook steering case).
   *  Overrides a script entry's `facing` on any frame it is supplied for. */
  facingAt?: (tMs: number) => number | null;
  actions?: readonly ScriptedAction[];
}

/** What one client frame drew, and the state it drew it from. */
export interface FrameRecord {
  /** Scenario-relative frame time in ms. */
  tMs: number;
  frameDtSec: number;
  /** The pose the renderer would put on screen. */
  x: number;
  y: number;
  z: number;
  selfId: number;
  spectating: string | null;
  /** The mirrored authoritative pose the frame interpolated from. */
  mirrorX: number;
  mirrorY: number;
  mirrorZ: number;
  alpha: number;
  lastSnapAt: number;
  echoMs: number;
  jitterMs: number;
  selfAlphaLead: number;
  samplerInterpolationAlpha: number;
  /** True when the self-motion predictor owned the pose this frame. */
  predictorActive: boolean;
  /** Whether the gate allowed prediction (false: CC, delve, spectate...). */
  predictionEnabled: boolean;
  turnInputActive: boolean;
  mi: MoveInput;
  netFacing: number | null;
  /** The interpolated authoritative heading this frame (see stepFrame). */
  serverFacing: number;
  authoritativeFacing: number;
  drawnYaw: number;
  cameraFacing: number;
  reconcileMode: ReconcileMode | null;
  residualYd: number;
}

/** The authoritative pose after one server tick. */
export interface TickRecord {
  tick: number;
  tMs: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  consumedCt: number;
}

export interface HarnessRun {
  frames: FrameRecord[];
  ticks: TickRecord[];
  /** The WIRE intent timeline (one entry per outgoing `input` frame, stamped
   *  with its send instant), in the shape the metrics consume. */
  commands: CommandSample[];
  /** The same timeline expressed as the ZERO-LATENCY per-tick ground-truth
   *  script (see frameCommandsToTickScript). */
  tickScript: MoveScript;
  tickCount: number;
  movementTimeline: {
    consumed: number;
    starved: number;
    extrapolated: number;
    discardedLate: number;
    resyncs: number;
  } | null;
  movementOutboxDroppedOldest: number;
}

export interface OnlineHarnessOptions {
  latency: LatencyLinkConfig;
  movementWire?: 1 | 2;
  frameMs?: number;
  playerClass?: PlayerClass;
  /** Virtual ms of idle world before a scenario starts, so the mirror is
   *  synced and the echo tracker has samples. Must be a whole tick. */
  warmupMs?: number;
  start?: { x: number; z: number };
  facing?: number;
  /** Compose the frame's facing from the same producers as main.ts. */
  keyTimeline?: boolean;
}

export interface OnlineHarness {
  clock: VirtualClock;
  link: LatencyLink;
  server: GameServer;
  session: ClientSession;
  client: ClientWorld;
  pid: number;
  /** The authoritative entity, for adversarial scenarios (auras, teleports). */
  serverEntity: Entity;
  runScript(options: RunScriptOptions): HarnessRun;
  dispose(): void;
}

/**
 * The zero-latency ground-truth script for a recorded WIRE timeline.
 *
 * A v2 twin consumes one recorded client tick per simulation tick, matching
 * the sequence the predictor presents. Callers without client ticks retain the
 * wall-clock fallback, where a server tick uses the last earlier command. The
 * rtt0 honesty check pins both the resulting poses and facing to the real server.
 */
export function frameCommandsToTickScript(
  commands: readonly CommandSample[],
  tickCount: number,
  tickMs = SERVER_TICK_MS,
): MoveScript {
  const sampledCommands = commands.filter(
    (command): command is CommandSample & { ct: number } => command.ct !== undefined,
  );
  if (sampledCommands.length > 0) {
    return Array.from({ length: tickCount }, (_, tick) => {
      const sample = sampledCommands[Math.min(tick, sampledCommands.length - 1)];
      return { tick, mi: { ...sample.mi }, facing: sample.facing };
    });
  }
  const out: MoveScriptEntry[] = [];
  let cursor = 0;
  let current: CommandSample | null = null;
  for (let tick = 0; tick < tickCount; tick++) {
    const deadline = (tick + 1) * tickMs;
    while (cursor < commands.length && commands[cursor].tMs < deadline) {
      current = commands[cursor];
      cursor++;
    }
    const sample = current ?? commands[0];
    if (!sample) break;
    out.push({ tick, mi: { ...sample.mi }, facing: sample.facing });
  }
  return out;
}

/** A DOM-less WebSocket stand-in whose send/receive ends are the link. */
class HarnessSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = HarnessSocket.OPEN;

  constructor(
    readonly url: string,
    private readonly onSend: (payload: string) => void,
    private readonly bufferedBytes: () => number,
  ) {}

  get bufferedAmount(): number {
    return this.bufferedBytes();
  }

  send(payload: string): void {
    this.onSend(payload);
  }

  close(): void {
    this.readyState = 3;
  }
}

function isWorldAuthFrame(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload) as { t?: unknown };
    return parsed.t === ONLINE_WORLD_AUTH_TYPE;
  } catch {
    return false;
  }
}

export function createOnlineHarness(opts: OnlineHarnessOptions): OnlineHarness {
  const frameMs = opts.frameMs ?? DEFAULT_FRAME_MS;
  const warmupMs = opts.warmupMs ?? 1000;
  if (warmupMs % SERVER_TICK_MS !== 0) {
    throw new Error('warmupMs must be a whole server tick so the tick phase stays aligned');
  }
  const startFacing = opts.facing ?? 0;
  const lane = opts.start ?? COLLIDER_FREE_LANE;

  const clock = new VirtualClock(0);
  clock.install();
  const link = new LatencyLink(clock, opts.latency);

  let recordingFromMs: number | null = null;
  let frames: FrameRecord[] = [];
  let ticks: TickRecord[] = [];
  let commands: CommandSample[] = [];
  // The last intent the WIRE carried, kept across the whole harness lifetime so
  // a run can be seeded with what the server was already acting on when
  // recording opened. Only the `commands` timeline is gated on recording.
  let wireIntent: MoveInput = emptyMoveInput();
  // A frame may omit `facing` (mouselookFacing null), which means UNCHANGED on
  // the server, so the wire heading is carried forward rather than defaulted.
  let wireFacing = startFacing;
  const movementWireVersion = opts.movementWire ?? 2;

  /** Record one outgoing frame as the server's own parser would read it. */
  function noteClientFrame(payload: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    if ((parsed as { t?: unknown }).t !== 'input') return;
    if (movementWireVersion === 2 && !Number.isSafeInteger((parsed as { ct?: unknown }).ct)) return;
    const frame = parseMoveInputFrame(parsed);
    if (frame.facing !== null) wireFacing = frame.facing;
    wireIntent = frame.moveInput;
    if (recordingFromMs === null) return;
    commands.push({
      tMs: clock.now() - recordingFromMs,
      mi: frame.moveInput,
      facing: wireFacing,
      ct: (parsed as { ct: number }).ct,
      sampledFacing: frame.facing,
    });
  }

  const joined = joinGroundTruthCharacter(1, opts.playerClass ?? 'warrior', movementWireVersion);
  const { server, session, pid } = joined;
  // The frames join() already wrote (hello, the entry notice, the social
  // snapshot) were captured raw by rawFakeWs. Virtual time has not moved since,
  // so pushing them through the link now schedules them exactly as an
  // intercepted send would have.
  const joinFrames = [...joined.client.sent];
  joined.client.sent.length = 0;
  joined.client.ws.send = (payload: string) => {
    joined.client.sent.push(payload);
    link.serverSend(payload);
  };
  for (const payload of joinFrames) joined.client.ws.send(payload);

  const joinedEntity = server.sim.entities.get(pid);
  if (!joinedEntity) throw new Error('joined character is missing from the server sim');
  const serverEntity: Entity = joinedEntity;
  teleportEntity(serverEntity, lane.x, lane.z, server.sim.cfg.seed);
  serverEntity.facing = startFacing;

  const globals = globalThis as Record<string, unknown>;
  const previousWebSocket = globals.WebSocket;
  let socket: HarnessSocket | null = null;
  class HarnessWebSocket extends HarnessSocket {
    constructor(url: string) {
      super(
        url,
        (payload) => {
          noteClientFrame(payload);
          link.clientSend(payload);
        },
        () => link.pendingBytes('toServer'),
      );
      socket = this;
    }
  }
  globals.WebSocket = HarnessWebSocket;
  const client = new ClientWorld(
    'harness-token',
    1,
    opts.playerClass ?? 'warrior',
    'http://localhost',
  );
  if (!socket) throw new Error('ClientWorld did not open a socket');
  const clientSocket: HarnessSocket = socket;

  link.onDeliverToClient((payload) => clientSocket.onmessage?.({ data: payload }));
  link.onDeliverToServer((payload) => {
    // In production the world-auth frame is consumed by server/ws_auth.ts
    // BEFORE GameServer.join runs; it never reaches handleMessage. The harness
    // joins directly, so the handshake frame is acknowledged by being dropped
    // here rather than dispatched as an unknown message type.
    if (isWorldAuthFrame(payload)) return;
    server.handleMessage(session, payload);
  });
  clientSocket.onopen?.();

  // Client frame state, one instance per harness exactly as main.ts holds one
  // per session.
  const inputEcho = new InputEchoTracker();
  const selfMotionFrameBuffer = new SelfMotionFrameBuffer();
  const movementPrediction = new MovementPredictionPipeline(client.cfg.seed);
  movementPrediction.connect(client);
  const selfRender = createSelfRenderPositionState({ x: 0, y: 0, z: 0 });
  const selfMotionGateArgs: SelfMotionGateArgs = {
    disabled: false,
    spectating: null,
    movementFrozen: false,
    playerImmobilized: false,
    posX: 0,
    climbing: false,
    riftFloor: null,
  };
  const heldInput = emptyMoveInput();
  let heldFacing: number | null = opts.keyTimeline ? null : startFacing;
  let lastFrameAtMs = 0;
  const kbTurn = newKeyboardTurnState();
  const kbTurnArgs: KeyboardTurnArgs = {
    turnLeft: false,
    turnRight: false,
    turnAllowed: true,
    sentFacing: null,
    serverFacing: startFacing,
    releaseCommitAcknowledged: false,
    echoMs: 0,
    snapshotIntervalMs: SERVER_TICK_MS,
    movementWireVersion,
    frameDt: 0,
  };
  let pendingReleaseFacing: number | null = null;
  let previousCameraDrivenFacing = false;
  let cameraYaw = startFacing;
  let selfFacingOverride: number | null = null;
  let selfFacingLastTarget: number | null = null;

  function stepServer(): void {
    // biome-ignore lint/suspicious/noExplicitAny: the server-loop internals a manual step drives
    const internals = server as any;
    internals.clearStaleInputs();
    consumeMovementFramesV2(server.sim, [session]);
    const events = server.sim.tick();
    updateMovementOverrideEpochs(server.sim, [session]);
    internals.routeEvents(events);
    internals.broadcastSnapshots();
    if (recordingFromMs === null) return;
    const tMs = clock.now() - recordingFromMs;
    ticks.push({
      tick: Math.round(tMs / SERVER_TICK_MS) - 1,
      tMs,
      x: serverEntity.pos.x,
      y: serverEntity.pos.y,
      z: serverEntity.pos.z,
      facing: serverEntity.facing,
      consumedCt: session.lastConsumedCt,
    });
  }

  function stepFrame(): void {
    const now = clock.now();
    let frameDt = (now - lastFrameAtMs) / 1000;
    lastFrameAtMs = now;
    if (frameDt > MAX_FRAME_DT_SEC) frameDt = MAX_FRAME_DT_SEC;
    // main.ts's online arm only runs in-world; before the first snapshot there
    // is no self to draw and no mirror to interpolate.
    if (!client.connected || !client.entities.has(client.playerId)) return;
    const pe = client.player;

    // 1) alpha, read BEFORE this frame's echo samples are folded (main.ts).
    const alpha = snapshotAlpha(now, client.lastSnapAt, client.snapInterval);
    // The interpolated authoritative heading. main.ts falls back to it when no
    // input-derived heading exists; a script always supplies one (see the
    // header's scope note), so here it is recorded rather than consumed.
    const interpServerFacing = interpolatedOnlineSelfFacing(client, pe, alpha);

    // 2) the scripted intent for this frame, in place of the DOM input stack.
    const mi: MoveInput = { ...heldInput };
    let netFacing = heldFacing;
    let onlineRenderFacing = netFacing;
    let cameraFacing = netFacing ?? interpServerFacing;
    let turnEngageEdge = false;
    let turnInputActive = false;
    const wireMi: MoveInput = { ...mi };
    if (opts.keyTimeline) {
      const cameraDrivenFacing = heldFacing !== null;
      turnInputActive = mi.turnLeft || mi.turnRight || cameraDrivenFacing;
      if (heldFacing !== null) cameraYaw = heldFacing;
      const edgeReleaseFacing = mouselookReleaseFacing(
        previousCameraDrivenFacing,
        cameraDrivenFacing,
        cameraYaw,
      );
      previousCameraDrivenFacing = cameraDrivenFacing;
      if (edgeReleaseFacing !== null) {
        pendingReleaseFacing = edgeReleaseFacing;
        seedKeyboardTurnRelease(kbTurn, edgeReleaseFacing);
      }
      const foreignFacing = heldFacing ?? pendingReleaseFacing;
      kbTurnArgs.turnLeft = mi.turnLeft;
      kbTurnArgs.turnRight = mi.turnRight;
      kbTurnArgs.turnAllowed =
        client.spectating === null && !isMovementFrozen(pe) && !isPlayerImmobilized(pe.auras);
      kbTurnArgs.sentFacing = heldFacing;
      kbTurnArgs.serverFacing = interpServerFacing;
      kbTurnArgs.releaseCommitAcknowledged = client.inputFacingAcknowledged(
        kbTurn.pendingReleaseCommit,
      );
      kbTurnArgs.echoMs = inputEcho.echoMs;
      kbTurnArgs.snapshotIntervalMs = client.snapInterval;
      kbTurnArgs.movementWireVersion = client.movementWireVersion;
      kbTurnArgs.frameDt = frameDt;
      const kbFacing = stepKeyboardTurnFacing(kbTurn, kbTurnArgs);
      netFacing = foreignFacing ?? kbTurn.wireFacing;
      const localFacing = netFacing ?? kbFacing;
      onlineRenderFacing =
        diagonalMovementVisualFacing(mi, localFacing ?? interpServerFacing) ?? localFacing;
      cameraFacing = heldFacing ?? kbFacing ?? interpServerFacing;
      turnEngageEdge =
        kbFacing !== null && (mi.turnLeft || mi.turnRight) && !kbTurn.suppressTurnFlags;
      if (kbTurn.suppressTurnFlags) {
        wireMi.turnLeft = false;
        wireMi.turnRight = false;
      }
    }

    // 3) the prediction gate, then the wire write exactly as main.ts does it.
    selfMotionGateArgs.spectating = client.spectating;
    selfMotionGateArgs.movementFrozen = isMovementFrozen(pe);
    selfMotionGateArgs.playerImmobilized = isPlayerImmobilized(pe.auras);
    selfMotionGateArgs.posX = pe.pos.x;
    selfMotionGateArgs.climbing = pe.climbing;
    selfMotionGateArgs.riftFloor = client.riftFloor;
    const predictionEnabled = selfMotionPredictionEnabled(selfMotionGateArgs);
    movementPrediction.prepare(client, pe, predictionEnabled);
    // The unconditional 50 ms lane runs beside this from ClientWorld's own timer.
    Object.assign(client.moveInput, wireMi);
    client.setMouselookFacing(netFacing);
    let movementFrameEmitted = client.movementWireVersion !== 2 ? client.flushInput(now) : false;
    const firstSampledCommand = commands.length;
    movementFrameEmitted =
      movementPrediction.advance(
        client,
        frameDt,
        client.moveInput,
        netFacing,
        now,
        turnEngageEdge,
      ) || movementFrameEmitted;
    if (opts.keyTimeline && movementFrameEmitted) pendingReleaseFacing = null;
    const samplerInterpolationAlpha = movementPrediction.interpolationAlpha;
    for (let i = firstSampledCommand; i < commands.length; i++) {
      commands[i].samplerInterpolationAlpha = samplerInterpolationAlpha;
    }

    // 4) fold the echo samples, then drain the events the discontinuity flag
    // is read from.
    inputEcho.fold(client.consumeInputEchoSamples());
    const drainedEvents = client.drainEvents();
    const discontinuity = hasAuthoritativeSelfPositionDiscontinuity(drainedEvents, client.playerId);

    // 5) the display frame selected by the negotiated movement wire.
    const cameraLastSnapAge = client.lastSnapAt > 0 ? now - client.lastSnapAt : -1;
    const selfMotion =
      client.movementWireVersion === 2
        ? movementPrediction.display()
        : selfMotionFrameBuffer.write(
            predictionEnabled,
            mi,
            netFacing ?? interpServerFacing,
            inputEcho.echoMs,
            inputEcho.jitterMs,
            alpha,
            frameDt,
            Math.max(0, cameraLastSnapAge),
            client.snapInterval,
            client.riftFloor,
          );

    let drawnYaw = interpServerFacing;
    if (onlineRenderFacing !== null) {
      const previousModel = selfFacingOverride ?? drawnYaw;
      const lastTarget = selfFacingLastTarget ?? onlineRenderFacing;
      drawnYaw = advanceSelfFacing(previousModel, onlineRenderFacing, lastTarget, frameDt);
      selfFacingOverride = drawnYaw;
      selfFacingLastTarget = onlineRenderFacing;
    } else if (selfFacingOverride !== null) {
      const released = releaseSelfFacing(selfFacingOverride, drawnYaw, frameDt);
      drawnYaw = released.facing;
      selfFacingOverride = released.done ? null : released.facing;
      selfFacingLastTarget = released.lastTarget;
    }
    const reconciled =
      selfMotion && 'kind' in selfMotion && selfMotion.residual !== null ? selfMotion : null;
    const residualYd = reconciled
      ? Math.hypot(reconciled.residual?.x ?? 0, reconciled.residual?.z ?? 0)
      : 0;

    // 6) the drawn pose, through the same call renderer.sync makes.
    noteSelfIdentity(selfRender, pe.id);
    const selfAlphaLead = adaptiveSelfAlphaLead(
      inputEcho.echoMs,
      inputEcho.jitterMs,
      client.snapInterval,
    );
    const drawn = updateSelfRenderPosition(
      selfRender,
      pe,
      client.cfg.seed,
      alpha,
      frameDt,
      selfAlphaLead,
      selfMotion,
      discontinuity,
    );

    if (recordingFromMs === null) return;
    const tMs = now - recordingFromMs;
    frames.push({
      tMs,
      frameDtSec: frameDt,
      x: drawn.x,
      y: drawn.y,
      z: drawn.z,
      selfId: pe.id,
      spectating: client.spectating,
      mirrorX: pe.pos.x,
      mirrorY: pe.pos.y,
      mirrorZ: pe.pos.z,
      alpha,
      lastSnapAt: client.lastSnapAt,
      echoMs: inputEcho.echoMs,
      jitterMs: inputEcho.jitterMs,
      selfAlphaLead,
      samplerInterpolationAlpha,
      predictorActive: selfRender.active,
      predictionEnabled,
      turnInputActive,
      mi,
      netFacing,
      serverFacing: interpServerFacing,
      authoritativeFacing: serverEntity.facing,
      drawnYaw,
      cameraFacing,
      reconcileMode: reconciled ? 'replayed' : null,
      residualYd,
    });
  }

  let disposed = false;
  // The clock owns process-wide globals (Date.now, window, document) and so
  // does the WebSocket stub, so a harness that fails to come up must put them
  // back: leaving them installed turns one bad cell into a cascade of confusing
  // failures in every later one.
  function teardown(): void {
    if (disposed) return;
    disposed = true;
    link.disconnect();
    client.close();
    globals.WebSocket = previousWebSocket;
    clock.uninstall();
  }

  clock.setInterval(stepServer, SERVER_TICK_MS);
  clock.setInterval(stepFrame, frameMs);
  clock.advanceTo(warmupMs);
  // A scenario that started before the mirror had the self would measure the
  // world-entry transient instead of movement, so refuse rather than run.
  if (!client.connected || !client.entities.has(client.playerId)) {
    teardown();
    throw new Error('the client mirror never synced during warmup: raise warmupMs');
  }

  return {
    clock,
    link,
    server,
    session,
    client,
    pid,
    serverEntity,
    runScript(options: RunScriptOptions): HarnessRun {
      const { durationMs } = options;
      const script = [...(options.script ?? [])].sort((a, b) => a.atMs - b.atMs);
      const origin = clock.now();
      recordingFromMs = origin;
      frames = [];
      ticks = [];
      const outboxBefore =
        (client as unknown as { movementFrameOutbox?: { droppedOldest: number } })
          .movementFrameOutbox?.droppedOldest ?? 0;
      // Seed the timeline with the intent the WIRE was already carrying when
      // recording opened (the idle warmup): without it the run's very first
      // frame looks like the start of the timeline rather than what it is, a
      // held-input CHANGE, and every start transition would be scored as
      // steady state.
      commands = [{ tMs: 0, mi: { ...wireIntent }, facing: wireFacing }];
      // The intent timeline is applied on the clock, so a script entry lands at
      // its exact scripted instant and the frame that follows carries it.
      for (const entry of script) {
        clock.schedule(origin + entry.atMs, () => {
          if (entry.mi) Object.assign(heldInput, entry.mi);
          if (entry.facing !== undefined) heldFacing = entry.facing;
        });
      }
      if (options.facingAt) {
        const facingAt = options.facingAt;
        // A swept heading is sampled on the FRAME clock, which is where a real
        // mouselook heading is produced.
        const sweep = clock.setInterval(() => {
          const tMs = clock.now() - origin;
          if (tMs >= 0 && tMs <= durationMs) heldFacing = facingAt(tMs);
        }, frameMs);
        clock.schedule(origin + durationMs, () => clock.cancel(sweep));
      }
      for (const action of options.actions ?? []) {
        clock.schedule(origin + action.atMs, action.run);
      }
      clock.advanceTo(origin + durationMs);
      recordingFromMs = null;
      const tickCount = Math.floor(durationMs / SERVER_TICK_MS);
      return {
        frames,
        ticks,
        commands,
        tickScript: frameCommandsToTickScript(commands, tickCount),
        tickCount,
        movementTimeline: session.movementTimeline
          ? {
              consumed: session.movementTimeline.consumed,
              starved: session.movementTimeline.starved,
              extrapolated: session.movementTimeline.extrapolated,
              discardedLate: session.movementTimeline.discardedLate,
              resyncs: session.movementTimeline.resyncs,
            }
          : null,
        movementOutboxDroppedOldest:
          ((client as unknown as { movementFrameOutbox?: { droppedOldest: number } })
            .movementFrameOutbox?.droppedOldest ?? 0) - outboxBefore,
      };
    },
    dispose: teardown,
  };
}
