// The wolf rig contract: what scripts/assets/wolf_rig/ ships and the game relies on.
//
// The clip NAMES are the game's contract (WOLF_BAKED in
// src/render/characters/manifest.ts picks from them) and a clip binds to the joints by
// NAME, so both lists are pinned: ship.mjs refuses a build that drifts from them and
// tests/wolf_rig.test.ts reads the shipped files against them.

/** The rebuilt files, relative to public/. */
export const WOLF_RIG_FILES = Object.freeze([
  'models/creatures/wolf_basic.glb',
  'models/creatures/greyjaw.glb',
]);

/** Every clip a rebuilt wolf ships (clips.py). */
export const WOLF_CLIPS = Object.freeze([
  'Idle',
  'Idle Alert',
  'Walk',
  'Sneak',
  'Gallop',
  'Attack',
  'Idle_HitReact_Left',
  'Idle_HitReact_Right',
  'Bark',
  'Howl',
  'Sit',
  'Jump',
  'Fall',
  'Death',
]);

/** The looping clips (clips.py loop=True): each one's last pose is its first, so the
 *  wrap never pops. */
export const WOLF_LOOPS = Object.freeze(['Idle', 'Walk', 'Sneak', 'Gallop', 'Sit', 'Fall']);

/** Every joint of the one skin, as anatomy.py names them. There is no jaw: the mouth
 *  stays shut as the body was modeled. */
export const WOLF_JOINT_NAMES = Object.freeze([
  'Root',
  'Pelvis',
  'Spine1',
  'Spine2',
  'Chest',
  'Neck1',
  'Neck2',
  'Head',
  'Ear_L',
  'EarTip_L',
  'Ear_R',
  'EarTip_R',
  'Scapula_L',
  'Humerus_L',
  'Forearm_L',
  'FrontPastern_L',
  'FrontPaw_L',
  'Scapula_R',
  'Humerus_R',
  'Forearm_R',
  'FrontPastern_R',
  'FrontPaw_R',
  'Thigh_L',
  'Shin_L',
  'HindPastern_L',
  'HindPaw_L',
  'Thigh_R',
  'Shin_R',
  'HindPastern_R',
  'HindPaw_R',
  'Tail1',
  'Tail2',
  'Tail3',
  'Tail4',
  'Tail5',
  'Tail6',
]);

/** The hit reacts are short flinches (the old file shipped the 2.8 s Bark under
 *  these names, so a struck wolf barked for seconds every time it was hit). */
export const WOLF_HIT_REACT_MAX_S = 1;

/** How far (GLB units) any skinned point may dip under the Idle's ground in any clip. */
export const WOLF_FLOOR_TOLERANCE = 0.02;

/** The size each wolf has always been drawn at: its VisualDef height over the raw height
 *  of its Idle as the game measures it (skin_pose.mjs idleHeight), as both shipped on the
 *  old dog rig (mob_wolf 1.6 over 1.8838, greyjaw 2.2 over 1.9542). A rebuild that changes
 *  the raw idle height re-derives the VisualDef height from this, so no wolf, nor the
 *  beast-family fallback or the Shadewolf drawn from the same file, changes size. */
export const WOLF_ON_SCREEN_SCALE = Object.freeze({
  mob_wolf: Object.freeze({ file: 'models/creatures/wolf_basic.glb', scale: 1.6 / 1.8838 }),
  greyjaw: Object.freeze({ file: 'models/creatures/greyjaw.glb', scale: 2.2 / 1.9542 }),
});

/** How far (a share of the scale) a VisualDef height may sit off WOLF_ON_SCREEN_SCALE. */
export const WOLF_ON_SCREEN_TOLERANCE = 0.005;
