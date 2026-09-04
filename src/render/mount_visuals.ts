// Rideable-mount view data + the procedural motion math: which VISUALS key a
// sim MountKey renders as, how high the rider sits, and the bob applied to the
// clipless mounts (the hover cycle floats, the griffin canters; the snail
// glides flat). Pure and Node-tested (tests/mount_visuals.test.ts); the
// renderer is a thin consumer. The catalog itself (names, gates, combat
// numbers) is sim content: src/sim/content/mounts.ts.

import type { MountKey } from '../sim/content/mounts';
import { MOUNTS } from '../sim/content/mounts';

/** A lit lamp carried on the mount's own skeleton. The renderer hangs a point
 *  light off `bone` so the flame tracks the lamp through every swing of the
 *  clip, instead of a world-space light chasing the body a frame behind. */
export interface MountLampSpec {
  /** Joint node name in the mount GLB (three names its Bone after it). */
  bone: string;
  /** Lamp centre in that bone's LOCAL space, in MODEL units. The visual's
   *  normalization scale carries it to world, so this stays valid whatever
   *  `height` the manifest gives the mount. */
  offset: readonly [number, number, number];
  /** Light colour, defaulting to the sodium-warm lantern flame. The Chimeglass
   *  Tortoise's spectacle lenses burn cold blue, so this is per-lamp rather
   *  than one constant shared by every mount that carries a light. */
  color?: number;
  /** Peak intensity, defaulting to a storm lantern's. A pair of spectacles is
   *  not a lantern: it should tint the muzzle, not pool light on the ground. */
  intensity?: number;
  /** Falloff radius in world units, defaulting to a storm lantern's. */
  distance?: number;
  /** How the lamp's level moves. A lantern gutters like a wick ('flame', the
   *  default); enchanted glass does not, so the tortoise's lenses hold
   *  'steady'. */
  flicker?: 'flame' | 'steady';
}

/** A soft additive glow billboard carried on the mount's own skeleton: the
 *  bloom-side companion to a MountLampSpec. The lamp casts light on the WORLD;
 *  this is the halo you see on the glass itself, so a mount can have either,
 *  both, or neither. Sprites, so they read from every angle without the pair of
 *  extra lit surfaces a glow shell would cost. */
export interface MountGlowSpec {
  /** Joint node name in the mount GLB (three names its Bone after it). */
  bone: string;
  /** Glow centre in that bone's LOCAL space, in MODEL units: the same frame
   *  MountLampSpec.offset uses, so the two are measured together. Seat it just
   *  CLEAR of the glass it belongs to: a billboard buried inside opaque
   *  geometry is depth-clipped down to whatever ring pokes out. */
  offset: readonly [number, number, number];
  /** Halo radius in MODEL units (the visual's normalization scale carries it). */
  radius: number;
  /** Core colour. */
  color: number;
  /** Peak opacity at the top of the breath. */
  opacity: number;
  /** How deep the breath runs, 0 = a steady glow, 1 = all the way to dark. */
  pulse?: number;
  /** Breaths per second. */
  pulseHz?: number;
}

/** How the rider SITS on this mount. Every mount used to share the floor-sit
 *  loop, which reads fine in a chair (the Lanternback's throne) and wrong
 *  astride a broad back: the legs stay folded in front of the rider and his
 *  weight floats above the saddle instead of resting on it. A mount that wants
 *  a straddle names the angles here and the rider's rig poses its legs to them
 *  over the seated base (characters/visual.ts setRidePose, which explains why
 *  the legs are an override and everything else stays additive). Radians; null
 *  keeps the plain seat. */
