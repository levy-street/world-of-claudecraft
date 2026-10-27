// The Smith's Heart's air and light per area (the renderer's fog scene state
// and interior light rig dispatch here, the way the Ignivar raid's rooms do):
//   - the Hammer vein (the Cleft, the Gallery, the Quarry, the Slab) has
//     its own state, `smithHeartHammer`: a warm dusty quarry dusk, the low
//     sun raking in from the west down the fissure so the colossi's faces
//     catch it across the pit, a warm sky and a warmer bounce off the cut
//     stone, quarry dust thickening the distance (phase 2B);
//   - the Ring (round the seal) has its own, `smithHeartRing` (phase 2F): the
//     same low warm sun over a neutral grey sky fill, so its shade is a cool
//     grey and never the storm's saturated blue;
//   - the Breath (north, climbing to the Storm Cornice) has its own,
//     `smithHeartBreath` (phase 2G): a cold teal-white storm light breaking
//     high through the cloud from the north-west over a pale neutral grey
//     fill, a cool blue-grey storm air that thickens with distance, so the
//     scoured granite reads pale and its shade a cool grey, never navy;
//   - the Quench (east, sinking to the Frozen Lake) has its own,
//     `smithHeartQuench` (phase 2H): a pale cold sun low in the south-east
//     through a thin high overcast, a pale blue-grey sky fill over a cool
//     ground bounce, a cold pale-blue mist that softens the far walls, so the
//     frost and the ice read pale and clean and the braziers' fire is the one
//     warm thing in it;
//   - the Heat (west, the Hearth) has its own, `smithHeartHeat` (phase 2I):
//     a warm white-gold key low from the west, the Hearth's own light down
//     the fissure, over a smoky warm-grey sky fill and a warm ground bounce
//     (the fire under the floors), a smoke haze that thickens with distance,
//     so the sooted basalt reads dark and warm, never black, and the first
//     flame's crystal burns against it;
//   - whatever of the main map no vein's light holds keeps the storm-dusk
//     grade it shares with the Sunken Bastion (`sunkenBastion`);
//   - the Heart (the separate final room) gets its own state,
//     `smithHeartCore`: an ember-violet night air, nearer than the storm's so
//     the chamber's crown closes round the platform, and a light rig lit from
//     BELOW (the hemisphere's ground colour is the heart's gold), a pale key
//     from high over the oculus and a warm rim on every silhouette.
// The area is the camera's (the frame resolves the fog from the camera), read
// in the slot's own frame.
//
// Three-free, DOM-free, deterministic.

import { inSmithHeartRoom, RING, smithHeartAreaAt } from '../../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';

/** The fog state of the Heart. */
export const SMITH_HEART_CORE_FOG_STATE = 'smithHeartCore';

/** Is the camera at world (x, z) inside the Heart of its Smith's Heart slot? */
export function smithHeartCameraInHeart(x: number, z: number): boolean {
  const def = DUNGEONS.smith_heart;
  if (!def) return false;
  const o = instanceOrigin(def.index, instanceSlotForZ(z));
  return inSmithHeartRoom(x - o.x, z - o.z);
}

/** The fog state of the Hammer vein. */
export const SMITH_HEART_HAMMER_FOG_STATE = 'smithHeartHammer';

/** Is the camera at world (x, z) in the Hammer vein of its Smith's Heart slot?
 *  (The Breath's own light wins north of the Ring, phase 2G.) */
export function smithHeartCameraInHammer(x: number, z: number): boolean {
  const def = DUNGEONS.smith_heart;
  if (!def) return false;
  const o = instanceOrigin(def.index, instanceSlotForZ(z));
  return smithHeartAreaAt(x - o.x, z - o.z) === 'hammer' && !inBreathLight(x - o.x, z - o.z);
}

/** The fog state of the Ring (phase 2F). */
export const SMITH_HEART_RING_FOG_STATE = 'smithHeartRing';

/** How far from the seal the Ring's air and light reach: past the Ring's
 *  rim, so the play camera standing back from a player at the rim (or at a
 *  vein's mouth) still sees the Ring in its own light. */
export const SMITH_HEART_RING_LIGHT_R = RING.outerR + 26;

/** Is the camera at world (x, z) over the Ring (round the seal) of its
 *  Smith's Heart slot? (The Hammer vein's own state wins on the Balcony.) */
