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
import { beat, buildScene, coveredCut, type SceneTimelineEntry } from '../scenes/authoring';
import { registerChoice } from '../scenes/choices';
import { registerScene, type SceneAttachShotDef, type SceneDollyShotDef } from '../scenes/registry';
import type { MobTemplate, NpcDef, QuestDef } from '../types';
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

// Both posts come from the harbor layout's generated keeper anchor rather than
// a world-axis nudge off the boarding point: the anchor is derived from the
// ship's own mating edge, so it stays aboard and beside the route whatever the
// measured deck turns out to be at either berth.
const EWALD_POST = MAINLAND_HARBOR.keeperPost;
const GULLHAVEN_EWALD_POST = GULLHAVEN_HARBOR.keeperPost;

const EWALD_IDENTITY = {
  name: 'Ferryman Ewald',
  title: 'The Farshore Crossing',
  color: 0x4a5a7a,
  greeting:
    'The Farshore, is it? Nobody crosses for the fishing anymore, friend. Board when you are ready, and mind the bell when you land: the town listens to it the way you listen to weather.',
} as const;

export const LAST_BELL_CAMPAIGN_NPCS: Record<string, NpcDef> = {
  // The mainland side of the crossing. He sells nothing and saves lives
  // anyway: the ferry is how a proven hand reaches a besieged island.
  ferryman_ewald: {
    id: 'ferryman_ewald',
    ...EWALD_IDENTITY,
    // His post is ON DECK at the top of the gangplank: he greets riders as
    // they step aboard, and stands close enough to the boarding point to
    // hand out Q0. The harbor layout is the single anchor source.
    pos: EWALD_POST,
    facing: Math.atan2(
      MAINLAND_HARBOR.gangplank.x - EWALD_POST.x,
      MAINLAND_HARBOR.gangplank.z - EWALD_POST.z,
    ),
    // Q0 is accepted automatically on the first crossing, but the canonical
    // giver link still belongs on Ewald for quest integrity, save repair, and
    // any host that opens the normal quest surface before boarding.
    questIds: ['q_lb_q0_ashore'],
  },
  // The same Ewald identity at the island end, following the classic MMO
  // convention that the ferryman crosses with his boat. A second template id
  // is required because the fixture spawner places each template once.
  ferryman_ewald_gullhaven: {
    id: 'ferryman_ewald_gullhaven',
    ...EWALD_IDENTITY,
    pos: GULLHAVEN_EWALD_POST,
    facing: Math.atan2(
      GULLHAVEN_HARBOR.gangplank.x - GULLHAVEN_EWALD_POST.x,
      GULLHAVEN_HARBOR.gangplank.z - GULLHAVEN_EWALD_POST.z,
    ),
    questIds: [],
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

const LAST_BELL_HARBOR_LINE_SECONDS = 4.75;
const LAST_BELL_PLINTH_LINE_SECONDS = 7.5;
const LAST_BELL_TOLL_LINE_SECONDS = 6.5;
const LANDING_SHOT_SECONDS = 6;

// Owner pass three grammar: exactly TWO fades in the whole voyage. The scene
// opens on a hard cut straight into the cast-off shot (the boat visibly gets
// under way from the first frame), a film fade carries cast-off to the
// open-water leg and another carries open water to the arrival glide, and
// everything after that is fade-free: a hard cut to the landing dolly with
// the ship already parked, and a visible ease back to gameplay. The fades
// themselves keep the film shape: 1.5 s down, 1 s of black, 2 s up, with the
// fade-in starting half the hold after the cut so the boat is already
// composed and under way in its new position before anything is visible.
const VOYAGE_FADE_OUT_SECONDS = 1.5;
const VOYAGE_FADE_IN_SECONDS = 2;
const VOYAGE_HOLD_SECONDS = 1;
const VOYAGE_CUT = {
  fadeSeconds: VOYAGE_FADE_OUT_SECONDS,
  fadeInSeconds: VOYAGE_FADE_IN_SECONDS,
  holdSeconds: VOYAGE_HOLD_SECONDS,
} as const;

// openWater and seaArrival sit late enough that every shot holds fully clear
// for a real beat between the two fade pairs.
const VOYAGE_CORE_BEATS = {
  open: 0,
  castOff: 0,
  openWater: 7,
  seaArrival: 13,
  park: 19.05,
} as const;

const RERIDE_BEATS = {
  ...VOYAGE_CORE_BEATS,
  release: 26.3,
  end: 27.15,
} as const;

const Q0_VOYAGE_BEATS = {
  ...VOYAGE_CORE_BEATS,
  statue: 19.05,
  toll: 26.95,
  release: 33.85,
  end: 34.7,
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

// J3, the voyage camera language. One angle family carries the whole journey:
// every leg (cast-off, open water, and the approach) is an ATTACH shot rigid
// with the sailing ship, holding the SAME wide abeam frame. The offsets are
// ship-local: 44 yd abeam and 14 yd up frames the ENTIRE hull with her masts
// inside the 60 degree frustum and water and sky around her, and the look-at
// pulled 11.5 yd toward the camera keeps the framing subject inside the
// linter's 5 percent floor while the hull itself reads at journey scale.
// Because all three shots share one local frame, every covered cut dissolves
// from the ship mid-frame to the ship mid-frame, same size, same heading:
// one boat further along her crossing, never a new boat. Variation inside a
// shot comes free from the attach rig: the sea, the coast, and the harbor
// slide past while she holds steady.
const JOURNEY_CAMERA_ABEAM_YARDS = 44;
const JOURNEY_CAMERA_HEIGHT_YARDS = 14;
const JOURNEY_LOOKAT_INSET_YARDS = 11.5;
const JOURNEY_LOOKAT_HEIGHT_YARDS = 15.5;
const JOURNEY_ALONG_YARDS = 2;

function journeyOffsets(side: 1 | -1): {
  offset: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
} {
  return {
    offset: {
      x: JOURNEY_ALONG_YARDS,
      y: JOURNEY_CAMERA_HEIGHT_YARDS,
      z: side * JOURNEY_CAMERA_ABEAM_YARDS,
    },
    lookAt: {
      x: JOURNEY_ALONG_YARDS,
      y: JOURNEY_LOOKAT_HEIGHT_YARDS,
      z: side * JOURNEY_LOOKAT_INSET_YARDS,
    },
  };
}

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
  // The one journey frame, ship-local. side -1 rides the out crossing's
  // southern flank; the return mirrors it so the camera keeps open water
  // behind it in both directions.
  readonly journeySide: 1 | -1;
  readonly walkTo: { x: number; z: number };
  readonly walkSpeed: number;
  readonly landingShot: SceneDollyShotDef;
  // The authored hand-back: the release eases the camera to this gameplay
  // pose around the player at the destination gangplank, camera on the pier
  // side with a clear line (the pre-scene yaw would put it behind the mast).
  readonly releasePose: { yaw: number; pitch: number };
}

const OUTBOUND: VoyageDirection = {
  departureHarbor: MAINLAND_HARBOR,
  arrivalHarbor: GULLHAVEN_HARBOR,
  departureTarget: 'harbor_ship_mainland',
  arrivalTarget: 'harbor_ship_gullhaven',
  segmentIds: LAST_BELL_VOYAGE_SEGMENT_IDS.out,
  journeySide: -1,
  walkTo: { x: GULLHAVEN_HARBOR.gangplank.x, z: GULLHAVEN_HARBOR.gangplank.z },
  walkSpeed: 2.75,
  landingShot: {
    kind: 'dolly',
    points: [
      { x: 693, z: 113.9, height: 23.659148 },
      { x: 693, z: 96.5, height: 24.096469 },
      { x: 701, z: 86.5, height: 25.597703 },
      { x: 719, z: 86.5, height: 25.045709 },
      { x: 725, z: 93.5, height: 22.685134 },
      { x: 723.5, z: 105.109175, height: 15.369799 },
    ],
    // The look-at rides the arrival walk: down the parked deck, through the
    // gangway cut, across the boarding bridge, settling on the gangplank.
    lookAt: {
      kind: 'spline',
      points: [
        { x: 713, z: 111, height: 2.47 },
        { x: 716, z: 114, height: 1.97 },
        { x: 721.4, z: 116.25, height: 1.87 },
        {
          x: GULLHAVEN_HARBOR.gangplank.x,
          z: GULLHAVEN_HARBOR.gangplank.z,
          height: 2,
        },
      ],
    },
    dur: LANDING_SHOT_SECONDS,
  },
  // Hand back looking north from just south of the gangplank: the player
  // front and center, the moored ship off to the side, nothing between
  // camera and player. Yaw 0 also matches the landing dolly's final gaze,
  // so the release ease is a settle, not a swing. No authored dist: the
  // release keeps the player's own pre-scene zoom.
  releasePose: { yaw: 0, pitch: 0.35 },
};

const RETURN: VoyageDirection = {
  departureHarbor: GULLHAVEN_HARBOR,
  arrivalHarbor: MAINLAND_HARBOR,
  departureTarget: 'harbor_ship_gullhaven',
  arrivalTarget: 'harbor_ship_mainland',
  segmentIds: LAST_BELL_VOYAGE_SEGMENT_IDS.back,
  journeySide: 1,
  walkTo: { x: MAINLAND_HARBOR.gangplank.x, z: MAINLAND_HARBOR.gangplank.z },
  walkSpeed: 2.75,
  landingShot: {
    kind: 'dolly',
    points: [
      { x: 260.5, z: -50.6, height: 23.67159 },
      { x: 260.5, z: -68, height: 24.393817 },
      { x: 252.5, z: -78, height: 25.647641 },
      { x: 234.5, z: -78, height: 25.962952 },
      { x: 228.5, z: -71, height: 18.562805 },
      { x: 230.4, z: -59.390825, height: 15.369799 },
    ],
    lookAt: {
      kind: 'spline',
      points: [
        { x: 240.5, z: -52, height: 2.47 },
        { x: 238, z: -48.9, height: 1.97 },
        { x: 232.1, z: -48.25, height: 1.87 },
        {
          x: MAINLAND_HARBOR.gangplank.x,
          z: MAINLAND_HARBOR.gangplank.z,
          height: 2,
        },
      ],
    },
    dur: LANDING_SHOT_SECONDS,
  },
  // The same north-facing hand-back as the Gullhaven arrival: south of the
  // gangplank, clear of the hull, aligned with the landing dolly's gaze.
  releasePose: { yaw: 0, pitch: 0.35 },
};

function attachShot(
  target: string,
  harbor: HarborDef,
  offset: { x: number; y: number; z: number },
  lookAt: { x: number; y: number; z: number },
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

function arrivalTimeline(
  direction: VoyageDirection,
  includeHarborLine: boolean,
): SceneTimelineEntry<VoyageCoreBeat>[] {
  const timeline: SceneTimelineEntry<VoyageCoreBeat>[] = [
    { at: 'park', kind: 'prop', target: direction.arrivalTarget, cue: LB_PROP_CUE_PARK },
    {
      at: 'park',
      kind: 'playerWalk',
      to: direction.walkTo,
      speed: direction.walkSpeed,
    },
  ];
  if (includeHarborLine) {
    timeline.push({
      at: beat('seaArrival', 1.7),
      kind: 'line',
      speaker: '',
      key: 'lb.q0.scene.harbor',
      dur: LAST_BELL_HARBOR_LINE_SECONDS,
    });
  } else {
    // A hard cut, not a fade (owner pass three): the arrival glide ends with
    // the ship exactly at her parked pose before the park beat, so the cut
    // lands on a composed landing frame with nothing left to hide.
    timeline.push({
      at: 'park',
      kind: 'camera',
      shot: { ...direction.landingShot, entry: 'snap' },
    });
  }
  return timeline;
}

function voyageTimeline(
  direction: VoyageDirection,
  includeHarborLine = false,
): SceneTimelineEntry<VoyageCoreBeat>[] {
  const journey = journeyOffsets(direction.journeySide);
  return [
    { at: 0, kind: 'letterbox', on: true },
    { at: 0, kind: 'inputLock', on: true },
    { at: 0, kind: 'music', directive: 'lb_harbor_ambience' },
    // The scene opens on a HARD CUT straight into the journey frame (no
    // fade, owner pass three): the shot snaps so the first cinematic frame
    // is already composed, and the cast-off cue fires at the same instant,
    // so the player's deck stand-in exists from frame one and the boat
    // visibly gets under way with the berth sliding astern.
    {
      at: 'open',
      kind: 'camera',
      shot: {
        ...attachShot(
          direction.departureTarget,
          direction.departureHarbor,
          journey.offset,
          journey.lookAt,
        ),
        entry: 'snap',
      },
    },
    {
      at: 'castOff',
      kind: 'prop',
      target: direction.departureTarget,
      cue: direction.segmentIds.castOff,
    },
    { at: 1.6, kind: 'music', directive: 'lb_bell_toll_one' },
    { at: 2.2, kind: 'music', directive: 'lb_ship_castoff' },
    {
      at: 'openWater',
      kind: 'prop',
      target: direction.departureTarget,
      cue: direction.segmentIds.openWater,
    },
    // The SAME frame on the open-water leg: the dissolve reads as the same
    // boat further out, mid-strait.
    coveredCut(
      'openWater',
      attachShot(
        direction.departureTarget,
        direction.departureHarbor,
        journey.offset,
        journey.lookAt,
      ),
      VOYAGE_CUT,
    ),
    {
      at: 'seaArrival',
      kind: 'prop',
      target: direction.arrivalTarget,
      cue: direction.segmentIds.arrival,
    },
    // And the SAME frame again for the approach: she swings toward the berth
    // inside the shot while the camera rides with her.
    coveredCut(
      'seaArrival',
      attachShot(direction.arrivalTarget, direction.arrivalHarbor, journey.offset, journey.lookAt),
      VOYAGE_CUT,
    ),
    ...arrivalTimeline(direction, includeHarborLine),
  ];
}

// Hale's memorial now stands on the berm crest north of the redoubt (805,139,
// terrain 9.4) instead of in the market, so this beat is re-composed rather
// than just re-aimed: the camera climbs the berm's south face from below and
// looks UP at the bronze against the sky, which is the angle a memorial on a
// hill wants. `height` is yards above terrain at each point (scenes.ts
// resolves it against groundPos), and the terrain climbs from 5.9 at z=127 to
// 9.4 at the crest, so these read lower than they look. The lookAt sits 3.4 up
// to hold the FIGURE, not the plinth. The cut into the toll beat is
// fade-covered, so the jump to that shot's own opening needs no continuity.
const Q0_STATUE_SHOT: SceneDollyShotDef = {
  kind: 'dolly',
  points: [
    { x: 802, z: 127, height: 3.5 },
    { x: 804, z: 132, height: 2.8 },
  ],
  lookAt: { kind: 'point', point: { x: 805, z: 139, height: 3.4 } },
  dur: 4.8,
  subjectRef: 'wardenHaleStatue',
};

const Q0_TOLL_SHOT: SceneDollyShotDef = {
  kind: 'dolly',
  points: [
    { x: 808, z: 113, height: 7.4 },
    { x: 780, z: 115, height: 5.9 },
    { x: 755, z: 116, height: 8 },
    { x: 723.5, z: 105.109175, height: 15.369799 },
  ],
  lookAt: {
    kind: 'spline',
    points: [
      { x: 818, z: 120, height: 2 },
      { x: 785, z: 122, height: 2 },
      { x: 755, z: 121.5, height: 2 },
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
    coveredCut('statue', Q0_STATUE_SHOT, VOYAGE_CUT),
    {
      at: beat('statue', 0.2),
      kind: 'line',
      speaker: '',
      key: 'lb.q0.scene.plinth',
      dur: LAST_BELL_PLINTH_LINE_SECONDS,
    },
    { at: beat('toll', -0.1), kind: 'music', directive: 'lb_bell_toll_one' },
    coveredCut('toll', Q0_TOLL_SHOT, VOYAGE_CUT),
    {
      at: beat('toll', 0.2),
      kind: 'line',
      speaker: '',
      key: 'lb.q0.scene.toll',
      dur: LAST_BELL_TOLL_LINE_SECONDS,
    },
  ];
}

function releaseTimeline(direction: VoyageDirection): SceneTimelineEntry<ReleaseBeat>[] {
  return [
    // No fade (owner pass three): the release EASES visibly from the landing
    // dolly's final frame to the authored gameplay pose (pier side, clear
    // line to the player, aligned with the dolly's gaze so the ease is a
    // settle, not a swing). The walk moved the player to the destination
    // gangplank, which is why the pose is authored at all.
    { at: 'release', kind: 'camera', shot: { kind: 'release', pose: direction.releasePose } },
    { at: 'end', kind: 'letterbox', on: false },
    { at: 'end', kind: 'inputLock', on: false },
  ];
}

registerScene(
  buildScene({
    id: 'scn_lb_ferry_depart_out',
    beats: RERIDE_BEATS,
    releaseMargin: 0,
    timeline: [...voyageTimeline(OUTBOUND), ...releaseTimeline(OUTBOUND)],
  }),
);

registerScene(
  buildScene({
    id: 'scn_lb_ferry_depart_back',
    beats: RERIDE_BEATS,
    releaseMargin: 0,
    timeline: [...voyageTimeline(RETURN), ...releaseTimeline(RETURN)],
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
      ...releaseTimeline(OUTBOUND),
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
