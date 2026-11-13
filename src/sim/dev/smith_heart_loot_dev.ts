// /dev heart loot [boss]: lay dev loot on Smith's Heart guardians' corpses
// (ALLOW_DEV_COMMANDS only, reached through smith_heart_dev.ts like every
// /dev heart verb). The raid's loot tables are still empty on purpose (design
// doc, "Loot hook"), so a real kill leaves nothing to loot; this puts a purse
// of copper on each dead guardian in the run (open to everyone at once) so
// the loot moment (render/smith_heart_fx/loot_coffer_core.ts) and the corpse
// loot path can be played before the drops are wired. It changes nothing
// else: no kill, no item, no roll.
//
//   /dev heart loot              every dead guardian in the run
//   /dev heart loot <boss>       guardian|singer|council|hammer|breath|quench|
//                                heat|final

import { SMITH_HEART_FINAL_BOSS, SMITH_HEART_GUARDIANS } from '../content/smith_heart';
import { COUNCIL_SEAM_SINGER } from '../encounters/smith_heart/council_ids';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';

/** The bodies that can carry the run's boss loot. */
export const SMITH_HEART_LOOT_BOSSES: ReadonlySet<string> = new Set([
  ...Object.values(SMITH_HEART_GUARDIANS),
  COUNCIL_SEAM_SINGER,
  SMITH_HEART_FINAL_BOSS,
]);

/** The dev purse laid on each corpse (copper). */
export const SMITH_HEART_DEV_LOOT_COPPER = 1250;

/** The template ids a `/dev heart loot` name picks (null: every guardian;
 *  undefined: the name means nothing). */
export function smithHeartLootTargets(named: string): ReadonlySet<string> | null | undefined {
  switch (named) {
    case '':
    case 'all':
      return null;
    case 'council':
    case 'hammer':
      return new Set([SMITH_HEART_GUARDIANS.hammer, COUNCIL_SEAM_SINGER]);
    case 'guardian':
      return new Set([SMITH_HEART_GUARDIANS.hammer]);
    case 'singer':
      return new Set([COUNCIL_SEAM_SINGER]);
    case 'breath':
    case 'quench':
    case 'heat':
      return new Set([SMITH_HEART_GUARDIANS[named]]);
    case 'final':
      return new Set([SMITH_HEART_FINAL_BOSS]);
    default:
      return undefined;
  }
}

/** Lay the dev purse on every dead guardian of `inst` that `targets` names
 *  (null: all). Returns how many corpses took it. */
export function seedSmithHeartDevLoot(
  ctx: SimContext,
  inst: InstanceSlot,
  targets: ReadonlySet<string> | null,
): number {
  let n = 0;
  for (const id of inst.mobIds) {
    const mob = ctx.entities.get(id);
    if (!mob || mob.kind !== 'mob' || !mob.dead) continue;
    if (!SMITH_HEART_LOOT_BOSSES.has(mob.templateId)) continue;
    if (targets && !targets.has(mob.templateId)) continue;
    mob.loot ??= { copper: 0, items: [] };
    mob.loot.copper += SMITH_HEART_DEV_LOOT_COPPER;
    mob.lootable = true;
    // Open to everyone at once: whoever tests it can loot it.
    mob.lootFfaTimer = 0;
    n++;
  }
  return n;
}
