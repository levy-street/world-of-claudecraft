// The flair a chat line carries for its SENDER: the AI-operated mark and the
// streamer links derived from the account's operator-set flair, or undefined
// when the account has none, so an ordinary player's chat event is
// byte-unchanged on the wire. The links run through the same
// wireStreamerLinks gate the entity encoding uses: an account whose streamer
// flag is off ships no links here either, whatever is stored. A pure helper
// extracted from server/game.ts; tests/chat_sender_flair.test.ts pins the
// shapes.

import {
  type AccountFlair,
  type ChatSenderFlair,
  wireStreamerLinks,
} from '../src/sim/account_flair';

export function chatSenderFlair(flair: AccountFlair): ChatSenderFlair | undefined {
  const links = wireStreamerLinks(flair);
  if (!flair.ai && !links) return undefined;
  const out: ChatSenderFlair = {};
  if (flair.ai) out.ai = true;
  if (links) out.links = links;
  return out;
}
