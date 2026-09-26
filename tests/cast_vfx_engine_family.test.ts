// The cast gate waits on the ENGINE and KIT families (src/render/cast_vfx_family.ts):
// the pools the ability-VFX painter draws a cast with for every class, plus
// the Vfx particle cloud its bursts ride, and the Warrior kit's pools that
// AbilityVfxFx builds with them. Built here from the REAL AbilityVfxFx and Vfx,
// the way the renderer builds them, so the membership below is the shipped
// one, not a fixture's.
//
// Every drawable the engine builds belongs to a named pool, and every pool is
// named in exactly one table: ENGINE, KIT or NO_DRAWABLE. The kit joins the
// gate because several of its pieces draw with no readiness check of their
// own (the baked layers' non-strict kinds, the solid fragments, the crests
// outside their authored kinds), so the gate is their only protection. A pool
// added to the engine without a row fails the attribution case; a row whose
// pool does not tag its drawables fails the membership case.

import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({
  loadTexture: vi.fn(async () => ({ image: null })),
  releaseTexture: vi.fn(),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn(),
}));
vi.mock('../src/render/ability_vfx/production_assets', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/render/ability_vfx/production_assets')>();
  return { ...actual, fragmentGeometry: vi.fn(() => null) };
});

import { buildAbilityMaterialPrewarmGroup } from '../src/render/ability_material_prewarm';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import {
  abilityVfxFamilyMaterials,
  abilityVfxGateMaterials,
  collectAbilityVfxCompileTargets,
} from '../src/render/ability_vfx/prewarm';
import { fragmentGeometry } from '../src/render/ability_vfx/production_assets';
import { inCastVfxEngine, inCastVfxKit, tagCastVfxKit } from '../src/render/cast_vfx_family';
import { createSceneCastVfxReadiness } from '../src/render/cast_vfx_prewarm';
import { DrainLifeVfx } from '../src/render/drain_life_vfx';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import { NeedleOfFateVfx } from '../src/render/needle_of_fate_vfx';
import { SentenceVfx } from '../src/render/sentence_vfx';
import { UmbralAnchorMarker } from '../src/render/umbral_anchor_marker';
import { Vfx } from '../src/render/vfx';
import { createVfxAnchor } from '../src/render/vfx_anchor';
import { buildCastVfxBasicStandIns } from '../src/render/vfx_basic_materials';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

/** Engine pools (AbilityVfxFx fields) and the distinct programs each draws. */
const ENGINE: Record<string, number> = {
  ribbons: 1,
  rings: 1,
  decals: 2,
  overlay: 1,
  pillars: 1,
  shells: 1,
  groundAuras: 1,
  flipbooks: 1,
};
/** The Vfx particle cloud: one Points program, drawn from the first frame. */
const CLOUD_PROGRAMS = 1;
/** The Warrior kit's pools (AbilityVfxFx fields) and the distinct programs of
 *  their OWN each draws, the Fury states' embedded engine ribbon aside. The
 *  pools share programs (one vertex-colour emissive instanced standard
 *  material program is drawn by the guards, the hammers, the power forms and
 *  the Fury states alike), so the kit's distinct total is KIT_PROGRAMS, not
 *  the sum. The solid fragments build their batches only from fragment
 *  geometry resident at construction: none on the first renderer of a page,
 *  FRAGMENT_PROGRAMS on a renderer rebuilt after the kit loaded. */
const KIT: Record<string, number> = {
  crests: 1,
  guards: 1,
  powerForms: 2,
  spiritHammers: 1,
  furyStates: 2,
  baked: 1,
  fragments: 0,
};
const KIT_PROGRAMS = 6;
const FRAGMENT_PROGRAMS = 1;
/** The gate set, pinned: the engine's 10 plus the kit's 6. The pools read no
 *  graphics tier, so it is the same on every tier and detail level (the
 *  composition cases below). */
