// The Gravewyrm Sanctum's three bosses (docs/design/dungeon-rework/
// gravewyrm_sanctum.md section 6): Blender bodies authored at their in-game
// size (E:/woc/entregas/santuario/{korgath,velkhar,korzul}), measured in
// render/gravewyrm_sanctum_bosses/boss_model_core.ts. manifest.ts merges
// SANCTUM_BOSS_LOOKS into VISUALS and SANCTUM_BOSS_MOB_KEYS into the mob key
// map (each boss's shipped stand-in body is replaced under its own key).
//
// Every bar plays its own clip timed so the contact frame lands on the bar's
// last frame (castClipSync + castTimeScaleByAbility); the strikes finish as
// play-outs. The sim's cast and aura ids are the contract (boss_ids.ts); the
// presentation gestures (a chain's broken mesh, Korzul's frozen stance and
// takeoff, Velkhar's thaw) are sent by the boss effects (sanctum_boss_fx.ts).

import {
  KORGATH_BELLOW,
  KORGATH_CHAIN_BREAK,
  KORGATH_CHAIN_FLAIL,
  KORGATH_ENRAGE,
  KORGATH_MAUL_ARC,
  KORGATH_RERIVETED,
  KORGATH_STOMP,
  KORGATH_STRAIN,
  KORGATH_THRESHOLD_CHARGE,
  KORGATH_TUNING,
  KORZUL_BREAK_FREE,
  KORZUL_CRASHING_DESCENT,
  KORZUL_DOUSED,
  KORZUL_ENRAGE,
  KORZUL_GRAVE_BREATH,
  KORZUL_GRAVE_INFERNO,
  KORZUL_PLUNGING_FIRE,
  KORZUL_SHARD_FLARE,
  KORZUL_TAIL_SWEEP,
  KORZUL_TUNING,
  KORZUL_WING_GALE,
  SEAL_SHACKLE_IDS,
  VELKHAR_SHADOW_VOLLEY,
  VELKHAR_SOULFIRE_TRENCH,
  VELKHAR_TUNING,
} from '../../sim/encounters/gravewyrm_sanctum/boss_ids';
import { KORZUL_EMERGE } from '../../sim/encounters/gravewyrm_sanctum/korzul_emerge_plan';
import {
  bossLookHeight,
  bossModelScale,
  contactRate,
  KORGATH_BODY,
  KORGATH_BROKEN_CHAIN_MESH,
  KORGATH_BROKEN_GESTURE,
  KORGATH_CLIP,
  KORGATH_RUNES_GESTURE,
  KORGATH_WHOLE_GESTURE,
  KORZUL_BODY,
  KORZUL_CLIP,
  KORZUL_EMERGE_LAND_GESTURE,
  KORZUL_EMERGE_LAND_RATE,
  KORZUL_FROZEN_STANCE,
  KORZUL_HEARTBEAT_FLARE_GESTURE,
  KORZUL_HEARTBEAT_GESTURE,
  KORZUL_HIDE_GESTURE,
  KORZUL_SHOW_GESTURE,
  KORZUL_TAKEOFF_GESTURE,
  VELKHAR_BODY,
  VELKHAR_CLIP,
  VELKHAR_FLAME_GESTURE,
  VELKHAR_THAW_GESTURE,
} from '../gravewyrm_sanctum_bosses/boss_model_core';
import type { MeshToggleDef } from './gesture_mesh_toggles';
import type { ClipMap, VisualDef } from './manifest';

const K = KORGATH_TUNING;
const V = VELKHAR_TUNING;
const Z = KORZUL_TUNING;
/** Korzul's emergence bar (korzul_emerge_plan.ts: Break Free's burst beat). */
const KORZUL_EMERGE_BAR = KORZUL_EMERGE.burst;

/** The broken chains hang from the wrist rings once their chain has broken
 *  (re-sent by the effects, so a view rebuilt mid-fight shows the state). */
const KORGATH_CHAIN_TOGGLES: MeshToggleDef[] = (['hammer', 'tongs'] as const).map((tool) => ({
  nodes: [KORGATH_BROKEN_CHAIN_MESH[tool] as string],
  hideNow: KORGATH_WHOLE_GESTURE[tool],
  showNow: KORGATH_BROKEN_GESTURE[tool],
}));

/** Korzul on his feet: the ground kit, the flights (flight: the hover loops
 *  while he is up), the strikes as play-outs. */
