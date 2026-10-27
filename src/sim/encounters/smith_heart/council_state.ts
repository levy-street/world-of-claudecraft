// The Hammer Council's fight state (encounters/smith_heart/council.ts): ONE
// object shared by the Guardian, the Slabwright and the Seam Singer while they
// fight, as Entity.smithHeartFight on each. A type-only leaf so src/sim/types.ts
// can name it. Sim authority only: the client reads the fight from the bars
// (castingAbility, castTargetId), the auras on the players, the energy bar
// (the holder's resource) and the pillar, rubble and rise-spot objects.

import type { CouncilDifficulty, CouncilRole } from './council_ids';

/** A player mark counting down (Wake the Stone, Falling Rock). */
export interface CouncilMark {
  playerId: number;
  remaining: number;
}

/** An heir's pillar rising on a locked spot (instance-local). */
export interface CouncilRiseSpot {
  x: number;
  z: number;
  remaining: number;
  /** The rise-spot object the client draws. */
  objectId: number;
}

/** One player under Resonance: how long they have stood by one pillar. */
export interface CouncilResonance {
  playerId: number;
  remaining: number;
  /** Continuous seconds by `pillarId` (the 3 s crack restarts at 0). */
  near: number;
  pillarId: number | null;
}

/** A fallen pillar's rubble (instance-local centre). */
export interface CouncilRubble {
  objectId: number;
  x: number;
  z: number;
  r: number;
  remaining: number;
  tick: number;
}

/** A bar one member runs for the council. */
export interface CouncilBar {
  castId: string;
  /** Where its feet were planted when it began (world). */
  at: { x: number; y: number; z: number };
  /** Run as an heir (the shorter Wrath, the unbroken song). */
  heir: boolean;
  targetId: number | null;
}

/** Mythic: a fallen member's soul in a pillar (council_soul.ts). Its pips,
 *  whose soul and the pillar's kind ride the pillar's template id. */
export interface CouncilSoul {
  role: CouncilRole;
  pillarId: number;
  /** The behaviour's clock: the Echo's next bar, the song's next pulse. */
  timer: number;
  /** The Echo's bar in flight (seconds left), or null. */
  echo: number | null;
  /** The Endless Song: pulses sung. */
  pulses: number;
  /** The Walking Slab: where it drags itself (instance-local), the seconds
   *  to its next pick, its grind's clock, and who it last crushed when
   *  (player id to the fight clock). */
  goal: { x: number; z: number } | null;
  retarget: number;
  grind: number;
  crushed: Record<number, number>;
}

export interface CouncilFightState {
  kind: 'council';
  difficulty: CouncilDifficulty;
  /** The council has fallen and the end was resolved. */
  finished: boolean;
  /** Seconds since the pull. */
  clock: number;
  /** The Wrath holder's energy, 0 to 100. */
  energy: number;
  /** Wraths landed this pull (the soft enrage reads it). */
  wraths: number;
  weightTimer: number;
  wakeTimer: number;
  rockTimer: number;
  boltTimer: number;
  /** Heroic: the song's own clock. */
  songTimer: number;
  /** Normal: seconds until the song may start after the last Wrath (null
   *  while no song is owed). */
  songDue: number | null;
  pulseTimer: number;
  /** The Singer stays silent this long after a kick. */
  quiet: number;
  /** Each member's bar in flight, and its breath after one. */
  bars: Partial<Record<CouncilRole, CouncilBar>>;
  gaps: Record<CouncilRole, number>;
  /** The Singer's kickable bar in flight (a cut bar is a kick). */
  kickable: string | null;
  wakeMarks: CouncilMark[];
  riseSpots: CouncilRiseSpot[];
  rock: CouncilMark | null;
  resonance: CouncilResonance[];
  rubble: CouncilRubble[];
  /** The fallen, in the order they fell. */
  fallen: CouncilRole[];
  /** Lines said this pull (each once). */
  lines: string[];
  /** The members' spoken lines (council_voice.ts): `<role>_<moment>` to the
   *  fight clock it was last said at. */
  said: Record<string, number>;
  /** Mechanic casts started (the deterministic salt of every pick). */
  casts: number;
  /** Mythic: the souls standing in pillars, in the order they took them. */
  souls: CouncilSoul[];
  /** Mythic: the souls whose pillar burst this pull (never taken again). */
  soulsSpent: CouncilRole[];
}
