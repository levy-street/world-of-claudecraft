// The game-state counter seam: the throughput counters that live on the /metrics
// exporter (woc_ws_messages_total, woc_ws_messages_dropped_total,
// woc_ws_rate_kicks_total, woc_input_frames_missed_total,
// woc_chat_messages_total, woc_characters_created_total,
// woc_guild_bank_incidents_total) reach the exporter
// through this one process-wide slot instead of each emission site (game.ts
// message dispatch and inbound gate/lanes, chat routing, characters.ts create
// path) threading a sink through its constructors. main.ts
// installs the real implementation (registerGameStateMetrics(...), so every
// counter shares the exporter's one registry) once at boot, exactly like
// setAttackSignalSink; before that, and in any test that never wires one, the slot
// holds the no-op and every emission is dropped.
//
// This is the counter half of the game-state metrics. The gauges (players online,
// tick rate, ...) are read live at scrape time and need no slot: they pull from a
// GameStateSource the exporter registration captures. See server/http/game_metrics.ts.
//
// CARDINALITY IS BOUNDED BY DESIGN, same contract as server/http/metrics.ts: the
// only label values here are the ws-message direction (a fixed two), the
// inbound drop cause (the fixed seven-value WS_DROP_CAUSES set), the guild-bank
// incident kind (the fixed nine-value GUILD_BANK_INCIDENTS set), the copper-flow
// source, the harvest band and node tier (the fixed sets in
// server/economy_telemetry.ts), and the fishing band and rod recipe id (the
// fixed sets in server/fishing_telemetry.ts, whose zone label reuses the same
// harvest band vocabulary). Nothing per-player and nothing per-GUILD (account
// id, character id, guild id, name, ip) is ever passed as a label.

import type { CopperFlowSource, HarvestBand, HarvestTier } from '../economy_telemetry';
import type { FishingBandLabel } from '../fishing_telemetry';

/** The two directions a ws frame is counted under: client-to-server or server-to-client. */
export type WsMessageDirection = 'in' | 'out';

/**
 * The fixed seven causes an inbound ws frame can be dropped for: the two
 * pre-parse gate causes (server/msg_rate_limit.ts), the three post-parse
 * lanes (server/msg_lanes.ts), the list-read guard on the ignore/block
 * readouts (server/list_read_guard.ts), and the guild-bank op guard
 * (server/guild_bank_op_guard.ts, each allowed op is a keep-forever ledger
 * write). This closed set IS the cause label's whole vocabulary; it never
 * grows per-player or per-message.
 */
export const WS_DROP_CAUSES = [
  'rate',
  'bytes',
  'lane_movement',
  'lane_command',
  'lane_chat',
  'list_read',
  'guild_bank',
] as const;

/** One of the fixed seven inbound drop causes. */
export type WsDropCause = (typeof WS_DROP_CAUSES)[number];

