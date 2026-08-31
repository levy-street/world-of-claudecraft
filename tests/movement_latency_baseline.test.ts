import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Postgres is mocked before the server/game import the harness pulls in
// (tests/CLAUDE.md, Server tests). Superset shape, copied from
// tests/unstuck_online.test.ts.
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
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { MOVEMENT_INPUT_TIMELINE_DEPTH } from '../server/movement_input_timeline_v2';
import { HANDOFF_DONE_EPS } from '../src/game/keyboard_turn_facing';
import { MOVEMENT_FRAME_V2_PENDING_CAP } from '../src/net/movement_frame_v2_wire';
import { MAX_SELF_REWIND_YD_PER_SEC } from '../src/render/self_render_position_core';
import { DT, emptyMoveInput, type MoveInput, RUN_SPEED, TURN_SPEED } from '../src/sim/types';
import type { LatencyLinkConfig } from './helpers/latency_link';
import {
  COLLIDER_FREE_LANE,
  type Pose,
  rawFakeWs,
  runTwinServerTrajectory,
  teleportEntity,
} from './helpers/movement_ground_truth';
import {
  type CommandSample,
  computeMovementMetrics,
  type GroundTruthSample,
  MOVEMENT_FEEL_TARGETS,
  MOVEMENT_FEEL_TARGETS_CC,
  type MovementMetrics,
  type MovementMetricsOptions,
} from './helpers/movement_metrics';
import {
  createOnlineHarness,
  type FrameScript,
  frameCommandsToTickScript,
  type HarnessRun,
  type OnlineHarness,
  type RunScriptOptions,
  SERVER_TICK_MS,
} from './helpers/online_harness';
import { stripComments } from './helpers/strip_comments';

// The v0.41.0 movement-feel BASELINE: what the real online client actually
// draws for the local player under simulated latency, measured against what the
// authority would have done with no latency at all.
//
// This suite is deliberately a PIN, not a bar. Every number in BASELINE came
// out of a run of this file and was hand-carried here from the reported
// measurement; none was chosen, and none is derived at test time (a table the
// run computes for itself would compare the code to itself and pass forever).
// UPDATE_MOVEMENT_BASELINE_DOC only regenerates the committed MARKDOWN from
// BASELINE; the numbers themselves are always a human transcribing a run.
//
// Every cell always runs its baseline pin. STRICT (the default since the
// reconciliation rework landed) additionally asserts MOVEMENT_FEEL_TARGETS
// (and MOVEMENT_FEEL_TARGETS_CC where the server legitimately overrides the
// client). The pins catch any silent change in either direction, and the
// targets are the feel bar itself. STRICT_MOVEMENT_TARGETS=0 runs pins only
// while iterating on a movement change that has not yet re-met the bar; the
// merge gate always runs with the default.

const STRICT = process.env.STRICT_MOVEMENT_TARGETS !== '0';
const UPDATE_TABLE = process.env.UPDATE_MOVEMENT_BASELINE_DOC === '1';
const BASELINE_DOC = join(import.meta.dirname, 'movement_latency_baseline.md');
const MAIN_TS = join(import.meta.dirname, '..', 'src', 'main.ts');
const ONLINE_MOVEMENT_FRAME_TS = join(
  import.meta.dirname,
  '..',
  'src',
  'game',
  'online_movement_frame.ts',
);
/** A stretch of the straight run with the key long since down and not yet
 *  released: what "steady" means for the lane-sanity check. */
const STEADY_FIRST_TICK = 20;
const STEADY_LAST_TICK = 40;
const ROUND2_FACING_QUANTUM = 0.01;
const FACING_ERROR_BOUND = HANDOFF_DONE_EPS + ROUND2_FACING_QUANTUM;

/** Per-direction delay envelope; a profile's RTT splits evenly across the two. */
function link(rttMs: number, jitterMs: number): LatencyLinkConfig {
  return {
    toServer: { baseMs: rttMs / 2, jitterMs, seed: 1337 },
    toClient: { baseMs: rttMs / 2, jitterMs, seed: 4242 },
  };
}

interface Profile {
  key: string;
  label: string;
  latency: LatencyLinkConfig;
}

const PROFILES: readonly Profile[] = [
  { key: 'rtt0', label: '0 ms', latency: link(0, 0) },
  { key: 'rtt50', label: '50 ms', latency: link(50, 0) },
  { key: 'rtt150j20', label: '150 ms + 20 jitter', latency: link(150, 20) },
  { key: 'rtt300j40', label: '300 ms + 40 jitter', latency: link(300, 40) },
];

const RUN_MS = 3000;

/** Forward for 3 s, then release and let the display settle for 1 s. */
const straightRun: RunScriptOptions = {
  durationMs: 4000,
  script: [
    { atMs: 0, mi: { forward: true }, facing: 0 },
    { atMs: RUN_MS, mi: { forward: false } },
  ],
};

/** Forward held while the heading sweeps 90 degrees, mouselook style. */
const curvedSteering: RunScriptOptions = {
  durationMs: RUN_MS + 1000,
  script: [
    { atMs: 0, mi: { forward: true }, facing: 0 },
    { atMs: RUN_MS, mi: { forward: false } },
  ],
  facingAt: (tMs) => (Math.PI / 4) * Math.sin((2 * Math.PI * tMs) / 2000),
};

/** Forward plus a strafe that flips every 500 ms. */
const strafeWeave: RunScriptOptions = {
  durationMs: RUN_MS + 1000,
  script: (() => {
    const script: FrameScript = [{ atMs: 0, mi: { forward: true, strafeLeft: true }, facing: 0 }];
    const out = [...script];
    for (let i = 1; i * 500 < RUN_MS; i++) {
      out.push({
        atMs: i * 500,
        mi: { strafeLeft: i % 2 === 0, strafeRight: i % 2 === 1 },
      });
    }
    out.push({
      atMs: RUN_MS,
      mi: { forward: false, strafeLeft: false, strafeRight: false },
    });
    return out;
  })(),
};

/** A jump taken mid-run, held for one input quantum. */
const runWithJump: RunScriptOptions = {
  durationMs: RUN_MS + 1000,
  script: [
    { atMs: 0, mi: { forward: true }, facing: 0 },
    { atMs: 1500, mi: { jump: true } },
    { atMs: 1600, mi: { jump: false } },
    { atMs: RUN_MS, mi: { forward: false } },
  ],
};

/** Five 300 ms taps with 300 ms between them. */
const startStopTapping: RunScriptOptions = {
  durationMs: RUN_MS,
  script: (() => {
    const out: FrameScript[number][] = [{ atMs: 0, mi: {}, facing: 0 }];
    for (let i = 0; i < 5; i++) {
      out.push({ atMs: i * 600, mi: { forward: true } });
      out.push({ atMs: i * 600 + 300, mi: { forward: false } });
    }
    return out;
  })(),
};

interface Scenario {
  key: string;
  label: string;
  options: RunScriptOptions;
  /** Per-scenario metric tuning; the default ramp window is 150 ms. */
  metrics?: MovementMetricsOptions;
}

const SCENARIOS: readonly Scenario[] = [
  { key: 'straight', label: 'straight run + stop', options: straightRun },
  { key: 'curved', label: 'curved steering', options: curvedSteering },
  { key: 'weave', label: 'strafe weave', options: strafeWeave },
  { key: 'jump', label: 'run with jump', options: runWithJump },
  {
    key: 'tapping',
    label: 'start-stop tapping',
    options: startStopTapping,
    // The taps are 300 ms apart, so the default 150 ms ramp window would
    // exclude the entire timeline and leave the steady metrics vacuous. 100 ms
    // still covers every transition (the start dead-time is 50 ms) and leaves
    // the middle of each tap measurable.
    metrics: { rampWindowMs: 100 },
  },
];