export interface MountRideSpec {
  /** Thigh abduction from vertical, outward. This is the whole point: it is
   *  what makes a straddle. Measured in the pelvis frame, so 0 hangs the leg
   *  straight down the flank and 0.42 opens it 24 degrees over the barrel. */
  spread: number;
  /** Thigh flexion from vertical, FORWARD (knees toward the mount's head). */
  thigh: number;
  /** Knee bend off the thigh's line; the shin swings back under the rider.
   *  `thigh - knee` is the shin's own pitch, so knee slightly over thigh hangs
   *  the shin plumb down the flank. */
  knee: number;
  /** Ankle angle in the shin's frame; negative points the toes down. */
  ankle?: number;
  /** Pelvis pitch, positive = tipped forward. The floor-sit base leans ~20
   *  degrees BACK (it is a lounging pose), which reads as slouching astride a
   *  mount, so this is an absolute override rather than an offset. */
  hips?: number;
  /** Extra chest pitch ON TOP of the clip, positive = forward. Additive, so
   *  the torso keeps breathing with the seated loop. */
  lean?: number;
}

/** A seat carried on the mount's own skeleton, for mounts whose saddle MOVES
 *  relative to the body (the Lanternback's throne rolls and pitches with his
 *  shoulders). The rider is parented to the bone instead of floating at a fixed
 *  lift, so his weight stays on the seat through the whole cycle rather than
 *  the seat sliding through him. */
export interface MountSeatSpec {
  /** Joint node name in the mount GLB (three names its Bone after it). */
  bone: string;
  /** Where the rider's ROOT sits in that bone's local space, in MODEL units, so
   *  it survives any `height` the manifest normalizes the mount to. */
  offset: readonly [number, number, number];
}

export interface MountVisualSpec {
  /** Tip nose-up on a jump and right itself before landing (see
   *  mount_jump_attitude). Vehicles only: a creature's legs already absorb a
   *  launch, and pitching one reads as a bug. */
  jumpTips: boolean;
  /** VISUALS key (src/render/characters/manifest.ts, lazyPreload). */
  visualKey: string;
  /** World-unit rider lift onto the saddle at e.scale = 1. */
  seat: number;
  /** World-unit rider shift along facing (negative = toward the tail) for
   *  mounts whose saddle sits off the model origin (the toad's is well back). */
  seatFwd: number;
  /** Carries baked Idle/Walk/Run gait clips (scripts/bake_mount_gaits.mjs).
   *  The clipless rest render their generated standing pose and move via the
   *  bob below. */
  rigged: boolean;
  /** Procedural bob amplitude in world units (0 = none). */
  bobAmp: number;
  /** Bob frequency in cycles per second. */
  bobHz: number;
  /** Bob even while standing (the hover cycle floats in place). */
  bobIdle: boolean;
  /** Bob shape: a smooth hover sine, or gallop-style hops (abs sine). */
  bobShape: 'hover' | 'hop';
  /** Ambient particle effect the renderer emits for this mount: the snail's
   *  slime path while moving, the hover cycle's aether exhaust. */
  fx: 'slime' | 'exhaust' | null;
  /** Lit lamps carried on the rig (empty for every mount that carries none). */
  lamps: readonly MountLampSpec[];
  /** Seat bone the rider is anchored to, or null to sit at the fixed `seat`
   *  lift (every mount whose saddle does not move under the rider). */
  seatBone: MountSeatSpec | null;
  /** Additive glow billboards carried on the rig (empty for every mount that
   *  glows nowhere). */
  glows: readonly MountGlowSpec[];
  /** Straddle pose for the rider, or null to keep the plain seated loop. */
  ride: MountRideSpec | null;
}

const spec = (
  visualKey: string,
  seat: number,
  rigged: boolean,
  bob?: { amp: number; hz: number; idle?: boolean; shape?: 'hover' | 'hop' },
  seatFwd = 0,
  fx: 'slime' | 'exhaust' | null = null,
  lamps: readonly MountLampSpec[] = [],
  seatBone: MountSeatSpec | null = null,
  // Two rarely-set fields ride an options bag rather than extending an already
  // eight-long positional list: at that length every new call site has to count
  // `undefined`s to reach the argument it actually wants to set.
  extra: { glows?: readonly MountGlowSpec[]; ride?: MountRideSpec; jumpTips?: boolean } = {},
): MountVisualSpec => ({
  visualKey,
  seat,
  seatFwd,
  rigged,
  bobAmp: bob?.amp ?? 0,
  bobHz: bob?.hz ?? 0,
  bobIdle: bob?.idle ?? false,
  bobShape: bob?.shape ?? 'hop',
  fx,
  lamps,
  seatBone,
  glows: extra.glows ?? [],
  ride: extra.ride ?? null,
  jumpTips: extra.jumpTips ?? false,
});

