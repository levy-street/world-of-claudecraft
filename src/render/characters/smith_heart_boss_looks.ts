// The Smith's Heart's own boss models (docs/design/raid/smith_heart.md, the
// art pipeline of WoC_Model_Pipeline_Guide: a concept T-pose turnaround,
// Tripo3D, a skeleton built for the mesh in Blender with hand-solved
// weights, every clip authored for it at 30 fps). manifest.ts merges
// SMITH_HEART_BOSS_LOOKS into VISUALS; smith_heart_placeholder_looks.ts
// points each boss's template at its key.
//
// The Hammer Council (the Guardian of the Hammer and the Seam Singer): their
// fighting clips and their entrance's stances, gestures and dark (the ids and
// beats in smith_heart_fx/council_entrance_core.ts).
//
// The Masterless Strength (the Quadrant Guardian): one rigged mesh, four
// element bodies (Body_Hammer, Body_Breath, Body_Heat, Body_Quench plus the
// Quench's icicles) the fight's quarter swaps through mesh toggles, the
// cracks' flare a glow pulse, the false death a stance swap. The gestures
// are sent by smith_heart_fx/final_body_fx.ts; their ids and the clip beats
// live in smith_heart_fx/final_body_core.ts.

import { BREATH_CASTS, BREATH_TUNING } from '../../sim/encounters/smith_heart/breath_ids';
import { ISLE_CASTS } from '../../sim/encounters/smith_heart/breath_isle_ids';
import { FINAL_CASTS, FINAL_TUNING } from '../../sim/encounters/smith_heart/final_ids';
import { HEAT_CASTS, HEAT_TUNING } from '../../sim/encounters/smith_heart/heat_ids';
import { QUENCH_CASTS, QUENCH_TUNING } from '../../sim/encounters/smith_heart/quench_ids';
import {
  BREATH_BODY_CLIP,
  BREATH_BODY_GESTURES,
  BREATH_BODY_HEIGHT,
  BREATH_BODY_URL,
} from '../smith_heart_fx/breath_body_core';
import { BREATH_ENTRANCE_GESTURES } from '../smith_heart_fx/breath_entrance_core';
import { COUNCIL_MODEL_HEIGHTS } from '../smith_heart_fx/council_bodies_core';
import {
  COUNCIL_AWAKEN_CLIP,
  COUNCIL_ENTRANCE_GESTURES,
} from '../smith_heart_fx/council_entrance_core';
import {
  FINAL_BODY_CLIP,
  FINAL_BODY_ELEMENTS,
  FINAL_BODY_GESTURES,
  FINAL_BODY_HEIGHT,
  FINAL_BODY_NODES,
} from '../smith_heart_fx/final_body_core';
import { FORGE_FIST_CUE } from '../smith_heart_fx/final_fx_core';
import { ARC_CLEAVE_ABILITY } from '../smith_heart_fx/hammer_fx_core';
import {
  HEAT_BODY_CLIP,
  HEAT_BODY_GESTURES,
  HEAT_BODY_HEIGHT,
  HEAT_BODY_HOVER,
  HEAT_BODY_URL,
} from '../smith_heart_fx/heat_body_core';
import {
  QUENCH_BODY_CLIP,
  QUENCH_BODY_GESTURES,
  QUENCH_BODY_HEIGHT,
  QUENCH_BODY_URL,
} from '../smith_heart_fx/quench_body_core';
import { QUENCH_STRIKE_FALL } from '../smith_heart_fx/quench_strike_core';
import type { MeshToggleDef } from './gesture_mesh_toggles';
import type { ClipMap, VisualDef } from './manifest';

const CREATURES = 'models/creatures';

/** The shipped body (public/models/creatures). */
export const MASTERLESS_STRENGTH_URL = `${CREATURES}/smith_heart_masterless_strength.glb`;

/** Every clip the GLB carries. */
export const MASTERLESS_STRENGTH_CLIPS = [
  'Idle',
  'Walk',
  'Attack',
  'Slam',
  'Wrath',
  'Pour',
  'Shift',
  'Hit',
  'Kneel',
  'KneelIdle',
  'Death',
] as const;

/** The arrival's two authored clips (scripts/build_masterless_strength_
 *  arrival_anims.mjs, sampled from Kneel, KneelIdle and Idle): the still
 *  knee it waits dormant on and the heavy push back to its feet. */
export const MASTERLESS_STRENGTH_ARRIVAL_URL = `${CREATURES}/smith_heart_masterless_strength_arrival_anims.glb`;
export const MASTERLESS_STRENGTH_ARRIVAL_CLIPS = ['Dormant', 'Rise'] as const;