const turnTapIdle: RunScriptOptions = {
  durationMs: 1500,
  script: [
    { atMs: 300, mi: { turnLeft: true } },
    { atMs: 500, mi: { turnLeft: false } },
  ],
};

const turnTapWalking: RunScriptOptions = {
  durationMs: 1800,
  script: [
    { atMs: 0, mi: { forward: true } },
    { atMs: 500, mi: { turnLeft: true } },
    { atMs: 700, mi: { turnLeft: false } },
    { atMs: 1000, mi: { forward: false } },
  ],
};

const mouselookDragRelease: RunScriptOptions = {
  durationMs: 1600,
  script: [
    { atMs: 100, facing: 0 },
    { atMs: 200, facing: 0.2 },
    { atMs: 300, facing: 0.4 },
    { atMs: 400, facing: 0.6 },
    { atMs: 560, facing: 0.8 },
    { atMs: 570, facing: null },
  ],
};

const FACING_SCENARIOS: readonly Scenario[] = [
  { key: 'turn-idle', label: 'turn tap while idle', options: turnTapIdle },
  { key: 'turn-walking', label: 'turn tap while walking', options: turnTapWalking },
  { key: 'mouselook-release', label: 'mouselook drag + release', options: mouselookDragRelease },
];
const FACING_PROFILES = PROFILES.filter(
  (profile) => profile.key === 'rtt0' || profile.key === 'rtt150j20',
);
const FACING_KEYS = FACING_SCENARIOS.flatMap((scenario) =>
  FACING_PROFILES.map((profile) => `${scenario.key}/${profile.key}`),
);

/** The pinned numbers, one row per measured cell. */
interface BaselineRow {
  backwardCount: number;
  backwardWorstYd: number;
  deviationMaxYd: number;
  deviationMeanYd: number;
  progressMaxAbsYd: number;
  progressTerminalYd: number;
  speedErrYdPerSec: number;
  speedDeltaYdPerSec: number;
  correctionEvents: number;
  inputToAuthorityMaxMs: number;
  inputToAuthorityMeanMs: number;
  replayEvents?: number;
}

interface FacingBaselineRow {
  maxPostReleaseYawRate: number;
  reversals: number;
  continuitySamples: number;
  maxCameraSplitRad: number;
  cameraSplitSamples: number;
  terminalSettleRad: number;
  settleSamples: number;
}

function rowOf(metrics: MovementMetrics): BaselineRow {
  return {
    backwardCount: metrics.backwardSteps.count,
    backwardWorstYd: metrics.backwardSteps.worstYd,
    deviationMaxYd: metrics.pathDeviation.maxYd,
    deviationMeanYd: metrics.pathDeviation.meanYd,
    progressMaxAbsYd: metrics.progressError.maxAbsYd,
    progressTerminalYd: metrics.progressError.terminalYd,
    speedErrYdPerSec: metrics.speedContinuity.maxSpeedErr,
    speedDeltaYdPerSec: metrics.speedContinuity.maxSpeedDelta,
    correctionEvents: metrics.correctionEvents.count,
    inputToAuthorityMaxMs: metrics.inputToAuthorityMs.maxMs,
    inputToAuthorityMeanMs: metrics.inputToAuthorityMs.meanMs,
    replayEvents: metrics.replayEvents.count,
  };
}

function facingRowOf(metrics: MovementMetrics): FacingBaselineRow {
  return {
    maxPostReleaseYawRate: metrics.facingContinuity.maxPostReleaseYawRate,
    reversals: metrics.facingContinuity.reversals,
    continuitySamples: metrics.facingContinuity.samples,
    maxCameraSplitRad: metrics.facingCameraSplit.maxRad,
    cameraSplitSamples: metrics.facingCameraSplit.samples,
    terminalSettleRad: metrics.facingSettleError.terminalRad,
    settleSamples: metrics.facingSettleError.samples,
  };
}

interface CellResult {
  run: HarnessRun;
  truth: GroundTruthSample[];
  metrics: MovementMetrics;
  movementTimelineBefore: HarnessRun['movementTimeline'];
  /** The zero-latency twin's full per-tick poses, kept for the honesty check
   *  (which compares facing too). Null for an authoritative-reference cell. */
  twinPoses: Pose[] | null;
}

/**
 * Which authority a cell is scored against.
 *  zeroLatency  - the twin GameServer running the same intent timeline with no
 *                 latency at all: the reference for "what should this have
 *                 looked like".
 *  authoritative- the harness's OWN server ticks. Used where server-side state
 *                 the twin cannot see (a stun, a snare applied to this world's
 *                 entity) makes the zero-latency trajectory a fiction; the
 *                 question there is whether the display agrees with the
 *                 authority it actually had.
 */
type Reference = 'zeroLatency' | 'authoritative';

/** The pose the authority holds at scenario time 0, before its first tick. */
const START_SAMPLE: GroundTruthSample = {
  tick: -1,
  x: COLLIDER_FREE_LANE.x,
  z: COLLIDER_FREE_LANE.z,
};

function zeroLatencyTruth(
  poses: readonly Pose[],
  commands: readonly CommandSample[],
): GroundTruthSample[] {
  const sampledCommands = commands.filter(
    (command): command is CommandSample & { ct: number } => command.ct !== undefined,
  );
  return [
    START_SAMPLE,
    ...poses.map((pose, tick) => ({ tick, x: pose.x, z: pose.z, ct: sampledCommands[tick]?.ct })),
  ];
}

function authoritativeTruth(run: HarnessRun): GroundTruthSample[] {
  return [
    START_SAMPLE,
    ...run.ticks.map((tick) => ({ tick: tick.tick, x: tick.x, z: tick.z, ct: tick.consumedCt })),
  ];
}

function scoreHarnessRun(
  run: HarnessRun,
  movementTimelineBefore: HarnessRun['movementTimeline'],
  reference: Reference,
  metricOptions: MovementMetricsOptions,
): CellResult {
  const twinPoses =
    reference === 'zeroLatency'
      ? runTwinServerTrajectory({ script: run.tickScript, ticks: run.tickCount })
      : null;
  const truth = twinPoses ? zeroLatencyTruth(twinPoses, run.commands) : authoritativeTruth(run);
  const metrics = computeMovementMetrics(
    run.frames.map((frame) => ({
      tMs: frame.tMs,
      x: frame.x,
      z: frame.z,
      drawnYaw: frame.drawnYaw,
      cameraFacing: frame.cameraFacing,
      authoritativeFacing: frame.authoritativeFacing,
      turnInputActive: frame.turnInputActive,
      mi: frame.mi,
      reconcileMode: frame.reconcileMode,
      residualYd: frame.residualYd,
    })),
    truth,
    run.commands,
    { tickMs: SERVER_TICK_MS, tickPhaseMs: SERVER_TICK_MS, ...metricOptions },
    run.ticks,
  );
  return { run, truth, metrics, movementTimelineBefore, twinPoses };
}

function measure(
  latency: LatencyLinkConfig,
  options: RunScriptOptions,
  reference: Reference = 'zeroLatency',
  withHarness?: (harness: OnlineHarness, options: RunScriptOptions) => RunScriptOptions,
  metricOptions: MovementMetricsOptions = {},
  keyTimeline = false,
): CellResult {
  const harness = createOnlineHarness({ latency, keyTimeline });
  try {
    const resolved = withHarness ? withHarness(harness, options) : options;
    const timeline = harness.session.movementTimeline;
    const movementTimelineBefore = timeline
      ? {
          consumed: timeline.consumed,
          starved: timeline.starved,
          extrapolated: timeline.extrapolated,
          discardedLate: timeline.discardedLate,
          resyncs: timeline.resyncs,
        }
      : null;
    const run = harness.runScript(resolved);
    return scoreHarnessRun(run, movementTimelineBefore, reference, metricOptions);
  } finally {
    harness.dispose();
  }
}

