// Studio's "Publish to Game", without the Studio: turns a map document under data/maps/
// into the game's copy of it (src/sim/maps/<slug>.generated.ts) through the same
// functions the Studio's button calls, and writes the document back in the repo layout.
// The town records behind a map change whenever the buildings do (new models, new sizes),
// and the published copy has to follow or the game stands the old ones.
//
// The Studio's modules read Vite's import.meta.env, so this runs under Vitest, which
// provides it: a one-line test file that calls publishMap('eastbrook_rebuild'), run once
// with `npx vitest run <that file>` and deleted (the Studio's own button does the same job
// when a dev server and a browser are at hand).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMapForEngine } from '../../../src/editor/export_contract';
import { ensureMapItemIds } from '../../../src/editor/map_item_ids';
import {
  emitPublishedMapModule,
  publishedMapPaths,
  vendorPublishedAssetCollision,
} from '../../../src/editor/map_publish_core';
import { parseMap, serializeMapForRepo } from '../../../src/editor/persist';
import { AUTHORED_TOWN_BUILDINGS } from '../../../src/sim/authored_town_registry';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Publish the map document `slug` into the game copy; answers the files written. */
export function publishMap(slug: string): { module: string; mapJson: string } {
  const paths = publishedMapPaths(slug);
  const map = parseMap(JSON.parse(readFileSync(path.join(root, paths.mapJson), 'utf8')));
  if (!map) throw new Error(`${paths.mapJson} is not a map document`);
  ensureMapItemIds(map);
  const prepared = prepareMapForEngine(map);
  const world = vendorPublishedAssetCollision(prepared.world);
  // A town building's props record comes from the built-in world, which the live-world
  // touch-up may have nudged since (it moved Fenbridge's warden gatehouse); the document
  // stands every building where the town's own layout record does, and the published copy
  // carries no touch-up of its own. So each record is put back on its layout record, or the
  // published world disagrees with itself about where the house is.
  const layout = new Map(AUTHORED_TOWN_BUILDINGS.map((building) => [building.id, building]));
  for (const record of world.props.buildings) {
    const building = record.id === undefined ? undefined : layout.get(record.id);
    if (!building) continue;
    record.x = building.position.x;
    record.z = building.position.z;
    record.rot = building.rotation;
    record.w = building.nativeDimensions.width;
    record.d = building.nativeDimensions.depth;
  }
  writeFileSync(
    path.join(root, paths.module),
    emitPublishedMapModule(
      slug,
      prepared.map.meta.name,
      prepared.map.meta.seed,
      JSON.stringify(world),
    ),
  );
  writeFileSync(path.join(root, paths.mapJson), serializeMapForRepo(prepared.map));
  return { module: paths.module, mapJson: paths.mapJson };
}
