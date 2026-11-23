// Chat-link token contract. A chat link is a tiny, name-free token the client embeds
// in chat text; the renderer resolves the localized name from the quest / item table,
// so a forged label can't misrepresent the target. Two link kinds share one parser so
// a message can mix them: quests ([[q:id]]) and items ([[i:id]]). Pure + host-free
// (Vitest imports it directly). Only the client uses it, the sim never sees tokens.
//
// ENCODING IS GUARDED (#2459). The parser matches a bounded id charset, and a
// token it cannot match is not dropped: it survives parseChatSegments as a text
// segment, so the player reads the literal "[[i:...]]" source. Every production
// encode site therefore goes through tryEncodeQuestLink / tryEncodeItemLink,
// which answer "is this id safe to encode" once, here, beside the regex that
// decides it. The raw encoders stay exported for the parser-agreement test only.

//
// A third kind, the group link ([[g:<listingId>:<activityId>]]), is minted by the
// sim's listing advert (src/sim/social/finder_advert.ts finderGroupLinkToken) and
// opens the Groups window on that listing. Its label comes from the local activity
// catalogue, so it follows the same no-forged-label rule.

export type ChatSegment =
  | { kind: 'text'; value: string }
  | { kind: 'quest'; questId: string }
  | { kind: 'item'; itemId: string }
  | { kind: 'group'; listingId: number; activityId: string };

// Quest/item ids are [A-Za-z0-9_]+ (e.g. "q_wolves", "sword_iron"). The kind prefix
// (q | i) selects the segment kind. A group link carries a positive listing number
// (at most 9 digits) and an activity id in the same charset. Global so we can walk
// every match.
const CHAT_LINK_RE = /\[\[(?:([qi]):([A-Za-z0-9_]+)|g:([1-9][0-9]{0,8}):([A-Za-z0-9_]+))\]\]/g;

// The same id charset as CHAT_LINK_RE, anchored, for callers that build a token
// from an id they did not choose (content data). A token whose id the parser
// cannot match is NOT dropped by parseChatSegments: it survives as a text
// segment, so the player reads the literal "[[i:...]]" source. This lives beside
// the regex so the two can never answer the question differently, and it is the
// ONE place the charset is written down.
const LINKABLE_ID_RE = /^[A-Za-z0-9_]+$/;

export function isLinkableId(id: string): boolean {
  return LINKABLE_ID_RE.test(id);
}

// The RAW encoders below interpolate whatever id they are handed, charset and
// all, so a caller that skipped the guard would ship source text to the player.
// Production code uses the tryEncode* pair instead (pinned by
// tests/quest_link.test.ts); these stay exported only so that suite can mint a
// deliberately unmatchable token and prove the parser rejects it, which is what
// binds isLinkableId to the PARSER rather than to a second copy of the charset.
export function encodeQuestLink(questId: string): string {
  return `[[q:${questId}]]`;
}

export function encodeItemLink(itemId: string): string {
  return `[[i:${itemId}]]`;
}

/** The chat token for `questId`, or null when the parser's charset would not
 *  match the id. Returning null rather than a doomed token is what lets the
 *  guard live at the encoder instead of being restated (or forgotten) at each
 *  call site: a caller with a fallback takes it, a caller without one returns
 *  early, and neither has to know the charset. */
export function tryEncodeQuestLink(questId: string): string | null {
  return isLinkableId(questId) ? encodeQuestLink(questId) : null;
}

/** The item-side twin of `tryEncodeQuestLink`. */
export function tryEncodeItemLink(itemId: string): string | null {
  return isLinkableId(itemId) ? encodeItemLink(itemId) : null;
}

export function parseChatSegments(text: string): ChatSegment[] {
  const segments: ChatSegment[] = [];
  let last = 0;
  CHAT_LINK_RE.lastIndex = 0;
  let m = CHAT_LINK_RE.exec(text);
  while (m) {
    if (m.index > last) segments.push({ kind: 'text', value: text.slice(last, m.index) });
    if (m[3] !== undefined)
      segments.push({ kind: 'group', listingId: Number(m[3]), activityId: m[4] });
    else
      segments.push(
        m[1] === 'q' ? { kind: 'quest', questId: m[2] } : { kind: 'item', itemId: m[2] },
      );
    last = m.index + m[0].length;
    m = CHAT_LINK_RE.exec(text);
  }
  if (last < text.length || segments.length === 0)
    segments.push({ kind: 'text', value: text.slice(last) });
  return segments;
}
