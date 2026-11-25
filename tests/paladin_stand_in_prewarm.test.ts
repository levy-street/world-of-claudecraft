// The Paladin kit recipe links every renderer-owned Paladin program: the
// visuals the renderer itself drives per entity or per zone (Aegis of the First
// Dawn, Holy Ground, Divine Ascension, Avenging Wrath's wings and rune band,
// the shield and weapon glow), not the kit's pools. A real-GPU measurement
// found them linking live: their only prewarm home was the generic
// ability-material stand-in group, linked as one unit by the very last
// background unit, about 120 s after the curtain at Ultra, while the Paladin
// kit recipe finishes seconds after entry (and seconds after a remote
// Paladin's first sighting). Avenging Wrath had no stand-in at all.
//
// So the recipe carries hidden stand-ins of its own (fresh instances, never
// disposed, so no zone ending can release a program), linked FIRST, one
// unit per distinct program, each settled over every variant and touched.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({
  loadTexture: vi.fn(async () => ({ image: null })),
  releaseTexture: vi.fn(),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn(),
}));

import { ABILITY_MATERIAL_SOURCES } from '../src/render/ability_material_prewarm';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { collectAbilityVfxCompileTargets } from '../src/render/ability_vfx/prewarm';
import {
  resetContextRestoreRegistriesForTest,
  runContextRestoreResets,
} from '../src/render/context_restore_registry';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import {
  paladinAvengingWrathStandInMaterials,
  syncPaladinAvengingWrathVisual,
} from '../src/render/paladin_avenging_wrath_visual';
import { PaladinConsecrationVisuals } from '../src/render/paladin_consecration_visual';
import type { PrewarmResumeUnit } from '../src/render/prewarm_resume';
import { createVfxAnchor } from '../src/render/vfx_anchor';
import { installCastVfxCanvasStub } from './helpers/cast_vfx_headless';

/** The programs the measurement caught linking in a live frame. */
const MEASURED_LIVE_LINKS = [
  'paladin_consecration:ground',
  'paladin_consecration:runes',
  'paladin_consecration:fire-wall',
  'paladin_consecration:opening',
  'paladin_aegis:dome',
  'paladin_aegis:ground',
  'paladin_aegis:sign',
  'paladin_avenging_wrath:wings',
  'paladin_avenging_wrath:rune-band',
];

const STAND_IN_COMPILE = 'paladin-stand-in-compile:';

interface FakeProgram {
  isReady(): boolean;
  getUniforms: ReturnType<typeof vi.fn>;
  getAttributes: ReturnType<typeof vi.fn>;
}

/** A host whose compile "links" every material under the root it is handed:
 *  one program per (material, draw shape), as three's cache keys them. */
function fakeHost() {
  const props = new Map<THREE.Material, { programs: Map<string, FakeProgram> }>();
  const compiled: THREE.Object3D[] = [];
  const programs: FakeProgram[] = [];
  const host = {
    properties: { get: (material: THREE.Material) => props.get(material) },
    compile: async (root: THREE.Object3D) => {
      compiled.push(root);
      root.traverse((object) => {
        const own = (object as THREE.Mesh).material;
        if (!own) return;
        for (const material of Array.isArray(own) ? own : [own]) {
          const entry = props.get(material) ?? { programs: new Map<string, FakeProgram>() };
          props.set(material, entry);
          const key = drawProgramSignature(object, material);
          if (entry.programs.has(key)) continue;
          const program: FakeProgram = {
            isReady: () => true,
            getUniforms: vi.fn(),
            getAttributes: vi.fn(),
          };
          programs.push(program);
          entry.programs.set(key, program);
        }
      });
    },
    draw: vi.fn(),
  };
  return { host, compiled, programs, forget: () => props.clear() };
}

function engine() {
  installCastVfxCanvasStub();
  const scene = new THREE.Scene();
  const fx = new AbilityVfxFx(
    scene,
    new THREE.PerspectiveCamera(),
    createVfxAnchor(() => false),
    () => 0,
  );
  return { scene, fx };
}

