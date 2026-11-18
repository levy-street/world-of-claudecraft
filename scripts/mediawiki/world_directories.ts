import { ZONES } from '../../src/sim/data';
import type { ArticleTools } from './entity_format';
import type { SeedPage } from './hub_directories';
import { addMountRoutes } from './mount_routes';
import { zoneArticle } from './zone_article';

export type WorldDirectoryWriter = ArticleTools & {
  reserve(title: string): string;
  usedTitles: Set<string>;
  raidParents: Map<string, string>;
  zoneDirectories: Map<string, string>;
  /** Zone id to its enemies-by-zone page (written with the Enemies hub). */
  enemyIndex: Map<string, string>;
  pages: SeedPage[];
};

/**
 * The world pass build_seed runs once the catalogs, systems and dungeons exist: every
 * zone article (linking its enemies-by-zone page) and the "How to get" routes on the
 * mount pages. The Vendors and enemies-by-zone directories are written with their hubs.
 */
export function addWorldDirectories(w: WorldDirectoryWriter): void {
  for (const zone of ZONES)
    w.add(w.titleBy.zone.get(zone.id)!, zoneArticle(zone, w), ['Zones', zone.biome]);
  addMountRoutes(w, w.pages);
}
