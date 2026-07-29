// Pure map from a chat channel to the overhead speech-bubble style it uses, or
// null for channels that never bubble. DOM/Three-free so a Vitest drives it in
// Node, and it is the ONE source both the HUD bubble gate (which decides whether
// a message bubbles) and the renderer (which paints the tint) read, so a
// channel's chat-log colour and its bubble tint can never drift apart.
//
// Only nearby-speaker channels bubble. say/yell/emote already did; party is
// added here (issue #1659), because a party message carries the speaker's entity
// id (its emit sets fromPid = the speaker entity), so a nearby teammate's line
// can bubble over their head with no sim or wire change. Every other channel
// returns null so the gate skips it: general/world/lfg/whisper/roll are too noisy
// or private, and guild/officer are server social broadcasts that carry no
// speaker id today, so the client has no entity to anchor a bubble to (see the
// gate comment in hud.ts; giving them bubbles is a server/wire follow-up).
//
// The bubble background stays near-white with dark text for legibility, so a
// channel tint colours the BORDER only, never the text (mirroring how the
// existing `yell` bubble tints its border, not the body copy). yell keeps its
// bespoke `.yell` class treatment rather than an inline border, so say/yell/emote
// bubbles stay byte-identical to before this change.

export interface ChatBubbleStyle {
  // Apply the existing `.yell` treatment (bold text, red border). Only `yell`.
  yell?: boolean;
  // Inline border colour for a channel bubble. Set for party; omitted for
  // say/yell/emote, which keep the stylesheet default / `.yell` border
  // untouched. Hex string matching the channel's chat-log colour.
  border?: string;
}

// The party bubble border mirrors the chat-log party colour in hud.ts (#7fd4ff)
// so the log line and the bubble match. This is the documented "renderer hex
// literals verbatim" exception (src/styles/CLAUDE.md): a bubble tint is
// presentation the renderer paints inline, not a themable token.
const PARTY_BUBBLE_BORDER = '#7fd4ff';

// The style a channel's overhead bubble uses, or null when that channel does not
// bubble at all. `channel` is passed through as a plain string so the gate can
// hand it the optional wire value directly.
export function chatBubbleStyle(channel: string): ChatBubbleStyle | null {
  switch (channel) {
    case 'say':
    case 'emote':
      return {};
    case 'yell':
      return { yell: true };
    case 'party':
      return { border: PARTY_BUBBLE_BORDER };
    default:
      // general, world, lfg, whisper, roll, guild, officer (no client-side
      // speaker anchor), and any future channel: no bubble.
      return null;
  }
}
