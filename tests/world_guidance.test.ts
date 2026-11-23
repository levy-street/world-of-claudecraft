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
  cannonLowGfx: [] as unknown[],
  gfx: null as { standardMaterials: boolean } | null,
}));
vi.mock('../src/render/gfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/gfx')>();
  const GFX = { ...actual.GFX };
  calls.gfx = GFX;
  return { ...actual, GFX };
});
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
    constructor(_scene: unknown, _ground: unknown, _gate: unknown, lowGfx?: boolean) {
      calls.cannonLowGfx.push(lowGfx);
    }
    update() {
      calls.events.push('cannon');
    }
    dispose() {}
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
        'wisp-maze',
      ]);
    },
  );
  it.each([true, false])('hands the cannon encounter the Low look when lowGfx=%s', (lowGfx) => {
    calls.cannonLowGfx.length = 0;
    new WorldGuidance(new THREE.Scene(), () => 0, undefined, undefined, undefined, lowGfx);
    expect(calls.cannonLowGfx).toEqual([lowGfx]);
  });
  it.each([true, false])(
    'reads Low from the graphics profile by default (standardMaterials=%s)',
    (standardMaterials) => {
      const gfx = calls.gfx as { standardMaterials: boolean };
      const was = gfx.standardMaterials;
      gfx.standardMaterials = standardMaterials;
      calls.cannonLowGfx.length = 0;
      new WorldGuidance(new THREE.Scene(), () => 0);
      gfx.standardMaterials = was;
      expect(calls.cannonLowGfx).toEqual([!standardMaterials]);
    },
  );
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
