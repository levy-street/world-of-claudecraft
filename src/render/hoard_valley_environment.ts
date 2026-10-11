// Resolves the one deterministic environment record shared by the valley
// builder, fog, daylight, sky and IBL paths. Rift coordinates do not identify
// the original dig zone, so the sky samples a representative point in that
// zone while the floor itself stays in the instance region.

import { generateRiftFloor } from '../sim/rift/rift_gen';
import type { RiftFloorPlan } from '../sim/rift/types';
import type { RiftFloorView } from '../world_api';
import { themedRoomProfile } from './hoard_room_kit_core';
import { bossRoomThemeFor } from './hoard_room_themes_core';
import {
  type HoardValleyZoneProfile,
  hoardValleyProfile,
  isHoardValleyZoneId,
} from './hoard_valley_core';

const SKY_ANCHORS = Object.freeze({
  drakelands: { x: 350, z: 2085 },
  frostveil: { x: 118, z: 1790 },
  amberfall: { x: -412, z: 2228 },
  willowfen: { x: -266, z: 268 },
  nightbloom: { x: -424, z: 1478 },
  wraithwood: { x: 398, z: 1662 },
  palmreach: { x: -402, z: 750 },
  galecrest: { x: 480, z: 326 },
});

export interface HoardValleyEnvironment {
  floor: RiftFloorPlan;
  profile: HoardValleyZoneProfile;
  fog: { color: number; near: number; far: number };
  sky: { x: number; z: number };
}

/** Null for an ordinary Rift, a cave hoard, or while no Rift floor is active. */
export function resolveHoardValleyEnvironment(
  view: RiftFloorView | null,
): HoardValleyEnvironment | null {
  if (!view) return null;
  const floor = generateRiftFloor(view.seed, view.baseLevel, view.floorIndex, view.upgrade);
  const zoneId = floor.outdoor?.zoneId;
  if (!zoneId || !isHoardValleyZoneId(zoneId)) return null;
  // The fog is the boss room's when he has one, like the floor and the rock.
  const theme = bossRoomThemeFor(floor.spawns.find((spawn) => spawn.boss)?.templateId);
  const profile = themedRoomProfile(hoardValleyProfile(zoneId), theme);
  return {
    floor,
    profile,
    fog: { color: profile.fogColor, near: profile.fogNear, far: profile.fogFar },
    sky: SKY_ANCHORS[zoneId],
  };
}