const GATE_TOTAL = 16;
/** Pools that build no drawable of their own at construction (the spirit
 *  holders are material-less; each puppet runs its own compile gate). */
const NO_DRAWABLE = ['spirits'] as const;

type Draw = { object: THREE.Object3D; material: THREE.Material };

function installCanvasStub(): void {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const context = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'createImageData' || key === 'getImageData') {
          return (a: number, b: number, c?: number, d?: number) => ({
            data: new Uint8ClampedArray((c ?? a) * (d ?? b) * 4),
          });
        }
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
        if (key === 'createPattern') return () => gradient;
        if (key === 'measureText') return () => ({ width: 1 });
        return noop;
      },
      set: () => true,
    },
  );
  // An image element too: a lazy stand-in loads its texture through three's
  // ImageLoader, which only needs listeners that never fire here.
  const canvas = () => ({
    width: 0,
    height: 0,
    style: {},
    getContext: () => context,
    addEventListener: noop,
    removeEventListener: noop,
  });
  vi.stubGlobal('document', { createElement: canvas, createElementNS: canvas });
}

/** Every Object3D a pool instance reaches through its own fields (slots,
 *  arrays, nested records), stopping at the scene and the camera it was
 *  handed. The attribution a drawable gets is the pool that holds it. */
function objectsHeldBy(pool: unknown): Set<THREE.Object3D> {
  const held = new Set<THREE.Object3D>();
  const visited = new Set<unknown>();
  const visit = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    const object = value as THREE.Object3D & { isScene?: boolean; isCamera?: boolean };
    if (object.isObject3D) {
      if (object.isScene || object.isCamera) return;
      object.traverse((child) => held.add(child));
      return;
    }
    if (depth === 0 || ArrayBuffer.isView(value)) return;
    const record = value as {
      isMaterial?: boolean;
      isTexture?: boolean;
      isBufferGeometry?: boolean;
    };
    if (record.isMaterial || record.isTexture || record.isBufferGeometry) return;
    const entries =
      value instanceof Map || value instanceof Set
        ? [...value.values()]
        : Object.values(value as Record<string, unknown>);
    for (const entry of entries) visit(entry, depth - 1);
  };
  visit(pool, 5);
  return held;
}

function engineScene(options: { fragments?: boolean } = {}) {
  installCanvasStub();
  vi.mocked(fragmentGeometry).mockImplementation(() =>
    options.fragments ? new THREE.BoxGeometry(0.2, 0.2, 0.2) : null,
  );
  const scene = new THREE.Scene();
  const vfx = new Vfx(scene, () => null);
  const cloud = vfx.cloudDrawable();
  const before = new Set<THREE.Object3D>();
  scene.traverse((object) => before.add(object));
  const vfxDraws = drawsUnder(scene);
  const fx = new AbilityVfxFx(
    scene,
    new THREE.PerspectiveCamera(),
    createVfxAnchor(() => false),
    () => 0,
  );
  if (options.fragments) {
    const host = {
      properties: { get: () => ({}) },
      compile: async () => {},
      draw: () => {},
    };
    for (const unit of fx.authoredPrewarmUnits(host)) {
      if (unit.id.startsWith('fragment-build:')) unit.run();
    }
  }
  const built: Draw[] = [];
  for (const draw of drawsUnder(scene)) if (!before.has(draw.object)) built.push(draw);
  const owners = new Map<THREE.Object3D, string[]>();
  for (const [field, pool] of Object.entries(fx as unknown as Record<string, unknown>)) {
    for (const object of objectsHeldBy(pool)) {
      const list = owners.get(object) ?? [];
      list.push(field);
      owners.set(object, list);
    }
  }
  const drawsOf = (fields: readonly string[]) =>
    built.filter((draw) => fields.includes(owners.get(draw.object)?.[0] ?? ''));
  return { scene, fx, cloud, vfxDraws, built, owners, drawsOf };
}

