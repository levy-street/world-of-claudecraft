// The Last Bell campaign content, act by act. Source of truth:
// docs/design/last-bell-campaign.html (the QUESTS array); this module is
// its data-as-code translation. Quests ride the normal quest pipeline;
// scenarios/scenes/choices register into their engines at module load
// (data.ts imports this module, so every host registers identically).
//
// Q0 "Ashore": step off the ferry (the arrival cutscene teaches the island
// in one image), prove yourself in the Watch Meadow, and clear the
// Tidemill alone. The recruitment must be earned personally: the mill is a
// solo-always story space, and Coalfast and Tam walk into the doorway as
// the stalker dies.

import { registerScenario } from '../scenarios/registry';
import { registerScene } from '../scenes/scenes';
import type { MobTemplate, NpcDef, QuestDef } from '../types';

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

export const LAST_BELL_CAMPAIGN_MOBS: Record<string, MobTemplate> = {
  // Q0 boss: digs into the mill wearing the miller's roof. Tuned to
  // demonstrate the gap between the player and the militia, not to be a
  // wall (campaign doc, ENEMIES). Burrow/webs read through its add waves
  // and the webbed-exit props; fixed level so scenario spawns draw no rng.
  tidemill_stalker: {
    id: 'tidemill_stalker',
    name: 'The Tidemill Stalker',
    minLevel: 5,
    maxLevel: 5,
    family: 'beast',
    hpBase: 210,
    hpPerLevel: 22,
    dmgBase: 11,
    dmgPerLevel: 2.0,
    attackSpeed: 2.1,
    armorPerLevel: 12,
    moveSpeed: 8.5,
    aggroRadius: 18,
    elite: true,
    loot: [],
    scale: 1.5,
    color: 0x3a4a2f,
  },
};

// ---------------------------------------------------------------------------
// NPCs (campaign cast additions; the six defenders already stand at their
// posts in FARSHORE_NPCS)
// ---------------------------------------------------------------------------

export const LAST_BELL_CAMPAIGN_NPCS: Record<string, NpcDef> = {
  // The mainland side of the crossing. He sells nothing and saves lives
  // anyway: the ferry is how a proven hand reaches a besieged island.
  ferryman_ewald: {
    id: 'ferryman_ewald',
    name: 'Ferryman Ewald',
    title: 'The Farshore Crossing',
    pos: { x: 144, z: -54 },
    facing: Math.PI / 3,
    color: 0x4a5a7a,
    questIds: [],
    greeting:
      'The Farshore, is it? Nobody crosses for the fishing anymore, friend. Board when you are ready, and mind the bell when you land: the town listens to it the way you listen to weather.',
  },
  // Runs the militia line at the Watch Meadow. Operational, unsentimental,
  // knows exactly what his line can and cannot kill.
  sergeant_marsh: {
    id: 'sergeant_marsh',
    name: 'Sergeant Marsh',
    title: 'Town Militia',
    pos: { x: 377, z: -4 },
    facing: -Math.PI / 2,
    color: 0x6a5a3a,
    questIds: [],
    greeting:
      'Trained? Then here is how tonight works. My line holds the road. If the rift coughs up something we cannot put down, I point at you. The mill is yours: nothing follows you in, nothing gets past us to town. Go.',
  },
};

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export const LAST_BELL_CAMPAIGN_QUESTS: Record<string, QuestDef> = {
  // Q0 Ashore. Accepted automatically when the ferry lands (the campaign
  // module's ferry arm calls acceptQuest); turned in to Warden Coalfast,
  // whose completion text is the recruitment.
  q_lb_q0_ashore: {
    id: 'q_lb_q0_ashore',
    name: 'Ashore',
    giverNpcId: 'ferryman_ewald',
    turnInNpcId: 'warden_coalfast',
    text: 'Gullhaven takes the breaks day and night and holds anyway. If you mean to stand with them, start where the town bleeds: the militia line at the Watch Meadow, east past the harbor steps and the old statue.',
    completionText:
      'The mill kill was yours alone, and Tam does not exaggerate about stretchers. I am short a scout and long on fields. You held ground tonight that was not yours to hold, and that is the whole job. Welcome to the watch.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'sergeant_marsh',
        count: 1,
        label: 'Report to Sergeant Marsh at the Watch Meadow',
      },
      { type: 'kill', targetMobId: 'riftspawn', count: 12, label: 'Riftspawn slain' },
      {
        type: 'kill',
        targetMobId: 'tidemill_stalker',
        count: 1,
        label: 'Put down whatever is in the Tidemill',
      },
    ],
    xpReward: 900,
    copperReward: 60,
    itemRewards: {},
    minLevel: 3,
  },
};

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

