import type { BagCategory } from './bag_filter';
import type { TranslationKey } from './i18n';

// The one category-chip label table, shared by the bags and the bank windows so a
// chip reads the same word in both (the bank reuses the bags' generic keys; only its
// own aria labels differ). Data only: no DOM, no host.
export const BAG_CATEGORY_LABEL_KEYS: Record<BagCategory, TranslationKey> = {
  all: 'hudChrome.bags.filterAll',
  weapon: 'hudChrome.bags.filterWeapon',
  armor: 'hudChrome.bags.filterArmor',
  consumable: 'hudChrome.bags.filterConsumable',
  material: 'hudChrome.bags.filterMaterial',
  tool: 'hudChrome.bags.filterTool',
  quest: 'hudChrome.bags.filterQuest',
  favourite: 'hudChrome.bags.filterFavourite',
  junk: 'hudChrome.bags.filterJunk',
  mount: 'hudChrome.bags.filterMount',
};
