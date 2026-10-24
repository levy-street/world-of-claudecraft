// The Highwatch adventurers' guild's fires and lamps (sim/highwatch_layout.ts, the model built
// by scripts/assets/highwatch_guild/): the guildmaster's hearth and the trophy hall's hearth burn
// with the campfire's live flame, and a few warm point lights stand where the model's lit glass
// is (the two hearths, the hall's two chandeliers, the contracts board's lanterns, the trophy
// hall, the porch lantern and the great lantern in the tower's belfry, which the whole yard and
// the Stormcrag road see at night). The model's vertex colours already carry a baked warm glow;
// these only add the live flicker and the light on whoever stands in it.
//
// The manor's rule (highwatch_manor_lights.ts): every light is world-positioned at the props
// root and joins the props' fire-light budget, so these never change the scene's point-light
// count or recompile a lit material in a live frame; the flames are the campfire's own
// (campfire_flame.ts), ticked on the shared scenery flame pass, their programs the campfires'
// (already prewarmed). Built once per props build, only while the built-in Highwatch town
// stands.
import * as THREE from 'three';
import { HIGHWATCH_BUILDINGS_BY_ID } from '../sim/highwatch_layout';
import { localToWorld } from '../sim/placed_town_kit';
import { terrainHeight } from '../sim/world';
import { buildCampfireFlame } from './campfire_flame';

/** A light in the guild's model frame (yards over its ground line, as guild_plan.py). */
interface GuildLightSpec {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: number;
  readonly intensity: number;
  readonly distance: number;
}

/** The guild's lights, in its model frame (guild_plan.py / guild_furnish.py). */
export const HIGHWATCH_GUILD_LIGHTS: readonly GuildLightSpec[] = [
  { name: 'guildHearth', x: -12.6, y: 2.0, z: 6.6, color: 0xff8a3a, intensity: 18, distance: 18 },
  { name: 'guildHallLeft', x: 7, y: 10.2, z: 0, color: 0xffc070, intensity: 9, distance: 16 },
  { name: 'guildHallRight', x: -7, y: 10.2, z: 0, color: 0xffc070, intensity: 9, distance: 16 },
  { name: 'guildBoard', x: 12.2, y: 6.0, z: 0, color: 0xffc070, intensity: 6, distance: 9 },
  {
    name: 'guildTrophyHearth',
    x: 0,
    y: 1.8,
    z: 18.2,
    color: 0xff8a3a,
    intensity: 14,
    distance: 14,
  },
  { name: 'guildTrophyHall', x: 0, y: 6.8, z: 15, color: 0xffc070, intensity: 6, distance: 11 },
  { name: 'guildPorch', x: 0, y: 6.0, z: -14.4, color: 0xffc070, intensity: 7, distance: 11 },
  // the great lantern in the tower's belfry: lights the belfry's arches and the spire
  { name: 'guildTower', x: 18.2, y: 22.8, z: -7.6, color: 0xffc878, intensity: 14, distance: 18 },
  // the gateway's two lanterns at its beam's ends, over the road into the yard
  {
    name: 'guildGateLeft',
    x: -13.45,
    y: 4.5,
    z: -24.3,
    color: 0xffc070,
    intensity: 6,
    distance: 10,
  },
  {
    name: 'guildGateRight',
    x: -2.55,
    y: 4.5,
    z: -24.3,
    color: 0xffc070,
    intensity: 6,
    distance: 10,
  },
];

/** A live flame in the model frame: where it stands and how big it burns. */
interface GuildFlameSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly size: number;
}

/** The guildmaster's hearth (three flames along its logs) and the trophy hall's (three). */
export const HIGHWATCH_GUILD_FLAMES: readonly GuildFlameSpec[] = [
  { x: -13.3, y: 0.95, z: 6.6, size: 1.2 },
  { x: -13.35, y: 0.95, z: 5.7, size: 0.9 },
  { x: -13.35, y: 0.95, z: 7.5, size: 0.95 },
  { x: 0, y: 0.92, z: 19.35, size: 1.0 },
  { x: -0.85, y: 0.92, z: 19.4, size: 0.8 },
  { x: 0.85, y: 0.92, z: 19.4, size: 0.8 },
];

/** A model-frame point in the world: the guild stands its ground line at its anchor's terrain
 *  plus the seat's scale and lift (placed_town_interior_core.ts, the same rule). */
export function highwatchGuildWorldPoint(
  x: number,
  y: number,
  z: number,
  seed: number,
): { x: number; y: number; z: number } {
  const guild = HIGHWATCH_BUILDINGS_BY_ID.highwatch_guild;
  const p = guild.placement;
  const at = localToWorld(p, p.rotation, x * p.scale, z * p.scale);
  const line = terrainHeight(p.x, p.z, seed) + p.scale + p.lift;
  return { x: at.x, y: line + y * p.scale, z: at.z };
}

/** The guild's point lights, world-positioned (the caller adds them to the props root and the
 *  fire-light budget). */
export function highwatchGuildLights(seed: number): THREE.PointLight[] {
  return HIGHWATCH_GUILD_LIGHTS.map((spec) => {
    const light = new THREE.PointLight(spec.color, spec.intensity, spec.distance, 2);
    light.name = spec.name;
    const at = highwatchGuildWorldPoint(spec.x, spec.y, spec.z, seed);
    light.position.set(at.x, at.y, at.z);
    // the budget's flicker pass drives every contributing fire light from this base
    light.userData.baseIntensity = spec.intensity;
    return light;
  });
}

export interface HighwatchGuildFlame {
  /** The world-positioned holder (its scale is the flame's size). */
  readonly holder: THREE.Group;
  /** The animated body the scenery flame pass ticks (its own scale breathes). */
  readonly flame: THREE.Mesh;
  readonly core: THREE.Mesh | null;
}

/** The guild's live flames: each the campfire's body and core in a holder sized to its fire. */
export function highwatchGuildFlames(
  seed: number,
  emissiveIntensity: number,
): HighwatchGuildFlame[] {
  return HIGHWATCH_GUILD_FLAMES.map((spec) => {
    const { flame, core } = buildCampfireFlame({ emissiveIntensity });
    const holder = new THREE.Group();
    holder.name = 'highwatchGuildFlame';
    const at = highwatchGuildWorldPoint(spec.x, spec.y, spec.z, seed);
    holder.position.set(at.x, at.y, at.z);
    holder.scale.setScalar(spec.size);
    holder.add(flame);
    return { holder, flame, core };
  });
}