/** The Guardian of the Quench's two entrance clips (scripts/build_quench_
 *  guardian_entrance_anims.mjs, sampled from Idle and Wake and laid down and
 *  lifted on the root): lying frozen under the lake's ice, and the burst out
 *  of it, the rise and the blades' call. */
export const QUENCH_ENTRANCE_ANIMS_URL = `${CREATURES}/smith_heart_quench_guardian_entrance_anims.glb`;
export const QUENCH_ENTRANCE_CLIPS = ['Frozen', 'Emerge'] as const;

/** The Hammer Council's entrance clips (scripts/build_council_entrance_
 *  anims.mjs, sampled from each rig's own Awaken): the crouch each one sleeps
 *  on, the Guardian in its spur of rock, the Seam Singer in her crystal. They
 *  break out on the base GLBs' Awaken. */
export const COUNCIL_GUARDIAN_ENTRANCE_URL = `${CREATURES}/heart_hammer_guardian_entrance_anims.glb`;
export const COUNCIL_SINGER_ENTRANCE_URL = `${CREATURES}/heart_seam_singer_entrance_anims.glb`;
export const COUNCIL_ENTRANCE_CLIPS = ['Dormant'] as const;

/** A bar's clip rate so its contact beat lands on the bar's end. */
const onBarEnd = (contact: number, bar: number) => (bar > 0 ? contact / bar : 1);

const BASE: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Walk',
  attack: ['Attack'],
  contacts: { Attack: [FINAL_BODY_CLIP.attack], Slam: [FINAL_BODY_CLIP.slam] },
  attackByAbility: {
    // Forge Fist: the frontal's windup cue plays both fists into the floor.
    [FORGE_FIST_CUE]: 'Slam',
    // The elemental awakening's roar (the transformation).
    [FINAL_BODY_GESTURES.shift]: 'Shift',
  },
  attackTimeScaleByAbility: { [FORGE_FIST_CUE]: 1, [FINAL_BODY_GESTURES.shift]: 1 },
  hit: ['Hit'],
  death: 'Death',
  cast: 'Pour',
  castByAbility: {
    [FINAL_CASTS.fist]: 'Wrath',
    [FINAL_CASTS.anvil]: 'Wrath',
    [FINAL_CASTS.bolt]: 'Pour',
  },
  castTimeScaleByAbility: {
    [FINAL_CASTS.fist]: onBarEnd(FINAL_BODY_CLIP.wrath, FINAL_TUNING.fistCast),
    [FINAL_CASTS.anvil]: onBarEnd(FINAL_BODY_CLIP.wrath, FINAL_TUNING.anvilCast),
    [FINAL_CASTS.bolt]: onBarEnd(FINAL_BODY_CLIP.pour, FINAL_TUNING.boltCast),
  },
  castPlayOut: ['Wrath', 'Pour'],
};

/** The false death (Mythic's hidden phase): on one knee, a fist planted. */
const KNEELING: ClipMap = {
  ...BASE,
  idle: 'KneelIdle',
  walk: 'KneelIdle',
  run: 'KneelIdle',
};

/** The arrival's opening (final_arrival_core.ts): on one knee, perfectly
 *  still, a statue of cracked stone until the beam wakes it. */
const DORMANT: ClipMap = {
  ...BASE,
  idle: 'Dormant',
  walk: 'Dormant',
  run: 'Dormant',
};

const TOGGLES: readonly MeshToggleDef[] = [
  { nodes: ['*'], hideNow: FINAL_BODY_GESTURES.hide, showNow: FINAL_BODY_GESTURES.show },
  ...FINAL_BODY_ELEMENTS.map((el) => ({
    nodes: FINAL_BODY_NODES[el],
    hideNow: FINAL_BODY_GESTURES.off[el],
    showNow: FINAL_BODY_GESTURES.on[el],
  })),
];

