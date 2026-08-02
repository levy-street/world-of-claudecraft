# Guild Bank: cross-phase state

Current phase: Phase 2 QA complete (2026-08-02, PASS-WITH-FOLLOWUPS); Phase 3 next.

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
- Item policy (revised in Phase 2 review; supersedes the original "quest items refused"
  line): the guild bank is an ANONYMOUS EXCHANGE PIPE (officer A deposits, officer B
  withdraws), so it carries the full World Market / Ravenpost pipe policy, not the
  personal bank's self-storage quest-only rule: quest, `soulbound`, `noMarketList`
  (covers the rift-gear family), and per-copy transfer locks
  (`isTransferLockedInstance`: armed `bindOnTrade` or bound `boundTo`) are ALL refused,
  in BOTH directions (withdraw refuses too, so a tampered/legacy row can never complete
  a laundering; the copy stays dormant in the book). Instanced stacks move whole
  (`moveBetweenContainers`); items are never destroyed by any load or refusal path.
- Disband refused while the bank holds any copper or item.
- Creation fee ordering: create the guild in the DB first, then deduct the fee in the sim
  and save; a crash between them yields a free guild, never lost gold. Never charge first.
- Ledger: same `bank_ledger` table, `container = 'guild'`, `container_id = guild id`, ops
  `deposit_gold | withdraw_gold | deposit | withdraw | buy_slots | create_fee`.
  Keep-forever retention re-affirmed with an explicit comment at the retention-sweep
  registration site in `server/main.ts` (it is the anti-dupe audit trail).

## Constants (single source of truth for the plan; land in `src/sim/guild_bank.ts`)
- `GUILD_CREATION_FEE_COPPER = 100_000` (10 gold).
- `GUILD_BANK_BASE_SLOTS = 12`.
- `GUILD_BANK_EXPANSION_SLOTS = 6`.
- `GUILD_BANK_EXPANSION_PRICES = [50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000]`
  copper (5g, 10g, 25g, 50g, 100g, 250g; 440g total; max 48 slots). Price is ALWAYS a
  table lookup indexed by purchased-expansion count, never client-supplied. Paid from the
  treasury, not personal copper.
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
- Phase 4 UI modules / i18n keys / screenshots:

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