/**
 * The fixed nine guild-bank incident kinds. Every one of these is an abnormal
 * event on a DUPE-SENSITIVE path (the escrow save, the lease fence-out revert,
 * the reconcile, the durable-truth read, the keep-forever ledger) that
 * otherwise reports only through console.error / console.warn, i.e. it is
 * invisible to production alerting:
 * - `escrow_save_failed`: a save carrying at least one guild book FAILED, so
 *   the character half AND the book half rolled back and nothing this session
 *   did since its last save is durable. Two ways in: the db layer threw (a
 *   transport fault), or the escrow merge refused a book half and that refusal
 *   was TERMINAL (see escrow_quarantined). The live sim is ahead of durable
 *   truth until a later save or a reconcile lands.
 *   Deliberately NOT counted for a refusal that will be RETRIED: that is
 *   ordinary concurrency between two officers of one guild, it happens on a
 *   healthy realm, and folding it in here made `> 0` alerting useless. It is
 *   `escrow_refused_retry` below instead. This counter being non-zero means
 *   something actually went wrong.
 * - `escrow_refused_retry`: the escrow merge refused a book half because
 *   another session still holds unflushed work for that guild, so the save is
 *   retried once their commit makes the replay applicable (which the refusal
 *   immediately flushes for). NORMAL CONCURRENCY, not a failure: nothing was
 *   consumed, the marks and the log are exactly as they were, and the ordinary
 *   case clears in a round trip. Counted per GUILD (the unit the retry applies
 *   to), like `reconcile`. Watch its RATE, not its presence: a sustained climb
 *   means officers are contending faster than the flush resolves, and the
 *   terminal arm it precedes is `escrow_quarantined`.
 * - `save_fenced_out`: that same save matched no row (a same-account takeover
 *   rotated the character lease), so the carried books need reconciling.
 * - `escrow_quarantined`: a refusal ran out of retries, or nothing could ever
 *   make the missing value durable, so the SESSION was abandoned: quarantined
 *   (it may never persist again), reverted, and disconnected. The terminal arm
 *   of the escrow design and the one worth paging on. Counted per SESSION; the
 *   per-guild reverts it triggers count as `reconcile` below.
 * - `reconcile`: revertOwnGuildBookOps undid one guild's unflushed log, i.e. a
 *   session that can never commit again held book ops for it (a fence-out, an
 *   exhausted leave flush, a teardown, or the quarantine above). Counted per
 *   GUILD, the unit the remedy applies to.
 * - `book_unloaded`: a book was left unloaded after a failed / oversized /
 *   malformed durable read at boot. That guild's ops are inert and its disband
 *   is refused fail-closed until the process restarts, which is an
 *   operator-visible outage for that guild, not a transient.
 * - `ledger_write_failed`: a bank_ledger insert rejected, so the audit trail
 *   (scripts/bank_audit.mjs) has a hole the replay cannot see.
 * - `counterparty_orphan`: a guild bank op moved the acting character's purse
 *   or bags while the guild book did not move at all
 *   (server/guild_bank_counterparty.ts). Value crossed the purse/book boundary
 *   in ONE direction, which is the dupe signature the counterparty ledger
 *   columns exist to make visible, and no legitimate op can produce it. Paged
 *   on alongside `escrow_quarantined`: a single sample is a defect, not a
 *   transient.
 * - `counterparty_unstamped`: a guild bank_ledger row was written with NO
 *   counterparty side at all. Its NULL columns are indistinguishable from a
 *   pre-feature row, so the audit will skip that op forever: the convention
 *   that "NULL means written before the columns existed" is only a convention,
 *   and this is what makes a live write site breaking it visible instead of
 *   silent. A single sample is a defect.
 * This closed set IS the kind label's whole vocabulary; it never grows
 * per-guild or per-player (guild id is NEVER a label; the loud log line beside
 * each increment carries the identifying detail).
 */
export const GUILD_BANK_INCIDENTS = [
  'escrow_save_failed',
  'escrow_refused_retry',
  'save_fenced_out',
  'escrow_quarantined',
  'reconcile',
  'book_unloaded',
  'ledger_write_failed',
  'counterparty_orphan',
  'counterparty_unstamped',
  // The officer-visible activity log's read failed (a cold cache whose query
  // threw or timed out). Its own kind because the refusal frame the player gets
  // is byte-identical to "you are not an officer", so without this a total read
  // outage is indistinguishable from ordinary refusals at the wire.
  'log_read_failed',
  // A guild was CREATED but its creation fee never became durable: the charge
  // lives only on a live purse whose session was fenced out or abandoned, so
  // the founder holds a guild the database was never paid for. Its own kind
  // because it is a single-sample defect (unlike the retryable save kinds
  // beside it) and it is the only one that leaves value UNCOLLECTED rather
  // than at risk of being double-counted.
  'create_fee_unpaid',
] as const;

/** One of the fixed eleven guild-bank incident kinds. */
export type GuildBankIncident = (typeof GUILD_BANK_INCIDENTS)[number];

/**
 * The game-state throughput emission hooks. Implementations must never
 * throw: an observability write can never be allowed to break the message,
 * chat, or character-create path it measures.
 */