// The Lanternback's two storm lanterns. Each hangs from the TOP of its chain
// (the bone head), so the offset is measured straight down the bone to the
// lamp's glass: 0.681 model units of a 1.02-unit bone. The two chains are
// identical, hence one shared offset.
const LANTERN_LAMP_OFFSET = [0.005, 0.681, -0.007] as const;

// Midpoint of the Chimeglass Tortoise's two spectacle lenses, measured in the
// `lens` bone's local space (the lens centres are x -0.0954 and +0.0733; the
// bone is only 0.042 long, so this sits well off its axis).
//
// ONE light for the pair, not one each. Two lights 0.17 model units apart,
// riding the head of the mount the camera is sitting on, are by construction
// the two nearest dynamic lights on screen, and the point-light budget ranks
// purely by distance to the player: a pair would permanently evict two world
// lights to deliver a glow the emissive `lens_Glow` material already carries.
const LENS_LAMP_OFFSET = [-0.0111, 0.0079, 0.011] as const;

// Where each lens HALO sits, same `lens`-bone local frame, read out of the
// shipped GLB rather than eyeballed: a vertex rigid-bound to joint j rests at
// inverseBind_j * v, so the two lens vertex clusters give their own centres
// (-0.0954, 0.0046, 0.0139) and (0.0733, 0.0111, 0.0081), whose midpoint IS
// LENS_LAMP_OFFSET above, which is what proves the frame. Each is then pushed
// clear of its own glass along the mount's forward axis, which lands in this
// bone's space at (0, 0.836, -0.549): the lenses bulge 0.026 forward of centre,
// so a halo seated ON the centre would be depth-clipped by the glass in front
// of it and only the outer ring would survive.
const LENS_GLOW_L = [-0.0954, 0.0345, -0.0057] as const;
const LENS_GLOW_R = [0.0733, 0.037, -0.0089] as const;
/** Lens lateral radius is 0.066 model units; the halo carries a little past the
 *  rim so the glass reads as lit from within rather than painted. */
const LENS_GLOW_RADIUS = 0.105;

/** Default colour of a carried lamp's point light: sodium-warm, matching the
 *  emissive `lantern_glow` material baked into the Lanternback's GLB. Lamps may
 *  override it (MountLampSpec.color). */
export const MOUNT_LAMP_COLOR = 0xff8c32;
/** The Chimeglass Tortoise's spectacles: the same blue his `lens_Glow` material
 *  is authored at, so the cast light and the glass agree. */
export const MOUNT_LENS_COLOR = 0x3d8cff;
/** Base intensity. Above a wall torch (castle_features uses 4 at 13) on purpose:
 *  these are the mount's whole identity, they hang high on a 7-unit creature, and
 *  a lamp that only lit the throne it hung from was not worth carrying. */
export const MOUNT_LAMP_INTENSITY = 6.5;
/** Falloff radius in world units. Sized against the Lanternback at height 7.0,
 *  whose lamps hang about 5 units up and 1.7 apart: they should pool light on the
 *  ground around him, not stop at the throne. */
export const MOUNT_LAMP_DISTANCE = 17;

/** The Chimeglass Tortoise's spectacles: cold blue, far dimmer and tighter
 *  than a storm lantern (lit glasses on a low creature should read as eyes,
 *  not floodlight the road), and STEADY, because enchanted glass has no wick
 *  to gutter. */
const LENS_LAMP = {
  color: MOUNT_LENS_COLOR,
  intensity: 2.6,
  distance: 6.5,
  flicker: 'steady',
} as const;

/** The spectacle halos. STEADY is right for the cast light, enchanted glass
 *  has no wick to gutter, but a halo that never moves at all reads as a decal
 *  painted on the lens, so this one breathes: slow, shallow, and well under the
 *  rate a flame flickers at. */