/** The engine's parts of the Paladin recipe in the order active_kit_prewarm.ts
 *  queues them, less the borrowed Warrior pieces (no Warrior asset is loaded
 *  here; tests/paladin_borrowed_warrior_pieces.test.ts covers them). */
function paladinUnits(fx: AbilityVfxFx, host: ReturnType<typeof fakeHost>['host']) {
  return [
    ...fx.authoredPrewarmUnits(host, [], 'paladin-stand-ins'),
    ...fx.authoredPrewarmUnits(host, [], 'paladin-borrowed'),
    ...fx.authoredPrewarmUnits(host, [], 'paladin'),
  ] as PrewarmResumeUnit[];
}

async function runAll(units: readonly PrewarmResumeUnit[]): Promise<void> {
  for (const unit of units) await unit.run();
}

const standInUnits = (units: readonly PrewarmResumeUnit[]) =>
  units.filter(
    (unit) => unit.id.startsWith(STAND_IN_COMPILE) || unit.id.startsWith('touch:paladin-stand-in:'),
  );

/** The kit's stand-in group, found the way the boot walk would see it. */
function standInGroup(scene: THREE.Scene): THREE.Object3D {
  const group = scene.getObjectByName('paladin-stand-in-prewarm');
  if (!group) throw new Error('no Paladin stand-in group in the scene');
  return group;
}

function materialsUnder(root: THREE.Object3D): THREE.Material[] {
  const found = new Set<THREE.Material>();
  root.traverse((object) => {
    const own = (object as THREE.Mesh).material;
    if (!own) return;
    for (const material of Array.isArray(own) ? own : [own]) found.add(material);
  });
  return [...found];
}

describe('the Paladin kit recipe links the renderer-owned Paladin programs', () => {
  it('opens with the stand-in units, ahead of every kit pool', () => {
    const { fx } = engine();
    const units = paladinUnits(fx, fakeHost().host);
    expect(units[0]?.id.startsWith(STAND_IN_COMPILE)).toBe(true);
    const isStandIn = units.map((unit) => standInUnits([unit]).length > 0);
    const lastStandIn = isStandIn.lastIndexOf(true);
    const firstOther = isStandIn.indexOf(false);
    expect(lastStandIn).toBeGreaterThan(0);
    expect(lastStandIn).toBeLessThan(firstOther);
    // They are their own part of the recipe: the pools' part carries none.
    expect(standInUnits(fx.authoredPrewarmUnits(fakeHost().host, [], 'paladin'))).toEqual([]);
    // The Warrior recipe never carries them: no other class pays for them.
    expect(standInUnits(fx.authoredPrewarmUnits(fakeHost().host) as PrewarmResumeUnit[])).toEqual(
      [],
    );
  });

  it('compiles every measured live link, and every program its stand-ins draw', async () => {
    const { scene, fx } = engine();
    const { host, compiled } = fakeHost();
    await runAll(standInUnits(paladinUnits(fx, host)));
    const names = new Set(compiled.flatMap((root) => materialsUnder(root).map((m) => m.name)));
    for (const name of MEASURED_LIVE_LINKS) expect(names, name).toContain(name);
    expect(names).toContain('paladin_ascension:column');
    expect(names).toContain('paladin_shield_glow_fx:layer');
    // Every (draw, material) under the group shares a program with a compiled one.
    const linked = new Set<string>();
    for (const root of compiled)
      root.traverse((object) => {
        const own = (object as THREE.Mesh).material;
        if (own) for (const m of [own].flat()) linked.add(drawProgramSignature(object, m));
      });
    standInGroup(scene).traverse((object) => {
      const own = (object as THREE.Mesh).material;
      if (!own) return;
      for (const material of [own].flat())
        expect(linked.has(drawProgramSignature(object, material)), material.name).toBe(true);
    });
  });

  it('cuts one compile per distinct program, never a whole stand-in in one unit', () => {
    const { fx } = engine();
    const compiles = paladinUnits(fx, fakeHost().host).filter((unit) =>
      unit.id.startsWith(STAND_IN_COMPILE),
    );
    expect(new Set(compiles.map((unit) => unit.id)).size).toBe(compiles.length);
    // Holy Ground alone draws more programs than there are stand-ins.
    expect(compiles.length).toBeGreaterThan(10);
    for (const source of ['consecration', 'aegis', 'avenging-wrath', 'ascension', 'shield-glow'])
      expect(
        compiles.some((unit) => unit.id.startsWith(`${STAND_IN_COMPILE}${source}:`)),
        source,
      ).toBe(true);
  });

  it('touches every program it linked, and is done once they are', async () => {
    const { fx } = engine();
    const { host, programs } = fakeHost();
    await runAll(standInUnits(paladinUnits(fx, host)));
    expect(programs.length).toBeGreaterThan(0);
    for (const program of programs) expect(program.getUniforms).toHaveBeenCalledOnce();
    expect(standInUnits(paladinUnits(fx, host))).toEqual([]);
  });

  it('fails a compile whose programs never settled, so the backoff asks again', async () => {
    const { fx } = engine();
    const host = { ...fakeHost().host, compile: async () => {} };
    const first = paladinUnits(fx, host).find((unit) => unit.id.startsWith(STAND_IN_COMPILE));
    await expect(Promise.resolve(first?.run())).rejects.toThrow();
  });
});

