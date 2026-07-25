// Direct unit tests for the away-state helper (src/sim/social/away.ts): the
// single source of truth that keeps the entity display mirror (Entity.afk) in
// lockstep with the authoritative PlayerMeta.away. Exercised through a minimal
// fake SimContext (no full Sim), mirroring the extracted-chat-module tests.
import { describe, expect, it } from 'vitest';
import { clearAfkOnMove, setAwayState } from '../src/sim/social/away';
import type { SimEvent } from '../src/sim/types';

function fakes() {
  const events: SimEvent[] = [];
  const ctx = { emit: (e: SimEvent) => events.push(e) } as any;
  const e = { afk: false } as any;
  const meta = { entityId: 7, away: null } as any;
  return { events, ctx, e, meta };
}

describe('setAwayState', () => {
  it('afk mode lights the entity display mirror', () => {
    const { e, meta } = fakes();
    setAwayState(e, meta, { mode: 'afk', message: 'brb' });
    expect(meta.away).toEqual({ mode: 'afk', message: 'brb' });
    expect(e.afk).toBe(true);
  });

  it('dnd mode sets away but leaves the public afk mirror off', () => {
    const { e, meta } = fakes();
    setAwayState(e, meta, { mode: 'dnd', message: 'raiding' });
    expect(meta.away?.mode).toBe('dnd');
    expect(e.afk).toBe(false);
  });

  it('null clears both', () => {
    const { e, meta } = fakes();
    setAwayState(e, meta, { mode: 'afk', message: 'brb' });
    setAwayState(e, meta, null);
    expect(meta.away).toBe(null);
    expect(e.afk).toBe(false);
  });
});

describe('clearAfkOnMove', () => {
  it('clears an AFK player and emits the notice', () => {
    const { events, ctx, e, meta } = fakes();
    setAwayState(e, meta, { mode: 'afk', message: 'brb' });
    clearAfkOnMove(ctx, meta, e);
    expect(meta.away).toBe(null);
    expect(e.afk).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'log',
      text: 'You are no longer Away From Keyboard.',
      pid: 7,
    });
  });

  it('leaves Do Not Disturb in place (movement does not clear it)', () => {
    const { events, ctx, e, meta } = fakes();
    setAwayState(e, meta, { mode: 'dnd', message: 'raiding' });
    clearAfkOnMove(ctx, meta, e);
    expect(meta.away?.mode).toBe('dnd');
    expect(events).toHaveLength(0);
  });

  it('is a no-op when the player is not away', () => {
    const { events, ctx, e, meta } = fakes();
    clearAfkOnMove(ctx, meta, e);
    expect(meta.away).toBe(null);
    expect(events).toHaveLength(0);
  });
});
