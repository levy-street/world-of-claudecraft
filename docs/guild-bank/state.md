# Guild Bank: cross-phase state

Current phase: Phase 4 QA complete, plus the 2026-08-03 audit-trail hardening
(payer-side `bank_ledger` counterparty columns and three consolidation loose
ends) and the 2026-08-03 IN-GAME ACTIVITY LOG (the final feature slice: the
officer-visible read of the `bank_ledger` rows every op already wrote; see
progress.md). The packet is closed and the branch
is PR-ready (merged over origin/release/v0.34.0 at fbf4d35a1, full gate green).
Teardown of docs/guild-bank/ awaits the user's explicit confirmation.

## Locked design decisions
- Base `release/v0.34.0`, branch `feature/guild-bank`. PR A (`feature/guild-social-v1`)
  lands first; rebase this branch over the release branch after it merges (both touch
  `server/social.ts` / `server/game.ts` social wiring).
- Officer+ only (leader included): see, deposit, withdraw, buy expansions. Members get no
  snapshot data and no UI tab.
- Architecture: the market/mail pattern (sim owns the books; server stamps membership;
  escrow persistence in one transaction). See brainstorm.md for the full rationale.
- Access: banker NPC proximity (the personal-bank `nearBanker` gate), Guild tab inside the
  existing bank window. Offline: no-op everywhere, tab never renders.
- Refusal WORDING is direction-aware (2026-08-03): `guildBankPipeRefusal(slot, dir)`
  defaults to `'deposit'`; the refusal SET is direction-independent (the one dormant
  predicate), only the sentence changes. Deposit names the dimension
  (`error.guildBankQuestItem` / `error.guildBankSoulbound` / `error.guildBankNoTransfer`),
  withdraw speaks one line for all four (`error.guildBankWithdrawRefused`), because
  "you cannot store that" is false for a copy already in the book. The bags pre-empt
  voices the same keys.
- Item policy (revised in Phase 2 review; supersedes the original "quest items refused"
  line): the guild bank is an ANONYMOUS EXCHANGE PIPE (officer A deposits, officer B
  withdraws), so it carries the full World Market / Ravenpost pipe policy, not the
  personal bank's self-storage quest-only rule: quest, `soulbound`, `noMarketList`
  (covers the rift-gear family), and per-copy transfer locks
  (`isTransferLockedInstance`: armed `bindOnTrade` or bound `boundTo`) are ALL refused,
  in BOTH directions (withdraw refuses too, so a tampered/legacy row can never complete
  a laundering; the copy stays dormant in the book). Instanced stacks move whole
  (`moveBetweenContainers`); items are never destroyed by any load or refusal path.
- Disband refused while the bank holds any copper or item, AND (Phase 3 QA) while any
  session still holds an unflushed dirty mark for the guild's book: the guard proves live
  state only, and the cascade destroys the DURABLE row, so an unflushed emptying op must
  flush before a disband can pass (self-heals within one autosave interval).
- Creation fee ordering (REVISED by Phase 3 QA; supersedes the original create-then-charge
  line): RESERVE-AT-GATE. The fee is deducted synchronously at the guild_create dispatch
  gate, before any DB work, and refunded on every refusal arm (guildCreate returns the
  committed-success boolean; the error arm refunds too). The success arm consumes the
  reservation (create_fee ledger row + escrow save). Rationale: charging after the commit
  left a deterministic exploit (pipeline guild_create with a spend and found the guild for
  the clamped residue, or log out before the commit and pay nothing, unaudited); the new
  ordering's crash window loses at most the fee for at most one autosave interval, the
  right trade. At most one reservation per character; a refund whose founder already left
  is logged loudly for operator compensation.
- Ledger: same `bank_ledger` table, `container = 'guild'`, `container_id = guild id`, ops
  `deposit_gold | withdraw_gold | deposit | withdraw | buy_slots | open_bank | create_fee`
  plus the three non-player rows `admin_purge | escrow_deficit | counterparty_orphan`.
  Keep-forever retention re-affirmed with an explicit comment at the retention-sweep
  registration site in `server/main.ts` (it is the anti-dupe audit trail).
- BOTH SIDES OF EVERY GUILD OP ARE RECORDED (2026-08-03, audit-trail hardening;
  supersedes the receiving-side-only shape above). The container side alone made the
  guild replay self-consistent BY CONSTRUCTION, so it could never detect a mint that
  ends up in a player's purse, which is the shape of every dupe this feature had.
  `bank_ledger` gained `counterparty_copper_delta BIGINT` and `counterparty_count INT`,
  additive and NULLABLE WITH NO DEFAULT: NULL means NOT RECORDED (a pre-feature row, or
  any personal-container row, which never writes one) and the audit SKIPS those rather
  than reading absence as balance, because a `DEFAULT 0` would have turned every legacy
  row into a false all-clear. Signed from the acting character's point of view
  (negative means the purse/bags GAVE), stamped by `server/game.ts runGuildBankOp` from
  the same server-derived before/after snapshot pair the book side comes from, never
  from client data. The pure arithmetic is `server/guild_bank_counterparty.ts`
  (snapshot, movement, drain-stamp, orphan), which takes FROZEN snapshots on purpose:
  `PlayerMeta.inventory` is a live array, so a before/after pair holding it twice would
  difference every item movement to zero and pass everything silently.
  `scripts/bank_audit.mjs` checks `book side + counterparty side + sink = 0` per op
  (`counterparty_copper_imbalance` / `counterparty_item_imbalance`), where the sink is
  a ladder rung's price, the creation fee, or an operator purge's destroyed copy. Note
  that `copper_delta` is OVERLOADED and is not the book's movement for `open_bank` /
  `create_fee` (both record the PURSE payment), which is why the check derives
  `bookCopperDelta` and `copperSinkOf` per op rather than reading the column.
  Three ways the invariant defends itself rather than resting on convention:
  a purse/bags movement no row accounts for (the book did not move, OR the stamp left
  an undrained remainder) writes a `counterparty_orphan` row and counts the incident;
  a guild delta reaching the writer with no counterparty side at all counts
  `counterparty_unstamped` and logs at write time, so a future write site that forgets
  cannot hide behind an indistinguishable NULL in a keep-forever table; and the report
  names the count AND the highest id lacking a counterparty side, so a frozen
  historical gap is distinguishable from one a live write site is still growing.
  The audit resolves `bank_ledger` through `to_regclass` (search_path aware, the same
  relation its unqualified SELECT will read) and selects typed NULLs when the columns
  are absent, so a restored pre-migration `pg_dump` (the incident DEPLOY.md points the
  tool at) degrades into the skip path instead of dying, INCLUDING when another visible
  schema holds a same-named table. `create_fee`'s counterparty is the founder's ACTUAL
  purse movement, snapshotted at the reserve-at-gate charge, not derived from the
  charged amount: deriving it made the identity algebraically zero for every input, a
  check that could not fail and therefore read as coverage it did not have.
  `escrow_deficit` rows carry a DERIVED purse aggregate as a direction report and take
  no part in the balance identity (nothing moved under them); `counterparty_orphan`
  rows are excluded from the item, treasury, and ladder replays for the same reason.
  Both anomaly ops write `count` SIGNED, unlike every other op (which writes a positive
  magnitude with the direction in the op name): a reader assuming non-negative counts
  must exclude those two. No new read predicate, so no new index (the
  `server/concurrent_indexes.ts` seam is not involved).
