// World entry's WOC player files: the task assets.ts registers in the DEFERRED preload lane
// (assets/preload.ts), so it starts when the player presses Play and never on the launcher,
// whose previews fetch only what they show. Which file belongs to the set is the pure
// woc_entry_core.ts; the loading model is written down in src/render/CLAUDE.md "Asset
// loading".
//
// The task loads the entry-critical files and nothing else (both fits' base and animation
// library, both head cores): assetsReady() awaits it before the Renderer exists, and a
// critical file that cannot be fetched fails the entry like any other critical asset, loudly,
// instead of leaving every player of that body invisible. The rest of the crowd set (every
// hairstyle and facial hair file, the armor sets, the under-armor atlases) is not entry's to
// fetch: it is prefetched as background work after the first painted frame
// (woc_crowd_prefetch.ts), and a body that meets a file before it lands draws its stand-in.
import { wocEntryBodyUrls, wocEntryHeadCoreUrls } from './woc_entry_core';
import { loadWocHeadFile } from './woc_head_packs';

/**
 * Load the entry-critical WOC files. `loadBody` loads one character GLB into the character
 * store (assets.ts), settling with its fetch. Resolves once every entry-critical file is
 * resident; rejects when one failed.
 */
export function loadWocEntryFiles(loadBody: (url: string) => Promise<void>): Promise<void> {
  const critical = [
    ...wocEntryBodyUrls().map(loadBody),
    ...wocEntryHeadCoreUrls().map(loadWocHeadFile),
  ];
  return Promise.all(critical).then(() => undefined);
}
