// The host half of the cast-VFX gate (src/render/cast_vfx_prewarm.ts): what it
// reads off three to answer "is this material's program linked". three assigns
// `currentProgram` when the program cache hands the program over, which is
// BEFORE the link resolves under KHR_parallel_shader_compile, so the presence
// of a program is NOT the answer, and a driver query from a live frame is
// forbidden (linked_program_readiness.ts). The answer is the settle record:
// each cast unit marks its root's programs once its compile settled, and the
// gate reads the record.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { castVfxProgramUnits, createSceneCastVfxReadiness } from '../src/render/cast_vfx_prewarm';
import type { CompileArmHost } from '../src/render/compile_arms';
import { isProgramKnownReady, markProgramReady } from '../src/render/linked_program_readiness';
import type { LinkedProgramLike } from '../src/render/linked_program_touch';
import { createVariantPrewarmSlot } from '../src/render/variant_prewarm_slot';

/** A pooled VFX mesh: `renderCategory` is the tag abilityVfxCompileMaterials
 *  selects on, so this is what the gate's scene walk collects. */
function vfxMesh(name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  mesh.name = name;
  mesh.userData.renderCategory = 'vfx';
  return mesh;
}

/** A program handle as the record keys it: identity is all that matters. */
function program(): LinkedProgramLike {
  return { getUniforms: () => ({}), getAttributes: () => ({}) } as unknown as LinkedProgramLike;
}

type CastDrawable = THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;

function harness(meshes: CastDrawable[]) {
  const scene = new THREE.Scene();
  for (const mesh of meshes) scene.add(mesh);
  const programs = new Map<THREE.Material, LinkedProgramLike | null | undefined>();
  const webgl = {
    properties: {
      get: (material: THREE.Material) => ({ currentProgram: programs.get(material) }),
    },
  };
  // Never reached: every unit here injects its own compile.
  const host = {} as CompileArmHost;
  const readiness = createSceneCastVfxReadiness(
    scene,
    webgl,
    // Staged with nothing of its own: the lazy stand-in group is not what is
    // under test here.
    () => [],
    () => 0,
  );
  const materialOf = (mesh: CastDrawable) => mesh.material as THREE.Material;
  return { scene, host, webgl, readiness, programs, materialOf };
}

