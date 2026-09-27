// The ability-material boot stand-ins must draw the SAME programs the live
// effects draw, tier by tier, and keep them.
//
// Four effects had no stand-in of their own: the Divine Ascension crown and
// seal (built lazily per character view, the crown on the shared surfaceMat,
// so its program depends on the tier), the Frostglobe (per-instance pooled
// materials in FrozenOrbFx, MeshStandard on every tier) and the two meteor
// rocks (the mage Meteor's pooled rock, the warlock Rain of Fire and Infernal
// class-field rocks). On ultra the crown linked about 345 ms live on an RTX
// 3060; on Low the crown and the Frostglobe shell and shards linked live; the
// rocks and the ultra Frostglobe were only saved by another module's material
// happening to share their key.
//
// Coverage is asked of each source's OWN stand-in, two ways: by drawProgramSignature (the dedupe key the
// ability-VFX prewarm walks by), and by three's own program keys, one per
// pass (a transparent DoubleSide material links a back and a front program).

import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ABILITY_MATERIAL_SOURCES,
  buildAbilityMaterialPrewarmGroup,
} from '../src/render/ability_material_prewarm';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import { FrozenOrbFx } from '../src/render/frozen_orb_fx';
import { GFX } from '../src/render/gfx';
import { MageGroundFx } from '../src/render/mage_ground_fx';
import { syncPaladinAscensionVisual } from '../src/render/paladin_ascension_visual';
import { WarlockMeteorFx } from '../src/render/warlock_meteor_fx';
import { activateTier, gfxProfileRestorer } from './helpers/gfx_tier';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

afterAll(gfxProfileRestorer());

interface Coverage {
  signatures: Set<string>;
  keys: Set<string>;
}

function coverageOf(root: THREE.Object3D): Coverage {
  const signatures = new Set<string>();
  const keys = new Set<string>();
  for (const draw of drawsUnder(root)) {
    signatures.add(drawProgramSignature(draw.object, draw.material));
    for (const key of threeProgramKeys(draw.material, draw.object).split('\n')) keys.add(key);
  }
  return { signatures, keys };
}

/** The coverage of ONE registered source's own stand-in, never the whole
 *  staged group: a live draw saved only by an unrelated source's material
 *  sharing its key is exactly the state these sources replace. */
function sourceCoverage(id: string): Coverage {
  const source = ABILITY_MATERIAL_SOURCES.find((entry) => entry.id === id);
  expect(source, `source ${id} registered`).toBeDefined();
  const root = source?.build() ?? new THREE.Group();
  // Every material the source declares is one its stand-in really draws.
  const drawn = new Set(drawsUnder(root).map((draw) => draw.material));
  for (const material of source?.materials() ?? []) expect(drawn.has(material)).toBe(true);
  return coverageOf(root);
}

function expectCovered(
  coverage: Coverage,
  draws: Array<{ object: THREE.Object3D; material: THREE.Material }>,
  label: string,
): void {
  expect(draws.length, `${label}: live draws`).toBeGreaterThan(0);
  for (const draw of draws) {
    const name = `${label}: ${draw.object.name || draw.object.type}`;
    expect(
      coverage.signatures.has(drawProgramSignature(draw.object, draw.material)),
      `${name} signature`,
    ).toBe(true);
    for (const key of threeProgramKeys(draw.material, draw.object).split('\n')) {
      expect(coverage.keys.has(key), `${name} program`).toBe(true);
    }
  }
}

function liveAscensionDraws(characterHeight: number) {
  const view = new THREE.Group();
  const rider = new THREE.Group();
  const visual = syncPaladinAscensionVisual(
    null,
    view,
    rider,
    characterHeight,
    { active: true, charges: 3, lastCharge: false },
    0,
    false,
  );
  expect(visual).not.toBeNull();
  const draws = [...drawsUnder(view), ...drawsUnder(rider)];
  // Both crown mesh kinds: the band and rims are Meshes, the prongs and
  // jewels InstancedMeshes, and three keys instancing into the program.
  expect(draws.some((draw) => (draw.object as THREE.InstancedMesh).isInstancedMesh)).toBe(true);
  expect(
    draws.some(
      (draw) =>
        (draw.object as THREE.Mesh).isMesh && !(draw.object as THREE.InstancedMesh).isInstancedMesh,
    ),
  ).toBe(true);
  return { visual: visual as NonNullable<typeof visual>, draws };
}