const cells = new Map<string, CellResult>();
const cellKey = (scenario: string, profile: string): string => `${scenario}/${profile}`;

// --- adversarial cells (all at 150 ms + 20 ms jitter) ---

// There is no reconnect cell in this harness. LatencyLink.disconnect() is
// deliberately one way, ClientWorld owns one fixed socket, and GameServer.join
// owns one fixed session. A second harness would measure a fresh join rather
// than the production reconnect path, so this suite does not claim that case.

const ADVERSARIAL_PROFILE = link(150, 20);
const STARVATION_PROFILE = link(300, 20);
const STALL_AT_MS = 1500;
const STALL_MS = 500;
const CC_AT_MS = 1500;
const BACKPRESSURE_BASE_DELAY_MS = 24_500;
const BACKPRESSURE_LATENCY_STEP_INTERVAL_MS = 500;
const BACKPRESSURE_LATENCY_STEP_MS = 800;
const BACKPRESSURE_LATENCY_RAMP_END_MS = 2000;
const BACKPRESSURE_DRAIN_DELAY_MS = 600;
const BACKPRESSURE_LATENCY_RESTORE_AT_MS = 29_100;
const BACKPRESSURE_EPISODE_MS = 29_900;
const SPECTATE_AT_MS = 500;
const SPECTATE_EXIT_AT_MS = 1500;
const SPECTATE_TARGET = { x: 40, z: COLLIDER_FREE_LANE.z } as const;

const stallRun: RunScriptOptions = {
  durationMs: RUN_MS,
  script: [{ atMs: 0, mi: { forward: true }, facing: 0 }],
};

const overrideRun: RunScriptOptions = {
  durationMs: RUN_MS + 1000,
  script: [
    { atMs: 0, mi: { forward: true }, facing: 0 },
    { atMs: RUN_MS, mi: { forward: false } },
  ],
};

function withStall(harness: OnlineHarness, options: RunScriptOptions): RunScriptOptions {
  return {
    ...options,
    actions: [
      {
        atMs: STALL_AT_MS,
        // Head-of-line blocking on the downstream: every snapshot already in
        // flight is held too, which is what a congestion burst does.
        run: () => harness.link.stall('toClient', harness.clock.now() + STALL_MS),
      },
    ],
  };
}

function withStarvationStall(harness: OnlineHarness, options: RunScriptOptions): RunScriptOptions {
  return {
    ...options,
    actions: [
      {
        atMs: STALL_AT_MS,
        // Beyond about 120 ms, the two-frame extrapolation budget is exhausted
        // and leaves phase debt that makes the server end short. Follow-up work.
        run: () => harness.link.stall('toServer', harness.clock.now() + 100),
      },
    ],
  };
}

interface BackpressureRecoveryCell {
  shedRun: HarnessRun;
  recovery: CellResult;
  timelineBeforeShed: NonNullable<HarnessRun['movementTimeline']>;
}

function measureBackpressureRecovery(): BackpressureRecoveryCell {
  const harness = createOnlineHarness({ latency: ADVERSARIAL_PROFILE });
  try {
    const timeline = harness.session.movementTimeline;
    if (!timeline) throw new Error('the backpressure cell has no movement timeline');
    const timelineBeforeShed = {
      consumed: timeline.consumed,
      starved: timeline.starved,
      extrapolated: timeline.extrapolated,
      discardedLate: timeline.discardedLate,
      resyncs: timeline.resyncs,
    };
    const slowDrainActions = Array.from(
      { length: BACKPRESSURE_LATENCY_RAMP_END_MS / BACKPRESSURE_LATENCY_STEP_INTERVAL_MS },
      (_, step) => ({
        atMs: step * BACKPRESSURE_LATENCY_STEP_INTERVAL_MS,
        run: () =>
          harness.link.setLatency(
            'toServer',
            BACKPRESSURE_BASE_DELAY_MS + step * BACKPRESSURE_LATENCY_STEP_MS,
            0,
          ),
      }),
    );
    const shedRun = harness.runScript({
      durationMs: BACKPRESSURE_EPISODE_MS,
      facingAt: (tMs) => Math.sin(tMs / 1000),
      actions: [
        ...slowDrainActions,
        {
          atMs: BACKPRESSURE_LATENCY_RAMP_END_MS,
          run: () => harness.link.setLatency('toServer', BACKPRESSURE_DRAIN_DELAY_MS, 0),
        },
        {
          atMs: BACKPRESSURE_LATENCY_RESTORE_AT_MS,
          run: () =>
            harness.link.setLatency(
              'toServer',
              ADVERSARIAL_PROFILE.toServer.baseMs,
              ADVERSARIAL_PROFILE.toServer.jitterMs,
            ),
        },
      ],
    });
    const recoveryBefore = shedRun.movementTimeline;
    const recoveryRun = harness.runScript(straightRun);
    return {
      shedRun,
      recovery: scoreHarnessRun(recoveryRun, recoveryBefore, 'zeroLatency', {}),
      timelineBeforeShed,
    };
  } finally {
    harness.dispose();
  }
}

let backpressureRecovery: BackpressureRecoveryCell;

interface SpectateCell {
  run: HarnessRun;
  targetPid: number;
  targetName: string;
}

function measureSpectateTransition(): SpectateCell {
  const harness = createOnlineHarness({ latency: ADVERSARIAL_PROFILE });
  try {
    const targetClient = rawFakeWs();
    const joined = harness.server.join(targetClient.ws, 2, 2, 'Observed', 'rogue', null, false, {
      movementWireVersion: 2,
    });
    if ('error' in joined) throw new Error(joined.error);
    joined.blockListLoaded = true;
    const target = harness.server.sim.entities.get(joined.pid);
    if (!target) throw new Error('the spectate target is missing from the server sim');
    teleportEntity(target, SPECTATE_TARGET.x, SPECTATE_TARGET.z, harness.server.sim.cfg.seed);
    const spectateHost = harness.server as unknown as {
      enterSpectate(moderator: typeof harness.session, target: typeof joined): void;
      exitSpectate(moderator: typeof harness.session): void;
    };
    const run = harness.runScript({
      durationMs: 3000,
      actions: [
        {
          atMs: SPECTATE_AT_MS,
          run: () => spectateHost.enterSpectate(harness.session, joined),
        },
        {
          atMs: SPECTATE_EXIT_AT_MS,
          run: () => spectateHost.exitSpectate(harness.session),
        },
      ],
    });
    return { run, targetPid: joined.pid, targetName: joined.name };
  } finally {
    harness.dispose();
  }
}

let spectateTransition: SpectateCell;

/** The aura shape effect_dispatch applies, pushed straight onto the authority. */
function withServerAura(
  kind: 'stun' | 'slow',
  value: number,
  seconds: number,
): (harness: OnlineHarness, options: RunScriptOptions) => RunScriptOptions {
  return (harness, options) => ({
    ...options,
    actions: [
      {
        atMs: CC_AT_MS,
        run: () => {
          harness.serverEntity.auras.push({
            id: `harness_${kind}`,
            name: kind === 'stun' ? 'Harness Stun' : 'Harness Snare',
            kind,
            remaining: seconds,
            duration: seconds,
            value,
            sourceId: harness.pid,
            school: 'physical',
          });
        },
      },
    ],
  });
}

