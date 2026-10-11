// The host half of the cast-VFX gate (src/render/cast_vfx_prewarm.ts): what it
// reads off three to answer "is this material's program linked". three assigns
// `currentProgram` when the program cache hands the program over, which is
// BEFORE the link resolves under KHR_parallel_shader_compile, so the presence
// of a program is NOT the answer, and a driver query from a live frame is
// forbidden (linked_program_readiness.ts). The answer is the settle record:
// each cast unit marks its root's programs once its compile settled, and the
// gate reads the record.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  CAST_VFX_ENGINE,
  CAST_VFX_KIT,
  tagCastVfxEngine,
  tagCastVfxKit,
} from '../src/render/cast_vfx_family';
import {
  castVfxProgramUnits,
  castVfxStandInSlot,
  createSceneCastVfxReadiness,
} from '../src/render/cast_vfx_prewarm';
import type { CompileArmHost } from '../src/render/compile_arms';
import { isProgramKnownReady, markProgramReady } from '../src/render/linked_program_readiness';
import type { LinkedProgramLike } from '../src/render/linked_program_touch';
import { desktopTierProfile } from './helpers/gfx_tier';
import { stripComments } from './helpers/strip_comments';
import { threeProgramKeys } from './helpers/three_program_keys';

/** Every gated family: the answer a Warrior cast waits on. */
const GATED = CAST_VFX_ENGINE | CAST_VFX_KIT;

/** A pooled engine-family mesh: the tag abilityVfxGateMaterials selects
 *  on, so this is what the gate's scene walk collects. */
function vfxMesh(
  name: string,
  material: THREE.Material = new THREE.MeshBasicMaterial(),
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.name = name;
  tagCastVfxEngine(mesh);
  return mesh;
}

/** A pooled Warrior kit mesh: the gate's second family. */
function kitMesh(name: string, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.name = name;
  tagCastVfxKit(mesh);
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
  const readiness = createSceneCastVfxReadiness(scene, webgl, () => 0);
  const materialOf = (mesh: THREE.Mesh) => mesh.material as THREE.Material;
  return { scene, host, webgl, readiness, programs, materialOf };
}

