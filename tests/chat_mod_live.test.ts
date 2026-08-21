import { describe, expect, it } from 'vitest';
import { ChatModerationLiveState } from '../server/chat_mod_live';

const UNMUTED = { mutedUntil: null, reason: '', strikes: 0 };
const MUTE = { mutedUntil: '2099-01-01T00:00:00.000Z', reason: 'spam' };

describe('ChatModerationLiveState', () => {
  it('trusts the fresh snapshot when nothing lands during the hydration window', () => {
    const state = new ChatModerationLiveState();
    const hydration = state.beginHydration(1);
    const fresh = { mutedUntil: null, reason: '', strikes: 2 };
    expect(hydration.resolve(fresh)).toEqual(fresh);
    hydration.release();
  });

  it('prefers a live mute pushed after hydration began over the stale unmuted snapshot', () => {
    const state = new ChatModerationLiveState();
    const hydration = state.beginHydration(1);
    // Simulates an admin /mute committing to the DB and pushing live WHILE
    // this handshake's own (now-stale) DB read is still in flight.
    state.muteChanged(1, MUTE);
    expect(hydration.resolve(UNMUTED)).toEqual({ ...UNMUTED, ...MUTE });
    hydration.release();
  });

  it('prefers a live unmute pushed after hydration began over the stale muted snapshot', () => {
    const state = new ChatModerationLiveState();
    const hydration = state.beginHydration(1);
    // The mirror image: an admin lifts the mute while the stale (still
    // muted) snapshot read is in flight.
    state.muteChanged(1, { mutedUntil: null, reason: '' });
    const staleMuted = { ...MUTE, strikes: 0 };
    expect(hydration.resolve(staleMuted)).toEqual(UNMUTED);
    hydration.release();
  });

  it('trusts the fresh snapshot when the only push happened BEFORE hydration began', () => {
    const state = new ChatModerationLiveState();
    // A push that already landed (and, in production, already committed to
    // the DB the fresh read below models) is old news by the time hydration
    // begins: the fresh read is expected to already reflect it.
    state.muteChanged(1, MUTE);
    const hydration = state.beginHydration(1);
    const fresh = { ...MUTE, strikes: 0 };
    expect(hydration.resolve(fresh)).toEqual(fresh);
    hydration.release();
  });

  it('lets a fresh mute/unmute read win even after a PRIOR hydration cycle pushed one (cross-realm self-heal)', () => {
    // This is the property "keep the later value" (the first-pass fix)
    // broke: an account muted here once must still adopt a genuinely fresh
    // unmuted read on a LATER, separate resume with no concurrent push, the
    // same as if it had been unmuted through a different realm process this
    // one never saw a live push from.
    const state = new ChatModerationLiveState();
    const first = state.beginHydration(1);
    state.muteChanged(1, MUTE);
    expect(first.resolve(UNMUTED)).toEqual({ ...UNMUTED, ...MUTE });
    first.release();

    const second = state.beginHydration(1);
    expect(second.resolve(UNMUTED)).toEqual(UNMUTED);
    second.release();
  });

  it('a strikes-only push does not resurrect a stale mute the fresh read correctly cleared', () => {
    // The failure mode independent fencing exists to prevent: a session's
    // local chatMutedUntil can be stale (e.g. unmuted through a different
    // realm process this one never pushed to). An unrelated strikes reset
    // landing during THIS hydration must not make that stale mute win over
    // the fresh (correctly unmuted) DB read.
    const state = new ChatModerationLiveState();
    const hydration = state.beginHydration(1);
    state.strikesChanged(1, 0);
    const freshUnmuted = { ...UNMUTED, strikes: 5 };
    expect(hydration.resolve(freshUnmuted)).toEqual({ ...freshUnmuted, strikes: 0 });
    hydration.release();
  });

  it('a mute-only push does not resurrect stale strikes the fresh read correctly reset', () => {
    const state = new ChatModerationLiveState();
    const hydration = state.beginHydration(1);
    state.muteChanged(1, MUTE);
    const freshReset = { mutedUntil: null, reason: '', strikes: 0 };
    expect(hydration.resolve(freshReset)).toEqual({ ...freshReset, ...MUTE });
    hydration.release();
  });

  it('keeps every account independent', () => {
    const state = new ChatModerationLiveState();
    const hydrationA = state.beginHydration(1);
    const hydrationB = state.beginHydration(2);
    state.muteChanged(1, MUTE);
    expect(hydrationA.resolve(UNMUTED)).toEqual({ ...UNMUTED, ...MUTE });
    expect(hydrationB.resolve(UNMUTED)).toEqual(UNMUTED);
    hydrationA.release();
    hydrationB.release();
  });

  it('pins an in-progress hydration generation while bounding ordinary push state', () => {
    const state = new ChatModerationLiveState();
    const hydration = state.beginHydration(1);
    state.muteChanged(1, MUTE);
    state.strikesChanged(1, 1);
    const committed = { ...MUTE, strikes: 1 };
    for (let accountId = 2; accountId <= 4_096 + 2; accountId++) {
      state.muteChanged(accountId, { mutedUntil: null, reason: '' });
    }

    expect(state.cachedAccounts).toBe(4_096);
    expect(hydration.resolve(UNMUTED)).toEqual(committed);
    hydration.release();
    state.muteChanged(4_096 + 3, { mutedUntil: null, reason: '' });
    expect(state.cachedAccounts).toBe(4_096);
  });
});
