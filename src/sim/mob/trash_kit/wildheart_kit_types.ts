// The Wildheart Basin trash's own kit keys (MobTemplate.trashKit.wildheart),
// as a type-only leaf: the content (wildheart.ts) authors them, the Basin
// extension (wildheart_hunt.ts) runs them. The hunt reads as one story: the
// stalker marks the quarry, the raptors run it down, the hexers and the
// binders curse and frighten, the ravagers roar each other into a frenzy.

import type { TrashKitCast } from '../../types';

export interface WildheartKitDef {
  /** Quarry Mark: a thrown marking spear at one player in `range` (never the
   *  one it fights while anyone else is in reach). Only while a `hunter`
   *  packmate fights within `huntRange`. Every such hunter runs the marked
   *  player down for `seconds` (`heroicSeconds` on heroic; a taunt still
   *  wins). Physical: never kick it; kill the stalker first. */
  mark?: TrashKitCast & {
    range: number;
    seconds: number;
    heroicSeconds: number;
    hunter: string;
    huntRange: number;
  };
  /** War Roar: once per pull, under `belowHpPct` of its health, an
   *  interruptible roar. When the bar ends every living `packmate` in the
   *  fight within `radius` (the roarer too) is enraged for the rest of the
   *  pull: `damagePct` more damage, swings `hasteMult` faster. Kick or stun
   *  the roar; a kicked roar is spent. */
  roar?: TrashKitCast & {
    belowHpPct: number;
    radius: number;
    packmate: string;
    damagePct: number;
    hasteMult: number;
  };
  /** Toad Hex: an interruptible hex at one player in `range` (never the one
   *  it fights while anyone else is in reach): a toad for `seconds`
   *  (`heroicSeconds` on heroic), no attacks and no spells; any hit breaks
   *  it. Kick it, or tap the toad free. */
  hex?: TrashKitCast & { range: number; seconds: number; heroicSeconds: number };
  /** Plant Totem, alternating: each bar plants the next totem of `summons`
   *  in turn beside the caster, while fewer than `maxAlive` of them stand. */
  totems?: TrashKitCast & { summons: readonly string[]; maxAlive: number };
  /** Rattling Dread: a totem's fear. An unkickable bar, then everyone within
   *  `radius` flees from it for `seconds` (`heroicSeconds` on heroic; a hit
   *  breaks the fear). Tank the pack away from it, or break the totem. */
  dread?: TrashKitCast & { radius: number; seconds: number; heroicSeconds: number };
  /** Snaring Tongue: a lane locked at the bar's start toward one player at
   *  least `minRange` away; everyone standing in it when the bar ends takes
   *  a roll and is reeled to the caster (`reel` yards a second, stopping
   *  `stop` yards short). Step out sideways. */
  tongue?: TrashKitCast & {
    length: number;
    halfWidth: number;
    minRange: number;
    min: number;
    max: number;
    reel: number;
    stop: number;
  };
}

/** Per-pull state of the Basin keys (TrashKitState.wildheart). */
export interface WildheartKitState {
  /** The roar was begun this pull (kicked or not, it never comes again). */
  roared?: boolean;
  /** How many totems this caster has planted (picks the next in the cycle). */
  planted?: number;
  /** Players the tongue is reeling in: who, and the seconds the tongue
   *  still holds them (a reel never outlasts the lane's own length). */
  reels?: { id: number; left: number }[];
}
