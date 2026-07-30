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

import { GULLHAVEN_HARBOR, type HarborDef, MAINLAND_HARBOR } from '../harbor_layout';
import { registerScenario } from '../scenarios/registry';
import {
  beat,
  buildScene,
  coveredCut,
  fadeInTail,
  SCENE_CUT_FADE_SECONDS,
  type SceneCameraShotDef,
  type SceneTimelineEntry,
} from '../scenes/authoring';
import { registerChoice } from '../scenes/choices';
import { registerScene, type SceneAttachShotDef, type SceneDollyShotDef } from '../scenes/registry';
import { DT, type MobTemplate, type NpcDef, type QuestDef } from '../types';
import {
  LAST_BELL_VOYAGE_SEGMENT_IDS,
  type LastBellPropPathSegmentId,
  LB_PROP_CUE_PARK,
} from './last_bell_cinematics';

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
    // His post is ON DECK at the top of the gangplank: he greets riders as
    // they step aboard, and stands close enough to the boarding point to
    // hand out Q0. The harbor layout is the single anchor source.
    pos: {
      x: MAINLAND_HARBOR.boarding.x - 2,
      z: MAINLAND_HARBOR.boarding.z - 0.9,
    },
    facing: MAINLAND_HARBOR.gangplank.facing,
    color: 0x4a5a7a,
    // Q0 is accepted automatically on the first crossing, but the canonical
    // giver link still belongs on Ewald for quest integrity, save repair, and
    // any host that opens the normal quest surface before boarding.
    questIds: ['q_lb_q0_ashore'],
    greeting:
      'The Farshore, is it? Nobody crosses for the fishing anymore, friend. Board when you are ready, and mind the bell when you land: the town listens to it the way you listen to weather.',
  },
  // The island side of the crossing: keeps the Gullhaven gangplank the way
  // Ewald keeps the mainland one. The return leg has a face too.
  ferrykeeper_odda: {
    id: 'ferrykeeper_odda',
    name: 'Ferrykeeper Odda',
    title: 'The Farshore Crossing',
    pos: {
      x: GULLHAVEN_HARBOR.boarding.x - 0.9,
      z: GULLHAVEN_HARBOR.boarding.z + 1.5,
    },
    facing: Math.PI / 2,
    color: 0x4a5a7a,
    questIds: [],
    greeting:
      'Mainland-bound? The ship goes when you are aboard, not before. And if you hear the bell start counting while we cast off, do not ask me to turn her around: nobody rows toward a three-toll.',
  },
  // Runs the militia line at the Watch Meadow. Operational, unsentimental,
  // knows exactly what his line can and cannot kill.
  sergeant_marsh: {
    id: 'sergeant_marsh',
    name: 'Sergeant Marsh',
    title: 'Town Militia',
    pos: { x: 992, z: 2 },
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

// Explicit and append-only like every other content pack's quest order. Q0 is
// appended after the established world quest vectors in data.ts so merging the
// campaign does not renumber any pre-existing observation slots.
export const LAST_BELL_CAMPAIGN_QUEST_ORDER = ['q_lb_q0_ashore'] as const;

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

// The ferry fare (H2): a personal dock prompt, not a story claim, so each
// rider pays their own passage (the leader-answers rule stays story-only)
// and the flag below is never written (the personal arm resolves through a
// callback). One def per direction: the prompt names where you are going.
// The price value interpolates {price} from the campaign module's
// FERRY_FARE_COPPER const.
const FARE_OPTIONS = [
  { id: 'pay', key: 'lb.fare.pay' },
  { id: 'decline', key: 'lb.fare.decline' },
] as const;

registerChoice({
  id: 'ch_lb_ferry_fare_out',
  promptKey: 'lb.fare.promptOut',
  flag: 'lb_ferry_fare',
  options: FARE_OPTIONS,
  windowSeconds: 25,
  defaultOptionId: 'decline',
});

registerChoice({
  id: 'ch_lb_ferry_fare_back',
  promptKey: 'lb.fare.promptBack',
  flag: 'lb_ferry_fare',
  options: FARE_OPTIONS,
  windowSeconds: 25,
  defaultOptionId: 'decline',
});

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

const PIER_SHOT_SECONDS = 5;
const LAST_BELL_HARBOR_LINE_SECONDS = 4.75;
const LAST_BELL_PLINTH_LINE_SECONDS = 7.5;
const LAST_BELL_TOLL_LINE_SECONDS = 6.5;

const VOYAGE_CORE_BEATS = {
  castOff: 0.2,
  openWater: 4.2,
  seaArrival: 8.5,
  pier: 12.8,
} as const;

const RERIDE_BEATS = {
  ...VOYAGE_CORE_BEATS,
  release: 17.8,
  end: 18.8,
} as const;

const Q0_VOYAGE_BEATS = {
  ...VOYAGE_CORE_BEATS,
  statue: 18.3,
  toll: 26.1,
  release: 33,
  end: 34,
} as const;

const Q0_DOORWAY_BEATS = {
  entrance: 0.5,
  facing: 3.5,
  tamLine: 4,
  coalfastLine: 9.5,
} as const;

type VoyageCoreBeat = keyof typeof VOYAGE_CORE_BEATS;
type ReleaseBeat = 'release' | 'end';
type Q0StoryBeat = 'statue' | 'toll';

interface VoyageDirection {
  readonly departureHarbor: HarborDef;
  readonly arrivalHarbor: HarborDef;
  readonly departureTarget: string;
  readonly arrivalTarget: string;
  readonly segmentIds: {
    readonly castOff: LastBellPropPathSegmentId;
    readonly openWater: LastBellPropPathSegmentId;
    readonly arrival: LastBellPropPathSegmentId;
  };
  readonly sternOffset: { x: number; y: number; z: number };
  readonly sideOffset: { x: number; y: number; z: number };
  readonly bowOffset: { x: number; y: number; z: number };
  readonly arrivalLookAt: { x: number; y: number; z: number };
  readonly walkTo: { x: number; z: number };
  readonly walkSpeed: number;
  readonly pierShot: SceneDollyShotDef;
}

const OUTBOUND: VoyageDirection = {
  departureHarbor: MAINLAND_HARBOR,
  arrivalHarbor: GULLHAVEN_HARBOR,
  departureTarget: 'harbor_ship_mainland',
  arrivalTarget: 'harbor_ship_gullhaven',
  segmentIds: LAST_BELL_VOYAGE_SEGMENT_IDS.out,
  sternOffset: { x: -20, y: 16, z: 22 },
  sideOffset: { x: 6.6, y: 18, z: -28 },
  bowOffset: { x: 6.6, y: 20, z: -20 },
  arrivalLookAt: { x: 24, y: 8.6, z: 0 },
  walkTo: { x: GULLHAVEN_HARBOR.gangplank.x, z: GULLHAVEN_HARBOR.gangplank.z },
  walkSpeed: 2.75,
  pierShot: {
    kind: 'dolly',
    points: [
      { x: 738, z: 110.609175, height: 20.203309 },
      { x: 727.5, z: 110.609175, height: 5.774799 },
    ],
    lookAt: {
      kind: 'spline',
      points: [
        { x: 733, z: 126, height: 2 },
        {
          x: GULLHAVEN_HARBOR.gangplank.x,
          z: GULLHAVEN_HARBOR.gangplank.z,
          height: 2,
        },
      ],
    },
    dur: PIER_SHOT_SECONDS,
  },
};

const RETURN: VoyageDirection = {
  departureHarbor: GULLHAVEN_HARBOR,
  arrivalHarbor: MAINLAND_HARBOR,
  departureTarget: 'harbor_ship_gullhaven',
  arrivalTarget: 'harbor_ship_mainland',
  segmentIds: LAST_BELL_VOYAGE_SEGMENT_IDS.back,
  sternOffset: { x: -20, y: 16, z: -22 },
  sideOffset: { x: 6.6, y: 18, z: 28 },
  bowOffset: { x: 6.6, y: 20, z: 20 },
  arrivalLookAt: { x: 24, y: 8.6, z: 0 },
  walkTo: { x: MAINLAND_HARBOR.gangplank.x, z: MAINLAND_HARBOR.gangplank.z },
  walkSpeed: 2.75,
  pierShot: {
    kind: 'dolly',
    points: [
      { x: 230.4, z: -66, height: 16.448243 },
      { x: 230.4, z: -62, height: 16.441451 },
      { x: 230.4, z: -59.390825, height: 15.369799 },
    ],
    lookAt: {
      kind: 'spline',
      points: [
        { x: 240.5, z: -50.6, height: 2 },
        { x: 235, z: -49, height: 2 },
        {
          x: MAINLAND_HARBOR.gangplank.x,
          z: MAINLAND_HARBOR.gangplank.z,
          height: 2,
        },
      ],
    },
    dur: PIER_SHOT_SECONDS,
  },
};

function attachShot(
  target: string,
  harbor: HarborDef,
  offset: { x: number; y: number; z: number },
  lookAt: { x: number; y: number; z: number } = { x: 6.6, y: 8.6, z: 0 },
): SceneAttachShotDef {
  return {
    kind: 'attach',
    target,
    fallbackFrame: {
      point: { x: harbor.berth.x, z: harbor.berth.z, height: -7.72 },
      yaw: harbor.berth.rot,
    },
    offset,
    lookAt,
  };
}

function blackTickCoveredCut<Beat extends string>(
  at: Beat,
  shot: SceneCameraShotDef,
): SceneTimelineEntry<Beat>[] {
  return [
    { at: beat(at, -DT), kind: 'fade', to: 'black', dur: 0 },
    coveredCut(at, shot),
  ];
}

function arrivalPierTimeline(
  direction: VoyageDirection,
  includeHarborLine: boolean,
): SceneTimelineEntry<VoyageCoreBeat>[] {
  const timeline: SceneTimelineEntry<VoyageCoreBeat>[] = [
    { at: 'pier', kind: 'prop', target: direction.arrivalTarget, cue: LB_PROP_CUE_PARK },
    ...blackTickCoveredCut('pier', direction.pierShot),
    {
      at: beat('pier', 0.4),
      kind: 'playerWalk',
      to: direction.walkTo,
      speed: direction.walkSpeed,
    },
  ];
  if (includeHarborLine) {
    timeline.push({
      at: beat('pier', 0.5),
      kind: 'line',
      speaker: '',
      key: 'lb.q0.scene.harbor',
      dur: LAST_BELL_HARBOR_LINE_SECONDS,
    });
  }
  return timeline;
}

function voyageTimeline(
  direction: VoyageDirection,
  includeHarborLine = false,
): SceneTimelineEntry<VoyageCoreBeat>[] {
  return [
    { at: 0, kind: 'letterbox', on: true },
    { at: 0, kind: 'inputLock', on: true },
    { at: 0, kind: 'music', directive: 'lb_harbor_ambience' },
    { at: 0, kind: 'fade', to: 'black', dur: 0 },
    {
      at: 'castOff',
      kind: 'prop',
      target: direction.departureTarget,
      cue: direction.segmentIds.castOff,
    },
    ...blackTickCoveredCut(
      'castOff',
      attachShot(direction.departureTarget, direction.departureHarbor, direction.sternOffset),
    ),
    { at: 1.2, kind: 'music', directive: 'lb_bell_toll_one' },
    { at: 1.8, kind: 'music', directive: 'lb_ship_castoff' },
    {
      at: 'openWater',
      kind: 'prop',
      target: direction.departureTarget,
      cue: direction.segmentIds.openWater,
    },
    ...blackTickCoveredCut(
      'openWater',
      attachShot(direction.departureTarget, direction.departureHarbor, direction.sideOffset),
    ),
    {
      at: 'seaArrival',
      kind: 'prop',
      target: direction.arrivalTarget,
      cue: direction.segmentIds.arrival,
    },
    ...blackTickCoveredCut(
      'seaArrival',
      attachShot(
        direction.arrivalTarget,
        direction.arrivalHarbor,
        direction.bowOffset,
        direction.arrivalLookAt,
      ),
    ),
    ...arrivalPierTimeline(direction, includeHarborLine),
  ];
}

const Q0_STATUE_SHOT: SceneDollyShotDef = {
  kind: 'dolly',
  points: [
    { x: 806, z: 112, height: 8 },
    { x: 808, z: 113, height: 7.4 },
  ],
  lookAt: { kind: 'point', point: { x: 818, z: 120, height: 2 } },
  dur: 4.8,
  subjectRef: 'statueBlock',
};

const Q0_TOLL_SHOT: SceneDollyShotDef = {
  kind: 'dolly',
  points: [
    { x: 808, z: 113, height: 7.4 },
    { x: 780, z: 115, height: 5.9 },
    { x: 755, z: 116, height: 8 },
    { x: 727.5, z: 110.609175, height: 5.774799 },
  ],
  lookAt: {
    kind: 'spline',
    points: [
      { x: 818, z: 120, height: 2 },
      { x: 786, z: 122, height: 2 },
      { x: 755, z: 122, height: 2 },
      {
        x: GULLHAVEN_HARBOR.gangplank.x,
        z: GULLHAVEN_HARBOR.gangplank.z,
        height: 2,
      },
    ],
  },
  dur: 6.45,
};

function q0StoryTimeline(): SceneTimelineEntry<Q0StoryBeat>[] {
  return [
    ...blackTickCoveredCut('statue', Q0_STATUE_SHOT),
    {
      at: beat('statue', 0.2),
      kind: 'line',
      speaker: '',
      key: 'lb.q0.scene.plinth',
      dur: LAST_BELL_PLINTH_LINE_SECONDS,
    },
    { at: beat('toll', -0.1), kind: 'music', directive: 'lb_bell_toll_one' },
    ...blackTickCoveredCut('toll', Q0_TOLL_SHOT),
    {
      at: beat('toll', 0.2),
      kind: 'line',
      speaker: '',
      key: 'lb.q0.scene.toll',
      dur: LAST_BELL_TOLL_LINE_SECONDS,
    },
  ];
}

function releaseTimeline(): SceneTimelineEntry<ReleaseBeat>[] {
  return [
    {
      at: beat('release', -(SCENE_CUT_FADE_SECONDS + DT)),
      kind: 'fade',
      to: 'black',
      dur: SCENE_CUT_FADE_SECONDS,
    },
    { at: beat('release', -DT), kind: 'fade', to: 'black', dur: 0 },
    { at: 'release', kind: 'fade', to: 'black', dur: 0 },
    { at: 'release', kind: 'camera', shot: { kind: 'release' } },
    fadeInTail(beat('release', DT)),
    { at: 'end', kind: 'letterbox', on: false },
    { at: 'end', kind: 'inputLock', on: false },
  ];
}

registerScene(
  buildScene({
    id: 'scn_lb_ferry_depart_out',
    beats: RERIDE_BEATS,
    releaseMargin: 0,
    timeline: [...voyageTimeline(OUTBOUND), ...releaseTimeline()],
  }),
);

registerScene(
  buildScene({
    id: 'scn_lb_ferry_depart_back',
    beats: RERIDE_BEATS,
    releaseMargin: 0,
    timeline: [...voyageTimeline(RETURN), ...releaseTimeline()],
  }),
);

registerScene(
  buildScene({
    id: 'scn_lb_q0_voyage',
    beats: Q0_VOYAGE_BEATS,
    releaseMargin: 0,
    timeline: [
      ...voyageTimeline(OUTBOUND, true),
      ...q0StoryTimeline(),
      ...releaseTimeline(),
    ],
  }),
);

// Staged, unlocked: two in the doorway. You keep control; Tam's line lands
// while you catch your breath, and the grey man looks at you slightly
// longer, then leaves the recruiting unsaid.
registerScene(
  buildScene({
    id: 'scn_lb_q0_doorway',
    beats: Q0_DOORWAY_BEATS,
    releaseMargin: 0,
    timeline: [
      { at: 'entrance', kind: 'actorMove', actorId: 'tam', x: -2, z: -14 },
      { at: 'entrance', kind: 'actorMove', actorId: 'coalfast', x: 2, z: -14 },
      { at: 'facing', kind: 'actorFace', actorId: 'tam', facing: 0 },
      { at: 'facing', kind: 'actorFace', actorId: 'coalfast', facing: 0 },
      {
        at: 'tamLine',
        kind: 'line',
        speaker: 'lb.speaker.tam',
        speakerActorId: 'tam',
        key: 'lb.q0.tam.stretchers',
        dur: 5,
      },
      {
        at: 'coalfastLine',
        kind: 'line',
        speaker: '',
        key: 'lb.q0.coalfast.look',
        dur: 5.5,
      },
    ],
  }),
);

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
