// Economy telemetry vocabulary: the bounded label sets the /metrics exporter
// uses for copper flow and for harvest counts, plus the two pure classifiers
// that produce them. Kept out of game.ts and out of the exporter so both can be
// unit-tested with no registry, no socket, and no running world.
//
// Why these two signals exist: the gathered materials came off every vendor
// counter in one move, so a player who used to buy a stack of ore now has to go
// and mine it. Both halves of that need watching. Copper flow answers whether
// the faucet still covers what a player must buy (tools, training, fees) once
// materials are no longer a copper sink; harvest counts by zone band and node
// tier answer whether players actually reach the later zones' nodes and the
// tool-gated tiers within them, or stall on the starter zone's bare-hands
// faucet. Neither reads back into gameplay: this is observability only.
//
// COPPER FLOW IS A TREND, NOT A LEDGER. It is sampled as the acting player's
// copper delta across one command dispatch, so it books nothing for a credit
// that lands on a third party, and it MISATTRIBUTES a tick-driven payout to
// whichever command is sampled next. Do not sum these series and expect them
// to reconcile against total coin in the world.
//
// CARDINALITY IS BOUNDED BY CONSTRUCTION, the same contract as
// server/http/game_signals.ts. A client command outside the allowlist below
// classifies as 'other' rather than becoming its own series, so the label set
// can never grow with the message vocabulary, and nothing per-player (account
// id, character id, name, ip) is ever a label.

import { GATHER_NODES, ZONES } from '../src/sim/data';

/**
 * The fixed sources copper is attributed to. One label per economic surface,
 * NOT one per client command: the map below is many-to-one on purpose.
 */
export const COPPER_FLOW_SOURCES = [
  'quest',
  'vendor',
  'loot',
  'market',
  'mail',
  'bank',
  'delve',
  'craft',
  'trade',
  'wager',
  'dev',
  'other',
] as const;

export type CopperFlowSource = (typeof COPPER_FLOW_SOURCES)[number];

/**
 * Client command to economic surface. Every command that can move the acting
 * player's copper belongs here; anything else falls through to 'other', which
 * is also where a genuinely uncategorized move shows up rather than vanishing.
 *
 * A Map, NOT an object literal: the key is a CLIENT-SUPPLIED string, and a
 * plain-object lookup resolves 'toString' or 'constructor' to an inherited
 * function, which would then be handed to prom-client as a label value.
 */
const SOURCE_BY_COMMAND: ReadonlyMap<string, CopperFlowSource> = new Map(
  Object.entries({
    turnin: 'quest',
    buy: 'vendor',
    sell: 'vendor',
    sell_all_junk: 'vendor',
    buyback: 'vendor',
    loot: 'loot',
    autoloot: 'loot',
    lootRoll: 'loot',
    pickup: 'loot',
    harvestCorpse: 'loot',
    harvest_node: 'loot',
    market_buy: 'market',
    market_list: 'market',
    market_collect: 'market',
    market_cancel: 'market',
    mail_send: 'mail',
    mail_take: 'mail',
    bank_buy_slots: 'bank',
    delve_buy: 'delve',
    delve_interact: 'delve',
    delve_rite_choose: 'delve',
    collect_delve_chest_loot: 'delve',
    // The delve-companion upgrade spends copper alongside Marks: same
    // surface as its delve_buy siblings (the whole-branch review found it
    // booking under 'other').
    companion_upgrade: 'delve',
    lockpick_action: 'delve',
    craft_item: 'craft',
    train_recipe: 'craft',
    // Riding is the game's largest one-time TRAINING fee (80 gold at level
    // 20): it books with the other training spends rather than in 'other',
    // where the whole-branch review found it hiding from the exact
    // does-the-faucet-cover-training question this module exists to answer.
    learn_riding: 'craft',
    apply_enchant: 'craft',
    disenchant_item: 'craft',
    salvage_item: 'craft',
    unbind_item: 'craft',
    place_mobile_station: 'craft',
    respec: 'craft',
    trade_accept: 'trade',
    trade_confirm: 'trade',
    vcup_bet: 'wager',
    play_card: 'wager',
    dev_give: 'dev',
    dev_level: 'dev',
  } satisfies Record<string, CopperFlowSource>),
);

/**
 * Every command the map classifies, exposed so a test can pin the WHOLE mapping
 * and check the keys are commands the dispatcher actually routes. A key that
 * stops matching a real command downgrades its surface to 'other' silently,
 * which leaves the metric reporting the wrong thing rather than nothing.
 */
