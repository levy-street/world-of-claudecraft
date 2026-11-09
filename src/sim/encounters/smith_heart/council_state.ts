// The Hammer Council's fight state (encounters/smith_heart/council.ts): ONE
// object shared by the Guardian and the Seam Singer while they fight, as Entity.smithHeartFight on each. A type-only leaf so src/sim/types.ts
// can name it. Sim authority only: the client reads the fight from the bars
// (castingAbility, castTargetId), the auras on the players, the energy bar
// (the holder's resource) and the pillar, rubble and rise-spot objects.

import type { FloorMechanic } from './council_floor_gap';
import type { CouncilDifficulty, CouncilRole } from './council_ids';
import type { SlainWatch } from './voice_slain';

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

/** One player under Resonance (a spread): its time left and the seconds to
 *  its next ring. */
export interface CouncilResonance {
  playerId: number;
  remaining: number;
  tick: number;
}

/** A fallen pillar's rubble (instance-local centre). */
export interface CouncilRubble {
  objectId: number;
  x: number;
  z: number;
  r: number;
  remaining: number;
  tick: number;
  /** It hurts whoever stands in it (false: a Wrath's or a Rush's clean
   *  break, only a look). */
  bites: boolean;
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
}

/** Mountain's Rush in flight: the Guardian planted for its wind-up, then
 *  dashing along its line (world points), where it stops, the pillar that
 *  stops it (null: it reaches the marked spot), the marked player, the
 *  wind-up's and the dash's seconds left, and who it has run through. */
export interface CouncilRush {
  targetId: number;
  from: { x: number; z: number };
  to: { x: number; z: number };
  pillarId: number | null;
  windup: number;
  remaining: number;
  struck: number[];
}

export interface CouncilFightState {
  kind: 'council';
  difficulty: CouncilDifficulty;
  /** Each member's pool before its tier's (tier_health.ts), given back at a reset. */
  basePools?: Partial<Record<CouncilRole, number>>;
  /** The council has fallen and the end was resolved. */
  finished: boolean;
  /** Seconds since the pull. */
  clock: number;
  /** The Wrath holder's energy, 0 to 100. */
  energy: number;
  /** Wraths landed this pull (the soft enrage reads it; the first one
   *  shatters the carved columns for the rest of the pull). */
  wraths: number;
  weightTimer: number;
  /** Seconds to Mountain's Rush's next bar, and the dash in flight. */
  rushTimer: number;
  rush: CouncilRush | null;
  /** The Guardian's cursed pillar standing (its entity id) and the seconds
   *  to its next raid pulse, or null. */
  cursed: { pillarId: number; pulse: number } | null;
  /** Mythic: the Quarry collapsing after a Rush missed every pillar (its
   *  stacks and the seconds to its next blow), until the cursed pillar
   *  breaks; null while it holds. */
  collapse: { stacks: number; timer: number } | null;
  /** Bond of the Stone: the pulses sung while the two stand together (0
   *  while apart), the seconds to the next, and when it may warn again. */
  bond: { pulses: number; timer: number };
  wakeTimer: number;
  rockTimer: number;
  boltTimer: number;
  /** Heroic: the song's own clock. */
  songTimer: number;
  /** Normal: seconds until the song may start after the last Wrath (null
   *  while no song is owed). */
  songDue: number | null;
  pulseTimer: number;
  /** Stone Thrum's clock (council_risen_pulse.ts): seconds to its next ring. */
  risenPulseTimer: number;
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
  /** The players seen dead this pull and the pull's deaths (the kill lines'
   *  watch, voice_slain.ts). */
  slain: SlainWatch;
  /** Mechanic casts started (the deterministic salt of every pick). */
  casts: number;
  /** Mythic: the souls standing in pillars, in the order they took them. */
  souls: CouncilSoul[];
  /** Mythic: the souls whose pillar burst this pull (never taken again). */
  soulsSpent: CouncilRole[];
  /** The floor gap (council_floor_gap.ts): the fight clock of the last floor
   *  mechanic's start (null before the first), and the seconds each one has
   *  waited on the gap since its own last start. */
  lastFloorAt: number | null;
  floorHeld: Partial<Record<FloorMechanic, number>>;
}
