import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(async () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    return { scene };
  }),
  releaseGltf: vi.fn(),
}));

import { DungeonInteriors } from '../src/render/dungeon';
import { buildDemonTowerFloor, DEMON_TOWER_SEED } from '../src/sim/content/rift/demon_tower';

describe('demon tower render integration', () => {
  it('does not stack the generic tile floor under the authored Tower surface', async () => {
    const hazardStyles = ['tower_lava', 'soul', 'void'] as const;
    for (const [floorIndex, hazardStyle] of hazardStyles.entries()) {
      const floor = buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, floorIndex);
      const scene = new THREE.Scene();
      const interiors = new DungeonInteriors(scene, true, [], []);
      const placeFloor = vi.spyOn(
        interiors as unknown as {
          placeFloor(...args: unknown[]): void;
        },
        'placeFloor',
      );

      const group = await interiors.buildInterior(floor.style.kit, 0, 0, {
        layout: { ...floor.layout, decor: [] },
        style: floor.style,
        hazards: floor.hazards,
        hazardStyle,
      });

      expect(placeFloor, `floor ${floorIndex + 1} generic tiles`).not.toHaveBeenCalled();
      let authoredFloors = 0;
      group.traverse((child) => {
        if (child.userData.towerEssential === 'floor') authoredFloors++;
      });
      expect(authoredFloors, `floor ${floorIndex + 1} authored surface`).toBe(1);
    }
  });

  it('keeps every hazard pool and rim in the real low-tier interior build', async () => {
    const styles = ['lava', 'soul', 'void'] as const;
    for (const [index, hazardStyle] of styles.entries()) {
      const floor = buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, index);
      const scene = new THREE.Scene();
      const interiors = new DungeonInteriors(scene, true, [], []);
      const group = await interiors.buildInterior(floor.style.kit, 0, 0, {
        layout: { ...floor.layout, decor: [] },
        style: floor.style,
        hazards: floor.hazards,
        hazardStyle,
      });
      const rendered = { pool: 0, rim: 0 };
      group.traverse((object) => {
        const kind: unknown = object.userData.riftHazard;
        if (kind === 'pool' || kind === 'rim') rendered[kind]++;
      });
      expect(group.parent).toBe(scene);
      expect(rendered).toEqual({
        pool: floor.hazards.length,
        rim: floor.hazards.length,
      });
    }
  });
});
