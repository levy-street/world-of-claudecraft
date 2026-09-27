// The generic basic materials' shared option tables and their hidden
// stand-ins (src/render/vfx_basic_materials.ts): the stand-ins must carry the
// producers' program keys and be collected with the pooled cast VFX.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { collectAbilityVfxCompileTargets } from '../src/render/ability_vfx';
import { castVfxProgramUnits } from '../src/render/cast_vfx_prewarm';
import type { CompileArmHost } from '../src/render/compile_arms';
import { createCorpseBeacon } from '../src/render/corpse_beacon';
import {
  bubbleBeamMaterialOptions,
  buildCastVfxBasicStandIns,
  corpseBeaconMaterialOptions,
} from '../src/render/vfx_basic_materials';

/** The material fields three folds into a basic material's program key. */
function programShape(material: THREE.MeshBasicMaterial) {
  return {
    type: material.type,
    transparent: material.transparent,
    side: material.side,
    blending: material.blending,
    vertexColors: material.vertexColors,
    map: material.map,
    toneMapped: material.toneMapped,
  };
}

/** A renderer whose materials carry no program yet: the unit's mark after its
 *  compile then has nothing to record, which is what these cases want. */
const unprovedPrograms = { properties: { get: () => ({}) } };
/** Never reached: every case below injects its own compile. */
const noArms = {} as CompileArmHost;

describe('the generic basic stand-ins', () => {
  it('carry the bubble beam and corpse beacon program shapes, hidden, one mesh each', () => {
    const group = buildCastVfxBasicStandIns();
    expect(group.visible).toBe(false);
    const meshes = group.children as THREE.Mesh[];
    // The weapon-aura stand-ins have their own parity walk
    // (tests/weapon_aura_prewarm_parity.test.ts).
    expect(meshes.map((mesh) => mesh.name)).toEqual([
      'cast-vfx-basic:bubble-beam',
      'cast-vfx-basic:corpse-beacon',
      'cast-vfx-basic:weapon-imbue',
      'cast-vfx-basic:weapon-imbue-tip',
      'cast-vfx-basic:weapon-stonebound-shell',
      'cast-vfx-basic:weapon-stonebound-shard',
    ]);
    for (const mesh of meshes) {
      expect(mesh.visible).toBe(false);
      expect(mesh.userData.renderCategory).toBe('vfx');
    }
    const [beam, beacon] = meshes.map((mesh) => mesh.material as THREE.MeshBasicMaterial);
    // The producers' own materials, built from the same tables.
    const water = new THREE.MeshBasicMaterial(bubbleBeamMaterialOptions(0x42bfe8, 0.48));
    const core = new THREE.MeshBasicMaterial(bubbleBeamMaterialOptions(0xc5f7ff, 0.88));
    expect(programShape(beam)).toEqual(programShape(water));
    expect(programShape(beam)).toEqual(programShape(core));
    const live = createCorpseBeacon(new THREE.Scene());
    expect(programShape(beacon)).toEqual(
      programShape(live.mesh.material as THREE.MeshBasicMaterial),
    );
    // Two programs: the beacon's double side is a key input, opacity is not.
    expect(programShape(beam)).not.toEqual(programShape(beacon));
    expect(beacon.side).toBe(THREE.DoubleSide);
    expect(corpseBeaconMaterialOptions().side).toBe(THREE.DoubleSide);
  });

  it('is collected with the pooled cast VFX as one compile target and link unit per program', () => {
    const scene = new THREE.Scene();
    scene.add(buildCastVfxBasicStandIns());
    const targets = collectAbilityVfxCompileTargets(scene);
    // Six stand-ins, five programs: the full-blade weapon imbue shares the
    // beacon's (colour and opacity are uniforms), so it is not a unit of its own.
    expect(targets.map((target) => target.object.name)).toEqual([
      'cast-vfx-basic:bubble-beam',
      'cast-vfx-basic:corpse-beacon',
      'cast-vfx-basic:weapon-imbue-tip',
      'cast-vfx-basic:weapon-stonebound-shell',
      'cast-vfx-basic:weapon-stonebound-shard',
    ]);
    const compiled: string[] = [];
    const units = castVfxProgramUnits(scene, null, noArms, unprovedPrograms, async (root) => {
      compiled.push(root.name);
    });
    expect(units.map((unit) => unit.id)).toEqual(targets.map((target) => `program:${target.id}`));
    // The root rides on the unit, so the resume lane warms it ahead of the link.
    expect(units.map((unit) => unit.roots)).toEqual(targets.map((target) => [target.object]));
    for (const unit of units) unit.run();
    expect(compiled).toEqual(targets.map((target) => target.object.name));
  });

  it('links the staged lazy stand-ins last, as one unit, once they exist', () => {
    // They never hold a cast, so the pooled programs the gate waits on go first.
    const scene = new THREE.Scene();
    scene.add(buildCastVfxBasicStandIns());
    const standIns = new THREE.Group();
    standIns.name = 'ability-material-prewarm';
    const targets = collectAbilityVfxCompileTargets(scene);
    const compiled: string[] = [];
    const units = castVfxProgramUnits(scene, standIns, noArms, unprovedPrograms, async (root) => {
      compiled.push(root.name);
    });
    expect(units.map((unit) => unit.id).at(-1)).toBe('ability-materials:compile');
    expect(units).toHaveLength(targets.length + 1);
    expect(units.at(-1)?.roots).toEqual([standIns]);
    for (const unit of units) unit.run();
    expect(compiled).toEqual([...targets.map((target) => target.object.name), standIns.name]);
  });
});
