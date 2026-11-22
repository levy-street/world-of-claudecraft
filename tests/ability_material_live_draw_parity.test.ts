// The ability-material boot stand-ins must draw the SAME programs the live
// effects draw, tier by tier, and keep them.
//
// Four effects had no stand-in of their own: Divine Ascension (built lazily
// per character view: once a solar crown on the shared surfaceMat, now the
// column, rune circle, halo, motes and wings, all its own shader materials),
// the Frostglobe (per-instance pooled
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
import { PaladinShieldGlowFx } from '../src/render/characters/paladin_shield_glow_fx';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import { FrozenOrbFx } from '../src/render/frozen_orb_fx';
import { GFX } from '../src/render/gfx';
import { MageGroundFx } from '../src/render/mage_ground_fx';
import { PaladinAegisVisual } from '../src/render/paladin_aegis_visual';
import { syncPaladinAscensionVisual } from '../src/render/paladin_ascension_visual';
import { PaladinConsecrationVisuals } from '../src/render/paladin_consecration_visual';
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
  const plan = { active: true, charges: 3, lastCharge: false };
  const visual = syncPaladinAscensionVisual(null, view, rider, characterHeight, plan, 0, false);
  expect(visual).not.toBeNull();
  // A second frame with Avenging Wrath's wings spread too: Ascension's own pair
  // and the lower pair are both built, so every wing draw is in the list.
  syncPaladinAscensionVisual(visual, view, rider, characterHeight, plan, 0.5, false);
  syncPaladinAscensionVisual(
    visual,
    view,
    rider,
    characterHeight,
    { ...plan, wrathWings: true },
    0.5,
    false,
  );
  const draws = [...drawsUnder(view), ...drawsUnder(rider)];
  const names = new Set(draws.map((draw) => draw.object.name));
  for (const piece of [
    'paladin-ascension-pillar',
    'paladin-ascension-ground-seal',
    'paladin-ascension-halo',
    'paladin-ascension-motes',
  ]) {
    expect(names.has(piece), piece).toBe(true);
  }
  // The wings (Avenging Wrath's, borrowed) ride the same rider anchor.
  expect(rider.getObjectByName('paladin-avenging-wrath')).toBeDefined();
  // Both draw kinds: the column, circle, halo and wings are Meshes, the motes Points.
  expect(draws.some((draw) => (draw.object as THREE.Points).isPoints)).toBe(true);
  expect(draws.some((draw) => (draw.object as THREE.Mesh).isMesh)).toBe(true);
  return { visual: visual as NonNullable<typeof visual>, draws };
}

function liveAegisDraws() {
  const visual = new PaladinAegisVisual();
  visual.update(true, 0.1, false);
  visual.pulse(true);
  visual.update(true, 0.1, false);
  const draws = drawsUnder(visual.group);
  // The shader pieces are Meshes, the pluses and sparkles Sprites.
  expect(draws.some((draw) => (draw.object as THREE.Sprite).isSprite)).toBe(true);
  return { visual, draws };
}

function liveConsecrationDraws() {
  const scene = new THREE.Scene();
  const zones = new PaladinConsecrationVisuals(scene, (x, z) => 0.3 * Math.sin(x + z));
  zones.sync([{ id: 'zone', x: 4, z: -2, radius: 6, duration: 8, remaining: 7.5 }]);
  zones.update(0.4);
  const draws = drawsUnder(scene);
  // The motes are one InstancedMesh, and three keys instancing into the program.
  expect(draws.some((draw) => (draw.object as THREE.InstancedMesh).isInstancedMesh)).toBe(true);
  return { zones, draws };
}