const signaturesOf = (draws: readonly Draw[]) =>
  new Set(draws.map((draw) => drawProgramSignature(draw.object, draw.material)));

const isVfx = (draw: Draw) => draw.object.userData.renderCategory === 'vfx';
const inGate = (object: THREE.Object3D) => inCastVfxEngine(object) || inCastVfxKit(object);
const ENGINE_POOLS = Object.keys(ENGINE);
const KIT_POOLS = Object.keys(KIT);
const kitTotal = (fragments: boolean) => KIT_PROGRAMS + (fragments ? FRAGMENT_PROGRAMS : 0);
const engineTotal = Object.values(ENGINE).reduce((sum, n) => sum + n, CLOUD_PROGRAMS);

afterEach(() => {
  vi.mocked(fragmentGeometry).mockImplementation(() => null);
});

for (const fragments of [false, true]) {
  const arm = fragments ? 'fragments resident (a rebuilt renderer)' : 'first renderer of a page';
  describe(`the cast gate families, ${arm}`, () => {
    let h: ReturnType<typeof engineScene>;
    beforeAll(() => {
      h = engineScene({ fragments });
    });

    it('attributes every drawable the engine builds to one named pool', () => {
      expect(h.built.length).toBeGreaterThan(0);
      const named = new Set<string>([...ENGINE_POOLS, ...KIT_POOLS, ...NO_DRAWABLE]);
      for (const draw of h.built) {
        const owners = h.owners.get(draw.object) ?? [];
        expect(owners, `${draw.object.name || draw.object.type} has one owner`).toHaveLength(1);
        expect(named.has(owners[0]), `pool ${owners[0]} is in a table`).toBe(true);
      }
      const drawing = new Set(h.built.map((draw) => h.owners.get(draw.object)?.[0]));
      for (const pool of ENGINE_POOLS) expect(drawing.has(pool), pool).toBe(true);
      for (const pool of KIT_POOLS) {
        expect(drawing.has(pool), pool).toBe(pool !== 'fragments' || fragments);
      }
      for (const pool of NO_DRAWABLE) expect(drawing.has(pool), pool).toBe(false);
    });

    it('joins every engine and kit drawable and the cloud', () => {
      for (const draw of h.drawsOf(ENGINE_POOLS)) {
        expect(inCastVfxEngine(draw.object), `${h.owners.get(draw.object)?.[0]} joined`).toBe(true);
      }
      expect(inCastVfxEngine(h.cloud)).toBe(true);
      // A kit pool may own an engine pool instance (the Fury states' fallback
      // ribbon is an AbilityVfxRibbons): that draw joins the engine, on an
      // engine program. Its hidden prewarm carriers (category 'prewarm') wear
      // the material of a joined draw, so their program is gated too.
      const engineSignatures = signaturesOf(h.drawsOf(ENGINE_POOLS));
      const kitDraws = h.drawsOf(KIT_POOLS);
      const joined = kitDraws.filter((draw) => isVfx(draw));
      expect(joined.filter((draw) => inCastVfxKit(draw.object)).length).toBeGreaterThan(0);
      for (const draw of joined) {
        const pool = h.owners.get(draw.object)?.[0];
        if (inCastVfxKit(draw.object)) continue;
        expect(inCastVfxEngine(draw.object), `${pool}: ${draw.object.name} joined`).toBe(true);
        const signature = drawProgramSignature(draw.object, draw.material);
        expect(engineSignatures.has(signature), `${pool} embeds an engine program`).toBe(true);
      }
      const joinedMaterials = new Set(joined.map((draw) => draw.material));
      for (const draw of kitDraws.filter((candidate) => !isVfx(candidate))) {
        expect(draw.object.userData.renderCategory, draw.object.name).toBe('prewarm');
        expect(joinedMaterials.has(draw.material), `${draw.object.name} shares`).toBe(true);
      }
    });

    it('tags exactly the particle cloud among the Vfx drawables, and nothing unattributed', () => {
      const tagged = h.vfxDraws.filter((draw) => inGate(draw.object)).map((draw) => draw.object);
      expect(tagged).toEqual([h.cloud]);
      h.scene.traverse((object) => {
        if (!inGate(object) || object === h.cloud) return;
        const pool = h.owners.get(object)?.[0] ?? '';
        expect([...ENGINE_POOLS, ...KIT_POOLS], `${object.name || object.type}`).toContain(pool);
      });
    });

    it('gates exactly one representative per engine and kit program', () => {
      for (const [pool, programs] of Object.entries(ENGINE)) {
        expect(signaturesOf(h.drawsOf([pool])).size, `${pool} programs`).toBe(programs);
      }
      const engineSignatures = signaturesOf(h.drawsOf(ENGINE_POOLS));
      for (const [pool, programs] of Object.entries(KIT)) {
        const own = [...signaturesOf(h.drawsOf([pool]).filter(isVfx))].filter(
          (signature) => !engineSignatures.has(signature),
        );
        const expected = pool === 'fragments' && fragments ? FRAGMENT_PROGRAMS : programs;
        expect(own.length, `${pool} programs`).toBe(expected);
      }
      const kitOwn = [...signaturesOf(h.drawsOf(KIT_POOLS).filter(isVfx))].filter(
        (signature) => !engineSignatures.has(signature),
      );
      expect(kitOwn).toHaveLength(kitTotal(fragments));
      const gatedDraws = [
        ...h.drawsOf([...ENGINE_POOLS, ...KIT_POOLS]).filter(isVfx),
        { object: h.cloud, material: h.cloud.material as THREE.Material },
      ];
      const total = engineTotal + kitTotal(fragments);
      expect(total).toBe(GATE_TOTAL + (fragments ? FRAGMENT_PROGRAMS : 0));
      const gated = abilityVfxGateMaterials(h.scene);
      expect(gated).toHaveLength(total);
      expect(signaturesOf(gatedDraws).size).toBe(total);
      // Every gated material is a gated draw's, and every gated program has
      // its representative: a signature is one of three's programs, never two.
      const keyOf = new Map<string, string>();
      for (const draw of gatedDraws) {
        const signature = drawProgramSignature(draw.object, draw.material);
        const key = threeProgramKeys(draw.material, draw.object);
        const known = keyOf.get(signature);
        if (known === undefined) keyOf.set(signature, key);
        else expect(key, `${draw.object.name} shares a signature, not a program`).toBe(known);
      }
      const gatedKeys = new Set<string>();
      for (const material of gated) {
        const draw = gatedDraws.find((candidate) => candidate.material === material);
        expect(draw, `${material.type} is a gated draw`).toBeDefined();
        if (draw) gatedKeys.add(threeProgramKeys(draw.material, draw.object));
      }
      expect(gatedKeys).toEqual(new Set(keyOf.values()));
    });

    it('splits the representatives by family, and the scene gate reads each on its own', () => {
      const byFamily = abilityVfxFamilyMaterials(h.scene);
      expect([...byFamily.keys()]).toEqual(['engine', 'kit']);
      const engine = byFamily.get('engine') ?? [];
      const kit = byFamily.get('kit') ?? [];
      expect(engine).toHaveLength(engineTotal);
      expect(kit).toHaveLength(kitTotal(fragments));
      const engineMaterials = new Set<THREE.Material>([
        ...h.drawsOf(ENGINE_POOLS).map((draw) => draw.material),
        h.cloud.material as THREE.Material,
      ]);
      const kitMaterials = new Set(
        h
          .drawsOf(KIT_POOLS)
          .filter((draw) => inCastVfxKit(draw.object))
          .map((draw) => draw.material),
      );
      for (const material of engine) expect(engineMaterials.has(material)).toBe(true);
      for (const material of kit) expect(kitMaterials.has(material)).toBe(true);
      expect([...engine, ...kit]).toEqual(abilityVfxGateMaterials(h.scene));
      const webgl = { properties: { get: () => ({ currentProgram: null }) } };
      const readiness = createSceneCastVfxReadiness(h.scene, webgl, () => 0);
      expect(readiness.snapshot().families.map((family) => [family.id, family.pending])).toEqual([
        ['engine', engineTotal],
        ['kit', kitTotal(fragments)],
      ]);
    });

    it('orders the compile units engine, then kit, then every other pool', () => {
      const { scene } = engineScene({ fragments });
      scene.add(buildCastVfxBasicStandIns());
      new DrainLifeVfx(scene, () => null, vi.fn());
      const families = collectAbilityVfxCompileTargets(scene).map((target) =>
        inCastVfxEngine(target.object) ? 0 : inCastVfxKit(target.object) ? 1 : 2,
      );
      expect(families.filter((family) => family === 0)).toHaveLength(engineTotal);
      expect(families.filter((family) => family === 1)).toHaveLength(kitTotal(fragments));
      expect(families.filter((family) => family === 2).length).toBeGreaterThan(0);
      expect(families).toEqual([...families].sort((a, b) => a - b));
    });
  });
}

