// Best-effort channel label for the chat-violation log: the hard-word gate
// runs before a message is routed, so the channel is inferred from the
// command prefix, falling back to the channel the player last used. A pure
// helper extracted from server/game.ts (the coordinator only supplies the
// remembered channel); tests/chat_channel_hint.test.ts pins the prefix table.

export function chatChannelHint(rememberedChannel: string, text: string): string {
  if (/^\/(?:g|gu|guild)\s/i.test(text)) return 'guild';
  if (/^\/(?:o|officer)\s/i.test(text)) return 'officer';
  if (/^\/(?:w|whisper|t|tell|r|reply)\s/i.test(text)) return 'whisper';
  if (/^\/(?:y|yell)\s/i.test(text)) return 'yell';
  if (/^\/(?:p|party)\s/i.test(text)) return 'party';
  if (/^\/(?:general|world)\s/i.test(text)) return 'general';
  if (/^\/(?:s|say)\s/i.test(text)) return 'say';
  return rememberedChannel;
}