function withOverrideChurn(harness: OnlineHarness, options: RunScriptOptions): RunScriptOptions {
  const applyStun = (id: string): void => {
    harness.serverEntity.auras.push({
      id,
      name: 'Harness Churn Stun',
      kind: 'stun',
      remaining: 0.35,
      duration: 0.35,
      value: 0,
      sourceId: harness.pid,
      school: 'physical',
    });
  };
  return {
    ...options,
    actions: [
      { atMs: 600, run: () => applyStun('harness_churn_1') },
      { atMs: 1800, run: () => applyStun('harness_churn_2') },
    ],
  };
}

beforeAll(() => {
  for (const scenario of SCENARIOS) {
    for (const profile of PROFILES) {
      cells.set(
        cellKey(scenario.key, profile.key),
        measure(profile.latency, scenario.options, 'zeroLatency', undefined, scenario.metrics),
      );
    }
  }
  for (const scenario of FACING_SCENARIOS) {
    for (const profile of FACING_PROFILES) {
      cells.set(
        cellKey(scenario.key, profile.key),
        measure(profile.latency, scenario.options, 'zeroLatency', undefined, {}, true),
      );
    }
  }
  cells.set(
    'adv-stall/rtt150j20',
    measure(ADVERSARIAL_PROFILE, stallRun, 'zeroLatency', withStall),
  );
  cells.set(
    'adv-stun/rtt150j20',
    measure(ADVERSARIAL_PROFILE, overrideRun, 'authoritative', withServerAura('stun', 0, 1)),
  );
  cells.set(
    'adv-snare/rtt150j20',
    measure(ADVERSARIAL_PROFILE, overrideRun, 'authoritative', withServerAura('slow', 0.5, 1)),
  );
  cells.set(
    'adv-override-churn/rtt150j20',
    measure(ADVERSARIAL_PROFILE, overrideRun, 'authoritative', withOverrideChurn),
  );
  cells.set(
    'starvation-straight/rtt300j20',
    measure(STARVATION_PROFILE, straightRun, 'zeroLatency', withStarvationStall),
  );
  backpressureRecovery = measureBackpressureRecovery();
  spectateTransition = measureSpectateTransition();
}, 60_000);

function cell(key: string): CellResult {
  const found = cells.get(key);
  if (!found) throw new Error(`no measured cell ${key}`);
  return found;
}

const YD_DIGITS = 4;

function expectPinned(key: string, pinned: BaselineRow): void {
  const measured = rowOf(cell(key).metrics);
  expect(measured.backwardCount).toBe(pinned.backwardCount);
  expect(measured.correctionEvents).toBe(pinned.correctionEvents);
  expect(measured.backwardWorstYd).toBeCloseTo(pinned.backwardWorstYd, YD_DIGITS);
  expect(measured.deviationMaxYd).toBeCloseTo(pinned.deviationMaxYd, YD_DIGITS);
  expect(measured.deviationMeanYd).toBeCloseTo(pinned.deviationMeanYd, YD_DIGITS);
  expect(measured.progressMaxAbsYd).toBeCloseTo(pinned.progressMaxAbsYd, YD_DIGITS);
  expect(measured.progressTerminalYd).toBeCloseTo(pinned.progressTerminalYd, YD_DIGITS);
  expect(measured.speedErrYdPerSec).toBeCloseTo(pinned.speedErrYdPerSec, YD_DIGITS);
  expect(measured.speedDeltaYdPerSec).toBeCloseTo(pinned.speedDeltaYdPerSec, YD_DIGITS);
  expect(measured.inputToAuthorityMaxMs).toBeCloseTo(pinned.inputToAuthorityMaxMs, YD_DIGITS);
  expect(measured.inputToAuthorityMeanMs).toBeCloseTo(pinned.inputToAuthorityMeanMs, YD_DIGITS);
  expect(measured.replayEvents).toBe(pinned.replayEvents ?? 0);
}

/** The cells scored against the crowd-control bar: the server is overriding the
 *  client's speed there, so the ordinary speed and correction targets would be
 *  asserting against correct behavior (see MOVEMENT_FEEL_TARGETS_CC). */
const CC_TARGET_CELLS = new Set([
  'adv-stun/rtt150j20',
  'adv-snare/rtt150j20',
  'adv-override-churn/rtt150j20',
]);

function expectTargets(key: string): void {
  const metrics = cell(key).metrics;
  if (CC_TARGET_CELLS.has(key)) {
    expect(metrics.backwardSteps.worstYd).toBeGreaterThanOrEqual(
      -MOVEMENT_FEEL_TARGETS_CC.backwardStepYd,
    );
    expect(Math.abs(metrics.progressError.terminalYd)).toBeLessThanOrEqual(
      MOVEMENT_FEEL_TARGETS_CC.settleYd,
    );
    return;
  }
  expectOrdinaryTargets(metrics);
}

function expectOrdinaryTargets(metrics: MovementMetrics): void {
  expect(metrics.replayEvents.count).toBe(MOVEMENT_FEEL_TARGETS.replayEvents);
  expect(metrics.correctionEvents.count).toBe(MOVEMENT_FEEL_TARGETS.correctionEvents);
  // Worst magnitude AND count: a run that snaps back a hair on every single
  // frame is exactly the artifact this bar exists for, and a magnitude-only
  // assertion would pass it.
  expect(metrics.backwardSteps.count).toBe(0);
  expect(metrics.backwardSteps.worstYd).toBeGreaterThanOrEqual(
    -MOVEMENT_FEEL_TARGETS.backwardStepYd,
  );
  expect(metrics.pathDeviation.maxYd).toBeLessThanOrEqual(MOVEMENT_FEEL_TARGETS.pathDeviationYd);
  expect(metrics.progressError.maxAbsYd).toBeLessThanOrEqual(MOVEMENT_FEEL_TARGETS.progressMaxYd);
  expect(metrics.speedContinuity.maxSpeedErr).toBeLessThanOrEqual(
    MOVEMENT_FEEL_TARGETS.speedErrYdPerSec,
  );
  expect(metrics.speedContinuity.maxSpeedDelta).toBeLessThanOrEqual(
    MOVEMENT_FEEL_TARGETS.speedDeltaYdPerSec,
  );
  expect(Math.abs(metrics.progressError.terminalYd)).toBeLessThanOrEqual(
    MOVEMENT_FEEL_TARGETS.settleYd,
  );
}

