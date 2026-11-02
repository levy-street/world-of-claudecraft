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
import {
  FINAL_BODY_CLIP,
  FINAL_BODY_ELEMENTS,
  FINAL_BODY_GESTURES,
  FINAL_BODY_HEIGHT,
  FINAL_BODY_NODES,
} from '../smith_heart_fx/final_body_core';
import { FORGE_FIST_CUE } from '../smith_heart_fx/final_fx_core';
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

export const SMITH_HEART_BOSS_LOOKS: Record<string, VisualDef> = {
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
