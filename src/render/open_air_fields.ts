// The open-air field interiors and their builders: every dungeon authored as
// an open field under its own sky (sim/instances/authored_field) builds its
// whole interior group here, and dungeon.ts buildInterior attaches it through
// the compile gate in one shared arm.
//
// A built field is never removed, and its sky and backdrop reach far past its
// own instance: dungeon.ts builds each one through the roster re-exported
// below, which draws only the field the player stands in
// (open_air_field_visibility_core.ts).

import type * as THREE from 'three';
import { buildDrownedTempleInterior } from './drowned_temple';
import { buildGravewyrmSanctumInterior } from './gravewyrm_sanctum';
import { buildHollowCryptInterior } from './hollow_crypt';
import type { FireLightSink } from './point_light_budget';
import { buildSunkenBastionInterior } from './sunken_bastion';
import { buildWildheartBasinInterior } from './wildheart_basin';

export { OpenAirFieldRoster } from './open_air_field_visibility_core';

export interface OpenAirFieldDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

export const OPEN_AIR_FIELDS: Readonly<
  Record<
    string,
    (deps: OpenAirFieldDeps, ox: number, oz: number) => THREE.Group | Promise<THREE.Group>
  >
> = {
  wildheart: buildWildheartBasinInterior,
  hollow_crypt: buildHollowCryptInterior,
  sunken_bastion: buildSunkenBastionInterior,
  drowned_temple: buildDrownedTempleInterior,
  gravewyrm_sanctum: buildGravewyrmSanctumInterior,
};