const LENS_GLOW = {
  color: MOUNT_LENS_COLOR,
  opacity: 0.85,
  pulse: 0.28,
  pulseHz: 0.32,
  radius: LENS_GLOW_RADIUS,
} as const;

export const MOUNT_VISUAL_SPECS: Record<MountKey, MountVisualSpec> = {
  // seat tuned to the authored horse model: its saddle sits forward of the
  // origin and lower than the old Tripo build, so the rider shifts toward the
  // neck and drops a touch
  valorsteed: spec('mount_valorsteed', 2.4, true, undefined, 0.15),
  grag_bear: spec('mount_grag_bear', 3.35, true, undefined, -0.8),
  stalkglider_snail: spec('mount_stalkglider_snail', 2.65, false, undefined, -0.3, 'slime'),
  aether_hover_cycle: spec(
    'mount_aether_hover_cycle',
    2.1,
    false,
    { amp: 0.14, hz: 1.1, idle: true, shape: 'hover' },
    0,
    'exhaust',
  ),
  shadowjump_toad: spec('mount_shadowjump_toad', 2.52, true, undefined, -0.5),
  // gait-rigged by bake_mount_gaits.mjs (buildPropRig): real Walk/Run clips
  // replaced the old procedural canter hop
  stormfeather_griffin: spec('mount_stormfeather_griffin', 2.75, true),
  // ships its authored strut cycle as Walk/Run plus a baked breathing Idle;
  // the saddle sits over the hips, behind the neck (hence the rear shift)
  thunderstrut_gobbler: spec('mount_thunderstrut_gobbler', 2.05, true, undefined, -0.15),
  // Compact tracked vehicle with an authored rider socket behind the turret.
  // Its rigid-body clips animate the suspension and track wheels without a
  // procedural bob, keeping the pilot locked to the saddle.
  terrorspark_groundshaker: spec('mount_terrorspark_groundshaker', 2.38, true, undefined, -0.3),
  // The Drakemaw Raptor: authored saddle sits over the hips behind the neck
  // spines (hence the slight rear shift), gait-rigged Walk/Run cycles.
  drakemaw_raptor: spec('mount_drakemaw_raptor', 2.35, true, undefined, -0.1),
  // The Cluckwork Mech Bird: authored rigid-servo clips (no procedural bob,
  // the clips carry the motion). Saddle surface sits at 0.60 of the raw model
  // (x3.4 height), dead over the origin, so no fore/aft shift.
  mech_bird: spec('mount_mech_bird', 2.05, true),
  // The Lanternback Troll: the rider sits IN the iron throne strapped across
  // his shoulders, not astride a back, so the seat is high and set BEHIND the
  // model origin. `seat`/`seatFwd` here are only the FALLBACK and the anchor the
  // nameplate rides; the rider's actual position comes from the chair bone
  // below. Both were fitted at height 5.0 (pan 3.656 above ground, sit-pose hip
  // 0.087 above the root) and then carried to the 40% larger height 7.0.
  // No procedural bob: the authored lope carries the whole bounce.
  lanternback_troll: spec(
    'mount_lanternback_troll',
    5.15,
    true,
    undefined,
    -0.36,
    null,
    [
      { bone: 'lantern_l', offset: LANTERN_LAMP_OFFSET },
      { bone: 'lantern_r', offset: LANTERN_LAMP_OFFSET },
    ],
    // The throne rides his shoulders, so it rolls and pitches with every stride:
    // a rider held at a fixed lift gets slid through by it. Anchoring to the
    // chair bone keeps him planted in the seat instead. Offset measured in
    // Blender: the seat pan sits (0, 0.89, 0.25) from the bone head, and the
    // rider's root rides a hair above the pan so the sit pose's hips carry his
    // weight onto it.
    { bone: 'chair', offset: [0, 0.918, 0.25] },
  ),
  // The Chimeglass Tortoise: a low, broad carapace, so the rider sits astride
  // the shell rather than in a chair. No procedural bob, his authored plod
  // carries what little bounce a tortoise has, and his legs rest 99.6%
  // extended, which is why the clips keep the torso deliberately still.
  chimeglass_tortoise: spec(
    'mount_chimeglass_tortoise',
    2.05,
    true,
    undefined,
    -0.1,
    null,
    // One light behind each storm-glass lens, measured in the `lens` bone's
    // local space. Dimmer and tighter than a lantern: spectacles should tint
    // his muzzle and the rider's knees, not floodlight the road.
    [{ bone: 'lens', offset: LENS_LAMP_OFFSET, ...LENS_LAMP }],
    // The shell rolls under the rider with every stride, so anchor him to it
    // rather than to a fixed lift. Measured in Blender off the `saddle` bone,
    // whose head sits at (0, -0.02, 0.500); in its local frame +Y runs up the
    // bone and -Z runs toward the tail.
    //
    // Re-fitted for the straddle, then moved BACK off his head. The carapace's
    // midline is a dome cresting at 0.557 near y -0.06 and falling to 0.494 by
    // y +0.04, so a seat moved back has to drop by the same amount or the rider
    // floats: 0.06 back and 0.012 up holds him exactly 0.017 above the hide,
    // the same contact the crown seat had.
    //
    // The distance that actually mattered is his SKULL to the mount's crest.
    // Measured over every clip with the rider carried on this bone (he pitches
    // with the shell, so a fixed-point test wrongly condemns the rear-up): the
    // old crown seat left Idle at +0.000, grazing, which is exactly the
    // "his face clips the head at the end of the idle" report, and six of the
    // seven clips negative. With the reclined pelvis below, this seat clears
    // every clip: Idle +0.132, Walk +0.120, Run +0.051, Idle_Rear +0.074.
    //
    // The last 0.025 back / 0.008 down also settles him INTO the hide rather
    // than onto it: his root now sits 0.0025 below the carapace surface
    // beneath it, where the crown seat perched 0.0172 clear of it.
    { bone: 'saddle', offset: [0, 0.004, -0.085] },
    {
      glows: [
        { bone: 'lens', offset: LENS_GLOW_L, ...LENS_GLOW },
        { bone: 'lens', offset: LENS_GLOW_R, ...LENS_GLOW },
      ],
      // He is a low, broad carapace with no saddle horn, so the rider grips
      // him with his knees, high and wide, the way you sit a boulder. The
      // spread is deliberately past what a horse would take: the shell is 0.11
      // model units wide even at the crown against a 0.104-unit leg, so
      // anything less leaves both legs inside the silhouette and he reads as
      // sunk into the shell rather than sat on it. The knee stays open for the
      // same reason, a tucked shin disappears behind the dome.
      //
      // The PELVIS is what put his face in the mount's crest, not the seat.
      // Pitching it upright-and-forward (+0.06 with a 0.10 chest lean) threw
      // his head joint 0.237 rig-units FORWARD of his root, against -0.126 for
      // the seated clip, further than any seat shift moves him, which is why
      // sliding the seat alone never cleared it. -0.18 is a relaxed 10 degree
      // recline, still half of the floor-sit's 20, and it buys 0.223 units of
      // headroom. `thigh` carries +0.18 to match, so the legs land exactly
      // where they did before the pelvis moved.
      ride: { spread: 0.68, thigh: 0.8, knee: 0.6, ankle: -0.45, hips: -0.18 },
    },
  ),
  // Bonebound Rickshaw: ships no baked clips (its wheels roll procedurally from
  // rickshaw_mount.ts's spinMountWheels), so the body gets a light procedural jostle
  // instead of a gait cycle. seat/seatFwd are the authored bench-seat socket
  // at the cart's own RICKSHAW_SCALE (2.0).
  // 2026-08-09: this `seat` value (1.94) was stale, still reflecting the
  // ORIGINAL pre-cushion socket (local Y 0.97), never updated when the socket
  // itself moved to local Y 1.12 for the tufted seat cushion (see
  // model.js's RICKSHAW_SOCKET_DEFINITIONS, "raised from v1's 0.97 to sit on
  // top of the new seat cushion"). A live look confirmed exactly this: rider
  // sitting low enough to clip into the cushion. Corrected to 1.12 * 2 = 2.24
  // to match the socket that's actually been shipping.
  // `rigged` stays false rather than true, even though this mount is now
  // procedurally animated (the wheels) rather than fully static, so it still
  // gets the procedural bob other clipless mounts get. What the flag buys
  // elsewhere is the convention that a rigged mount's clips carry ALL its
  // motion, and this one cannot follow that: the renderer applies the
  // procedural bob to the rider and, because the puller rig is parented
  // inside the mount, to the puller too. Baking a body bob into clips would
  // bob the cart WITHOUT the puller, swinging the shaft harness collar +-0.05
  // against a belt overlap with only 0.034 of margin, and the harness would
  // visibly come off his waist every cycle.
  // jumpTips: a two-wheeled cart with no suspension and no legs. It tips
  // nose-up off a jump and rights itself before landing; the puller rides that
  // rotation with it, keeping the shafts in its hands.
  rickshaw_mount: spec(
    'mount_rickshaw_mount',
    2.24,
    false,
    { amp: 0.05, hz: 2.4 },
    -0.3,
    null,
    [],
    null,
    { jumpTips: true },
  ),
};