const BASELINE: Record<string, BaselineRow> = {
  'straight/rtt0': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 50,
    inputToAuthorityMeanMs: 38.958333,
  },
  'straight/rtt50': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.097222,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 66.666667,
    inputToAuthorityMeanMs: 66.666667,
  },
  'straight/rtt150j20': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.135763,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 100,
    inputToAuthorityMeanMs: 100,
  },
  'straight/rtt300j40': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.082078,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 216.666667,
    inputToAuthorityMeanMs: 216.666667,
  },
  'curved/rtt0': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 50,
    inputToAuthorityMeanMs: 38.958333,
  },
  'curved/rtt50': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.097222,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0.013277,
    speedDeltaYdPerSec: 0.013277,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 66.666667,
    inputToAuthorityMeanMs: 66.666667,
  },
  'curved/rtt150j20': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.135763,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0.006991,
    speedDeltaYdPerSec: 0.006991,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 100,
    inputToAuthorityMeanMs: 100,
  },
  'curved/rtt300j40': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.082078,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0.0114,
    speedDeltaYdPerSec: 0.0114,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 216.666667,
    inputToAuthorityMeanMs: 216.666667,
  },
  'weave/rtt0': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 50,
    inputToAuthorityMeanMs: 38.958333,
  },
  'weave/rtt50': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.097222,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 66.666667,
    inputToAuthorityMeanMs: 66.666667,
  },
  'weave/rtt150j20': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.135763,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 100,
    inputToAuthorityMeanMs: 100,
  },
  'weave/rtt300j40': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.082078,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 216.666667,
    inputToAuthorityMeanMs: 216.666667,
  },
  'jump/rtt0': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 50,
    inputToAuthorityMeanMs: 38.958333,
  },
  'jump/rtt50': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.097222,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 66.666667,
    inputToAuthorityMeanMs: 66.666667,
  },
  'jump/rtt150j20': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.135763,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 100,
    inputToAuthorityMeanMs: 100,
  },
  'jump/rtt300j40': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.082078,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 216.666667,
    inputToAuthorityMeanMs: 216.666667,
  },
  'tapping/rtt0': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 50,
    inputToAuthorityMeanMs: 40.277778,
  },
  'tapping/rtt50': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.097222,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 66.666667,
    inputToAuthorityMeanMs: 66.666667,
  },
  'tapping/rtt150j20': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.135763,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 100,
    inputToAuthorityMeanMs: 100,
  },
  'tapping/rtt300j40': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.082078,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 216.666667,
    inputToAuthorityMeanMs: 216.666667,
  },
  'adv-stall/rtt150j20': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.135763,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 100,
    inputToAuthorityMeanMs: 100,
  },
  'adv-stun/rtt150j20': {
    backwardCount: 24,
    backwardWorstYd: -0.197877,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 1.399262,
    progressTerminalYd: 0,
    speedErrYdPerSec: 14.316046,
    speedDeltaYdPerSec: 13.82748,
    correctionEvents: 14,
    inputToAuthorityMaxMs: 100,
    inputToAuthorityMeanMs: 100,
    replayEvents: 1,
  },
  'adv-snare/rtt150j20': {
    backwardCount: 9,
    backwardWorstYd: -0.19819,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 1.176938,
    progressTerminalYd: 0,
    speedErrYdPerSec: 14.073841,
    speedDeltaYdPerSec: 13.896273,
    correctionEvents: 9,
    inputToAuthorityMaxMs: 100,
    inputToAuthorityMeanMs: 100,
    replayEvents: 2,
  },
  'adv-override-churn/rtt150j20': {
    backwardCount: 42,
    backwardWorstYd: -0.197388,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 1.392203,
    progressTerminalYd: 0,
    speedErrYdPerSec: 14.225892,
    speedDeltaYdPerSec: 13.853088,
    correctionEvents: 30,
    inputToAuthorityMaxMs: 100,
    inputToAuthorityMeanMs: 100,
    replayEvents: 2,
  },
  'starvation-straight/rtt300j20': {
    backwardCount: 0,
    backwardWorstYd: 0,
    deviationMaxYd: 0,
    deviationMeanYd: 0,
    progressMaxAbsYd: 0.055604,
    progressTerminalYd: 0,
    speedErrYdPerSec: 0,
    speedDeltaYdPerSec: 0,
    correctionEvents: 0,
    inputToAuthorityMaxMs: 183.333333,
    inputToAuthorityMeanMs: 183.333333,
  },
};

const FACING_BASELINE: Record<string, FacingBaselineRow> = {
  'turn-idle/rtt0': {
    maxPostReleaseYawRate: 0,
    reversals: 0,
    continuitySamples: 61,
    maxCameraSplitRad: 0,
    cameraSplitSamples: 90,
    terminalSettleRad: 0,
    settleSamples: 1,
  },
  'turn-idle/rtt150j20': {
    maxPostReleaseYawRate: 0,
    reversals: 0,
    continuitySamples: 61,
    maxCameraSplitRad: 0,
    cameraSplitSamples: 90,
    terminalSettleRad: 0,
    settleSamples: 1,
  },
  'turn-walking/rtt0': {
    maxPostReleaseYawRate: 0,
    reversals: 0,
    continuitySamples: 67,
    maxCameraSplitRad: 0,
    cameraSplitSamples: 108,
    terminalSettleRad: 0,
    settleSamples: 1,
  },
  'turn-walking/rtt150j20': {
    maxPostReleaseYawRate: 0,
    reversals: 0,
    continuitySamples: 67,
    maxCameraSplitRad: 0,
    cameraSplitSamples: 108,
    terminalSettleRad: 0,
    settleSamples: 1,
  },
  'mouselook-release/rtt0': {
    maxPostReleaseYawRate: 0,
    reversals: 0,
    continuitySamples: 62,
    maxCameraSplitRad: 0,
    cameraSplitSamples: 96,
    terminalSettleRad: 0,
    settleSamples: 1,
  },
  'mouselook-release/rtt150j20': {
    maxPostReleaseYawRate: 0,
    reversals: 0,
    continuitySamples: 62,
    maxCameraSplitRad: 0,
    cameraSplitSamples: 96,
    terminalSettleRad: 0,
    settleSamples: 1,
  },
};

const CELL_LABELS: Record<string, string> = {
  'adv-stall/rtt150j20': 'HOL stall 500 ms mid-run',
  'adv-stun/rtt150j20': 'server stun mid-run',
  'adv-snare/rtt150j20': 'server snare mid-run',
  'adv-override-churn/rtt150j20': 'server stun apply and expire twice',
  'starvation-straight/rtt300j20': 'straight run + stop @ 300 ms + 20 jitter',
};

function formatRow(key: string, row: BaselineRow): string {
  const label =
    CELL_LABELS[key] ??
    (() => {
      const [scenario, profile] = key.split('/');
      const scenarioLabel = SCENARIOS.find((entry) => entry.key === scenario)?.label ?? scenario;
      const profileLabel = PROFILES.find((entry) => entry.key === profile)?.label ?? profile;
      return `${scenarioLabel} @ ${profileLabel}`;
    })();
  const cells3 = [
    row.backwardCount.toString(),
    row.backwardWorstYd.toFixed(4),
    row.deviationMaxYd.toFixed(3),
    row.deviationMeanYd.toFixed(3),
    row.progressMaxAbsYd.toFixed(3),
    row.progressTerminalYd.toFixed(3),
    row.speedErrYdPerSec.toFixed(2),
    row.speedDeltaYdPerSec.toFixed(2),
    row.correctionEvents.toString(),
    row.inputToAuthorityMaxMs.toFixed(1),
    row.inputToAuthorityMeanMs.toFixed(1),
    (row.replayEvents ?? 0).toString(),
  ];
  return `| ${label} | ${cells3.join(' | ')} |`;
}

function formatFacingRow(key: string, row: FacingBaselineRow): string {
  const [scenario, profile] = key.split('/');
  const scenarioLabel = FACING_SCENARIOS.find((entry) => entry.key === scenario)?.label ?? scenario;
  const profileLabel = PROFILES.find((entry) => entry.key === profile)?.label ?? profile;
  return `| ${scenarioLabel} @ ${profileLabel} | ${row.maxPostReleaseYawRate.toFixed(4)} | ${row.reversals} | ${row.continuitySamples} | ${row.maxCameraSplitRad.toFixed(4)} | ${row.cameraSplitSamples} | ${row.terminalSettleRad.toFixed(4)} | ${row.settleSamples} |`;
}

