// Tests for the Hodric's Castle Gauntlet window pure core
// (hodrics_window_view.ts): the offline-vs-live discriminator, the action
// state machine (idle/queued/in-match), practice-affordance gating, and the
// render-skip signature.
//
// DOM-free / i18n-free, so this Node suite drives the core directly; the DOM
// painter (hodrics_window.ts) is covered by its own WCAG-markup patterns
// mirroring arena_window.ts.

import { describe, expect, it } from 'vitest';
import { buildHcWindowView } from '../src/ui/hodrics_window_view';
import type { HcInfo } from '../src/world_api';

const MATCH_ACTIVE: HcInfo['match'] = {
  state: 'active',
  countdown: 0,
  clock: 12,
  timeLeft: 228,
  section: 'log_court',
  checkpoint: 1,
  finished: false,
  place: null,
  falls: 0,
  racers: [],
};

describe('buildHcWindowView', () => {
  it('is offline when info is null (the online-not-yet-synced shape)', () => {
    expect(buildHcWindowView({ info: null, practiceAvailable: false })).toEqual({
      kind: 'offline',
    });
  });

  it('is idle with no standing when nobody has ever raced', () => {
    const view = buildHcWindowView({
      info: { queued: null, standing: null, match: null },
      practiceAvailable: false,
    });
    expect(view.kind).toBe('live');
    if (view.kind !== 'live') return;
    expect(view.standing).toBeNull();
    expect(view.action).toEqual({ kind: 'idle' });
    expect(view.practice).toBe(false);
  });

  it('reflects a queued position', () => {
    const view = buildHcWindowView({
      info: { queued: { position: 4 }, standing: null, match: null },
      practiceAvailable: true,
    });
    expect(view.kind).toBe('live');
    if (view.kind !== 'live') return;
    expect(view.action).toEqual({ kind: 'queued', position: 4 });
    // Practice is only offered while genuinely idle, never mid-queue.
    expect(view.practice).toBe(false);
  });

  it('reflects an in-progress match regardless of queued state', () => {
    const view = buildHcWindowView({
      info: { queued: null, standing: null, match: MATCH_ACTIVE },
      practiceAvailable: true,
    });
    expect(view.kind).toBe('live');
    if (view.kind !== 'live') return;
    expect(view.action).toEqual({ kind: 'in-match' });
    expect(view.practice).toBe(false);
  });

  it('treats a finished ("over") match as no longer in-match', () => {
    const view = buildHcWindowView({
      info: { queued: null, standing: null, match: { ...MATCH_ACTIVE, state: 'over' } },
      practiceAvailable: true,
    });
    expect(view.kind).toBe('live');
    if (view.kind !== 'live') return;
    expect(view.action).toEqual({ kind: 'idle' });
    expect(view.practice).toBe(true);
  });

  it('offers practice only when idle AND the offline hook is wired', () => {
    const idleNoHook = buildHcWindowView({
      info: { queued: null, standing: null, match: null },
      practiceAvailable: false,
    });
    expect(idleNoHook.kind === 'live' && idleNoHook.practice).toBe(false);
    const idleWithHook = buildHcWindowView({
      info: { queued: null, standing: null, match: null },
      practiceAvailable: true,
    });
    expect(idleWithHook.kind === 'live' && idleWithHook.practice).toBe(true);
  });

  it('carries the standing through unchanged', () => {
    const standing = { races: 7, wins: 2, best: 41.3 };
    const view = buildHcWindowView({
      info: { queued: null, standing, match: null },
      practiceAvailable: false,
    });
    expect(view.kind === 'live' && view.standing).toEqual(standing);
  });

  it('the render-skip signature changes when the action changes and is stable otherwise', () => {
    const idle = buildHcWindowView({
      info: { queued: null, standing: null, match: null },
      practiceAvailable: false,
    });
    const idleAgain = buildHcWindowView({
      info: { queued: null, standing: null, match: null },
      practiceAvailable: false,
    });
    const queued = buildHcWindowView({
      info: { queued: { position: 1 }, standing: null, match: null },
      practiceAvailable: false,
    });
    expect(idle.kind === 'live' && idleAgain.kind === 'live' && idle.sig === idleAgain.sig).toBe(
      true,
    );
    expect(idle.kind === 'live' && queued.kind === 'live' && idle.sig !== queued.sig).toBe(true);
  });
});