const KORZUL_CLIPS: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Walk',
  jump: 'FlyIdle',
  fall: 'FlyForward',
  attack: ['Bite', 'Claw'],
  attackByAbility: {
    [KORZUL_DOUSED]: 'Hit',
    [KORZUL_ENRAGE]: 'Roar',
    [KORZUL_SHARD_FLARE]: 'Roar',
    [KORZUL_TAKEOFF_GESTURE]: 'TakeOff',
    // Break Free's landing on the centre: the fall's impact on the touchdown.
    [KORZUL_EMERGE_LAND_GESTURE]: 'Land',
  },
  attackTimeScaleByAbility: {
    [KORZUL_DOUSED]: 1,
    [KORZUL_ENRAGE]: 1,
    [KORZUL_SHARD_FLARE]: 1,
    // The sim climbs to the hover in 1.8 s (korzul.ts KORZUL_TAKEOFF_SECONDS).
    [KORZUL_TAKEOFF_GESTURE]: 2.79 / 1.8,
    [KORZUL_EMERGE_LAND_GESTURE]: KORZUL_EMERGE_LAND_RATE,
  },
  hit: ['Hit'],
  death: 'Death',
  cast: 'Roar',
  castByAbility: {
    [KORZUL_GRAVE_BREATH]: 'BreathGround',
    [KORZUL_TAIL_SWEEP]: 'TailSwipe',
    [KORZUL_GRAVE_INFERNO]: 'GraveInferno',
    [KORZUL_WING_GALE]: 'WingBuffet',
    [KORZUL_PLUNGING_FIRE]: 'BreathAir',
    [KORZUL_CRASHING_DESCENT]: 'Land',
    // His pull: the 3 s emergence bar bursts the ice, the forefeet slam on its end.
    [KORZUL_BREAK_FREE]: 'BreakFree',
  },
  castTimeScaleByAbility: {
    // The inhale is the bar: the fire leaves the jaws on the bar's end.
    [KORZUL_GRAVE_BREATH]: contactRate(KORZUL_CLIP.breathStart, Z.breathCast),
    [KORZUL_TAIL_SWEEP]: contactRate(KORZUL_CLIP.tailHit, Z.tailCast),
    // The channel's four pulses ride the clip's own beats (2, 4, 6, 8 s).
    [KORZUL_GRAVE_INFERNO]: 1,
    [KORZUL_WING_GALE]: contactRate(KORZUL_CLIP.galeGust, Z.galeCast),
    // The fire pours across the plate through the warning and ends on its end.
    [KORZUL_PLUNGING_FIRE]: contactRate(KORZUL_CLIP.breathAirEnd, Z.plungeWarn),
    [KORZUL_CRASHING_DESCENT]: contactRate(KORZUL_CLIP.landImpact, Z.descentWarn),
    [KORZUL_BREAK_FREE]: contactRate(KORZUL_CLIP.breakFreeSlam, KORZUL_EMERGE_BAR),
  },
  // Not the Inferno: Doused cuts it (to Hit) the moment his plate breaks.
  castPlayOut: ['BreathGround', 'TailSwipe', 'WingBuffet', 'BreathAir', 'Land', 'BreakFree'],
  flourish: 'Roar',
};

/** Before his pull he is still in the Calving Face's ice: the Frozen pose,
 *  twitching now and then. */
const KORZUL_FROZEN_CLIPS: ClipMap = {
  ...KORZUL_CLIPS,
  idle: 'Frozen',
  idleBeat: { clip: 'FrozenAwaken', everySec: 9, jitterSec: 3 },
  walk: 'Frozen',
  run: 'Frozen',
};

