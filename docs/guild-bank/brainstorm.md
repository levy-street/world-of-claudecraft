# Guild Bank: brainstorm and architecture

## Vision
A classic-feel guild bank: walk to the banker, open the bank window, switch to the Guild
tab. Officers and the leader pool gold and items, and the guild collectively saves toward
slot expansions, which destroy copper (the gold sink). Everything is server-authoritative,
audited, and dupe-safe.

## Approved scope (user-confirmed)
- Officer+ only in v1: members neither see nor use the guild bank (the Guild tab does not
  render for them). Loosening this (member gold deposits) is an explicit v1.5 follow-up.
- One pooled container, NOT tabs/pages: 12 free base slots, then six treasury-funded
  expansions of 6 slots each (max 48 slots), on an escalating price table.
- Copper treasury with deposit/withdraw, hard-capped; deposits that would exceed the cap
  are refused, never truncated.
- Guild creation fee: 10 gold, charged at `guild_create`.
- Audit: every successful op writes a `bank_ledger` row with `container = 'guild'`.
- Disband is refused while the guild bank is non-empty (leader can always withdraw
  everything first, being officer+), so nothing is ever destroyed.

## Out of scope (do not build here)
- Member-visible bank, per-rank withdrawal limits, custom ranks, bank log UI window,
  multiple tabs, item sorting, remote access, any Claudium/premium interaction.

## The architecture decision (locked): the market/mail pattern
Money and items live inside the deterministic `Sim`; guilds live in the async server-side
`SocialService`. The repo has solved shared-container persistence twice already (market
listings, mail attachments): the book lives IN the sim, and every escrow (item leaves
`characters.state`, enters shared state) persists in ONE transaction
(`saveCharacterAndMarketState` in `server/db.ts`, with the character-lease fence in the
same statement). The guild bank follows that pattern exactly:
- The sim owns the guild bank books (keyed by guild id) and all gameplay rules (proximity,
  capacity, rank gate, prices, clamps). The server loads books at boot and saves the
  affected book in the same transaction as the acting character's state.
- The sim learns guild identity via a session-only server stamp: guild id + rank on
  `PlayerMeta`, set at join and on every membership/rank change, never serialized into
  `CharacterState`, excluded from the parity trace (the `bankBonusSources` precedent).
- Offline there is no stamp, so every guild bank op is a clean no-op and the UI never
  renders the tab (the `socialInfo === null` precedent).
Realms are separate processes and guilds are realm-scoped, so one guild's book lives on
exactly one running sim: the 20 Hz tick serializes concurrent members for free.

## Forward hooks the repo already reserved (honor these)
- `bank_ledger` DDL ships `container TEXT NOT NULL DEFAULT 'personal'` + `container_id
  BIGINT` with a comment reserving `'guild'` + guild id (`server/db.ts`).
- `tests/command_facets.test.ts` reserves `guild_bank_*` wire tokens and forbids reusing
  the personal `bank_*` tokens (state.md decision 16 of that packet).
- `moveBetweenContainers` in `src/sim/bank.ts` is documented and tested as the
  container-agnostic guild-bank seam (all-or-nothing, instanced stacks indivisible,
  mutates only on success).

## Reuse map
- `src/sim/bank.ts`: the whole personal-bank idiom (validation order, price-table lookup
  indexed by purchased count, `nearBanker` proximity, boundary-cloned info reads,
  `sanitizeBankState` as the one load path, never-destroy-items doctrine).
- `src/sim/bags.ts`: `countFit`, `addStacked`, `removeStacked`, `fitsAll`, stacking rules.
- `server/bank_ledger.ts`: `diffBankOp`-style pure diff + fire-and-forget FIFO recorder;
  `scripts/bank_audit.mjs` replay.
- `src/sim/pvp/honor.ts`: the clamp idiom for the treasury cap.
- Trade (`src/sim/social/trade.ts` `tradeConfirm`): final re-validation before mutation,
  scratch-copy capacity checks, atomic mutation block.
- `server/social_db.ts` `createGuildWithLeader`: the transactional BEGIN/ROLLBACK idiom.
- Wire chain template: `online.ts` stub, allowlist, shape-check dispatch, sim delegate,
  proximity-gated `maybe('bank', ...)` snapshot, facet tag, `IWorldBank` facet file.

## Known risks
- Dupe/vaporize on crash: the whole reason for the single-transaction escrow. Phase 3 is
  the critical phase; `migration-safety` and `database-performance-reviewer` both dispatch.
- Copper overflow: `meta.copper` has no clamp anywhere; the treasury cap plus
  refuse-not-truncate closes the new surface. Withdrawals must also respect the (unlikely)
  case of a withdrawal overflowing a player's own copper; refuse, never wrap.
- Stale rank: a kick/demote while standing at the banker must cut access on the next op
  (the stamp updates synchronously with the server-side membership change) and stop the
  snapshot stream.

## Open questions
None blocking. Deferred design notes: v1.5 member gold deposits; a bank log window reading
`bank_ledger`; per-rank rules arrive only with the custom-ranks feature.
