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
import { markProgramReady } from '../src/render/linked_program_readiness';
import type { LinkedProgramLike } from '../src/render/linked_program_touch';

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

function harness(meshes: THREE.Mesh[]) {
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
  const materialOf = (mesh: THREE.Mesh) => mesh.material as THREE.Material;
  return { scene, host, webgl, readiness, programs, materialOf };
}

describe('the scene cast-VFX gate over three', () => {
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