describe('the scene cast-VFX gate over three', () => {
  it('is not ready while a material has no program at all', () => {
    const { readiness } = harness([vfxMesh('ring')]);
    expect(readiness.ready(GATED)).toBe(false);
    expect(readiness.snapshot().pending).toBe(1);
  });

  it('is not ready on a program the record has not proved, whatever three holds', () => {
    // The old predicate opened here: `currentProgram` exists the moment the
    // program cache hands it over, links still in flight.
    const mesh = vfxMesh('ring');
    const { readiness, programs, materialOf } = harness([mesh]);
    const handle = program();
    programs.set(materialOf(mesh), handle);
    expect(readiness.ready(GATED)).toBe(false);
    expect(readiness.snapshot().pending).toBe(1);
    markProgramReady(handle);
    expect(readiness.ready(GATED)).toBe(true);
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
    expect(readiness.ready(GATED)).toBe(false);
    settle();
    await run;
    expect(readiness.ready(GATED)).toBe(true);
  });

  it('opens over Points, line and Sprite pools once their units settled, never by the deadline', async () => {
    // A class pool is not only meshes (wisp points, lash lines, glow sprites):
    // a proof walk that saw meshes alone left these pending until the gate
    // was forced open.
    const { scene, host, webgl, readiness, programs } = harness([]);
    const drawables: Array<THREE.Points | THREE.LineSegments | THREE.Sprite> = [
      new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial()),
      new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial()),
      new THREE.Sprite(new THREE.SpriteMaterial()),
    ];
    for (const drawable of drawables) {
      tagCastVfxEngine(drawable);
      scene.add(drawable);
      programs.set(drawable.material as THREE.Material, program());
    }
    const units = castVfxProgramUnits(scene, null, host, webgl, () => Promise.resolve());
    expect(units).toHaveLength(3);
    expect(readiness.ready(GATED)).toBe(false);
    await Promise.all(units.map((unit) => unit.run()));
    expect(readiness.snapshot()).toMatchObject({ ready: true, pending: 0, forced: false });
  });

  it('compiles two clones on one program as one unit, and opens on that one proof', async () => {
    // A pool clones one material per slot. three hands the second clone the
    // program the first linked (same cache key, acquireProgram returns the
    // existing WebGLProgram), so the clone never needs its own link and the
    // gate must not wait for a currentProgram it will only get at first draw.
    const proto = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const clone = proto.clone();
    clone.color.setHex(0xff2040);
    const first = vfxMesh('slot-0', proto);
    const second = vfxMesh('slot-1', clone);
    const { scene, host, webgl, readiness, programs } = harness([first, second]);
    const shared = program();
    programs.set(proto, shared);
    let settle: () => void = () => {};
    const units = castVfxProgramUnits(
      scene,
      null,
      host,
      webgl,
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    expect(units.map((unit) => unit.roots)).toEqual([[first]]);
    const run = units[0].run();
    // Held while the shared program is not proved.
    expect(readiness.ready(GATED)).toBe(false);
    expect(readiness.snapshot().pending).toBe(1);
    settle();
    await run;
    expect(readiness.snapshot()).toMatchObject({ ready: true, pending: 0, forced: false });
  });

  it('keeps two programs apart: each holds the gate until its own unit settles', async () => {
    const opaque = vfxMesh('opaque');
    const transparent = vfxMesh('glow', new THREE.MeshBasicMaterial({ transparent: true }));
    const { scene, host, webgl, readiness, programs, materialOf } = harness([opaque, transparent]);
    const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
    tagCastVfxEngine(points);
    scene.add(points);
    for (const material of [materialOf(opaque), materialOf(transparent), points.material]) {
      programs.set(material as THREE.Material, program());
    }
    const units = castVfxProgramUnits(scene, null, host, webgl, () => Promise.resolve());
    expect(units.map((unit) => unit.roots?.[0])).toEqual([opaque, transparent, points]);
    await units[0].run();
    await units[2].run();
    // The transparent program is the one really unlinked: it holds the gate.
    expect(readiness.ready(GATED)).toBe(false);
    expect(readiness.snapshot().pending).toBe(1);
    await units[1].run();
    expect(readiness.snapshot()).toMatchObject({ ready: true, pending: 0, forced: false });
  });

  it('records nothing for a compile that failed: an unseen link is not a proof', async () => {
    const mesh = vfxMesh('ring');
    const { scene, host, webgl, readiness, programs, materialOf } = harness([mesh]);
    programs.set(materialOf(mesh), program());
    const [unit] = castVfxProgramUnits(scene, null, host, webgl, () =>
      Promise.reject(new Error('lost')),
    );
    await expect(unit.run()).rejects.toThrow('lost');
    expect(readiness.ready(GATED)).toBe(false);
  });

  it('links a pooled program outside the gated families and never waits on it', async () => {
    // A class pool, a lazy stand-in or a generic basic keeps its unit, but
    // the painter never draws it behind the gate, so it holds no cast.
    const ring = vfxMesh('ring');
    const { scene, host, webgl, readiness, programs, materialOf } = harness([ring]);
    const bespoke = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true }),
    );
    bespoke.userData.renderCategory = 'vfx';
    scene.add(bespoke);
    programs.set(materialOf(ring), program());
    programs.set(bespoke.material, program());
    const units = castVfxProgramUnits(scene, null, host, webgl, () => Promise.resolve());
    expect(units.map((unit) => unit.roots?.[0])).toEqual([ring, bespoke]);
    expect(readiness.snapshot().pending).toBe(1);
    await units[0].run();
    expect(readiness.snapshot()).toMatchObject({ ready: true, pending: 0, forced: false });
  });

  it('holds a cast on a kit program until its own unit settled', async () => {
    // Several kit pieces draw with no readiness check of their own, so the
    // gate is their protection (cast_vfx_family.ts).
    const ring = vfxMesh('ring');
    const { scene, host, webgl, readiness, programs, materialOf } = harness([ring]);
    const crest = kitMesh('crest', new THREE.MeshBasicMaterial({ transparent: true }));
    scene.add(crest);
    programs.set(materialOf(ring), program());
    programs.set(materialOf(crest), program());
    const units = castVfxProgramUnits(scene, null, host, webgl, () => Promise.resolve());
    expect(units.map((unit) => unit.roots?.[0])).toEqual([ring, crest]);
    await units[0].run();
    expect(readiness.snapshot()).toMatchObject({ ready: false, pending: 1 });
    await units[1].run();
    expect(readiness.snapshot()).toMatchObject({ ready: true, pending: 0, forced: false });
  });

  it('answers each family on its own: a pending kit program never holds an engine-only cast', async () => {
    const ring = vfxMesh('ring');
    const { scene, host, webgl, readiness, programs, materialOf } = harness([ring]);
    const crest = kitMesh('crest', new THREE.MeshBasicMaterial({ transparent: true }));
    scene.add(crest);
    programs.set(materialOf(ring), program());
    programs.set(materialOf(crest), program());
    const units = castVfxProgramUnits(scene, null, host, webgl, () => Promise.resolve());
    await units[0].run();
    expect(readiness.admit(CAST_VFX_ENGINE)).toBe(true);
    expect(readiness.admit(GATED)).toBe(false);
    expect(readiness.snapshot().families).toEqual([
      expect.objectContaining({ id: 'engine', ready: true, pending: 0, refused: 0 }),
      expect.objectContaining({ id: 'kit', ready: false, pending: 1, refused: 1 }),
    ]);
    await units[1].run();
    expect(readiness.admit(GATED)).toBe(true);
  });

  it('stands the kit down on a device that declined its assets: never held, never forced', () => {
    const ring = vfxMesh('ring');
    const scene = new THREE.Scene();
    const crest = kitMesh('crest', new THREE.MeshBasicMaterial({ transparent: true }));
    scene.add(ring, crest);
    const proved = program();
    markProgramReady(proved);
    const webgl = {
      properties: {
        get: (material: THREE.Material) => ({
          currentProgram: material === ring.material ? proved : null,
        }),
      },
    };
    const clock = { now: 0 };
    const readiness = createSceneCastVfxReadiness(
      scene,
      webgl,
      () => clock.now,
      1000,
      () => true,
    );
    expect(readiness.admit(GATED)).toBe(true);
    // Its pools still refuse: a declined kit draws nothing, and says nothing.
    expect(readiness.spawnAllowed(CAST_VFX_KIT)).toBe(false);
    clock.now = 5000;
    expect(readiness.admit(GATED)).toBe(true);
    expect(readiness.snapshot()).toMatchObject({ ready: true, forced: false, requirementMiss: 0 });
    expect(readiness.snapshot().families[1]).toMatchObject({ id: 'kit', declined: true });
  });

  it("reads the device's real kit decline by default", async () => {
    // A fresh module graph, so the decline stays out of the other cases.
    vi.resetModules();
    const three = await import('three');
    const family = await import('../src/render/cast_vfx_family');
    const assets = await import('../src/render/ability_vfx/production_assets');
    const { createSceneCastVfxReadiness: sceneGate } = await import(
      '../src/render/cast_vfx_prewarm'
    );
    const scene = new three.Scene();
    const crest = new three.Mesh(new three.PlaneGeometry(1, 1), new three.MeshBasicMaterial());
    family.tagCastVfxKit(crest);
    scene.add(crest);
    const readiness = sceneGate(scene, { properties: { get: () => ({ currentProgram: null }) } });
    expect(readiness.snapshot().families[1]).toMatchObject({ id: 'kit', declined: false });
    expect(await assets.ensureWarriorKitAssets(true)).toBe(false);
    expect(assets.warriorKitAssetsState()).toBe('declined');
    expect(readiness.snapshot().families[1]).toMatchObject({ id: 'kit', declined: true });
    expect(readiness.admit(CAST_VFX_KIT)).toBe(true);
  });

  it('starts no deadline clock on a diagnostics read taken before the first consult', () => {
    // The renderer's construction publishes a perfStats() receipt: a snapshot
    // that started the clock there spent the whole deadline before the world
    // was up, and the gate was forced at the reveal.
    const ring = vfxMesh('ring');
    const scene = new THREE.Scene();
    scene.add(ring);
    const webgl = { properties: { get: () => ({ currentProgram: null }) } };
    const clock = { now: 0 };
    const readiness = createSceneCastVfxReadiness(scene, webgl, () => clock.now, 1000);
    expect(readiness.snapshot()).toMatchObject({ ready: false, pending: 1, forced: false });
    clock.now = 60_000;
    expect(readiness.admit(CAST_VFX_ENGINE)).toBe(false);
    clock.now = 60_999;
    expect(readiness.admit(CAST_VFX_ENGINE)).toBe(false);
    clock.now = 61_000;
    expect(readiness.admit(CAST_VFX_ENGINE)).toBe(true);
    expect(readiness.snapshot()).toMatchObject({ forced: true });
  });

  it('links the engine family first, then the kit, then the other pools, then the stand-ins', () => {
    const bespoke = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    bespoke.userData.renderCategory = 'vfx';
    const crest = kitMesh('crest', new THREE.MeshBasicMaterial({ wireframe: true }));
    const ring = vfxMesh('ring', new THREE.MeshBasicMaterial({ transparent: true }));
    const { scene, host, webgl } = harness([]);
    scene.add(bespoke, crest, ring);
    const standIns = new THREE.Group();
    const units = castVfxProgramUnits(scene, standIns, host, webgl, () => Promise.resolve());
    expect(units.map((unit) => unit.roots?.[0])).toEqual([ring, crest, bespoke, standIns]);
  });

  it('answers with the PROGRAM the record proved, not with the material', () => {
    // The record answers per program while the gate asks per material, so a
    // boolean would be an answer about a program that can already be gone.
    const ready = vfxMesh('ring');
    const pending = vfxMesh('decal', new THREE.MeshBasicMaterial({ transparent: true }));
    const h = harness([ready, pending]);
    const proved = program();
    markProgramReady(proved);
    h.programs.set(h.materialOf(ready), proved);
    h.programs.set(h.materialOf(pending), program());
    for (let i = 0; i < 5; i++) expect(h.readiness.ready(GATED)).toBe(false);
    expect(h.readiness.snapshot().pending).toBe(1);
  });

  it('re-closes on a program the record has not proved, however the earlier one answered', () => {
    // three repoints `currentProgram` on a key change or a clone. A gate
    // latched on the MATERIAL would keep answering for the program that is
    // gone and let a cast draw on one still in flight.
    const ring = vfxMesh('ring');
    const decal = vfxMesh('decal', new THREE.MeshBasicMaterial({ transparent: true }));
    const h = harness([ring, decal]);
    const a = program();
    markProgramReady(a);
    h.programs.set(h.materialOf(ring), a);
    const decalProgram = program();
    h.programs.set(h.materialOf(decal), decalProgram);
    // Ring answered on A; the gate is still shut on the other material.
    expect(h.readiness.ready(GATED)).toBe(false);
    expect(h.readiness.snapshot().pending).toBe(1);

    // Ring is handed B, which no settle has proved: pending again.
    const b = program();
    h.programs.set(h.materialOf(ring), b);
    expect(h.readiness.ready(GATED)).toBe(false);
    expect(h.readiness.snapshot().pending).toBe(2);

    // B proved, and the gate opens once both answer.
    markProgramReady(b);
    expect(h.readiness.ready(GATED)).toBe(false);
    markProgramReady(decalProgram);
    expect(h.readiness.ready(GATED)).toBe(true);
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
    expect(readiness.ready(GATED)).toBe(false);

    settle(scene);
    await run;
    // The ambient target is back, and the settle wrote the record.
    expect(current).toBeNull();
    expect(readiness.ready(GATED)).toBe(true);
  });

  it('compiles the program variant the world pass draws, on every tier', async () => {
    // three keys tone mapping and the output colour space on the bound target
    // (none and linear into any target), so a unit compiling the canvas variant
    // under a composer's scene pass would leave every never-compiled clone to
    // link live under a ready gate.
    const renderer = stripComments(readFileSync('src/render/renderer.ts', 'utf8'));
    expect(renderer).toContain(
      'if (GFX.composer || GFX.gradePass)\n      this.post = buildComposer(',
    );
    expect(renderer).toContain('offscreen: () => !!this.post,');
    const material = new THREE.MeshBasicMaterial({ transparent: true });
    const mesh = vfxMesh('ring', material);
    const composerTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    const keyAt = (target: THREE.WebGLRenderTarget | null) =>
      threeProgramKeys(material, mesh, target);
    expect(keyAt(composerTarget), 'the two variants are two programs').not.toBe(keyAt(null));
    for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
      const { composer, gradePass } = desktopTierProfile(tier).settings;
      expect(composer || gradePass, `${tier} draws into a target`).toBe(tier !== 'low');
      const { scene, webgl } = harness([mesh]);
      const bound: Array<THREE.WebGLRenderTarget | null> = [];
      let current: THREE.WebGLRenderTarget | null = null;
      const host = {
        webgl: () => ({
          getRenderTarget: () => current,
          setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
            current = target;
          },
          compileAsync: (root: THREE.Object3D) => {
            bound.push(current);
            return Promise.resolve(root);
          },
        }),
        camera: () => new THREE.PerspectiveCamera(),
        scene: () => scene,
        shadowCamera: () => new THREE.PerspectiveCamera(),
        offscreen: () => composer || gradePass,
        offscreenTarget: () => new THREE.WebGLRenderTarget(8, 8),
        depthMaterials: () => new Map(),
        shadowArm: () => false,
      } as unknown as CompileArmHost;
      await Promise.all(castVfxProgramUnits(scene, null, host, webgl).map((unit) => unit.run()));
      const drawn = keyAt(composer || gradePass ? composerTarget : null);
      expect(bound.map(keyAt), tier).toEqual([drawn]);
    }
  });
});