export function smithHeartCameraInRing(x: number, z: number): boolean {
  const def = DUNGEONS.smith_heart;
  if (!def) return false;
  const o = instanceOrigin(def.index, instanceSlotForZ(z));
  return Math.hypot(x - o.x - RING.x, z - o.z - RING.z) <= SMITH_HEART_RING_LIGHT_R;
}

/** The Ring's air (phase 2F): a cool neutral grey, thin across the Ring so
 *  the seal and every vein mouth read crisp, the mountain's far crest
 *  softening into it. Never the borrowed storm's blue (2E's shaded rock read
 *  a saturated navy there). */
export const SMITH_HEART_RING_FOG = { color: 0x686a72, near: 120, far: 700 } as const;

/** The Ring's light rig (phase 2F): the same low warm sun as the Hammer's
 *  quarry (one sky over the mountain), a little higher so it reaches down
 *  onto the Ring's paving and the seal, over a desaturated grey-violet sky
 *  fill and a warm grey bounce: every face turned from the sun falls to a
 *  cool grey, never a saturated blue nor black (the painted world's L1, L6),
 *  the stones' warm tops, the crystal and the rivers read against it. The
 *  sky's reflection is a trace (`env`): the storm sky's blue was what turned
 *  2E's shaded rock navy. */
export const SMITH_HEART_RING_LIGHT = {
  sun: 2.55,
  hemi: 2.35,
  // The storm sky's reflections stay a trace: at the Hammer's 0.15 they
  // washed every shaded face of the rock a saturated navy.
  env: 0.03,
  rim: 1.45,
  sunColor: 0xffdab0,
  hemiSky: 0x989aa8,
  hemiGround: 0x645c56,
  rimColor: 0xffb072,
  keyDirection: [-0.42, 0.72, -0.55] as const,
} as const;

/** The fog state of the Breath (phase 2G). */
export const SMITH_HEART_BREATH_FOG_STATE = 'smithHeartBreath';

/** Does the Breath's light hold at instance-local (x, z)? North of the
 *  Ring past its mouth (a camera standing back from a player on the first
 *  landing or in the chimney stands there), the Breath's light wins over the
 *  Ring's; elsewhere its area outside the Ring's light. */
export function inBreathLight(x: number, z: number): boolean {
  if (x <= -140 || x >= 90 || z <= 64)
    return (
      smithHeartAreaAt(x, z) === 'breath' &&
      Math.hypot(x - RING.x, z - RING.z) > SMITH_HEART_RING_LIGHT_R
    );
  return z > RING.outerR + 22 || Math.hypot(x - RING.x, z - RING.z) > SMITH_HEART_RING_LIGHT_R;
}

/** Is the camera at world (x, z) in the Breath vein of its Smith's Heart
 *  slot? (The Ring's own state keeps the Breath's mouth.) */
export function smithHeartCameraInBreath(x: number, z: number): boolean {
  const def = DUNGEONS.smith_heart;
  if (!def) return false;
  const o = instanceOrigin(def.index, instanceSlotForZ(z));
  return inBreathLight(x - o.x, z - o.z);
}

/** The Breath's air (phase 2G): a cool blue-grey storm air, thin across a
 *  landing and the Cornice so a telegraph and the guardian read crisp, the
 *  far crests going pale into it (the summit stands IN the weather). */
export const SMITH_HEART_BREATH_FOG = { color: 0x707b88, near: 80, far: 560 } as const;

/** The Breath's light rig (phase 2G): the storm's light breaking through
 *  high from the north-west, a cold teal-white key; a pale neutral-grey sky
 *  fill (never the borrowed storm's saturated blue, which turned the
 *  scoured rock navy) over a cool grey ground bounce; a teal rim off the
 *  vein's light on every silhouette. The sky's reflection a trace. */
export const SMITH_HEART_BREATH_LIGHT = {
  sun: 2.65,
  hemi: 2.2,
  env: 0.03,
  rim: 1.5,
  sunColor: 0xe2eef4,
  hemiSky: 0x9aa2ae,
  hemiGround: 0x5e6066,
  rimColor: 0x9ad6ee,
  /** High in the north-west (from the ground toward it): it rakes across
   *  the Cornice's floor toward the bridge, so the rods, the horns and the
   *  guardian throw long shadows south-east down the vein. */
  keyDirection: [-0.42, 0.8, 0.43] as const,
} as const;

