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

import { FINAL_CASTS, FINAL_TUNING } from '../../sim/encounters/smith_heart/final_ids';
import { HEAT_CASTS, HEAT_TUNING } from '../../sim/encounters/smith_heart/heat_ids';
import {
  FINAL_BODY_CLIP,
  FINAL_BODY_ELEMENTS,
  FINAL_BODY_GESTURES,
  FINAL_BODY_HEIGHT,
  FINAL_BODY_NODES,
} from '../smith_heart_fx/final_body_core';
import { FORGE_FIST_CUE } from '../smith_heart_fx/final_fx_core';
import {
  HEAT_BODY_CLIP,
  HEAT_BODY_GESTURES,
  HEAT_BODY_HEIGHT,
  HEAT_BODY_HOVER,
  HEAT_BODY_URL,
} from '../smith_heart_fx/heat_body_core';
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

export const SMITH_HEART_BOSS_LOOKS: Record<string, VisualDef> = {
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
