// Group chat link: the [[g:<listingId>:<activityId>]] segment a listing advert
// posts to General, rendered as a clickable "[LFM: <dungeon> (<difficulty>)]"
// that opens the Groups window on that listing (the caller passes the
// DungeonFinderWindow, whose openListing jumps to and spotlights the row).
//
// The quest/item/deed link doctrine applies: the label is resolved from the
// local activity catalogue, never from the wire, so a forged token cannot
// misrepresent its content, and an unknown activity (content drift between
// players) degrades to a plain "[?]". The click only opens the board; the
// board's own live listing (members, open roles, Apply) is what the player acts
// on, so a stale or forged listing number can never apply anyone anywhere.
//
// Nodes only: built with createElement/textContent. The one innerHTML write is
// the static group icon from svgIcon (no player data).

import { finderActivity } from '../../../sim/content/dungeon_finder';
import { dungeonDisplayName } from '../../entity_i18n';
import { t } from '../../i18n';
import { svgIcon } from '../../ui_icons';

/** The localized link label ("LFM: The Hollow Crypt (Heroic)"), or null when
 *  the activity is not in this client's catalogue. */
export function groupChatLinkLabel(activityId: string): string | null {
  const activity = finderActivity(activityId);
  if (!activity) return null;
  return t('hudChrome.finder.chatLink', {
    dungeon: dungeonDisplayName(activity.dungeonId),
    difficulty: t(
      activity.difficulty === 'heroic' ? 'hudChrome.finder.heroic' : 'hudChrome.finder.normal',
    ),
  });
}

/** The plain "[LFM: ...]" form, for surfaces that cannot host a link (3D chat
 *  bubbles). */
export function groupChatLinkPlainText(activityId: string): string {
  return `[${groupChatLinkLabel(activityId) ?? '?'}]`;
}

/**
 * The clickable group link: the chat-quest-link wiring (role="button", tab
 * stop, click plus Enter/Space), styled by .chat-group-link with a group icon
 * so it never reads as an item link, even without color.
 */
export function groupChatLinkEl(
  doc: Document,
  seg: { listingId: number; activityId: string },
  groups: { openListing(listingId: number): void },
): Node {
  const label = groupChatLinkLabel(seg.activityId);
  if (!label) return doc.createTextNode('[?]');
  const link = doc.createElement('span');
  link.className = 'chat-group-link';
  link.setAttribute('role', 'button');
  link.tabIndex = 0;
  link.dataset.listingId = String(seg.listingId);
  const icon = doc.createElement('span');
  icon.className = 'chat-group-link-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = svgIcon('social');
  link.append('[', icon, `${label}]`);
  const open = (): void => groups.openListing(seg.listingId);
  link.addEventListener('click', open);
  link.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    open();
  });
  return link;
}