/** Spec for an entity's active mountKey, or null when dismounted/unknown. */
export function mountVisualSpec(mountKey: string): MountVisualSpec | null {
  return mountKey in MOUNTS ? MOUNT_VISUAL_SPECS[mountKey as MountKey] : null;
}

/** World-unit rider lift for the active mountKey ('' or unknown: 0). */
export function mountSeatLift(mountKey: string): number {
  return mountVisualSpec(mountKey)?.seat ?? 0;
}

/**
 * Flame flicker for one carried lamp, as a multiplier on that lamp's own peak
 * intensity (MountLampSpec.intensity, or MOUNT_LAMP_INTENSITY by default).
 *
 * Two detuned sines per lamp rather than noise: it is deterministic (so the
 * headless tests can pin it), allocation-free on the hot path, and never
 * repeats visibly because the two periods are incommensurate. `index` detunes
 * the pair per lamp so the left and right lanterns never pulse in lockstep,
 * which is what gives away a scripted flicker. Bounded to [0.78, 1.14]: a lamp
 * that guttered to zero would pop the point-light budget's shine decision on
 * and off, and one that spiked would bloom.
 */
export function mountLampFlicker(timeSec: number, index: number): number {
  const phase = index * 2.399;
  const a = Math.sin(timeSec * 7.3 + phase);
  const b = Math.sin(timeSec * 11.9 + phase * 1.7);
  return 0.96 + 0.12 * a + 0.06 * b;
}

