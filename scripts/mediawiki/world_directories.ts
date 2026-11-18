import { ZONES } from '../../src/sim/data';
import type { ArticleTools } from './entity_format';
import { addHubDirectories, type SeedPage } from './hub_directories';
import { addMountRoutes } from './mount_routes';
import { zoneArticle } from './zone_article';

export type WorldDirectoryWriter = ArticleTools & {
  reserve(title: string): string;
  usedTitles: Set<string>;
  raidParents: Map<string, string>;
  zoneDirectories: Map<string, string>;
  pages: SeedPage[];
};

/**
 * The world pass build_seed runs once the catalogs, systems and dungeons exist: the
 * Vendors and enemies-by-zone directories (linked from the NPCs and Enemies hubs), every
 * zone article, and the "How to get" routes on the mount pages.
 */
export function addWorldDirectories(w: WorldDirectoryWriter): void {
  const enemyIndex = addHubDirectories(w, w.pages);
  for (const zone of ZONES)
    w.add(w.titleBy.zone.get(zone.id)!, zoneArticle(zone, { ...w, enemyIndex }), [
      'Zones',
      zone.biome,
    ]);
  addMountRoutes(w, w.pages);
}
