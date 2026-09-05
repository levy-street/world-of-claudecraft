// displayRealmBuilderName (src/ui/realm_builder_name.ts): the one decision
// about what text a Realm Builder honour shows as. A real name is world data
// and splices verbatim; the shipped placeholder is chrome standing in for a
// name, so it localizes. Both the honour-roll card and the statue's projected
// plate read through this, which is why it is pinned on its own and not only
// through the card.

import { afterEach, describe, expect, it } from 'vitest';
import { REALM_BUILDER_PLACEHOLDER_NAME } from '../src/sim/content/realm_builders';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { displayRealmBuilderName } from '../src/ui/realm_builder_name';

const PLACEHOLDER = { year: 2026, month: 8, name: REALM_BUILDER_PLACEHOLDER_NAME } as const;
const REAL = { year: 2026, month: 9, name: "Ada O'Hare-Vance <the Third>" } as const;

afterEach(() => {
  setLanguage('en');
});

describe('displayRealmBuilderName', () => {
  it('splices a real name verbatim, in every language', async () => {
    expect(displayRealmBuilderName(REAL)).toBe(REAL.name);
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    expect(displayRealmBuilderName(REAL)).toBe(REAL.name);
  });

  it('answers the localized placeholder for the unclaimed plate', async () => {
    // English is the shipped constant itself, so the two agree there...
    expect(displayRealmBuilderName(PLACEHOLDER)).toBe(REALM_BUILDER_PLACEHOLDER_NAME);
    expect(displayRealmBuilderName(PLACEHOLDER)).toBe(t('hudChrome.realmBuilder.placeholderName'));
    // ...and diverge the moment the reader's language does.
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const localized = displayRealmBuilderName(PLACEHOLDER);
    expect(localized).toBe(t('hudChrome.realmBuilder.placeholderName'));
    expect(localized).not.toBe(REALM_BUILDER_PLACEHOLDER_NAME);
  });

  it('is keyed on the name, not the month pair', () => {
    // The placeholder's month pair is inert; only the name decides.
    expect(displayRealmBuilderName({ ...PLACEHOLDER, year: 1999, month: 1 })).toBe(
      t('hudChrome.realmBuilder.placeholderName'),
    );
    expect(displayRealmBuilderName({ ...REAL, year: 1999, month: 1 })).toBe(REAL.name);
  });
});
