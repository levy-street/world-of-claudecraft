import { type MapDoc, sanitizePlacement } from '../sim/map_doc';
import type { PlacedAsset } from '../sim/types';
import { placementsToPlayAssets } from './custom_map';

/** Every added model is accounted for by an explicit decision pinned to source bytes. */
export function compileLayoutAdditions(
  map: MapDoc,
  additions: Record<string, string> | undefined,
  used: Set<string>,
  issue: (id: string, reason: string) => void,
): PlacedAsset[] {
  const out: PlacedAsset[] = [];
  for (const [uid, reason] of Object.entries(additions ?? {})) {
    const placement = map.placements.find((p) => p.uid === uid);
    const sanitized = placement && sanitizePlacement(placement);
    if (!placement || !sanitized || used.has(uid) || !reason.trim() || placement.regionRole) {
      issue(
        `addition:${uid}`,
        'Scenery addition needs an unused valid placement and a reason; objective anchors need separate integration.',
      );
      continue;
    }
    const raw = placementsToPlayAssets([placement], map.assetCollisionMesh);
    const validated = placementsToPlayAssets([sanitized], map.assetCollisionMesh);
    if (raw.length !== 1 || JSON.stringify(raw) !== JSON.stringify(validated)) {
      issue(
        `addition:${uid}`,
        'Scenery addition would be lost or changed by projection/validation.',
      );
      continue;
    }
    out.push(raw[0]);
    used.add(uid);
  }
  return out;
}
