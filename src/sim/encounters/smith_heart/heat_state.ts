// The Guardian of the Heat's fight state (encounters/smith_heart/heat.ts), as
// Entity.smithHeartHeat on the guardian. A type-only leaf so src/sim/types.ts
// can name it. Sim authority only: the client reads the fight from the
// guardian's resource and auras, the players' auras, and the fight's objects
// (heat_ids.ts says which).

import type { HeatChannelState, HeatDifficulty } from './heat_ids';

/** A bar the guardian runs for the fight. */
export interface HeatBar {
  castId: string;
  /** Where its feet were planted (world) and the facing it locked. */
  at: { x: number; y: number; z: number };
  facing: number;
}

/** A crystal's rise spot while Shed Heat's bar runs. */
export interface HeatRise {
  objectId: number;
  /** HEARTH_CRYSTAL_SOCKETS index. */
  socket: number;
  x: number;
  z: number;
}

/** A Kindled Crystal standing on the floor. */
export interface HeatCrystal {
  objectId: number;
  socket: number;
  x: number;
  z: number;
  /** Seconds left before it burns out. */
  life: number;
  /** Seconds to its next ray. */
  rayIn: number;
  /** The player its last ray struck (null: none, or back into the guardian). */
  target: number | null;
}

/** One player's Crystal Burn. */
export interface HeatBurn {
  stacks: number;
  /** Seconds before one stack fades. */
  decay: number;
}

/** Heroic: Knell Embers on the floor. */
export interface HeatEmbers {
  objectId: number;
  x: number;
  z: number;
  life: number;
  tick: number;
}

/** The channel across the Hearth. */
export interface HeatChannel {
  objectId: number | null;
  state: HeatChannelState;
  /** Seconds left in this state. */
  remaining: number;
  /** Seconds to its next damage tick while it flows. */
  tick: number;
  /** Flows so far. */
  flows: number;
}

export interface HeatFightState {
  kind: 'heat';
  difficulty: HeatDifficulty;
  /** The guardian has fallen and the end was resolved. */
  finished: boolean;
  /** Seconds since the pull. */
  clock: number;
  /** The Hearth's heat (0 to 100; the guardian's resource carries it rounded). */
  heat: number;
  /** The heat a second ago, and the trend it gave (1 rising, -1 falling). */
  heatRef: number;
  trend: 1 | -1;
  trendTimer: number;
  /** The overheat's wind-up is showing (from 90, until it falls back). */
  windup: boolean;
  /** Hearthbursts so far. */
  overheats: number;
  pulseTimer: number;
  stokeTimer: number;
  stokeStacks: number;
  bar: HeatBar | null;
  /** Breath after a bar before the next begins. */
  gap: number;
  shedTimer: number;
  /** Shed Heats begun (the deterministic salt of the sockets' pick). */
  sheds: number;
  rises: HeatRise[];
  crystals: HeatCrystal[];
  burns: Record<number, HeatBurn>;
  channel: HeatChannel;
  embers: HeatEmbers[];
  /** When each player last took Searing Knell's stun (the fight clock). */
  knellAt: Record<number, number>;
  /** Players wearing the heat's marker. */
  marked: Record<number, true>;
  /** Rays that struck a player, and rays sent back into the guardian. */
  rays: number;
  raysBack: number;
  /** Mechanic casts started. */
  casts: number;
  /** Lines said this pull: `<moment>` to the fight clock. */
  said: Record<string, number>;
}
