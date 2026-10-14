// Every record a WebGL context restore must reset or re-bake, proved against
// its REAL owner: each id in CONTEXT_RESTORE_RESET_IDS and
// CONTEXT_RESTORE_REBAKE_IDS (src/render/context_restore_registry.ts) has one
// fixture here that builds the owner in its "done on the old context" state,
// runs the registry the way the restore host does, and asserts the record no
// longer answers for the lost context. The fixture table is typed over the id
// lists and its keys are compared with them, so a new id cannot land without
// its proof.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({
  loadTexture: vi.fn(async () => ({ image: null })),
  loadGltf: vi.fn(() => new Promise(() => {})),
  releaseTexture: vi.fn(),
  releaseGltf: vi.fn(),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn(),
}));

import {
  activeKitPrewarmEntry,
  cancelActiveAbilityKit,
  ensureActiveAbilityKit,
} from '../src/render/ability_vfx/active_kit_prewarm';
import * as contact from '../src/render/ability_vfx/contact_assets';
import { CrestPrewarm } from '../src/render/ability_vfx/crest_prewarm';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { GuardPrewarm } from '../src/render/ability_vfx/guard_prewarm';
import { OverlaySprites } from '../src/render/ability_vfx/overlay_sprites';
import * as assets from '../src/render/ability_vfx/production_assets';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { SpiritApparitions } from '../src/render/ability_vfx/spirits';
import { createBackgroundGpuQueue } from '../src/render/background_gpu_queue';
import { CAST_VFX_ENGINE, tagCastVfxEngine } from '../src/render/cast_vfx_family';
import { castVfxRestoreUnits, createSceneCastVfxReadiness } from '../src/render/cast_vfx_prewarm';
import { FormAdornments } from '../src/render/characters/form_adornments';
import {
  noteSpiritVeilTupleLinked,
  spiritVeilLedgerSize,
} from '../src/render/characters/ghost_veil';
import { CharacterVisual, type FarBakeGate } from '../src/render/characters/visual';
import { disposeRendererContextGeneration } from '../src/render/context_generation';
import { ContextRestoreHost, type ContextRestoreSurface } from '../src/render/context_restore';
import {
  CONTEXT_RESTORE_REBAKE_IDS,
  CONTEXT_RESTORE_RESET_IDS,
  type ContextRestoreRebakeId,
  type ContextRestoreResetId,
  contextRestoreRebakeUnits,
  contextRestoreResetCounts,
  registerContextRestoreReset,
  resetContextRestoreRegistriesForTest,
  runContextRestoreResets,
} from '../src/render/context_restore_registry';
import { bakeGrassGroundTexture, setGrassGroundBake } from '../src/render/grass_ground_bake';
import { markProgramReady } from '../src/render/linked_program_readiness';
import { liveMaterialProperties } from '../src/render/linked_program_touch';
import {
  installOccluderFadeGate,
  occluderFadeEscalatedCount,
  occluderFadeTwinReady,
  uninstallOccluderFadeGate,
} from '../src/render/occluder_fade_gate';
import { PostShed } from '../src/render/post_shed';
import { createRevealGate } from '../src/render/reveal_gate';
import { OpaqueSceneCapture } from '../src/render/scene_sampling';
import { spiritVeilFamilyPrewarmEntry } from '../src/render/spirit_veil_prewarm';
import { TextureResidencyLedger } from '../src/render/texture_residency_ledger';
import { Vfx } from '../src/render/vfx';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetContextRestoreRegistriesForTest();
});

/** Run the registry the way the restore host does, after proving `id` has a
 *  live registered owner: a fixture whose owner never registered would
 *  otherwise pass on a reset it called some other way. */
function resetFor(id: ContextRestoreResetId): void {
  expect(
    contextRestoreResetCounts().get(id) ?? 0,
    `no live ${id} owner registered`,
  ).toBeGreaterThan(0);
  runContextRestoreResets();
}