function liveFrostglobeDraws() {
  const scene = new THREE.Scene();
  const fx = new FrozenOrbFx(scene, () => 0);
  fx.spawn({ sourceId: 7, x: 0, z: 0, dirX: 0, dirZ: 1, speed: 2.5, duration: 8 });
  const draws = drawsUnder(scene);
  // Shell, core and shards are Meshes; the sparkle trail is Points.
  expect(draws.some((draw) => (draw.object as THREE.Points).isPoints)).toBe(true);
  return draws;
}

function liveMageRockDraws() {
  const scene = new THREE.Scene();
  const fx = new MageGroundFx(
    scene,
    () => 0,
    () => {},
  );
  fx.spawnMeteor({ x: 0, z: 0, radius: 5, duration: 1.2 });
  return drawsUnder(scene).filter((draw) => draw.object.name === 'mage-meteor-rock');
}

function liveWarlockRockDraws() {
  const scene = new THREE.Scene();
  const fx = new WarlockMeteorFx(
    scene,
    () => 0,
    () => {},
    null,
  );
  fx.spawnInfernal({ sourceId: 3, x: 0, z: 0, radius: 8, duration: 1.5 });
  fx.spawnRain({ sourceId: 4, x: 20, z: 0, radius: 8, duration: 6 });
  for (let frame = 0; frame < 20; frame++) fx.update(0.05);
  const rocks = drawsUnder(scene).filter((draw) => draw.object.name === 'warlock-fel-meteor-rock');
  // Both rock materials, the Rain of Fire fragment and the Infernal.
  expect(new Set(rocks.map((draw) => draw.material)).size).toBe(2);
  return rocks;
}

describe('ability-material stand-ins draw the live programs', () => {
  for (const tier of ['ultra', 'low'] as const) {
    describe(`on ${tier}`, () => {
      it('the tier really selects the material family', () => {
        activateTier(tier);
        expect(GFX.standardMaterials).toBe(tier === 'ultra');
      });

      it('covers the Divine Ascension seal and crown, on any rig height', () => {
        activateTier(tier);
        const coverage = sourceCoverage('paladin-ascension');
        for (const height of [1.8, 2.6, 1.1]) {
          expectCovered(coverage, liveAscensionDraws(height).draws, `ascension@${height}`);
        }
      });

      it('covers the Frostglobe shell, core, shards and trail', () => {
        activateTier(tier);
        expectCovered(sourceCoverage('frozen-orb'), liveFrostglobeDraws(), 'frostglobe');
      });

      it('covers the mage Meteor rock', () => {
        activateTier(tier);
        expectCovered(sourceCoverage('mage-meteor-rock'), liveMageRockDraws(), 'meteor rock');
      });

      it('covers the warlock Rain of Fire and Infernal rocks', () => {
        activateTier(tier);
        expectCovered(sourceCoverage('warlock-fel-rock'), liveWarlockRockDraws(), 'fel rock');
      });
    });
  }
});

describe('the Divine Ascension stand-in keeps its programs', () => {
  it.each(['ultra', 'low'] as const)('%s: a crown teardown disposes no staged material', (tier) => {
    activateTier(tier);
    const staged = new Set<THREE.Material>();
    for (const draw of drawsUnder(buildAbilityMaterialPrewarmGroup())) staged.add(draw.material);
    const { visual, draws } = liveAscensionDraws(1.8);
    const disposed = new Set<THREE.Material>();
    for (const material of staged) {
      material.addEventListener('dispose', () => disposed.add(material));
    }
    // The crown is the surfaceMat cache's shared instance, so the stand-in
    // wears the very material the live crown draws with: disposing it on a
    // view teardown would release the program the stand-in exists to keep.
    const liveCrown = draws.find((draw) => draw.object.name === 'paladin-ascension-crown-band');
    expect(liveCrown && staged.has(liveCrown.material)).toBe(true);
    visual.dispose();
    expect([...disposed]).toEqual([]);
  });

  it('is rebuilt for a new profile, so it never holds the retired tier material', () => {
    activateTier('ultra');
    const source = ABILITY_MATERIAL_SOURCES.find((entry) => entry.id === 'paladin-ascension');
    expect(source).toBeDefined();
    const ultra = source?.materials() ?? [];
    expect(ultra.some((material) => material instanceof THREE.MeshStandardMaterial)).toBe(true);
    activateTier('low');
    const low = source?.materials() ?? [];
    expect(low.some((material) => material instanceof THREE.MeshLambertMaterial)).toBe(true);
    expect(low.some((material) => material instanceof THREE.MeshStandardMaterial)).toBe(false);
  });
});
