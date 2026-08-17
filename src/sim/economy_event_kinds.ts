// Economy Watch, phase 1: the event VOCABULARY. A pure leaf with zero imports,
// deliberately: `types.ts` needs the kind union to declare the `economy`
// SimEvent variant, and `economy_events.ts` (which reaches `data.ts` for the
// zone lookup) needs the same names, so putting the vocabulary in either one
// would make the other a cycle. Keeping it here is also what lets the server's
// ledger writer, the reconciliation job, and the Prometheus exporter share one
// definition of "which kinds mint, which burn, which must balance" instead of
// three switch statements that can drift apart.

/**
 * THE CLOSED EVENT-KIND ALLOWLIST. Every kind of movement a character's purse
 * can make, one entry each, and the reconciliation job's whole vocabulary.
 *
 * Closed in both directions: a kind that is not here cannot be emitted (the
 * type refuses it), and a kind here with no emit site is dead vocabulary that
 * `tests/economy_ledger_guard.test.ts` reports. Adding a faucet or a sink means
 * adding its kind HERE, classifying it in FAUCET_KINDS / SINK_KINDS /
 * TRANSFER_PARTNER below, and giving it an emit site; miss any of the three and
 * CI reds.
 *
 * APPEND-ONLY. These strings are the Prometheus `kind` label, the `gold_ledger`
 * column value, and the admin read API's grouping key, so a rename silently
 * splits a series and orphans every historical row. Add, never rename, never
 * remove.
 */
export const ECONOMY_EVENT_KINDS = [
  // --- Faucets: coin that did not exist before the event. ---
  'mob_loot',
  'quest_reward',
  'delve_reward',
  'delve_lockpick_bonus',
  'rift_cache',
  'admin_grant',
  'dev_command',
  // Vendor sell is a faucet in the strict sense (an NPC vendor's purse is not
  // modelled, so the coin is minted), kept beside its buy twin for readability.
  'vendor_sell',
  // The faucet half of a charge that did not stick.
  'guild_create_refund',
  // --- Sinks: coin that ceases to exist. ---
  'vendor_buy',
  'vendor_buyback',
  'bank_expansion',
  'repair',
  'respec',
  'craft_fee',
  'train_fee',
  'unbind_fee',
  'riding_lesson_fee',
  'companion_upgrade',
  'guild_create_fee',
  'guild_bank_expansion',
  'market_fee',
  'mail_postage',
  // --- Transfers: coin that moved between two modelled holders. ---
  'trade',
  'market_purchase',
  'market_escrow_hold',
  'market_escrow_release',
  'market_sale',
  'mail_send',
  'mail_claim',
  'mail_return',
  'guild_bank_deposit',
  'guild_bank_withdraw',
  'wager_stake',
  'wager_payout',
  'wager_refund',
] as const;

export type EconomyEventKind = (typeof ECONOMY_EVENT_KINDS)[number];

/**
 * Kinds with NO emit site in this codebase yet, declared deliberately.
 *
 * The guard test's default rule is that a kind with no emit site is dead
 * vocabulary and reds, which is what stops the allowlist rotting into a wish
 * list. These three are the sanctioned exceptions, each for a concrete reason:
 *
 * - `repair`: this game has no durability. `ItemDef` carries no durability
 *   field and `src/sim/content/items.ts` says so explicitly at the tool
 *   entries, so there is nothing to charge for. Reserved because a repair sink
 *   is the classic-era shape this economy would reach for first.
 * - `admin_grant`: no operator-facing gold grant exists. `server/admin_db.ts`
 *   READS a character's copper for the dashboard and never writes it, and the
 *   only mint an operator can reach today is the `ALLOW_DEV_COMMANDS` cheat
 *   surface, which books `dev_command`. Reserved so a future compensation tool
 *   is a faucet the supply identity already accounts for, rather than an
 *   unexplained mint the reconciler reports as a violation on its first use.
 * - `mail_return`: the expiry return flight (`post_office.ts` `returnToSender`)
 *   re-keys a letter IN PLACE and moves no coin between holders, so there is no
 *   movement for a row to explain. It is also actor-less: the sweep runs on a
 *   timer with no acting player, and this phase's out-path is the per-player
 *   SimEvent path, which has no pid to carry a system event on. Conservation is
 *   unaffected either way, because the reconciler derives the mail escrow term
 *   by summing the LIVE mail book rather than by replaying rows. Reserved
 *   rather than dropped because the second-window deletion that follows a
 *   return DOES destroy unclaimed coin, and booking that burn needs an
 *   actor-less drain seam this phase does not build.
 *
 * Removing a kind from here without adding its emit site is what CI catches.
 */
