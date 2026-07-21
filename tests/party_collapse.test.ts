// The mobile party-collapse pure core: the default-collapsed persistence + the
// (in-party, mobile, collapsed) -> render-decision resolver. DOM-free, deterministic,
// driven over a tiny fake Storage (no jsdom), mirroring the haptics-toggle tests.

import { describe, expect, it } from 'vitest';
import {
  loadPartyCollapsed,
  PARTY_COLLAPSE_STORE_KEY,
  partyChipState,
  savePartyCollapsed,
} from '../src/ui/party_collapse';

// A minimal in-memory Storage stand-in (getItem/setItem), plus a throwing variant to
// prove the try/catch defaults hold when storage is unavailable.
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    _map: map,
  };
}
const throwingStorage = {
  getItem: () => {
    throw new Error('unavailable');
  },
  setItem: () => {
    throw new Error('unavailable');
  },
};

describe('party collapse persistence (default collapsed)', () => {
  it('pins the exact localStorage key (a rename would silently drop every stored choice)', () => {
    // A literal pin, not just the imported constant: renaming PARTY_COLLAPSE_STORE_KEY
    // keeps the rest of this suite green (it uses the import) while orphaning every
    // player's persisted collapse preference. Pin the on-disk string.
    expect(PARTY_COLLAPSE_STORE_KEY).toBe('woc_party_collapsed');
  });

  it('defaults to collapsed when the key is unset (never toggled)', () => {
    expect(loadPartyCollapsed(fakeStorage())).toBe(true);
  });

  it('defaults to collapsed when storage is null (SSR / no localStorage)', () => {
    expect(loadPartyCollapsed(null)).toBe(true);
  });

  it('defaults to collapsed when a read throws (storage disabled)', () => {
    expect(loadPartyCollapsed(throwingStorage)).toBe(true);
  });

  it("reads expanded ONLY on the exact stored '0'", () => {
    expect(loadPartyCollapsed(fakeStorage({ [PARTY_COLLAPSE_STORE_KEY]: '0' }))).toBe(false);
    // Anything else (including a stray value) stays collapsed, so a corrupt value fails safe.
    expect(loadPartyCollapsed(fakeStorage({ [PARTY_COLLAPSE_STORE_KEY]: '1' }))).toBe(true);
    expect(loadPartyCollapsed(fakeStorage({ [PARTY_COLLAPSE_STORE_KEY]: 'yes' }))).toBe(true);
  });

  it('round-trips: save(collapsed) then load reads it back under the shared key', () => {
    const store = fakeStorage();
    savePartyCollapsed(false, store);
    expect(store._map.get(PARTY_COLLAPSE_STORE_KEY)).toBe('0');
    expect(loadPartyCollapsed(store)).toBe(false);
    savePartyCollapsed(true, store);
    expect(store._map.get(PARTY_COLLAPSE_STORE_KEY)).toBe('1');
    expect(loadPartyCollapsed(store)).toBe(true);
  });

  it('save no-ops (no throw) when storage is unavailable', () => {
    expect(() => savePartyCollapsed(false, null)).not.toThrow();
    expect(() => savePartyCollapsed(true, throwingStorage)).not.toThrow();
  });
});

describe('party chip state resolver', () => {
  it('shows no chip and keeps the desktop stack expanded off mobile (frames unchanged)', () => {
    // Desktop, in a party: no chip; the frames are always shown (desktop is untouched),
    // regardless of the collapsed flag. A desktop has no mobile chat overlay, so chatOpen
    // never yields there either.
    expect(
      partyChipState({ inParty: true, mobile: false, collapsed: true, chatOpen: false }),
    ).toEqual({ chipVisible: false, framesExpanded: true });
    expect(
      partyChipState({ inParty: true, mobile: false, collapsed: false, chatOpen: false }),
    ).toEqual({ chipVisible: false, framesExpanded: true });
    // Even if a chatOpen flag were passed on desktop, the desktop stack stays shown.
    expect(
      partyChipState({ inParty: true, mobile: false, collapsed: false, chatOpen: true }),
    ).toEqual({ chipVisible: false, framesExpanded: true });
  });

  it('shows no chip and nothing to expand when not in a party', () => {
    expect(
      partyChipState({ inParty: false, mobile: true, collapsed: true, chatOpen: false }),
    ).toEqual({ chipVisible: false, framesExpanded: false });
    expect(
      partyChipState({ inParty: false, mobile: true, collapsed: false, chatOpen: false }),
    ).toEqual({ chipVisible: false, framesExpanded: false });
  });

  it('shows the chip collapsed by default in a party on mobile', () => {
    expect(
      partyChipState({ inParty: true, mobile: true, collapsed: true, chatOpen: false }),
    ).toEqual({ chipVisible: true, framesExpanded: false });
  });

  it('expands the frames under the chip when the player has opted out of collapse', () => {
    expect(
      partyChipState({ inParty: true, mobile: true, collapsed: false, chatOpen: false }),
    ).toEqual({ chipVisible: true, framesExpanded: true });
  });
});

describe('party chip yields to mobile chat (transient, never overwrites the pref)', () => {
  it('yields the whole party UI (no chip, no frames) while chat is open on mobile', () => {
    // Whatever the persisted collapse choice, chat open on mobile hides the chip AND the
    // frames so the chat overlay owns the top-left.
    expect(
      partyChipState({ inParty: true, mobile: true, collapsed: false, chatOpen: true }),
    ).toEqual({ chipVisible: false, framesExpanded: false });
    expect(
      partyChipState({ inParty: true, mobile: true, collapsed: true, chatOpen: true }),
    ).toEqual({ chipVisible: false, framesExpanded: false });
  });

  it('restores the player choice on chat close: the resolver is a PURE function of the same collapsed input', () => {
    // The yield is transient: the resolver never mutates `collapsed`. Re-running it with
    // the SAME collapsed value and chatOpen back to false reproduces the pre-chat state,
    // which is exactly what restores the player's expanded/collapsed choice when chat
    // closes (the caller never wrote the persisted flag during the yield).
    const expandedPref = { inParty: true, mobile: true, collapsed: false } as const;
    expect(partyChipState({ ...expandedPref, chatOpen: true })).toEqual({
      chipVisible: false,
      framesExpanded: false,
    });
    expect(partyChipState({ ...expandedPref, chatOpen: false })).toEqual({
      chipVisible: true,
      framesExpanded: true,
    });
    const collapsedPref = { inParty: true, mobile: true, collapsed: true } as const;
    expect(partyChipState({ ...collapsedPref, chatOpen: false })).toEqual({
      chipVisible: true,
      framesExpanded: false,
    });
  });
});
