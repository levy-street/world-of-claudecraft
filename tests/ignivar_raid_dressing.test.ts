import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WALL_PROP_GROUP_PREFIX } from '../src/render/dungeon_wall_occlusion';
import type { IgnivarPropPlacement } from '../src/render/ignivar_dressing_plan_core';
import type { appendIgnivarEnvProps } from '../src/render/ignivar_env_props';
import {
  IGNIVAR_APPROACH_CLEAR_HALF_WIDTH,
  IGNIVAR_APPROACH_DRESSING_NAME,
  IGNIVAR_ARENA_DRESSING_NAME,
  ignivarRaidDressingInternalsForTest,
  VARKHUL_CRUCIBLE_DRESSING_NAME,
} from '../src/render/ignivar_raid_dressing';
import type { WallCullPlane } from '../src/render/wall_backface_cull_core';
import { type DungeonLayout, IGNIVAR_SECOND_WING_LAYOUT } from '../src/sim/dungeon_layout';
import { VARKHUL_FORGE_LOCAL_POS } from '../src/sim/encounters/varkhul';

function capturingAppender(captured: IgnivarPropPlacement[]): typeof appendIgnivarEnvProps {
  return (_group, placements) => {
    captured.push(...placements);
    return placements.length;
  };
}

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

  it('keeps the crucible trenches and fighting floor under the baked hand-placed pass', () => {
    const captured: IgnivarPropPlacement[] = [];
    const group = ignivarRaidDressingInternalsForTest.buildInnerCrucibleDressing(
      INNER_LAYOUT,
      false,
      capturingAppender(captured),
    );
    const trenches = group.getObjectByName('varkhulMoltenSideTrenches') as THREE.InstancedMesh;

    expect(group.name).toBe(VARKHUL_CRUCIBLE_DRESSING_NAME);
    expect(captured.length).toBeGreaterThanOrEqual(40);
    // The baked pass hugs the walls: every floor placement stays outside
    // the fighting-floor clear radius the rig itself declares, except the
    // forge-anchor dressing (the anvil the boss works pre-pull).
    const clearRadius = group.userData.fightingFloorClearRadius as number;
    for (const placement of captured) {
      if (placement.y !== 0) continue;
      const forgeDistance = Math.hypot(
        placement.x - VARKHUL_FORGE_LOCAL_POS.x,
        placement.z - VARKHUL_FORGE_LOCAL_POS.z,
      );
      if (forgeDistance <= 10) continue;
      expect(
        Math.hypot(placement.x, placement.z),
        `${placement.key} at ${placement.x},${placement.z} enters the fighting floor`,
      ).toBeGreaterThan(clearRadius);
    }
    expect(trenches.count).toBe(2);
    expect(group.userData.fightingFloorClearRadius).toBeGreaterThanOrEqual(30);
  });

  it('dresses the arena with props that respect the fighting circle', () => {
    const captured: IgnivarPropPlacement[] = [];
    const group = ignivarRaidDressingInternalsForTest.buildCrucibleArenaDressing(
      { ...APPROACH_LAYOUT, zMin: -33, zMax: 33, wallX: 33, floorHalfX: 33 },
      false,
      capturingAppender(captured),
    );
    expect(group.name).toBe(IGNIVAR_ARENA_DRESSING_NAME);
    expect(captured.length).toBeGreaterThan(0);
    for (const placement of captured) {
      if (placement.y !== 0) continue;
      expect(Math.hypot(placement.x, placement.z)).toBeGreaterThan(18);
    }
  });

  it('groups wall-mounted props per shell face for the backface cull', () => {
    // the real depths shell: beams, wall panels, and pipe runs mount on it
    const perGroup: Array<{ group: THREE.Group; placements: IgnivarPropPlacement[] }> = [];
    const appender: typeof appendIgnivarEnvProps = (group, placements) => {
      perGroup.push({ group: group as THREE.Group, placements: [...placements] });
      return placements.length;
    };
    const group = ignivarRaidDressingInternalsForTest.buildInnerCrucibleDressing(
      IGNIVAR_SECOND_WING_LAYOUT,
      false,
      appender,
    );
    const faceGroups = group.children.filter((c) => c.name.startsWith(WALL_PROP_GROUP_PREFIX));
    expect(faceGroups.length).toBeGreaterThan(0);
    for (const face of faceGroups) {
      const plane = face.userData.wallPlane as WallCullPlane | undefined;
      expect(plane).toBeDefined();
      if (!plane) continue;
      expect(Math.hypot(plane.nx, plane.nz)).toBeCloseTo(1, 6);
    }
    // the appender ran once for the interior list plus once per face group,
    // partitioning the plan: nothing dropped, nothing doubled
    const interiorCall = perGroup.find((c) => c.group === group);
    expect(interiorCall).toBeDefined();
    const faceCalls = perGroup.filter((c) => c.group !== group);
    expect(faceCalls.length).toBe(faceGroups.length);
    const wallKinds = new Set(faceCalls.flatMap((c) => c.placements.map((p) => p.key)));
    expect(wallKinds.has('beam')).toBe(true);
    for (const call of faceCalls) {
      expect(call.placements.length).toBeGreaterThan(0);
    }
  });

  it('wires liftLightsTo at the face fire-routing site (deleting the call must red)', () => {
    // The plans carry no wall sconce today, so the runtime path is dormant;
    // this source pin keeps the guard wired for the day one lands.
    const source = readFileSync(
      new URL('../src/render/ignivar_raid_dressing.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/if \(sub\) liftLightsTo\(group, sub\);/);
  });

  it('re-seats sconce lights on the dressing root so no light culls with a wall', () => {
    // addTorchFire parents flame AND light into its sink group; the face
    // subgroups toggle visibility per camera, and a light under that toggle
    // would both swing room lighting with the orbit and churn numPointLights
    // (a program cache key). liftLightsTo is the guard.
    const root = new THREE.Group();
    const sub = new THREE.Group();
    const light = new THREE.PointLight(0xffffff, 5, 10, 2);
    light.position.set(3, 1, -4);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 6));
    sub.add(light);
    sub.add(flame);
    root.add(sub);
    ignivarRaidDressingInternalsForTest.liftLightsTo(root, sub);
    expect(light.parent).toBe(root);
    expect(light.position.x).toBe(3);
    expect(flame.parent).toBe(sub);
    let lightsUnderSub = 0;
    sub.traverse((o) => {
      if ((o as THREE.Light).isLight) lightsUnderSub++;
    });
    expect(lightsUnderSub).toBe(0);
  });

  it('keeps every prop in the main group for layouts without a shell polygon', () => {
    const perGroup: Array<{ group: THREE.Group }> = [];
    const appender: typeof appendIgnivarEnvProps = (group, placements) => {
      perGroup.push({ group: group as THREE.Group });
      return placements.length;
    };
    const group = ignivarRaidDressingInternalsForTest.buildForgeApproachDressing(
      APPROACH_LAYOUT,
      false,
      appender,
    );
    expect(group.children.some((c) => c.name.startsWith(WALL_PROP_GROUP_PREFIX))).toBe(false);
    expect(perGroup.every((c) => c.group === group)).toBe(true);
  });
});
