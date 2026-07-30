// Registry-wide scene lifecycle coverage through the real Sim and the Node-safe
// client presentation models. Every scene is watched once, then swept across
// active ticks so authored actor and player movement cannot escape parity.

import { describe, expect, it } from 'vitest';
import { SceneDirector } from '../src/game/scene_director';
import { SCENE_RELEASE_SEC, type SceneLivePose } from '../src/game/scene_director_core';
import { SceneInputLockCoordinator } from '../src/game/scene_input_lock';
import {
  type DeckStandInRuntimeHandle,
  deckStandInAction,
  disposeDeckStandIn,
} from '../src/render/harbor_deck_stand_in_core';
import {
  playSceneForPlayer,
  registeredSceneIds,
  type SceneDef,
  sceneActiveFor,
  sceneById,
} from '../src/sim/scenes/scenes';
import { Sim } from '../src/sim/sim';
import { type SquadDirective, spawnSquad, squadActorEntity } from '../src/sim/squad/squad';
import { DT, type Entity, type QuestProgress, type SimEvent } from '../src/sim/types';
import {
  createSceneOverlayState,
  overlayApplyOp,
  sceneOverlayView,
} from '../src/ui/hud/scene/scene_overlay_view';

const TEST_DUNGEON_ID = 'lb_riftline';
const ACTIVE_QUEST_ID = 'q_fs_hold_the_riftfields';
const DONE_QUEST_ID = 'q_lb_q0_ashore';
const TEST_TIMEOUT_MS = 120_000;
const EXPECTED_SCENE_IDS = [
  'scn_lb_ferry_depart_back',
  'scn_lb_ferry_depart_out',
  'scn_lb_q0_doorway',
  'scn_lb_q0_voyage',
] as const;
// A full every-tick matrix exceeds the per-file suite budget under shared CI
// load. Five ticks is 0.25 seconds; first, last, and every authored op boundary
// are added separately by skipTickOffsets.
const SKIP_SWEEP_STRIDE_TICKS = 5;

const LIVE_CAMERA_BASELINE = {
  yaw: 0.75,
  pitch: 0.3,
  dist: 12,
} as const;

interface FakeStandInVisual {
  readonly target: string;
}

interface LifecycleSnapshot {
  readonly director: {
    readonly sceneActive: boolean;
    readonly inputLocked: boolean;
    readonly cameraActive: boolean;
    readonly cameraPose: ReturnType<SceneDirector['cameraPose']>;
  };
  readonly inputTargetLocked: boolean;
  readonly overlay: {
    readonly letterbox: boolean;
    readonly skipHintVisible: boolean;
    readonly speakerKey: string | null;
    readonly lineKey: string | null;
    readonly announcementId: number;
    readonly fadeOpacity: number;
    readonly cinematic: boolean;
  };
  readonly musicDirective: 'silence' | 'resume';
  readonly standIns: readonly {
    readonly target: string;
    readonly cueStartSec: number | null;
    readonly segment: unknown | null;
    readonly present: boolean;
  }[];
}

interface SimSceneSnapshot {
  readonly playbackCount: number;
  readonly reconnectState: ReturnType<Sim['sceneReconnectStateFor']>;
  readonly scriptedWalkCount: number;
}

interface WorldStateSnapshot {
  readonly entities: readonly {
    readonly key: string;
    readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  }[];
  readonly questLog: readonly {
    readonly questId: string;
    readonly progress: QuestProgress;
  }[];
  readonly questsDone: readonly string[];
  readonly campaignFlags: readonly (readonly [string, string])[];
}

interface SceneRun {
  readonly sim: Sim;
  readonly scene: SceneDef;
  readonly claimId: number;
  readonly actorIds: readonly string[];
  readonly client: HeadlessSceneClient;
  readonly clientBaseline: LifecycleSnapshot;
  readonly simBaseline: SimSceneSnapshot;
}

interface WatchedOutcome {
  readonly world: WorldStateSnapshot;
  readonly standInsBuilt: number;
  readonly standInsDisposed: number;
  readonly musicSilenceCalls: readonly boolean[];
}

