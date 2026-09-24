// The faction quartermaster refusal (src/sim/items.ts): the sim emits
// `You need <n> <factionCurrencyName> to purchase that.` in English, and the sim
// matcher re-localizes it, currency name included, through the HUD's own
// currency labels. Pins every faction's currency against the real
// factionCurrencyName, in English and in a non-Latin locale.
import { afterEach, describe, expect, it } from 'vitest';
import { factionCurrencyName } from '../src/sim/factions';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

const FACTIONS = [
  ['rift_watch', 'hudChrome.currencies.riftWatchMark'],
  ['church_order', 'hudChrome.currencies.churchOrderCrest'],
  ['automatons', 'hudChrome.currencies.automatonCog'],
] as const;

afterEach(() => setLanguage('en'));

describe('the faction quartermaster refusal', () => {
  it('reads back unchanged in English for every faction currency', () => {
    setLanguage('en');
    for (const [faction] of FACTIONS) {
      const text = `You need 60 ${factionCurrencyName(faction)} to purchase that.`;
      expect(localizeSimText(text), faction).toBe(text);
    }
  });

  it('localizes the sentence and the currency name in a non-Latin locale', async () => {
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    for (const [faction, labelKey] of FACTIONS) {
      const out = localizeSimText(`You need 60 ${factionCurrencyName(faction)} to purchase that.`);
      expect(out, faction).toBe(
        t('sim.factionVendor.currencyRequired', { amount: '60', currency: t(labelKey) }),
      );
      expect(out, faction).not.toContain(factionCurrencyName(faction));
      expect(out, faction).toContain('60');
    }
  });
});
