// Deterministic live previews for authored camps. These entities are fed into
// the frozen editor Sim so the normal character renderer supplies idle motion.

import { applyCampMobTuning, resolveCampLevelRange } from '../sim/camp_authoring';
import { campSpawnOffset } from '../sim/camp_scatter';
import { MOBS } from '../sim/data';
import { createMob } from '../sim/entity';
import { Rng } from '../sim/rng';
import type { CampDef, Entity } from '../sim/types';

export function buildCampPreviewEntities(
  camps: readonly CampDef[],
  seed: number,
  firstId: number,
  groundY: (x: number, z: number) => number,
): Entity[] {
  const out: Entity[] = [];
  let id = firstId;
  camps.forEach((camp, campIndex) => {
    const template = MOBS[camp.mobId];
    if (!template) return;
    const levels = resolveCampLevelRange(camp, template);
    const rng = new Rng((seed ^ Math.imul(campIndex + 1, 0x9e3779b1)) >>> 0);
    for (let index = 0; index < camp.count; index++) {
      const offset = template.dummy
        ? { x: 0, z: 0 }
        : campSpawnOffset(index, camp.count, camp.radius, rng.range(0, Math.PI * 2), rng.next());
      const x = camp.center.x + offset.x;
      const z = camp.center.z + offset.z;
      const level = template.dummy ? levels.max : rng.int(levels.min, levels.max);
      const mob = createMob(id++, template, level, { x, y: groundY(x, z), z });
      mob.authorVfx = camp.authorVfx ? { ...camp.authorVfx } : undefined;
      // Same tuning the live Sim applies at spawn, so the maker sees the
      // authored scale (and the rest) without leaving the editor.
      applyCampMobTuning(camp, mob);
      mob.facing = template.dummy ? 0 : rng.range(-Math.PI, Math.PI);
      mob.prevFacing = mob.facing;
      mob.wanderTimer = Number.POSITIVE_INFINITY;
      out.push(mob);
    }
  });
  return out;
}
