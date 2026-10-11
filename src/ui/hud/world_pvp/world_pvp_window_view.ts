// Pure view model for the World PvP tab of the merged PvP window: the /pvp
// flag's state line, the ground under the player, which button the panel offers
// (raise, lower, keep up, a locked raise with the level requirement, or a
// raise disabled by the realm's kill switch), the two-step raise confirmation,
// and the resolved stakes copy inputs. DOM-free and i18n-free (root CLAUDE.md
// pure-core contract): it hands the painter ids and numbers, never strings.
// The painter (world_pvp_panel.ts) localizes and wires it; arena_window.ts
// composes it as the fourth tab.

import {
  WORLD_PVP_DISARM_SECONDS,
  WORLD_PVP_DR_WINDOW_SECONDS,
  WORLD_PVP_GREY_LEVEL_GAP,
  WORLD_PVP_KILL_HONOR,
  WORLD_PVP_MIN_LEVEL,
  WORLD_PVP_STAKE_CAP_COPPER,
  WORLD_PVP_STAKE_FRACTION,
  worldPvpPairMultiplier,
} from '../../../sim/pvp/world_pvp_rules';
import type { WorldPvpInfo, WorldPvpZone } from '../../../world_api';

/** What the one action button does. `locked` renders the raise disabled with
 *  the level requirement; `keepUp` cancels a running disarm countdown;
 *  `realmOff` renders it disabled because the realm's kill switch is set (the
 *  sim refuses every raise there, so no press could ever land). */
export type WorldPvpActionKind = 'enable' | 'disable' | 'keepUp' | 'locked' | 'realmOff';

export interface WorldPvpStakes {
  stakeCapCopper: number;
  /** Whole percent, for the copy (10, not 0.1). */
  stakePercent: number;
  killHonor: number;
  disarmMinutes: number;
  greyLevelGap: number;
  minLevel: number;
  /** The per-victim repeat ladder as whole percents: what the SECOND and THIRD
   *  kill of one player pay a contributor who was paid for the first. */
  repeatSecondPercent: number;
  repeatThirdPercent: number;
  /** How long the per-victim counter runs before it starts over, in seconds
   *  (the painter spells it as a duration phrase). */
  repeatWindowSeconds: number;
}

export type WorldPvpWindowView =
  | { kind: 'pending'; sig: string }
  | {
      kind: 'live';
      flagged: boolean;
      /** Whole seconds left on the disarm countdown, or null. */
      disarmRemaining: number | null;
      action: WorldPvpActionKind;
      /** The raise button was pressed once; the panel now offers confirm/cancel. */
      confirming: boolean;
      kills: number;
      deaths: number;
      honor: number;
      /** The ground under the player right now, for the status card's second
       *  line. Reported whatever the kill switch says, so `realmEnabled` is
       *  what decides whether it means anything. */
      zone: WorldPvpZone;
      /** False on a realm whose World PvP kill switch is set: no flag can be
       *  raised and no ground is hostile, so the action is `realmOff` and the
       *  ground line is dropped (no zone policy is live to report). */
      realmEnabled: boolean;
      stakes: WorldPvpStakes;
      /** Render-skip signature: every id and number the markup depends on. */
      sig: string;
    };

export interface WorldPvpWindowViewInput {
  info: WorldPvpInfo | null;
  honor: number;
  /** The painter's raise-confirmation state (cleared on any state change). */
  confirming: boolean;
}

export const WORLD_PVP_STAKES: WorldPvpStakes = {
  stakeCapCopper: WORLD_PVP_STAKE_CAP_COPPER,
  stakePercent: Math.round(WORLD_PVP_STAKE_FRACTION * 100),
  killHonor: WORLD_PVP_KILL_HONOR,
  disarmMinutes: Math.round(WORLD_PVP_DISARM_SECONDS / 60),
  greyLevelGap: WORLD_PVP_GREY_LEVEL_GAP,
  minLevel: WORLD_PVP_MIN_LEVEL,
  // Read through the rules function rather than the honor ladder it wraps, so
  // a retune of the diminishing-returns array never strands the copy.
  repeatSecondPercent: Math.round(worldPvpPairMultiplier(1) * 100),
  repeatThirdPercent: Math.round(worldPvpPairMultiplier(2) * 100),
  repeatWindowSeconds: WORLD_PVP_DR_WINDOW_SECONDS,
};

export function worldPvpAction(info: WorldPvpInfo): WorldPvpActionKind {
  // The realm switch outranks every other arm: the sim refuses a raise, never
  // restores a saved flag and auto-raises nobody there, so the flag is always
  // down and the only honest button is a disabled one.
  if (info.enabled === false) return 'realmOff';
  if (info.flagged) return info.disarmRemaining === null ? 'disable' : 'keepUp';
  return info.levelLocked ? 'locked' : 'enable';
}

export function buildWorldPvpWindowView(input: WorldPvpWindowViewInput): WorldPvpWindowView {
  const info = input.info;
  if (!info) return { kind: 'pending', sig: 'world-pending' };
  const action = worldPvpAction(info);
  // Confirmation only ever guards the raise: a disarm or a cancel is one press.
  const confirming = action === 'enable' && input.confirming;
  const disarmRemaining = info.disarmRemaining === null ? null : Math.ceil(info.disarmRemaining);
  const sig = [
    'world',
    info.flagged ? 1 : 0,
    disarmRemaining ?? -1,
    action,
    confirming ? 1 : 0,
    info.kills,
    info.deaths,
    input.honor,
    info.zone,
    info.enabled === false ? 0 : 1,
  ].join('|');
  return {
    kind: 'live',
    flagged: info.flagged,
    disarmRemaining,
    action,
    confirming,
    kills: info.kills,
    deaths: info.deaths,
    honor: input.honor,
    zone: info.zone,
    realmEnabled: info.enabled !== false,
    stakes: WORLD_PVP_STAKES,
    sig,
  };
}
