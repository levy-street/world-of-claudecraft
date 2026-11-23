// The Hollow Crypt's open-air interior: terrain from the authored field, the
// Blender kit over its props, the gates and seals, the lights, and the night
// sky and air. Built once per claimed slot the player approaches, attached
// through the renderer's compile gate (dungeon.ts), never removed.

import * as THREE from 'three';
import { HOLLOW_CRYPT_FIELD } from '../../sim/content/hollow_crypt_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';
import { buildAuthoredFieldTerrain } from '../authored_field/field_terrain';
import { GFX, gfxTierAtLeast } from '../gfx';
import type { FireLightSink } from '../point_light_budget';
import { buildCryptAtmosphere } from './crypt_atmosphere';
import { buildCryptFloorMarks } from './crypt_floor_marks';
import { buildCryptGates } from './crypt_gates';
import { buildCryptKit, ensureCryptKit } from './crypt_kit';
import { buildColumnPool, buildCryptLights } from './crypt_lights';
import { buildChasmMist, buildCryptParticles } from './crypt_particles';
import { RITE_RING } from './crypt_plan_core';
import { RITE_INTERIOR_NAME } from './rite_candle_decor';

export interface HollowCryptInteriorDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

const ground = (x: number, z: number): number => authoredFieldHeight(HOLLOW_CRYPT_FIELD, x, z);

/** Build the whole necropolis for the slot anchored at (ox, oz), instance-local. */
export async function buildHollowCryptInterior(
  deps: HollowCryptInteriorDeps,
  ox: number,
  oz: number,
): Promise<THREE.Group> {
  await ensureCryptKit();
  const group = new THREE.Group();
  // The name the Rite's candle painter finds this slot's decor by.
  group.name = RITE_INTERIOR_NAME;
  // Cosmetic density sheds with the effects tier (never a telegraph).
  const density = deps.lowGfx ? 0.35 : gfxTierAtLeast(GFX.effectsTier, 'high') ? 1 : 0.6;
  group.add(buildAuthoredFieldTerrain(HOLLOW_CRYPT_FIELD, { lowGfx: deps.lowGfx }));
  group.add(buildCryptKit(ground, deps.lowGfx));
  group.add(buildCryptGates(ox, oz, ground));
  group.add(buildCryptFloorMarks(ground));
  buildCryptLights(group, deps, ground);
  group.add(buildColumnPool(RITE_RING.x, RITE_RING.h, RITE_RING.z));
  group.add(buildCryptAtmosphere({ lowGfx: deps.lowGfx, density }, ground));
  group.add(buildCryptParticles(ground, density));
  if (!deps.lowGfx) group.add(buildChasmMist(density));
  return group;
}
