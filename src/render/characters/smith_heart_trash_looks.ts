// The Smith's Heart's own trash and add bodies (docs/design/raid/smith_heart.md section 1's
// body rows; sources docs/design/raid/kit/raid_mobs_src/): the fourteen the blockout still
// borrowed, each a ChatGPT turnaround sheet in the raid's painted style, a Tripo P2 build kept
// low (about 2,900 to 5,500 triangles), its atlas repainted in ChatGPT with a glow map of its
// own (its cracks, eyes, cores and crystals hot, going out as it dies), and a rig of rigid
// plates on one welded skin (every plate on one bone, only the seam vertices shared, so no seam
// opens into a gap), the Quench's trash's pipeline. manifest.ts merges SMITH_HEART_TRASH_LOOKS
// into VISUALS; smith_heart_placeholder_looks.ts points each template at its key.
//
// Looks only: every template keeps its scale, reach, speed and abilities. The drawn height is
// the look's own (the melee warders and the Gale Sentinel at the Quench Vein Warder's size, the
// Splinters two and a half players tall). walkRef and runRef are each clip's measured
// planted-foot speed on the 2.2 tall rig carried to the drawn size, so the feet never slide;
// the floating casters' are the Quench Vein Caller's.
//
// What moves them: the plain swings and the arc cleaves (brood_cleave) as every mob's; the
// bolts, the mend and the Splinters' bars as casts locked to their bars (castClipSync,
// castTimeScaleByAbility puts each key pose on the bar's end); the rises (their Entrance, out of
// the floor), the Wellkeeper's Kindling Mark, the Heat Splinter's coal and the Splinters' flares
// through smith_heart_fx/trash_gestures.ts, whose ids are trash_gestures_core.ts's.

import { SMITH_HEART_CASTS } from '../../sim/content/smith_heart';
import { ISLE_CASTS } from '../../sim/encounters/smith_heart/breath_isle_ids';
import {
  FINAL_PHASE_CASTS,
  FINAL_PHASE_CUES,
} from '../../sim/encounters/smith_heart/final_phase_ids';
import { HEAT_CUES } from '../../sim/encounters/smith_heart/heat_ids';
import { ARC_CLEAVE_ABILITY } from '../smith_heart_fx/hammer_fx_core';
import { SMITH_HEART_TRASH_RISE } from '../smith_heart_fx/trash_gestures_core';
import type { ClipMap, VisualDef } from './manifest';

const CREATURES = 'models/creatures';

/** The rig every body was built on: 2.2 units tall. */
const RIG_HEIGHT = 2.2;

/** A clip's planted-foot speed (rig units/s) carried to a body drawn `height` tall at the
 *  template's `scale`. */
function gaitRef(rigSpeed: number, height: number, scale: number): number {
  return Math.round(rigSpeed * (height / RIG_HEIGHT) * scale * 100) / 100;
}

/** The standing, moving and reacting clips every body ships under these names. */
const BASE_CLIPS = {
  idle: 'Idle',
  idleVariants: ['IdleFidget'],
  combatIdle: 'CombatIdle',
  stunned: 'Stunned',
  turn: 'Turn',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack', 'Attack2'],
  hit: ['Hit', 'Hit2'],
  death: 'Death',
} satisfies Partial<ClipMap>;

/** A body that climbs out of the floor as it arrives: the rise gesture plays its Entrance once,
 *  taking the rig at once (it starts out of sight) and never cut short by a swing. */
const RISES = {
  entranceGesture: SMITH_HEART_TRASH_RISE,
  oneShotsHoldAttacks: ['Entrance'],
} satisfies Partial<VisualDef>;
const RISE_CLIPS = { entrance: 'Entrance', castSnapIn: ['Entrance'] } satisfies Partial<ClipMap>;

/** A melee warder: two swings and the template's arc cleave, every blow landing at 1.0 s, its
 *  cracks flaring as the cleave lands. */
