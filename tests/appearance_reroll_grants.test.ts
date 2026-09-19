import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_REROLL_GRANTS,
  type AppearanceRerollGrant,
  appearanceRerollAvailable,
  CURRENT_APPEARANCE_REROLL_GRANT,
  spentAppearanceRerollGrant,
} from '../server/appearance_reroll_grants';

// The grant table is the product rule for the roster's Redesign button, and the
// pure rule here is the JS mirror of the UPDATE's WHERE arm in
// server/appearance_reroll_db.ts (pinned as SQL by tests/character_db.test.ts).
// These pins keep the table well-formed and every arm of the rule decisive.

const LOOK = { gender: 'female' };
const GRANT: AppearanceRerollGrant = {
  id: 2,
  createdBefore: new Date('2026-09-28T00:00:00Z'),
  reason: 'test',
};
const before = new Date(GRANT.createdBefore.getTime() - 60_000).toISOString();
const after = new Date(GRANT.createdBefore.getTime() + 60_000).toISOString();

describe('the grant table', () => {
  it('has dense ascending ids, ascending windows, and the last row live', () => {
    expect(APPEARANCE_REROLL_GRANTS.length).toBeGreaterThanOrEqual(2);
    APPEARANCE_REROLL_GRANTS.forEach((g, i) => {
      // Spent ids are persisted per character, so a renumbered or deleted
      // row would silently re-grant or refuse the wrong population.
      expect(g.id, `grant ${i} id`).toBe(i + 1);
      expect(Number.isFinite(g.createdBefore.getTime()), `grant ${g.id} window`).toBe(true);
      if (i > 0) {
        expect(g.createdBefore.getTime()).toBeGreaterThan(
          APPEARANCE_REROLL_GRANTS[i - 1].createdBefore.getTime(),
        );
      }
      expect(g.reason.length).toBeGreaterThan(0);
    });
    expect(CURRENT_APPEARANCE_REROLL_GRANT).toBe(
      APPEARANCE_REROLL_GRANTS[APPEARANCE_REROLL_GRANTS.length - 1],
    );
  });

  it('keeps the launch grant window exactly as shipped (grant 1 spends are persisted against it)', () => {
    expect(APPEARANCE_REROLL_GRANTS[0].createdBefore.toISOString()).toBe(
      '2026-08-24T00:00:00.000Z',
    );
  });

  it('issues the colorway-preview regrant as grant 2 with a UTC-midnight window', () => {
    const g = APPEARANCE_REROLL_GRANTS[1];
    expect(g.id).toBe(2);
    // UTC midnight, so every client agrees on who is inside the window.
    expect(g.createdBefore.toISOString()).toMatch(/T00:00:00\.000Z$/);
  });
});

describe('spentAppearanceRerollGrant', () => {
  it('reads the recorded column first, then the legacy boolean as grant 1, else 0', () => {
    expect(spentAppearanceRerollGrant({})).toBe(0);
    expect(spentAppearanceRerollGrant({ appearance_reroll_used: false })).toBe(0);
    expect(spentAppearanceRerollGrant({ appearance_reroll_used: true })).toBe(1);
    expect(
      spentAppearanceRerollGrant({ appearance_reroll_used: true, appearance_reroll_grant: null }),
    ).toBe(1);
    expect(
      spentAppearanceRerollGrant({ appearance_reroll_used: true, appearance_reroll_grant: 2 }),
    ).toBe(2);
    // The column wins even when it disagrees with the flag (it is the newer record).
    expect(
      spentAppearanceRerollGrant({ appearance_reroll_used: false, appearance_reroll_grant: 2 }),
    ).toBe(2);
  });
});

describe('appearanceRerollAvailable', () => {
  it('grants every character created inside the window, designed or not', () => {
    expect(appearanceRerollAvailable({ created_at: before, appearance: LOOK }, GRANT)).toBe(true);
    expect(appearanceRerollAvailable({ created_at: before, appearance: null }, GRANT)).toBe(true);
  });

  it('closes the window after the cutoff for a character that already has a look', () => {
    expect(appearanceRerollAvailable({ created_at: after, appearance: LOOK }, GRANT)).toBe(false);
    // An unparseable or missing creation date cannot prove it is inside.
    expect(appearanceRerollAvailable({ created_at: 'garbage', appearance: LOOK }, GRANT)).toBe(
      false,
    );
    expect(appearanceRerollAvailable({ appearance: LOOK }, GRANT)).toBe(false);
  });

  it('still covers a never-designed character created after the cutoff (the safety net)', () => {
    expect(appearanceRerollAvailable({ created_at: after, appearance: null }, GRANT)).toBe(true);
    expect(appearanceRerollAvailable({ created_at: after }, GRANT)).toBe(true);
  });

  it('re-grants a character that spent only the launch token, and refuses one that spent this grant', () => {
    const spentLaunch = { created_at: before, appearance: LOOK, appearance_reroll_used: true };
    expect(appearanceRerollAvailable(spentLaunch, GRANT)).toBe(true);
    // ...but the same row is refused against the launch grant itself.
    expect(appearanceRerollAvailable(spentLaunch, APPEARANCE_REROLL_GRANTS[0])).toBe(false);
    const spentThis = { ...spentLaunch, appearance_reroll_grant: GRANT.id };
    expect(appearanceRerollAvailable(spentThis, GRANT)).toBe(false);
    // The spent ratchet beats the safety net too.
    expect(
      appearanceRerollAvailable(
        { created_at: after, appearance: null, appearance_reroll_grant: 2 },
        GRANT,
      ),
    ).toBe(false);
  });

  it('does not bank an unspent earlier grant: spending the current one spends them all', () => {
    // A pre-launch character that never used grant 1 holds ONE redesign under
    // grant 2, not two: the row records the highest grant spent, so after a
    // grant-2 spend it is refused against grant 1 as well.
    const neverSpent = { created_at: '2026-08-01T00:00:00Z', appearance: LOOK };
    expect(appearanceRerollAvailable(neverSpent, APPEARANCE_REROLL_GRANTS[0])).toBe(true);
    expect(appearanceRerollAvailable(neverSpent, GRANT)).toBe(true);
    const afterSpend = { ...neverSpent, appearance_reroll_used: true, appearance_reroll_grant: 2 };
    expect(appearanceRerollAvailable(afterSpend, GRANT)).toBe(false);
    expect(appearanceRerollAvailable(afterSpend, APPEARANCE_REROLL_GRANTS[0])).toBe(false);
  });

  it('defaults to the current grant', () => {
    const row = {
      created_at: '2000-01-01T00:00:00Z',
      appearance: LOOK,
      appearance_reroll_used: true,
    };
    expect(appearanceRerollAvailable(row)).toBe(
      appearanceRerollAvailable(row, CURRENT_APPEARANCE_REROLL_GRANT),
    );
    expect(appearanceRerollAvailable(row)).toBe(true);
  });
});
