import { ENCHANTS } from '../../src/sim/content/enchants';
import {
  FARM_COMPOST_ITEM_ID,
  FARM_GROWTH_TONIC_ITEM_ID,
  FARM_WITHERED_HUSK_ITEM_ID,
} from '../../src/sim/content/farm_crops';
import { FARM_SURVIVAL_COMPOST_BONUS } from '../../src/sim/professions/farm_projection';
import {
  FARM_HUSKS_PER_COMPOST,
  FARM_TONIC_BONUS_CHANCE,
  FARM_TONIC_BONUS_PICKS,
} from '../../src/sim/professions/farming';
import { MATERIAL_GRADES } from '../../src/sim/professions/material_grades';

// The "Used for" lines a material page needs beyond recipe reagents and quest
// hand-ins: what each enchant consumes, the fine node grades that stand in for
// their normal grade in any recipe, and the farming supplies spent at planting or
// traded at a farmer. Each line answers "what can I make or do with this?".

export interface MaterialUseLinks {
  item(id: string): string;
  /** The enchant's page link, labelled with its name. */
  enchant(id: string): string;
  /** A link to a guide page, by its title. */
  page(title: string): string;
}

const percentPoints = (n: number) => Number((n * 100).toFixed(4));

/** Item id to its extra "Used for" lines. */
export function materialUses(links: MaterialUseLinks): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (id: string, line: string) => {
    const entries = out.get(id) ?? [];
    entries.push(line);
    out.set(id, entries);
  };
  for (const e of Object.values(ENCHANTS))
    for (const r of e.reagents)
      add(
        r.itemId,
        `${r.count} each time you apply ${links.enchant(e.id)} (${links.page('Enchanting')}` +
          (e.skillReq ? `, skill ${e.skillReq}` : '') +
          ').',
      );
  for (const [base, row] of Object.entries(MATERIAL_GRADES))
    add(
      row.fineItemId,
      `Any crafting recipe that asks for ${links.item(base)} also takes this fine grade in its place. If you carry both, the normal grade is used first.`,
    );
  add(
    FARM_WITHERED_HUSK_ITEM_ID,
    `Trade ${FARM_HUSKS_PER_COMPOST} to a farmer for 1 ${links.item(FARM_COMPOST_ITEM_ID)}.`,
  );
  add(
    FARM_COMPOST_ITEM_ID,
    `Use 1 when you plant a crop. Its chance to survive goes up by ${percentPoints(FARM_SURVIVAL_COMPOST_BONUS)} (for example, from 85% to ${85 + percentPoints(FARM_SURVIVAL_COMPOST_BONUS)}%), to at most 100%. See ${links.page('Farm crops')}.`,
  );
  add(
    FARM_GROWTH_TONIC_ITEM_ID,
    `Use 1 when you plant a crop for a ${percentPoints(FARM_TONIC_BONUS_CHANCE)}% chance of ${FARM_TONIC_BONUS_PICKS} extra normal-grade produce when you harvest it. See ${links.page('Farm crops')}.`,
  );
  return out;
}