function renderBaselineDoc(): string {
  const header = [
    '<!-- Generated from tests/movement_latency_baseline.test.ts (BASELINE).',
    '     Regenerate with UPDATE_MOVEMENT_BASELINE_DOC=1 npx vitest run',
    '     tests/movement_latency_baseline.test.ts; never hand-edit. -->',
    '',
    '# Movement latency baseline (v0.41.0)',
    '',
    'What the online client DRAWS for the local player, scored against the',
    'zero-latency authoritative trajectory for the same intent timeline.',
    'Yards and yards per second; back = backward steps, dev = path deviation,',
    'prog = along-path progress error, corr = correction events.',
    '',
    "The three crowd-control rows are scored against the harness server's OWN",
    'ticks instead: the zero-latency twin never receives the aura, so its',
    'trajectory would be a fiction to compare against.',
    'Their measured replay counts pin designed override absorption; all other',
    'cells retain the strict zero-replay target.',
    '',
    '| cell | back n | back worst | dev max | dev mean | prog max | prog settle | speed err | speed delta | corr | input-authority max ms | input-authority mean ms | replay events |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const rows = Object.entries(BASELINE).map(([key, row]) => formatRow(key, row));
  const facingRows = Object.entries(FACING_BASELINE).map(([key, row]) => formatFacingRow(key, row));
  const facingHeader = [
    '',
    '## Facing baseline',
    '',
    '| cell | post-release max rad/s | reversals | continuity samples | camera split rad | camera samples | terminal rad | settle samples |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  return `${[...header, ...rows, ...facingHeader, ...facingRows].join('\n')}\n`;
}

describe('zero-latency ground-truth script conversion', () => {
  // The convention every measurement rests on, pinned on its own: tick k runs
  // at (k + 1) * 50 ms, so it acts on the last intent put on the wire at or
  // before that instant.
  const neutral = emptyMoveInput();
  const forward: MoveInput = { ...neutral, forward: true };

  it('gives a tick the last intent sent strictly before the instant it runs', () => {
    const script = frameCommandsToTickScript(
      [
        { tMs: 0, mi: neutral, facing: 0 },
        { tMs: 16.7, mi: forward, facing: 0.25 },
        { tMs: 50, mi: neutral, facing: 0.5 },
        { tMs: 83.3, mi: forward, facing: 0.75 },
      ],
      3,
    );

    // Tick 0 runs at 50 ms, and the frame sent AT that instant is handled
    // after it: the client's unconditional send timer is phase-aligned with
    // the world loop, so its 50 ms beat lands on tick 1.
    expect(script[0]).toEqual({ tick: 0, mi: forward, facing: 0.25 });
    // Tick 1 runs at 100 ms and has both the 50 ms and the 83.3 ms frame.
    expect(script[1]).toEqual({ tick: 1, mi: forward, facing: 0.75 });
    // Tick 2 has nothing newer, so the intent is HELD.
    expect(script[2]).toEqual({ tick: 2, mi: forward, facing: 0.75 });
  });

  it('holds the first sample for ticks that predate it', () => {
    const script = frameCommandsToTickScript([{ tMs: 400, mi: forward, facing: 1 }], 2);
    expect(script).toEqual([
      { tick: 0, mi: forward, facing: 1 },
      { tick: 1, mi: forward, facing: 1 },
    ]);
  });
});

describe('movement latency baseline', () => {
  it('keeps the committed baseline table in step with the pinned numbers', () => {
    const rendered = renderBaselineDoc();
    if (UPDATE_TABLE) writeFileSync(BASELINE_DOC, rendered);
    expect(readFileSync(BASELINE_DOC, 'utf8')).toBe(rendered);
  });

  // The harness honesty check, over EVERY scenario rather than the easiest
  // one. With no delay in either direction the server under test receives each
  // wire frame inside the same tick the ground-truth twin applies it, so the
  // two authoritative trajectories must agree bit for bit, heading included;
  // anything else means the harness is measuring its own plumbing and every
  // latency number read off it is really a plumbing number. Exact toBe on
  // purpose: a tolerance here would hide precisely the timeline mismatch this
  // check exists to catch.
  it.each(SCENARIOS.map((scenario) => scenario.key))(
    'reproduces the zero-latency authority exactly at RTT 0 (%s)',
    (scenarioKey) => {
      const result = cell(cellKey(scenarioKey, 'rtt0'));
      const poses = result.twinPoses;
      if (!poses) throw new Error(`cell ${scenarioKey}/rtt0 has no zero-latency twin`);
      expect(result.run.ticks).toHaveLength(poses.length);
      expect(poses.length).toBeGreaterThan(50);
      for (let i = 0; i < poses.length; i++) {
        expect(result.run.ticks[i].x, `${scenarioKey} tick ${i} x`).toBe(poses[i].x);
        expect(result.run.ticks[i].z, `${scenarioKey} tick ${i} z`).toBe(poses[i].z);
        expect(result.run.ticks[i].facing, `${scenarioKey} tick ${i} facing`).toBe(poses[i].facing);
      }
    },
  );

  it('runs the speed baselines on a constant-speed lane', () => {
    // Lane sanity. Every speed number here is only meaningful while the
    // authority's horizontal step is exactly the commanded one: on a hill that
    // gated or slid, these cells would quietly become terrain measurements
    // with no assertion noticing. The y axis is terrain and is not travel.
    const poses = cell(cellKey('straight', 'rtt0')).twinPoses;
    if (!poses) throw new Error('the straight cell has no zero-latency twin');
    for (let i = STEADY_FIRST_TICK; i < STEADY_LAST_TICK; i++) {
      const step = Math.hypot(poses[i + 1].x - poses[i].x, poses[i + 1].z - poses[i].z);
      expect(step, `tick ${i} horizontal step`).toBeCloseTo(RUN_SPEED * DT, 6);
    }
  });

  it('drives the client frame pipeline in the order src/main.ts drives it', () => {
    // A source-order pin, not a behavior test: the harness (tests/helpers/
    // online_harness.ts stepFrame) hand-rolls main.ts's online arm, and the
    // ORDER is load-bearing (alpha before the echo fold, the fold before the
    // frame build, the drawn pose last). Nothing else would notice main.ts
    // resequencing those calls, and the harness would keep measuring a
    // pipeline the client no longer runs.
    const source = stripComments(readFileSync(MAIN_TS, 'utf8'));
    const movementFrameSource = stripComments(readFileSync(ONLINE_MOVEMENT_FRAME_TS, 'utf8'));
    const at = (marker: string): number => {
      const first = source.indexOf(marker);
      expect(first, `src/main.ts has no ${marker}`).toBeGreaterThanOrEqual(0);
      expect(source.indexOf(marker, first + 1), `src/main.ts has two ${marker}`).toBe(-1);
      return first;
    };
    const alpha = at('snapshotAlpha(');
    const movementFrame = at('sendOnlineMovementFrame(');
    const consumeEcho = at('net.consumeInputEchoSamples()');
    const fold = at('inputEcho.fold(');
    const drain = at('net.drainEvents()');
    const discontinuity = at('hasAuthoritativeSelfPositionDiscontinuity(');
    const frameBuild = at('selfMotionFrameBuffer.write(');
    const predictionPrepare = at('movementPrediction.prepare(');
    const predictionDisplay = at('movementPrediction.display(');
    const keyboardFacing = at('stepKeyboardTurnFacing(');
    const visualFacing = at('const onlineRenderFacing =');
    const helperAt = (marker: string): number => {
      const found = movementFrameSource.indexOf(marker);
      expect(found, `online_movement_frame.ts has no ${marker}`).toBeGreaterThanOrEqual(0);
      return found;
    };
    const setFacing = helperAt('client.setMouselookFacing(');
    const legacyFlush = helperAt('client.flushInput(');
    const sampledAdvance = helperAt('sampler.advance(');
    // updateSelfRenderPosition itself lives in the renderer (src/render/
    // self_render_position_core.ts, called from renderer.sync); main.ts's half
    // of the contract is that the drawn pose is produced AFTER the frame the
    // predictor reads was built.
    const draw = source.indexOf('renderer.sync(', frameBuild);
    const note = 'update tests/helpers/online_harness.ts stepFrame to match';
    expect(draw, `src/main.ts has no renderer.sync after the frame build: ${note}`).toBeGreaterThan(
      -1,
    );
    expect(
      source.indexOf('renderer.sync(', draw + 1),
      `src/main.ts has two renderer.sync calls after the frame build: ${note}`,
    ).toBe(-1);
    expect(alpha, `alpha must be read before the echo fold: ${note}`).toBeLessThan(consumeEcho);
    expect(movementFrame, `the wire write must precede the echo read: ${note}`).toBeLessThan(
      consumeEcho,
    );
    expect(predictionPrepare, `prediction context precedes sampling: ${note}`).toBeLessThan(
      movementFrame,
    );
    expect(keyboardFacing, `keyboard facing precedes the wire write: ${note}`).toBeLessThan(
      movementFrame,
    );
    expect(visualFacing, `visual facing precedes the wire write: ${note}`).toBeLessThan(
      movementFrame,
    );
    expect(setFacing, `facing must be stored before either wire lane: ${note}`).toBeLessThan(
      legacyFlush,
    );
    expect(legacyFlush, `the legacy lane precedes sampled v2 advance: ${note}`).toBeLessThan(
      sampledAdvance,
    );
    expect(consumeEcho, `samples are consumed then folded: ${note}`).toBeLessThan(fold);
    expect(fold, `the fold must precede the frame build: ${note}`).toBeLessThan(frameBuild);
    expect(drain, `events are drained before the discontinuity read: ${note}`).toBeLessThan(
      discontinuity,
    );
    expect(discontinuity, `the discontinuity is read before the frame build: ${note}`).toBeLessThan(
      frameBuild,
    );
    expect(discontinuity, `reconciliation follows event drain: ${note}`).toBeLessThan(
      predictionDisplay,
    );
    expect(draw, `the drawn pose follows v2 reconciliation: ${note}`).toBeGreaterThan(
      predictionDisplay,
    );
    expect(draw, `the drawn pose comes after the frame build: ${note}`).toBeGreaterThan(frameBuild);
  });

  it('pins the movement-feel target sets', () => {
    // The bar the strict arm asserts, held to literals: a target quietly
    // widened is a moved goalpost, and every cell would keep passing.
    expect(MOVEMENT_FEEL_TARGETS).toEqual({
      backwardStepYd: 0.001,
      correctionEvents: 0,
      replayEvents: 0,
      pathDeviationYd: 0.05,
      progressMaxYd: 0.15,
      speedErrYdPerSec: 0.5,
      speedDeltaYdPerSec: 1.5,
      settleYd: 0.05,
    });
    expect(MAX_SELF_REWIND_YD_PER_SEC).toBe(12);
    expect(MOVEMENT_FEEL_TARGETS_CC).toEqual({
      backwardStepYd: MAX_SELF_REWIND_YD_PER_SEC * (1 / 60) + 0.000001,
      settleYd: 0.05,
    });
  });

  it('drives the whole real pipeline in every cell', () => {
    for (const [key, result] of cells) {
      if (FACING_KEYS.includes(key)) {
        expect(result.run.frames.length, key).toBeGreaterThan(80);
        expect(result.run.ticks.length, key).toBeGreaterThan(20);
        expect(result.metrics.facingContinuity.samples, key).toBeGreaterThan(50);
        expect(result.metrics.facingCameraSplit.samples, key).toBeGreaterThan(80);
        continue;
      }
      // A cell that silently stopped predicting, stopped drawing, or stopped
      // moving would score beautifully; assert it did none of those.
      expect(result.run.frames.length, key).toBeGreaterThan(100);
      expect(result.run.ticks.length, key).toBeGreaterThan(50);
      // The correction scan drops idle frames and the ramp windows, so the
      // floor is the tapping cells' share (idle half the run, 100 ms windows),
      // not the frame count.
      expect(result.metrics.correctionEvents.samples, key).toBeGreaterThan(20);
      const first = result.run.frames[0];
      const last = result.run.frames[result.run.frames.length - 1];
      expect(Math.hypot(last.x - first.x, last.z - first.z), key).toBeGreaterThan(1);
    }
  });

  it('keeps the predictor engaged except where the gate closes it', () => {
    const straight = cell(cellKey('straight', 'rtt150j20'));
    expect(straight.run.frames.every((frame) => frame.predictionEnabled)).toBe(true);
    // The stun reaches the client mirror one downstream trip later, and the
    // gate closes on it there.
    const stunned = cell('adv-stun/rtt150j20');
    const closed = stunned.run.frames.filter((frame) => !frame.predictionEnabled);
    expect(closed.length).toBeGreaterThan(10);
    expect(closed[0].tMs).toBeGreaterThan(CC_AT_MS);

    const expectRecovered = (key: string, afterMs: number): void => {
      const recovered = cell(key).run.frames.filter((frame) => frame.tMs > afterMs);
      expect(recovered.length, key).toBeGreaterThan(10);
      expect(
        recovered.every((frame) => frame.predictorActive),
        key,
      ).toBe(true);
    };
    expectRecovered('adv-stun/rtt150j20', CC_AT_MS + 1000 + 150);
    expectRecovered('adv-snare/rtt150j20', CC_AT_MS + 1000 + 150);
    expectRecovered('adv-override-churn/rtt150j20', 1800 + 350 + 150);
  });

  it('records the downstream snapshot stall in the adv-stall frames', () => {
    const frames = cell('adv-stall/rtt150j20').run.frames;
    const snapAdvances = frames
      .map((frame) => frame.lastSnapAt)
      .filter((lastSnapAt, index, values) => index === 0 || lastSnapAt !== values[index - 1]);
    expect(snapAdvances.length).toBeGreaterThan(1);

    let maxGapMs = 0;
    for (let i = 1; i < snapAdvances.length; i++) {
      maxGapMs = Math.max(maxGapMs, snapAdvances[i] - snapAdvances[i - 1]);
    }
    expect(maxGapMs).toBeGreaterThanOrEqual(STALL_MS);
  });

  it('does not over-travel the twin when the jitter buffer starves', () => {
    const result = cell('starvation-straight/rtt300j20');
    const expected = result.twinPoses?.at(-1);
    if (!expected) throw new Error('the starvation cell has no final twin pose');
    const actual = result.run.ticks.at(-1);
    if (!actual) throw new Error('the starvation cell has no final server pose');
    const before = result.movementTimelineBefore;
    const after = result.run.movementTimeline;
    if (!before || !after) throw new Error('the starvation cell has no movement timeline');

    expect({ x: actual.x, y: actual.y, z: actual.z, facing: actual.facing }).toEqual(expected);
    expect(after.extrapolated - before.extrapolated).toBeGreaterThan(0);
    expect(after.discardedLate - before.discardedLate).toBeGreaterThan(0);
    expect(after.resyncs - before.resyncs).toBe(0);
  });

  it('sheds a slow uplink, resyncs, and returns to strict movement feel', () => {
    const { shedRun, recovery, timelineBeforeShed } = backpressureRecovery;
    const afterShed = shedRun.movementTimeline;
    const afterRecovery = recovery.run.movementTimeline;
    if (!afterShed || !afterRecovery || !recovery.movementTimelineBefore) {
      throw new Error('the backpressure cell has no movement timeline');
    }
    const finalServer = recovery.run.ticks.at(-1);
    const finalTwin = recovery.twinPoses?.at(-1);
    if (!finalServer || !finalTwin) throw new Error('the backpressure cell has no final pose');

    expect(BACKPRESSURE_EPISODE_MS).toBeLessThan(30_000);
    expect(shedRun.movementOutboxDroppedOldest).toBeGreaterThan(0);
    expect(shedRun.movementOutboxDroppedOldest).toBeGreaterThan(MOVEMENT_FRAME_V2_PENDING_CAP);
    const transmittedClientTicks = shedRun.commands.flatMap((command) =>
      command.ct === undefined ? [] : [command.ct],
    );
    const maxClientTickGap = transmittedClientTicks.reduce(
      (maxGap, clientTick, index) =>
        index === 0 ? maxGap : Math.max(maxGap, clientTick - transmittedClientTicks[index - 1]),
      0,
    );
    expect(
      transmittedClientTicks.some(
        (clientTick, index) => index > 0 && clientTick > transmittedClientTicks[index - 1] + 1,
      ),
    ).toBe(true);
    expect(afterShed.resyncs - timelineBeforeShed.resyncs).toBeGreaterThan(0);
    expect(afterRecovery.consumed - recovery.movementTimelineBefore.consumed).toBe(
      recovery.run.tickCount,
    );
    const finalPoseErrorYd = Math.hypot(finalServer.x - finalTwin.x, finalServer.z - finalTwin.z);
    const resyncWindowYd = MOVEMENT_INPUT_TIMELINE_DEPTH * RUN_SPEED * DT;
    expect(finalPoseErrorYd).toBeLessThanOrEqual(resyncWindowYd);
    expect({
      droppedOldest: shedRun.movementOutboxDroppedOldest,
      maxClientTickGap,
      resyncs: afterShed.resyncs - timelineBeforeShed.resyncs,
      recoveryConsumed: afterRecovery.consumed - recovery.movementTimelineBefore.consumed,
      finalPoseErrorMicroYd: Math.round(finalPoseErrorYd * 1_000_000),
    }).toEqual({
      droppedOldest: 15,
      maxClientTickGap: 16,
      resyncs: 1,
      recoveryConsumed: 80,
      finalPoseErrorMicroYd: 0,
    });
    if (STRICT) expectOrdinaryTargets(recovery.metrics);
  });

  it('streams a spectate anchor and returns to the own pose within one round trip', () => {
    const { run, targetPid, targetName } = spectateTransition;
    const spectatedFrames = run.frames.filter(
      (frame) => frame.spectating === targetName && frame.selfId === targetPid,
    );
    expect(spectatedFrames.length).toBeGreaterThan(10);
    expect(
      spectatedFrames.some(
        (frame) =>
          Math.hypot(frame.mirrorX - SPECTATE_TARGET.x, frame.mirrorZ - SPECTATE_TARGET.z) < 0.01,
      ),
    ).toBe(true);

    const ownFramesAfterExit = run.frames.filter(
      (frame) => frame.tMs >= SPECTATE_EXIT_AT_MS && frame.spectating === null,
    );
    expect(ownFramesAfterExit.length).toBeGreaterThan(10);
    const distanceBetweenPoses = Math.hypot(
      SPECTATE_TARGET.x - COLLIDER_FREE_LANE.x,
      SPECTATE_TARGET.z - COLLIDER_FREE_LANE.z,
    );
    const foreignPoseDistanceFloor = distanceBetweenPoses / 2;
    expect(
      ownFramesAfterExit.every(
        (frame) =>
          Math.hypot(frame.x - SPECTATE_TARGET.x, frame.z - SPECTATE_TARGET.z) >=
          foreignPoseDistanceFloor,
      ),
    ).toBe(true);

    const recovered = ownFramesAfterExit.find(
      (frame) =>
        frame.tMs <= SPECTATE_EXIT_AT_MS + 150 &&
        Math.hypot(frame.x - frame.mirrorX, frame.z - frame.mirrorZ) <= 0.01,
    );
    expect(recovered).toBeDefined();
  });

  const keys = [
    ...SCENARIOS.flatMap((scenario) =>
      PROFILES.map((profile) => cellKey(scenario.key, profile.key)),
    ),
    'adv-stall/rtt150j20',
    'adv-stun/rtt150j20',
    'adv-snare/rtt150j20',
    'adv-override-churn/rtt150j20',
    'starvation-straight/rtt300j20',
  ];

  it('measures every pinned cell and pins every measured cell', () => {
    // The vacuity floor under the it.each below. An it.each over a shortened
    // list registers FEWER cases rather than failing, so a scenario or profile
    // dropped from the tables would silently stop being measured while this
    // suite stayed green; and a BASELINE row with no matching cell (or a cell
    // with no row) would never be asserted at all.
    expect(keys).toHaveLength(25);
    expect(Object.keys(BASELINE).sort()).toEqual([...keys].sort());
    expect(FACING_KEYS).toHaveLength(6);
    expect(Object.keys(FACING_BASELINE).sort()).toEqual([...FACING_KEYS].sort());
    expect(cells.size).toBe(keys.length + FACING_KEYS.length);
  });

  it.each(keys)('pins the measured baseline for %s', (key) => {
    expectPinned(key, BASELINE[key]);
    if (STRICT) expectTargets(key);
  });

  it.each(FACING_KEYS)('keeps facing continuous and aligned for %s', (key) => {
    const metrics = cell(key).metrics;
    const note = `${key}: ${JSON.stringify({
      continuity: metrics.facingContinuity,
      cameraSplit: metrics.facingCameraSplit,
      settle: metrics.facingSettleError,
    })}`;
    expect(facingRowOf(metrics), note).toEqual(FACING_BASELINE[key]);
    expect(metrics.facingContinuity.reversals, note).toBe(0);
    expect(metrics.facingContinuity.maxPostReleaseYawRate, key).toBeLessThanOrEqual(TURN_SPEED);
    expect(metrics.facingCameraSplit.maxRad, key).toBeLessThanOrEqual(FACING_ERROR_BOUND);
    expect(metrics.facingSettleError.terminalRad, key).toBeLessThanOrEqual(FACING_ERROR_BOUND);
  });

  it.each(FACING_PROFILES.map((profile) => profile.key))(
    'puts one facing-less turn engage edge on the sampled wire at %s',
    (profileKey) => {
      const commands = cell(cellKey('turn-idle', profileKey)).run.commands.filter(
        (command) => command.ct !== undefined && (command.mi.turnLeft || command.mi.turnRight),
      );
      expect(commands, profileKey).toHaveLength(1);
      expect(commands[0]?.sampledFacing, profileKey).toBeNull();
      const following = cell(cellKey('turn-idle', profileKey)).run.commands.find(
        (command) => command.ct === (commands[0]?.ct ?? -2) + 1,
      );
      expect(following?.mi.turnLeft, profileKey).toBe(false);
      expect(following?.sampledFacing, profileKey).toBeTypeOf('number');
    },
  );

  it.each(FACING_PROFILES.map((profile) => profile.key))(
    'carries the non-tick mouselook release latch onto the sampled wire at %s',
    (profileKey) => {
      const commands = cell(cellKey('mouselook-release', profileKey)).run.commands.filter(
        (command) => command.sampledFacing !== undefined && command.sampledFacing !== null,
      );
      expect(commands.at(-1)?.sampledFacing, profileKey).toBeCloseTo(0.8, 9);
    },
  );
});
