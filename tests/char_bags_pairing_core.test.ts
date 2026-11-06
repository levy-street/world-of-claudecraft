// The touch pairing that makes the bags -> paperdoll drag possible on a phone: with a
// window full-screen there, the bags would sit ON TOP of the character sheet and the
// drag would have no socket to land on, so the two dock 50/50 instead. The bank and
// vendor clusters already own the bags companion, so the pairing stands down there.

import { describe, expect, it } from 'vitest';
import {
  type CharBagsPairingState,
  charBagsDocked,
  charBagsPaired,
  charToggleBagsAction,
} from '../src/ui/char_bags_pairing_core';

const OPEN: CharBagsPairingState = {
  touch: true,
  charOpen: true,
  bagsShown: true,
  bankOpen: false,
  vendorOpen: false,
  marketOpen: false,
};

describe('charBagsPaired', () => {
  it('pairs when both windows are open on the touch HUD', () => {
    expect(charBagsPaired(OPEN)).toBe(true);
  });

  it('never pairs 50/50 on desktop (it docks instead, below)', () => {
    expect(charBagsPaired({ ...OPEN, touch: false })).toBe(false);
  });

  it('needs BOTH windows: one alone keeps the full screen', () => {
    expect(charBagsPaired({ ...OPEN, charOpen: false })).toBe(false);
    expect(charBagsPaired({ ...OPEN, bagsShown: false })).toBe(false);
  });

  it('stands down for the bank, vendor, and market clusters, which own the bags companion', () => {
    expect(charBagsPaired({ ...OPEN, bankOpen: true })).toBe(false);
    expect(charBagsPaired({ ...OPEN, vendorOpen: true })).toBe(false);
    expect(charBagsPaired({ ...OPEN, marketOpen: true })).toBe(false);
  });
});

// Desktop C (menu consolidation step 3): the sheet opens with the bags docked
// beside it, and closing the sheet takes docked bags with it; B alone and the
// touch HUD are untouched.
describe('charBagsDocked and charToggleBagsAction (desktop)', () => {
  const DESK: CharBagsPairingState = { ...OPEN, touch: false };

  it('docks on desktop only, with both windows up and no other cluster', () => {
    expect(charBagsDocked(DESK)).toBe(true);
    expect(charBagsDocked({ ...DESK, touch: true })).toBe(false);
    expect(charBagsDocked({ ...DESK, bagsShown: false })).toBe(false);
    expect(charBagsDocked({ ...DESK, bankOpen: true })).toBe(false);
    expect(charBagsDocked({ ...DESK, marketOpen: true })).toBe(false);
  });

  it('opens the bags when C opens the sheet without them', () => {
    expect(charToggleBagsAction({ ...DESK, bagsShown: false }, false)).toBe('open');
    expect(charToggleBagsAction(DESK, false)).toBeNull();
  });

  it('closes the bags with the sheet only when they were docked beside it', () => {
    expect(charToggleBagsAction({ ...DESK, charOpen: false }, true)).toBe('close');
    expect(charToggleBagsAction({ ...DESK, charOpen: false }, false)).toBeNull();
  });

  it('never moves the bags on touch or while another cluster owns them', () => {
    expect(charToggleBagsAction({ ...OPEN, bagsShown: false }, false)).toBeNull();
    expect(charToggleBagsAction({ ...DESK, bagsShown: false, vendorOpen: true }, false)).toBeNull();
  });
});
