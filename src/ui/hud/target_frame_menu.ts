// The target-frame unit menu: which menu a given target opens, and the markup
// for the menus that have no other home (your own cosmetic buddy, and the raid
// target icon picker every markable unit opens).
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
import { RAID_MARKER_LABEL_KEYS, raidMarkerDisplayName } from '../raid_marker_labels_view';
import { offersRaidTargetIcon, type RaidTargetMarking } from '../raid_target_icons_core';
import { svgIcon } from '../ui_icons';

/** Which menu the target frame opens for `target`, or null for a target that
 *  has no menu at all (a corpse, an NPC, an outsider's follower, or a unit you
 *  may not mark while you hold no marking rights).
 *
 *  - `player`: another player -> the social/party menu (which carries its own
 *    raid target icon row when the player is markable).
 *  - `pet`: your own commandable pet -> the pet menu (rename/revive/abandon).
 *  - `buddy`: your own cosmetic buddy -> the buddy menu (autoloot). A buddy
 *    takes no pet commands at all, which is why isControllableOwnedPet
 *    excludes it and this is a separate arm rather than a row over there.
 *  - `marker`: any other unit that can carry a raid target icon while you may
 *    set one (a live wild mob, yourself, a group member's pet or buddy) -> the
 *    raid-marker menu. offersRaidTargetIcon is Sim.setMarker's own rule, so
 *    the menu never opens where every row would be a no-op.
 *
 *  Order matters: your own pet and buddy keep their own menus ahead of the
 *  marker arm, so no target can match two arms. */
export function targetFrameMenuKind(
  target: Entity,
  viewerId: number,
  marking: RaidTargetMarking | null,
): 'player' | 'pet' | 'buddy' | 'marker' | null {
  if (target.kind === 'player' && target.id !== viewerId) return 'player';
  if (isControllableOwnedPet(target, viewerId)) return 'pet';
  if (isOwnBuddy(target, viewerId)) return 'buddy';
  return offersRaidTargetIcon(target, marking) ? 'marker' : null;
}

/** Rename, the autoloot errand and Cancel. `armed` is the owner's CURRENT
 *  Entity.buddyAutoloot as it came off the wire, so the row offers the flip
 *  the server would actually make, never a local guess. `raidTarget` adds the
 *  Raid Target Icon row (in a group, with marking rights). */
export function buddyMenuHtml(name: string, armed: boolean, raidTarget = false): string {
  const label = armed
    ? t('hudChrome.buddyMenu.autolootDisable')
    : t('hudChrome.buddyMenu.autolootEnable');
  const hint = esc(t('hudChrome.buddyMenu.autolootHint'));
  return (
    `<div class="ctx-title">${esc(name)}</div>` +
    `<div class="ctx-item" data-act="rename">${esc(t('hudChrome.buddyMenu.rename'))}</div>` +
    `<div class="ctx-item" data-act="autoloot" title="${hint}">${esc(label)}</div>` +
    (raidTarget ? raidTargetMenuRowHtml() : '') +
    `<div class="ctx-item" data-act="close">${esc(t('hudChrome.buddyMenu.cancel'))}</div>`
  );
}

/** The raid target icon picker: the unit's name, one row per symbol (the one
 *  the unit wears now carries the check and the "selected" spoken name), then
 *  Clear and Cancel. `current` is the unit's mark as the group sees it
 *  (IWorld.markerFor); `iconUrl` resolves a symbol's art (icons.ts). Picking
 *  the CURRENT symbol again takes it off, which is the sim's toggle. */
export function raidTargetMenuHtml(
  name: string,
  current: number | null,
  iconUrl: (symbol: number) => string,
): string {
  let html = `<div class="ctx-title">${esc(name)}</div>`;
  for (let i = 0; i < RAID_MARKER_LABEL_KEYS.length; i++) {
    const markerName = raidMarkerDisplayName(i);
    const aria =
      current === i
        ? t('hud.markers.markerSelectedAria', { marker: markerName })
        : t('hud.markers.markerAria', { marker: markerName });
    const check = current === i ? `<span class="ctx-selected">${svgIcon('check')}</span>` : '';
    html += `<div class="ctx-item" role="button" tabindex="0" data-act="m${i}" aria-label="${esc(aria)}"><span class="ctx-mark" style="background-image:url(${iconUrl(i)})"></span>${esc(markerName)}${check}</div>`;
  }
  html += `<div class="ctx-item" role="button" tabindex="0" data-act="clear">${esc(t('hud.markers.clear'))}</div>`;
  html += `<div class="ctx-item" role="button" tabindex="0" data-act="close">${esc(t('hud.markers.cancel'))}</div>`;
  return html;
}

/** The row a unit menu (the player menu, the pet menu) adds to open the
 *  picker. Its hover title explains what an icon does. */
export function raidTargetMenuRowHtml(): string {
  const tip = esc(t('hudChrome.raidTargets.menuRowTip'));
  return `<div class="ctx-item" data-act="raid-target" title="${tip}">${esc(t('hudChrome.raidTargets.menuRow'))}</div>`;
}
