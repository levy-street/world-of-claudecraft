// Raid target icons (the eight star-to-skull symbols over a unit's head): the
// pure rules of who may set them and which units can carry one. The store and
// its lifecycle hooks live in src/sim/targeting.ts; this module only answers
// questions, so the sim and the HUD (which decides whether to offer the menu
// rows and the keybinds) read ONE rule and can never disagree about it.
//
// The rules, as the classic client has them:
//  - A mark is a group thing: you need a party or raid to set one, and the
//    whole group sees it. Each symbol is on at most one unit per group.
//  - Edit rights follow the world markers exactly (canEditSharedMapMarks):
//    anyone in a five-player party, only the leader in a raid.
//  - Markable units: any live wild mob (an enemy, or a friendly ally standing
//    with the group), any player in the group (alive or dead: a mark on the
//    tank is how a raid calls who to stack on), and the pets and buddies of
//    group members. Never an NPC, an object, a corpse, or someone outside the
//    group (or their pet): a group's marks are about its own fight.
//
// Pure: no DOM/Three/i18n, no Math.random/Date.now (tests/architecture.test.ts).

import type { Party } from '../sim';
import type { Entity } from '../types';
import { canEditSharedMapMarks } from './shared_map_marks';

/** The eight raid target symbols, 0..7 (star, circle, diamond, triangle,
 *  moon, square, cross, skull), the same order the world markers use. */
export const RAID_TARGET_SYMBOL_COUNT = 8;

/** True for a valid symbol id (an integer 0..7). */
export function isRaidTargetSymbol(symbol: number): boolean {
  return Number.isInteger(symbol) && symbol >= 0 && symbol < RAID_TARGET_SYMBOL_COUNT;
}

/** May `pid` set or clear raid target icons for `party`? No group means no
 *  marks at all; in a group the world-marker rule applies (party: anyone,
 *  raid: the leader). */
export function canSetRaidTargets(
  party: Pick<Party, 'leader' | 'raid'> | null,
  pid: number,
): boolean {
  return party !== null && canEditSharedMapMarks(party, pid);
}

/** Can `target` carry a raid target icon for the group whose membership
 *  `inGroup` answers (by pid)? See the header for the rule. */
export function raidTargetMarkable(
  target: Pick<Entity, 'id' | 'kind' | 'dead' | 'ownerId'>,
  inGroup: (pid: number) => boolean,
): boolean {
  if (target.kind === 'player') return inGroup(target.id);
  if (target.kind !== 'mob' || target.dead) return false;
  return target.ownerId === null || inGroup(target.ownerId);
}

/** The ids a departing member takes with them: their own player entity and
 *  every unit they own (pet, buddy, summon). Returns true when `entity` (the
 *  marked unit, or undefined when it is no longer in the world) belongs to
 *  `pid`. A mark on a wild mob never does. */
export function raidTargetBelongsTo(
  entityId: number,
  entity: Pick<Entity, 'ownerId'> | undefined,
  pid: number,
): boolean {
  return entityId === pid || (entity !== undefined && entity.ownerId === pid);
}
