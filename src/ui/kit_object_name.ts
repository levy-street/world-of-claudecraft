// The display name of a trash engine encounter object (a hazard pool, a
// combat wall, a walker orb: src/sim/mob/trash_kit/kit_objects.ts). The sim
// names those objects in English after their mechanic ("Ice Slab", "Spilled
// Soulfire"); the client re-localizes the name through the same matcher the
// combat log and the aura bar use. Pure: the set of object templates is swept
// once from the content's kits (every template's trashKit and the dev demo
// kit) and the wall shapes, plus the Hollow Crypt's encounter objects (the
// Remembrance Candles, Grasp of the Grave's rings, the Burning Knell's half,
// Marrow's graves, the Lady's lanterns) and the Bound Soul Morthen's Gravecall
// launches (an encounter-owned walker no content kit carries).

import { MOBS } from '../sim/data';
import { CRYPT_OBJECT_TEMPLATES } from '../sim/encounters/hollow_crypt/ids';
import { MORTHEN_SOUL_TEMPLATE } from '../sim/encounters/hollow_crypt/morthen_ids';
import { COMBAT_WALL_SHAPES } from '../sim/instances/combat_wall_state';
import { TRASH_ENGINE_DEMO_KIT } from '../sim/mob/trash_kit/engine_demo';
import type { TrashKitDef } from '../sim/types';
import { localizeSimAuraName } from './sim_i18n';

let templates: Set<string> | null = null;

function addKit(out: Set<string>, kit: TrashKitDef | undefined): void {
  if (!kit) return;
  const use = kit.usable?.effect;
  if (use?.kind === 'topple') out.add(use.hazard.objectTemplate);
  const pool = kit.breathPool?.hazard.objectTemplate;
  if (pool) out.add(pool);
  const orb = kit.walker?.objectTemplate;
  if (orb) out.add(orb);
  const wall = kit.toss?.leavesWall?.objectTemplate;
  if (wall) out.add(wall);
}

/** Is `templateId` a trash engine encounter object's template? */
export function isKitObjectTemplate(templateId: string): boolean {
  if (!templates) {
    const out = new Set<string>(Object.keys(COMBAT_WALL_SHAPES));
    for (const id of CRYPT_OBJECT_TEMPLATES) out.add(id);
    out.add(MORTHEN_SOUL_TEMPLATE);
    for (const t of Object.values(MOBS)) addKit(out, t.trashKit);
    addKit(out, TRASH_ENGINE_DEMO_KIT);
    templates = out;
  }
  return templates.has(templateId);
}

/** The localized name of a kit object, or null when `templateId` is not one. */
export function kitObjectDisplayName(templateId: string, name: string): string | null {
  if (!isKitObjectTemplate(templateId)) return null;
  return localizeSimAuraName(name) ?? name;
}
