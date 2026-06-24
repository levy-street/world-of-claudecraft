// Quest-link token contract for chat. A quest link is a tiny, name-free token the
// client embeds in chat text; the renderer resolves the localized name from the
// quest table, so a forged label can't misrepresent the target. Pure + host-free
// (Vitest imports it directly). Only the client uses it — the sim never sees tokens.

export type ChatSegment = { kind: 'text'; value: string } | { kind: 'quest'; questId: string };

// Quest ids are [A-Za-z0-9_]+ (e.g. "q_wolves"). Global so we can walk every match.
const QUEST_LINK_RE = /\[\[q:([A-Za-z0-9_]+)\]\]/g;

export function encodeQuestLink(questId: string): string {
  return `[[q:${questId}]]`;
}

export function parseChatSegments(text: string): ChatSegment[] {
  const segments: ChatSegment[] = [];
  let last = 0;
  QUEST_LINK_RE.lastIndex = 0;
  let m = QUEST_LINK_RE.exec(text);
  while (m) {
    if (m.index > last) segments.push({ kind: 'text', value: text.slice(last, m.index) });
    segments.push({ kind: 'quest', questId: m[1] });
    last = m.index + m[0].length;
    m = QUEST_LINK_RE.exec(text);
  }
  if (last < text.length || segments.length === 0)
    segments.push({ kind: 'text', value: text.slice(last) });
  return segments;
}