function warder(
  name: string,
  height: number,
  scale: number,
  walk: number,
  run: number,
  extra: Partial<VisualDef> = {},
  clips: Partial<ClipMap> = {},
): VisualDef {
  return {
    url: `${CREATURES}/${name}.glb`,
    height,
    clips: {
      ...BASE_CLIPS,
      idleVariantCadence: { everySec: 18, jitterSec: 12 },
      attackByAbility: { [ARC_CLEAVE_ABILITY]: 'Cleave' },
      contacts: { Attack: [1.0], Attack2: [1.0], Cleave: [1.0] },
      ...clips,
    },
    attackTimeScale: 1,
    deathTimeScale: 1,
    turnRate: 3,
    walkRef: gaitRef(walk, height, scale),
    runRef: gaitRef(run, height, scale),
    gaitWindDown: true,
    authoredAtlas: true,
    glowPulses: {
      pulses: [
        { gesture: ARC_CLEAVE_ABILITY, delay: 0.8, rise: 0.15, hold: 0.25, fall: 0.8, peak: 2.2 },
      ],
      deathFade: 2.5,
    },
    ...extra,
  };
}

/** A floating caster on the Quench Vein Caller's plan: a light melee (contacts 0.62 and 0.66)
 *  and its bolt drawn between its hands and flung on the 2 s bar's end. */
function caster(
  name: string,
  height: number,
  bolt: string,
  extra: Partial<VisualDef> = {},
  clips: Partial<ClipMap> = {},
  casts: Record<string, string> = {},
): VisualDef {
  return {
    url: `${CREATURES}/${name}.glb`,
    height,
    clips: {
      ...BASE_CLIPS,
      idleVariantCadence: { everySec: 16, jitterSec: 10 },
      contacts: { Attack: [0.62], Attack2: [0.66] },
      cast: 'CastBolt',
      castByAbility: { [bolt]: 'CastBolt', ...casts },
      castPlayOut: ['CastBolt'],
      ...clips,
    },
    castClipSync: [bolt],
    attackTimeScale: 1,
    deathTimeScale: 1,
    turnRate: 3,
    // It floats on its robe: no foot can slide (the Quench Vein Caller's refs).
    walkRef: 3.5,
    runRef: 7,
    gaitWindDown: true,
    authoredAtlas: true,
    glowPulses: { pulses: [], deathFade: 2 },
    ...extra,
  };
}

const C = FINAL_PHASE_CASTS;
const Q = FINAL_PHASE_CUES;

/** A Splinter of the Masterless Strength: a hunched shard-brute (a crystal blade for one
 *  forearm, a stone fist for the other, a core in its chest) drawn 2.8 at its template's scale.
 *  It climbs out of its quarter over the 2.5 s rise; Shearing Blow raises the blade through the
 *  2 s bar and cleaves on its end, the cracks flaring as it lands. */
function splinter(
  name: string,
  scale: number,
  casts: Record<string, string> = {},
  rates: Record<string, number> = {},
  extra: Partial<VisualDef> = {},
  clips: Partial<ClipMap> = {},
): VisualDef {
  const height = 2.8;
  const byAbility = { [C.shear]: 'Shear', ...casts };
  return {
    url: `${CREATURES}/${name}.glb`,
    height,
    clips: {
      ...BASE_CLIPS,
      ...RISE_CLIPS,
      idleVariantCadence: { everySec: 20, jitterSec: 12 },
      contacts: { Attack: [1.0], Attack2: [1.0] },
      castByAbility: byAbility,
      castTimeScaleByAbility: { [C.shear]: 1, ...rates },
      castPlayOut: Object.values(byAbility),
      ...clips,
    },
    ...RISES,
    castClipSync: Object.keys(byAbility),
    // A plain swing never cuts a bar or its play-out: the Hammer's Shearing Blow lands as
    // physical damage the tick its bar ends, which would start one over the cleave's landing.
    castPlayOutHoldsAttacks: true,
    attackTimeScale: 1,
    deathTimeScale: 1,
    turnRate: 3,
    walkRef: gaitRef(0.62, height, scale),
    runRef: gaitRef(3.0, height, scale),
    gaitWindDown: true,
    authoredAtlas: true,
    glowPulses: {
      pulses: [{ gesture: Q.shear, rise: 0.08, hold: 0.2, fall: 0.9, peak: 2.4 }],
      deathFade: 2.5,
    },
    ...extra,
  };
}