// The Guardian of the Heat (the Hearth, design doc 7.4): one rigged mesh in
// the first wellspring, fighting bare-handed. Its swings alternate the right
// and the left fist into the shore, Basalt Fist's bar hauls the right fist
// high and drives it down on the bar's end, its fire is gathered and thrown
// by a gesture, the Hearthseeds are scooped out of the lava and hurled (the
// Throw clip, its meteors the seeds themselves), and the overflows plunge it under the lava (the Under stance,
// entered by its Sink) and burst it back out (the fighting stance, entered by
// its Rise). The fire round it is smith_heart_fx/heat_body.ts's; the gesture
// ids and the clip beats live in smith_heart_fx/heat_body_core.ts.
const HEAT_BASE: ClipMap = {
  idle: 'Idle',
  walk: 'Idle',
  run: 'Idle',
  attack: ['Attack', 'Attack2'],
  contacts: {
    Attack: [HEAT_BODY_CLIP.attack],
    Attack2: [HEAT_BODY_CLIP.attack],
    Slam: [HEAT_BODY_CLIP.slam],
  },
  attackByAbility: { [HEAT_BODY_GESTURES.cast]: 'Cast', [HEAT_BODY_GESTURES.throw]: 'Throw' },
  attackTimeScaleByAbility: { [HEAT_BODY_GESTURES.cast]: 1, [HEAT_BODY_GESTURES.throw]: 1 },
  death: 'Death',
  cast: 'Cast',
  castByAbility: { [HEAT_CASTS.fist]: 'Slam' },
  castTimeScaleByAbility: {
    [HEAT_CASTS.fist]: onBarEnd(HEAT_BODY_CLIP.slam, HEAT_TUNING.fistCast),
  },
  castPlayOut: ['Slam'],
};

/** Under the wellspring through an overflow. */
const HEAT_UNDER: ClipMap = { ...HEAT_BASE, idle: 'Under', walk: 'Under', run: 'Under' };

// The Guardian of the Breath (the Storm Cornice, design doc 7.2): floating
// pieces of ancient armor held together by living wind, one bone a piece, so
// every piece trails and overshoots on its own. Its claws swipe in turn; the
// Indrawn Breath runs its whole bar (pieces drawn in, the mask to the raid);
// the Summit Roar's thrust lands on the bar's end and its follow-through plays
// out; the bolt casts point on their bar's end; the channels (the Thunder's
// Cradle's hold, the Gale Bulwark) raise both arms and hold. At half health
// Storm Breaks runs the 4 s bar and leaves every piece flung out to the wider
// spacing the storm stance keeps: the same motions, crackling (no model
// swap). The wind round it is smith_heart_fx/breath_body.ts's; the gesture ids
// and the clip beats live in smith_heart_fx/breath_body_core.ts.
const BREATH_BOLT_CASTS = [
  BREATH_CASTS.fork,
  BREATH_CASTS.drawn,
  BREATH_CASTS.cradle,
  BREATH_CASTS.lance,
] as const;
const BREATH_LANCE_CAST = 2;
const breathBarScale = (c: string): number => {
  if (c === BREATH_CASTS.fork)
    return onBarEnd(BREATH_BODY_CLIP.castRelease, BREATH_TUNING.forkCast);
  if (c === BREATH_CASTS.drawn)
    return onBarEnd(BREATH_BODY_CLIP.castRelease, BREATH_TUNING.drawnCast);
  if (c === BREATH_CASTS.cradle)
    return onBarEnd(BREATH_BODY_CLIP.castRelease, BREATH_TUNING.cradleCast);
  return onBarEnd(BREATH_BODY_CLIP.castRelease, BREATH_LANCE_CAST);
};

function breathClips(storm: boolean): ClipMap {
  const p = storm ? 'Storm' : '';
  const cast = `${p}Cast`;
  const channel = `${p}Channel`;
  return {
    idle: `${p}Idle`,
    walk: `${p}Move`,
    run: `${p}Move`,
    attack: [`${p}Attack`, `${p}Attack2`],
    contacts: {
      [`${p}Attack`]: [BREATH_BODY_CLIP.attack],
      [`${p}Attack2`]: [BREATH_BODY_CLIP.attack],
    },
    death: `${p}Death`,
    cast,
    castByAbility: {
      [BREATH_CASTS.inhale]: 'Inhale',
      [BREATH_CASTS.gust]: 'Roar',
      [BREATH_CASTS.storm]: 'StormBreaks',
      [BREATH_CASTS.cradleHold]: channel,
      [ISLE_CASTS.bulwark]: channel,
      ...Object.fromEntries(BREATH_BOLT_CASTS.map((c) => [c, cast])),
    },
    castTimeScaleByAbility: {
      [BREATH_CASTS.inhale]: onBarEnd(BREATH_BODY_CLIP.inhale, BREATH_TUNING.inhaleCast),
      [BREATH_CASTS.gust]: onBarEnd(BREATH_BODY_CLIP.roar, BREATH_TUNING.gustCast),
      [BREATH_CASTS.storm]: onBarEnd(BREATH_BODY_CLIP.breakEnd, BREATH_TUNING.stormCast),
      ...Object.fromEntries(BREATH_BOLT_CASTS.map((c) => [c, breathBarScale(c)])),
    },
    castPlayOut: ['Roar', cast],
  };
}

