// Best-effort channel label for the chat-filter violation log (Masterwrought
// phase 18, extracted from server/game.ts to pay for the perfect_item naming
// arm's lines under the monolith ratchet; behavior is byte-identical, this is
// a move, not a rewrite).
//
// The hard-word gate runs BEFORE the message is routed, so there is no routed
// channel to read yet: infer it from the command prefix the sender typed, and
// fall back to the channel they last used when the text carries no prefix.
// A label, never an authorization: nothing keys a permission off this value,
// it only tells a moderator reading the violation row where the words landed.
//
// The extraction narrows the parameter from the whole session to the one field
// it read (`session.rememberedChat.channel`), which is what lets a Vitest drive
// every prefix without a GameServer (server/CLAUDE.md: pure decision logic goes
// in a host-agnostic module a Vitest imports directly).
export function chatChannelHint(text: string, fallback: string): string {
  if (/^\/(?:g|gu|guild)\s/i.test(text)) return 'guild';
  if (/^\/(?:o|officer)\s/i.test(text)) return 'officer';
  if (/^\/(?:w|whisper|t|tell|r|reply)\s/i.test(text)) return 'whisper';
  if (/^\/(?:y|yell)\s/i.test(text)) return 'yell';
  if (/^\/(?:p|party)\s/i.test(text)) return 'party';
  if (/^\/(?:general|world)\s/i.test(text)) return 'general';
  if (/^\/(?:s|say)\s/i.test(text)) return 'say';
  return fallback;
}