describe('the scene cast-VFX gate over three', () => {
  it('proves all three point-cloud programs only as their compile units settle', async () => {
    const points = Array.from({ length: 3 }, (_, index) => {
      const object = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
      object.name = `cloud-${index}`;
      object.userData.renderCategory = 'vfx';
      return object;
    });
    const h = harness(points);
    const handles = points.map((object) => {
      const handle = program();
      h.programs.set(h.materialOf(object), handle);
      return handle;
    });
    const settles: Array<() => void> = [];
    const units = castVfxProgramUnits(
      h.scene,
      null,
      h.host,
      h.webgl,
      () => new Promise<void>((resolve) => settles.push(resolve)),
    );
    expect(units).toHaveLength(3);
    const running = units.map((unit) => unit.run());
    expect(h.readiness.snapshot()).toMatchObject({ ready: false, pending: 3, forced: false });
    for (let i = 0; i < units.length; i++) {
      settles[i]();
      await running[i];
      expect(isProgramKnownReady(handles[i])).toBe(true);
      expect(h.readiness.snapshot()).toMatchObject({
        ready: i === 2,
        pending: 2 - i,
        forced: false,
      });
    }
  });

  it.each(['Points', 'Line', 'Sprite'] as const)(
    'does not prove a %s program when compilation rejects',
    async (kind) => {
      const object =
        kind === 'Points'
          ? new THREE.Points()
          : kind === 'Line'
            ? new THREE.Line()
            : new THREE.Sprite();
      object.userData.renderCategory = 'vfx';
      const h = harness([object]);
      const handle = program();
      h.programs.set(h.materialOf(object), handle);
      const [unit] = castVfxProgramUnits(h.scene, null, h.host, h.webgl, () =>
        Promise.reject(new Error('not linked')),
      );
      await expect(unit.run()).rejects.toThrow('not linked');
      expect(isProgramKnownReady(handle)).toBe(false);
      expect(h.readiness.snapshot()).toMatchObject({ ready: false, pending: 1, forced: false });
    },
  );

  it('is not ready while a material has no program at all', () => {
    const { readiness } = harness([vfxMesh('ring')]);
    expect(readiness.ready()).toBe(false);
    expect(readiness.snapshot().pending).toBe(1);
  });

  it('is not ready on a program the record has not proved, whatever three holds', () => {
    // The old predicate opened here: `currentProgram` exists the moment the
    // program cache hands it over, links still in flight.
    const mesh = vfxMesh('ring');
    const { readiness, programs, materialOf } = harness([mesh]);
    const handle = program();
    programs.set(materialOf(mesh), handle);
    expect(readiness.ready()).toBe(false);
    expect(readiness.snapshot().pending).toBe(1);
    markProgramReady(handle);
    expect(readiness.ready()).toBe(true);
    expect(readiness.snapshot()).toMatchObject({ ready: true, pending: 0, forced: false });
  });

  it('opens once the unit that compiled the program settled, and not before', async () => {
    const mesh = vfxMesh('ring');
    const { scene, host, webgl, readiness, programs, materialOf } = harness([mesh]);
    programs.set(materialOf(mesh), program());
    let settle: () => void = () => {};
    const compile = () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      });
    const [unit] = castVfxProgramUnits(scene, null, host, webgl, compile);
    const run = unit.run();
    expect(readiness.ready()).toBe(false);
    settle();
    await run;
    expect(readiness.ready()).toBe(true);
  });

  it('records nothing for a compile that failed: an unseen link is not a proof', async () => {
    const mesh = vfxMesh('ring');
    const { scene, host, webgl, readiness, programs, materialOf } = harness([mesh]);
    programs.set(materialOf(mesh), program());
    const [unit] = castVfxProgramUnits(scene, null, host, webgl, () =>
      Promise.reject(new Error('lost')),
    );
    await expect(unit.run()).rejects.toThrow('lost');
    expect(readiness.ready()).toBe(false);
  });

  it('answers with the PROGRAM the record proved, not with the material', () => {
    // The record answers per program while the gate asks per material, so a
    // boolean would be an answer about a program that can already be gone.
    const ready = vfxMesh('ring');
    const pending = vfxMesh('decal');
    const h = harness([ready, pending]);
    const proved = program();
    markProgramReady(proved);
    h.programs.set(h.materialOf(ready), proved);
    h.programs.set(h.materialOf(pending), program());
    for (let i = 0; i < 5; i++) expect(h.readiness.ready()).toBe(false);
    expect(h.readiness.snapshot().pending).toBe(1);
  });

  it('re-closes on a program the record has not proved, however the earlier one answered', () => {
    // three repoints `currentProgram` on a key change or a clone. A gate
    // latched on the MATERIAL would keep answering for the program that is
    // gone and let a cast draw on one still in flight.
    const ring = vfxMesh('ring');
    const decal = vfxMesh('decal');
    const h = harness([ring, decal]);
    const a = program();
    markProgramReady(a);
    h.programs.set(h.materialOf(ring), a);
    const decalProgram = program();
    h.programs.set(h.materialOf(decal), decalProgram);
    // Ring answered on A; the gate is still shut on the other material.
    expect(h.readiness.ready()).toBe(false);
    expect(h.readiness.snapshot().pending).toBe(1);

    // Ring is handed B, which no settle has proved: pending again.
    const b = program();
    h.programs.set(h.materialOf(ring), b);
    expect(h.readiness.ready()).toBe(false);
    expect(h.readiness.snapshot().pending).toBe(2);

    // B proved, and the gate opens once both answer.
    markProgramReady(b);
    expect(h.readiness.ready()).toBe(false);
    markProgramReady(decalProgram);
    expect(h.readiness.ready()).toBe(true);
  });
});