const BREATH_CALM = breathClips(false);

/** The Guardian of the Breath's two entrance clips (scripts/build_breath_
 *  entrance_anims.mjs, sampled off its Idle): gathered into a speck of the
 *  still air (nothing of it shows), and forming out of the wind inside the
 *  funnel (smith_heart_fx/breath_entrance_core.ts BREATH_FORM_CLIP). */
export const BREATH_ENTRANCE_ANIMS_URL = `${CREATURES}/smith_heart_breath_guardian_entrance_anims.glb`;
export const BREATH_ENTRANCE_CLIPS = ['Gathered', 'Form'] as const;

/** Its entrance's first stance: gathered into nothing, still. */
const BREATH_GATHERED: ClipMap = {
  ...BREATH_CALM,
  idle: 'Gathered',
  walk: 'Gathered',
  run: 'Gathered',
};

// The Guardian of the Quench (the Frozen Lake, design doc 7.3): an ice queen,
// one rigged mesh, her gown and her hair on their own bone chains (their sway
// and follow-through baked into every clip). She walks with a slow regal step
// under the gown; her swings alternate a right backhand and a left hook, the
// ice bracers leading; Tempering Strike raises both fists high over her crown
// on the fight's wind-up cue a second ahead of the cleaving swing and holds
// them for its outcome (StrikeRaise): the cleave hammers them on the ice
// (StrikeSlam), an avoided swing brings them down as a plain backhand
// (StrikeSpent); a breath before the swing the downswing begins (StrikeFall),
// so the slam lands its fists on the cleave's own frame; the cleave's own cue plays the short Strike only when no
// wind-up was seen; Quenching Breath rears her back through its bar
// and throws the cold out of her mouth on the bar's end, the exhale playing
// out; the Blades Wake raises both arms through its 4 s bar and throws them
// down on its end; the Blades Hunt holds them up. Her taunt at the pull and
// her commanding point at a slash are gestures. The cold round her is
// smith_heart_fx/quench_body.ts's; the gesture ids and the clip beats live in
// smith_heart_fx/quench_body_core.ts.
const QUENCH_CLIPS: ClipMap = {
  idle: 'Idle',
  walk: 'Move',
  run: 'Move',
  attack: ['Attack', 'Attack2'],
  contacts: {
    Attack: [QUENCH_BODY_CLIP.attack],
    Attack2: [QUENCH_BODY_CLIP.attack],
    Strike: [QUENCH_BODY_CLIP.strike],
    StrikeSlam: [QUENCH_BODY_CLIP.strikeSlam],
    StrikeSpent: [QUENCH_BODY_CLIP.strikeSpent],
    StrikeSlamHigh: [QUENCH_BODY_CLIP.strikeSlamHigh],
    StrikeSpentHigh: [QUENCH_BODY_CLIP.strikeSpentHigh],
  },
  // The slam lands on its first frame, played on the cleave's own frame from
  // the downswing's low pose: a short fade puts her fists on the ice at once.
  oneShotFade: {
    StrikeSlam: QUENCH_STRIKE_FALL.slamFade,
    StrikeSpent: QUENCH_STRIKE_FALL.spentFade,
  },
  attackByAbility: {
    [ARC_CLEAVE_ABILITY]: 'Strike',
    [QUENCH_BODY_GESTURES.strikeRaise]: 'StrikeRaise',
    [QUENCH_BODY_GESTURES.strikeFall]: 'StrikeFall',
    [QUENCH_BODY_GESTURES.strikeSlam]: 'StrikeSlam',
    [QUENCH_BODY_GESTURES.strikeSpent]: 'StrikeSpent',
    [QUENCH_BODY_GESTURES.strikeSlamHigh]: 'StrikeSlamHigh',
    [QUENCH_BODY_GESTURES.strikeSpentHigh]: 'StrikeSpentHigh',
    [QUENCH_BODY_GESTURES.taunt]: 'Taunt',
    [QUENCH_BODY_GESTURES.slash]: 'Slash',
  },
  attackTimeScaleByAbility: {
    [ARC_CLEAVE_ABILITY]: 1,
    [QUENCH_BODY_GESTURES.strikeRaise]: 1,
    [QUENCH_BODY_GESTURES.strikeFall]: 1,
    [QUENCH_BODY_GESTURES.strikeSlam]: 1,
    [QUENCH_BODY_GESTURES.strikeSpent]: 1,
    [QUENCH_BODY_GESTURES.strikeSlamHigh]: 1,
    [QUENCH_BODY_GESTURES.strikeSpentHigh]: 1,
    [QUENCH_BODY_GESTURES.taunt]: 1,
    [QUENCH_BODY_GESTURES.slash]: 1,
  },
  death: 'Death',
  cast: 'Breath',
  castByAbility: {
    [QUENCH_CASTS.breath]: 'Breath',
    [QUENCH_CASTS.wake]: 'Wake',
    [QUENCH_CASTS.flurry]: 'WakeHold',
  },
  castTimeScaleByAbility: {
    [QUENCH_CASTS.breath]: onBarEnd(QUENCH_BODY_CLIP.breath, QUENCH_TUNING.breathCast),
    [QUENCH_CASTS.wake]: onBarEnd(QUENCH_BODY_CLIP.wake, QUENCH_TUNING.wakeCast),
  },
  castPlayOut: ['Breath', 'Wake'],
};

