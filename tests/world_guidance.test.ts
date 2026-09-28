import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { IWorld } from '../src/world_api';

const calls = vi.hoisted(() => ({
  events: [] as string[],
  fizz: vi.fn(),
  dispose: vi.fn(),
  traceGate: vi.fn(),
  ready: Promise.resolve(),
  wispReady: Promise.resolve(),
  turretGate: vi.fn(),
  turretUpdate: vi.fn(),
  turretDispose: vi.fn(),
}));
vi.mock('../src/render/race_line', () => ({
  RaceLine: class {
    update() {
      calls.events.push('race');
    }
  },
}));
vi.mock('../src/render/mount_beacon', () => ({
  MountBeacon: class {
    update(active: boolean) {
      calls.events.push(`mount:${active}`);
    }
  },
}));
vi.mock('../src/render/island_guidance', () => ({
  IslandGuidance: class {
    update() {
      calls.events.push('island');
    }
    npcFizz = calls.fizz;
  },
}));
vi.mock('../src/render/world_quest_trace_visual', () => ({
  WorldQuestTraceVisual: class {
    readyForEntry = calls.ready;
    constructor(
      scene: THREE.Object3D,
      _ground: unknown,
      gate?: (root: THREE.Object3D) => Promise<unknown>,
    ) {
      if (gate) calls.traceGate(gate(scene));
    }
    update() {
      calls.events.push('trace');
    }
    dispose = calls.dispose;
  },
}));

import { WorldGuidance } from '../src/render/world_guidance';

vi.mock('../src/render/cannon_encounter_visual', () => ({
  CannonEncounterVisual: class {
    readyForEntry = calls.ready;
    update() {
      calls.events.push('cannon');
    }
    dispose() {}
  },
}));
vi.mock('../src/render/turret_defense_visual', () => ({
  TurretDefenseVisual: class {
    // Never settles: the turret builds lazily at the seat, so entry must not wait on it.
    readyForEntry = new Promise(() => {});
    constructor(
      scene: THREE.Object3D,
      _ground: unknown,
      gate?: (root: THREE.Object3D) => Promise<unknown>,
    ) {
      if (gate) calls.turretGate(gate(scene));
    }
    update(...args: unknown[]) {
      calls.events.push('turret');
      calls.turretUpdate(...args);
    }
    dispose = calls.turretDispose;
  },
}));
vi.mock('../src/render/wisp_maze_visual', () => ({
  WispMazeVisual: class {
    readyForEntry = calls.wispReady;
    constructor(
      scene: THREE.Object3D,
      _ground: unknown,
      gate?: (root: THREE.Object3D) => Promise<unknown>,
    ) {
      if (gate) gate(scene);
    }
    update() {
      calls.events.push('wisp-maze');
    }
    dispose() {}
  },
}));

describe('personal world guidance coordinator', () => {
  it('does not finish entry while the private maze actors are still linking', async () => {
    let release = () => {};
    calls.wispReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    const guidance = new WorldGuidance(new THREE.Scene(), () => 0);
    let ready = false;
    const pending = guidance.readyForEntry.then(() => {
      ready = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).toBe(false);
    release();
    await pending;
    expect(ready).toBe(true);
    calls.wispReady = Promise.resolve();
    guidance.dispose();
  });
  it('marks the timed drawing gate as entry-required and exposes the readiness barrier', () => {
    const gate = vi.fn(() => Promise.resolve());
    const scene = new THREE.Scene();
    const guidance = new WorldGuidance(scene, () => 0, gate);
    expect(gate).toHaveBeenCalledWith(scene, true);
    expect(guidance.readyForEntry).toBeInstanceOf(Promise);
  });
  it.each([null, {}])(
    'preserves race/island/start ordering and riding quest admission with race=%s',
    (race) => {
      calls.events.length = 0;
      const guidance = new WorldGuidance(new THREE.Scene(), () => 0);
      const world = {
        mountRaceView: () => race,
        questState: () => 'active',
        worldQuestLog: new Map(),
        player: { dead: false },
      } as unknown as IWorld;
      guidance.update(world, 10, 0.05);
      expect(calls.events).toEqual([
        'race',
        'island',
        `mount:${!race}`,
        'trace',
        'cannon',
        'turret',
        'wisp-maze',
      ]);
    },
  );
  it('keeps the Fire and Fly turret out of the entry barrier and links it after first paint', async () => {
    const gate = vi.fn(() => Promise.resolve());
    const scene = new THREE.Scene();
    const guidance = new WorldGuidance(scene, () => 0, gate);
    expect(gate).toHaveBeenCalledWith(scene, false);
    let ready = false;
    void guidance.readyForEntry.then(() => {
      ready = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ready).toBe(true);
    const session = { defense: {} };
    const world = {
      mountRaceView: () => null,
      questState: () => 'none',
      worldQuestLog: new Map(),
      player: { dead: false },
      turretSession: session,
      turretClock: 42,
    } as unknown as IWorld;
    guidance.update(world, 10, 0.05, true);
    expect(calls.turretUpdate).toHaveBeenLastCalledWith(session, 42, 10, 0.05, true);
    calls.turretDispose.mockClear();
    guidance.dispose();
    expect(calls.turretDispose).toHaveBeenCalledTimes(1);
  });
  it('forwards NPC fizz arguments unchanged and releases the new visual', () => {
    const guidance = new WorldGuidance(new THREE.Scene(), () => 0);
    const args = [
      {} as IWorld,
      { id: 1, templateId: 'scribe' },
      { castSparkle: vi.fn() },
      4,
      0.05,
    ] as const;
    guidance.npcFizz(...args);
    expect(calls.fizz).toHaveBeenCalledWith(...args);
    guidance.dispose();
    expect(calls.dispose).toHaveBeenCalled();
  });
});
