import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { visualKeyFor } from '../src/render/characters/manifest';
import { CONSTRAINED_PREWARM_KEEP } from '../src/render/prewarm_policy';
import {
  buildWorldQuestTraceStandIn,
  worldQuestTraceMaterials,
} from '../src/render/world_quest_trace_materials';
import { WorldQuestTraceVisual } from '../src/render/world_quest_trace_visual';
import type { WorldQuestDef, WorldQuestProgress, WorldQuestTraceState } from '../src/sim/types';

function setup(compileGate?: (root: THREE.Object3D) => Promise<unknown>) {
  const scene = new THREE.Scene();
  const ground = vi.fn((x: number, z: number) => x * 0.02 + z * 0.03);
  const points = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 5, z: 8 },
    { x: 0, z: 0 },
  ];
  const defs = {
    q: {
      objective: {
        type: 'tracing',
        instructorNpcId: 'scribe',
        shapes: [{ kind: 'triangle', points }],
      },
    },
  } as unknown as Record<string, WorldQuestDef>;
  const visual = new WorldQuestTraceVisual(scene, ground, compileGate, defs);
  const tracing: WorldQuestTraceState = {
    questId: 'q',
    shapeIndex: 0,
    phase: 'preview',
    previewUntil: 6,
    expiresAt: 100,
    trail: [],
    lastPosition: { x: 0, z: 0 },
    segment: 0,
    direction: 0,
    started: false,
  };
  const world = {
    time: 0,
    worldQuestLog: new Map([
      ['q', { count: 0, completed: false, tracing } as unknown as WorldQuestProgress],
    ]),
  };
  const mesh = (part: string) =>
    visual.group.getObjectByName(`calligraphy-${part}`) as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
  return { scene, ground, visual, tracing, world, mesh, defs };
}

