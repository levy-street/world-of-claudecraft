import type { ArticleTools } from './entity_format';
import { addItemArticles } from './item_articles';
import type { DropSource } from './loot_table';
import { addMobArticles } from './mob_articles';
import { addQuestArticles } from './quest_articles';

export { questZoneName } from './quest_articles';

export function addEntityArticles(w: ArticleTools) {
  const itemSources = new Map<string, Set<string>>();
  addQuestArticles(w, itemSources);
  const itemDrops = new Map<string, DropSource[]>();
  addMobArticles(w, itemSources, itemDrops);
  addItemArticles(w, itemSources, itemDrops);
}
