// The Gravewyrm Sanctum's open-air interior, the Ice Tomb of the Wyrm: the
// glacier cirque's terraces from the authored field (wind-packed snow, blue
// glacier and lake ice, Thornpeak slate, glacier-blue crevasse walls), the
// Blender kit over the props and through the gulf, the frozen lake's plates,
// the vault's meltwater and the Thaw Works' fire, steam and running melt, the
// Smith's great chains, the gates, the Calving Face with Korzul in it, the
// ring of summits and the Quench, and the polar dusk with its aurora. Built
// once per claimed slot the player approaches, attached through the
// renderer's compile gate (dungeon.ts via open_air_fields.ts), never removed.

import * as THREE from 'three';
import { GFX, gfxTierAtLeast } from '../gfx';
import { GRAVEWYRM_SANCTUM_KEY_DIRECTION } from '../interior_light_rig';
import type { FireLightSink } from '../point_light_budget';
import { buildSanctumAir } from './sanctum_air';
import { buildSanctumChains } from './sanctum_chains';
import { buildSanctumKitDressing } from './sanctum_dressing';
import { buildSanctumFace, ensureFrozenWyrm } from './sanctum_face';
import { buildSanctumGates } from './sanctum_gates';
import { ensureSanctumKit } from './sanctum_kit';
import { buildSanctumLake } from './sanctum_lake';
import { buildSanctumLights } from './sanctum_lights';
import {
  buildSanctumMountains,
  ensureSanctumMountains,
  syncSanctumMountains,
} from './sanctum_mountains';
import { sanctumGround } from './sanctum_plan_core';
import { buildSanctumSky } from './sanctum_sky';
import { buildSanctumSteam } from './sanctum_steam';
import { buildSanctumTerrain } from './sanctum_terrain';
import { buildSanctumVault } from './sanctum_vault';
import { buildSanctumWorks } from './sanctum_works';

export interface GravewyrmSanctumInteriorDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

/** Build the whole Sanctum for the slot anchored at (ox, oz), instance-local. */
export async function buildGravewyrmSanctumInterior(
  deps: GravewyrmSanctumInteriorDeps,
  ox: number,
  oz: number,
): Promise<THREE.Group> {
  await Promise.all([ensureSanctumKit(), ensureSanctumMountains(), ensureFrozenWyrm()]);
  const group = new THREE.Group();
  group.name = 'gravewyrmSanctumField';
  // Cosmetic density sheds with the effects tier (never a telegraph, a gate
  // or the face's story).
  const density = deps.lowGfx ? 0.35 : gfxTierAtLeast(GFX.effectsTier, 'high') ? 1 : 0.6;
  group.add(buildSanctumTerrain(deps.lowGfx));
  group.add(buildSanctumKitDressing(deps.lowGfx, density));
  group.add(buildSanctumLake(deps.lowGfx));
  group.add(buildSanctumVault(deps.lowGfx));
  group.add(buildSanctumWorks(deps.lowGfx, density));
  group.add(buildSanctumSteam({ lowGfx: deps.lowGfx, density }));
  group.add(buildSanctumGates(ox, oz, sanctumGround));
  buildSanctumLights(group, deps, sanctumGround);
  const face = buildSanctumFace(ox, oz, GRAVEWYRM_SANCTUM_KEY_DIRECTION);
  group.add(face.group);
  const chains = buildSanctumChains(ox, oz);
  group.add(chains.group);
  group.add(buildSanctumMountains(deps.lowGfx));
  group.add(
    buildSanctumSky({
      lowGfx: deps.lowGfx,
      density,
      onFrame: () => {
        face.update();
        chains.update();
        syncSanctumMountains();
      },
    }),
  );
  group.add(buildSanctumAir({ lowGfx: deps.lowGfx, density }));
  return group;
}