// The one locked Q0 cutscene (20s): the opening shot, a street that stops
// to count a bell. Personal shared-world playback on ferry arrival; camera
// points are WORLD coordinates (Gullhaven harbor).
registerScene({
  id: 'scn_lb_q0_ashore',
  duration: 20,
  ops: [
    { at: 0, kind: 'letterbox', on: true },
    { at: 0, kind: 'inputLock', on: true },
    { at: 0, kind: 'fade', to: 'clear', dur: 1.2 },
    // Wide of the working harbor from over the water.
    {
      at: 0.2,
      kind: 'camera',
      shot: { kind: 'focus', x: 296, z: 84, dist: 26, pitch: 0.42, yaw: 2.6, dur: 5 },
    },
    { at: 1.0, kind: 'line', speaker: '', key: 'lb.q0.scene.harbor', dur: 4.5 },
    // The statue above the harbor steps, close: the plinth and its names.
    {
      at: 6.0,
      kind: 'camera',
      shot: { kind: 'focus', x: 303, z: 72, dist: 6, pitch: 0.18, yaw: -0.6, dur: 4 },
    },
    { at: 6.5, kind: 'line', speaker: '', key: 'lb.q0.scene.plinth', dur: 4.5 },
    // The bell tolls once; the street stops, counts, exhales.
    { at: 11.5, kind: 'music', directive: 'lb_bell_toll_one' },
    {
      at: 11.8,
      kind: 'camera',
      shot: { kind: 'focus', x: 305, z: 70, dist: 14, pitch: 0.3, yaw: 0.8, dur: 5 },
    },
    { at: 12.2, kind: 'line', speaker: '', key: 'lb.q0.scene.toll', dur: 5 },
    { at: 17.5, kind: 'camera', shot: { kind: 'release' } },
    { at: 18.4, kind: 'letterbox', on: false },
    { at: 18.4, kind: 'inputLock', on: false },
  ],
});

// Staged, unlocked: two in the doorway. You keep control; Tam's line lands
// while you catch your breath, and the grey man looks at you slightly
// longer, then leaves the recruiting unsaid.
registerScene({
  id: 'scn_lb_q0_doorway',
  duration: 12,
  ops: [
    { at: 0.5, kind: 'actorMove', actorId: 'tam', x: -2, z: -14 },
    { at: 0.5, kind: 'actorMove', actorId: 'coalfast', x: 2, z: -14 },
    { at: 3.5, kind: 'actorFace', actorId: 'tam', facing: 0 },
    { at: 3.5, kind: 'actorFace', actorId: 'coalfast', facing: 0 },
    {
      at: 4.0,
      kind: 'line',
      speaker: 'lb.speaker.tam',
      speakerActorId: 'tam',
      key: 'lb.q0.tam.stretchers',
      dur: 5,
    },
    { at: 9.5, kind: 'line', speaker: '', key: 'lb.q0.coalfast.look', dur: 2.4 },
  ],
});

// ---------------------------------------------------------------------------
// Scenario: the Tidemill (solo instance climax)
// ---------------------------------------------------------------------------

registerScenario({
  id: 'sc_lb_q0_tidemill',
  dungeonId: 'lb_tidemill',
  questId: 'q_lb_q0_ashore',
  // No squad at entry: the player clears the mill ALONE. Coalfast and Tam
  // arrive with the doorway stage below.
  stages: [
    {
      id: 'lair',
      // Quest objective 2: put down whatever is in the Tidemill.
      objective: { kind: 'quest', objectiveIndex: 2 },
      spawns: [{ mobId: 'tidemill_stalker', count: 1, x: 0, z: 6, radius: 0.5, aggro: true }],
      // The stalker burrows and calls two add waves of six.
      timedSpawns: [
        { at: 12, spawns: [{ mobId: 'riftspawn', count: 6, x: 0, z: 4, radius: 7, aggro: true }] },
        { at: 32, spawns: [{ mobId: 'riftspawn', count: 6, x: 0, z: 4, radius: 7, aggro: true }] },
      ],
    },
    {
      id: 'doorway',
      objective: { kind: 'scene' },
      spawnSquad: { actorIds: ['coalfast', 'tam'] },
      squadAnchor: { x: 0, z: -20 },
      sceneId: 'scn_lb_q0_doorway',
      retryOnWipe: false,
    },
  ],
  // The two walk back toward the cliffs when the moment ends.
  despawnSquadOnComplete: true,
});