describe('the stand-ins stay held', () => {
  it('are their own hidden instances, out of the boot link walk', () => {
    const { scene, fx } = engine();
    void fx;
    const group = standInGroup(scene);
    expect(group.visible).toBe(false);
    expect(group.parent).toBe(scene);
    const boot = new Set(collectAbilityVfxCompileTargets(scene).map((target) => target.object));
    group.traverse((object) => expect(boot.has(object), object.name).toBe(false));
    // Never the boot group's singletons: one Object3D has one parent, so
    // sharing them would pull them out of one group or the other.
    const singletons = new Set(
      ABILITY_MATERIAL_SOURCES.filter((source) => source.id.startsWith('paladin-')).flatMap(
        (source) => [...source.materials()],
      ),
    );
    for (const material of materialsUnder(group)) {
      if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
      expect(singletons.has(material), material.name).toBe(false);
    }
  });

  it('survive every live zone and wing pair ending, and the engine clearing', () => {
    const { scene, fx } = engine();
    const group = standInGroup(scene);
    const disposed: string[] = [];
    for (const material of materialsUnder(group))
      material.addEventListener('dispose', () => disposed.push(material.name));
    const zones = new PaladinConsecrationVisuals(scene, () => 0);
    zones.sync([{ id: 'live', x: 0, z: 0, radius: 8, duration: 8, remaining: 8 }]);
    zones.sync([]);
    zones.dispose();
    const parent = new THREE.Group();
    const wings = syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 0, true);
    expect(wings).not.toBeNull();
    expect(syncPaladinAvengingWrathVisual(wings, parent, 1.8, false, 0, true)).toBeNull();
    fx.clear();
    expect(disposed).toEqual([]);
    expect(group.parent).toBe(scene);
  });

  it('are linked again after a WebGL context restore', async () => {
    resetContextRestoreRegistriesForTest();
    const { fx } = engine();
    const { host, forget } = fakeHost();
    await runAll(standInUnits(paladinUnits(fx, host)));
    expect(standInUnits(paladinUnits(fx, host))).toEqual([]);
    forget();
    runContextRestoreResets();
    const again = standInUnits(paladinUnits(fx, host));
    expect(again.length).toBeGreaterThan(0);
    await runAll(again);
    expect(standInUnits(paladinUnits(fx, host))).toEqual([]);
  });
});

describe('Avenging Wrath has a stand-in of its own', () => {
  it('holds the wings and the rune band, on the boot lane too', () => {
    const names = paladinAvengingWrathStandInMaterials().map((material) => material.name);
    expect(names).toEqual(
      expect.arrayContaining(['paladin_avenging_wrath:wings', 'paladin_avenging_wrath:rune-band']),
    );
    const source = ABILITY_MATERIAL_SOURCES.find((s) => s.id === 'paladin-avenging-wrath');
    expect(source?.module).toBe('paladin_avenging_wrath_visual.ts');
  });
});
