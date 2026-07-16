// Chat-line assembly, lifted out of Hud.chatLogFrom so it can be driven directly
// by a test. Two jobs, both about WHERE a node lands in the line:
//
//  - `chatAiTagEl` builds the [AI] account-flair tag (see sim/account_flair.ts).
//  - `appendChatLineParts` splices the sender name, that tag, and the message body
//    into the localized channel template.
//
// The tag's placement is the load-bearing part. A channel template is localized
// prose around two slots ('[General] {name}: {message}'), so the tag must land at
// the {name} slot, immediately before the name, NOT at the head of the line where
// it would read as part of the channel prefix. Nodes only: the line is built with
// createElement/textContent, never innerHTML, so nothing here can inject markup.

import { t } from '../../i18n';

export const CHAT_NAME_TOKEN = '__WOC_CHAT_NAME__';
export const CHAT_MESSAGE_TOKEN = '__WOC_CHAT_MESSAGE__';

const SLOT_SPLIT_RE = new RegExp(`(${CHAT_NAME_TOKEN}|${CHAT_MESSAGE_TOKEN})`);

export interface ChatLineParts {
  /** the [AI] flair tag, drawn immediately before the name; null for a normal sender */
  aiTag: Node | null;
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
      if (parts.aiTag) div.append(parts.aiTag);
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
  if (parts.aiTag) div.append(parts.aiTag);
  div.append(parts.sender, div.ownerDocument.createTextNode(': '));
  parts.appendBody(div);
}
