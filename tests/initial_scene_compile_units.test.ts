import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CompileGateResult } from '../src/render/compile_gate';
import {
  buildInitialSceneCompileUnits,
  type InitialSceneCompileTail,
} from '../src/render/initial_scene_compile_units';
import type { MaterialPropertiesLike } from '../src/render/linked_program_touch';
import { pieceProgramSettle } from '../src/render/program_variant_settle';

function mesh(material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BufferGeometry(), material);
}

/** `WebGLRenderer.properties` reduced to what the settle reads: one linked
 *  program variant per material, and it never reports ready. The
 *  driver-that-stopped-answering case the tail's own deadline exists for. */
function neverReadyProperties(): MaterialPropertiesLike {
  const program = {
    isReady: () => false,
    getUniforms: () => undefined,
    getAttributes: () => undefined,
  };
  return { get: () => ({ programs: new Map([['variant', program]]) }) };
}

/** A touch arm carrying the tail's real signature, so the gate result each
 *  call receives can be asserted. */
function touchSpy(onTouch: (root: THREE.Object3D) => void = () => undefined) {
  return vi.fn(
    async (root: THREE.Object3D, _priority: number, _gate: CompileGateResult): Promise<number> => {
      onTouch(root);
      return 0;
    },
  );
}

async function run(units: ReturnType<typeof buildInitialSceneCompileUnits>): Promise<void> {
  for (const unit of units) await unit.run();
}

