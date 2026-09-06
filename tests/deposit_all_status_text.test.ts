// Shared deposit-all summary interpolation (src/ui/deposit_all_status_text.ts):
// the Bank and Materials Vault windows both name an epic-or-better material a
// sweep actually moved via one {item} token, resolved off the SAME def-lookup
// each painter already uses. Pinned here directly (bank_window.ts and
// vault_window.ts pin only that they DELEGATE to this module; the interpolation
// itself, including the None arm's harmless unused-params pass-through, is
// pinned once here rather than duplicated per caller).
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { depositAllNotableParams, depositAllStatusText } from '../src/ui/deposit_all_status_text';

const LASTFLAME = ITEMS.lastflame_core;

describe('depositAllNotableParams', () => {
  it('is count-only when no notable def resolved', () => {
    expect(depositAllNotableParams('3', undefined)).toEqual({ count: '3' });
  });

  it("adds {item} as the def's localized display name when one resolved", () => {
    expect(depositAllNotableParams('6', LASTFLAME)).toEqual({
      count: '6',
      item: 'Core of the Last Flame',
    });
  });
});

describe('depositAllStatusText', () => {
  it('renders a plain Done-shaped key with the count token', () => {
    expect(depositAllStatusText('hudChrome.bank.depositAllDone', '3', undefined)).toBe(
      'Materials deposited: 3.',
    );
  });

  it('renders a Notable-shaped key with both tokens', () => {
    expect(depositAllStatusText('hudChrome.bank.depositAllNotable', '2', LASTFLAME)).toBe(
      'Materials deposited: 2, including Core of the Last Flame.',
    );
    expect(depositAllStatusText('hudChrome.bank.vaultDepositAllNotable', '6', LASTFLAME)).toBe(
      'Materials deposited: 6, including Core of the Last Flame.',
    );
  });

  it('renders the NotableFull-shaped key with both tokens plus the fixed tail', () => {
    expect(depositAllStatusText('hudChrome.bank.depositAllNotableFull', '2', LASTFLAME)).toBe(
      'Materials deposited: 2, including Core of the Last Flame. Bank now full.',
    );
    expect(depositAllStatusText('hudChrome.bank.vaultDepositAllNotableFull', '1', LASTFLAME)).toBe(
      'Materials deposited: 1, including Core of the Last Flame. Some ceilings are full.',
    );
  });

  it('the None arm silently ignores an unused count/item (the template declares neither placeholder)', () => {
    // The whole point of NOT special-casing count===0 in the callers: t()'s
    // interpolation reads only the placeholders a key's OWN template declares
    // (compileInterpolationPlan), so passing count/item to a count-less key is a
    // documented no-op rather than a leaked literal token or a thrown error.
    expect(depositAllStatusText('hudChrome.bank.depositAllNone', '0', undefined)).toBe(
      'Bank full: nothing deposited.',
    );
    expect(depositAllStatusText('hudChrome.bank.depositAllNone', '3', LASTFLAME)).toBe(
      'Bank full: nothing deposited.',
    );
  });
});
