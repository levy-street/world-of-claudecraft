import { describe, expect, it, vi } from 'vitest';
import { SceneDirector } from '../src/game/scene_director';
import {
  applySceneOp,
  createSceneDirectorState,
  type SceneLivePose,
  scenePose,
} from '../src/game/scene_director_core';
import { ClientWorld } from '../src/net/online';
import { composeHarborShipAttachFrame } from '../src/render/harbor_ship_attach_core';
import {
  type HarborShipCueHandle,
  HarborShipCueRegistry,
} from '../src/render/harbor_ship_cue_registry';
import {
  type PropPathSample,
  type PropPathSegment,
  propPathPoseAt,
} from '../src/render/prop_path_core';
import {
  LAST_BELL_PROP_PATH_SEGMENTS,
  LAST_BELL_VOYAGE_SEGMENT_IDS,
} from '../src/sim/content/last_bell_cinematics';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { MAINLAND_HARBOR } from '../src/sim/harbor_layout';
import { Sim } from '../src/sim/sim';
import { DT, type SceneWireOp, type SimEvent } from '../src/sim/types';
import { WATER_LEVEL } from '../src/sim/world';
import type { IWorld } from '../src/world_api';

class StubWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;

  constructor(public readonly url: string) {}

  send(): void {
    // No transport in the clock mirror test.
  }

  close(): void {
    // No transport in the clock mirror test.
  }
}

function clientWorld(): ClientWorld {
  const globals = globalThis as Record<string, unknown>;
  const previousWebSocket = globals.WebSocket;
  const previousWindow = globals.window;
  globals.WebSocket = StubWebSocket as unknown;
  globals.window = { setInterval: () => 0, clearInterval: () => undefined };
  try {
    const world = new ClientWorld('clock-test-token', 1, 'warrior', 'http://localhost');
    world.close();
    return world;
  } finally {
    globals.WebSocket = previousWebSocket;
    globals.window = previousWindow;
  }
}

interface TestHandle extends HarborShipCueHandle<PropPathSegment> {
  id: string;
}

const LIVE: SceneLivePose = {
  yaw: 0,
  pitch: 0.25,
  dist: 10,
  playerX: 0,
  playerY: 0,
  playerZ: 0,
};

const CAMERA_OP: SceneWireOp = {
  kind: 'camera',
  shot: {
    kind: 'focus',
    entityId: null,
    x: 8,
    y: 0,
    z: 0,
    dist: 10,
    pitch: 0.25,
    yaw: 0,
    dur: 8,
  },
};

const PROP_SEGMENT: PropPathSegment = {
  start: { x: 0, y: 0, z: 0, yaw: 0 },
  end: { x: 8, y: 0, z: 0, yaw: 0 },
  duration: 8,
  ease: 'easeInOutSine',
};

