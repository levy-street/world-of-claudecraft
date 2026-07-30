import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { EquipSlot } from '../src/sim/types';
import {
  buildPaperdollView,
  PAPERDOLL_LEFT_SLOTS,
  PAPERDOLL_RIGHT_SLOTS,
} from '../src/ui/char_view';
import {
  buildInspectRemoteView,
  buildInspectView,
  classColorCss,
  type InspectInput,
} from '../src/ui/inspect_view';

// Base inputs for a fully-decked mage with no identity flair; each test overrides
// the one dimension it exercises so every gate has a decisive negative case.
const base: InspectInput = {
  name: 'Elowen',
  level: 45,
  cls: 'mage',
  skin: 2,
  skinCatalog: 'class',
  deedTitleText: '',
  equippedItems: {
    helmet: 'monarch_crown_helm',
    chest: 'gravewoven_raiment',
    mainhand: 'worn_sword',
  },
  holderTier: 0,
  holderBalance: null,
  discordTier: 0,
  discordName: null,
  discordAvatar: null,
  discordJoined: null,
  discordRole: null,
  devTier: 0,
  devMergedPrs: null,
  githubLogin: null,
  showDevBadges: true,
  now: 1_000 * 86_400_000, // a fixed "now" in whole days
};

describe('classColorCss', () => {
  it('mirrors hud.ts classCss: the mage class color as a #rrggbb string', () => {
    // Pinned literals (CLASSES[mage].color === 0x33c1f1, warrior === 0xd67a54), the
    // exact hue the inspect stage border / glow / haze take.
    expect(classColorCss('mage')).toBe('#33c1f1');
    expect(classColorCss('warrior')).toBe('#d67a54');
  });

  it('falls back to the shared blue for an unknown class id', () => {
    expect(classColorCss('not_a_class')).toBe('#5fa8ff');
  });
});

describe('buildInspectView: header', () => {
  it('carries name, level, class, and the class color', () => {
    const m = buildInspectView(base, ITEMS);
    expect(m.header).toMatchObject({
      name: 'Elowen',
      level: 45,
      cls: 'mage',
      classColor: '#33c1f1',
    });
    expect(m.skin).toBe(2);
  });

  it('carries the skin CATALOG through for the turntable, so a mech-cosmetic player keeps their rig', () => {
    // The turntable resolves the visual from (cls, skin, catalog); dropping the
    // catalog would apply a mech-catalog skin INDEX to the class rig (wrong skin).
    expect(buildInspectView(base, ITEMS).skinCatalog).toBe('class');
    expect(buildInspectView({ ...base, skinCatalog: 'mech' }, ITEMS).skinCatalog).toBe('mech');
  });

  it('deed title is null when the resolved text is empty, the text when present', () => {
    expect(buildInspectView(base, ITEMS).header.deedTitle).toBeNull();
    expect(
      buildInspectView({ ...base, deedTitleText: 'the Brightwood Remembered' }, ITEMS).header
        .deedTitle,
    ).toBe('the Brightwood Remembered');
  });
});

describe('buildInspectView: badge gating', () => {
  it('hides the holder badge at tier 0 and shows it (with balance) above', () => {
    expect(buildInspectView(base, ITEMS).badges.holder).toBeNull();
    const m = buildInspectView({ ...base, holderTier: 3, holderBalance: 4200 }, ITEMS);
    expect(m.badges.holder).toEqual({ tierIndex: 3, balance: 4200 });
    // A zero/absent balance collapses to null (painter shows the plain rung label).
    expect(
      buildInspectView({ ...base, holderTier: 3, holderBalance: 0 }, ITEMS).badges.holder,
    ).toEqual({ tierIndex: 3, balance: null });
  });

  it('hides the dev badge at tier 0, and hides it at a real tier when showDevBadges is off', () => {
    expect(buildInspectView({ ...base, devTier: 0 }, ITEMS).badges.dev).toBeNull();
    expect(
      buildInspectView({ ...base, devTier: 2, showDevBadges: false }, ITEMS).badges.dev,
    ).toBeNull();
    expect(
      buildInspectView(
        { ...base, devTier: 2, showDevBadges: true, devMergedPrs: 17, githubLogin: 'elowen' },
        ITEMS,
      ).badges.dev,
    ).toEqual({ tierIndex: 2, mergedPrs: 17, githubLogin: 'elowen' });
  });

  it('hides Discord at tier 0 and computes whole member-days from the injected now', () => {
    expect(buildInspectView(base, ITEMS).badges.discord).toBeNull();
    const joined = base.now - Math.floor(10.7 * 86_400_000); // 10 whole days ago
    const m = buildInspectView(
      { ...base, discordTier: 1, discordName: 'elowen#1', discordJoined: joined },
      ITEMS,
    );
    expect(m.badges.discord).toEqual({
      tierIndex: 1,
      name: 'elowen#1',
      avatar: null,
      memberDays: 10,
      role: null,
    });
  });

  it('member-days is null when the join stamp is absent, never negative for a future stamp', () => {
    expect(
      buildInspectView({ ...base, discordTier: 1, discordJoined: null }, ITEMS).badges.discord
        ?.memberDays,
    ).toBeNull();
    expect(
      buildInspectView(
        { ...base, discordTier: 1, discordJoined: base.now + 5 * 86_400_000 }, // joined "later"
        ITEMS,
      ).badges.discord?.memberDays,
    ).toBe(0);
  });
});

describe('buildInspectView: gear reuses the char_view paperdoll (no forked slot list)', () => {
  it('maps worn gear (and empty slots) exactly like buildPaperdollView', () => {
    const m = buildInspectView(base, ITEMS);
    // Identical to the shared core: same arrays, same empty-slot resolution.
    expect(m.gear).toEqual(buildPaperdollView(base.equippedItems, ITEMS));
    // And the column order IS char_view's 6/6 split (offhand in the left column).
    expect(m.gear.left.map((c) => c.slot)).toEqual([...PAPERDOLL_LEFT_SLOTS]);
    expect(m.gear.right.map((c) => c.slot)).toEqual([...PAPERDOLL_RIGHT_SLOTS]);
    expect(m.gear.left.map((c) => c.slot)).toContain('offhand');
    // Filled vs empty resolution.
    expect(m.gear.left[0].item).toBe(ITEMS.monarch_crown_helm);
    const emptySlots = m.gear.right.filter(
      (c: { slot: EquipSlot; item: unknown }) => c.item === null,
    );
    expect(emptySlots.length).toBe(m.gear.right.length); // nothing on the right in `base`
  });
});

describe('buildInspectRemoteView: the thin out-of-range card carries no gear', () => {
  it('carries only name, level, class, class color, and guild', () => {
    const m = buildInspectRemoteView({
      name: 'Elowen',
      level: 45,
      cls: 'mage',
      guild: 'Nightwatch',
    });
    expect(m).toEqual({
      name: 'Elowen',
      level: 45,
      cls: 'mage',
      classColor: '#33c1f1',
      guild: 'Nightwatch',
    });
    expect('gear' in m).toBe(false);
    expect('badges' in m).toBe(false);
  });

  it('allows a null guild', () => {
    expect(
      buildInspectRemoteView({ name: 'X', level: 1, cls: 'warrior', guild: null }).guild,
    ).toBeNull();
  });
});
