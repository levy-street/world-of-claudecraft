import { isDeveloperMount, MOUNTS } from '../../src/sim/content/mounts';
import { ITEMS } from '../../src/sim/data';
import type { ArticleTools } from './entity_format';
import type { SeedPage } from './hub_directories';
import { itemAcquisitionArticle, itemAcquisitionIndex } from './item_acquisition';

/** The reins items that grant each player mount, by mount key. */
export function mountReins(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of Object.values(MOUNTS)) {
    if (isDeveloperMount(m.key)) continue;
    out.set(
      m.key,
      Object.values(ITEMS)
        .filter((i) => i.kind === 'mount' && i.mount === m.key)
        .map((i) => i.id),
    );
  }
  return out;
}

/**
 * Adds "How to get" to every mount page, from its reins item's own sources (the same
 * routes, steps and map the reins page shows). The mount pages are written by the
 * systems pass, before quest and world quest titles exist, so this runs later, once
 * every title the routes link to is known.
 */
export function addMountRoutes(w: ArticleTools, pages: SeedPage[]): number {
  const acquisition = itemAcquisitionIndex(w);
  let done = 0;
  for (const [key, reins] of mountReins()) {
    const name = MOUNTS[key as keyof typeof MOUNTS].name;
    const page = pages.find(
      (p) =>
        p.title === name + ' (Mount)' && p.text.includes('Related guide: [[Mounts and riding]]'),
    );
    if (!page || !reins.length) continue;
    const how = reins
      .map((id) => {
        const item = ITEMS[id];
        const body = itemAcquisitionArticle(w, item, acquisition.get(id) ?? [], []);
        const reinsTitle = w.titleBy.item.get(id);
        const lead =
          'You get this mount by getting ' +
          (reinsTitle ? w.link(reinsTitle, item.name) : item.name) +
          ' and using them from your bags.\n\n';
        return body.replace(/^== How to get ==\n/, '== How to get ==\n' + lead);
      })
      .join('');
    const marker = 'Related guide: [[Mounts and riding]]';
    page.text = page.text.replace(marker, how.trim() + '\n\n' + marker);
    done++;
  }
  return done;
}