/** Her entrance's first stance: lying frozen under the lake's ice, still. */
const QUENCH_FROZEN: ClipMap = { ...QUENCH_CLIPS, idle: 'Frozen', walk: 'Frozen', run: 'Frozen' };
const BREATH_STORM = breathClips(true);

// ---- the Hammer Council ------------------------------------------------------------------------
const CG = COUNCIL_ENTRANCE_GESTURES;

/** The Guardian of the Hammer's fighting clips (and its entrance's punch:
 *  CastWake, its fists landing at COUNCIL_AWAKEN_CLIP.punchContact). */
const COUNCIL_GUARDIAN_CLIPS: ClipMap = {
  idle: 'Idle',
  idleVariants: ['IdleFidget'],
  idleVariantCadence: { everySec: 18, jitterSec: 12 },
  combatIdle: 'CombatIdle',
  turn: 'Turn',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack', 'Attack2'],
  attackByAbility: {
    brood_cleave: 'Attack2',
    heart_mountains_rush_windup: 'Attack',
    [CG.guardianPunch]: 'CastWake',
  },
  attackTimeScaleByAbility: { heart_mountains_rush_windup: 1.25, [CG.guardianPunch]: 1 },
  contacts: { Attack: [1.0], Attack2: [1.0] },
  cast: 'CastWrath',
  castByAbility: {
    heart_hammers_weight: 'CastWake',
    heart_mountains_wrath: 'CastWrath',
    heart_mountains_rush: 'CombatIdle',
  },
  castTimeScaleByAbility: { heart_hammers_weight: 0.62, heart_mountains_wrath: 0.75 },
  castPlayOut: ['CastWake', 'CastWrath'],
  hit: ['Hit', 'Hit2'],
  death: 'Death',
  flourish: 'Awaken',
};

/** The Seam Singer's fighting clips (and her entrance's high note: CastSong,
 *  played at COUNCIL_AWAKEN_CLIP.noteRate). */
const COUNCIL_SINGER_CLIPS: ClipMap = {
  idle: 'Idle',
  idleVariants: ['IdleFidget'],
  idleVariantCadence: { everySec: 18, jitterSec: 12 },
  combatIdle: 'CombatIdle',
  turn: 'Turn',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack', 'Attack2'],
  attackByAbility: { [CG.singerNote]: 'CastSong' },
  attackTimeScaleByAbility: { [CG.singerNote]: COUNCIL_AWAKEN_CLIP.noteRate },
  contacts: { Attack: [0.62], Attack2: [0.66] },
  cast: 'CastSong',
  castByAbility: {
    heart_seam_bolt: 'CastBolt',
    heart_song_of_the_seam: 'CastSong',
    heart_mountains_wrath: 'CastWrath',
    heart_wake_the_stone: 'CastBolt',
    heart_falling_rock: 'CastBolt',
  },
  // Wake the Stone and Falling Rock (the Singer's since the council became two bosses) throw
  // through the bolt, timed so its throw (at 2.0 s at 1x) leaves the hand where
  // smith_heart_fx/council_bodies.ts slams their dust and ring: 78 percent of each bar.
  castTimeScaleByAbility: { heart_wake_the_stone: 1.03, heart_falling_rock: 2.14 },
  castPlayOut: ['CastBolt', 'CastSong', 'CastWrath'],
  hit: ['Hit', 'Hit2'],
  death: 'Death',
  flourish: 'Awaken',
};

