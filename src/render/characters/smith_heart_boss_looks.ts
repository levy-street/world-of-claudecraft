// The Smith's Heart's own boss models (docs/design/raid/smith_heart.md, the
// art pipeline of WoC_Model_Pipeline_Guide: a concept T-pose turnaround,
// Tripo3D, a skeleton built for the mesh in Blender with hand-solved
// weights, every clip authored for it at 30 fps). manifest.ts merges
// SMITH_HEART_BOSS_LOOKS into VISUALS; smith_heart_placeholder_looks.ts
// points each boss's template at its key.
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

// The Guardian of the Quench (the Frozen Lake, design doc 7.3): an ice queen,
// one rigged mesh, her gown and her hair on their own bone chains (their sway
// and follow-through baked into every clip). She walks with a slow regal step
// under the gown; her swings alternate a right backhand and a left hook, the
// ice bracers leading; Tempering Strike raises both fists over her head on
// the fight's wind-up cue a second ahead of the cleave and hammers them down on
// it (StrikeWind; the cleave's own cue plays the short Strike only when no
// wind-up was seen); Quenching Breath rears her back through its bar
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
    StrikeWind: [QUENCH_BODY_CLIP.strikeWind],
  },
  attackByAbility: {
    [ARC_CLEAVE_ABILITY]: 'Strike',
    [QUENCH_BODY_GESTURES.strikeWind]: 'StrikeWind',
    [QUENCH_BODY_GESTURES.taunt]: 'Taunt',
    [QUENCH_BODY_GESTURES.slash]: 'Slash',
  },
  attackTimeScaleByAbility: {
    [ARC_CLEAVE_ABILITY]: 1,
    [QUENCH_BODY_GESTURES.strikeWind]: 1,
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
const BREATH_STORM = breathClips(true);

export const SMITH_HEART_BOSS_LOOKS: Record<string, VisualDef> = {
  smith_heart_breath_guardian: {
    url: BREATH_BODY_URL,
    height: BREATH_BODY_HEIGHT,
    clips: BREATH_CALM,
    phaseClips: {
      [BREATH_BODY_GESTURES.calm]: { clips: BREATH_CALM },
      [BREATH_BODY_GESTURES.storm]: { clips: BREATH_STORM },
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
    oneShotsHoldAttacks: ['Roar', 'StormBreaks', 'Cast', 'StormCast'],
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
    height: QUENCH_BODY_HEIGHT,
    clips: QUENCH_CLIPS,
    castClipSync: [QUENCH_CASTS.breath, QUENCH_CASTS.wake],
    glowPulses: {
      // Her eyes, crown, heart and frost cracks flare as the breath is loosed
      // and the blades are thrown awake.
      pulses: [
        { gesture: QUENCH_BODY_GESTURES.flare, rise: 0.12, hold: 0.3, fall: 1.0, peak: 2.0 },
        // Tempering Strike's wind-up: the cold gathers on her raised bracers
        // and her cracks, blazing to the slam a second on.
        {
          gesture: QUENCH_BODY_GESTURES.strikeWind,
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
    oneShotsHoldAttacks: ['Breath', 'Wake', 'Strike', 'StrikeWind', 'Taunt', 'Slash'],
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
    height: FINAL_BODY_HEIGHT,
    clips: BASE,
    phaseClips: {
      [FINAL_BODY_GESTURES.kneel]: { clips: KNEELING, enter: 'Kneel' },
      [FINAL_BODY_GESTURES.stand]: { clips: BASE },
    },
    castClipSync: [FINAL_CASTS.fist, FINAL_CASTS.anvil, FINAL_CASTS.bolt],
    meshToggles: TOGGLES,
    glowPulses: {
      // The shell cracking before the element bursts out (final_body_core
      // FINAL_SHIFT.burst), the new body still white-hot after it.
      pulses: [{ gesture: FINAL_BODY_GESTURES.charge, rise: 0.6, hold: 0.1, fall: 0.6, peak: 1.8 }],
      deathFade: 3,
    },
    oneShotsHoldAttacks: ['Shift'],
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
