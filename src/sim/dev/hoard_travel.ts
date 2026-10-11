// Direct hoard playtests, behind the same dev gate as /dev map: a themed boss
// room at any map rarity, without reading and digging a map for it. A trailing
// `goblin` makes the room hold a Coinsack Scurrier (rift/hoard_goblin.ts).
// The eight themed bosses live on epic and legendary maps; the cave bosses
// (content/rift/cave_themes.ts) on common and rare ones, which is where a bare
// `/dev hoard <cave boss>` takes you.
import {
  isTreasureMapRarity,
  TREASURE_MAP_RARITIES,
  TREASURE_SITES,
  type TreasureMapRarity,
} from '../content/treasure_maps';
import { createGroundObject } from '../entity';
import { RIFT_RANK_BASE_LEVEL } from '../rift/ranks';
import { generateRiftPlan } from '../rift/rift_gen';
import {
  HOARD_ENTRANCE_TEMPLATE_ID,
  makeVaultSeed,
  OPEN_HOARD_RARITIES,
  type VaultSizeTier,
  type VaultZoneId,
} from '../rift/vault_seed';
import type { SimContext } from '../sim_context';
import type { RiftTier } from '../types';

export const DEV_HOARD_DESTINATIONS = [
  { boss: 'frost', alias: 'warden', zone: 'frostveil', theme: 'frost' },
  { boss: 'ember', alias: 'tyrant', zone: 'drakelands', theme: 'ember' },
  { boss: 'spider', alias: 'venom', zone: 'willowfen', theme: 'venom' },
  { boss: 'skeleton', alias: 'necro', zone: 'wraithwood', theme: 'bone' },
  { boss: 'grask', alias: 'brute', zone: 'amberfall', theme: 'brute' },
  { boss: 'nyxaris', alias: 'arcane', zone: 'nightbloom', theme: 'void' },
  { boss: 'vharok', alias: 'storm', zone: 'galecrest', theme: 'storm' },
  { boss: 'maw', alias: 'tide', zone: 'palmreach', theme: 'tide' },
  { boss: 'mushroom', alias: 'spore', zone: 'willowfen', theme: 'spore', cave: true },
  { boss: 'deeprake', alias: 'mole', zone: 'amberfall', theme: 'burrow', cave: true },
  { boss: 'bat', alias: 'roost', zone: 'nightbloom', theme: 'roost', cave: true },
  { boss: 'chest', alias: 'mimic', zone: 'drakelands', theme: 'mimic', cave: true },
] as const satisfies readonly {
  boss: string;
  alias: string;
  zone: VaultZoneId;
  theme: string;
  cave?: boolean;
}[];

/** Whether a destination's boss lives in the caves (common and rare maps). */
function isCaveDestination(destination: (typeof DEV_HOARD_DESTINATIONS)[number]): boolean {
  return 'cave' in destination && destination.cave === true;
}

/** The rank (and with it the room size) each map rarity opens, the same table
 *  treasure_maps.ts uses for a real map. */
const RARITY_TIER: Readonly<Record<TreasureMapRarity, RiftTier>> = {
  common: 'C',
  rare: 'B',
  epic: 'A',
  legendary: 'S',
};

/** Bounded seed search uses the production generator, without touching the live
 *  RNG. The seed's size tier and the plan's rank both follow the rarity, so the
 *  room is the one that rarity of map would dig up. */
export function devHoardDestination(
  query: string,
  rarityArg?: TreasureMapRarity,
  accept: (seed: number) => boolean = () => true,
) {
  const key = query.trim().toLowerCase();
  const destination =
    DEV_HOARD_DESTINATIONS.find(
      (d, i) => key === d.boss || key === d.alias || key === String(i + 1),
    ) ?? DEV_HOARD_DESTINATIONS.find((d) => key === d.zone);
  if (!destination) return null;
  const rarity = rarityArg ?? (isCaveDestination(destination) ? 'rare' : 'legendary');
  const tier = RARITY_TIER[rarity];
  const size = TREASURE_MAP_RARITIES.indexOf(rarity) as VaultSizeTier;
  for (let random = 0; random < 4096; random++) {
    // The same open-air rule a real map follows: only epic and legendary dig
    // into the open valley, so a dev room is the room that rarity really opens.
    const open = (OPEN_HOARD_RARITIES as readonly string[]).includes(rarity);
    const seed = makeVaultSeed(size, random, { open, zoneId: destination.zone });
    if (
      generateRiftPlan(seed, RIFT_RANK_BASE_LEVEL[tier]).themeId === destination.theme &&
      accept(seed)
    ) {
      return { ...destination, seed, rarity, tier };
    }
  }
  return null;
}

export function handleDevHoardTravel(
  ctx: SimContext,
  pid: number,
  query: string,
  rarityArg = '',
  extraArg = '',
): void {
  if (!ctx.devCommands) return;
  const player = ctx.entities.get(pid);
  if (!player || !ctx.players.has(pid)) return;
  // `goblin` may stand in the rarity slot or after it.
  const words = [rarityArg, extraArg].map((w) => w.trim().toLowerCase());
  const goblin = words.includes('goblin');
  const rarity = words.find((w) => w && w !== 'goblin') ?? '';
  if (rarity && !isTreasureMapRarity(rarity)) {
    ctx.emit({
      type: 'log',
      pid,
      text: '[dev] /dev hoard <boss|zone|1-12> [common|rare|epic|legendary] [goblin].',
    });
    return;
  }
  const destination = devHoardDestination(query, isTreasureMapRarity(rarity) ? rarity : undefined);
  if (!destination && rarity) {
    ctx.emit({
      type: 'log',
      pid,
      text: `[dev] No ${rarity} hoard holds that boss: the themed bosses are epic and legendary, the cave bosses common and rare.`,
    });
    return;
  }
  if (!destination) {
    ctx.emit({
      type: 'log',
      pid,
      text: '[dev] /dev hoard <boss|zone|1-12> [common|rare|epic|legendary] [goblin]. Destinations:',
    });
    for (const [index, d] of DEV_HOARD_DESTINATIONS.entries()) {
      ctx.emit({ type: 'log', pid, text: `[dev] ${index + 1}: ${d.boss} (${d.alias}), ${d.zone}` });
    }
    return;
  }
  if (player.dead) {
    ctx.emit({ type: 'log', pid, text: '[dev] Use /dev revive before travelling.' });
    return;
  }
  enterDevHoard(ctx, pid, destination, goblin);
}

/** Step into a dev hoard room (the tail of /dev hoard; tests that need a
 *  particular room find its destination first, then come in here). */
export function enterDevHoard(
  ctx: SimContext,
  pid: number,
  destination: NonNullable<ReturnType<typeof devHoardDestination>>,
  goblin = false,
): void {
  const player = ctx.entities.get(pid);
  if (!player) return;
  const site = TREASURE_SITES.find((s) => s.zoneId === destination.zone);
  if (!site) return;
  ctx.leaveRift(pid);
  if (player.level < 20) ctx.setPlayerLevel(20, pid);
  // A descriptor-only entrance selects real vault scaling and ownership. It is
  // not attached to the world, so repeated testing never leaves orphan hatches.
  const portal = createGroundObject(-1, '', '', ctx.groundPos(site.x, site.z));
  portal.templateId = HOARD_ENTRANCE_TEMPLATE_ID;
  portal.vaultOwnerPid = pid;
  portal.vaultRarity = destination.rarity;
  if (goblin) portal.devForceHoardGoblin = true;
  ctx.enterRift(destination.seed, RIFT_RANK_BASE_LEVEL[destination.tier], pid, site, portal);
}