export const RESERVED_KINDS: readonly EconomyEventKind[] = Object.freeze([
  'repair',
  'admin_grant',
  'mail_return',
]);

/** Kinds that CREATE coin. The supply identity's faucet side sums exactly these. */
export const FAUCET_KINDS: readonly EconomyEventKind[] = Object.freeze([
  'mob_loot',
  'quest_reward',
  'delve_reward',
  'delve_lockpick_bonus',
  'rift_cache',
  'admin_grant',
  'dev_command',
  'vendor_sell',
  'guild_create_refund',
]);

/** Kinds that DESTROY coin. The supply identity's sink side sums exactly these. */
export const SINK_KINDS: readonly EconomyEventKind[] = Object.freeze([
  'vendor_buy',
  'vendor_buyback',
  'bank_expansion',
  'repair',
  'respec',
  'craft_fee',
  'train_fee',
  'unbind_fee',
  'riding_lesson_fee',
  'companion_upgrade',
  'guild_create_fee',
  'guild_bank_expansion',
  'market_fee',
  'mail_postage',
]);

/**
 * Kinds that MOVE coin between two modelled holders, mapped to the kind
 * carrying the other half. A transfer never changes global supply, so each of
 * these must appear with a matching opposite-signed partner row; the
 * reconciliation job's symmetry check reads exactly this table, which is why it
 * is DATA here rather than a switch in the server.
 *
 * Self-partnered kinds (`trade`, the two guild-bank gold ops) balance within
 * their own kind: a trade is two `trade` rows, one per side; a guild deposit is
 * the officer's debit and the treasury's credit, both `guild_bank_deposit`.
 *
 * The market chain is the long one. A buy emits `market_purchase` (buyer's
 * debit) and `market_escrow_hold` (the seller's collection box filling with the
 * proceeds); the Merchant's cut is the `market_fee` SINK that makes those two
 * differ in magnitude. Collecting emits `market_escrow_release` (box emptying)
 * and `market_sale` (seller's purse filling).
 *
 * A Map-shaped frozen object is safe here because every key is a compile-time
 * literal from the array above, never client input.
 */
export const TRANSFER_PARTNER: Readonly<Partial<Record<EconomyEventKind, EconomyEventKind>>> =
  Object.freeze({
    trade: 'trade',
    market_purchase: 'market_escrow_hold',
    market_escrow_hold: 'market_purchase',
    market_escrow_release: 'market_sale',
    market_sale: 'market_escrow_release',
    mail_send: 'mail_claim',
    mail_claim: 'mail_send',
    mail_return: 'mail_send',
    guild_bank_deposit: 'guild_bank_deposit',
    guild_bank_withdraw: 'guild_bank_withdraw',
    wager_stake: 'wager_payout',
    wager_payout: 'wager_stake',
    wager_refund: 'wager_stake',
  } as const);

/** Kinds that must balance against a partner row. Derived, never hand-listed. */
export const TRANSFER_KINDS: readonly EconomyEventKind[] = Object.freeze(
  ECONOMY_EVENT_KINDS.filter((k) => TRANSFER_PARTNER[k] !== undefined),
);

/**
 * The counterparty a movement happened with. A character id when the other side
 * is a character the sim can name, a guild id for the shared treasury, or a
 * bare POOL name when the other side is a holding area rather than an actor (a
 * market collection box, a letter's attached coin). `null` on a faucet or a
 * sink, where by definition there is no second party.
 */
export type EconomyCounterparty =
  | { kind: 'character'; id: number }
  | { kind: 'guild'; id: number }
  | { kind: 'pool'; id: EconomyPoolId }
  | null;

/**
 * The holding areas that carry coin no character's purse holds. Closed for the
 * same reason the kinds are: these names are the reconciliation job's global
 * supply terms, so an unlisted pool would be coin the identity cannot see.
 */
export const ECONOMY_POOL_IDS = ['market_escrow', 'mail_escrow', 'guild_treasury'] as const;
export type EconomyPoolId = (typeof ECONOMY_POOL_IDS)[number];

/** Whether a kind mints coin, for the supply identity and the metrics split. */
export function isFaucetKind(kind: EconomyEventKind): boolean {
  return FAUCET_KINDS.includes(kind);
}

/** Whether a kind burns coin. */
export function isSinkKind(kind: EconomyEventKind): boolean {
  return SINK_KINDS.includes(kind);
}

/** Whether a kind must balance against a partner row. */
export function isTransferKind(kind: EconomyEventKind): boolean {
  return TRANSFER_PARTNER[kind] !== undefined;
}