- IN-GAME ACTIVITY LOG (2026-08-03, the final feature slice). The officer-only design
  means any officer can quietly drain shared property; every op already wrote its
  `bank_ledger` row, so the knowledge existed and only an operator could see it. The
  log is the SOCIAL TRUST MECHANISM that makes officer-only withdrawals defensible,
  not a reporting extra.
  - GATE: the BANK's own gate, reused verbatim (`sim.guildBankInfoFor(pid) !== null`:
    alive, officer-plus via `GUILD_BANK_RANKS`, book loaded, at a banker). A MEMBER is
    refused by exactly the predicate that denies them the bank itself, so the log can
    never be a side channel around the officer-only design. The guild id comes from the
    server's own membership STAMP, never from the request (there is no guild field on
    the wire). The gate is RE-CHECKED after the awaited read, because a demotion,
    leave, death or walk-away can land in that window; the answer reflects authority at
    DELIVERY time. `GameServer.guildBankLogGuildFor` is the one place that decides it.
  - SHOWN: `deposit | withdraw | deposit_gold | withdraw_gold | buy_slots | open_bank |
    create_fee | admin_purge`. HIDDEN, never leaving the server: `escrow_deficit` and
    `counterparty_orphan` (diagnostic anomaly rows about a conservation defect, not
    something a player did, and frequently wrong about who was involved). A CLOSED
    ALLOWLIST in SQL and re-stated independently client-side, so a new ledger op is
    invisible until somebody deliberately writes its sentence.
  - `admin_purge` IS SHOWN and names NOBODY (the decision the slice was asked to make):
    hiding it would leave an unexplained gap exactly where guild property vanished,
    which is worse, but its ledger character column is the escrow CARRIER, a bystander
    who neither ordered nor benefited from the removal, so naming them would accuse the
    wrong guildmate. The entry carries `actor: null` and renders "An administrator
    removed {count} {item}". Enforced twice (server projection + the pure core).
  - PRIVACY: `server/db.ts loadGuildBankLogRows` selects the narrowest column set that
    can render a sentence. No `account_id`, no `realm`, no `instance` payload, and
    `character_id` is resolved to a display NAME in the same statement, so no internal
    id ships either. Nothing account-scoped is in the row for a downstream projection
    bug to leak.
  - CACHING: the answer is identical for every officer, so it rides the cached-read
    seam (`server/cached_read.ts`) per guild: TTL 30s, single-flight (two officers
    racing a cold window share ONE query), stale-on-error, LRU-bounded at 256 entries.
    `KeyedCachedRead` MOVED from `server/discord_status_cache.ts` into `cached_read.ts`
    (re-exported there, so every existing caller and test keeps its import path): it is
    a generic, and a guild bank module importing the Discord module for it would be the
    wrong seam.
    Freshness does NOT rest on the TTL: `server/bank_ledger.ts recordGuildBankDeltas`
    busts the guild entry for every VISIBLE-op row it writes, at the ONE writer so a
    future write site cannot forget, and TWICE (immediately, and again once THAT CALL's
    own inserts have SETTLED, because a read racing the write would otherwise
    re-install a pre-op snapshot). The second bust chains on the promises that call
    enqueued, never the process-global FIFO `tail`: on a slow database the tail can be
    minutes long and the bust would land on an entry that is fresh by then. The two
    hidden anomaly ops do NOT bust (their rows are filtered in SQL, so the refresh
    would be provably identical, fired during a rollback storm).
  - THE COALESCING FLOOR (`GUILD_BANK_LOG_MIN_REFRESH_MS` = 2s), the database review's
    F1: a bust that DROPPED the entry made the cache useless in the one state it exists
    for. Any ledger write made the next read a query, and a guild actively working its
    bank is exactly when its officers open the log, so the TTL protected nothing; worse,
    dropping mid-flight orphaned the in-flight query and the next reader minted a second
    identical one, so the advertised single-flight property did not hold under the only
    write pattern that matters. A bust now MARKS the guild dirty with the earliest
    instant it may refresh and the installed value keeps serving until then; the next
    read past that instant does the dropping. Refreshes are capped at 0.5/s per guild
    however hard the guild is banked or watched, a repeat bust inside an open window is
    a no-op rather than a reset (so a burst cannot defer the refresh forever), and a
    bust with no entry at all leaves no mark (a cold mint sees the write anyway).
  - A guild lives on one realm process and every writer runs there, so the bust is
    COMPLETE rather than best-effort. That is a premise of the DEPLOYMENT, not a
    property of the code: two processes serving one realm would degrade to TTL-bounded
    staleness (graceful, never corruption).
  - THE READ'S OWN DEADLINE (`GUILD_BANK_LOG_TIMEOUT_MS` = 2s, set via
    `runWithStatementTimeout`, which LOWERS as well as raises). Intended cost is
    single-digit ms; the cost WITHOUT its index is a sequential scan of a keep-forever
    table, and at the 15s pool default about ten of those in flight would exhaust
    `DB_POOL_MAX_CLIENTS` and fail every login and autosave on the realm. That window
    is reachable now that the CONCURRENTLY builds run after listen.
  - OBSERVABILITY: `woc_guild_bank_log_cache{kind}` (reads / refreshes / evictions /
    busts / entries / dirty_guilds) through the existing `GameStateSource` gauge seam,
    read at scrape time and never CONSTRUCTING the cache (the discordStatusCacheStats
    precedent). The REFRESH count is the number the whole design rests on. Plus a tenth
    `GUILD_BANK_INCIDENTS` kind, `log_read_failed`, because the refusal frame a player
    receives is byte-identical for "not an officer" and "the query failed".
  - INDEX (supersedes the deferral recorded under "Accepted risks": the trigger was
    "a per-guild reader exists" and this IS that reader). `bank_ledger_container_recent
    ON bank_ledger(container_id, id DESC) WHERE container = 'guild'` through the
    post-boot `server/concurrent_indexes.ts` CONCURRENTLY seam, never boot DDL
    (bank_ledger is large, live, and keep-forever). Three deliberate choices:
    `id DESC` trails, because indexing the equality alone still sorts a guild's whole
    history to find its newest 50 (measured on 400k rows: the equality-only index still
    loses to a backward primary-key scan at 252 shared buffers / 1.35ms, while the
    ordered form is 56 buffers / 0.20ms); `id` not `created_at`, because BIGSERIAL
    cannot tie; and PARTIAL, because `container` is a two-value discriminator this
    reader only ever passes `'guild'` for, so a full index would carry an entry for
    every personal-bank row (the large majority of the table) as permanent write
    amplification for a query that can never ask for one. `op` deliberately stays OUT:
    a ScalarArrayOpExpr on a middle column would forfeit the ordering guarantee the
    trailing `id DESC` exists for, and as a trailing Filter it costs only the
    suppressed rows.
  - THE CONCURRENT BUILDS MOVED OFF THE PRE-LISTEN PATH (`runConcurrentIndexMigrations`,
    split out of `ensureSchema` and called after `server.listen`). They serialize across
    realm processes on the schema advisory lock, and a concurrent build on a table this
    size is two heap scans plus a wait for every transaction that could see it: held
    before listen, a rolling restart paid that stall on every realm at once and none of
    them served players meanwhile. A slow build must delay the INDEX, not the realm.
    The trade, made explicit: a realm can now briefly serve a reader whose index does
    not exist yet, which is why this read carries its own 2s deadline. Failure is loud
    and NOT fatal (every entry is idempotent and drops its own INVALID carcass, so the
    next boot retries; a realm already serving players must not be killed by an index
    build).
  - WIRE: `guild_bank_log` (a pure READ token, no mutation) answered on its own
    one-shot `{ t: 'gbanklog', ok, entries }` frame, NEVER a snapshot key: the payload
    is cold, identical per guild, and 50 rows wide. `GUILD_BANK_LOG_LIMIT = 50`.
    Shares the existing `consumeGuildBankOp` guard rather than growing a second bucket.
  - FACET: ONE new `IWorldGuildBank` member, `guildBankLog(): GuildBankLogView`. A
    METHOD because READING IT IS WHAT REQUESTS IT (there is no snapshot key).
    Idempotence is the send-time gate (`guildBankLogAt`), not an in-flight flag: a
    repaint inside `GUILD_BANK_LOG_TTL_MS` (10s) sends nothing, and a request whose
    answer never arrived ages out on the same clock into exactly one retry, so a
    dropped frame cannot wedge the pane on loading. A background refresh keeps serving
    the installed rows; a REFUSAL keeps saying refused rather than degrading to an
    empty log. Losing the `guildBankInfo` mirror RESETS it (the rows belong to a guild
    and a rank this client may no longer hold). Offline returns a frozen empty ready view.
  - THREE STATES ARE THREE RENDERINGS, deliberately: loading, refused, empty. "You may
    not read this" and "nobody has done anything" are opposite facts, and a drained
    bank must never be able to look like an untouched one because a frame went missing.
  - UI: a Contents / Log sub-strip inside the Guild pane (its own `gbank-view-tab`
    class, NOT `.bank-tab`, because the outer strip is wired by querying `.bank-tab`).
    `BankWindow.guildTabActive` now also requires the CONTENTS view, so a bag click on
    the reading surface cannot silently deposit. `lastRenderedGuildView` scopes the
    `.bank-scroll` restore per sub-view. The refresh signature's log arm is NULL unless
    the log view is open, which is what keeps "fetch on demand" from becoming a poll.
