// The generic basic materials' shared option tables and their hidden
// stand-ins (src/render/vfx_basic_materials.ts): the stand-ins must carry the
// producers' program keys and be collected with the pooled cast VFX.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { collectAbilityVfxCompileTargets } from '../src/render/ability_vfx';
import { castVfxProgramUnits } from '../src/render/cast_vfx_prewarm';
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

describe('the generic basic stand-ins', () => {
  it('carry the bubble beam and corpse beacon program shapes, hidden, one mesh each', () => {
    const group = buildCastVfxBasicStandIns();
    expect(group.visible).toBe(false);
    const meshes = group.children as THREE.Mesh[];
    expect(meshes.map((mesh) => mesh.name)).toEqual([
      'cast-vfx-basic:bubble-beam',
      'cast-vfx-basic:corpse-beacon',
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

  it('is collected with the pooled cast VFX as two compile targets and two link units', () => {
    const scene = new THREE.Scene();
    scene.add(buildCastVfxBasicStandIns());
    const targets = collectAbilityVfxCompileTargets(scene);
    expect(targets).toHaveLength(2);
    const compiled: string[] = [];
    const units = castVfxProgramUnits(scene, null, async (root) => {
      compiled.push(root.name);
    });
    expect(units.map((unit) => unit.id)).toEqual(targets.map((target) => `program:${target.id}`));
    // The root rides on the unit, so the resume lane warms it ahead of the link.
    expect(units.map((unit) => unit.roots)).toEqual(targets.map((target) => [target.object]));
    for (const unit of units) unit.run();
    expect(compiled).toEqual(['cast-vfx-basic:bubble-beam', 'cast-vfx-basic:corpse-beacon']);
  });

  it('links the staged lazy stand-ins first, as one unit, once they exist', () => {
    const scene = new THREE.Scene();
    const standIns = new THREE.Group();
    standIns.name = 'ability-material-prewarm';
    const compiled: string[] = [];
    const units = castVfxProgramUnits(scene, standIns, async (root) => {
      compiled.push(root.name);
    });
    expect(units.map((unit) => unit.id)).toEqual(['ability-materials:compile']);
    expect(units[0]?.roots).toEqual([standIns]);
    for (const unit of units) unit.run();
    expect(compiled).toEqual(['ability-material-prewarm']);
  });
});