describe('buildInitialSceneCompileUnits', () => {
  it('collects only visible non-catalog roots for the scene group', async () => {
    const scene = new THREE.Scene();
    const visible = mesh(new THREE.MeshBasicMaterial());
    const hidden = mesh(new THREE.MeshStandardMaterial());
    hidden.visible = false;
    const catalog = new THREE.Group();
    const staged = mesh(new THREE.MeshLambertMaterial());
    catalog.add(staged);
    scene.add(visible, hidden, catalog);
    const compiled: THREE.Object3D[] = [];
    const onCompiledRoot = vi.fn();
    const units = buildInitialSceneCompileUnits({
      scene,
      stagedGroups: [['catalog', catalog]],
      includeGroup: (id) => id === 'scene',
      playerX: 0,
      playerZ: 0,
      batchSize: 1,
      sharedDedupe: { seen: new Set(), seenKeys: new Set() },
      compileColor: async (root) => compiled.push(root),
      compileShadow: async () => undefined,
      onCompiledRoot,
    });

    await run(units);
    expect(compiled).toEqual([visible]);
    expect(onCompiledRoot).toHaveBeenCalledOnce();
  });

  it('traverses a selected hidden staged catalog explicitly', async () => {
    const scene = new THREE.Scene();
    const catalog = new THREE.Group();
    catalog.visible = false;
    const staged = mesh(new THREE.MeshStandardMaterial());
    staged.visible = false;
    catalog.add(staged);
    scene.add(catalog);
    const compiled: THREE.Object3D[] = [];
    const units = buildInitialSceneCompileUnits({
      scene,
      stagedGroups: [['catalog', catalog]],
      includeGroup: (id) => id === 'catalog',
      playerX: 0,
      playerZ: 0,
      batchSize: 1,
      sharedDedupe: { seen: new Set(), seenKeys: new Set() },
      compileColor: async (root) => compiled.push(root),
      compileShadow: async () => undefined,
      onCompiledRoot: () => undefined,
    });

    await run(units);
    expect(compiled).toEqual([staged]);
  });

  it('runs the settle arm and the touch arm once per unit, after its colour and shadow compiles', async () => {
    const scene = new THREE.Scene();
    const first = mesh(new THREE.MeshBasicMaterial());
    const second = mesh(new THREE.MeshStandardMaterial());
    scene.add(first, second);
    const order: string[] = [];
    const settle = vi.fn(async (root: THREE.Object3D) => {
      order.push(`settle:${root.uuid}`);
    });
    const touch = touchSpy((root) => order.push(`touch:${root.uuid}`));
    const units = buildInitialSceneCompileUnits({
      scene,
      stagedGroups: [],
      includeGroup: () => true,
      playerX: 0,
      playerZ: 0,
      // One root per unit, so "once per unit" and "once per root" are the same
      // claim and the ordering below is unambiguous.
      batchSize: 1,
      sharedDedupe: { seen: new Set(), seenKeys: new Set() },
      compileColor: async (root) => order.push(`color:${root.uuid}`),
      compileShadow: async (root) => order.push(`shadow:${root.uuid}`),
      onCompiledRoot: () => undefined,
      tail: { settle, touch, timeoutMs: 1000 },
    });

    expect(units).toHaveLength(2);
    await run(units);
    expect(settle).toHaveBeenCalledTimes(2);
    expect(touch).toHaveBeenCalledTimes(2);
    expect(order).toEqual([
      `color:${first.uuid}`,
      `shadow:${first.uuid}`,
      `settle:${first.uuid}`,
      `touch:${first.uuid}`,
      `color:${second.uuid}`,
      `shadow:${second.uuid}`,
      `settle:${second.uuid}`,
      `touch:${second.uuid}`,
    ]);
    // A settle that proved every variant hands the touch a clean gate, so the
    // walk warms them instead of recording them unproven.
    expect(touch.mock.calls[0][2]).toEqual({ failed: false, timedOut: false });
  });

  it('ends a unit whose link never settles on the tail deadline, never later', async () => {
    vi.useFakeTimers();
    try {
      const scene = new THREE.Scene();
      const root = mesh(new THREE.MeshBasicMaterial());
      scene.add(root);
      const touch = touchSpy();
      const timeoutMs = 60;
      const tail: InitialSceneCompileTail = {
        // The REAL settle, against a program the driver never reports ready:
        // what ends its poll must be the deadline this lane arms, nothing else.
        settle: pieceProgramSettle(neverReadyProperties(), new Map()),
        touch,
        timeoutMs,
      };
      const units = buildInitialSceneCompileUnits({
        scene,
        stagedGroups: [],
        includeGroup: () => true,
        playerX: 0,
        playerZ: 0,
        batchSize: 1,
        sharedDedupe: { seen: new Set(), seenKeys: new Set() },
        compileColor: async () => undefined,
        compileShadow: async () => undefined,
        onCompiledRoot: () => undefined,
        tail,
      });

      let settled = false;
      const running = Promise.resolve(units[0].run()).then(() => {
        settled = true;
      });
      // Still polling: the unit is held by its settle, exactly as a gate piece
      // would be, and the lane's own deadline rule bounds only what is
      // SUBMITTED, never an in-flight unit.
      await vi.advanceTimersByTimeAsync(timeoutMs - 10);
      expect(settled).toBe(false);
      expect(touch).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(timeoutMs);
      await running;
      expect(settled).toBe(true);
      expect(touch).toHaveBeenCalledTimes(1);
      // Unsettled, so the touch skips what no poll proved and keys its
      // evidence event as the unsettled case.
      expect(touch.mock.calls[0][2]).toEqual({ failed: false, timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a unit compiled when its tail throws', async () => {
    const scene = new THREE.Scene();
    scene.add(mesh(new THREE.MeshBasicMaterial()));
    const onCompiledRoot = vi.fn();
    const units = buildInitialSceneCompileUnits({
      scene,
      stagedGroups: [],
      includeGroup: () => true,
      playerX: 0,
      playerZ: 0,
      batchSize: 1,
      sharedDedupe: { seen: new Set(), seenKeys: new Set() },
      compileColor: async () => undefined,
      compileShadow: async () => undefined,
      onCompiledRoot,
      tail: {
        settle: async () => {
          throw new Error('context lost');
        },
        touch: async (): Promise<number> => 0,
        timeoutMs: 1000,
      },
    });

    // The colour and shadow arms already landed: a warm-up that throws must not
    // report the unit failed, or its lifecycle record reads as unpaid debt.
    await expect(units[0].run()).resolves.toBeUndefined();
    expect(onCompiledRoot).toHaveBeenCalledOnce();
  });
});