describe('world quest tracing visual', () => {
  it('repaints triangle, square and star while clearing previous round trails and guides', () => {
    const { visual, world, tracing, mesh, defs } = setup();
    const objective = defs.q.objective;
    if (objective.type !== 'tracing') throw new Error('expected tracing fixture');
    objective.shapes = [
      {
        kind: 'triangle',
        points: [
          { x: 0, z: 0 },
          { x: 10, z: 0 },
          { x: 5, z: 8 },
          { x: 0, z: 0 },
        ],
      },
      {
        kind: 'square',
        points: [
          { x: 0, z: 0 },
          { x: 8, z: 0 },
          { x: 8, z: 8 },
          { x: 0, z: 8 },
          { x: 0, z: 0 },
        ],
      },
      {
        kind: 'star',
        points: [
          { x: 0, z: 0 },
          { x: 6, z: 10 },
          { x: -4, z: 4 },
          { x: 10, z: 4 },
          { x: 0, z: 10 },
          { x: 0, z: 0 },
        ],
      },
    ];
    const outline = mesh('outline').geometry;
    const array = outline.getAttribute('position').array;
    for (const shapeIndex of [0, 1, 2]) {
      tracing.shapeIndex = shapeIndex;
      tracing.phase = 'preview';
      tracing.trail = [];
      tracing.segment = 0;
      tracing.direction = 0;
      tracing.started = false;
      tracing.lastPosition = { x: 0, z: 0 };
      visual.update(world);
      expect(mesh('outline').visible).toBe(true);
      expect(mesh('outline').geometry).toBe(outline);
      expect(outline.getAttribute('position').array).toBe(array);
      expect(mesh('trail').geometry.drawRange.count).toBe(0);
      expect(mesh('sparkles').geometry.drawRange.count).toBe(0);
      expect(mesh('next-corner').geometry.drawRange.count).toBe(0);
      expect(mesh('trail').visible).toBe(false);
      expect(mesh('sparkles').visible).toBe(false);
      const count = outline.drawRange.count;
      const xs = Array.from({ length: count }, (_, i) => array[i * 3]);
      if (shapeIndex === 1) expect(Math.max(...xs)).toBeCloseTo(8.23);
      if (shapeIndex === 2) expect(Math.min(...xs)).toBeLessThan(-4);
      tracing.phase = 'drawing';
      tracing.started = true;
      tracing.direction = 1;
      tracing.trail = [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
      ];
      visual.update(world);
      // Guide stars and the corner marker teach the first figure only; later
      // figures are drawn from memory, so both stay hidden while the trail paints.
      expect(mesh('sparkles').visible).toBe(shapeIndex === 0);
      expect(mesh('next-corner').visible).toBe(shapeIndex === 0);
      expect(mesh('trail').material).toBe(worldQuestTraceMaterials().blue);
      if (shapeIndex === 0) {
        const corner = mesh('next-corner').geometry.getAttribute('position').array;
        expect(corner[0]).toBeCloseTo(objective.shapes[shapeIndex].points[1].x);
        expect(corner[2]).toBeCloseTo(objective.shapes[shapeIndex].points[1].z);
      }
    }
    tracing.phase = 'success';
    visual.update(world);
    expect(mesh('outline').material).toBe(worldQuestTraceMaterials().green);
    visual.dispose();
  });
  it('invalidates equal-tail caches on a round change even when shapes reuse the same point array', () => {
    const { visual, world, tracing, mesh, defs } = setup();
    const objective = defs.q.objective;
    if (objective.type !== 'tracing') throw new Error('expected tracing fixture');
    objective.shapes = [objective.shapes[0], objective.shapes[0]];
    tracing.phase = 'drawing';
    tracing.started = true;
    tracing.trail = [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
    ];
    visual.update(world);
    const position = mesh('trail').geometry.getAttribute('position') as THREE.BufferAttribute;
    const version = position.version;
    tracing.shapeIndex = 1;
    tracing.trail = [
      { x: 0, z: 1 },
      { x: 2, z: 0 },
    ];
    visual.update(world);
    expect(position.version).toBeGreaterThan(version);
    expect(position.array[2]).not.toBe(0.17);
    visual.dispose();
  });
  it('keeps guide geometry bounded and unchanged at rest, then follows reverse and retry', () => {
    const { visual, world, tracing, mesh, ground } = setup();
    tracing.phase = 'drawing';
    tracing.lastPosition = { x: -3, z: 0 };
    visual.update(world);
    expect(mesh('sparkles').visible).toBe(true);
    expect(mesh('next-corner').visible).toBe(true);
    expect(mesh('sparkles').material).toBe(worldQuestTraceMaterials().gold);
    expect(mesh('next-corner').material).toBe(worldQuestTraceMaterials().gold);
    const starGeometry = mesh('sparkles').geometry;
    const starArray = starGeometry.getAttribute('position').array;
    const cornerGeometry = mesh('next-corner').geometry;
    const cornerArray = cornerGeometry.getAttribute('position').array;
    expect(Object.keys(starGeometry.attributes)).toEqual(['position']);
    ground.mockClear();
    visual.update(world);
    expect(ground).not.toHaveBeenCalled();
    tracing.started = true;
    tracing.direction = -1;
    tracing.lastPosition = { x: 1, z: 1.6 };
    visual.update(world);
    const cornerXs = Array.from({ length: 24 }, (_, i) => cornerArray[i * 3]);
    expect(Math.min(...cornerXs)).toBeCloseTo(4.25);
    expect(Math.max(...cornerXs)).toBeCloseTo(5.75);
    expect(mesh('sparkles').geometry).toBe(starGeometry);
    expect(starGeometry.getAttribute('position').array).toBe(starArray);
    expect(mesh('next-corner').geometry).toBe(cornerGeometry);
    expect(cornerGeometry.getAttribute('position').array).toBe(cornerArray);
    for (const phase of ['failed', 'success', 'preview'] as const) {
      tracing.phase = phase;
      visual.update(world);
      expect(mesh('sparkles').visible).toBe(false);
      expect(mesh('next-corner').visible).toBe(false);
    }
    tracing.phase = 'drawing';
    tracing.started = false;
    tracing.direction = 0;
    tracing.segment = 0;
    visual.update(world);
    expect(mesh('next-corner').visible).toBe(true);
    const retryXs = Array.from({ length: 24 }, (_, i) => cornerArray[i * 3]);
    expect(Math.min(...retryXs)).toBeCloseTo(-0.75);
    expect(Math.max(...retryXs)).toBeCloseTo(0.75);
    world.worldQuestLog.clear();
    visual.update(world);
    expect(mesh('sparkles').visible).toBe(false);
    expect(mesh('next-corner').visible).toBe(false);
    visual.dispose();
  });
  it('holds entry past a six-second compile delay, then starts a fully visible preview', async () => {
    vi.useFakeTimers();
    try {
      let resolve!: () => void;
      const { visual, world, mesh } = setup(
        () =>
          new Promise<void>((r) => {
            resolve = r;
          }),
      );
      let entryReady = false;
      void visual.readyForEntry.then(() => {
        entryReady = true;
      });
      // No interaction can start until the mandatory entry barrier resolves.
      await vi.advanceTimersByTimeAsync(7000);
      expect(entryReady).toBe(false);
      expect(visual.group.visible).toBe(false);
      resolve();
      await visual.readyForEntry;
      expect(entryReady).toBe(true);
      visual.update(world);
      expect(visual.group.visible).toBe(true);
      expect(mesh('outline').visible).toBe(true);
      visual.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it('awaits drawing readiness in the deadline-exempt, constrained entry barrier', () => {
    expect(CONSTRAINED_PREWARM_KEEP).toContain('views.landmarks');
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const helper = renderer.slice(
      renderer.indexOf('private async createMandatoryLandmarkViews('),
      renderer.indexOf('private createPersistentPortalViews('),
    );
    expect(helper).toContain(
      'const compileWaits: Promise<void>[] = [this.worldGuidance.readyForEntry];',
    );
    expect(helper).toContain('await Promise.all(compileWaits);');
    const manifest = renderer.slice(
      renderer.indexOf("id: 'views.landmarks'"),
      renderer.indexOf("id: 'views.persistent-portals'"),
    );
    expect(manifest).toContain('deadlineExempt: true');
    expect(manifest).toContain('required: true');
    expect(manifest).toContain('await this.createMandatoryLandmarkViews(');
  });
  it('reuses the robed instructor and village apprentice rigs without new assets', () => {
    expect(visualKeyFor({ kind: 'npc', templateId: 'calligraphy_instructor' } as never)).toBe(
      'npc_villager_robed',
    );
    for (const templateId of ['calligraphy_apprentice_1', 'calligraphy_apprentice_2']) {
      expect(visualKeyFor({ kind: 'npc', templateId } as never)).toBe('npc_villager');
    }
  });
  it('draws personal gold preview, then only start ring and actual blue walked trail', () => {
    const { visual, world, tracing, mesh } = setup();
    visual.update(world);
    expect(mesh('outline').visible).toBe(true);
    expect(mesh('start').visible).toBe(true);
    expect(mesh('trail').visible).toBe(false);
    world.time = 6;
    tracing.phase = 'drawing';
    tracing.trail = [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
    ];
    visual.update(world);
    expect(mesh('outline').visible).toBe(false);
    expect(mesh('trail').visible).toBe(true);
    expect(mesh('trail').material).toBe(worldQuestTraceMaterials().blue);
    expect(mesh('trail').geometry.drawRange.count).toBeGreaterThan(0);
    visual.dispose();
  });
  it('uses red failure point and trail; success restores the closed green outline until expiry', () => {
    const { visual, world, tracing, mesh } = setup();
    tracing.phase = 'failed';
    tracing.trail = [
      { x: 0, z: 0 },
      { x: 2, z: 1 },
    ];
    tracing.lastPosition = { x: 2, z: 1 };
    visual.update(world);
    expect(mesh('endpoint').visible).toBe(true);
    expect(mesh('trail').material).toBe(worldQuestTraceMaterials().red);
    tracing.phase = 'success';
    visual.update(world);
    expect(mesh('endpoint').visible).toBe(false);
    expect(mesh('outline').visible).toBe(true);
    expect(mesh('outline').material).toBe(worldQuestTraceMaterials().green);
    expect(mesh('trail').material).toBe(worldQuestTraceMaterials().gold);
    world.worldQuestLog.clear();
    visual.update(world);
    for (const part of ['outline', 'trail', 'start', 'endpoint'])
      expect(mesh(part).visible).toBe(false);
    visual.dispose();
  });
  it('keeps geometry/material identities stable and skips unchanged ground work', () => {
    const { visual, world, tracing, mesh, ground } = setup();
    tracing.phase = 'drawing';
    tracing.trail = [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
    ];
    visual.update(world);
    const geometry = mesh('trail').geometry;
    const array = geometry.getAttribute('position').array;
    ground.mockClear();
    visual.update(world);
    expect(ground).not.toHaveBeenCalled();
    tracing.trail.push({ x: 3, z: 0 });
    visual.update(world);
    expect(mesh('trail').geometry).toBe(geometry);
    expect(geometry.getAttribute('position').array).toBe(array);
    expect(ground).toHaveBeenCalled();
    visual.dispose();
  });
  it('holds root during compile, then retains per-child visibility and shares every prewarmed variant', async () => {
    let resolve!: () => void;
    const gate = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const { visual, world, mesh } = setup(gate);
    visual.update(world);
    expect(gate).toHaveBeenCalledWith(visual.group);
    expect(visual.group.visible).toBe(false);
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(visual.group.visible).toBe(true);
    expect(mesh('trail').visible).toBe(false);
    const warm = buildWorldQuestTraceStandIn();
    const materials = new Set(warm.children.map((child) => (child as THREE.Mesh).material));
    expect(materials).toEqual(new Set(Object.values(worldQuestTraceMaterials())));
    for (const child of warm.children)
      expect(Object.keys((child as THREE.Mesh).geometry.attributes)).toEqual(['position']);
    visual.dispose();
  });
  it('disposes owned buffers exactly once, does not release shared materials and cancels pending reveal', async () => {
    let resolve!: () => void;
    const { visual, scene, world } = setup(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const meshes: THREE.Mesh[] = [];
    visual.group.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });
    const spies = meshes.map((child) => vi.spyOn(child.geometry, 'dispose'));
    const materialSpy = vi.spyOn(worldQuestTraceMaterials().gold, 'dispose');
    visual.dispose();
    visual.dispose();
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    visual.update(world);
    expect(scene.children).toHaveLength(0);
    expect(visual.group.children).toHaveLength(0);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(materialSpy).not.toHaveBeenCalled();
    materialSpy.mockRestore();
  });
  it('hides on missing self state and cannot inspect tiers, reduced motion or independent timers', () => {
    const { visual, world, mesh } = setup();
    visual.update(world);
    world.worldQuestLog.clear();
    visual.update(world);
    for (const part of ['outline', 'trail', 'start', 'endpoint'])
      expect(mesh(part).visible).toBe(false);
    for (const file of [
      'world_quest_trace_visual.ts',
      'world_quest_trace_core.ts',
      'world_quest_trace_materials.ts',
    ]) {
      const source = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(
        /\b(?:GFX|gfxTierAtLeast|setTimeout|setInterval|requestAnimationFrame|Date\.now|performance\.now)\b/,
      );
    }
    visual.dispose();
  });
});
