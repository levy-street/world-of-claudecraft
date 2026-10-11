// Only authoritative loot receipt metadata supplies an exact-copy chat link.
// User-typed item tokens retain their static definition-only meaning.
import type { ItemInstancePayload, SimEvent } from '../sim/types';
import { itemStackDisplayName } from './entity_display_core';
import { parseChatSegments, tryEncodeItemLink } from './hud/quest/quest_link';
import { t } from './i18n';

export function lootQualityReceiptText(
  event: Extract<SimEvent, { type: 'loot' }>,
  localize: (text: string) => string,
): string {
  // Grant receipts are prose at the sim boundary. Build their translated item
  // slot from authoritative metadata before the ordinary name localizer erases
  // the distinction between copies. Other loot messages keep their own matcher.
  if (
    event.instance?.lootQuality &&
    event.itemId &&
    /^You receive: .+\.$/.test(event.text) &&
    Number.isSafeInteger(event.count) &&
    event.count! > 0
  ) {
    const token = tryEncodeItemLink(event.itemId);
    if (token)
      return t('hud.logs.lootReceiveItem', {
        item: itemStackDisplayName(token, event.count! > 1 ? ` x${event.count}` : undefined),
      });
  }
  return localize(event.text);
}

/** The whole receipt body for the hud's one guarded log() call: the localized
 *  text for an ordinary line, or, when the event names a quality-rolled copy,
 *  the nodes whose matching item link carries that exact copy. */
export function lootQualityReceiptBody(
  doc: Document,
  event: Extract<SimEvent, { type: 'loot' }>,
  localize: (text: string) => string,
  appendLink: (parent: HTMLElement, id: string, copy?: ItemInstancePayload) => void,
): string | Node[] {
  const text = lootQualityReceiptText(event, localize);
  if (!event.itemId || !event.instance?.lootQuality) return text;
  return lootQualityReceiptNodes(doc, text, event.itemId, event.instance, appendLink);
}

export function lootQualityReceiptNodes(
  doc: Document,
  text: string,
  itemId: string,
  instance: ItemInstancePayload,
  appendLink: (parent: HTMLElement, id: string, copy?: ItemInstancePayload) => void,
): Node[] {
  const body = doc.createElement('span');
  for (const segment of parseChatSegments(text)) {
    if (segment.kind === 'item') {
      appendLink(body, segment.itemId, segment.itemId === itemId ? instance : undefined);
    } else if (segment.kind === 'text') {
      body.append(doc.createTextNode(segment.value));
    }
  }
  return [body];
}