interface EntityResetState {
  readonly id: number;
  readonly pos: Entity['pos'];
  readonly prevPos: Entity['prevPos'];
  readonly facing: number;
  readonly swingTimer: number;
  readonly wanderTimer: number;
  readonly inCombat: boolean;
}

interface RunResetState {
  readonly entities: readonly EntityResetState[];
  readonly directives: readonly (readonly [string, SquadDirective])[];
  readonly questLog: readonly (readonly [string, QuestProgress])[];
  readonly questsDone: readonly string[];
  readonly campaignFlags: readonly (readonly [string, string])[];
}

type LifecycleCheck = 'entityPositions';

interface LegacyExemption {
  readonly sceneId: string;
  readonly check: LifecycleCheck;
  readonly reason: string;
}

// P3 must clear this row by settling actorMove positions on the skip tick.
const LEGACY_EXEMPTIONS: readonly LegacyExemption[] = [
  {
    sceneId: 'scn_lb_q0_doorway',
    check: 'entityPositions',
    reason: 'P3 must settle actorMove endpoints immediately when a scene is skipped.',
  },
];

class HeadlessSceneClient {
  private nowSec = 0;
  private readonly overlay = createSceneOverlayState();
  private readonly director: SceneDirector;
  private readonly inputLock: SceneInputLockCoordinator;
  private inputTargetLocked = false;
  private musicDirective: 'silence' | 'resume' = 'resume';
  private readonly standIns = new Map<string, DeckStandInRuntimeHandle<FakeStandInVisual>>();
  private builtCount = 0;
  private disposedCount = 0;
  private readonly silenceCalls: boolean[] = [];

  constructor(
    private readonly sim: Sim,
    propTargets: readonly string[],
  ) {
    for (const target of propTargets) {
      this.standIns.set(target, {
        cueStartSec: null,
        segment: null,
        deckStandIn: null,
      });
    }
    this.director = new SceneDirector({
      world: () => this.sim,
      nowSec: () => this.nowSec,
      musicSilence: (on) => {
        this.musicDirective = on ? 'silence' : 'resume';
        this.silenceCalls.push(on);
      },
      propCue: (target, cue, startSec) => this.cueProp(target, cue, startSec),
      propReset: () => this.resetProps(),
      reducedMotion: () => false,
    });
    this.inputLock = new SceneInputLockCoordinator(
      this.director,
      {
        setSceneInputLocked: (on) => {
          this.inputTargetLocked = on;
        },
      },
      () => {},
    );
  }

  handleTick(events: readonly SimEvent[]): void {
    this.nowSec = this.sim.presentationTime;
    for (const event of events) {
      if (event.type !== 'scene' || event.pid !== this.sim.playerId) continue;
      const eventNowSec = event.presentationTime ?? this.nowSec;
      sceneOverlayView(this.overlay, eventNowSec);
      overlayApplyOp(this.overlay, event.op, eventNowSec);
    }
    this.inputLock.handleEvents([...events]);
    this.paint();
  }

  settleCameraRelease(): void {
    this.nowSec += SCENE_RELEASE_SEC + DT;
    this.paint();
  }

  snapshot(): LifecycleSnapshot {
    const cameraPose = this.director.cameraPose(this.liveCamera());
    return {
      director: {
        sceneActive: this.director.sceneActive(),
        inputLocked: this.director.inputLocked(),
        cameraActive: this.director.cameraActive(),
        cameraPose,
      },
      inputTargetLocked: this.inputTargetLocked,
      overlay: { ...sceneOverlayView(this.overlay, this.nowSec) },
      musicDirective: this.musicDirective,
      standIns: [...this.standIns.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([target, handle]) => ({
          target,
          cueStartSec: handle.cueStartSec,
          segment: handle.segment,
          present: handle.deckStandIn !== null,
        })),
    };
  }

  standInsBuilt(): number {
    return this.builtCount;
  }

  standInsDisposed(): number {
    return this.disposedCount;
  }

  musicSilenceCalls(): readonly boolean[] {
    return this.silenceCalls;
  }

  private paint(): void {
    sceneOverlayView(this.overlay, this.nowSec);
    this.director.cameraPose(this.liveCamera());
  }

