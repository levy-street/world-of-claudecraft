// Chat-line assembly, lifted out of Hud.chatLogFrom so it can be driven directly
// by a test. Two jobs, both about WHERE a node lands in the line:
//
//  - `chatAiTagEl` / `chatStreamerBadgeEl` build the account-flair marks (see
//    sim/account_flair.ts).
//  - `appendChatLineParts` splices the sender name, those marks, and the message
//    body into the localized channel template.
//
// The marks' placement is the load-bearing part. A channel template is localized
// prose around two slots ('[General] {name}: {message}'), so a mark must land at
// the {name} slot, immediately before the name, NOT at the head of the line where
// it would read as part of the channel prefix. Nodes only: the line is built with
// createElement/textContent, never innerHTML, so nothing here can inject markup
// (the one exception, the streamer badge's icon glyph, is a fixed literal from the
// icon registry, never interpolated user text; see chatStreamerBadgeEl).

import type { StreamerLinks } from '../../../sim/account_flair';
import { streamerLinkList } from '../../../sim/account_flair';
import { specialRoleColor } from '../../../sim/discord_roles';
import { discordRoleTagLabel } from '../../discord_role_tag';
import { t } from '../../i18n';
import { svgIcon } from '../../ui_icons';

export const CHAT_NAME_TOKEN = '__WOC_CHAT_NAME__';
export const CHAT_MESSAGE_TOKEN = '__WOC_CHAT_MESSAGE__';

const SLOT_SPLIT_RE = new RegExp(`(${CHAT_NAME_TOKEN}|${CHAT_MESSAGE_TOKEN})`);

export interface ChatLineParts {
  /** the colored staff/special-role tag ([Levy St], [Core Dev], ...), drawn
   * first among the name-slot marks; null for a sender with no special role */
  roleTag: Node | null;
  /** the [AI] flair tag, drawn immediately before the name; null for a normal sender */
  aiTag: Node | null;
  /** the verified-streamer flair badge, drawn immediately before the name (after
   * the [AI] tag, if both apply); null for a non-streamer sender */
  streamerBadge: Node | null;
  /** the clickable sender-name span */
  sender: Node;
  /** paints the message body (quest/item links, masking) into the line */
  appendBody: (parent: HTMLElement) => void;
}

/**
 * The animated-gradient [AI] tag shown beside an AI-operated account's name.
 *
 * This is a DISCLOSURE, not decoration, which is why it carries an aria-label and not
 * just a title. The visible glyphs are the bare literal "[AI]", and assistive tech
 * announces `title` inconsistently (and often not at all when the element is not
 * focusable), so a screen-reader user would otherwise hear a player's name read out
 * with no indication they are talking to a bot. `role="img"` plus the label makes the
 * span announce its MEANING ("AI-operated account") rather than the bracketed
 * abbreviation. The title stays for the mouse.
 */
export function chatAiTagEl(doc: Document): HTMLSpanElement {
  const tag = doc.createElement('span');
  tag.className = 'ai-tag';
  tag.textContent = t('hudChrome.playerMenu.aiTag');
  tag.title = t('hudChrome.playerMenu.aiTagTitle');
  tag.setAttribute('role', 'img');
  tag.setAttribute('aria-label', t('hudChrome.playerMenu.aiTagTitle'));
  return tag;
}

/**
 * The colored staff/special-role tag shown beside a staff member's chat name
 * ([Levy St], [Core Dev], [Mod], ...), the anti-impersonation disclosure. The
 * key arrives ONLY via the server-stamped ChatSenderFlair (a client cannot
 * forge it), and both the label and color resolve through the same shared
 * catalog the nameplates use, so chat and the world always agree on what a
 * role looks like. Null for an unknown key, so a bad wire value draws nothing.
 *
 * Like the [AI] tag this is a DISCLOSURE, not decoration: role="img" plus an
 * aria-label that states the MEANING (a verified server role), because a
 * screen-reader user is exactly as impersonatable as a sighted one.
 */
export function chatRoleTagEl(doc: Document, roleKey: string | undefined): Node | null {
  const label = discordRoleTagLabel(roleKey);
  if (!label) return null;
  const tag = doc.createElement('span');
  tag.className = 'chat-role-tag';
  tag.textContent = `[${label}]`;
  const color = specialRoleColor(roleKey);
  if (color) tag.style.color = color;
  const title = t('hudChrome.discord.roleTagChatTitle', { role: label });
  tag.title = title;
  tag.setAttribute('role', 'img');
  tag.setAttribute('aria-label', title);
  return tag;
}

/**
 * The verified-streamer flair badge shown beside a broadcaster's chat name: a
 * brand icon for their first present, revalidated link (STREAMER_PLATFORMS
 * order). Absent for a sender with no live link, so a plain player never draws
 * one. Clicking it is wired by the caller to the same player menu the name
 * itself opens (the menu already lists every channel link up top), so this
 * builder never touches `window.open` or an interpolated href itself.
 */
export function chatStreamerBadgeEl(doc: Document, links: StreamerLinks | undefined): Node | null {
  const first = streamerLinkList(links)[0];
  if (!first) return null;
  const badge = doc.createElement('span');
  badge.className = 'streamer-badge';
  badge.innerHTML = svgIcon(first.platform);
  const label = t('hudChrome.playerMenu.streamerBadgeTitle');
  badge.title = label;
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', label);
  return badge;
}

/**
 * Fill `div` from a localized channel template whose {name} / {message} slots have
 * already been rendered to CHAT_NAME_TOKEN / CHAT_MESSAGE_TOKEN. A locale that
 * drops or mangles a slot falls back to the plain "name: message" form, so a bad
 * translation can never swallow the message text.
 */
export function appendChatLineParts(
  div: HTMLElement,
  rendered: string,
  parts: ChatLineParts,
): void {
  let senderAppended = false;
  let messageAppended = false;
  for (const part of rendered.split(SLOT_SPLIT_RE)) {
    if (part === CHAT_NAME_TOKEN) {
      if (parts.roleTag) div.append(parts.roleTag);
      if (parts.aiTag) div.append(parts.aiTag);
      if (parts.streamerBadge) div.append(parts.streamerBadge);
      div.append(parts.sender);
      senderAppended = true;
    } else if (part === CHAT_MESSAGE_TOKEN) {
      parts.appendBody(div);
      messageAppended = true;
    } else if (part) {
      div.append(div.ownerDocument.createTextNode(part));
    }
  }
  if (senderAppended && messageAppended) return;
  div.textContent = '';
  if (parts.roleTag) div.append(parts.roleTag);
  if (parts.aiTag) div.append(parts.aiTag);
  if (parts.streamerBadge) div.append(parts.streamerBadge);
  div.append(parts.sender, div.ownerDocument.createTextNode(': '));
  parts.appendBody(div);
}