function liveShieldGlowDraws() {
  const model = new THREE.Group();
  for (const [slot, geometry] of [
    ['handslotl', new THREE.BoxGeometry(0.6, 0.8, 0.1)],
    ['handslotr', new THREE.CylinderGeometry(0.05, 0.05, 1.2)],
  ] as const) {
    const hand = new THREE.Group();
    hand.name = slot;
    hand.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
    model.add(hand);
  }
  // A held piece with no normals of its own takes a computed set, as live.
  const bare = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  model.getObjectByName('handslotl')?.add(new THREE.Mesh(bare, new THREE.MeshBasicMaterial()));
  const shield = new PaladinShieldGlowFx(model);
  const weapon = new PaladinShieldGlowFx(model, 'right');
  shield.prepare();
  weapon.prepare();
  shield.update(0.1, 0.6, 1 / 60, 0.5);
  weapon.drive(0.6, 0.2, 1 / 60);
  const draws = drawsUnder(model).filter((draw) => draw.object.userData.paladinShieldGlow);
  expect(draws).toHaveLength(3);
  return { dispose: () => (shield.dispose(), weapon.dispose()), draws };
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

      it('covers the Divine Ascension column, circle, halo, motes and wings, on any rig height', () => {
        activateTier(tier);
        const coverage = sourceCoverage('paladin-ascension');
        for (const height of [1.8, 2.6, 1.1]) {
          expectCovered(coverage, liveAscensionDraws(height).draws, `ascension@${height}`);
        }
      });

      it('covers the Aegis dome, ground, sign, planted blade, pluses and sparkles', () => {
        activateTier(tier);
        const { visual, draws } = liveAegisDraws();
        expectCovered(sourceCoverage('paladin-aegis'), draws, 'aegis');
        visual.dispose();
      });

      it('covers a Holy Ground zone on uneven ground', () => {
        activateTier(tier);
        const { zones, draws } = liveConsecrationDraws();
        expectCovered(sourceCoverage('paladin-consecration'), draws, 'consecration');
        zones.dispose();
      });

      it('covers the shield and weapon glow layers', () => {
        activateTier(tier);
        const { dispose, draws } = liveShieldGlowDraws();
        expectCovered(sourceCoverage('paladin-shield-glow'), draws, 'shield glow');
        dispose();
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
  it.each(['ultra', 'low'] as const)('%s: a live teardown disposes no staged material', (tier) => {
    activateTier(tier);
    const staged = new Set<THREE.Material>();
    for (const draw of drawsUnder(buildAbilityMaterialPrewarmGroup())) staged.add(draw.material);
    const { visual, draws } = liveAscensionDraws(1.8);
    const disposed = new Set<THREE.Material>();
    for (const material of staged) {
      material.addEventListener('dispose', () => disposed.add(material));
    }
    // A live visual draws its own materials (the stand-in keeps the PROGRAMS,
    // not the instances), so its teardown may dispose them: none of them can be
    // one the stand-in holds.
    for (const draw of draws) expect(staged.has(draw.material), draw.object.name).toBe(false);
    visual.dispose();
    expect([...disposed]).toEqual([]);
  });

  it.each(['ultra', 'low'] as const)(
    '%s: an Aegis, Holy Ground or glow teardown disposes no staged material',
    (tier) => {
      activateTier(tier);
      const staged = new Set<THREE.Material>();
      for (const draw of drawsUnder(buildAbilityMaterialPrewarmGroup())) staged.add(draw.material);
      const disposed = new Set<THREE.Material>();
      for (const material of staged) {
        material.addEventListener('dispose', () => disposed.add(material));
      }
      const aegis = liveAegisDraws();
      const zone = liveConsecrationDraws();
      const glow = liveShieldGlowDraws();
      for (const draw of [...aegis.draws, ...zone.draws, ...glow.draws]) {
        expect(staged.has(draw.material), draw.object.name).toBe(false);
      }
      aegis.visual.dispose();
      // The zone runs out: its own materials go, the anchored programs stay.
      zone.zones.update(60);
      glow.dispose();
      expect([...disposed]).toEqual([]);
    },
  );

  it('is rebuilt for a new profile, so it never holds a retired profile stand-in', () => {
    activateTier('ultra');
    const source = ABILITY_MATERIAL_SOURCES.find((entry) => entry.id === 'paladin-ascension');
    expect(source).toBeDefined();
    const ultraRoot = source?.build();
    const ultra = source?.materials() ?? [];
    expect(ultra.length).toBeGreaterThan(0);
    // Same profile: the one stand-in, never a second.
    expect(source?.build()).toBe(ultraRoot);
    activateTier('low');
    const lowRoot = source?.build();
    const low = source?.materials() ?? [];
    expect(lowRoot).not.toBe(ultraRoot);
    expect(low.length).toBe(ultra.length);
    expect(low.some((material) => ultra.includes(material))).toBe(false);
  });
});