  private liveCamera(): SceneLivePose {
    return {
      ...LIVE_CAMERA_BASELINE,
      playerX: this.sim.player.pos.x,
      playerY: this.sim.player.pos.y,
      playerZ: this.sim.player.pos.z,
    };
  }

  private cueProp(target: string, cue: string, startSec: number): void {
    const handle = this.standIns.get(target);
    if (!handle) throw new Error(`scene emitted an unregistered prop target: ${target}`);
    handle.cueStartSec = startSec;
    handle.segment = cue;
    const action = deckStandInAction(true, handle.deckStandIn !== null, true);
    if (action === 'build') {
      handle.deckStandIn = { target };
      this.builtCount++;
    }
  }

  private resetProps(): void {
    for (const handle of this.standIns.values()) {
      handle.cueStartSec = null;
      handle.segment = null;
      disposeDeckStandIn(handle, () => {
        this.disposedCount++;
      });
    }
  }
}

function sceneActorIds(scene: SceneDef): readonly string[] {
  const ids = new Set<string>();
  for (const op of scene.ops) {
    if (op.kind === 'actorMove' || op.kind === 'actorFace' || op.kind === 'anim') {
      ids.add(op.actorId);
    }
    if (op.kind === 'line' && op.speakerActorId !== undefined) ids.add(op.speakerActorId);
    if (op.kind === 'camera' && op.shot.kind === 'focus' && op.shot.actorId !== undefined) {
      ids.add(op.shot.actorId);
    }
    if (op.kind === 'camera' && op.shot.kind === 'dolly' && op.shot.lookAt.kind === 'subject') {
      ids.add(op.shot.lookAt.actorId);
    }
  }
  return [...ids].sort();
}

function scenePropTargets(scene: SceneDef): readonly string[] {
  return [...new Set(scene.ops.flatMap((op) => (op.kind === 'prop' ? [op.target] : [])))].sort();
}

function createSceneRun(sceneId: string): SceneRun {
  const scene = sceneById(sceneId);
  if (!scene) throw new Error(`registered scene did not resolve: ${sceneId}`);
  const sim = new Sim({
    seed: 4242,
    playerClass: 'warrior',
    playerName: 'Lifecycle',
    devCommands: true,
  });
  for (const entityId of [...sim.entities.keys()]) {
    if (entityId !== sim.playerId) sim.ctx.dropEntity(entityId);
  }
  sim.player.level = 20;
  const meta = sim.ctx.players.get(sim.playerId);
  if (!meta) throw new Error('primary player metadata missing');
  meta.questLog.set(ACTIVE_QUEST_ID, {
    questId: ACTIVE_QUEST_ID,
    counts: [0],
    state: 'active',
  });
  meta.questsDone.add(DONE_QUEST_ID);
  meta.campaignFlags.set('scene-lifecycle-sentinel', 'preserved');

  const actorIds = sceneActorIds(scene);
  let claimId = -sim.playerId;
  if (actorIds.length > 0) {
    if (!sim.enterStoryInstance(TEST_DUNGEON_ID)) {
      throw new Error(`could not enter lifecycle host instance: ${TEST_DUNGEON_ID}`);
    }
    const claim = sim.ctx.instances.find(
      (instance) => instance.dungeonId === TEST_DUNGEON_ID && instance.partyKey !== null,
    );
    if (claim?.exitId === null || claim?.exitId === undefined) {
      throw new Error('lifecycle host instance claim missing');
    }
    claimId = claim.exitId;
    const squad = spawnSquad(sim.ctx, {
      claimId,
      dungeonId: TEST_DUNGEON_ID,
      anchor: { x: sim.player.pos.x, z: sim.player.pos.z },
      actorIds,
      humanCount: 1,
    });
    if (!squad || squad.actorIds.size !== actorIds.length) {
      throw new Error(`${sceneId} lifecycle actors did not all resolve: ${actorIds.join(', ')}`);
    }
  }

  const client = new HeadlessSceneClient(sim, scenePropTargets(scene));
  const clientBaseline = client.snapshot();
  const simBaseline = simSceneSnapshot(sim);
  const started =
    actorIds.length > 0
      ? sim.playScene(claimId, sceneId)
      : playSceneForPlayer(sim.ctx, sim.playerId, sceneId);
  if (!started) {
    throw new Error(`could not start registered scene: ${sceneId}`);
  }
  return {
    sim,
    scene,
    claimId,
    actorIds,
    client,
    clientBaseline,
    simBaseline,
  };
}

