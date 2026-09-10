// The target-frame unit menu: which menu a given target opens, and the markup
// for the one menu that has no other home (your own cosmetic buddy).
//
// Extracted from src/ui/hud.ts (which sits on its monolith ceiling) as the
// pure half of that menu: no DOM, no Hud, no state. hud.ts keeps only the
// thin openers, which know how to place a popup and bind its rows; deciding
// WHICH menu a target opens is a rule about the target, and it is testable
// here without a document.

import type { Entity } from '../../sim/types';
import { esc } from '../esc';
import { t } from '../i18n';
import { isControllableOwnedPet, isOwnBuddy } from '../pet_entity';

/** Which menu the target frame opens for `target`, or null for a target that
 *  has no menu at all (a hostile mob with no party to mark it for, a corpse,
 *  yourself, someone else's follower).
 *
 *  - `player`: another player -> the social/party menu.
 *  - `pet`: your own commandable pet -> the pet menu (rename/revive/abandon).
 *  - `buddy`: your own cosmetic buddy -> the buddy menu (autoloot). A buddy
 *    takes no pet commands at all, which is why isControllableOwnedPet
 *    excludes it and this is a separate arm rather than a row over there.
 *  - `marker`: a LIVE WILD hostile mob while you are in a party -> the
 *    raid-marker menu. Mirrors Sim.setMarker's own markable criteria so the
 *    menu never opens where every row would be a no-op.
 *
 *  Order matters: the pet and buddy arms are both "an owned mob of mine" and
 *  the marker arm excludes owned mobs outright (ownerId === null), so no
 *  target can match two arms. */
export function targetFrameMenuKind(
  target: Entity,
  viewerId: number,
  inParty: boolean,
): 'player' | 'pet' | 'buddy' | 'marker' | null {
  if (target.kind === 'player') return target.id === viewerId ? null : 'player';
  if (isControllableOwnedPet(target, viewerId)) return 'pet';
  if (isOwnBuddy(target, viewerId)) return 'buddy';
  if (target.kind === 'mob' && !target.dead && target.hostile && target.ownerId === null) {
    return inParty ? 'marker' : null;
  }
  return null;
}

/** The buddy menu's rows. One action (the autoloot errand) plus Cancel: a
 *  buddy has nothing else to command. `armed` is the owner's CURRENT
 *  Entity.buddyAutoloot as it came off the wire, so the row offers the flip
 *  the server would actually make, never a local guess. */
export function buddyMenuHtml(name: string, armed: boolean): string {
  const label = armed
    ? t('hudChrome.buddyMenu.autolootDisable')
    : t('hudChrome.buddyMenu.autolootEnable');
  const hint = esc(t('hudChrome.buddyMenu.autolootHint'));
  return (
    `<div class="ctx-title">${esc(name)}</div>` +
    `<div class="ctx-item" data-act="autoloot" title="${hint}">${esc(label)}</div>` +
    `<div class="ctx-item" data-act="close">${esc(t('hudChrome.buddyMenu.cancel'))}</div>`
  );
}