export interface GameMetricsCounters {
  /** One ws frame handled, in the given direction. */
  wsMessage(direction: WsMessageDirection): void;
  /** One inbound ws frame dropped by the gate, a lane, or the list-read guard. */
  wsMessageDropped(cause: WsDropCause): void;
  /** One session kicked by the inbound-flood abuse window (gate or lane driven). */
  wsRateKick(): void;
  /**
   * A parsed input frame proved `missed` earlier input frames were sent and
   * never processed (the seq gap on the ordered socket, R9): the
   * input-frame-attributed share of the server's own drops. Client-attested:
   * seqs are client-sent, so a hostile client can fabricate gaps (each
   * observation capped by MSG_SEQ_GAP_SANITY); operators correlate the
   * counter with the drop-cause series instead of reading it as proven
   * server-side loss on its own (soak-packet-3.md carries the scrape guidance).
   */
  wsInputSeqGap(missed: number): void;
  /** One player chat message routed to other players (any channel). */
  chatMessage(): void;
  /** One character successfully created. */
  characterCreated(): void;
  /**
   * One guild-bank incident on a dupe-sensitive path, by kind (see
   * GUILD_BANK_INCIDENTS). Always emitted BESIDE the existing loud log, never
   * instead of it: the counter says how often, the log says which guild.
   */
  guildBankIncident(kind: GuildBankIncident): void;
  /**
   * `amount` copper (always positive) credited to the acting player during a
   * command attributed to `source`. Sampled as the player's own copper delta
   * across one command dispatch, so a credit that lands on a THIRD party (a
   * party fair-split to a non-acting looter) or outside any command (a tick
   * driven payout) is not booked here; see server/economy_telemetry.ts.
   */
  copperCredited(source: CopperFlowSource, amount: number): void;
  /** `amount` copper (always positive) debited from the acting player, same sampling. */
  copperSpent(source: CopperFlowSource, amount: number): void;
  /** One granted node harvest, counted under its node's zone band (R3) and the
   *  node's own tool tier (R31: a zone's tier-1 faucet and its tool-gated
   *  tiers are opposite sides of the same question). */
  harvest(band: HarvestBand, tier: HarvestTier): void;
  /**
   * One fishing cast started, counted under the water's zone and the effective
   * band the sim resolved for it. The denominator every other fishing rate is
   * read against, so it counts the CAST, not the session: a recast after a
   * got-away is a second cast.
   */
  fishingCast(zone: HarvestBand, band: FishingBandLabel): void;
  /**
   * One landed catch. `koi` additionally books the rare-koi counter, so the koi
   * series is a strict subset of the catch series and the R4 odds question is
   * one division, never a subtraction across two independently sampled totals.
   */
  fishingCatch(zone: HarvestBand, band: FishingBandLabel, koi: boolean): void;
  /**
   * One catch that got away: the reel window closed unpressed, the session
   * defensively timed out, or the landed catch found no bag room. All three
   * spent the cast and yielded nothing, which is what the series measures.
   */
  fishingGotAway(zone: HarvestBand, band: FishingBandLabel): void;
  /** One cast whose single table draw resolved the empty (itemId: null) row. */
  fishingEmptyHook(zone: HarvestBand, band: FishingBandLabel): void;
  /**
   * One rod recipe successfully trained, and therefore one training fee paid.
   * A COUNT, not an amount: the fee is static content per recipe
   * (rodFeeForRecipe), published beside the counter, so the copper is one
   * multiplication and cannot drift from what the trainer actually charges.
   */
  rodFeePaid(recipeId: string): void;
}

/** A sink that drops every signal; the slot default until boot wires the real one. */
export const noopGameMetricsCounters: GameMetricsCounters = {
  wsMessage() {},
  wsMessageDropped() {},
  wsRateKick() {},
  wsInputSeqGap() {},
  chatMessage() {},
  characterCreated() {},
  guildBankIncident() {},
  copperCredited() {},
  copperSpent() {},
  harvest() {},
  fishingCast() {},
  fishingCatch() {},
  fishingGotAway() {},
  fishingEmptyHook() {},
  rodFeePaid() {},
};

let activeCounters: GameMetricsCounters = noopGameMetricsCounters;

/**
 * Install the process-wide game-state counter sink. Called once at boot with the
 * exporter-backed implementation; tests install a recording fake and restore
 * noopGameMetricsCounters when done.
 */
export function setGameMetricsCounters(sink: GameMetricsCounters): void {
  activeCounters = sink;
}

/** The current game-state counter sink. Read at emission time, never captured at import. */
export function gameMetricsCounters(): GameMetricsCounters {
  return activeCounters;
}