describe('a vfx.ability-primitives entry the boot budget dropped', () => {
  function droppedEntry() {
    const scene = new THREE.Scene();
    scene.add(vfxMesh('ring'));
    const programs = new Map<THREE.Material, LinkedProgramLike>();
    const webgl = {
      properties: {
        get: (material: THREE.Material) => ({ currentProgram: programs.get(material) }),
      },
    };
    const settles: Array<() => void> = [];
    const submit = (root: THREE.Object3D) =>
      new Promise<void>((resolve) => {
        root.traverse((object) => {
          const material = (object as THREE.Mesh).material;
          for (const entry of Array.isArray(material) ? material : material ? [material] : []) {
            if (!programs.has(entry)) programs.set(entry, program());
          }
        });
        settles.push(resolve);
      });
    let standIns: THREE.Material[] | null = null;
    const slot = castVfxStandInSlot({ scene, compileColorPrograms: submit }, webgl, (materials) => {
      standIns = materials;
    });
    // The renderer's resumeProgramUnits, evaluated at drop time: the lazy
    // stand-ins are not staged yet, so their own slot must stage and link them.
    const units = [
      ...castVfxProgramUnits(scene, slot.group, {} as CompileArmHost, webgl, submit),
      ...slot.resumeUnits(),
    ];
    return { units, settles, standIns: () => standIns, programs };
  }

  it('holds no stand-in cast unit of its own at drop time', () => {
    const { units } = droppedEntry();
    expect(units.map((unit) => unit.id)).toEqual([
      'program:ring:0',
      'ability-materials:group',
      'ability-materials:compile',
    ]);
  });

  it('records the lazy stand-ins as linked once the slot resume link settles', async () => {
    const { units, settles, standIns, programs } = droppedEntry();
    await units[1].run();
    const run = units[2].run();
    expect(standIns()?.length ?? 0).toBeGreaterThan(0);
    for (const material of standIns() ?? []) {
      expect(programs.get(material)).toBeDefined();
      expect(isProgramKnownReady(programs.get(material)!)).toBe(false);
    }
    for (const settle of settles.splice(0)) settle();
    await run;
    for (const material of standIns() ?? []) {
      expect(isProgramKnownReady(programs.get(material)!)).toBe(true);
    }
  });
});
