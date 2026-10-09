// The Drowned Temple trash's own kit keys (MobTemplate.trashKit.temple), as a
// type-only leaf: the content (temple.ts, drowned_temple.ts) authors them, the
// Temple extension (temple_choir.ts, temple_tide.ts) runs them. Each key is one
// readable job; the heroic-only ones say so.

import type { TrashKitCast } from '../../types';

export interface TempleKitDef {
  /** Shrine Vigil: while at least `min` living `guardian` mobs of the fight
   *  kneel within `range`, this mob takes `reduction` less damage
   *  (`heroicReduction` on heroic). Kill the pilgrims first. */
  vigil?: {
    guardian: string;
    range: number;
    min: number;
    reduction: number;
    heroicReduction: number;
    name: string;
  };
  /** Heroic only (Moonset Oath): while a packmate of `singers` within `range`
   *  is casting, this mob takes `share` of every hit she takes. A stun, a
   *  sleep or distance breaks the oath. */
  guard?: { singers: readonly string[]; range: number; share: number; name: string };
  /** Heroic only (Lullaby Echo): an unkicked Lullaby echoes off its sleeper:
   *  `delay` seconds after it lands, then every `every` seconds while they
   *  sleep, everyone awake within `radius` of them falls asleep too (once
   *  each). Spread out, or kick the song. */
  lullabyEcho?: { radius: number; delay: number; every: number; seconds: number; name: string };
  /** Prism Glare: a gaze. When the bar ends, everyone within `range` whose
   *  front `halfArcDeg` holds the caster is dazzled for `seconds`
   *  (`heroicSeconds` on heroic): `miss` extra swing whiff and `slow` run
   *  speed. Turn your back. */
  gaze?: TrashKitCast & {
    range: number;
    halfArcDeg: number;
    seconds: number;
    heroicSeconds: number;
    miss: number;
    slow: number;
    min: number;
    max: number;
  };
  /** Spiral Whirlpool: while the mob shelters (trashKit.withdraw), the water
   *  round it spins: everyone within `radius` is dragged `pull` yards a
   *  second toward it (`heroicPull` on heroic), and every `tick` seconds
   *  everyone within `core` takes a roll. Walk out. */
  whirlpool?: {
    radius: number;
    pull: number;
    heroicPull: number;
    core: number;
    tick: number;
    min: number;
    max: number;
    name: string;
    school: TrashKitCast['school'];
  };
  /** Arcing Spark: an interruptible bolt at one player in `range` that leaps
   *  on to the nearest other player within `jump` of the last one struck, up
   *  to `hits` players. Do not bunch up. */
  spark?: TrashKitCast & { range: number; jump: number; hits: number; min: number; max: number };
  /** Heroic only (Swollen Tide): two seekers of this template that touch
   *  (within `reach`) flow into one, its health pooled; each merge widens
   *  its burst by `radiusPer` yards and raises its roll by `damagePer`, up to
   *  `max` merges. Kill them apart. */
  merge?: { reach: number; max: number; radiusPer: number; damagePer: number; name: string };
  /** Call of the Shallows (temple_lure.ts): an interruptible song at one
   *  player past the tank within `range`. While it runs the victim keeps half
   *  their run speed and is drawn `pull` yards a second toward the singer
   *  (`heroicPull` on heroic); drawn within `reach`, or when the bar runs
   *  out, they are stunned `stun` seconds (`heroicStun`), named
   *  `stunName`. Out of her line of sight the song breaks. Kick it, stun her,
   *  or hide. */
  lure?: TrashKitCast & {
    range: number;
    pull: number;
    heroicPull: number;
    reach: number;
    stun: number;
    heroicStun: number;
    stunName: string;
  };
  /** Heroic only (Heartpearl, temple_pearl.ts): when this mob's Nacre Cocoon
   *  (trashKit.carapace) BREAKS (the shield spent before it ran out), the
   *  pearl rolls out as the kit's `walker` (launch 'event'). */
  pearl?: { heroicOnly: true };
}

/** Per-pull state of the Temple keys (TrashKitState.temple). */
export interface TempleKitState {
  /** A Lullaby Echo in flight: whose sleep echoes, the seconds to the next
   *  echo, and who it already put to sleep. */
  echo?: { sleeperId: number; next: number; slept: number[] };
  /** Seconds to the whirlpool's next roll while it spins. */
  whirlTick?: number;
  /** Heartpearl: the cocoon's seconds left as last seen (a break is the ward
   *  gone with time still on it), and its end already judged this pull. */
  cocoonLeft?: number;
  pearlJudged?: boolean;
}
