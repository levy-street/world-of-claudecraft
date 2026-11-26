// The chat callout a ping writes, the DOM half (the parts are
// ping_chat_line_core.ts): one line wrapped in .ping-chat-line plus the kind's
// .ping-kind-N class (which sets --ping-color from the --color-ping-* token),
// led by the kind's own badge (src/ui/ping_icons.ts), then the sender as the
// usual clickable chat name, the callout words in the kind's colour and the
// unit's name in its reaction colour (.is-hostile / .is-friendly /
// .is-neutral). A player's name, sender or target, opens the same player menu
// every chat name opens.
//
// Nodes only (createElement / textContent), never innerHTML: the names are
// player and wire text.

import { t } from '../../i18n';
import { pingIconUrl } from '../../ping_icons';
import { bindTouchTap } from '../../touch_tap';
import type { PingChatLineModel } from './ping_chat_line_core';

export interface PingChatLineDeps {
  /** Open the chat player menu for `name` under `anchor` (absent: names are plain). */
  openPlayerMenu?: (name: string, anchor: HTMLElement, x?: number, y?: number) => void;
  /** Whether the pinged unit is a player (its name then opens the menu too). */
  targetIsPlayer?: boolean;
}

function playerName(
  doc: Document,
  className: string,
  name: string,
  open: PingChatLineDeps['openPlayerMenu'],
): HTMLSpanElement {
  const el = doc.createElement('span');
  el.className = className;
  el.textContent = name;
  if (!open) return el;
  const label = t('hudChrome.playerMenu.openFor', { name });
  el.classList.add('chat-player-name');
  el.title = label;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', label);
  el.tabIndex = 0;
  // bindTouchTap binds click itself (see Hud.chatLogFrom): never a second click handler.
  bindTouchTap(el, () => open(name, el));
  el.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    open(name, el, ev.clientX, ev.clientY);
  });
  el.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    open(name, el);
  });
  return el;
}

/** The line's nodes: one .ping-chat-line span the chat line div takes as its body. */
export function pingChatLineNodes(
  doc: Document,
  model: PingChatLineModel,
  deps: PingChatLineDeps = {},
): Node[] {
  const line = doc.createElement('span');
  line.className = `ping-chat-line ${model.kindClass}`;
  const icon = doc.createElement('img');
  icon.className = 'ping-chat-icon';
  icon.alt = '';
  icon.draggable = false;
  icon.setAttribute('aria-hidden', 'true');
  icon.src = pingIconUrl(model.kind);
  line.append(icon);
  for (const part of model.parts) {
    if (part.part === 'text') {
      line.append(doc.createTextNode(part.text));
    } else if (part.part === 'sender') {
      line.append(playerName(doc, 'ping-chat-sender', part.text, deps.openPlayerMenu));
    } else if (part.part === 'callout') {
      const el = doc.createElement('span');
      el.className = 'ping-chat-callout';
      el.textContent = part.text;
      line.append(el);
    } else {
      const open = deps.targetIsPlayer ? deps.openPlayerMenu : undefined;
      const el = playerName(doc, `ping-chat-target is-${part.reaction}`, part.text, open);
      line.append(el);
    }
  }
  return [line];
}