describe('the gate set is complete at the first consult', () => {
  it('builds no gated drawable after construction, however the pools are driven', () => {
    const h = engineScene();
    const before = abilityVfxGateMaterials(h.scene);
    const drawables = drawsUnder(h.scene).length;
    h.fx.prewarmSpawn(0, 0, 0, 1);
    for (let frame = 0; frame < 3; frame++) h.fx.update(0.1);
    expect(abilityVfxGateMaterials(h.scene)).toEqual(before);
    expect(drawsUnder(h.scene)).toHaveLength(drawables);
  });

  it('reads the set once: a gated drawable added after the first consult never joins', () => {
    const h = engineScene();
    const webgl = { properties: { get: () => ({ currentProgram: null }) } };
    const readiness = createSceneCastVfxReadiness(h.scene, webgl, () => 0);
    expect(readiness.snapshot()).toMatchObject({ ready: false, pending: GATE_TOTAL });
    const late = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x123456, wireframe: true }),
    );
    tagCastVfxKit(late);
    h.scene.add(late);
    expect(abilityVfxGateMaterials(h.scene)).toHaveLength(GATE_TOTAL + 1);
    expect(readiness.snapshot().pending).toBe(GATE_TOTAL);
  });
});

describe('the rest of the renderer cast VFX', () => {
  for (const lowDetail of [false, true]) {
    it(`stays out of the gate with its units kept (${lowDetail ? 'low' : 'full'} detail)`, () => {
      const { scene } = engineScene();
      const gatedBefore = abilityVfxGateMaterials(scene);
      expect(gatedBefore).toHaveLength(GATE_TOTAL);
      const unitsBefore = collectAbilityVfxCompileTargets(scene).length;
      scene.add(buildCastVfxBasicStandIns());
      new DrainLifeVfx(scene, () => null, vi.fn());
      const marker = new UmbralAnchorMarker();
      scene.add(marker.group);
      new SentenceVfx(scene, new THREE.PerspectiveCamera(), () => false, lowDetail, vi.fn());
      new NeedleOfFateVfx(scene, new THREE.PerspectiveCamera(), () => false, lowDetail);
      scene.add(buildAbilityMaterialPrewarmGroup());
      expect(abilityVfxGateMaterials(scene)).toEqual(gatedBefore);
      // One unit per program none of the gated pools already draws: the class
      // pools' own counts (tests/class_vfx_prewarm_homes.test.ts), plus the
      // lazy ability-material stand-ins, minus the programs they share with
      // the engine and the kit.
      expect(collectAbilityVfxCompileTargets(scene).length - unitsBefore).toBe(lowDetail ? 13 : 15);
    });
  }
});
