import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  IGNIVAR_APPROACH_CLEAR_HALF_WIDTH,
  IGNIVAR_APPROACH_DRESSING_NAME,
  ignivarRaidDressingInternalsForTest,
  VARKHUL_CRUCIBLE_DRESSING_NAME,
} from '../src/render/ignivar_raid_dressing';
import type { DungeonLayout } from '../src/sim/dungeon_layout';
import { VARKHUL_FORGE_LOCAL_POS } from '../src/sim/encounters/varkhul';

const APPROACH_LAYOUT: DungeonLayout = {
  zMin: -38,
  zMax: 38,
  sideWallZ: 0,
  sideWallHd: 38,
  wallX: 18,
  floorHalfX: 18,
  doorZ: -38,
  pillars: [],
  tombs: [],
  stubs: [],
  dais: { x: 0, z: 30, r: 5 },
};

const INNER_LAYOUT: DungeonLayout = {
  ...APPROACH_LAYOUT,
  zMin: -40,
  zMax: 40,
  wallX: 40,
  floorHalfX: 40,
};

describe('expanded Ignivar raid dressing', () => {
  it("keeps the approach's central combat route free at both graphics tiers", () => {
    for (const lowGfx of [true, false]) {
      const group = ignivarRaidDressingInternalsForTest.buildForgeApproachDressing(
        APPROACH_LAYOUT,
        lowGfx,
      );
      expect(group.name).toBe(IGNIVAR_APPROACH_DRESSING_NAME);
      expect(group.userData.clearHalfWidth).toBe(IGNIVAR_APPROACH_CLEAR_HALF_WIDTH);
      for (const name of ['ignivarApproachAssemblyRails', 'ignivarApproachTemperingStations']) {
        const mesh = group.getObjectByName(name) as THREE.InstancedMesh;
        expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        for (let index = 0; index < mesh.count; index++) {
          mesh.getMatrixAt(index, matrix);
          position.setFromMatrixPosition(matrix);
          expect(Math.abs(position.x)).toBeGreaterThan(IGNIVAR_APPROACH_CLEAR_HALF_WIDTH);
        }
      }
    }
  });

  it('anchors the grand forge at the rear wall and keeps side trenches outside the arena', () => {
    const fakeForgeBuilder = (x: number, z: number): THREE.Group => {
      const forge = new THREE.Group();
      forge.name = 'varkhulGrandForge';
      forge.position.set(x, 0, z);
      return forge;
    };
    const group = ignivarRaidDressingInternalsForTest.buildInnerCrucibleDressing(
      INNER_LAYOUT,
      false,
      fakeForgeBuilder,
    );
    const forge = group.getObjectByName('varkhulGrandForge') as THREE.Group;
    const trenches = group.getObjectByName('varkhulMoltenSideTrenches') as THREE.InstancedMesh;

    expect(group.name).toBe(VARKHUL_CRUCIBLE_DRESSING_NAME);
    expect(forge.position.x).toBe(VARKHUL_FORGE_LOCAL_POS.x);
    expect(forge.position.z).toBe(VARKHUL_FORGE_LOCAL_POS.z);
    expect(trenches.count).toBe(2);
    expect(group.userData.fightingFloorClearRadius).toBeGreaterThanOrEqual(30);
  });
});
