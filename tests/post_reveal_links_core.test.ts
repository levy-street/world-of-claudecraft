import { describe, expect, it } from 'vitest';
import {
  armPostRevealLinkWindow,
  createPostRevealLinkWindow,
  POST_REVEAL_BASELINE_EPSILON,
  POST_REVEAL_FRAME_STOP_MS,
  POST_REVEAL_LINK_WINDOW_MS,
  postRevealLinksSnapshot,
  resetPostRevealLinkWindow,
  samplePostRevealLinkWindow,
} from '../src/render/post_reveal_links_core';

describe('post-reveal link window', () => {
  it('is null before the arm and ignores samples taken behind the curtain', () => {
    const state = createPostRevealLinkWindow();
    samplePostRevealLinkWindow(state, 100, 900);
    expect(postRevealLinksSnapshot(state)).toBeNull();
    expect(state.samples).toBe(0);
  });

  it('opens at the arm on the current program count and reports the net growth', () => {
    const state = createPostRevealLinkWindow();
    armPostRevealLinkWindow(state, 1000, 1200);
    samplePostRevealLinkWindow(state, 1016, 1200);
    samplePostRevealLinkWindow(state, 1033, 1214);
    samplePostRevealLinkWindow(state, 5000, 1260);

    expect(postRevealLinksSnapshot(state)).toEqual({
      reveals: 1,
      revealsInWindow: 1,
      windowMs: POST_REVEAL_LINK_WINDOW_MS,
      programsAtReveal: 1200,
      programsGained: 60,
      samples: 3,
      unsampledMs: 3967,
      closed: false,
      baselineLost: false,
    });
  });

  it('closes at the window on the LAST in-window count, never on what came after', () => {
    const state = createPostRevealLinkWindow();
    armPostRevealLinkWindow(state, 1000, 100);
    samplePostRevealLinkWindow(state, 1500, 120);
    samplePostRevealLinkWindow(state, 20_999, 140);
    // The first sample at or past the window closes it; its own count (a
    // hidden tab's whole backlog, say) stays out.
    samplePostRevealLinkWindow(state, 21_000, 500);
    samplePostRevealLinkWindow(state, 40_000, 900);

    const snapshot = postRevealLinksSnapshot(state);
    expect(snapshot?.closed).toBe(true);
    expect(snapshot?.programsGained).toBe(40);
    expect(snapshot?.samples).toBe(2);
  });

  it('honors a custom window length', () => {
    const state = createPostRevealLinkWindow(5000);
    armPostRevealLinkWindow(state, 0, 10);
    samplePostRevealLinkWindow(state, 4999, 12);
    samplePostRevealLinkWindow(state, 5000, 30);
    expect(postRevealLinksSnapshot(state)).toMatchObject({
      windowMs: 5000,
      programsGained: 2,
      closed: true,
    });
  });

  it('keeps the first reveal as the window; a re-arm while open counts on both arms', () => {
    const state = createPostRevealLinkWindow();
    armPostRevealLinkWindow(state, 1000, 100);
    samplePostRevealLinkWindow(state, 2000, 130);
    // A blocking arrival re-arms the same renderer boundary 10 s later.
    armPostRevealLinkWindow(state, 11_000, 400);
    samplePostRevealLinkWindow(state, 12_000, 410);

    expect(postRevealLinksSnapshot(state)).toMatchObject({
      reveals: 2,
      revealsInWindow: 2,
      programsAtReveal: 100,
      programsGained: 310,
      closed: false,
    });
  });

  it('counts a re-arm after the close on the page arm only', () => {
    const state = createPostRevealLinkWindow();
    armPostRevealLinkWindow(state, 0, 10);
    samplePostRevealLinkWindow(state, POST_REVEAL_LINK_WINDOW_MS, 12);
    armPostRevealLinkWindow(state, 60_000, 500);
    expect(postRevealLinksSnapshot(state)).toMatchObject({
      reveals: 2,
      revealsInWindow: 1,
      closed: true,
    });
  });

  it('absorbs a parked-program eviction as zero growth, not a negative number', () => {
    const state = createPostRevealLinkWindow();
    armPostRevealLinkWindow(state, 0, 100);
    samplePostRevealLinkWindow(state, 10, 100 - POST_REVEAL_BASELINE_EPSILON);
    expect(postRevealLinksSnapshot(state)).toMatchObject({
      programsGained: 0,
      closed: false,
      baselineLost: false,
      samples: 1,
    });
  });

  it('closes on a lost baseline instead of publishing a confident zero', () => {
    // A graphics rebuild inside the window swaps the GL context: the new
    // program list starts near empty, and a delta against the old baseline
    // would read as "nothing linked".
    const state = createPostRevealLinkWindow();
    armPostRevealLinkWindow(state, 0, 1200);
    samplePostRevealLinkWindow(state, 500, 1230);
    samplePostRevealLinkWindow(state, 3000, 40);
    samplePostRevealLinkWindow(state, 4000, 900);
    expect(postRevealLinksSnapshot(state)).toMatchObject({
      programsGained: 30,
      samples: 1,
      closed: true,
      baselineLost: true,
    });
  });

  it('accumulates the wall time no frame covered, including the tail at the close', () => {
    const state = createPostRevealLinkWindow();
    armPostRevealLinkWindow(state, 0, 10);
    samplePostRevealLinkWindow(state, 16, 10);
    samplePostRevealLinkWindow(state, 16 + POST_REVEAL_FRAME_STOP_MS - 1, 10);
    // Tab hidden for 8 s inside the window.
    samplePostRevealLinkWindow(state, 9015, 10);
    samplePostRevealLinkWindow(state, 9031, 12);
    // A 5969 ms stall, then frames stop 5 s before the window ends; the next
    // frame closes it and the tail counts too.
    samplePostRevealLinkWindow(state, 15_000, 14);
    samplePostRevealLinkWindow(state, 40_000, 90);
    expect(postRevealLinksSnapshot(state)).toMatchObject({
      programsGained: 4,
      unsampledMs: 8000 + 5969 + 5000,
      closed: true,
    });
  });

  it('resets to the unarmed state', () => {
    const state = createPostRevealLinkWindow();
    armPostRevealLinkWindow(state, 0, 100);
    samplePostRevealLinkWindow(state, 10, 120);
    resetPostRevealLinkWindow(state);
    expect(postRevealLinksSnapshot(state)).toBeNull();
    armPostRevealLinkWindow(state, 50, 7);
    expect(postRevealLinksSnapshot(state)).toMatchObject({
      reveals: 1,
      revealsInWindow: 1,
      programsAtReveal: 7,
      programsGained: 0,
      samples: 0,
      unsampledMs: 0,
    });
  });

  it('costs nothing on a closed window: the sample path returns before touching the count', () => {
    const state = createPostRevealLinkWindow();
    armPostRevealLinkWindow(state, 0, 1);
    samplePostRevealLinkWindow(state, POST_REVEAL_LINK_WINDOW_MS, 99);
    const before = { ...state };
    samplePostRevealLinkWindow(state, POST_REVEAL_LINK_WINDOW_MS + 1, 5000);
    expect(state).toEqual(before);
  });
});