function simSceneSnapshot(sim: Sim): SimSceneSnapshot {
  return {
    playbackCount: sim.ctx.scenePlaybacks.size,
    reconnectState: sim.sceneReconnectStateFor(sim.playerId),
    scriptedWalkCount: sim.ctx.scriptedPlayerWalks.size,
  };
}

function cloneQuestProgress(progress: QuestProgress): QuestProgress {
  return {
    questId: progress.questId,
    counts: [...progress.counts],
    state: progress.state,
    ...(progress.selection !== undefined ? { selection: progress.selection } : {}),
    ...(progress.resolvedCounts !== undefined
      ? { resolvedCounts: [...progress.resolvedCounts] }
      : {}),
  };
}

function worldStateSnapshot(run: SceneRun): WorldStateSnapshot {
  const entities = [
    {
      key: 'player',
      entity: run.sim.player,
    },
    ...run.actorIds.map((actorId) => ({
      key: `actor:${actorId}`,
      entity: squadActorEntity(run.sim.ctx, run.claimId, actorId),
    })),
  ].map(({ key, entity }) => {
    if (!entity) throw new Error(`${run.scene.id} lifecycle entity missing: ${key}`);
    return {
      key,
      pos: { ...entity.pos },
    };
  });
  const meta = run.sim.ctx.players.get(run.sim.playerId);
  if (!meta) throw new Error('primary player metadata missing after scene');
  return {
    entities,
    questLog: [...meta.questLog.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([questId, progress]) => ({
        questId,
        progress: cloneQuestProgress(progress),
      })),
    questsDone: [...meta.questsDone].sort(),
    campaignFlags: [...meta.campaignFlags.entries()].sort(([a], [b]) => a.localeCompare(b)),
  };
}

function activeTickCount(scene: SceneDef): number {
  return Math.ceil(scene.duration / DT);
}

function skipTickOffsets(scene: SceneDef): readonly number[] {
  const lastTick = activeTickCount(scene) - 1;
  const offsets = new Set([0, lastTick]);
  for (let tick = 0; tick <= lastTick; tick += SKIP_SWEEP_STRIDE_TICKS) offsets.add(tick);
  for (const op of scene.ops) {
    const boundary = Math.max(0, Math.min(lastTick, Math.ceil(op.at / DT)));
    offsets.add(Math.max(0, boundary - 1));
    offsets.add(boundary);
    offsets.add(Math.min(lastTick, boundary + 1));
  }
  return [...offsets].sort((a, b) => a - b);
}

function tickRun(run: SceneRun): void {
  run.client.handleTick(run.sim.tick());
}

function captureRunResetState(run: SceneRun): RunResetState {
  const entities = [
    run.sim.player,
    ...run.actorIds.map((actorId) => {
      const actor = squadActorEntity(run.sim.ctx, run.claimId, actorId);
      if (!actor) throw new Error(`${run.scene.id} lifecycle actor missing: ${actorId}`);
      return actor;
    }),
  ].map((entity) => ({
    id: entity.id,
    pos: { ...entity.pos },
    prevPos: { ...entity.prevPos },
    facing: entity.facing,
    swingTimer: entity.swingTimer,
    wanderTimer: entity.wanderTimer,
    inCombat: entity.inCombat,
  }));
  const squad = run.sim.ctx.squadRuns.get(run.claimId);
  const directives = squad
    ? [...squad.directives.entries()].map(
        ([actorId, directive]) => [actorId, { ...directive }] as const,
      )
    : [];
  const meta = run.sim.ctx.players.get(run.sim.playerId);
  if (!meta) throw new Error('primary player metadata missing before skip sweep');
  return {
    entities,
    directives,
    questLog: [...meta.questLog.entries()].map(
      ([questId, progress]) => [questId, cloneQuestProgress(progress)] as const,
    ),
    questsDone: [...meta.questsDone],
    campaignFlags: [...meta.campaignFlags.entries()],
  };
}

