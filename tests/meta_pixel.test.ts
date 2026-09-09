// Behavioral coverage for the Meta pixel sender (src/game/meta_pixel.ts).
//
// Until now the module was watched only by raw SOURCE TEXT, in
// tests/client_shell.test.ts ("if (options) fbq('trackCustom', ...)" and its
// else arm, matched with toContain against an UNSTRIPPED read). That pin is
// comment-gameable in the most literal way: comment out both statements and
// paste the two lines verbatim into a comment above them, and this module
// sends nothing while all 121 cases in that file still pass (measured). These
// cases call the function and watch what reaches `fbq`, so the same mutation
// reds here.
//
// WHAT THIS FILE DOES NOT COVER, so it is never read as the whole pixel.
// src/main.ts carries a byte-identical PRIVATE copy of trackMetaPixel and does
// not import this module, so the marketing shell's own sends (GitHubClick,
// DiscordClick, the account-registration event) never reach the code under
// test here. Their only guard is the same comment-gameable shape: the mainTs
// assertions in tests/client_shell.test.ts read src/main.ts RAW rather than
// through the stripLineComments view that file already builds for its pad
// pins, so commenting that copy out the same way leaves this file and all of
// client_shell green (measured). Collapsing the duplicate onto this module is
// the real fix and is a src/main.ts edit, so it is left to the integrator
// rather than papered over with a second source-text pin here.
//
// Plain Node environment: the module reads exactly one property off `window`,
// so a stubbed global models the whole host and no DOM env is needed. The
// absent-pixel case is the ORDINARY one in production (the pixel is loaded by
// the marketing shell and is simply missing on /play, on desktop, on the
// Capacitor shells, and behind a content blocker), so it is a first-class case
// here rather than an edge.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackMetaPixel } from '../src/game/meta_pixel';

/** Install a window whose pixel is `fbq` (pass nothing for a shell with none). */
function stubWindow(fbq?: unknown): void {
  vi.stubGlobal('window', fbq === undefined ? {} : { fbq });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('trackMetaPixel', () => {
  it('sends the THREE-argument custom event when no options are given', () => {
    const fbq = vi.fn();
    stubWindow(fbq);
    trackMetaPixel('ReachedLevel5', { level: 5 });
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq.mock.calls[0], 'the arity is the contract').toHaveLength(3);
    expect(fbq.mock.calls[0]).toEqual(['trackCustom', 'ReachedLevel5', { level: 5 }]);
  });

  it('defaults a missing data payload to an empty object, still at three arguments', () => {
    const fbq = vi.fn();
    stubWindow(fbq);
    trackMetaPixel('GitHubClick');
    expect(fbq.mock.calls[0]).toHaveLength(3);
    expect(fbq.mock.calls[0]).toEqual(['trackCustom', 'GitHubClick', {}]);
  });

  it('sends the FOUR-argument form when options are given', () => {
    // The two arities are NOT interchangeable, which is why the branch exists:
    // the pixel reads an eventID out of the fourth slot for deduplication, and
    // passing `undefined` there is a different call from omitting it.
    const fbq = vi.fn();
    stubWindow(fbq);
    trackMetaPixel('ReachedLevel5', { level: 5 }, { eventID: 'lvl5_7' });
    expect(fbq.mock.calls[0]).toHaveLength(4);
    expect(fbq.mock.calls[0]).toEqual([
      'trackCustom',
      'ReachedLevel5',
      { level: 5 },
      { eventID: 'lvl5_7' },
    ]);
  });

  it('is silent, not fatal, on a shell that carries no pixel', () => {
    stubWindow();
    expect(() => trackMetaPixel('GitHubClick', { source: 'footer' })).not.toThrow();
    // ...and on one where the slot is occupied by something uncallable (a
    // blocker stub), which is the shape that would throw on a bare truthiness
    // check.
    stubWindow('blocked');
    expect(() => trackMetaPixel('GitHubClick')).not.toThrow();
  });
});
