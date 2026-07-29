// Deed chat-link assembly, the chat_line.ts pattern applied to the Book of
// Deeds announcements: the deed-unlock and deed-broadcast lines carry the
// deed NAME as a clickable segment that jumps straight to that deed's card
// (the caller wires onOpen to DeedsWindow.openWithDeed). The line template is
// rendered with the {name}/{deed} slot as DEED_NAME_TOKEN and spliced here,
// so the localized prose stays intact around a real interactive node.
//
// Nodes only: the line is built with createElement/textContent, never
// innerHTML, so nothing here can inject markup. The link label is resolved by
// the caller from the local catalog (deed_i18n deedName), never from the
// wire, so a forged label cannot misrepresent the target (the quest/item
// link doctrine).

/** The sentinel a deed announcement template renders its deed slot to. */
export const DEED_NAME_TOKEN = '__WOC_DEED_NAME__';

/**
 * The clickable [Deed Name] segment: the chat-quest-link wiring exactly
 * (role="button", tab stop, click plus Enter/Space), styled by
 * .chat-deed-link so it reads as a link inside the announcement's own line
 * color.
 */
export function deedChatLinkEl(doc: Document, label: string, onOpen: () => void): HTMLSpanElement {
  const link = doc.createElement('span');
  link.className = 'chat-deed-link';
  link.textContent = `[${label}]`;
  link.setAttribute('role', 'button');
  link.tabIndex = 0;
  link.addEventListener('click', onOpen);
  link.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    onOpen();
  });
  return link;
}

/**
 * Splice a rendered announcement template into chat-line nodes, one fresh
 * link node per DEED_NAME_TOKEN occurrence (a node can only sit in one DOM
 * slot). A locale that dropped the slot keeps its prose and gets the link
 * appended after it, so a bad translation can never swallow the jump (the
 * appendChatLineParts fallback doctrine).
 */
export function deedLineNodes(doc: Document, rendered: string, makeLink: () => Node): Node[] {
  const parts = rendered.split(DEED_NAME_TOKEN);
  if (parts.length === 1) {
    const out: Node[] = [];
    if (rendered !== '') out.push(doc.createTextNode(`${rendered} `));
    out.push(makeLink());
    return out;
  }
  const out: Node[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push(makeLink());
    if (part !== '') out.push(doc.createTextNode(part));
  });
  return out;
}