function restartSceneRun(
  run: SceneRun,
  reset: RunResetState,
  resetWorld: WorldStateSnapshot,
): SceneRun {
  for (const saved of reset.entities) {
    const entity = run.sim.entities.get(saved.id);
    if (!entity) throw new Error(`${run.scene.id} lifecycle reset entity missing: ${saved.id}`);
    entity.pos = { ...saved.pos };
    entity.prevPos = { ...saved.prevPos };
    entity.facing = saved.facing;
    entity.swingTimer = saved.swingTimer;
    entity.wanderTimer = saved.wanderTimer;
    entity.inCombat = saved.inCombat;
    run.sim.rebucket(entity);
  }
  const squad = run.sim.ctx.squadRuns.get(run.claimId);
  if (squad) {
    squad.directives.clear();
    for (const [actorId, directive] of reset.directives) {
      squad.directives.set(actorId, { ...directive });
    }
  }
  const meta = run.sim.ctx.players.get(run.sim.playerId);
  if (!meta) throw new Error('primary player metadata missing during skip sweep reset');
  meta.questLog.clear();
  for (const [questId, progress] of reset.questLog) {
    meta.questLog.set(questId, cloneQuestProgress(progress));
  }
  meta.questsDone.clear();
  for (const questId of reset.questsDone) meta.questsDone.add(questId);
  meta.campaignFlags.clear();
  for (const [flag, value] of reset.campaignFlags) meta.campaignFlags.set(flag, value);
  expect(worldStateSnapshot(run), `${run.scene.id}: reused world reset`).toEqual(resetWorld);
  const client = new HeadlessSceneClient(run.sim, scenePropTargets(run.scene));
  const restarted: SceneRun = {
    ...run,
    client,
    clientBaseline: client.snapshot(),
    simBaseline: simSceneSnapshot(run.sim),
  };
  const started =
    restarted.actorIds.length > 0
      ? restarted.sim.playScene(restarted.claimId, restarted.scene.id)
      : playSceneForPlayer(restarted.sim.ctx, restarted.sim.playerId, restarted.scene.id);
  if (!started) throw new Error(`could not restart registered scene: ${restarted.scene.id}`);
  return restarted;
}

function assertRestored(run: SceneRun, context: string): void {
  run.client.settleCameraRelease();
  expect(run.client.snapshot(), `${context}: client lifecycle baseline`).toEqual(
    run.clientBaseline,
  );
  expect(simSceneSnapshot(run.sim), `${context}: sim scene baseline`).toEqual(run.simBaseline);
}

function watchScene(sceneId: string): WatchedOutcome {
  const run = createSceneRun(sceneId);
  const maxTicks = activeTickCount(run.scene) + 2;
  for (let tick = 0; tick < maxTicks && sceneActiveFor(run.sim.ctx, run.claimId); tick++) {
    tickRun(run);
  }
  assertRestored(run, `${sceneId} watched`);
  return {
    world: worldStateSnapshot(run),
    standInsBuilt: run.client.standInsBuilt(),
    standInsDisposed: run.client.standInsDisposed(),
    musicSilenceCalls: [...run.client.musicSilenceCalls()],
  };
}

const SCENE_IDS = registeredSceneIds();
const WATCHED_OUTCOMES = new Map<string, WatchedOutcome>();

function watchedOutcome(sceneId: string): WatchedOutcome {
  const cached = WATCHED_OUTCOMES.get(sceneId);
  if (cached) return cached;
  const watched = watchScene(sceneId);
  WATCHED_OUTCOMES.set(sceneId, watched);
  return watched;
}

function worldProgressionSnapshot(world: WorldStateSnapshot) {
  return {
    questLog: world.questLog,
    questsDone: world.questsDone,
    campaignFlags: world.campaignFlags,
  };
}

