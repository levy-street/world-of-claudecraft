// The `/dev map` cheat family (ctx.devCommands-gated, routed from
// dev_commands.ts handleDevChat): playtest shortcuts around treasure maps and
// vaults (src/sim/treasure_vault.ts).
//   /dev map [common|rare|epic|legendary]  grants one map of that rarity
//   /dev map site                          prints the read map's dig site
//   /dev map coin [amount]                 grants every faction currency
// Dev-channel text only ([dev] lines); nothing here is player copy.

import {
  isTreasureMapRarity,
  TREASURE_MAP_ITEM_IDS,
  TREASURE_SITES_BY_ID,
} from './content/treasure_maps';
import { awardFactionCurrency, FACTION_IDS } from './factions';
import type { SimContext } from './sim_context';

function devLog(ctx: SimContext, pid: number, text: string): void {
  ctx.emit({ type: 'log', text, pid });
}

/** Handles one `/dev map [verb] [arg]` line; `verb`/`arg` are already lower-cased/trimmed. */
export function handleDevTreasureMapCommand(
  ctx: SimContext,
  pid: number,
  verb: string,
  arg: string,
): void {
  if (!ctx.devCommands) return;
  const meta = ctx.players.get(pid);
  if (!meta) return;
  if (verb === 'site') {
    const site = meta.treasureMap ? TREASURE_SITES_BY_ID[meta.treasureMap.siteId] : null;
    devLog(
      ctx,
      pid,
      site
        ? `[dev] ${meta.treasureMap?.rarity} map: ${site.id} in ${site.zoneId}. Use /dev tp ${site.x} ${site.z}.`
        : '[dev] No treasure map read. Use a map from your bags first.',
    );
    return;
  }
  if (verb === 'coin') {
    const amount = Math.max(1, Math.floor(Number(arg) || 500));
    for (const factionId of FACTION_IDS) awardFactionCurrency(meta, factionId, amount);
    meta.wireRev++;
    devLog(ctx, pid, `[dev] Granted ${amount} of every faction currency.`);
    return;
  }
  const rarity = verb === '' ? 'common' : verb;
  if (!isTreasureMapRarity(rarity)) {
    devLog(ctx, pid, '[dev] Usage: /dev map [common|rare|epic|legendary|site|coin <amount>].');
    return;
  }
  ctx.addItem(TREASURE_MAP_ITEM_IDS[rarity], 1, pid);
  devLog(ctx, pid, `[dev] Granted one ${rarity} treasure map. Use it to read it.`);
}