- Purse-paid rung 0 (2026-08-03, user-directed pricing redesign): the guild bank is no
  longer open by default. A new guild starts with a 0-slot bank; an officer OPENS it via
  the existing `guild_bank_buy_slots` token (no new wire surface: the sim decides which
  rung is next), paying rung 0's 90_000 copper from THEIR OWN PURSE, refusing purse-poor
  with the existing 'Not enough money.' line. The dispatch observer renames the op to
  `open_bank` (its own ledger op; `scripts/bank_audit.mjs` excludes it from the treasury
  replay like create_fee and pins purchased_slots_after 24), and
  `revertGuildBankDeltas`'s open_bank arm reverts ONLY the slot grant (never credits
  the treasury: the purse charge rolled back with the dead session's character half).
  Persistence shape unchanged (`purchasedSlots` already persists granted slots; the
  sanitize floor onto ladder positions makes any pre-feature/old-ladder row load
  sanely, and the no-row empty book now correctly means an UNOPENED bank). "Sanely"
  qualified: a pre-redesign row whose purchasedSlots sits below the opened base
  (the old ladder's 6/12/18) floors to 0, so that bank loads CLOSED and its paid
  expansions are not honored (items are still never destroyed: over-capacity is
  tolerated and withdrawal works once reopened). Acceptable ONLY because the
  feature has never shipped (no production rows exist, only dev-DB residue);
  landing such a floor against real data would instead need a migration mapping
  old positions onto the new ladder. Item
  deposit against the 0-capacity book refuses via the capacity check ('The guild bank
  is full.'); an unopened bank with 0 treasury never blocks disband (the guard counts
  copper and items only). UI: the Guild tab's 'unopened' view state renders the
  treasury section as normal plus an "Open the guild bank" row (purse-shortfall
  marker; enablement reads the PURSE for rung 0, the treasury for later rungs; the
  window's refresh signature adds the purse ONLY while unopened).

## Constants (single source of truth for the plan; land in `src/sim/guild_bank.ts`)
- `GUILD_CREATION_FEE_COPPER = 10_000` (1 gold; revised 2026-08-03, user-directed
  pricing redesign: was 100_000/10g). Pure constant change: the reserve-at-gate
  machinery, refund arms, and create_fee ledger row are untouched.
- `GUILD_BANK_EXPANSION_SLOTS = 6`.
- `GUILD_BANK_RUNG_SLOTS = [24, 6, 6, 6, 6, 6, 6]` and
  `GUILD_BANK_RUNG_PRICES = [90_000, 25_000, 50_000, 100_000, 250_000, 500_000,
  1_000_000]` copper (revised 2026-08-03, user-directed pricing redesign; supersedes
  the separate `GUILD_BANK_BASE_SLOTS = 24` free base and the 6-entry
  `GUILD_BANK_EXPANSION_PRICES`, both removed). A new guild's bank is UNOPENED
  (0 item slots; treasury gold ops work from day one and are NOT gated on the
  unlock): rung 0 (9g) OPENS the bank for the 24 base slots and is paid from the
  CLICKING OFFICER'S OWN PURSE (one-click classic first-tab precedent); rungs 1..6
  (2g50s..100g; 192g50s total) are the treasury-paid 6-slot expansions. Price is
  ALWAYS a table lookup indexed by bought-rung count, never client-supplied.
  `GUILD_BANK_LADDER_POSITIONS = [0, 24, 30, 36, 42, 48, 54, 60]` is the set of
  valid purchasedSlots values; sanitize floors onto it (max 60 slots).
- `GUILD_BANK_TREASURY_CAP = 1_000_000_000` copper (100,000 gold). Deposits that would
  exceed it are refused with an error, never truncated.

## New surface (names fixed now; ledger below tracks what actually landed)
- Sim module `src/sim/guild_bank.ts`: `GuildBankState { treasury, inventory, purchasedSlots }`,
  `guildBankCapacity`, `sanitizeGuildBankState`, `createEmptyGuildBankState`, op bodies as
  free functions over `SimContext`, `guildBankInfoFor`.
- `PlayerMeta` session-only stamp: guild id + rank (never serialized into
  `CharacterState`; excluded from the parity trace like `bankBonusSources`). Server stamp
  entry point beside `Sim.setPlayerGuild`.
- Facet `src/world_api/guild_bank.ts`: `IWorldGuildBank` with `guildBankInfo` (or the
  snapshot-fed equivalent mirroring `IWorldBank`) and the five commands; `GuildBankInfo`
  carries treasury, slots, capacity, purchasedSlots, nextExpansionPrice.
- Wire tokens (reserved by `tests/command_facets.test.ts`; never reuse `bank_*`):
  `guild_bank_deposit_gold {amount}`, `guild_bank_withdraw_gold {amount}`,
  `guild_bank_deposit {slot, count?}`, `guild_bank_withdraw {slot, count?}`,
  `guild_bank_buy_slots`.
- Snapshot: `maybe('guildBank', ...)` in the `server/game.ts` stream, proximity AND rank
  gated (null for members/away/offline); delta-key registry updated
  (`tests/snapshots.test.ts`).
- DDL (additive, idempotent, in the social/bank schema family): `guild_banks (guild_id INT
  PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE, realm TEXT NOT NULL, data JSONB NOT
  NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`. Boot-loaded per realm; the acting
  character's save and the touched book persist in ONE transaction with the lease fence
  (extend the `saveCharacterAndMarketState` family in `server/db.ts`).

## Non-negotiable constraints (from root CLAUDE.md)
- Sim purity and determinism: no DOM/Three/`Math.random`/`Date.now` in `src/sim/`; all the
  gameplay rules live in the sim; the server validates shape only.
- `IWorld` facet first, implemented in BOTH `Sim` (no-op offline) and `ClientWorld`;
  parity pin updated in `tests/world_api_parity.test.ts` in the same change.
- i18n: sim-emitted player text gets `src/ui/sim_i18n.ts` matcher rows in the SAME change
  (S3 guard `tests/localization_fixes.test.ts`); UI strings are English-only catalog keys;
  money renders through the i18n `formatMoney`, sim emits through `src/sim/format_money.ts`.
- No refusal path mutates anything. Validation order follows the bank/vendor idiom:
  resolve, dead check, proximity, shape, policy (rank, quest-bind), price from table,
  affordability, capacity on scratch, then mutate, then events/ledger.
- No em dashes, en dashes, or emojis. Conventional Commits with scope + body. Explicit
  paths, never `git add -A`.

## Validation matrix
- sim-only: `npx tsc --noEmit` + `npx vitest run tests/guild_bank.test.ts
  tests/architecture.test.ts` (+ determinism assertions in the new suite).
- wire: add `npx vitest run tests/command_schema.test.ts tests/command_facets.test.ts
  tests/snapshots.test.ts tests/world_api_parity.test.ts tests/bandwidth.test.ts`.
- server/persistence: add the new round-trip suite + `npx vitest run
  tests/bank_ledger.test.ts tests/social_system.test.ts` + `npm run build:server`.
- ui: `npx tsc --noEmit` + `npx vitest run tests/localization_fixes.test.ts` + the new
  view-core suite + a mobile screenshot script.
- any code change: `npm run ci:changed`; pre-merge: `npm run gate`.

## Key existing paths
- `src/sim/bank.ts`, `src/sim/bags.ts`, `src/sim/format_money.ts`, `src/sim/sim_context.ts`
  (append-only seam), `src/sim/sim.ts` (`setPlayerGuild`, guild no-op stubs, `addPlayer`
  join stamping), `src/sim/social/trade.ts` (`tradeConfirm`).
- `server/game.ts` (dispatch, allowlist, `maybe('bank', ...)` stream, join path,
  `guild_create` dispatch), `server/social.ts` (rank changes to hook for re-stamping),
  `server/db.ts` (`SCHEMA`, `bank_ledger`, `saveCharacterAndMarketState`,
  `insertBankLedgerRow`), `server/bank_ledger.ts`, `server/main.ts` (retention `tables:`).
- `src/net/online.ts` (command stubs, snapshot decode), `src/world_api.ts`
  (`COMMAND_NAMES`, `COMMAND_FACETS`), `src/world_api/bank.ts` (facet template).
- `src/ui/` bank window family + `src/ui/sim_i18n.ts`.
- Tests: `tests/bank.test.ts`, `tests/command_facets.test.ts`, `tests/snapshots.test.ts`,
  `tests/world_api_parity.test.ts`, `tests/bank_ledger*.test.ts`, `tests/bank_audit.test.ts`.

## Ledger (fill in as phases complete)
- Phase 1 files / IWorld members / pins updated:
  - New: `src/sim/guild_bank.ts` (constants, `GuildBankState`, `GuildRank`,
    `GuildMembership`, `guildBankCapacity`, `guildBankNextExpansionPrice`,
    `createEmptyGuildBankState`, `sanitizeGuildBankState`, `loadGuildBank`,
    `serializeGuildBank`, `stampGuildMembership`); `src/world_api/guild_bank.ts`
    (`GuildBankInfo`, `IWorldGuildBank`); `tests/guild_bank.test.ts`.
  - `src/sim/sim.ts`: `PlayerMeta.guildMembership` (session-only, null offline),
    `Sim.guildBanks` map, host-literal `guildBanks` getter, delegates
    `setPlayerGuildMembership` / `loadGuildBank` / `serializeGuildBank`, offline
    facet no-ops (`guildBankInfo: null` + five inert commands).
  - `src/sim/sim_context.ts`: `guildBanks` view (append-only) + factory binding.
  - `src/net/online.ts`: `guildBankInfo: null` mirror + five inert command stubs
    (no wire sends; tokens are Phase 2).
  - `src/world_api.ts`: facet map row, import, `extends IWorldGuildBank`,
    `GuildBankInfo` re-export. No `COMMAND_NAMES`/`COMMAND_FACETS` changes.
  - IWorld members added (6): `guildBankInfo` (data), `guildBankDepositGold`,
    `guildBankWithdrawGold`, `guildBankDeposit`, `guildBankWithdraw`,
    `guildBankBuySlots` (methods).
  - Pins updated: `tests/world_api_parity.test.ts` (IWORLD_MEMBERS + three sorted
    sets, `FACET_GUILD_BANK` + exhaustiveness, registry, facet count 31, member
    counts 282/72/210); `tests/parity/trace.ts` `META_EXCLUDE` + `guildMembership`;
    `tests/parity/harness.test.ts` pinned exclusion list; SimContextHost fixtures in
    `tests/sim_context.test.ts` (+ live-view case) and `tests/entity_roster.test.ts`;
    `src/sim/CLAUDE.md` module table row.
  - Phase 1 QA drift: `loadGuildBank` is LOAD-ONCE (skip when the book is live;
    evict-then-load to reload); `serializeGuildBank` null means SKIP the write;
    `tests/architecture.test.ts` now bans `server/` imports from `src/sim/`;
    `tests/guild_bank.test.ts` grew (sanitizer lockstep pin vs
    `sanitizeBankState`, craftedRecipeId, inert-facet pins in both worlds);
    `docs/guild-bank/phase-02-qa.md` carries the Phase 1 acceptance lines.
- Phase 2 wire tokens / dispatch cases / sim_i18n rows:
  - Tokens appended to `COMMAND_NAMES` (append-only, end of table):
    `guild_bank_deposit_gold {amount}`, `guild_bank_withdraw_gold {amount}`,
    `guild_bank_deposit {slot, count?}`, `guild_bank_withdraw {slot, count?}`,
    `guild_bank_buy_slots`; all five tagged `IWorldGuildBank` in
    `COMMAND_FACETS` (+ the `WorldFacet` union member).
  - `src/sim/guild_bank.ts` op section: `requireOfficerBook` (shared gate),
    `guildBankDepositGold`, `guildBankWithdrawGold`, `guildBankDeposit`,
    `guildBankWithdraw`, `guildBankBuySlots`, `guildBankInfoFor`; imports
    `nearBanker` + `moveBetweenContainers` from `bank.ts` (nearBanker now
    exported) and `formatMoney`. Missing-book refusals are SILENT (never
    lazily create a book: load-once shadow hazard).
  - `src/sim/sim.ts`: pid-first server entry points `guildBankDepositGoldFor`,
    `guildBankWithdrawGoldFor`, `guildBankDepositFor`, `guildBankWithdrawFor`,
    `guildBankBuySlotsFor`, `guildBankInfoFor`. The IWorld facet arm stays
    inert (offline no-guild, locked decision).
  - `server/game.ts`: five shape-only dispatch cases (after the bank_* cases);
    `maybe('guildBank', sim.guildBankInfoFor(pid))` beside `maybe('bank')`;
    HEAVY_SELF_CMDS += the two gold + two item commands (NOT buy_slots);
    `ClientSession.guildStampSeq` fence; `sendSocialSnapshot` stamps the
    setPlayerGuild + setPlayerGuildMembership PAIR behind the fence check;
    transport `onGuildMembershipChanged` combined stamp entry point.
  - `server/social.ts`: `SocialTransport.onGuildMembershipChanged`; synchronous
    calls at guildCreate, guildAccept, guildLeave (both arms), guildKick,
    guildSetRank, guildTransferLeader (both rows), guildDisband (every member).
  - `src/net/online.ts`: five real sends; `s.guildBank` decode into
    `guildBankInfo` (delta contract).
  - sim_i18n rows (English-only, no overlay edits): `error.guildBankNoGuild`,
    `error.guildBankRank`, `error.guildBankFull`, `error.guildBankSoulbound`,
    `error.guildBankNoTransfer`, `error.guildBankTreasuryCap`,
    `error.guildBankTreasuryShort`, `error.guildBankCarryCap`,
    `error.guildBankCannotAfford`, `error.guildBankMaxSlots`,
    `log.guildBankSlotsPurchased`, `log.guildBankDepositGold`,
    `log.guildBankWithdrawGold`, `log.guildBankDepositItem`,
    `log.guildBankWithdrawItem` + 4 RULES (money verbatim, items via locItem).
    Reused strings: bankTooFar, bankQuestItem, 'Not enough money.',
    bagsFullError ('You are not in a guild.' also resolves via server_i18n
    guild.notInOne; the sim emit owns its own EXACT row).
  - Review-driven (Phase 2 review, all three reviewers): the anonymous-pipe
    item policy (`guildBankPipeRefusal`, both directions); ops take a REQUIRED
    pid (no local-player fallback to fail open into); the two gold commands
    left HEAVY_SELF_CMDS (copper rides the always-sent base self);
    `tests/guild_stamp_fence.test.ts` pins the guildStampSeq fence against a
    real GameServer with a deferred snapshot (mutation-checked decisive);
    deeds banker-business credit is personal-bank-scoped BY DESIGN (module
    header comment); `guildBankInfoFor` ships full payloads BY DECISION
    (locked copies can never enter the book, so publicInstanceView's hidden
    fields are unreachable); `src/sim/CLAUDE.md` row updated.
  - Pins updated: `tests/command_schema.test.ts` (send 179, dispatch 190),
    `tests/command_facets.test.ts` (GUILD_BANK_TAGS block),
    `tests/snapshots.test.ts` (63 delta keys, `guildBank: 'guildBankInfo'`,
    dirty fixture + round-trip assertion), `tests/localization_fixes.test.ts`
    (guild_bank.ts on the S3 scan list), `tests/parity/trace.ts` (exclusion
    re-audit comment), `tests/guild_bank.test.ts` (ClientWorld pin
    flipped to the five exact payloads), `tests/social_system.test.ts`
    (FakeTransport.membershipStamps recorder + per-site stamp suite).
  - Phase 2 QA drift (fresh auditor, PASS-WITH-FOLLOWUPS):
    - `SocialDb.setGuildRank(charId, guildId, rank)` now predicates on the guild
      too and RETURNS whether a row moved; `guildSetRank` refuses (and stamps
      NOTHING) when it did not. The old signature stamped a rank the DB refused
      whenever a promote raced a leave/kick/disband/guild-switch, which the
      guild bank's officer gate then honored with no corrective push. Any new
      membership write must follow the same rule: confirm the row, then stamp.
    - The officer gate is a POSITIVE allowlist, `GUILD_BANK_RANKS`
      (`{leader, officer}`), shared by `requireOfficerBook` AND
      `guildBankInfoFor`. A rank added to `GUILD_RANKS` is DENIED until the
      allowlist is deliberately revisited (swept per rank + a future-rank arm).
    - `guildBankInfoFor` projects a pipe-REFUSED slot through
      `publicInstanceView` (`guildBankSlotView`) instead of shipping the whole
      payload. The old full-payload ruling only held for the deposit path; a
      tampered/legacy row arrives via `sanitizeGuildBankState`, which does not
      filter locks. Allowed slots still ship full payloads (charges).
    - Ops guard the required pid at RUNTIME (`resolveActor`), because
      `Sim.resolve(undefined)` falls back to the local player.
    - `error.guildBankNoGuild` is now 'You must be in a guild to use the guild
      bank.': the bare 'You are not in a guild.' duplicated `server_i18n`'s
      `guild.notInOne`, which the hud matcher resolves FIRST (the sim row was
      dead while shipping a second divergable locale copy). Reused-string note
      in the Phase 2 ledger above is superseded for this one row.
    - New pins: dispatch ROUTING (each token to its own entry point with its
      argument order, plus shape rejects) and the fence's APPLY arm, both in
      `tests/guild_stamp_fence.test.ts`; cross-guild isolation, the future-rank
      arm, the locked-slot projection, the four-dimension withdraw pipe sweep,
      and malformed-count negatives in `tests/guild_bank.test.ts`.
- Phase 3 DDL / db functions / ledger ops / fee wiring:
  - DDL: `guild_banks` appended to `SOCIAL_SCHEMA` (`server/social_db.ts`), exactly the
    state.md shape (PK guild_id REFERENCES guilds ON DELETE CASCADE, realm TEXT NOT
    NULL with no default, data JSONB NOT NULL, updated_at). Pinned in
    `tests/guild_bank_db.test.ts`; proven valid + idempotent against real Postgres.
  - db functions (`server/db.ts`): `characterUpdateStatement` (the ONE fenced character
    UPDATE, shared by the whole save family), `saveCharacterAndGuildBankState`
    (character + books, one transaction, lease fence, false on fence miss),
    `saveCharacterAndMarketState(..., guildBanks?)` (additive trailing param for the
    leave flush), `writeGuildBankRow` (the only guild_banks write statement, fence-side
    only), `loadGuildBankRows()` (realm LEFT JOIN, size bound in SQL), constants
    `GUILD_BANK_ROW_MAX_BYTES` (262144); `BankLedgerRow` widened: ops +=
    `deposit_gold | withdraw_gold | create_fee`, container `'personal' | 'guild'`,
    containerId `number | null`.
  - Host glue: `server/guild_bank_state.ts` (`loadGuildBanksIntoSim` with has()
    verification and the oversized SKIP, `collectGuildBankSaves` with the
    null-serialize skip). Boot call `GameServer.loadGuildBanks()` awaited in `main.ts`
    before listen. Session state: `ClientSession.dirtyGuildBanks` (guildId -> seq),
    seq-guarded release in `saveCharacter`; book serialization happens at write time
    inside the market serial writer.
  - Ledger ops (`server/bank_ledger.ts`): `GuildBankLedgerOp`
    (`deposit_gold | withdraw_gold | deposit | withdraw | buy_slots`), pure
    `diffGuildBankOp` + `recordGuildBankDeltas` (+ `guildCreateFeeDelta`), shared FIFO
    tail, container='guild', container_id = guild id, purchased_slots_after from the
    AFTER book (0 for create_fee). Gold ops carry the TREASURY delta; create_fee the
    founder's purse and is excluded from the audit treasury replay.
    `scripts/bank_audit.mjs`: guild rows group per GUILD, treasury replay, new shape
    checks (`item_on_gold_op`, `bad_gold_delta`, `nonnegative_create_fee`,
    `slots_on_create_fee`, `gold_op_outside_guild`, `missing_container_id`,
    `negative_treasury`, `treasury_mismatch`), `guild_banks` reconciliation
    (`auditBank({..., guildBanks?})`); personal report unchanged. Keep-forever comment
    at the `server/main.ts` retention `tables:` site.
  - Fee wiring: dispatch gate in `server/game.ts` `guild_create` (refuse-poor before
    any DB work; literal derived from `GUILD_CREATION_FEE_COPPER` via a `goldAmount`
    local so the S3 probe matches the RULE); transport hook
    `SocialTransport.onGuildCreated` fired in `guildCreate`'s success arm right after
    the founder stamp (seed empty book -> `chargeGuildCreationFeeFor` -> create_fee row
    -> escrow save). Disband: `guildBankHoldings` transport read (fail-closed on null)
    guards `guildDisband`; `onGuildDisbanded` evicts via `Sim.evictGuildBank`.
  - Sim additions (`src/sim/guild_bank.ts` + facade): `evictGuildBank`,
    `guildBankHoldings`, `chargeGuildCreationFee` (clamped, silent, no rng).
  - i18n: `guild.createFee` (parameterized, + RULES row) and `guild.bankNotEmpty`
    (exact) in `src/ui/server_i18n.ts` (14 blocks) and `server_i18n.newlocales.ts`
    (8 blocks); byte-bound sample pins in `tests/server_i18n.test.ts`.
  - Phase 3 QA drift (fresh auditor; fixes landed as four fix commits on top of
    4a7d3c2b6):
    - `SocialService.guildCreate` returns `Promise<boolean>`: true ONLY on the committed
      success arm (after `onGuildCreated` consumed the fee reservation); false on every
      refusal. The dispatch gate charges the fee synchronously BEFORE calling it
      (reserve-at-gate, see the revised locked decision above) and refunds on
      false/throw via `GameServer.refundGuildCreateFee` + `Sim.refundGuildCreationFeeFor`;
      `pendingGuildCreateFees` (character id -> reservation) allows one in-flight create
      per character and is consumed exactly once by success OR refund.
    - New sim surface: `revertGuildBankDeltas` / `refundGuildCreationFee` free functions
      (+ facade delegates) and the `GuildBankOpDelta` type; `BankOpDelta` (server) gained
      optional `craftedRecipeId`, populated for guild item deltas only (not a ledger
      column; the revert path restores provenance with it).
    - `ClientSession.unflushedGuildBankOps` mirrors `dirtyGuildBanks` with the actual
      deltas; the escrow save consumes the committed prefix per guild; every guild bank
      mutation MUST flow through `runGuildBankOp` so the log stays complete (a mutation
      that bypasses the observer breaks the revert guarantee AND the ledger).
    - `reconcileFencedOutGuildBooks` renamed `reconcileUnflushableGuildBooks`; it also
      runs from the exhausted leave flush, scans `sessionsByCharacterId` (not `clients`,
      which loses mid-leave sessions), and its another-session-dirty arm REVERTS the dead
      session's deltas instead of skipping.
    - The transport `guildBankHoldings` fails closed (null) while ANY session holds an
      unflushed dirty mark for the guild; both guild-deleting guards inherit it.
    - `onGuildDisbanded` clears every session's dirty mark AND unflushed-op log (pinned).
    - Escrow snapshot consistency (the database-review BLOCKING): `saveCharacter`
      re-serializes the character INSIDE the queued serial-writer thunk (applyFixups +
      fresh serialize) so both escrow halves capture ONE instant; an op dispatched
      during the queue wait can no longer land in both halves (deposit) or neither
      (withdraw). Covers the market sibling's same latent shape.
    - Hot-path bounds: `server/guild_bank_op_guard.ts` (burst 10, refill 2/s, drops
      tally into the abuse window; WS_DROP_CAUSES += 'guild_bank', pins updated);
      `GUILD_BANK_UNFLUSHED_OP_CAP` = 500 per guild per session (overflow drops the
      surgical revert: `revertLostGuildBanks` forces the evict-and-reload arm);
      reconcile reads retry 3x like the boot load; `loadGuildBankRows` keyset-batches
      (`GUILD_BANK_BOOT_BATCH` = 500) with ONE octet_length evaluation (LATERAL) on the
      heavy statement allowance and surfaces `dataBytes` (soft size warn at a quarter
      of the hard bound); `collectGuildBankSaves` sorts ascending (global row-lock
      order); the shared market writer warns at queue depth 16.
    - Revert-path provenance (the architecture review): the guild differ keys slots by
      itemId + instance + craftedRecipeId (`countByGuildKey`; the personal `slotKey`
      keeps two dimensions), the deposit-undo matches all three dimensions, the
      withdraw-undo grants through `addStacked` (stack caps + provenance-keyed merge),
      and instance equality is canonical sorted-key JSON (a JSONB round trip reorders
      keys). The sim/server op vocabularies are pinned in lockstep both ways.
    - The fee gate refuses (and refunds) a SHORT charge (`charged <
      GUILD_CREATION_FEE_COPPER`): a meta-only pid can never found a free or
      discounted guild.
- Phase 4 UI modules / i18n keys / screenshots:
  - New pure core `src/ui/guild_bank_view.ts` (UI_PURE_CORES): `buildGuildBankView`
    (GuildBankInfo -> render model: slot rows with `known` + `dormant` flags, capacity,
    RAW-copper treasury with purse-free gold enablement, expansion price + affordability,
    `hasDormant`), `guildBankSlotDormant` (the client pipe-predicate mirror: quest /
    soulbound / noMarketList / isTransferLockedInstance; unknown def is NOT dormant, the
    sim allows the recovery withdraw), `guildBankSlotAction` (dormant always plain
    withdraw, never the split prompt), `coinFieldsToCopper`, `guildBankGoldDepositMax`,
    `guildBankGoldWithdrawMax`, `clampGoldAmount`. Money formats at the PAINTER boundary
    (i18n formatMoney/moneyHtml); the core stays i18n-free per the UI_PURE_CORES scan.
  - New cold pane painter `src/ui/guild_bank_window.ts` (UI_DOM_MODULES): `GuildBankTab`,
    composed by `BankWindow`; renders capacity, treasury row (deposit/withdraw money via
    mailbox-idiom g/s/c coin prompts), the slot grid (dormant slots dimmed + dashed +
    lock mark + own aria + always-visible legend line, NEVER hidden; unknown-id slots
    render a localized unknown label and stay withdrawable), and the buy row (treasury
    price, never affordability-disabled, visible "Treasury short" text marker,
    "Paid from the guild treasury" note). Prompts reuse BankWindow.installPromptDialog
    (injected) and the .bank-quantity-prompt / .bank-buy-prompt classes so
    BANK_PROMPT_SELECTOR teardown covers them.
  - `src/ui/bank_window.ts`: Personal/Guild tab strip via the shared
    tab_strip_view/tab_strip_painter cores, rendered ONLY while guildBankInfo is
    non-null; tab falls back to Personal on the same paint when the info nulls; close()
    resets to Personal; the ONE refresh signature gained the guild arm (treasury,
    capacity, purchasedSlots, nextExpansionPrice, slots; deliberately purse-free);
    `restoreScroll` scopes the .bank-scroll offset to one pane (scrollTop allowance
    stays 4); `guildTabActive` getter feeds the bags mode wiring.
  - Bags deposit routing: `BagMode.guildBankDeposit` (bags_view.ts arms
    `guildBankDeposit` + three pre-empt denies voicing the exact sim lines:
    error.bankQuestItem / error.guildBankSoulbound / error.guildBankNoTransfer);
    bags_window.ts consumer (`isGuildBankTab` dep, at most one bank mode active,
    showDepositQuantityPrompt gained a 'bank'|'guild' target); hud.ts wires
    `isGuildBankTab: () => this.bankWindow.guildTabActive`.
  - i18n: 21 new `hudChrome.bank.*` keys (tabsAria, personalTab, guildTab,
    guildCapacityAria, guildEmpty, guildTreasury, guildDepositGold, guildWithdrawGold,
    guildDepositGoldTitle, guildWithdrawGoldTitle, guildGoldAvailable, guildBuyConfirm,
    guildBuyNote, guildTreasuryShort, guildDormantNote, guildDormantHint,
    guildDormantAria, guildUnknownItem, guildDepositHint, guildCannotDeposit,
    guildGoldCannotMove), en-only domain + the five M16 non-Latin fills
    (zh_CN/zh_TW/ja_JP/ko_KR/ru_RU overlays); the withdraw/deposit prompt bodies REUSE
    the personal keys; no sim/server emits changed (no new sim_i18n rows needed).
  - Review-driven (Phase 4 reviews, both reviewers): `src/ui/bank_quantity_prompt.ts`
    (UI_DOM_MODULES), the ONE quantity-prompt builder behind the bank withdraw, guild
    withdraw, and bags deposit prompts; the gold prompt follows the sim's
    refuse-and-keep semantics (over-purse -> 'Not enough money.', over-headroom ->
    error.guildBankTreasuryCap, inline polite live-region line, never a clamp-down;
    withdraw clamps to the visible treasury BY DESIGN); the plain-click withdraw
    carries the same identity guard as the prompt submit; `guildTabActive` also
    requires a live guildBankInfo; `src/sim/guild_bank.ts` exports
    guildBankPipeRefusal FOR THE PARITY PIN ONLY (no host calls it; zero behavior
    change), swept against guildBankSlotDormant over the whole item table in
    tests/guild_bank_view.test.ts; tests/bags_guild_deposit_routing.test.ts pins the
    guild-tab bag-click dispatch behaviorally.
  - Styles: .bank-tabs/.bank-tab (soc-tabs mirror), .gbank-treasury*, .gbank-gold-btn,
    .gbank-dormant* (grayscale + dashed + lock mark + legend), .gbank-unknown*,
    .gbank-buy-*, .gbank-coin-row inside the components.css bank banner section BEFORE
    the .bank-bonus block (that block's no-hex scan slices to the docking comment);
    hud.mobile.css adds the 40px touch floor for .bank-tab/.gbank-gold-btn.
  - Tests: tests/guild_bank_view.test.ts (model, dormant per dimension, projection-gap
    pin, boundaries, gold math, Sim-vs-ClientWorld parity), tests/guild_bank_window.test.ts
    (jsdom-driven REAL BankWindow: tab visibility per state, fallback on null, close
    reset, dormant rendering, every action round-trip, prompt teardown); pins updated in
    tests/architecture.test.ts (both registries), tests/bags_view.test.ts (mode cascade),
    tests/bags_window.test.ts (mode wiring), three bags fixture suites,
    tests/language_fanout_registry.test.ts (bank_window memos += lastRenderedTab).
  - Screenshots: docs/screenshots/guild-bank-tab/ (before-desktop/mobile at the Phase 3
    base; after-desktop-personal/guild, after-desktop-guild-full, after-mobile-personal/
    guild online via scripts/guild_bank_tab_shot.mjs, STAGE=offline/online; the offline
    stage doubles as the offline-sees-only-Personal proof).
  - Known client-side gap, BY DESIGN (pinned in tests/guild_bank_view.test.ts): a
    dormant slot whose ONLY refusal dimension was a per-copy transfer lock arrives with
    publicInstanceView-stripped lock fields, so the client cannot flag it; it renders as
    an ordinary slot and its withdraw round-trips to the sim's localized refusal. Every
    def-level dormant dimension (the realistic content-update vector in the v1
    limitation) and every unknown-id row renders visibly distinct.
  - Phase 4 QA drift (fresh auditor; fixes landed as two commits on top of the
    release merge):
    - Focus across repaints: render() no longer blanket-refocuses the close button.
      BankWindow.restoreControlFocus re-lands focus via the shared focus_restore
      ladder (captureFocusKey before the wipe; data-focus-key on the tab buttons
      ('tab:personal'/'tab:guild', annotated after the shared strip mounts), grid
      cells ('gbank:slot:<index>'), gold buttons, and the buy button; [data-close]
      is the fallback and disabled controls are skipped). The guild refresh arm
      repaints on ANY officer's op, so this is what keeps strangers' ops from
      yanking a keyboard user. ALL key annotation lives in
      BankWindow.annotateGuildFocusKeys (stamped after renderInto returns, cells
      keyed by DOM order which IS slot order): the release-merged guard in
      tests/focus_restore.test.ts pins a single-reader rule for the
      data-focus-key namespace, so the pane never touches it.
    - The gold prompt refusals go through voiceRefusal (clear-then-append a fresh
      child node) so a repeated identical refusal re-announces to AT; renderInto
      takes the GuildBankViewModel BankWindow already built (one core call per
      paint); the dead api() helper left scripts/guild_bank_tab_shot.mjs.
    - New decisive pins (tests/guild_bank_window.test.ts unless noted): the
      guildTabActive live-info conjunct WITHOUT a repaint (mutation-checked); the
      external-repaint focus test; deposit-disabled at the treasury cap; the
      affordable-arm buy-marker negative; zero-submit dismisses silently; the
      refusal line's role=status + aria-live=polite; the zero-headroom withdraw
      refusal (guildGoldCannotMove); the hostile-item-id escape pin (esc() in the
      tooltip path); hud.mobile.css guild touch-floor presence pins; the
      unknown-cell withdraw click; the dormant parity sweep's vacuity guard
      (tests/guild_bank_view.test.ts); the pre-empt deny lines cross-pinned to
      guildBankPipeRefusal's literal returns
      (tests/bags_guild_deposit_routing.test.ts). tests/bank_window.test.ts's
      render-body source pin follows the new focus-ladder shape.
- Release merge (2026-08-03): origin/release/v0.34.0 (17e5ba027) merged as
  fbf4d35a1. Pin values on the merged tree: COMMAND_NAMES carries the release's
  dev_profiler_invulnerable BEFORE the five guild_bank_* tokens (both appended;
  send 179 / dispatch 191 / dispatch-only 12); IWorld is 283 members (73 data,
  210 methods; the release re-added riftCollisionToken). The repo is now pnpm
  (pnpm install --frozen-lockfile; vitest's fsModuleCache needed one
  --clearCache after the node_modules re-layout). Generated i18n resolved
  artifacts were regenerated via npm run i18n:gen, never hand-merged.
  release-merge-audit: clean (no branch-owned surface release-touched, no
  legacy-arm divergence, partial db mocks green on the merged tree). PR A
  (feature/guild-social-v1) had NOT landed at merge time; if it lands before
  this PR merges, re-merge the release branch (both touch server/social.ts
  wiring).
- Release merge 2 (2026-08-03): origin/release/v0.34.0 (5f22a51a0, +143 commits:
  discord-bot stability, the v0.34.0 i18n fill, premade-group filtering) merged
  as b4b1d7670 to clear the PR 2812 conflict. One textual conflict (the
  generated i18n pending bundle) resolved by regenerating all i18n artifacts.
  release-merge-audit found ONE legacy-arm divergence and it is mirrored: the
  release's linked-member level feed (ClientSession.lastPersistedLevel) gates on
  the SERIALIZED level, but this branch's escrow save arm persists a FRESH
  re-serialization (snap.level) inside the queued thunk, so the gate now tracks
  the PERSISTED level (`persistedLevel` local in saveCharacter) with a mid-wait
  regression test in tests/guild_bank_persistence.test.ts. No injected-helper
  drift (the escrow save family and SocialTransport are untouched by the
  release); server/social.ts had 0 delta lines, so PR A has still not landed
  (the re-merge caveat above stands).

## Accepted risks and operational assumptions (Phase 3 review + Phase 3 QA + the escrow root fix)

CORRECTION (the escrow root fix, docs/guild-bank/escrow-fix-plan.md). This section
previously claimed that BOTH reliably attacker-timable arms of the cross-officer escrow
skew were CLOSED, leaving only a crash-windowed residue. Two of those three closure
claims were disproven by the audit that preceded the fix, and are recorded here as
disproven rather than quietly rewritten:

- "The evict-and-reload reconcile closes the fenced-out arm" was FALSE whenever durable
  truth was already AHEAD of the fenced session, which is exactly what another officer's
  escrow save produced: the reload restored the fenced op out of a row that already
  contained it, while the fenced character's own half had rolled back. No crash required.
  (`tests/audit_conc_guild_bank.test.ts`, `tests/audit_cur_conservation.test.ts`.)
- "The surgical revert closes the another-session-dirty arm" was FALSE because the revert
  ran in the fenced session's continuation, which resumes strictly INSIDE the next save's
  in-flight window, so that save committed the pre-revert book and released its own mark.
  Live and durable then disagreed with nothing left to converge them, and a restart
  promoted the skew into a permanent dupe.
- The 500-op cap made it worse: dropping the undo log forced the reload arm even while
  another session held legitimate unflushed ops, so the reload duplicated or vaporized
  that session's work depending on direction.

All three are removed at the ROOT rather than compensated for. An escrow save now
persists DURABLE TRUTH PLUS THAT SESSION'S OWN DELTAS: the payload is the session's
unflushed delta log and the row is rebuilt inside the fenced transaction
(`SELECT ... FOR UPDATE`, `mergeGuildBankRow`, upsert) after the character UPDATE has
passed. A session can only ever persist its own work, so the cross-officer skew has no
mechanism left: there is no shared snapshot to capture, nothing for a reload to restore,
and no reload arm (nor cross-session scan, retry loop, or `revertLostGuildBanks`) left in
the code. The reconcile is a synchronous undo of this session's own ops.

The residue this section used to accept is CLOSED too, and it was never a
residue: it was an unbounded, attacker-triggered money printer, and this text
described it as a 250-copper edge case. The full sequence: officer A deposits
without flushing; officer B withdraws it; B's autosave committed its CHARACTER
half while the book half could not be replayed; A then took itself over (an
ordinary re-login), which fenced A and rolled A's deposit back. B kept the
value, A's stake came back, repeatable on demand, for any amount and for items
as well as copper.

The rule that closes it is the one the whole feature rests on, and it is not
negotiable:

> If the book half cannot be applied, the CHARACTER half must not commit.

A shortfall is never clamped away and never carried: the escrow transaction
ROLLS BACK, character row included, and the save is retried. An anomaly ledger
row is an audit trail, not a substitute for atomicity, and logging a mint is
not preventing one. Concretely:

- While another session still holds unflushed work for the guild, the refusal
  is TRANSIENT: their commit is what makes the replay applicable and it lands
  within an autosave interval. Nothing is consumed, and the marks and log are
  exactly as they were. It is metered as `escrow_refused_retry`, deliberately
  NOT as `escrow_save_failed`: nothing failed.
- When no session can ever make the missing value durable (or the retries run
  out after `GameServer.GUILD_BANK_DEFICIT_MAX_SKIPS`), the session's live
  state is ABANDONED: its own book ops come back off the live book, it is
  quarantined so it can never persist again, ONE aggregate `escrow_deficit`
  bank_ledger row records the incident with SIGNED numbers (so an operator can
  tell work that was taking value out of the book from work that was putting
  value in), and it is disconnected to reload from its durable row. Everything
  it did since its last successful save is lost, which is exactly what a lease
  fence-out already does, and it conserves precisely because none of it was
  ever durable.

The same rule covers the ladder: a rung is never granted from a durable base
that has not reached it, and never granted without its charge. Both used to
leave a "residue" (the opener's purse-paid 24 slots surviving above another
officer's expansion, 90,000 of ladder value) and both are now refused.

Measured, with the same generator, on 300 randomised instances of the exploit
shape (`tests/audit_conservation_property.test.ts`, P4-EXPLOIT): 271/300
durable conservation failures under carry-and-record, 0/300 under refusal;
186/200 live-view failures before, 0/200 after. The property harness's
P4-CONSUMED block pins the two named witnesses (250 copper, 90,000 ladder)
as CONSERVED rather than as accepted mints, and P5's crash pin no longer
tears.

What remains accepted:

- **A session can lose its unsaved progress to another officer's disappearance,
  and an attacker can aim that.** If officer B consumed value officer A never
  made durable and A then vanishes (an ordinary re-login is enough), B is rolled
  back and disconnected. What B loses is everything since B's last SUCCESSFUL
  save, which is not only guild bank work: while a refusal is outstanding B's
  character half does not commit either, so unrelated progress (experience,
  loot, quests) rides on it. That window is bounded by
  `GameServer.GUILD_BANK_DEFICIT_MAX_SKIPS` refused saves, deliberately small
  (2) for exactly this reason, and a refusal immediately FLUSHES the sessions it
  is waiting on rather than waiting out an autosave interval, so the ordinary
  case clears in a round trip and never reaches the bound at all.
  It is an availability and fairness cost, not a conservation one, and it is
  the same rollback a lease fence-out already applies. The attacker pays the
  same price on their own alt and gains nothing durable; the victim's exposure
  is a griefing surface worth watching in production, and the loud rollback log
  plus the `escrow_deficit` row are how it would be spotted.
- **A crash still loses whatever was not yet saved**, as it always did. The
  difference is that a crash can no longer leave value in two durable places:
  a save either committed both halves or committed neither.
- Ledger rows for fenced-out (undone) ops remain in bank_ledger by design: the audit
  script may flag them against the book; that finding points at the incident the loud
  fence-out log recorded (see the operator caveat in scripts/bank_audit.mjs: audit a
  quiesced realm).
- The guild-delete window (`beginGuildBankDelete` / `endGuildBankDelete`) refuses every
  guild bank op for a guild whose DELETE is in flight, spanning the empty-bank guard to
  the DELETE and its post-commit hooks, and tells the actor so
  (`guild.bankClosing`). Before it, an op landing in that gap was destroyed outright by
  the FK cascade with its dirty mark wiped by the post-commit hook.
- `revertOwnGuildBookOps` is SYNCHRONOUS on purpose: it takes the session's log, its
  settled-prefix count, and its marks in one step with no await between them. Any future
  edit that splits those across an await reopens a mark-release race. Same trap class for
  the `collectDeltas` capture inside the queued save closure, which must keep taking the
  marks, the log COPY, and the carried counts at one instant (the log is appended to by
  ops dispatched during the awaited write).
- Dormant pipe-refused slots could make a bank permanently non-emptiable (v1 limitation,
  REMEDIED 2026-08-03 on `feature/guild-bank-followups`): an item a later content update
  flags soulbound/noMarketList is refused in BOTH directions (anonymous-pipe policy), so
  it can never be withdrawn, and the disband guard then refused forever. The operator
  escape hatch is now `POST /admin/api/guilds/:id/bank/purge-slot` (permission
  `guildbank.purge`, SUPERADMIN-ONLY: it destroys player property with no in-game undo,
  so it sits in `SUPERADMIN_ONLY_PERMISSIONS` beside `staff.manage` and no
  dashboard-grantable role reaches it) -> `GameServer.adminPurgeGuildBankSlot` -> the
  sim's `purgeDormantGuildBankSlot`, which removes exactly ONE slot the pipe actually
  refuses (an ordinary withdrawable copy is refused, pinned by test) and rides
  `runGuildBankOp` like every other book mutation: `bank_ledger` op `admin_purge`
  carrying item id, count and the real instance payload as evidence, the per-session
  unflushed delta (so a fence-out reverts it), and the same fenced escrow save. Removing
  the last dormant slot unblocks disband end to end (pinned).
  ACCOUNTABILITY (the privacy-security review's line): the request requires a moderation
  REASON held to the same bar as the guild rename beside it, plus the itemId the operator
  believes sits at that index (a confirmation token: a purge splices the slot out, so
  every higher index shifts down and a stale listing would otherwise destroy the wrong
  dormant copy). The `bank_ledger` row's ACCOUNT is the acting operator, never the
  carrier's owner (its character column is the carrier, because the column is NOT NULL
  and an operator may hold no character: an `admin_purge` row is the one shape where
  account and character belong to different people, which is the signal). A
  `guild_moderation_actions` row with `action = 'guild_bank_purge'` records who, why, and
  what, so a purge shows up in the realm moderation history like every other admin act;
  that table gained an additive `action` column defaulting to `guild_rename` (the literal
  the history union used to hardcode).
  DURABILITY IS AWAITED: a fenced-out escrow save REVERTS the purge (the `admin_purge`
  delta replays backward through `revertGuildBankDeltasTo` exactly like a player
  withdraw) and a REFUSED escrow rolls the whole transaction back and quarantines the
  carrier, so the endpoint confirms the removal survived its save and answers 503
  `save_failed` otherwise, rather than telling an operator a slot is cleared while the
  copy is on its way back. The guild-delete window refuses the operator arm too
  (`runGuildBankOp` pre-empts both targets), and `adminPurgeGuildBankSlot` pre-checks it
  so the refusal names the real reason rather than reading as "not a stuck item".
  That reason is its OWN (`delete_in_flight` -> 409 `error.guildBankDeleting`), REVISED
  2026-08-03: it used to map to `save_failed`, whose operator line says the change "was
  rolled back", describing an event that did not happen (nothing was attempted, so
  nothing was saved and nothing was rolled back) and giving the wrong instruction (503
  reads as a transient to retry into, while the bank is going away with the guild).
  The `admin_purge` delta is a REMOVAL everywhere the machinery reasons about one: the
  forward replay (`applyGuildBankDeltasTo`, all-or-nothing against durable truth), the
  inverse, the replay-equivalent netting (`netGuildBankOpLogForReplay`), and the
  unflushed-log compactor (`compactGuildBankOpLog`), so an operator purge can never be
  the one delta a compaction or a netted rescue silently drops.
  Three accepted limits: the purge needs a live session OF THAT GUILD to carry the escrow
  save (books never persist standalone), so it refuses `no_carrier` when nobody from the
  guild is online (the carrier is chosen off the session membership stamp, so a stale
  ex-member can still carry: harmless, it only lends its escrow transaction and is never
  charged, credited, or named as the actor); it PURGES rather than mailing the copy back
  (the book keeps no depositor identity, and the mail pipe refuses the same copy); and
  there is no admin READ surface yet, so an operator discovers slot indices out of band
  (SQL on `guild_banks`) until the UI follow-up. The admin dashboard control is that
  follow-up: it needs a guild-bank read endpoint (slot list with indices + dormant flags)
  plus a confirm flow; the operator error strings already carry their ADMIN_ERROR_KEYS
  matcher rows and English catalog entries so it is drop-in.
- Guild bank incidents are metered (2026-08-03): `woc_guild_bank_incidents_total{kind}`
  over the fixed NINE `GUILD_BANK_INCIDENTS` (escrow_save_failed, escrow_refused_retry,
  save_fenced_out, escrow_quarantined, reconcile, book_unloaded, ledger_write_failed,
  counterparty_orphan, counterparty_unstamped) through the `gameMetricsCounters` seam,
  pre-registered at zero. Guild id stays in the loud log and is never a metric label.
  Each counter sits BESIDE its log, never instead of it.
  `escrow_save_failed` means the save really FAILED: the db layer threw, or the merge
  refused a book half and that refusal was TERMINAL. A refusal that will be RETRIED is
  `escrow_refused_retry` instead (REVISED 2026-08-03, audit-trail hardening: it used to
  share `escrow_save_failed`, which is ordinary two-officer concurrency on a healthy
  realm and made `> 0` alerting useless). Counted per GUILD like `reconcile`; watch its
  rate, not its presence. `escrow_quarantined` is the terminal arm (the refusal ran out
  of retries or could never resolve, so the session is abandoned) and is the one worth
  paging on, now alongside `counterparty_orphan` and `counterparty_unstamped`, each of
  which is a single-sample defect rather than a transient. `reconcile` counts one per
  GUILD whose unflushed log `revertOwnGuildBookOps` actually undid.
- A create-fee reservation whose refund arm finds the founder gone (refused create racing
  a clean logout) cannot refund in the live sim; it is logged loudly for operator
  compensation, and no create_fee ledger row is written for it. Watch item: a refund
  landing on a RECONNECTED session's freshly loaded purse is correct only because the
  leave flush persists the charged purse first (the mismatch arm logs loudly).
- `GuildBankSimPort` exposes the raw `Sim.guildBanks` map read-only for the boot has()
  verification (the one facade bypass, read-only and test-visible); a future
  `Sim.hasGuildBank` could remove it.
- Deferred from the Phase 3 QA database review (recorded, not fixed; escalation
  triggers named): per-guild autosave serializer if the shared-writer depth warn fires
  in production; keyset pagination + realm/container filters for scripts/bank_audit.mjs
  once bank_ledger reaches millions of rows; bank_ledger index calculus (the created_at
  index STILL has no reader under keep-forever; the (container, container_id) deferral
  is RESOLVED as of 2026-08-03, its named trigger having fired: the in-game activity
  log is the per-guild reader and the index landed with it as
  bank_ledger_container_recent through the CONCURRENTLY seam, see the ACTIVITY LOG
  decision above); gameMetricsCounters for escrow-save failures / fence-outs /
  reconciles / unloaded books / escrow deficits (console.error is the current signal, and
  the escrow_deficit ledger row for the permanent arm); the O(live sessions) dirty-mark
  scan inside beginGuildBankDelete (client-triggerable but cheap; refcount it if
  profiling ever shows it).
- Single-writer assumption, NARROWED: guild_banks rows still carry no optimistic-
  concurrency stamp, but the escrow write is now a read-modify-write under a
  `SELECT ... FOR UPDATE` row lock, which is what makes it safe across PROCESSES rather
  than only within one. A later commit can no longer discard an earlier one, so book
  writes no longer NEED the market serial writer; taking the autosave arm off it is
  recorded as a follow-up (escrow-fix-plan.md section 3.6), not done here.
- guild_banks.realm is written on every upsert but never read by the load paths
  (which key off guilds.realm); kept for operator forensics and a future
  cross-realm audit dimension.
- The conservation property harness (`tests/audit_conservation_property.test.ts`) now
  rides `admin_purge` through the concurrency and fence-injection sweeps (2026-08-03):
  the book seeds three transfer-locked copies with birth-complete deposit rows, a purge
  event runs the real admin entry point, and the oracle's destruction term is derived
  from state (a fenced-out escrow puts a purged copy back, and a durable row can lag a
  live book by an unflushed purge, so a tally would drift). Measured: 0 failures before
  and after, 2616 purges actually removing a copy over 3062 runs.
- scripts/bank_audit.mjs loads bank_ledger, characters, and guild_banks unpaginated:
  fine at current scale, revisit with a cursor once bank_ledger reaches millions of
  rows (offline tooling only, never the server). The counterparty columns WIDEN the
  buffered row (pg returns BIGINT as a heap-allocated string), so the runway to that
  cursor is modestly shorter, roughly 5 to 15% more peak RSS for the same row count on
  guild rows; the order of magnitude of the trigger is unchanged. The sibling
  bank_ledger INDEX deferral was not moved by any of this (the trigger is "a per-guild
  reader exists", and every consumer of the new columns is per-row arithmetic during
  the existing full scan or a JS reduce over the materialized array). That trigger
  fired LATER, on 2026-08-03, when the in-game activity log added exactly that reader:
  `(container, container_id, id DESC)` now exists as bank_ledger_container_recent, and
  `bank_ledger_created` still has no reader.
- Books deliberately share the market serial writer (no second queue): the leave
  flush writes market, mail, AND books in one transaction, so a separate book queue
  would reopen the interleaving the single writer exists to prevent.

## Known gotchas
- `SimContext` is append-only: add views/callbacks, never rename or repurpose existing ones.
- The parity trace excludes server-stamped session-only meta; follow the
  `bankBonusSources` exclusion or offline/online parity tests fail.
- `bank_ledger.purchased_slots_after` is NOT NULL: guild rows write the guild bank's
  purchased-slot count (0 for `create_fee`).
- The snapshot `maybe(...)` stream must go null when the player walks away, dies, is
  demoted to member, or leaves the guild; each of those is a test case.
- `require('typescript')` dual-alias and lockfile rules in CONTRIBUTING.md apply if any
  dependency work happens (none is expected).
- `loadGuildBank` is load-once: it never clobbers a live book (unflushed deposits).
  Reload = delete the map entry, then load; always re-get the book after, never hold
  a reference across an evict. A null `serializeGuildBank` means the guild has no
  loaded book: Phase 3 must SKIP that write, never persist an empty book over a row.
- `sanitizeGuildBankState` accepts a parsed OBJECT only: a JSON string yields an
  empty book. The Phase 3 DB read must hand `loadGuildBank` parsed JSONB, pinned.
- The membership stamp IS the guild bank's authorization. Never stamp from a DB
  write whose result you did not check: a write that matched no row must refuse
  and stamp nothing (the Phase 2 QA CRITICAL). `sanitizeGuildBankState` does NOT
  filter transfer locks, so any NEW wire surface reading the book must project
  refused slots like `guildBankSlotView` does, not assume the deposit gate.
- release/v0.34.0 sync (2026-08-03): `GameServer.saveCharacter` is now
  `Promise<boolean>` (the release's audited GM restores read it). Its contract was
  WIDENED here rather than narrowed: false means THE BLOB DID NOT PERSIST, which on
  this branch has three shapes, the lease fence-out (the release's meaning), the
  escrow refusing a book half, and a quarantined session. Any new caller reading it
  must treat all three the same way. The same sync's stale-client sweep replaced raw
  `ITEMS[id]` reads with `knownItemDef(ITEMS, id)` throughout bags/bank; the guild
  pane's reads follow it. `bagUnknownAction` deliberately offers NOTHING on the Guild
  tab (a client without the def cannot evaluate the pipe's four refusal dimensions,
  and a refused copy strands dormant), which is now an explicit arm with its own pin
  rather than a side effect of the two bank modes being exclusive.
