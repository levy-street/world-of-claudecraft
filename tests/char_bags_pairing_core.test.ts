// The touch pairing that makes the bags -> paperdoll drag possible on a phone: with a
// window full-screen there, the bags would sit ON TOP of the character sheet and the
// drag would have no socket to land on, so the two dock 50/50 instead. The bank and
// vendor clusters already own the bags companion, so the pairing stands down there.

import { describe, expect, it } from 'vitest';
import { type CharBagsPairingState, charBagsPaired } from '../src/ui/char_bags_pairing_core';

const OPEN: CharBagsPairingState = {
  touch: true,
  charOpen: true,
  bagsShown: true,
  bankOpen: false,
  vendorOpen: false,
};

describe('charBagsPaired', () => {
  it('pairs when both windows are open on the touch HUD', () => {
    expect(charBagsPaired(OPEN)).toBe(true);
  });

  it('never pairs on desktop (free-floating windows already show both)', () => {
    expect(charBagsPaired({ ...OPEN, touch: false })).toBe(false);
  });

  it('needs BOTH windows: one alone keeps the full screen', () => {
    expect(charBagsPaired({ ...OPEN, charOpen: false })).toBe(false);
    expect(charBagsPaired({ ...OPEN, bagsShown: false })).toBe(false);
  });

  it('stands down for the bank and vendor clusters, which own the bags companion', () => {
    expect(charBagsPaired({ ...OPEN, bankOpen: true })).toBe(false);
    expect(charBagsPaired({ ...OPEN, vendorOpen: true })).toBe(false);
  });
});