export const SANCTUM_BOSS_LOOKS: Record<string, VisualDef> = {
  // Korgath the Bound: the Smith's foreman in his harness, 10.3 yd at Idle.
  sanctum_korgath: {
    url: KORGATH_BODY.url,
    height: bossLookHeight(KORGATH_BODY),
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'ThresholdChargeLoop',
      attack: ['HammerSlam', 'HammerSweep'],
      attackByAbility: {
        [KORGATH_CHAIN_BREAK]: 'ChainBreak',
        [KORGATH_RERIVETED]: 'ChainYank',
        [KORGATH_ENRAGE]: 'Roar',
      },
      attackTimeScaleByAbility: {
        [KORGATH_CHAIN_BREAK]: 1,
        [KORGATH_RERIVETED]: 1,
        [KORGATH_ENRAGE]: 1,
      },
      hit: ['Hit'],
      death: 'Death',
      cast: 'Strain',
      castByAbility: {
        [KORGATH_STRAIN]: 'Strain',
        [KORGATH_STOMP]: 'Stomp',
        [KORGATH_MAUL_ARC]: 'MaulArc',
        [KORGATH_CHAIN_FLAIL]: 'ChainFlail',
        [KORGATH_THRESHOLD_CHARGE]: 'ThresholdCharge',
        [KORGATH_BELLOW]: 'ForemansBellow',
      },
      castTimeScaleByAbility: {
        [KORGATH_STRAIN]: contactRate(KORGATH_CLIP.strain, K.strainCast),
        [KORGATH_STOMP]: contactRate(KORGATH_CLIP.stomp, K.stompCast),
        [KORGATH_MAUL_ARC]: contactRate(KORGATH_CLIP.maulArc, K.maulCast),
        [KORGATH_CHAIN_FLAIL]: contactRate(KORGATH_CLIP.chainFlail, K.flailCast),
        [KORGATH_THRESHOLD_CHARGE]: contactRate(KORGATH_CLIP.thresholdCharge, K.chargeCast),
        [KORGATH_BELLOW]: contactRate(KORGATH_CLIP.bellow, K.bellowCast),
      },
      castPlayOut: ['Strain', 'Stomp', 'MaulArc', 'ChainFlail', 'ForemansBellow'],
      flourish: 'Roar',
    },
    castClipSync: true,
    castPlayOutHoldsAttacks: true,
    oneShotsHoldAttacks: ['ChainBreak', 'Roar', 'ChainYank'],
    meshToggles: KORGATH_CHAIN_TOGGLES,
    // His runes and goad brands (the body's emissive map) burn as he Strains
    // and go dark as he kneels.
    glowPulses: {
      pulses: [{ gesture: KORGATH_RUNES_GESTURE, rise: 1.6, hold: 0.5, fall: 1.4, peak: 2.4 }],
      deathFade: 2.5,
    },
    walkRef: KORGATH_BODY.walkRef * bossModelScale(KORGATH_BODY, KORGATH_BODY.simScale),
    runRef: 11 * bossModelScale(KORGATH_BODY, KORGATH_BODY.simScale),
    attackTimeScale: 1.15,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.04,
    clickRadius: 3.2,
  },
  // Grand Necromancer Velkhar: the Chapel's prelate turned heretic, the soul
  // flame caged on his staff.
  sanctum_velkhar: {
    url: VELKHAR_BODY.url,
    height: bossLookHeight(VELKHAR_BODY),
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Walk',
      attack: ['Attack'],
      attackByAbility: { [VELKHAR_THAW_GESTURE]: 'Thaw' },
      attackTimeScaleByAbility: { [VELKHAR_THAW_GESTURE]: 1 },
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      castByAbility: {
        [VELKHAR_SOULFIRE_TRENCH]: 'SoulfireTrench',
        [VELKHAR_SHADOW_VOLLEY]: 'ShadowVolley',
      },
      castTimeScaleByAbility: {
        [VELKHAR_SOULFIRE_TRENCH]: contactRate(VELKHAR_CLIP.trenchLaunch, V.trenchCast),
        [VELKHAR_SHADOW_VOLLEY]: contactRate(VELKHAR_CLIP.volleyBurst, V.volleyCast),
      },
      castPlayOut: ['SoulfireTrench', 'ShadowVolley', 'Cast'],
    },
    castClipSync: true,
    castPlayOutHoldsAttacks: true,
    oneShotsHoldAttacks: ['Thaw'],
    // The caged soul flame roars as he casts and gutters out as he dies.
    glowPulses: {
      materials: ['VelkharSoulfire', 'VelkharFrostlight'],
      pulses: [{ gesture: VELKHAR_FLAME_GESTURE, rise: 0.4, hold: 0.6, fall: 1.2, peak: 2.2 }],
      deathFade: 2,
    },
    walkRef: VELKHAR_BODY.walkRef * bossModelScale(VELKHAR_BODY, VELKHAR_BODY.simScale),
    runRef: VELKHAR_BODY.walkRef * bossModelScale(VELKHAR_BODY, VELKHAR_BODY.simScale),
    walkTimeScaleMax: 3,
    runTimeScaleMax: 3,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.05,
    clickRadius: 1.6,
  },
  // Korzul the Gravewyrm: twelve hundred years in the quench, 54 yd nose to
  // tail; the rose-gold shard beats in his chest.
  sanctum_korzul: {
    url: KORZUL_BODY.url,
    height: bossLookHeight(KORZUL_BODY),
    // The claw tips sink a hair into the ice in every grounded pose.
    hover: -0.25 / KORZUL_BODY.simScale,
    flight: true,
    clips: KORZUL_CLIPS,
    // Still in the ice the showpiece is the environment's frozen Korzul in the
    // Calving Face: his own body hides until the face collapses or he is pulled.
    meshToggles: [{ nodes: ['*'], hideNow: KORZUL_HIDE_GESTURE, showNow: KORZUL_SHOW_GESTURE }],
    phaseClips: {
      [KORZUL_FROZEN_STANCE]: { clips: KORZUL_FROZEN_CLIPS },
      // The emergence bar itself plays BreakFree (castByAbility); the stance
      // swap only hands him his waking clips.
      [KORZUL_BREAK_FREE]: { clips: KORZUL_CLIPS },
    },
    // The sim lifts him to his hover (korzul.ts, pos.y up flightAltitude): the
    // airborne clips' own Root climb (+6 yd) is dropped so the height has one
    // owner and he never pops between the takeoff, the hover and the landing.
    clipPositionDrops: Object.fromEntries(
      ['TakeOff', 'FlyIdle', 'FlyForward', 'BreathAir', 'Land'].map((c) => [c, ['Root']]),
    ),
    // The heart-shard beats (lub, dub) and flares in the last phase; dark as
    // the lake takes him.
    glowPulses: {
      pulses: [
        { gesture: KORZUL_HEARTBEAT_GESTURE, rise: 0.1, hold: 0.04, fall: 0.5, peak: 1.4 },
        {
          gesture: KORZUL_HEARTBEAT_GESTURE,
          delay: 0.28,
          rise: 0.08,
          hold: 0.03,
          fall: 0.6,
          peak: 1.25,
        },
        { gesture: KORZUL_HEARTBEAT_FLARE_GESTURE, rise: 0.1, hold: 0.08, fall: 0.5, peak: 2.4 },
        {
          gesture: KORZUL_HEARTBEAT_FLARE_GESTURE,
          delay: 0.24,
          rise: 0.08,
          hold: 0.05,
          fall: 0.55,
          peak: 2,
        },
      ],
      deathFade: 4,
    },
    castClipSync: true,
    castPlayOutHoldsAttacks: true,
    oneShotsHoldAttacks: ['BreakFree', 'TakeOff', 'Roar'],
    walkRef: KORZUL_BODY.walkRef * bossModelScale(KORZUL_BODY, KORZUL_BODY.simScale),
    runRef: KORZUL_BODY.walkRef * bossModelScale(KORZUL_BODY, KORZUL_BODY.simScale),
    attackTimeScale: 1.1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.05,
    // The widest override the click-capsule guard allows (2x CLICK_RADIUS_CAP,
    // tests/nythraxis_bone_spike_model.test.ts): wider swallows the raid's clicks.
    clickRadius: 4.4,
  },
};

/** The Seal Shackles: stationary parts drawn by the boss effects (an iron
 *  cuff at each pillar's foot, sanctum_boss_fx.ts), so the mob itself is only
 *  its click capsule, nameplate and bars. */
SANCTUM_BOSS_LOOKS.sanctum_seal_shackle = {
  url: KORGATH_BODY.url,
  height: 2,
  clips: { idle: 'Idle', walk: 'Idle', run: 'Idle', attack: ['Hit'], hit: ['Hit'], death: 'Death' },
  bodyless: true,
  authoredAtlas: true,
  clickRadius: 1.8,
};

/** The boss templates (and the shackles) to their looks. */
export const SANCTUM_BOSS_MOB_KEYS: Record<string, string> = {
  ...Object.fromEntries(Object.values(SEAL_SHACKLE_IDS).map((id) => [id, 'sanctum_seal_shackle'])),
  korgath_the_bound: 'sanctum_korgath',
  grand_necromancer_velkhar: 'sanctum_velkhar',
  korzul_the_gravewyrm: 'sanctum_korzul',
};
