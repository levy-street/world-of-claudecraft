// Resolve a mob's combat template. The static MOBS table answers for every
// regular mob; Source Cave contributor mobs carry a synthetic, per-Sim
// templateId (`source_cave_<login>`) deliberately never merged into MOBS
// (state.md D2/Phase 2), so they resolve through the cave runtime's own
// template array. Extracted on the rule of three from the inline
// `MOBS[...] ?? ctx.sourceCave?.templates.find(...)` fallbacks (mob/targeting,
// mob/locomotion, pet/pet_ai), and consumed by the swing-affix cascade so the
// cave's tier affixes actually fire.
//
// Additive by construction: when MOBS resolves (every non-cave mob), the exact
// same template object is returned and the fallback is never reached, so
// existing behavior and rng draw order are unchanged. The per-runtime Map is a
// pure memo of a static array (built once per SourceCaveRuntime, no rng, no
// clock): the cascade reads the template ~20 times per landed swing, and a
// linear find() per read would be O(roster) each.

import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import type { SourceCaveRuntime } from '../source_cave';
import type { Entity, MobTemplate } from '../types';

const caveTemplateIndex = new WeakMap<SourceCaveRuntime, Map<string, MobTemplate>>();

/** The template a mob's combat behavior reads, or undefined for templateless entities. */
export function mobTemplateOf(ctx: SimContext, mob: Entity): MobTemplate | undefined {
  const direct = MOBS[mob.templateId];
  if (direct) return direct;
  const cave = ctx.sourceCave;
  if (!cave) return undefined;
  let index = caveTemplateIndex.get(cave);
  if (!index) {
    index = new Map(cave.templates.map((template) => [template.id, template]));
    caveTemplateIndex.set(cave, index);
  }
  return index.get(mob.templateId);
}