/** Asleep for the entrance: the crouch held, no fidget, no turn. */
const asleep = (base: ClipMap): ClipMap => ({
  ...base,
  idle: 'Dormant',
  idleVariants: [],
  combatIdle: 'Dormant',
  turn: 'Dormant',
  walk: 'Dormant',
  run: 'Dormant',
});

/** A member's entrance stances (smith_heart_fx/council_entrance_fx.ts):
 *  asleep, the break out (its Awaken one-shot, entered once), standing. */
const councilStances = (
  base: ClipMap,
  dormant: string,
  emerge: string,
  stand: string,
): Record<string, { clips: ClipMap; enter?: string }> => ({
  [dormant]: { clips: asleep(base) },
  [emerge]: { clips: base, enter: 'Awaken' },
  [stand]: { clips: base },
});

/** A member held dark through its sleep (its colour dulled toward the
 *  quarry's grey, re-sent while it sleeps; it fills back over the fall as it
 *  breaks out). Its model has no emissive map, so the pulse takes its one
 *  material by name. */
const councilDark = (material: string, gesture: string, shade: number) => ({
  materials: [material],
  pulses: [{ gesture, rise: 0, hold: 1.0, fall: 1.1, peak: 1, shade }],
});

export const SMITH_HEART_BOSS_LOOKS: Record<string, VisualDef> = {
  // The Guardian of the Hammer, the Hammer Council's main boss, wears the model first built for the
  // Slabwright (heart_slabwright.glb): Tripo P2, one UV island per rock on a painted 1024 atlas in
  // ETC1S, a stone rig built in Blender (every rock rigid to one bone; the tracks that only hold the
  // rest pose are dropped at build, see the spec), drawn at the Guardian's height (4.6 at its scale
  // of 3.2: about 14.7 yd, the raid small round its feet; COUNCIL_MODEL_HEIGHTS, which the
  // entrance's rock and the bond's tether read too). Its melee lands at 1.0 s, inside its 2.6 s swing; Hammerfall (the template's
  // arcCleave, through its brood_cleave cue) swings the wide Attack2, and Mountain's Rush's wind-up
  // slams Attack down as the run starts (its 1.0 s contact at the 0.8 s wind-up). Hammer's Weight
  // slams through CastWake (authored to land at 0.94 s) at the end of its 1.5 s bar, Mountain's
  // Wrath bursts through CastWrath (at 3 s) at the end of its 4 s bar, both locked to the bar; it
  // braces through Mountain's Rush's bar. It hovers, so no foot can slide: runRef is the template's
  // 7 yd/s at 1x. Its entrance (smith_heart_fx/council_entrance_fx.ts): asleep in its spur
  // of rock on Dormant, held dark, then tearing out on Awaken and punching the ground
  // (CastWake).
  smith_heart_hammer_guardian: {
    url: `${CREATURES}/heart_slabwright.glb`,
    animUrls: [COUNCIL_GUARDIAN_ENTRANCE_URL],
    height: COUNCIL_MODEL_HEIGHTS.guardian,
    clips: COUNCIL_GUARDIAN_CLIPS,
    phaseClips: councilStances(
      COUNCIL_GUARDIAN_CLIPS,
      CG.guardianDormant,
      CG.guardianEmerge,
      CG.guardianStand,
    ),
    glowPulses: councilDark('heart_slabwright', CG.guardianDim, 0.3),
    castClipSync: ['heart_hammers_weight', 'heart_mountains_wrath'],
    oneShotsHoldAttacks: ['Awaken'],
    attackTimeScale: 1,
    deathTimeScale: 1,
    turnRate: 3,
    walkRef: 3.5,
    runRef: 7,
    gaitWindDown: true,
    authoredAtlas: true,
    clickRadius: 2.8,
  },
  // The Seam Singer, the Hammer Council's second boss beside the Guardian: Tripo P2 from the
  // concept sheet, a painted 1024 atlas in ETC1S, a stone rig built in Blender (every piece rigid
  // to one bone; only the neck and the column, fused in the mesh, blend). Its light melee lands at 0.62 s and 0.66 s, inside its 2.2 s swing. Seam Bolt leaves
  // its left hand at the end of its 2 s bar, the song's note comes at the end of its 3 s bar,
  // Mountain's Wrath bursts at the end of the heirs' 3 s bar, and each finishes its recovery after
  // the bar. It floats, so no foot can slide: runRef is the template's 7 yd/s at 1x.
  // smith_heart_fx/council_bodies.ts still plays its dust and rings (COUNCIL_MODELLED).
  // Her entrance: asleep in her crystal on Dormant, held dark, then floating out on Awaken
  // and singing the high note (CastSong). Drawn at 5.5 at her scale of 2.0 (11 yd, about the
  // Guardian's shoulder; COUNCIL_MODEL_HEIGHTS).
  smith_heart_seam_singer: {
    url: `${CREATURES}/heart_seam_singer.glb`,
    animUrls: [COUNCIL_SINGER_ENTRANCE_URL],
    height: COUNCIL_MODEL_HEIGHTS.singer,
    clips: COUNCIL_SINGER_CLIPS,
    phaseClips: councilStances(
      COUNCIL_SINGER_CLIPS,
      CG.singerDormant,
      CG.singerEmerge,
      CG.singerStand,
    ),
    glowPulses: councilDark('heart_seam_singer', CG.singerDim, 0.42),
    oneShotsHoldAttacks: ['Awaken'],
    attackTimeScale: 1,
    deathTimeScale: 1,
    turnRate: 3,
    walkRef: 3.5,
    runRef: 7,
    gaitWindDown: true,
    authoredAtlas: true,
    clickRadius: 2.0,
  },
  smith_heart_breath_guardian: {
    url: BREATH_BODY_URL,
    animUrls: [BREATH_ENTRANCE_ANIMS_URL],
    height: BREATH_BODY_HEIGHT,
    clips: BREATH_CALM,
    phaseClips: {
      [BREATH_BODY_GESTURES.calm]: { clips: BREATH_CALM },
      [BREATH_BODY_GESTURES.storm]: { clips: BREATH_STORM },
      // Its entrance (smith_heart_fx/breath_entrance_fx.ts): gathered into
      // the still air, then forming inside the funnel (the Form one-shot);
      // it floats on its calm stance after.
      [BREATH_ENTRANCE_GESTURES.gathered]: { clips: BREATH_GATHERED },
      [BREATH_ENTRANCE_GESTURES.form]: { clips: BREATH_CALM, enter: 'Form' },
    },
    castClipSync: [
      BREATH_CASTS.inhale,
      BREATH_CASTS.gust,
      BREATH_CASTS.storm,
      ...BREATH_BOLT_CASTS,
    ],
    glowPulses: {
      // Its eyes, crystals and spiral flare at the indrawn breath's end, the
      // roar and the storm tearing open.
      pulses: [
        { gesture: BREATH_BODY_GESTURES.flare, rise: 0.15, hold: 0.35, fall: 0.9, peak: 1.9 },
      ],
      // Dead, the wind gone, its light goes out.
      deathFade: 3,
    },
    // A swing never cuts the roar, the storm breaking or a bolt's cast.
    oneShotsHoldAttacks: ['Form', 'Roar', 'StormBreaks', 'Cast', 'StormCast'],
    castPlayOutHoldsAttacks: true,
    // It glides: its Move loop read at its own pace (the template's speed).
    walkRef: 7,
    runRef: 7,
    attackTimeScale: 1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.06,
    clickRadius: 3.4,
  },
  smith_heart_quench_guardian: {
    url: QUENCH_BODY_URL,
    animUrls: [QUENCH_ENTRANCE_ANIMS_URL],
    height: QUENCH_BODY_HEIGHT,
    clips: QUENCH_CLIPS,
    phaseClips: {
      // Her entrance (smith_heart_fx/quench_entrance_core.ts): frozen under
      // the ice, then the burst and the rise (the Emerge one-shot).
      [QUENCH_BODY_GESTURES.frozen]: { clips: QUENCH_FROZEN },
      [QUENCH_BODY_GESTURES.emerge]: { clips: QUENCH_CLIPS, enter: 'Emerge' },
      [QUENCH_BODY_GESTURES.stand]: { clips: QUENCH_CLIPS },
    },
    castClipSync: [QUENCH_CASTS.breath, QUENCH_CASTS.wake],
    glowPulses: {
      // Her eyes, crown, heart and frost cracks flare as the breath is loosed
      // and the blades are thrown awake.
      pulses: [
        { gesture: QUENCH_BODY_GESTURES.flare, rise: 0.12, hold: 0.3, fall: 1.0, peak: 2.0 },
        // Frozen under the ice: her light out and her colour dulled to grey
        // while it is re-sent (smith_heart_fx/quench_entrance_fx.ts), filling
        // back over the fall once she breaks out.
        {
          gesture: QUENCH_BODY_GESTURES.frozenDim,
          rise: 0,
          hold: 1.0,
          fall: 1.2,
          peak: 0.03,
          shade: 0.62,
        },
        // Tempering Strike's wind-up: the cold gathers on her raised bracers
        // and her cracks, blazing to the slam a second on.
        {
          gesture: QUENCH_BODY_GESTURES.strikeRaise,
          rise: 0.9,
          hold: 0.15,
          fall: 0.7,
          peak: 1.8,
        },
      ],
      // Dead, frozen into a statue, her light goes out.
      deathFade: 3.5,
    },
    // A swing never cuts the breath, the wake, the strike (its wind-up held
    // through the swing it slams on), the taunt or a slash's command.
    oneShotsHoldAttacks: [
      'Emerge',
      'Breath',
      'Wake',
      'Strike',
      'StrikeRaise',
      'StrikeFall',
      'StrikeSlam',
      'StrikeSpent',
      'StrikeSlamHigh',
      'StrikeSpentHigh',
      'Taunt',
      'Slash',
    ],
    castPlayOutHoldsAttacks: true,
    // Her slow regal walk: its Move loop read at the template's own speed.
    walkRef: 7,
    runRef: 7,
    attackTimeScale: 1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.07,
    clickRadius: 2.6,
  },
  smith_heart_heat_guardian: {
    url: HEAT_BODY_URL,
    height: HEAT_BODY_HEIGHT,
    hover: HEAT_BODY_HOVER,
    clips: HEAT_BASE,
    phaseClips: {
      [HEAT_BODY_GESTURES.sink]: { clips: HEAT_UNDER, enter: 'Sink' },
      [HEAT_BODY_GESTURES.under]: { clips: HEAT_UNDER },
      [HEAT_BODY_GESTURES.rise]: { clips: HEAT_BASE, enter: 'Rise' },
      [HEAT_BODY_GESTURES.stand]: { clips: HEAT_BASE },
    },
    castClipSync: [HEAT_CASTS.fist],
    glowPulses: {
      // The fire flares through its cracks as it gathers and throws it.
      pulses: [{ gesture: HEAT_BODY_GESTURES.cast, rise: 0.4, hold: 0.2, fall: 0.6, peak: 1.7 }],
      // Dead, the lava in it cools to dark stone.
      deathFade: 4,
    },
    // A swing never cuts the plunge, the breach, the cast, the meteor throw or
    // Basalt Fist's slam.
    oneShotsHoldAttacks: ['Sink', 'Rise', 'Cast', 'Slam', 'Throw'],
    castPlayOutHoldsAttacks: true,
    attackTimeScale: 1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.05,
    clickRadius: 3.2,
  },
  smith_heart_masterless_strength: {
    url: MASTERLESS_STRENGTH_URL,
    animUrls: [MASTERLESS_STRENGTH_ARRIVAL_URL],
    height: FINAL_BODY_HEIGHT,
    clips: BASE,
    phaseClips: {
      [FINAL_BODY_GESTURES.kneel]: { clips: KNEELING, enter: 'Kneel' },
      [FINAL_BODY_GESTURES.stand]: { clips: BASE },
      // The arrival: dormant on its knee, then the push back to its feet.
      [FINAL_BODY_GESTURES.dormant]: { clips: DORMANT },
      [FINAL_BODY_GESTURES.rise]: { clips: BASE, enter: 'Rise' },
    },
    castClipSync: [FINAL_CASTS.fist, FINAL_CASTS.anvil, FINAL_CASTS.bolt],
    meshToggles: TOGGLES,
    glowPulses: {
      // The shell cracking before the element bursts out (final_body_core
      // FINAL_SHIFT.burst), the new body still white-hot after it.
      // The arrival's dormant stone: the cracks black and the body dulled to
      // dark stone while the gesture is re-sent (final_body_fx.ts), its
      // colour and light filling back over the fall once it stops.
      pulses: [
        { gesture: FINAL_BODY_GESTURES.charge, rise: 0.6, hold: 0.1, fall: 0.6, peak: 1.8 },
        {
          gesture: FINAL_BODY_GESTURES.dark,
          rise: 0,
          hold: 1.0,
          fall: 1.4,
          peak: 0,
          shade: 0.1,
        },
      ],
      deathFade: 3,
    },
    oneShotsHoldAttacks: ['Shift', 'Rise'],
    // Its stride: 4.8 model yards a cycle over 1.6 s at the drawn height.
    walkRef: 10,
    runRef: 10,
    attackTimeScale: 1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.04,
    clickRadius: 4.4,
  },
};
