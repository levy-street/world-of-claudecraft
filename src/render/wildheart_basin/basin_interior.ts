// The Wildheart Basin's open-air interior: the jungle caldera's terraces from
// the authored field (moss, wet basalt, flagstone), the Blender kit over the
// props and round the caldera (basin_kit.ts, another module's), the waterfalls
// with their spray, mist and rainbows, the river, the ford and the plunge
// pool, the gold afternoon sky, the gorge haze and the life in the air, the
// gates and seals, and the braziers' light. Built once per claimed slot the
// player approaches, attached through the renderer's compile gate (dungeon.ts
// via open_air_fields.ts), never removed.

import * as THREE from 'three';
import { WILDHEART_BASIN_FIELD } from '../../sim/content/wildheart_basin_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';
import { buildAuthoredFieldTerrain } from '../authored_field/field_terrain';
import { GFX, gfxTierAtLeast } from '../gfx';
import type { FireLightSink } from '../point_light_budget';
import { buildBasinAir } from './basin_air';
import { buildBasinFalls } from './basin_falls';
import { buildBasinGates } from './basin_gates';
import { buildBasinKitDressing, ensureBasinKit } from './basin_kit';
import { buildBasinLights } from './basin_lights';
import { buildBasinSky } from './basin_sky';
import { buildBasinWater } from './basin_water';
import { buildMawGlow } from './maw_glow';

export interface WildheartBasinInteriorDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

const ground = (x: number, z: number): number => authoredFieldHeight(WILDHEART_BASIN_FIELD, x, z);

/** The generic field terrain, graded for a humid jungle afternoon: the moss
 *  warms toward sunlit green, the basalt keeps its wet near-black, the cliff
 *  skirts under the terraces sink into a mossy dark that meets the gorge haze.
 *  Vertex paint only (the shared materials stay untouched). */
function tintBasinTerrain(terrain: THREE.Group): THREE.Group {
  const grades: Record<string, [number, number, number]> = {
    fieldCliffs: [0.86, 0.98, 0.8],
    'fieldTop:moss': [1.18, 1.22, 0.95],
    'fieldTop:basalt': [0.95, 1.0, 0.98],
    'fieldTop:stone': [1.12, 1.06, 0.94],
    'fieldTop:soil': [1.05, 0.98, 0.86],
  };
  terrain.traverse((o) => {
    const grade = grades[o.name];
    const mesh = o as THREE.Mesh;
    if (!grade || !mesh.isMesh) return;
    const col = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!col) return;
    for (let i = 0; i < col.count; i++) {
      col.setXYZ(
        i,
        Math.min(1, col.getX(i) * grade[0]),
        Math.min(1, col.getY(i) * grade[1]),
        Math.min(1, col.getZ(i) * grade[2]),
      );
    }
    col.needsUpdate = true;
  });
  return terrain;
}

/** Build the whole basin for the slot anchored at (ox, oz), instance-local. */
export async function buildWildheartBasinInterior(
  deps: WildheartBasinInteriorDeps,
  ox: number,
  oz: number,
): Promise<THREE.Group> {
  await ensureBasinKit();
  const group = new THREE.Group();
  group.name = 'wildheartBasinField';
  // Cosmetic density sheds with the effects tier (never a telegraph or a gate).
  const density = deps.lowGfx ? 0.35 : gfxTierAtLeast(GFX.effectsTier, 'high') ? 1 : 0.6;
  group.add(
    tintBasinTerrain(buildAuthoredFieldTerrain(WILDHEART_BASIN_FIELD, { lowGfx: deps.lowGfx })),
  );
  group.add(buildBasinKitDressing(deps.lowGfx));
  group.add(buildBasinWater(deps.lowGfx));
  group.add(buildBasinFalls({ lowGfx: deps.lowGfx, density }));
  group.add(buildBasinGates(ox, oz, ground));
  buildBasinLights(group, deps, ground);
  buildMawGlow(group);
  group.add(buildBasinSky({ lowGfx: deps.lowGfx, density }));
  group.add(buildBasinAir({ lowGfx: deps.lowGfx, density }));
  return group;
}