/** The fog state of the Quench (phase 2H). */
export const SMITH_HEART_QUENCH_FOG_STATE = 'smithHeartQuench';

/** Does the Quench's light hold at instance-local (x, z)? East of the Ring
 *  past its mouth (a camera standing back from a player on the first
 *  landing stands there), the Quench's light wins over the Ring's;
 *  elsewhere its area outside the Ring's light. */
export function inQuenchLight(x: number, z: number): boolean {
  const ring = Math.hypot(x - RING.x, z - RING.z);
  if (x <= 64 || z >= 64 || z <= -64)
    return smithHeartAreaAt(x, z) === 'quench' && ring > SMITH_HEART_RING_LIGHT_R;
  // The descent starts at the Ring's rim: a camera past it down the mouth
  // already stands in the cold.
  return x > RING.outerR + 10 || ring > SMITH_HEART_RING_LIGHT_R;
}

/** Is the camera at world (x, z) in the Quench vein of its Smith's Heart
 *  slot? (The Ring's own state keeps the Quench's mouth.) */
export function smithHeartCameraInQuench(x: number, z: number): boolean {
  const def = DUNGEONS.smith_heart;
  if (!def) return false;
  const o = instanceOrigin(def.index, instanceSlotForZ(z));
  return inQuenchLight(x - o.x, z - o.z);
}

/** The Quench's air (phase 2H): a cold pale-blue mist, thin across a landing
 *  and the lake so a telegraph and the guardian read crisp, the far walls
 *  and the frozen falls softening into it as the vein sinks. */
export const SMITH_HEART_QUENCH_FOG = { color: 0x8899ac, near: 70, far: 520 } as const;

/** The Quench's light rig (phase 2H): a pale cold sun low in the south-east
 *  through a thin overcast (a white a breath toward blue), a pale blue-grey
 *  sky fill over a cool grey ground bounce (the snow's light back up), so
 *  the frost reads pale and every shade a clean cold blue-grey, never navy;
 *  a pale ice-blue rim off the lake on every silhouette. The sky's
 *  reflection a trace. */
export const SMITH_HEART_QUENCH_LIGHT = {
  sun: 2.15,
  hemi: 1.75,
  env: 0.03,
  rim: 1.35,
  sunColor: 0xe6eef8,
  hemiSky: 0x98a8bc,
  hemiGround: 0x4e5664,
  rimColor: 0xa8d8f2,
  /** Low in the south-east (from the ground toward it): it rakes across the
   *  lake toward the descent, so the blades, the bowls and the guardian
   *  throw long cold shadows north-west, and the frozen falls on the east
   *  walls take it full. */
  keyDirection: [0.56, 0.56, -0.6] as const,
} as const;

/** The fog state of the Heat (phase 2I). */
export const SMITH_HEART_HEAT_FOG_STATE = 'smithHeartHeat';

/** Does the Heat's light hold at instance-local (x, z)? West of the Ring
 *  past its mouth (a camera standing back from a player in the hall stands
 *  there), the Heat's light wins over the Ring's; elsewhere its area outside
 *  the Ring's light. */
export function inHeatLight(x: number, z: number): boolean {
  const ring = Math.hypot(x - RING.x, z - RING.z);
  if (x >= -64 || z >= 64 || z <= -64)
    return smithHeartAreaAt(x, z) === 'heat' && ring > SMITH_HEART_RING_LIGHT_R;
  // The hall starts at the Ring's rim: a camera past it down the mouth
  // already stands in the Hearth's light.
  return x < -(RING.outerR + 10) || ring > SMITH_HEART_RING_LIGHT_R;
}

/** Is the camera at world (x, z) in the Heat vein of its Smith's Heart
 *  slot? (The Ring's own state keeps the Heat's mouth.) */
export function smithHeartCameraInHeat(x: number, z: number): boolean {
  const def = DUNGEONS.smith_heart;
  if (!def) return false;
  const o = instanceOrigin(def.index, instanceSlotForZ(z));
  return inHeatLight(x - o.x, z - o.z);
}

