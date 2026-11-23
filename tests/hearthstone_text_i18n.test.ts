import { afterEach, describe, expect, it } from 'vitest';
import { FACTION_HUB_LANDINGS } from '../src/sim/content/faction_vendors';
import { localizeHearthstoneText } from '../src/ui/hearthstone_text_i18n';
import {
  ensureLocaleLoaded,
  formatNumber,
  setLanguage,
  supportedLanguages,
  t,
} from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

const UNATTUNED =
  'Your Allied Hearthstone is not attuned. Speak with an allied quartermaster or use it in an allied hub.';

afterEach(() => setLanguage('en'));

describe('Allied Hearthstone player-text localization', () => {
  it('rebuilds every utility-item output in every non-English locale', async () => {
    for (const lang of supportedLanguages) {
      if (lang === 'en' || lang === 'en_CA') continue;
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      expect(localizeSimText(UNATTUNED), lang).toBe(
        t('hudChrome.factionRewards.hearthstoneUnattuned'),
      );
      expect(localizeSimText(UNATTUNED), lang).not.toBe(UNATTUNED);
      for (const [faction, hub] of Object.entries(FACTION_HUB_LANDINGS)) {
        const label = t(
          `hudChrome.factionRewards.hub_${faction as keyof typeof FACTION_HUB_LANDINGS}`,
        );
        const bound = `Your Allied Hearthstone is now attuned to ${hub.name}.`;
        const transport = `The hearthstone transports you to ${hub.name}.`;
        expect(localizeSimText(bound), lang).toBe(
          t('hudChrome.factionRewards.hearthstoneBound', { hub: label }),
        );
        expect(localizeSimText(bound), lang).not.toBe(bound);
        expect(localizeSimText(transport), lang).toBe(
          t('hudChrome.factionRewards.hearthstoneTransport', { hub: label }),
        );
        expect(localizeSimText(transport), lang).not.toBe(transport);
      }
      const cooldown = 'That item is not ready yet (1234 min remaining).';
      expect(localizeSimText(cooldown), lang).toBe(
        t('hudChrome.factionRewards.itemCooldown', {
          minutes: formatNumber(1234, { maximumFractionDigits: 0 }),
        }),
      );
      expect(localizeSimText(cooldown), lang).not.toBe(cooldown);
    }
  });

  it('does not claim unknown destinations or malformed item cooldowns', () => {
    expect(
      localizeHearthstoneText('Your Allied Hearthstone is now attuned to Somewhere.'),
    ).toBeNull();
    expect(localizeHearthstoneText('The hearthstone transports you to Somewhere.')).toBeNull();
    expect(localizeHearthstoneText('That item is not ready yet (soon min remaining).')).toBeNull();
  });
});