describe('registered scene lifecycle smoke', () => {
  it('pins the complete production registry', () => {
    expect(SCENE_IDS).toEqual(EXPECTED_SCENE_IDS);
  });

  for (const sceneId of SCENE_IDS) {
    it(`${sceneId} restores the captured sim and client baselines`, {
      timeout: TEST_TIMEOUT_MS,
    }, () => {
      const scene = sceneById(sceneId);
      if (!scene) throw new Error(`registered scene did not resolve: ${sceneId}`);
      const watched = watchedOutcome(sceneId);
      expect(watched.musicSilenceCalls.at(-1), `${sceneId}: music resumed on end`).toBe(false);
      if (scenePropTargets(scene).length > 0) {
        expect(watched.standInsBuilt, `${sceneId}: stand-in exercised`).toBeGreaterThan(0);
        expect(watched.standInsDisposed, `${sceneId}: every stand-in disposed`).toBe(
          watched.standInsBuilt,
        );
      }
    });
  }
});

describe('registered scene skip parity sweep', () => {
  for (const exemption of LEGACY_EXEMPTIONS) {
    it.skip(`${exemption.sceneId} ${exemption.check}: ${exemption.reason}`, () => {});
  }

  it('pins the exact P3 lifecycle exemption inventory', () => {
    expect(LEGACY_EXEMPTIONS).toEqual([
      {
        sceneId: 'scn_lb_q0_doorway',
        check: 'entityPositions',
        reason: 'P3 must settle actorMove endpoints immediately when a scene is skipped.',
      },
    ]);
    for (const exemption of LEGACY_EXEMPTIONS) {
      expect(SCENE_IDS, `${exemption.sceneId}: exemption scene must remain registered`).toContain(
        exemption.sceneId,
      );
    }
  });

  for (const sceneId of SCENE_IDS) {
    it(`${sceneId} restores lifecycle state and matches the watched world across the skip sweep`, {
      timeout: TEST_TIMEOUT_MS,
    }, () => {
      const watched = watchedOutcome(sceneId);
      const scene = sceneById(sceneId);
      if (!scene) throw new Error(`registered scene did not resolve: ${sceneId}`);
      const positionExemption = LEGACY_EXEMPTIONS.find(
        (row) => row.sceneId === sceneId && row.check === 'entityPositions',
      );
      const mismatchedPositionTicks: number[] = [];
      let run = createSceneRun(sceneId);
      const reset = captureRunResetState(run);
      const resetWorld = worldStateSnapshot(run);
      const offsets = skipTickOffsets(scene);
      for (let index = 0; index < offsets.length; index++) {
        const skipTick = offsets[index];
        for (let tick = 0; tick < skipTick; tick++) tickRun(run);
        expect(
          sceneActiveFor(run.sim.ctx, run.claimId),
          `${sceneId} tick ${skipTick}: scene must still be active before skip`,
        ).toBe(true);
        expect(run.sim.requestSceneSkip(), `${sceneId} tick ${skipTick}: skip accepted`).toBe(true);
        tickRun(run);
        assertRestored(run, `${sceneId} skip tick ${skipTick}`);
        expect(
          run.client.musicSilenceCalls().at(-1),
          `${sceneId} tick ${skipTick}: music resumed on end`,
        ).toBe(false);
        const skippedWorld = worldStateSnapshot(run);
        expect(
          worldProgressionSnapshot(skippedWorld),
          `${sceneId} tick ${skipTick}: watched-identical quest and flag state`,
        ).toEqual(worldProgressionSnapshot(watched.world));
        const skippedPositions = skippedWorld.entities;
        if (positionExemption) {
          if (JSON.stringify(skippedPositions) !== JSON.stringify(watched.world.entities)) {
            mismatchedPositionTicks.push(skipTick);
          }
        } else {
          expect(
            skippedPositions,
            `${sceneId} tick ${skipTick}: watched-identical entity positions`,
          ).toEqual(watched.world.entities);
        }
        if (index + 1 < offsets.length) run = restartSceneRun(run, reset, resetWorld);
      }
      if (positionExemption) {
        expect(
          mismatchedPositionTicks.length,
          `${sceneId}: P3 actorMove exemption must not become stale`,
        ).toBeGreaterThan(0);
      }
    });
  }
});