export const SMITH_HEART_TRASH_LOOKS: Record<string, VisualDef> = {
  // ---- the Ring ---------------------------------------------------------------------------
  // The Ring Forge Warder: the Ring's sentinel, a golem of weathered pale granite blocks bound
  // in bronze, a violet rune stone on its shoulder. Forge Sweep swings Cleave.
  smith_heart_ring_warder: warder('heart_ring_warder', 3.6, 1.8, 0.587, 1.564),

  // ---- the Breath ---------------------------------------------------------------------------
  // The Breath Vein Warder: storm-blue slate plates split by lightning, a crest of storm crystal
  // on its shoulders. Gale Sweep swings Cleave.
  smith_heart_breath_warder: warder('heart_breath_warder', 4.0, 1.6, 0.617, 1.569),
  // The Breath Vein Caller: a hovering hooded storm caller of slate and lightning, a storm orb
  // over each palm, its robe tapering to a point. Gale Bolt locked to the 2 s bar.
  smith_heart_breath_caller: caster('heart_breath_caller', 3.6, SMITH_HEART_CASTS.galeBolt),
  // The Gale Sentinel, warden of a floating isle: tall lean slate with cyan light in its seams,
  // an island-rock shield on its left forearm, a crystal blade for its right. It rises onto its
  // isle with its Mender, lands and plants its shield. Gale Sweep swings Cleave.
  smith_heart_gale_sentinel: warder(
    'heart_gale_sentinel',
    3.4,
    1.9,
    0.65,
    1.63,
    { ...RISES },
    { ...RISE_CLIPS },
  ),
  // The Gale Mender: a floating wind caller of pale storm feathers who mends the guardian's
  // Bulwark. It rises onto its isle and unfurls; Mending Gale holds CastMend, its two pushes a
  // loop, through the channel; Gale Bolt locked to its bar.
  smith_heart_gale_mender: caster(
    'heart_gale_mender',
    3.0,
    SMITH_HEART_CASTS.galeBolt,
    { ...RISES },
    { ...RISE_CLIPS },
    { [ISLE_CASTS.mending]: 'CastMend' },
  ),

  // ---- the Heat -----------------------------------------------------------------------------
  // The Heat Vein Warder: sooted basalt plates over molten seams, a white-gold crystal crown.
  // Ember Sweep swings Cleave.
  smith_heart_heat_warder: warder('heart_heat_warder', 3.8, 1.7, 0.587, 1.564),
  // The Heat Vein Caller: a hovering caster of cracked basalt and molten fire, an ember orb over
  // each palm. Ember Bolt locked to the 2 s bar.
  smith_heart_heat_caller: caster('heart_heat_caller', 3.6, SMITH_HEART_CASTS.emberBolt),
  // The Wellspawn, a child of the first flame: a squat basalt imp with big glowing eyes and a
  // white-gold chest core. It climbs over the Hearth's rim and waddles to the wellspring
  // (walked by the encounter at 3 yd/s and slower as it weakens: its gait runs from 2 yd/s, a
  // bouncing scamper; slower it waddles). It never swings, but ships the jab and the hopping
  // uppercut a ClipMap needs (contacts at 0.6).
  smith_heart_wellspawn: {
    url: `${CREATURES}/heart_wellspawn.glb`,
    height: 2.4,
    clips: {
      ...BASE_CLIPS,
      ...RISE_CLIPS,
      idleVariantCadence: { everySec: 12, jitterSec: 8 },
      contacts: { Attack: [0.6], Attack2: [0.6] },
    },
    ...RISES,
    attackTimeScale: 1,
    deathTimeScale: 1,
    turnRate: 4,
    walkRef: gaitRef(0.66, 2.4, 1.4),
    runRef: gaitRef(1.5, 2.4, 1.4),
    gait: { runEnter: 2.0, runExit: 1.6 },
    gaitWindDown: true,
    authoredAtlas: true,
    glowPulses: { pulses: [], deathFade: 2 },
  },
  // The Wellkeeper: a hulking basalt brute split by molten seams, its belly a burning star. It
  // claws its way up out of the floor by the wellspring; a big two-fisted sweep joins its
  // swings. Kindling Mark (its beam to the player, claimed by the fight's effects) plays CastMark
  // at twice its rate, so the burning fist leaves the belly half a second after the mark, as the
  // belly flares.
  smith_heart_wellkeeper: warder(
    'heart_wellkeeper',
    3.2,
    2.2,
    0.52,
    1.29,
    {
      ...RISES,
      glowPulses: {
        pulses: [
          { gesture: HEAT_CUES.kindling, delay: 0.25, rise: 0.15, hold: 0.2, fall: 0.7, peak: 2.4 },
        ],
        deathFade: 2.5,
      },
    },
    {
      ...RISE_CLIPS,
      idleVariantCadence: { everySec: 16, jitterSec: 10 },
      attack: ['Attack', 'Attack2', 'Cleave'],
      attackByAbility: { [HEAT_CUES.kindling]: 'CastMark' },
      attackTimeScaleByAbility: { [HEAT_CUES.kindling]: 2 },
    },
  ),
  // The Seedflame: a white-gold flame in a cracked basalt seed pod. It cracks its pod open as it
  // hatches; it hops (its gait hops from 3.2 yd/s), bites and whips its tall back flame down.
  smith_heart_seedflame: {
    url: `${CREATURES}/heart_seedflame.glb`,
    height: 2.0,
    clips: {
      ...BASE_CLIPS,
      ...RISE_CLIPS,
      idleVariantCadence: { everySec: 12, jitterSec: 8 },
      contacts: { Attack: [0.5], Attack2: [0.55] },
    },
    ...RISES,
    attackTimeScale: 1,
    deathTimeScale: 1,
    turnRate: 5,
    walkRef: gaitRef(2.0, 2.0, 0.9),
    runRef: gaitRef(5.5, 2.0, 0.9),
    gait: { runEnter: 3.2, runExit: 2.6 },
    gaitWindDown: true,
    authoredAtlas: true,
    glowPulses: { pulses: [], deathFade: 1.5 },
  },

  // ---- the final boss's Splinters -------------------------------------------------------------
  // Gold-ochre stone and gold crystal: Mounting Weight rides its plain swings.
  smith_heart_splinter_hammer: splinter('heart_splinter_hammer', 2.7),
  // Storm slate and cyan crystal: Gale Pounce crouches through the 1.5 s bar and leaps, landing
  // on the bar's end (Pounce at 1.4x: its 2.1 s landing on the bar's 1.5 s), as the fight sets
  // it down by its quarry.
  smith_heart_splinter_breath: splinter(
    'heart_splinter_breath',
    2.4,
    { [C.pounce]: 'Pounce' },
    { [C.pounce]: 1.4 },
  ),
  // Glacier ice and snow: Rime Toll gathers through the 2.5 s bar and its fist strikes the core
  // on the bar's end (Toll's 0.62 s strike at 0.248x), the cracks flaring as it rings out.
  smith_heart_splinter_quench: splinter(
    'heart_splinter_quench',
    2.5,
    { [C.toll]: 'Toll' },
    { [C.toll]: 0.248 },
    {
      glowPulses: {
        pulses: [
          { gesture: Q.shear, rise: 0.08, hold: 0.2, fall: 0.9, peak: 2.4 },
          { gesture: Q.toll, rise: 0.08, hold: 0.3, fall: 1.0, peak: 2.6 },
        ],
        deathFade: 2.5,
      },
    },
  ),
  // Sooted basalt and molten seams: marking a Bursting Coal it rips the coal out of its core and
  // throws it (Throw at twice its rate, released half a second after the mark).
  smith_heart_splinter_heat: splinter(
    'heart_splinter_heat',
    2.6,
    {},
    {},
    {},
    {
      attackByAbility: { [Q.coal]: 'Throw' },
      attackTimeScaleByAbility: { [Q.coal]: 2 },
    },
  ),
};
