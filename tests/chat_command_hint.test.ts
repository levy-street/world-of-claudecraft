// Discoverability regression for issue #1230: the in-game "!" community-commands
// autocomplete (src/ui/chat_command_menu.ts, catalog src/sim/discord_relay.ts) had
// no hint anywhere telling a player it existed; the chat placeholder listed the
// slash commands but never mentioned "!". Pins that the chat placeholder on BOTH
// desktop and mobile now surfaces a "!" hint, and that the underlying "!" input
// detection (unchanged by this change) still agrees with what the hint promises.
import { describe, expect, it } from 'vitest';
import { isRelayInput } from '../src/sim/discord_relay';
import { en } from '../src/ui/i18n';

describe('chat "!" command hint (issue #1230)', () => {
  it('desktop chat placeholder mentions the "!" community commands', () => {
    expect(en.hud.core.chatPlaceholder).toContain('!');
  });

  it('mobile chat placeholder surfaces the same hint', () => {
    // The mobile placeholder is deliberately short (no slash-command legend, see
    // hud_chrome.ts's chatPlaceholder comment): mobile has no hover for a
    // tooltip, so the always-visible placeholder is the one surface both
    // platforms share, and both must carry the hint.
    expect(en.hudChrome.mobile.chatPlaceholder).toContain('!');
  });

  it('the hinted "!" prefix is exactly what opens the real command menu', () => {
    // Guards against the hint text and the actual autocomplete trigger (src/ui/
    // chat_command_menu.ts, driven by isRelayInput) drifting apart: both must
    // agree on the same leading character.
    expect(isRelayInput('!')).toBe(true);
  });
});