/** The Heat's air (phase 2I): a warm smoke haze, a breath of grey-brown,
 *  thin across the hall and the Forge so a telegraph and the guardian read
 *  crisp, the far walls going into it (never an orange wash: the warm stays
 *  in the light and the fire). */
export const SMITH_HEART_HEAT_FOG = { color: 0x6e645c, near: 80, far: 560 } as const;

/** The Heat's light rig (phase 2I): the Hearth's light, a warm white-gold
 *  key low from the west down the fissure (the guardian and the altar-stone
 *  throw long shadows east toward the door), over a cool slate smoke fill
 *  and a dim umber ground bounce (the fire in the chasm and in the joints),
 *  so every shaded face of the basalt is a cool dark grey, never black nor
 *  a saturated brown, and the warm lives in the key and the fire; a gold
 *  rim off the first flame on every silhouette. The sky's reflection a
 *  trace. */
export const SMITH_HEART_HEAT_LIGHT = {
  sun: 2.45,
  hemi: 2.0,
  env: 0.03,
  rim: 1.7,
  sunColor: 0xffdcae,
  // The smoke's cool slate fill (the painted world's L1: warm key, cool
  // shade; a warm fill washed the whole vein one yellow).
  hemiSky: 0x8a8c9a,
  hemiGround: 0x5c4c42,
  rimColor: 0xffbf6a,
  /** Low in the west (from the ground toward it): the Hearth's side. */
  keyDirection: [-0.72, 0.56, 0.16] as const,
} as const;

/** The Hammer's air: a grey quarry dust, thin near (the pit reads crisp
 *  across) and thickening past the terraces into the fissure's far rock. It
 *  is neutral on purpose (phase 2C): a warm haze washed the whole vein to one
 *  orange-tan, so the warm stays in the sunlight and the vein's own glow. */
export const SMITH_HEART_HAMMER_FOG = { color: 0x6c6c70, near: 90, far: 600 } as const;

/** The Hammer's light rig (phase 2C, the warm-key cool-fill grade of the
 *  Wildheart Basin): a strong warm low key from the south-west (the dusk
 *  down the fissure, raking the terraces), and a COOL slate-violet sky fill
 *  over a warm grey ground bounce, so every face turned from the sun falls
 *  to a cool slate-violet shadow (never black, never a saturated blue: the
 *  painted world's L1) and the lit faces, the vein's ochre glow, the geodes
 *  and the colossi's warm rims read against it. Phase 2D lifted the fill:
 *  under 2C's the fissure's shaded rock sank to a near-black navy that ate
 *  every form (the descent's foreground, the Gallery's walls). */
export const SMITH_HEART_HAMMER_LIGHT = {
  sun: 2.7,
  hemi: 2.35,
  // Phase 2F: a trace of the sky's reflection (at 0.15 the storm sky's blue
  // turned the vein's shaded rock and the Ring seen from the Balcony navy).
  env: 0.03,
  rim: 1.6,
  sunColor: 0xffd3a0,
  hemiSky: 0x9a96aa,
  hemiGround: 0x665a52,
  rimColor: 0xffa858,
  /** Low in the south-west (from the ground toward it): it rakes across
   *  the east terraces as the raid enters (every bench and block throws its
   *  shadow), lights the Vigil from the side and rims the Bearer from
   *  behind. */
  keyDirection: [-0.5, 0.62, -0.6] as const,
} as const;

/** The Heart's fog: an ember-violet dark, pushed back past the platform and
 *  its chasm so the chains read to the crown, closing before the crown's far
 *  side. */
export const SMITH_HEART_CORE_FOG = { color: 0x1c1424, near: 80, far: 520 } as const;

/** The Heart's light rig. */
export const SMITH_HEART_CORE_LIGHT = {
  sun: 1.5,
  hemi: 0.9,
  env: 0.26,
  rim: 2.3,
  sunColor: 0xffe2b8,
  hemiSky: 0x3a2e58,
  /** The heart's gold from below. */
  hemiGround: 0x8a5424,
  rimColor: 0xffc880,
  /** High over the terrace's side of the chasm (from the ground toward it,
   *  phase 2J): the raid crossing the bridge sees the colossus lit, its
   *  back to the crown in shade. */
  keyDirection: [-0.38, 0.8, -0.46] as const,
} as const;