export const COPPER_FLOW_COMMANDS: readonly string[] = Object.freeze([...SOURCE_BY_COMMAND.keys()]);

/** The economic surface a client command's copper move is attributed to. */
export function copperFlowSourceForCommand(command: string): CopperFlowSource {
  return SOURCE_BY_COMMAND.get(command) ?? 'other';
}

/**
 * The harvest bands, RE-KEYED BY ZONE (R3): one band per shipped zone, in
 * zone order, derived from the live ZONES table. The old material-price
 * keying (starter/mid/premium off materialTierForItem) answered the wrong
 * question: a fine grade or a re-priced material moved bands with nobody
 * standing anywhere new, and Thornpeak's premium ore was invisible because
 * thorium prices mid. Zone keying answers what the series exists for (do
 * players actually reach the later zones' ground) and scales with V3 by
 * construction: a new ZoneDef extends the label set, and the exporter
 * pre-seeds every member to zero, so cardinality stays bounded at the zone
 * count. Extending is deliberate, not frictionless: a new zone reddens the
 * band membership pins and the professions rollout ledger until its nodes
 * exist, the same forced decision R37's guard makes everywhere else.
 *
 * The bound is enforced at runtime, not by the type: ZoneDef.id is plain
 * string, so HarvestBand below is string too, and the exporter's harvest()
 * refuses any value outside this list rather than minting a series for it.
 * The zone-count and membership pins live in tests/economy_telemetry.test.ts
 * and tests/professions_zone_rollout.test.ts (which also keeps this list,
 * and therefore the [0] fallback below, non-empty).
 */
export const HARVEST_BANDS: readonly string[] = Object.freeze(ZONES.map((zone) => zone.id));

export type HarvestBand = (typeof HARVEST_BANDS)[number];

/** O(1) node-to-zone resolution for the event pass; built once from content. */
const NODE_ZONE_BY_ID: ReadonlyMap<string, string> = new Map(
  GATHER_NODES.map((node) => [node.id, node.zoneId]),
);

/**
 * The band one granted harvest is counted under: the NODE's zone. An unknown
 * node id (a retired node named by a stale event) falls to the first zone,
 * the same counted-not-dropped direction the old unknown-item arm took.
 */
export function harvestBandForNode(nodeId: string): HarvestBand {
  return NODE_ZONE_BY_ID.get(nodeId) ?? HARVEST_BANDS[0];
}

/**
 * The node tiers, as label values. Fixed at three by GatherNodeDef.tier (tier 1
 * is bare-hands, 2 and 3 need the matching tool rung), NOT derived from the
 * node table: a tier is a rung of the tool ladder, not a record, so a fourth
 * one is a design change that should redden this pin rather than silently widen
 * the harvest series.
 *
 * Why the harvest counter needs it (R31): the zone band alone cannot separate a
 * level-1 traveler working Thornpeak's tier-1 faucet from a capped player
 * working the tier-2 and tier-3 veins beside it (Eastbrook ships tier-1
 * ground only, so the zones where the question arises are the later two), and those two are the
 * opposite sides of the question the series exists to answer. Zones x tiers is
 * nine series, and the combinations no live node fills (Eastbrook has no tier-3
 * ground) sit at a permanent, honest zero.
 */
export const NODE_TIERS = ['1', '2', '3'] as const;

/** One of the three node tiers, as a label value. */
export type HarvestTier = (typeof NODE_TIERS)[number];

/** O(1) node-to-tier resolution for the event pass; built once from content,
 *  sibling of NODE_ZONE_BY_ID above and a real Map for the same reason. */
const NODE_TIER_BY_ID: ReadonlyMap<string, string> = new Map(
  GATHER_NODES.map((node) => [node.id, String(node.tier)]),
);

/**
 * The tier one granted harvest is counted under: the NODE's own tier. An
 * unknown node id (a retired node named by a stale event) falls to tier 1, the
 * same counted-not-dropped direction harvestBandForNode takes, and a tier the
 * vocabulary does not carry falls there too rather than minting a series.
 */
export function harvestTierForNode(nodeId: string): HarvestTier {
  const tier = NODE_TIER_BY_ID.get(nodeId);
  return tier !== undefined && (NODE_TIERS as readonly string[]).includes(tier)
    ? (tier as HarvestTier)
    : NODE_TIERS[0];
}
