// Battleground flag interaction: the pure decision for what the general
// Interact key should do inside a live Thornhollow Fields match.
//
// The dedicated flag-press keybind (bgFlagKey in main.ts) always attempts a
// grab; that stays unconditional. The bare Interact key additionally routes
// to the same press for mobile/gamepad parity (one button, no separate flag
// key), but ONLY while an enemy flag is actually within pickup reach: away
// from one, the field can hold an ordinary interactable too (a Warlock's
// Soulwell dropped near a flag stand, say), and swallowing every press with
// a doomed flag grab made that interactable permanently unreachable for the
// whole match. bgFlagAction (src/sim/social/battleground.ts) stays the
// authoritative gate; this core only decides whether ITS press is what the
// key means right now, mirroring the eligibility bgFlagAction re-checks
// server-side (not carried, an enemy flag, within BG_PICKUP_RADIUS).
import { BG_PICKUP_RADIUS, BG_TEAM_COLORS, type BgTeam } from '../sim/battleground_layout';
import { dist2d, type Entity } from '../sim/types';
import type { BgMatchInfo } from '../world_api/battleground';

// This core is a PREDICTIVE mirror of bgFlagAction's own reach check, not the
// authority: bgFlagAction re-validates for real server-side. Keep the
// preemptive Interact route on the same reach radius the authoritative action
// accepts, so ordinary interactables still receive fallback presses in the
// client-only boundary band.

function bgFlagEntityTeam(color: number): BgTeam | null {
  if (color === BG_TEAM_COLORS[0]) return 0;
  if (color === BG_TEAM_COLORS[1]) return 1;
  return null;
}

/** True while an enemy flag sits within pickup reach and is not already
 *  carried. Own-team flags never count: bgFlagAction only ever grabs the
 *  other side's flag. */
export function bgFlagGrabbableNearby(
  match: Pick<BgMatchInfo, 'myTeam' | 'flags'>,
  playerPos: Entity['pos'],
  entities: ReadonlyMap<number, Entity>,
): boolean {
  for (const entity of entities.values()) {
    if (entity.kind !== 'object' || entity.templateId !== 'bg_flag') continue;
    const team = bgFlagEntityTeam(entity.color);
    if (team === null || team === match.myTeam) continue;
    if (match.flags[team]?.state === 'carried') continue;
    if (dist2d(playerPos, entity.pos) <= BG_PICKUP_RADIUS) return true;
  }
  return false;
}

/** Whether the bare Interact key means the flag press right now: only inside
 *  an ACTIVE match, for a living player, and only with an enemy flag actually
 *  in reach. Folds in the match-state and death gates (bgFlagAction silently
 *  refuses a dead caster, src/sim/social/battleground.ts) so the main.ts call
 *  site stays a single call, and so a released ghost's press still falls
 *  through to whatever it actually means (the spirit healer, say) instead of
 *  being eaten by a press bgFlagAction was always going to no-op. */
export function shouldRouteInteractToBgFlag(
  bgInfo: { match: Pick<BgMatchInfo, 'myTeam' | 'flags' | 'state'> | null } | null,
  player: Pick<Entity, 'pos' | 'dead'>,
  entities: ReadonlyMap<number, Entity>,
): boolean {
  const match = bgInfo?.match;
  return (
    match?.state === 'active' && !player.dead && bgFlagGrabbableNearby(match, player.pos, entities)
  );
}
