import { FACTION_HUB_LANDINGS } from '../sim/content/faction_vendors';
import { formatNumber, t } from './i18n';

/** Rebuild the faction utility item's stable English notices for the active locale. */
export function localizeHearthstoneText(text: string): string | null {
  if (
    text ===
    'Your Allied Hearthstone is not attuned. Speak with an allied quartermaster or use it in an allied hub.'
  ) {
    return t('hudChrome.factionRewards.hearthstoneUnattuned');
  }
  const cooldown = /^That item is not ready yet \((\d+) min remaining\)\.$/.exec(text);
  if (cooldown) {
    return t('hudChrome.factionRewards.itemCooldown', {
      minutes: formatNumber(Number(cooldown[1]), { maximumFractionDigits: 0 }),
    });
  }
  const binding = /^Your Allied Hearthstone is now attuned to (.+)\.$/.exec(text);
  const transport = /^The hearthstone transports you to (.+)\.$/.exec(text);
  const match = binding ?? transport;
  if (!match) return null;
  const hub = Object.entries(FACTION_HUB_LANDINGS).find(([, landing]) => landing.name === match[1]);
  if (!hub) return null;
  const faction = hub[0] as keyof typeof FACTION_HUB_LANDINGS;
  return t(
    binding
      ? 'hudChrome.factionRewards.hearthstoneBound'
      : 'hudChrome.factionRewards.hearthstoneTransport',
    { hub: t(`hudChrome.factionRewards.hub_${faction}`) },
  );
}