describe('the units the resume lane runs', () => {
  it('collects an unstaged slot and proves its eventual root only after the link settles', async () => {
    const h = harness([]);
    const mesh = vfxMesh('lazy-stand-in');
    const handle = program();
    h.programs.set(h.materialOf(mesh), handle);
    const slot = createVariantPrewarmSlot(
      { scene: h.scene, compileColorPrograms: async () => {} },
      'ability-materials',
      () => new THREE.Group().add(mesh),
    );
    let settle = () => {};
    const compiled: THREE.Object3D[] = [];
    const units = castVfxProgramUnits(
      h.scene,
      () => slot.group,
      h.host,
      h.webgl,
      (root) => {
        compiled.push(root);
        return new Promise<void>((resolve) => {
          settle = resolve;
        });
      },
    );
    const gate = createSceneCastVfxReadiness(
      h.scene,
      h.webgl,
      () => (slot.group ? [h.materialOf(mesh)] : null),
      () => 0,
    );
    expect(units).toHaveLength(1);
    expect(units[0].roots).toEqual([]);
    expect(gate.snapshot()).toMatchObject({ ready: false, pending: null, forced: false });
    await slot.resumeUnits()[0].run();
    expect(slot.group?.visible).toBe(false);
    expect(units[0].roots).toEqual([slot.group]);
    const run = units[0].run();
    expect(compiled).toEqual([slot.group]);
    expect(gate.ready()).toBe(false);
    expect(isProgramKnownReady(handle)).toBe(false);
    settle();
    await run;
    expect(gate.snapshot()).toMatchObject({ ready: true, pending: 0, forced: false });
  });

  it('rejects a missing deferred stand-in stage without compiling or marking anything', async () => {
    const h = harness([]);
    let compiled = false;
    const [unit] = castVfxProgramUnits(
      h.scene,
      () => null,
      h.host,
      h.webgl,
      async () => {
        compiled = true;
      },
    );
    await expect(unit.run()).rejects.toThrow('ability-materials:compile has no staged root');
    expect(compiled).toBe(false);
  });

  it('does not prove a deferred stand-in whose compile rejects', async () => {
    const h = harness([]);
    const mesh = vfxMesh('failed-stand-in');
    const handle = program();
    h.programs.set(h.materialOf(mesh), handle);
    let root: THREE.Object3D | null = null;
    const [unit] = castVfxProgramUnits(
      h.scene,
      () => root,
      h.host,
      h.webgl,
      async () => {
        throw new Error('compile failed');
      },
    );
    root = new THREE.Group().add(mesh);
    await expect(unit.run()).rejects.toThrow('compile failed');
    expect(isProgramKnownReady(handle)).toBe(false);
  });

  it('still proves an already-staged stand-in passed directly', async () => {
    const h = harness([]);
    const mesh = vfxMesh('present-stand-in');
    const handle = program();
    h.programs.set(h.materialOf(mesh), handle);
    const root = new THREE.Group().add(mesh);
    const compiled: THREE.Object3D[] = [];
    const [unit] = castVfxProgramUnits(h.scene, root, h.host, h.webgl, async (target) => {
      compiled.push(target);
    });
    expect(unit.roots).toEqual([root]);
    await unit.run();
    expect(compiled).toEqual([root]);
    expect(isProgramKnownReady(handle)).toBe(true);
  });

  it('links through the colour arm by default, and marks the program on the settle', async () => {
    // The shipped arm, with no compile injected: the unit must reach
    // linkColorPrograms, which submits the root under each colour target the
    // tier covers and restores the ambient target, and the settle is what
    // writes the record the gate opens on.
    const mesh = vfxMesh('ring');
    const { scene, webgl, readiness, programs, materialOf } = harness([mesh]);
    const handle = program();
    programs.set(materialOf(mesh), handle);

    const compiled: Array<{ root: THREE.Object3D; target: THREE.WebGLRenderTarget | null }> = [];
    let current: THREE.WebGLRenderTarget | null = null;
    const offscreenTarget = {} as THREE.WebGLRenderTarget;
    let settle: (value: THREE.Object3D) => void = () => {};
    const armed = new Promise<THREE.Object3D>((resolve) => {
      settle = resolve;
    });
    const camera = new THREE.PerspectiveCamera();
    const host: CompileArmHost = {
      webgl: () => ({
        getRenderTarget: () => current,
        setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
          current = target;
        },
        compileAsync: (root: THREE.Object3D) => {
          compiled.push({ root, target: current });
          return armed;
        },
      }),
      camera: () => camera,
      scene: () => scene,
      shadowCamera: () => camera,
      // A direct tier: the canvas variant is its gameplay variant, and the
      // unit asks for no offscreen one.
      offscreen: () => false,
      offscreenTarget: () => offscreenTarget,
      depthMaterials: () => new Map(),
      shadowArm: () => false,
    };

    const [unit] = castVfxProgramUnits(scene, null, host, webgl);
    const run = unit.run();
    await Promise.resolve();
    // Submitted with the unit's own root, under the canvas target.
    expect(compiled).toEqual([{ root: mesh, target: null }]);
    expect(unit.roots).toEqual([mesh]);
    // Nothing is proved until that compile settles.
    expect(readiness.ready()).toBe(false);

    settle(scene);
    await run;
    // The ambient target is back, and the settle wrote the record.
    expect(current).toBeNull();
    expect(readiness.ready()).toBe(true);
  });
});
