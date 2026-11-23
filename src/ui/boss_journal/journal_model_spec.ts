// The dungeon journal's 3D turntable spec for a boss: the SAME model the world
// draws for that mob (render/characters/manifest.ts mobVisualKey + VISUALS),
// reduced to the standalone guide viewer's fields exactly the way the wiki
// generator bakes them (scripts/wiki/build_content.mjs modelKeyFor). A body the
// standalone viewer cannot build faithfully (a split WOC body, a bodyless click
// capsule) has no spec, so the journal keeps the committed portrait instead of
// showing a borrowed or incomplete model.

import type { GuideModelSpec } from '../../guide/content.generated';
import { mobVisualKey, VISUALS } from '../../render/characters/manifest';
import { MOBS } from '../../sim/data';

export interface JournalModel {
  spec: GuideModelSpec;
  tint: number | null;
}

export function journalModelFor(mobId: string): JournalModel | null {
  const def = VISUALS[mobVisualKey(mobId)];
  if (!def || def.bodyless || def.wocCharacter || def.modular) return null;
  const spec: GuideModelSpec = { url: def.url, idle: def.clips?.idle ?? null, height: def.height };
  if (def.yaw) spec.yaw = def.yaw;
  if (def.hover) spec.hover = def.hover;
  if (def.show) spec.show = [...def.show];
  const attach = (def.attach ?? []).filter((a) => !a.swapOnly);
  if (attach.length > 0) {
    spec.attach = attach.map((a) => ({
      url: a.url,
      bone: a.bone,
      ...(a.position ? { position: a.position } : {}),
      ...(a.rotationY ? { rotationY: a.rotationY } : {}),
      ...(a.gripRef ? { gripRef: a.gripRef } : {}),
      ...(a.size !== undefined && a.size !== 1 ? { size: a.size } : {}),
    }));
  }
  if (def.weaponFix) spec.weaponFix = def.weaponFix.map((fix) => ({ ...fix }));
  let tint: number | null = null;
  if (def.tint !== undefined) {
    spec.tintStrength = def.tintStrength ?? 0.4;
    tint = def.tint === 'entity' ? (MOBS[mobId]?.color ?? null) : def.tint;
  }
  return { spec, tint };
}