/**
 * Breath level for one carried glow, as a multiplier on that glow's own peak
 * opacity (MountGlowSpec.opacity). Deterministic and allocation-free, same as
 * the flicker above, and pure so tests/mount_visuals.test.ts can pin it.
 *
 * This is NOT the flicker with different numbers. A flame gutters, fast,
 * jittery, two incommensurate periods so it never reads as a loop. Enchanted
 * glass swells and fades on one slow, clean sine, and the whole point is that
 * it stays legible as a rhythm. `index` offsets the pair by a QUARTER cycle,
 * not an irrational phase: a pair of lenses breathing in exact lockstep looks
 * mechanical, and a pair with no relationship at all looks broken.
 *
 * `depth` 0 returns a flat 1 (a steady glow), and the result never drops below
 * `1 - depth`, so a glow can dim but never blink out.
 */
export function mountGlowBreath(timeSec: number, index: number, depth: number, hz: number): number {
  if (depth <= 0 || hz <= 0) return 1;
  const phase = index * 0.25;
  const wave = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (timeSec * hz + phase));
  return 1 - depth * (1 - wave);
}

/** Procedural vertical offset for a clipless mount at time t (seconds). */
export function mountBobY(spec: MountVisualSpec, timeSec: number, moving: boolean): number {
  if (spec.bobAmp <= 0) return 0;
  if (!moving && !spec.bobIdle) return 0;
  const wave = Math.sin(timeSec * Math.PI * 2 * spec.bobHz);
  return (spec.bobShape === 'hover' ? wave : Math.abs(wave)) * spec.bobAmp;
}
