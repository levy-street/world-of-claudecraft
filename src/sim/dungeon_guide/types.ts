// The dungeon guide system's shapes (src/sim/dungeon_guide): the DATA a guide
// record authors (content/dungeon_guides/*.ts) and the per-run STATE the sim
// keeps on the guide's own entity (Entity.guideRun). A pure type leaf: no
// runtime code, no SimContext.

import type { DungeonGuideState, OverheadEmoteId, Vec3 } from '../types';

/** How urgent a line is when several wait in the queue (highest speaks first). */
export type GuideLinePriority = 'response' | 'boss' | 'farewell' | 'area' | 'creature' | 'other';

/** What makes a line join the queue. Coordinates are instance-local yards. */
export type GuideTrigger =
  /** A group member answered "Come with us". */
  | { kind: 'accept' }
  /** A group member answered "We go alone". */
  | { kind: 'decline' }
  /** Right after any of these lines is spoken (a chain, spaced for reading). */
  | { kind: 'follows'; lines: readonly string[] }
  /** The first time any group member stands inside the circle. */
  | { kind: 'area'; x: number; z: number; r: number }
  /** The first living mob of these templates within `r` of any group member. */
  | { kind: 'sight'; mobIds: readonly string[]; r: number }
  /** The first living mob of these templates anywhere in the claim (summons). */
  | { kind: 'mobAlive'; mobIds: readonly string[] }
  /** A dungeon gate of this id stops being closed. */
  | { kind: 'gateOpen'; gateId: string }
  /** A group member within `r` of a living boss that is not yet in its fight. */
  | { kind: 'bossNear'; bossId: string; r: number }
  /** Every listed boss template of the claim is dead. */
  | { kind: 'bossDead'; bossIds: readonly string[] }
  /** Every player in the claim is dead. */
  | { kind: 'wipe' }
  /** The guide fell far behind and caught up on his own. */
  | { kind: 'catchUp' }
  /** The guide reached his finale spot after the last boss fell. */
  | { kind: 'finale' };

export interface GuideLineDef {
  /** Stable line id (the design doc's code: 'A01', 'B03', ...). */
  id: string;
  /** i18n key suffix under the guide's `i18nPrefix` (the client renders it). */
  key: string;
  /** The English source (wiki, tests, and the catalog's own English). */
  text: string;
  trigger: GuideTrigger;
  priority: GuideLinePriority;
  /** Variant group: exactly one line of each group is eligible per run. */
  variant?: string;
  /** Only on a heroic claim. */
  heroicOnly?: boolean;
  /** May be spoken while a boss is in its fight (every other line waits). */
  inBossCombat?: boolean;
  /** An action line in the chat (no bubble, no gesture). */
  emote?: boolean;
  /** The body gesture played while the line is spoken. */
  gesture?: OverheadEmoteId;
  /** A line about a boss before its fight: dropped unspoken once that boss
   *  is in its fight or dead (it would come too late to mean anything). */
  beforeBoss?: string;
}

/** The guide's dialog window (the gossip menu), as i18n key suffixes. */
export interface GuideDialogDef {
  /** Greeting variants while the offer stands (picked by the guide's entity id). */
  greet: readonly string[];
  /** The greeting once he walks with the group. */
  joined: string;
  /** The greeting while he sings his finale. */
  singing: string;
  /** The two answer rows. */
  rowJoin: string;
  rowDecline: string;
}

export interface GuideFollowTuning {
  /** Trail yards he keeps behind the rearmost member. */
  gap: number;
  /** Out of combat, farther than this from every member: he catches up. */
  catchUpDistance: number;
  /** Where a catch-up puts him: this many trail yards behind the member. */
  snapBehind: number;
  /** A member this much higher or lower (and not right beside him) is on
   *  another floor: he catches up too. */
  bandHeight: number;
  /** His own pace, and the pace he keeps when the group pulls ahead. */
  walkSpeed: number;
  runSpeed: number;
  /** Trail yards behind beyond which he hurries at run speed. */
  hurryBeyond: number;
}

export interface GuideFinaleDef {
  /** The finale starts when all of these are dead (the last boss). */
  bossIds: readonly string[];
  /** The walk to his finale spot; the last point is where he stands. */
  path: readonly { x: number; z: number }[];
  /** Where he faces while he sings. */
  face: { x: number; z: number };
  /** The looping song, a channel on his cast bar (render: the song pose). */
  castId: string;
  castSeconds: number;
  /** The fallen of these templates rise as light while he sings (render only). */
  dissolveMobIds: readonly string[];
  /** Granted to every player in the claim when the bosses fall while he walks
   *  with the group. */
  deedId: string;
}

export interface DungeonGuideDef {
  id: string;
  /** The guide's NPC template (an NpcDef, `dynamic`), spawned per claim by the
   *  dungeon's `npcs` list. */
  npcId: string;
  dungeonId: string;
  /** i18n key prefix of every line and dialog key (the catalog namespace). */
  i18nPrefix: string;
  dialog: GuideDialogDef;
  /** Engaging this boss closes the offer for the rest of the run. */
  offerClosesOn: string;
  /** Bosses whose fights silence him (and root him in place). */
  bossIds: readonly string[];
  follow: GuideFollowTuning;
  /** Seconds between two lines; queued area and creature lines older than
   *  `staleAfter` are dropped. */
  speech: { spacing: number; staleAfter: number };
  finale: GuideFinaleDef;
  lines: readonly GuideLineDef[];
}

export interface GuideQueuedLine {
  id: string;
  at: number;
}

/** One guide's state for one run (on Entity.guideRun; never persisted or wired:
 *  the client reads Entity.guideState). A fresh claim spawns a fresh entity. */
export interface DungeonGuideRun {
  guideId: string;
  offer: Exclude<DungeonGuideState, 'singing'>;
  /** Lines spoken (or dropped) this run: each line at most once. */
  done: Set<string>;
  queue: GuideQueuedLine[];
  nextSpeechAt: number;
  /** Variant group -> the line id this run speaks. */
  chosen: Record<string, string>;
  /** World positions of the rearmost member's recent steps, oldest first. */
  trail: Vec3[];
  /** Whether everyone in the claim was dead last tick (the wipe edge). */
  wiped: boolean;
  finale: null | 'walking' | 'speaking' | 'singing';
  pathIndex: number;
}
