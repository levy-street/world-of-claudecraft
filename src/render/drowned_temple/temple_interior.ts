// The Drowned Temple's open-air interior: the pearl walkways from the
// authored field, the crater ring and its waterfalls, the Blender kit over the
// props and the dressing in the lagoon, the gates and seals, the lights, the
// night sky and the lagoon, and the light landmarks (the Moon Altar's column,
// the Hydra Pool, the prism's beam). Built once per claimed slot the player
// approaches, attached through the renderer's compile gate (dungeon.ts), never
// removed.

import * as THREE from 'three';
import { DROWNED_TEMPLE_FIELD } from '../../sim/content/drowned_temple_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';
import { buildAuthoredFieldTerrain } from '../authored_field/field_terrain';
import { GFX, gfxTierAtLeast } from '../gfx';
import type { FireLightSink } from '../point_light_budget';
import { buildTempleCrater } from './temple_crater';
import { buildTempleGates } from './temple_gates';
import { buildTempleKit, ensureTempleKit } from './temple_kit';
import { buildTempleLandmarks } from './temple_landmarks';
import { buildTempleLights } from './temple_lights';
import { buildTempleSkyLagoon } from './temple_sky_lagoon';

export interface DrownedTempleInteriorDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

const ground = (x: number, z: number): number => authoredFieldHeight(DROWNED_TEMPLE_FIELD, x, z);

/** The generic field terrain, graded pearl-white for a moonlit temple: the
 *  flagstone tops lift toward pearl with a cool cast, the wet stone keeps a
 *  teal damp, and the skirts under the terraces sink to a blue-grey that meets
 *  the lagoon. Vertex paint only (the shared materials stay untouched). */
function tintTempleTerrain(terrain: THREE.Group): THREE.Group {
  const grades: Record<string, [number, number, number]> = {
    fieldCliffs: [0.74, 0.8, 0.98],
    'fieldTop:stone': [1.17, 1.13, 1.1],
    'fieldTop:soil': [0.9, 0.98, 1.05],
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

/** Build the whole lagoon temple for the slot anchored at (ox, oz), instance-local. */
export async function buildDrownedTempleInterior(
  deps: DrownedTempleInteriorDeps,
  ox: number,
  oz: number,
): Promise<THREE.Group> {
  await ensureTempleKit();
  const group = new THREE.Group();
  group.name = 'drownedTempleField';
  // Cosmetic density sheds with the effects tier (never a telegraph or a gate).
  const density = deps.lowGfx ? 0.35 : gfxTierAtLeast(GFX.effectsTier, 'high') ? 1 : 0.6;
  group.add(
    tintTempleTerrain(
      buildAuthoredFieldTerrain(DROWNED_TEMPLE_FIELD, { lowGfx: deps.lowGfx, wet: true }),
    ),
  );
  group.add(buildTempleCrater({ lowGfx: deps.lowGfx, density }));
  group.add(buildTempleKit(ground, deps.lowGfx));
  group.add(buildTempleGates(ox, oz, ground, deps.lowGfx));
  buildTempleLights(group, deps, ground);
  group.add(buildTempleSkyLagoon({ lowGfx: deps.lowGfx, density }));
  group.add(buildTempleLandmarks(ox, oz, deps.lowGfx));
  return group;
}
