// The Sunken Bastion's open-air interior: terrain from the authored field,
// the headland rock under it, the Blender kit over its props, the gates and
// seals, the lights, the standing water, the storm sky and the sea, the storm
// rain, and the Fogbeacon. Built once per claimed slot the player approaches, attached
// through the renderer's compile gate (dungeon.ts), never removed.

import * as THREE from 'three';
import { SUNKEN_BASTION_FIELD } from '../../sim/content/sunken_bastion_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';
import { buildAuthoredFieldTerrain } from '../authored_field/field_terrain';
import { GFX, gfxTierAtLeast } from '../gfx';
import type { FireLightSink } from '../point_light_budget';
import { buildBastionBeacon } from './bastion_beacon';
import { buildBastionGates } from './bastion_gates';
import { buildBastionKit, ensureBastionKit } from './bastion_kit';
import { buildBastionLights } from './bastion_lights';
import { buildBastionRain } from './bastion_rain';
import { buildHeadlandRock, buildSurfSpray } from './bastion_shore';
import { buildBastionSkySea } from './bastion_sky_sea';
import { buildBastionWater } from './bastion_water';

export interface SunkenBastionInteriorDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

const ground = (x: number, z: number): number => authoredFieldHeight(SUNKEN_BASTION_FIELD, x, z);

/** The generic field terrain, graded for a wet sea fortress at storm dusk:
 *  cliff faces sink to dark wet stone (the walkable tops read first), the mud
 *  warms to a peaty brown, the flagstones cool toward slate. Vertex paint only
 *  (the shared materials and textures stay untouched). */
function tintBastionTerrain(terrain: THREE.Group): THREE.Group {
  const grades: Record<string, [number, number, number]> = {
    fieldCliffs: [0.62, 0.6, 0.55],
    'fieldTop:soil': [0.95, 0.85, 0.66],
    'fieldTop:stone': [0.78, 0.8, 0.8],
  };
  terrain.traverse((o) => {
    const grade = grades[o.name];
    const mesh = o as THREE.Mesh;
    if (!grade || !mesh.isMesh) return;
    const col = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!col) return;
    for (let i = 0; i < col.count; i++) {
      col.setXYZ(i, col.getX(i) * grade[0], col.getY(i) * grade[1], col.getZ(i) * grade[2]);
    }
    col.needsUpdate = true;
    // Finer rock grain on the cliff faces (the shared uv scale is sized for
    // the crypt's distant crags).
    if (o.name === 'fieldCliffs') {
      const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
      if (uv) {
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.6, uv.getY(i) * 2.6);
        uv.needsUpdate = true;
      }
    }
  });
  return terrain;
}

/** Build the whole sea fortress for the slot anchored at (ox, oz), instance-local. */
export async function buildSunkenBastionInterior(
  deps: SunkenBastionInteriorDeps,
  ox: number,
  oz: number,
): Promise<THREE.Group> {
  await ensureBastionKit();
  const group = new THREE.Group();
  group.name = 'sunkenBastionField';
  // Cosmetic density sheds with the effects tier (never a telegraph or the beam).
  const density = deps.lowGfx ? 0.35 : gfxTierAtLeast(GFX.effectsTier, 'high') ? 1 : 0.6;
  group.add(
    tintBastionTerrain(
      buildAuthoredFieldTerrain(SUNKEN_BASTION_FIELD, { lowGfx: deps.lowGfx, wet: true }),
    ),
  );
  group.add(buildHeadlandRock(deps.lowGfx));
  group.add(buildBastionKit(ground, deps.lowGfx));
  group.add(buildBastionGates(ox, oz, ground));
  group.add(buildBastionWater(ground));
  buildBastionLights(group, deps, ground);
  group.add(buildBastionSkySea({ lowGfx: deps.lowGfx, density }));
  group.add(buildBastionRain({ lowGfx: deps.lowGfx, density }));
  group.add(buildBastionBeacon(ox, oz, { lowGfx: deps.lowGfx, density }));
  if (!deps.lowGfx) group.add(buildSurfSpray(density));
  return group;
}