describe('mirrored scene presentation clock', () => {
  it('exposes Sim time directly and mirrors authoritative snapshot jumps online', () => {
    const sim = new Sim({ seed: 17, playerClass: 'warrior' });
    expect(sim.presentationTime).toBe(sim.time);
    sim.tick();
    expect(sim.presentationTime).toBeCloseTo(DT, 10);

    const client = clientWorld();
    const applySnapshot = (
      client as unknown as { applySnapshot(snapshot: Record<string, unknown>): void }
    ).applySnapshot.bind(client);
    applySnapshot({ t: 'snap', tick: 25, time: 1.25, tw: 2, ents: [], keep: [] });
    expect(client.presentationTime).toBe(1.25);
    applySnapshot({ t: 'snap', tick: 125, time: 6.25, tw: 2, ents: [], keep: [] });
    expect(client.presentationTime).toBe(6.25);

    applySnapshot({ t: 'snap', tick: 126, time: Number.NaN, tw: 2, ents: [], keep: [] });
    applySnapshot({ t: 'snap', tick: 127, time: -1, tw: 2, ents: [], keep: [] });
    applySnapshot({ t: 'snap', tick: 128, tw: 2, ents: [], keep: [] });
    expect(client.presentationTime).toBe(6.25);
  });

  it('advances the online mirror before queued convergence and scene events can drain', () => {
    const client = clientWorld();
    const onMessage = (client as unknown as { onMessage(raw: string): void }).onMessage.bind(
      client,
    );

    client.presentationTime = 2;
    onMessage(
      JSON.stringify({
        t: 'hello',
        pid: 1,
        seed: 17,
        time: 20,
        sceneState: null,
        sceneChoiceState: {
          choiceId: 'choice_clock',
          leaderPid: 1,
          promptKey: 'lb.q0.coalfast.look',
          options: [{ id: 'go', key: 'lb.q0.coalfast.look' }],
          defaultOptionId: 'go',
          windowSeconds: 5,
          remainingSeconds: 5,
        },
      }),
    );
    expect(client.presentationTime).toBe(20);
    const convergence = client.drainEvents();
    expect(convergence.map((event) => event.type)).toEqual(['sceneSync', 'sceneChoiceSync']);
    expect(convergence.map((event) => event.presentationTime)).toEqual([20, 20]);

    onMessage(
      JSON.stringify({
        t: 'events',
        time: 23.5,
        list: [
          {
            type: 'scene',
            sceneId: 'sc_clock_wire',
            pid: 1,
            op: { kind: 'music', directive: 'silence' },
          },
          {
            type: 'sceneChoice',
            choiceId: 'choice_wire_clock',
            pid: 1,
            promptKey: 'lb.q0.coalfast.look',
            options: [{ id: 'go', key: 'lb.q0.coalfast.look' }],
            windowSeconds: 8,
            defaultOptionId: 'go',
            leaderPid: 1,
          },
        ],
      }),
    );
    expect(client.presentationTime).toBe(23.5);
    onMessage(JSON.stringify({ t: 'events', time: 26.5, list: [] }));
    expect(client.drainEvents()).toMatchObject([
      { type: 'scene', presentationTime: 23.5 },
      { type: 'sceneChoice', presentationTime: 23.5 },
    ]);

    onMessage(JSON.stringify({ t: 'events', time: -1, list: [] }));
    expect(client.presentationTime).toBe(26.5);
  });

  it('keeps director ops and eased camera and prop poses aligned across a frame stall', () => {
    let clock = 0;
    const world = {
      get presentationTime() {
        return clock;
      },
      playerId: 7,
      entities: new Map(),
      sceneSkip: vi.fn(),
    } as unknown as IWorld;
    const handle: TestHandle = {
      id: 'mainland',
      cueStartSec: null,
      segment: null,
    };
    const registry = new HarborShipCueRegistry<PropPathSegment, TestHandle>({
      nowSec: () => world.presentationTime,
      segmentForCue: (cue) => (cue === 'voyage' ? PROP_SEGMENT : undefined),
      activate: (target, segment, startSec) => {
        target.segment = segment;
        target.cueStartSec = startSec;
      },
      reset: (target) => {
        target.segment = null;
        target.cueStartSec = null;
      },
    });
    registry.register('harbor_ship_mainland', handle);
    const sideEffects: string[] = [];
    const director = new SceneDirector({
      world: () => world,
      nowSec: () => world.presentationTime,
      musicSilence: (on) => sideEffects.push(`music:${on ? 'on' : 'off'}`),
      propCue: (target, cue, startSec) => {
        sideEffects.push(`prop:${target}:${cue}`);
        registry.cue(target, cue, startSec);
      },
      reducedMotion: () => false,
    });
    const events: SimEvent[] = [
      {
        type: 'scene',
        sceneId: 'sc_clock_stall',
        pid: 7,
        presentationTime: 0,
        op: { kind: 'start', duration: 12 },
      },
      {
        type: 'scene',
        sceneId: 'sc_clock_stall',
        pid: 7,
        presentationTime: 0,
        op: CAMERA_OP,
      },
      {
        type: 'scene',
        sceneId: 'sc_clock_stall',
        pid: 7,
        presentationTime: 0,
        op: { kind: 'music', directive: 'silence' },
      },
      {
        type: 'scene',
        sceneId: 'sc_clock_stall',
        pid: 7,
        presentationTime: 0,
        op: { kind: 'prop', target: 'harbor_ship_mainland', cue: 'voyage' },
      },
    ];
    // The client receives every op, then the mirrored world clock advances
    // without a presentation frame while the main thread is stalled.
    clock = 3.25;
    director.handleEvents(events);
    expect(sideEffects).toEqual(['music:on', 'prop:harbor_ship_mainland:voyage']);
    expect(handle.cueStartSec).toBe(0);

    const expectedDirector = createSceneDirectorState();
    applySceneOp(expectedDirector, { kind: 'start', duration: 12 }, 0);
    applySceneOp(expectedDirector, CAMERA_OP, 0);

    const cameraPose = director.cameraPose(LIVE);
    const pureCameraPose = scenePose(expectedDirector, clock, LIVE, () => null);
    expect(cameraPose).not.toBeNull();
    expect(pureCameraPose).not.toBeNull();
    if (cameraPose === null || pureCameraPose === null) {
      throw new Error('scene camera ended before the stalled clock sample');
    }
    const camera = { ...cameraPose };
    const expectedCamera = { ...pureCameraPose };
    const elapsed = registry.elapsedSec(handle);
    expect(elapsed).toBe(clock);
    if (handle.segment === null || elapsed === null) {
      throw new Error('harbor cue ended before the stalled clock sample');
    }
    const prop = propPathPoseAt(handle.segment, elapsed);
    const expectedProp: PropPathSample = propPathPoseAt(PROP_SEGMENT, clock);

    expect(camera).toEqual(expectedCamera);
    expect(prop).toEqual(expectedProp);
    expect(camera.focusX).toBeCloseTo(prop.x, 10);
  });

  it('hands the injected world clock through the live harbor cue evaluator', async () => {
    vi.doMock('../src/render/props', () => ({
      propAsset: () => ({ parts: [], size: { x: 60, y: 1, z: 1 } }),
    }));
    const { buildHarbors, cueHarborShip, harborShipAttachFrame, resetHarborShipCues } =
      await import('../src/render/harbor');
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      props: {
        ...BUILTIN_WORLD.props,
        harbors: [
          {
            ...MAINLAND_HARBOR,
            decks: [],
            rails: [],
            ramps: [],
            dressing: [],
          },
        ],
      },
    });

    let clock = 10;
    try {
      buildHarbors(17, { nowSec: () => clock });
      cueHarborShip('harbor_ship_mainland', LAST_BELL_VOYAGE_SEGMENT_IDS.out.castOff, clock);

      clock = 13.25;
      const actual = harborShipAttachFrame('harbor_ship_mainland');
      expect(actual).not.toBeNull();
      const prop = propPathPoseAt(
        LAST_BELL_PROP_PATH_SEGMENTS[LAST_BELL_VOYAGE_SEGMENT_IDS.out.castOff],
        3.25,
      );
      const expected = composeHarborShipAttachFrame(
        {
          baseX: MAINLAND_HARBOR.berth.x,
          baseY: WATER_LEVEL - MAINLAND_HARBOR.berth.draft,
          baseZ: MAINLAND_HARBOR.berth.z,
          baseRot: MAINLAND_HARBOR.berth.rot,
        },
        prop,
        { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
      );
      expect(actual).toEqual(expected);

      const midpoint = harborShipAttachFrame('harbor_ship_mainland', undefined, 14);
      const midpointProp = propPathPoseAt(
        LAST_BELL_PROP_PATH_SEGMENTS[LAST_BELL_VOYAGE_SEGMENT_IDS.out.castOff],
        4,
      );
      expect(midpoint).toEqual(
        composeHarborShipAttachFrame(
          {
            baseX: MAINLAND_HARBOR.berth.x,
            baseY: WATER_LEVEL - MAINLAND_HARBOR.berth.draft,
            baseZ: MAINLAND_HARBOR.berth.z,
            baseRot: MAINLAND_HARBOR.berth.rot,
          },
          midpointProp,
          { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
        ),
      );
    } finally {
      resetHarborShipCues();
      setActiveWorldContent(null);
      vi.doUnmock('../src/render/props');
    }
  });
});