const flush = async (rounds = 50): Promise<void> => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};

function poolTextures(): AbilityVfxTextures {
  return {
    ribbon: new THREE.Texture(),
    noise: new THREE.Texture(),
    overlay: new THREE.Texture(),
  } as unknown as AbilityVfxTextures;
}

/** One render pass: three calls onAfterRender for every object it submitted. */
function renderPass(scene: THREE.Scene): void {
  for (const child of scene.children) {
    if (!child.visible) continue;
    child.onAfterRender(
      null as unknown as THREE.WebGLRenderer,
      scene,
      null as unknown as THREE.Camera,
      null as unknown as THREE.BufferGeometry,
      null as unknown as THREE.Material,
      null as unknown as THREE.Group,
    );
  }
}

function linkedHost() {
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  markProgramReady(program);
  return {
    properties: { get: () => ({ programs: new Map([['flat', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
}

async function runUnits(units: readonly { run: () => unknown }[]): Promise<void> {
  for (const unit of units) await unit.run();
}

function installCanvasStub(): void {
  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
  };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
}

function hostSurface(overrides: Partial<ContextRestoreSurface>): ContextRestoreSurface {
  const webgl = {
    domElement: new EventTarget(),
    properties: { get: () => ({}) },
    shadowMap: { needsUpdate: false },
    extensions: { has: () => false, get: () => null },
    getContext: () => ({ getExtension: () => null }),
  } as unknown as THREE.WebGLRenderer;
  return {
    webgl: () => webgl,
    queue: createBackgroundGpuQueue(),
    isShutdown: () => false,
    rebindContextReaders: () => {},
    scene: () => new THREE.Scene(),
    player: () => ({ x: 0, z: 0 }),
    arms: null,
    compileColor: async () => {},
    compileShadow: async () => {},
    tail: () => ({ settle: async () => ({}), touch: async () => 0, timeoutMs: 1 }),
    textureInFlight: new WeakMap(),
    compileBatchRoots: 1,
    zoneProgramRecords: () => [],
    prewarmZone: async () => {},
    presentationPrewarm: () => false,
    castVfxUnits: () => [],
    selfSpirit: () => ({ observe: () => {} }),
    environment: () => null,
    ...overrides,
  } as ContextRestoreSurface;
}

function runRebakes(id: ContextRestoreRebakeId, owner?: object): void {
  const units = contextRestoreRebakeUnits().filter((unit) => unit.id === id);
  expect(units.length, `no live ${id} re-bake registered`).toBeGreaterThan(0);
  for (const unit of units) unit.run();
  void owner;
}

type Fixture = () => void | Promise<void>;

const RESET_FIXTURES: Record<ContextRestoreResetId, Fixture> = {
  'renderer.zone-programs': () => {
    const zones = [new Set(['proving_shore']), new Set(['crab']), new Set(['guard'])];
    const host = new ContextRestoreHost(hostSurface({ zoneProgramRecords: () => zones }));
    resetFor('renderer.zone-programs');
    expect(zones.map((set) => set.size)).toEqual([0, 0, 0]);
    host.dispose();
  },
  'self-spirit': () => {
    const observe = vi.fn();
    const host = new ContextRestoreHost(hostSurface({ selfSpirit: () => ({ observe }) }));
    resetFor('self-spirit');
    // A look no real player wears: the next real look is warmed again.
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0][1]).toBe(-1);
    host.dispose();
  },
  'texture-residency': () => {
    const texture = new THREE.Texture();
    const ledger = new TextureResidencyLedger({
      webgl: () => ({ initTexture: vi.fn() }) as unknown as THREE.WebGLRenderer,
      queue: createBackgroundGpuQueue(),
      idleSlot: async () => {},
    });
    ledger.prewarm(texture);
    expect(ledger.has(texture)).toBe(true);
    resetFor('texture-residency');
    expect(ledger.has(texture)).toBe(false);
  },
  'cast-vfx-readiness': () => {
    const scene = new THREE.Scene();
    const pool = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    tagCastVfxEngine(pool);
    scene.add(pool);
    const program = { id: 1 };
    markProgramReady(program as never);
    let records = new Map<THREE.Material, { currentProgram?: object }>([
      [pool.material as THREE.Material, { currentProgram: program }],
    ]);
    const webgl = {
      properties: { get: (material: THREE.Material) => records.get(material) ?? {} },
      info: { render: { frame: 0 } },
    };
    let frame = 0;
    webgl.info.render.frame = frame;
    const readiness = createSceneCastVfxReadiness(scene, webgl, () => 0, 1_000_000);
    expect(readiness.ready(CAST_VFX_ENGINE)).toBe(true);
    // The restore replaced three's properties: the pool has no program yet.
    records = new Map();
    webgl.info.render.frame = ++frame;
    resetFor('cast-vfx-readiness');
    expect(readiness.ready(CAST_VFX_ENGINE)).toBe(false);
    expect(readiness.admit(CAST_VFX_ENGINE)).toBe(false);
  },
  'reveal-gate': async () => {
    const gate = createRevealGate({ compile: async () => {} }, () => [{}]);
    expect(gate.allow('band:1')).toBe(false);
    await flush();
    expect(gate.state('band:1')).toBe('warm');
    resetFor('reveal-gate');
    expect(gate.state('band:1')).toBe('cold');
    expect(gate.allow('band:1')).toBe(false);
    // A compile requested on the lost context settles AFTER the restore: it
    // must not warm the key the restored context has not linked.
    let finishStale!: () => void;
    const staleGate = createRevealGate(
      {
        compile: () =>
          new Promise<void>((resolve) => {
            finishStale = resolve;
          }),
      },
      () => [{}],
    );
    expect(staleGate.allow('band:2')).toBe(false);
    staleGate.forgetContext();
    finishStale();
    await flush();
    expect(staleGate.state('band:2')).toBe('cold');
  },
  'occluder-fade-gate': async () => {
    installOccluderFadeGate({ compile: () => new Promise(() => {}) });
    try {
      const mint = () => new THREE.Object3D();
      expect(occluderFadeTwinReady('program:a', 'prefetch', mint, null)).toBe(false);
      expect(occluderFadeTwinReady('program:a', 'edge', mint, null)).toBe(false);
      expect(occluderFadeEscalatedCount()).toBe(1);
      resetFor('occluder-fade-gate');
      expect(occluderFadeEscalatedCount()).toBe(0);
    } finally {
      uninstallOccluderFadeGate();
    }
  },
  'guard-prewarm': async () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    const prep = new GuardPrewarm(new THREE.Scene(), mesh);
    const host = linkedHost();
    await runUnits(prep.units(host));
    expect(prep.ready()).toBe(true);
    resetFor('guard-prewarm');
    expect(prep.ready()).toBe(false);
    expect(prep.units(host).map((unit) => unit.id)).toEqual([
      'guard-compile',
      'guard-touch',
      'guard-upload',
    ]);
  },
  'crest-prewarm': async () => {
    const geometry = new THREE.PlaneGeometry();
    const prep = new CrestPrewarm(
      new THREE.Scene(),
      new Map([['blood_cut', geometry]]),
      new THREE.MeshBasicMaterial(),
    );
    const host = linkedHost();
    await runUnits(prep.units(host));
    expect(prep.ready('blood_cut')).toBe(true);
    resetFor('crest-prewarm');
    expect(prep.ready('blood_cut')).toBe(false);
    expect(prep.units(host).map((unit) => unit.id)).toEqual([
      'crest-compile:blood_cut',
      'touch:crest:blood_cut:0',
      'touch:crest:blood_cut:1',
      'crest-upload:blood_cut',
    ]);
  },
  'active-kit': async () => {
    const texture = new THREE.Texture();
    vi.spyOn(assets, 'warriorPressureTexture').mockReturnValue(texture);
    vi.spyOn(assets, 'warriorBloodTexture').mockReturnValue(texture);
    vi.spyOn(assets, 'warriorRockTexture').mockReturnValue(texture);
    vi.spyOn(assets, 'warriorSteelTexture').mockReturnValue(texture);
    vi.spyOn(assets, 'bakedTexture').mockReturnValue(texture);
    vi.spyOn(contact, 'contactTexture').mockReturnValue(texture);
    const scene = new THREE.Scene();
    const upload = vi.fn();
    const entry = activeKitPrewarmEntry(scene, 'warrior', {
      queue: { run: async <T>(work: () => T | Promise<T>) => work() } as never,
      geometry: () => [],
      texture: upload,
    });
    await ensureActiveAbilityKit(scene);
    const sheets = entry.progress().done;
    expect(sheets).toBeGreaterThan(0);
    expect(upload).toHaveBeenCalledTimes(sheets);
    resetFor('active-kit');
    // Forgotten at once, then the recipe runs again for the restored context.
    expect(entry.progress().done).toBe(0);
    await vi.waitFor(() => expect(entry.progress().done).toBe(sheets));
    expect(upload).toHaveBeenCalledTimes(sheets * 2);
    cancelActiveAbilityKit(scene);
  },
  'vfx-cloud': () => {
    installCanvasStub();
    const scene = new THREE.Scene();
    const vfx = new Vfx(scene, () => null);
    const cloud = vfx.cloudDrawable();
    renderPass(scene);
    expect(cloud.visible).toBe(false);
    resetFor('vfx-cloud');
    // Submitted again so its program links on the restored context.
    expect(cloud.visible).toBe(true);
  },
  'overlay-sprites': () => {
    const scene = new THREE.Scene();
    new OverlaySprites(scene, poolTextures());
    const points = scene.children.find((child) => child.userData.renderCategory === 'vfx');
    expect(points).toBeDefined();
    renderPass(scene);
    expect(points?.visible).toBe(false);
    resetFor('overlay-sprites');
    expect(points?.visible).toBe(true);
  },
  ribbons: () => {
    const scene = new THREE.Scene();
    const ribbons = new AbilityVfxRibbons(scene, () => null, poolTextures());
    const mesh = scene.children.find((child) => child.userData.renderCategory === 'vfx');
    ribbons.update(1 / 60, new THREE.Vector3());
    renderPass(scene);
    expect(mesh?.visible).toBe(false);
    resetFor('ribbons');
    expect(mesh?.visible).toBe(true);
  },
  'spirit-apparitions': () => {
    const pool = new SpiritApparitions(new THREE.Scene(), () => 0);
    const probe = pool as unknown as {
      puppets: Map<string, { compiled: boolean; inUse: boolean }>;
      compileQueue: object[];
    };
    const puppet = { compiled: true, inUse: false };
    probe.puppets.set('wolf', puppet);
    resetFor('spirit-apparitions');
    expect(puppet.compiled).toBe(false);
    expect(probe.compileQueue).toContain(puppet);
  },
  'spirit-veil-ledger': () => {
    const properties = { get: () => ({}) };
    spiritVeilFamilyPrewarmEntry(
      {} as Parameters<typeof spiritVeilFamilyPrewarmEntry>[0],
      { properties },
      createBackgroundGpuQueue(),
    );
    noteSpiritVeilTupleLinked('color:s:0', properties);
    expect(spiritVeilLedgerSize()).toBe(1);
    resetFor('spirit-veil-ledger');
    expect(spiritVeilLedgerSize()).toBe(0);
  },
  'character-visual': () => {
    // A real rig needs the character asset pipeline; the reset reads only
    // these fields, so the instance carries exactly them.
    const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
    const material = new THREE.MeshBasicMaterial();
    const gate = vi.fn();
    const probe = visual as unknown as {
      disposed: boolean;
      linkedEffectMaterials: WeakSet<THREE.Material>;
      farWrap: THREE.Group | null;
      farBakeGate: FarBakeGate | null;
      farCompilePending: boolean;
    };
    probe.disposed = false;
    probe.linkedEffectMaterials = new WeakSet([material]);
    probe.farWrap = new THREE.Group();
    probe.farBakeGate = gate as unknown as FarBakeGate;
    probe.farCompilePending = false;
    // The constructor's own registration, made here because it did not run.
    registerContextRestoreReset('character-visual', visual, (owner) => owner.forgetContext());
    resetFor('character-visual');
    expect(probe.linkedEffectMaterials.has(material)).toBe(false);
    // The baked far mesh goes back behind the gate, the rig standing in.
    expect(probe.farCompilePending).toBe(true);
    expect(gate).toHaveBeenCalledWith(probe.farWrap, expect.any(Function));
  },
  'form-adornments': () => {
    const model = new THREE.Group();
    const chest = new THREE.Bone();
    chest.name = 'chest';
    const head = new THREE.Bone();
    head.name = 'head';
    chest.add(head);
    model.add(chest);
    const settles: (() => void)[] = [];
    const gate: FarBakeGate = (_root, onSettled) => {
      settles.push(onSettled);
    };
    const owner = new FormAdornments(model, 'composed', () => gate);
    owner.sync(true, false, false);
    for (const settle of settles.splice(0)) settle();
    owner.update(0.01, false, false, false, true);
    owner.sync(false, false, false);
    owner.sync(true, false, false);
    // Linked once on this rig: the second mount skips the gate.
    expect(settles).toHaveLength(0);
    owner.sync(false, false, false);
    resetFor('form-adornments');
    owner.sync(true, false, false);
    expect(settles.length).toBeGreaterThan(0);
  },
  'interior-encounter-prewarm': () => {
    // Driven through the pass's own module in its dedicated test
    // (tests/interior_encounter_prewarm_pass.test.ts, "context restore").
    expect(RESET_FIXTURES_DELEGATED.has('interior-encounter-prewarm')).toBe(true);
  },
  'post-shed': () => {
    const passes = {
      smaa: { enabled: true },
      grade: { enabled: true },
      gradeFxaa: { enabled: false },
      bloom: null,
      ao: null,
    };
    const shed = new PostShed(
      {} as unknown as THREE.WebGLRenderer,
      passes as unknown as ConstructorParameters<typeof PostShed>[1],
      { smaa: true, bloom: false, ao: false },
    );
    shed.prewarm(() => {});
    shed.apply(0.75);
    expect(shed.rung()).toBe('smaa-to-fxaa');
    resetFor('post-shed');
    // The twin's program went with the context: the SMAA tail runs again
    // until the presentation prewarm links it once more.
    expect(shed.rung()).toBe('full');
    expect(passes.smaa.enabled).toBe(true);
    shed.prewarm(() => {});
    expect(shed.rung()).toBe('smaa-to-fxaa');
  },
};

/** Ids whose fixture lives beside the module it resets, named here so the
 *  delegation is itself a checked list. */
const RESET_FIXTURES_DELEGATED = new Set<ContextRestoreResetId>(['interior-encounter-prewarm']);

const REBAKE_FIXTURES: Record<ContextRestoreRebakeId, Fixture> = {
  'environment-maps': () => {
    const target = new THREE.WebGLRenderTarget(4, 4);
    const source = new THREE.Texture();
    const fromEquirectangular = vi.fn();
    const dropped: string[] = [];
    const host = new ContextRestoreHost(
      hostSurface({
        environment: () => ({
          targets: new Map([
            ['vale', target],
            ['gone', new THREE.WebGLRenderTarget(4, 4)],
          ]),
          source: (key) => (key === 'vale' ? source : null),
          pmrem: () => ({ fromEquirectangular }) as unknown as THREE.PMREMGenerator,
          drop: (key) => dropped.push(key),
          dome: () => new THREE.Object3D(),
        }),
      }),
    );
    runRebakes('environment-maps');
    // Rendered again INTO the same target, so every material keeps pointing
    // at a lit environment; a target with no source is forgotten instead.
    expect(fromEquirectangular).toHaveBeenCalledWith(source, target);
    expect(dropped).toEqual(['gone']);
    host.dispose();
  },
  'grass-ground-bake': () => {
    const targets: (THREE.WebGLRenderTarget | null)[] = [];
    const renderer = {
      capabilities: { getMaxAnisotropy: () => 4 },
      toneMapping: THREE.ACESFilmicToneMapping,
      getRenderTarget: () => null,
      setRenderTarget: (target: THREE.WebGLRenderTarget | null) => targets.push(target),
      render: vi.fn(),
      readRenderTargetPixels: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const bake = bakeGrassGroundTexture(renderer, 7);
    setGrassGroundBake(bake);
    try {
      expect(renderer.render).toHaveBeenCalledTimes(1);
      runRebakes('grass-ground-bake');
      expect(renderer.render).toHaveBeenCalledTimes(2);
      // Into the bake's own target: terrain materials keep sampling it.
      expect(targets.filter((target) => target !== null)).toEqual([
        bake.texture.renderTarget,
        bake.texture.renderTarget,
      ]);
    } finally {
      setGrassGroundBake(null);
    }
  },
  'impostor-atlas': () => {
    // Baking needs a real GL context: proved by the real-GL leg
    // (tests/browser/context_restore.browser.test.ts).
    expect(REBAKE_FIXTURES_IN_BROWSER.has('impostor-atlas')).toBe(true);
  },
  'scene-sampling': () => {
    const renderer = {
      initRenderTarget: vi.fn(),
      getRenderTarget: () => null,
      copyTextureToTexture: vi.fn(),
      setRenderTarget: vi.fn(),
    };
    new OpaqueSceneCapture(renderer as unknown as THREE.WebGLRenderer, new THREE.Scene(), 8, 8);
    expect(renderer.initRenderTarget).toHaveBeenCalledTimes(1);
    runRebakes('scene-sampling');
    expect(renderer.initRenderTarget).toHaveBeenCalledTimes(2);
  },
};

const REBAKE_FIXTURES_IN_BROWSER = new Set<ContextRestoreRebakeId>(['impostor-atlas']);

describe('every context-restore record has its proof', () => {
  it('the fixture tables name exactly the registered ids', () => {
    expect(Object.keys(RESET_FIXTURES).sort()).toEqual([...CONTEXT_RESTORE_RESET_IDS].sort());
    expect(Object.keys(REBAKE_FIXTURES).sort()).toEqual([...CONTEXT_RESTORE_REBAKE_IDS].sort());
  });

  for (const id of CONTEXT_RESTORE_RESET_IDS) {
    it(`reset: ${id}`, async () => {
      await RESET_FIXTURES[id]();
    });
  }
  for (const id of CONTEXT_RESTORE_REBAKE_IDS) {
    it(`re-bake: ${id}`, async () => {
      await REBAKE_FIXTURES[id]();
    });
  }
});

describe('the other arms of the restore resets', () => {
  it('form adornments: the veil set holds behind the gate again after a restore', () => {
    const model = new THREE.Group();
    const chest = new THREE.Bone();
    chest.name = 'chest';
    const head = new THREE.Bone();
    head.name = 'head';
    chest.add(head);
    model.add(chest);
    const settles: (() => void)[] = [];
    const gate: FarBakeGate = (_root, onSettled) => {
      settles.push(onSettled);
    };
    const owner = new FormAdornments(model, 'composed', () => gate);
    owner.sync(false, true, false);
    expect(settles.length).toBeGreaterThan(0);
    for (const settle of settles.splice(0)) settle();
    owner.update(0.01, false, false, false, true);
    owner.sync(false, false, false);
    owner.sync(false, true, false);
    expect(settles).toHaveLength(0);
    owner.sync(false, false, false);
    resetFor('form-adornments');
    owner.sync(false, true, false);
    expect(settles.length).toBeGreaterThan(0);
  });

  it('grass bake: a superseded bake is never drawn again, only the active one', () => {
    const renderer = {
      capabilities: { getMaxAnisotropy: () => 4 },
      toneMapping: THREE.ACESFilmicToneMapping,
      getRenderTarget: () => null,
      setRenderTarget: vi.fn(),
      render: vi.fn(),
      readRenderTargetPixels: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const stale = bakeGrassGroundTexture(renderer, 1);
    const live = bakeGrassGroundTexture(renderer, 2);
    setGrassGroundBake(live);
    try {
      vi.mocked(renderer.setRenderTarget).mockClear();
      runRebakes('grass-ground-bake');
      const drawnInto = vi
        .mocked(renderer.setRenderTarget)
        .mock.calls.map(([target]) => target)
        .filter((target) => target !== null);
      expect(drawnInto).toEqual([live.texture.renderTarget]);
      expect(drawnInto).not.toContain(stale.texture.renderTarget);
      // A renderer a rebuild tore down is never drawn with again.
      disposeRendererContextGeneration(renderer);
      vi.mocked(renderer.render).mockClear();
      runRebakes('grass-ground-bake');
      expect(renderer.render).not.toHaveBeenCalled();
    } finally {
      setGrassGroundBake(null);
    }
  });

  it('environment: with no per-biome target the dome prefilter is made again and the dead one released', () => {
    const scene = new THREE.Scene();
    const dead = new THREE.WebGLRenderTarget(4, 4);
    const release = vi.spyOn(dead, 'dispose');
    scene.environment = dead.texture;
    const fresh = new THREE.WebGLRenderTarget(4, 4);
    const fromScene = vi.fn(() => fresh);
    const host = new ContextRestoreHost(
      hostSurface({
        scene: () => scene,
        environment: () => ({
          targets: new Map(),
          source: () => null,
          pmrem: () => ({ fromScene }) as unknown as THREE.PMREMGenerator,
          drop: () => {},
          dome: () => new THREE.Mesh(),
        }),
      }),
    );
    runRebakes('environment-maps');
    expect(fromScene).toHaveBeenCalledWith(expect.any(THREE.Scene), 0.04, 0.1, 1100, { size: 128 });
    expect(scene.environment).toBe(fresh.texture);
    expect(release).toHaveBeenCalledTimes(1);
    // A scene lit by no prefilter at all is left alone.
    scene.environment = null;
    fromScene.mockClear();
    runRebakes('environment-maps');
    expect(fromScene).not.toHaveBeenCalled();
    host.dispose();
  });

  it('castVfxRestoreUnits: the first reads link ahead of every pooled cast program', () => {
    const scene = new THREE.Scene();
    const pool = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    pool.name = 'pool';
    tagCastVfxEngine(pool);
    scene.add(pool);
    const band = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    band.name = 'band';
    const units = castVfxRestoreUnits(scene, [band, null], {} as never, {
      properties: { get: () => ({}) },
    });
    expect(units.map((unit) => unit.id)).toEqual(['first-read:band:0', 'program:pool:0']);
    expect(units[0].roots).toEqual([band]);
  });

  it('liveMaterialProperties reads the properties object the renderer holds NOW', () => {
    const material = new THREE.MeshBasicMaterial();
    const webgl = { properties: { get: () => ({ generation: 'old' }) } };
    const live = liveMaterialProperties(webgl);
    expect(live.get(material)).toEqual({ generation: 'old' });
    // What initGLContext does on a restore: a brand-new properties object.
    webgl.properties = { get: () => ({ generation: 'restored' }) };
    expect(live.get(material)).toEqual({ generation: 'restored' });
  });
});
