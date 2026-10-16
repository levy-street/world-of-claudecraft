// The Highwatch manor's fires and lamps (sim/highwatch_layout.ts, the model built by
// scripts/assets/highwatch_manor/): the round hearth in the great hall and the kitchen's range
// burn with the campfire's live flame, and a few warm point lights stand where the model's lit
// glass is (the hearth, the two hall chandeliers' glow, the dining hall, the library, the
// chapel's altar, the kitchen, the porch lantern and the lantern on the ridge, whose glass the
// whole square sees at night). The model's vertex colours already carry a baked warm glow;
// these only add the live flicker and the light on whoever stands in it.
//
// Every light is world-positioned at the props root and joins the props' fire-light budget,
// the campfires' rule (props.ts): the budget decides which few nearby lights shine, so adding
// these never changes the scene's point-light count or recompiles a lit material in a live
// frame. The flames are the campfire's own (campfire_flame.ts), ticked on the shared scenery
// flame pass, their programs the campfires' (already prewarmed). Built once per props build,
// only while the built-in Highwatch town stands.
import * as THREE from 'three';
import { HIGHWATCH_BUILDINGS_BY_ID } from '../sim/highwatch_layout';
import { localToWorld } from '../sim/placed_town_kit';
import { terrainHeight } from '../sim/world';
import { buildCampfireFlame } from './campfire_flame';

/** A light in the manor's model frame (yards over its ground line, as manor_plan.py). */
interface ManorLightSpec {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: number;
  readonly intensity: number;
  readonly distance: number;
}

/** The manor's lights, in its model frame (manor_plan.py / manor_furnish.py). */
export const HIGHWATCH_MANOR_LIGHTS: readonly ManorLightSpec[] = [
  { name: 'manorHearth', x: 0, y: 2.2, z: 0, color: 0xff8a3a, intensity: 22, distance: 22 },
  { name: 'manorHallWest', x: 6.5, y: 10.2, z: 0, color: 0xffc070, intensity: 9, distance: 16 },
  { name: 'manorHallEast', x: -6.5, y: 10.2, z: 0, color: 0xffc070, intensity: 9, distance: 16 },
  { name: 'manorDais', x: 0, y: 3.4, z: 13.6, color: 0xffb35a, intensity: 8, distance: 10 },
  { name: 'manorDining', x: 18.9, y: 7.6, z: 0.2, color: 0xffc070, intensity: 10, distance: 14 },
  { name: 'manorKitchen', x: 20.3, y: 1.6, z: 12.9, color: 0xff8030, intensity: 12, distance: 10 },
  { name: 'manorLibrary', x: -18.9, y: 7.6, z: -1, color: 0xffc070, intensity: 9, distance: 13 },
  { name: 'manorChapel', x: -18.8, y: 2.8, z: 10.8, color: 0xffb35a, intensity: 7, distance: 9 },
  { name: 'manorPorch', x: 0, y: 6.0, z: -14.4, color: 0xffc070, intensity: 7, distance: 11 },
  // the lantern on the ridge: lights its own spire and the roof round it
  { name: 'manorLantern', x: 0, y: 21.8, z: 0, color: 0xffc878, intensity: 14, distance: 18 },
];

/** A live flame in the model frame: where it stands and how big it burns. */
interface ManorFlameSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly size: number;
}

/** The hearth's fire (a big flame and three smaller round it) and the kitchen range's. */
export const HIGHWATCH_MANOR_FLAMES: readonly ManorFlameSpec[] = [
  { x: 0, y: 1.0, z: 0, size: 2.1 },
  { x: 0.95, y: 1.0, z: 0.4, size: 1.2 },
  { x: -0.7, y: 1.0, z: 0.75, size: 1.1 },
  { x: -0.3, y: 1.0, z: -0.95, size: 1.15 },
  { x: 19.8, y: 0.95, z: 13.9, size: 0.85 },
  { x: 20.8, y: 0.95, z: 13.85, size: 0.75 },
];

/** A model-frame point in the world: the manor stands its ground line at its anchor's
 *  terrain plus the seat's scale and lift (placed_town_interior_core.ts, the same rule). */
export function highwatchManorWorldPoint(
  x: number,
  y: number,
  z: number,
  seed: number,
): { x: number; y: number; z: number } {
  const manor = HIGHWATCH_BUILDINGS_BY_ID.highwatch_manor;
  const p = manor.placement;
  const at = localToWorld(p, p.rotation, x * p.scale, z * p.scale);
  const line = terrainHeight(p.x, p.z, seed) + p.scale + p.lift;
  return { x: at.x, y: line + y * p.scale, z: at.z };
}

/** The manor's point lights, world-positioned (the caller adds them to the props root and
 *  the fire-light budget). */
export function highwatchManorLights(seed: number): THREE.PointLight[] {
  return HIGHWATCH_MANOR_LIGHTS.map((spec) => {
    const light = new THREE.PointLight(spec.color, spec.intensity, spec.distance, 2);
    light.name = spec.name;
    const at = highwatchManorWorldPoint(spec.x, spec.y, spec.z, seed);
    light.position.set(at.x, at.y, at.z);
    // the budget's flicker pass drives every contributing fire light from this base
    light.userData.baseIntensity = spec.intensity;
    return light;
  });
}

export interface HighwatchManorFlame {
  /** The world-positioned holder (its scale is the flame's size). */
  readonly holder: THREE.Group;
  /** The animated body the scenery flame pass ticks (its own scale breathes). */
  readonly flame: THREE.Mesh;
  readonly core: THREE.Mesh | null;
}

/** The manor's live flames: each the campfire's body and core in a holder sized to its fire
 *  (the scenery pass owns the body's own scale, so the size rides the holder). */
export function highwatchManorFlames(
  seed: number,
  emissiveIntensity: number,
): HighwatchManorFlame[] {
  return HIGHWATCH_MANOR_FLAMES.map((spec) => {
    const { flame, core } = buildCampfireFlame({ emissiveIntensity });
    const holder = new THREE.Group();
    holder.name = 'highwatchManorFlame';
    const at = highwatchManorWorldPoint(spec.x, spec.y, spec.z, seed);
    holder.position.set(at.x, at.y, at.z);
    holder.scale.setScalar(spec.size);
    holder.add(flame);
    return { holder, flame, core };
  });
}
