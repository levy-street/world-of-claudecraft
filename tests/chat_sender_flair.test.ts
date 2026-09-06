import { describe, expect, it } from 'vitest';
import { chatSenderFlair } from '../server/chat_sender_flair';
import {
  type AccountFlair,
  EMPTY_ACCOUNT_FLAIR,
  wireStreamerLinks,
} from '../src/sim/account_flair';

describe('chatSenderFlair (the wire-ready chat flair)', () => {
  it('is undefined for an unflagged account, so an ordinary sender adds nothing to the frame', () => {
    expect(chatSenderFlair(EMPTY_ACCOUNT_FLAIR)).toBeUndefined();
  });

  it('carries exactly { ai: true } for an AI-operated account with no streamer links', () => {
    expect(chatSenderFlair({ ...EMPTY_ACCOUNT_FLAIR, ai: true })).toEqual({ ai: true });
  });

  it('ships streamer links only through the same gate the entity wire uses', () => {
    const flair: AccountFlair = {
      ai: false,
      streamer: true,
      links: { twitch: 'https://twitch.tv/somebody' },
    };
    const links = wireStreamerLinks(flair);
    expect(links).toBeDefined();
    expect(chatSenderFlair(flair)).toEqual({ links });
    // The streamer flag OFF hides the links even when the row carries them.
    expect(chatSenderFlair({ ...flair, streamer: false })).toBeUndefined();
  });

  it('combines the AI mark and the links when both apply', () => {
    const flair: AccountFlair = {
      ai: true,
      streamer: true,
      links: { twitch: 'https://twitch.tv/somebody' },
    };
    expect(chatSenderFlair(flair)).toEqual({ ai: true, links: wireStreamerLinks(flair) });
  });
});
