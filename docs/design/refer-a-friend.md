# Refer a friend

This is an implementation record for the requested feature, based on
`release/v0.45.0` and release tracking issue #4244. It is not a claim that the
feature is available in the game.

## Confirmed behavior

- Ordinary friendships belong to accounts. Existing directed friendships retain
  their direction when character edges are deduplicated into account edges.
- Bound friendship comes only from a new account registering through a referral
  link. An ordinary friend request cannot create or change this relationship.
  Password, Discord and Apple signup capture attribution atomically with the new
  account. OAuth carries the sanitized link through its explicit create-account
  chooser using a 15-minute same-tab handoff; existing login/link never binds.
- Both players receive stamp-card progress when they enroll together. One
  enrollment belongs to each account link, with one character assigned to each
  participant. A character can participate in multiple links.
- Both assigned characters must be below level 5 and must not have completed
  `q_ps_set_sail` when starting. Both must accept. Declining requires confirmation;
  players can later start manually if eligible.
- A reward quest completed with the assigned friend in the party earns its stamp.
  Completing a later associated dungeon together recovers a quest turned in alone.
- Each participant can move their assignment and earned rewards to an eligible
  new character before redeeming their Fogbinder reward. Progress is preserved.
  Fogbinder redemption requires two acknowledgements and permanently locks that
  participant's assignment. A transfer must remove only the moving link's reward
  entitlement from the previous character.
- The inviter receives completion credit once when the invitee finishes their
  card, independent of the inviter's own progress. Replaying a packet or moving a
  character never creates another completion credit.

## Milestones

| Stamp | Authoritative content | Reward |
| --- | --- | --- |
| Tutorial | `q_ps_set_sail` | Unique title and soulbound maximum-tier general bag (16 slots) |
| Hollow | `q_hollow`, `hollow_crypt` | Stamina trinket with a passive low-health shield |
| Fogbinder | `q_mistcaller`, `sunken_bastion` | Evolved stamina trinket, +5 all stats for 15 seconds on a 120-second cooldown |
| Gravewyrm | `q_gravewyrm`, `gravewyrm_sanctum` | Free mount training |
| Raid | An eligible boss in a `finderActivity` with `kind: 'raid'` | Exclusive mount using the tank model initially |

The tutorial quest has no associated dungeon. If it was turned in alone, the active
card earns that stamp when both assigned characters have completed the quest and
rejoin one another in a party. Later quest stamps
can be recovered by clearing the matching dungeon together. Trinket descriptions
use the live content values for stamina, shield size, threshold, and cooldown.

Inviter rewards are: raptor-model mount at one completed friend; 20 bank slots
and five character slots at two; 1,000 Claudium each at three and four; and a
Sapling-model buddy at five. A bound friend's first verified paid membership
purchase also grants one membership bond. Trial activation and bond redemption
are not proof of a paid purchase.

## Integration and deployment dependencies

The feature is based on integration PR #4423 at `7bc9c74af5`. Membership PR
#4281 is included there; buddy PR #4240 was merged into that integration branch
at the user's request. Referral work remains on `codex/referral-stamp-cards`.
The companion economy change is on `codex/referral-economy`, based on its
membership billing integration.

Membership uses `membership_token` and durable receipt-based delivery. The
companion service supplies verified first-paid receipts and fixed-policy,
idempotent referral Claudium credits over its internal service API. Deploy that
compatible service before enabling the game feature. Trial activation and token
redemption do not qualify as first paid memberships.

The buddy integration had archived Sapling. This feature restores its catalog,
ownership allowlist, model, and collection portrait for the fifth inviter reward.
The five reward-item icons reuse existing owned artwork through explicit aliases
in `src/ui/item_art_placeholders.ts`. They remain in the art-pending ledger until
distinct paintings replace them; there are no duplicated image files or new
claims of generated-art provenance.

## Persistence and performance contract

- Account friend/block edges have forward and reverse indexes. Legacy edges are
  preserved even when their account union exceeds the ordinary addition cap.
- Legacy character edges migrate in resumable transactions of at most 500 source
  rows. A permanent final marker prevents a later restart from restoring removed
  account edges. Friend and block display lists each have independent 50-row
  continuation pages, including inherited lists above the new addition cap.
- The account block cache retains at most 4,096 account IDs, shared by an account's
  online characters. Its indexed read requests one extra sentinel. Overflow never
  installs a truncated list: privacy stays fail-closed and the Blocked tab displays
  Unavailable while keeping every continuation page and remove action accessible.
  Operators should inspect aggregate inherited account-block cardinalities before
  cutover. If an account exceeds the guardrail, keep its durable rows, investigate
  the inherited union, and either help its owner remove unwanted blocks through
  the paged controls or deploy a measured larger cache budget. Do not silently
  delete edges or mark an incomplete cache loaded. Reconnect hydration batches
  at most 25 live accounts per query, with a separate limit and sentinel per account.
  The disposable PostgreSQL 16.15 proof seeded 25 accounts with 4,096 blocks each:
  the production cohort query returned 102,400 rows in 122 ms, cache Set hydration
  took 5 ms, and EXPLAIN ANALYZE used account_blocks_pkey (36.109 ms server execution).
  These are local fixture measurements, not production latency guarantees. A host
  regression also pins 5,000 live accounts to 200 cohort queries and zero per-account reads.
- The current account-social migration is forward-only. All realm processes must
  stop before migration and restart on the new binary together. Old binaries
  continue writing the legacy character tables; mixed versions and rollback to
  those writers are unsupported. A production rollout still needs measured,
  bounded migration work against a populated database.
- The full referral rollout also requires an all-realms cutover. Drain and stop
  every old realm writer, apply the additive schema and migration, then start all
  realms on binaries that preserve referral custody and receipts. Old character
  blobs remain valid: missing reward fields mean no entitlements. The reverse is
  unsafe: an older binary omits `referralRewards` and `referralInviterRewards` on
  save and does not know the reward items, mounts, or restored Sapling catalog.
  Never allow old and new character writers to overlap after referral grants.
  A rollback binary must retain these fields, content IDs, account-social reads
  and writes, transaction fences, deletion guards, and idempotent delivery
  receipts. It may disable new enrollments and grants while preserving reads,
  saves, and pending delivery recovery. Otherwise stop all writers and forward-fix;
  do not roll back schema or restore a pre-grant snapshot over acknowledged rewards.
- An unlocked card assignment keeps its character alive through an indexed
  `referral_transfer_characters` guard until the card moves or permanently locks.
  Deletion tells the player to move all unlocked cards first. A bound membership
  bond recipient has a `referral_bond_delivery_characters` guard until confirmed
  delivery; deletion asks the player to retry afterward. Both checks occur after
  the existing account and character locks; deferred character foreign keys
  enforce custody even if another deletion path omits the friendly refusal.
- Card details and histories are paged; unrelated links must not affect a
  viewer's per-tick cost. Party changes and verified milestone events address
  only the involved account/character buckets.
- Card candidates from `src/sim/referral_cards.ts` are pure state transitions,
  not durable grants. Persist the state version, reward receipt, and affected
  character changes in one transaction.
- Use the existing character FIFO, fixed-up detached save snapshot, lease fence,
  storage effects, and bank/material journals. The direct vault-claim adapter is
  the template: no live mutation before commit; project only the reward delta
  afterward. Quarantine an ambiguous commit or failed live projection so an
  autosave cannot overwrite committed truth.
- A move locks both account and character rows in stable order, reads the old
  character fresh, rejects a live source lease, and removes source entitlement
  atomically with destination grant and card reassignment. Do not reload an old
  snapshot into the live simulation after waiting for SQL.
- Bag sockets store item IDs, not instance provenance. A movable referral bag
  needs either explicit socket provenance support or a protected fungible reward
  type with per-link entitlement counts. Tagging an item instance without changing
  sockets makes it unequippable under the existing bag rules.
- External rewards require durable outbox intent, stable idempotency keys,
  bounded retries, and receipt-based acknowledgement. No network request or
  player confirmation may hold a database transaction open.
- The summon cooldown must be durable for 30 minutes; relogging, changing
  characters, or retrying a request must not reset it.
- Disposable PostgreSQL scale evidence used 100,100 links, 100,000 bonds assigned
  to other realms, and 1,000 pending reward rows. A production 50-card page took
  10.56 ms (0.148 ms server execution, 51 rows); a production 25-bond claim took
  10.35 ms (0.820 ms server execution). An empty realm read three shared buffers
  in 0.079 ms. The plans use bounded indexed candidates rather than scanning
  other realms' pending rewards. A real 25-recipient simulation projection took
  9.47 ms total, with a maximum individual projection of 2.39 ms. These fixture
  measurements establish the tested workload, not a production latency guarantee.

## Verification

The live game integration includes account friendships, referral registration,
party and quest evidence, reward redemption and transfers, summoning, inviter
entitlements, membership delivery, the HUD launcher, and the quest-log section.
Desktop and mobile captures are under `docs/screenshots/referral-cards`.

Tests exercise real PostgreSQL migration restart, block pagination and overflow,
card claims, lease fencing, deletion guards, and transfer through the canonical
character save and material-source audit adapters. A disposable PostgreSQL 16.15
instance supplies local database evidence. The companion service's complete suite
passed with 751 tests and no skipped database tests after the offline payment feed
was added. Those tests do not establish production rollout readiness by themselves.

### Local QA, 2026-10-09

The repository gate (`GATE_SELECT_BASE=7bc9c74af5 node scripts/gate_select.mjs`)
was invoked against the integration base. Artifact generation and SFX checks
passed; its freshness step compares with the index, so the intentionally unstaged
generated files fail that step. The remaining checks were run separately. A second
complete regeneration reproduced all 58 localization and manifest artifact hashes.

| Check | Outcome |
| --- | --- |
| `pnpm exec vitest run --maxWorkers=2` over all 60 changed unit-test files, with `TEST_DATABASE_URL` | 1,916 passed, two failed, zero skipped; the size-ratchet failure was corrected and the pre-existing Gambler's Die case exceeded its 20-second limit under concurrent load |
| `pnpm exec vitest run --maxWorkers=1 tests/monolith_budget.test.ts tests/trinket_tooltip_view.test.ts tests/linkdead.test.ts` | All 111 passed after the correction; no timeout or assertion was weakened |
| Both PostgreSQL integration files within that changed-test run | All 17 passed, zero skipped |
| `pnpm run check:types` | Game, admin and bot passed; admin reports zero warnings |
| `pnpm run build`, `pnpm run build:server`, `pnpm run build:env`, `pnpm run build:bot` | Passed |
| `pnpm exec biome check` with the explicit changed/untracked source file list | 175 files, zero errors; 527 warnings and 12 informational diagnostics |
| `pnpm run security:gate` | Passed: 13,049 files, zero high findings after reviewed priors |
| Companion full suite with PostgreSQL and companion build | 751 tests passed, zero skipped; build passed |
| `node scripts/item_art_audit.mjs --verify-only` | Passed after replacing five copied placeholders with explicit aliases: 2,039 owned images and 142 pending IDs |

The icon/module-size run passed all 47 tests. A later combined art-test run passed
53 tests and failed the unchanged historical heroic-item comparison (78 in the
sealed historical audit versus 116 current definitions) plus the decode-all-icons
20-second timeout under concurrent load. Both new item-total pins (2,210) and the
exact alias/ownership checks passed. Windows audit-builder tests also encountered
temporary-directory cleanup EPERM and a CLI timeout; the direct CLI audit passes.
The final icon change passed the game type check and client rebuild, and all 58
generated artifacts were reproduced byte-for-byte by a second regeneration.

The full browser run passed 571 tests and failed three. The corrected Sapling
collection count and a transient suite-import failure both pass on the focused
recheck (41 passed). Two Shardpike asset tests still fail: their unchanged fixture
only awaits `assetsReady()`, although integration commit `7bc9c74af5` already marks
the needed WOC character files as lazy. Those fixtures need the existing
`landWocFiles` helper. This is static baseline comparison, not a separate baseline
browser execution.

Referral desktop and mobile browser interaction checks passed, including stamp
reveal, redemption, movement, confirmation, focus, touch targets, and reward
tooltips. The in-game screenshots use an injected authoritative-shaped snapshot;
they are not evidence of two real accounts completing the live online journey.
Real-provider OAuth redirects and the production all-realms migration/cutover have
not been exercised locally.

Database performance, server hot-path performance, security, persistence,
cross-host parity, simulation, frontend, and behavior-coverage reviews were run.
Confirmed feature findings were checked with regression tests.

The full unit run finished with 78,130 passed, 263 failed, 56 skipped and eight
pending tests across 5,412 files. It ran before the last integration corrections
and includes failures superseded by the focused reruns below. A long host pause
also triggered a worker-termination timeout. This is a failed broad run, not a
clean full-suite result. Failures include Windows-only subprocess/symlink errors,
content and renderer drift already present at the integration base, and feature
integration gaps subsequently repaired. The complete raw report is retained in
`C:/Users/Jamie/.codex/tmp/referral-full-tests.json` on the development host.

Final broad-run corrections include the 16-slot general bag ceiling, preserved
item-art ownership through aliases, account-social literal SQL and migration
fixtures, restored Sapling persistence, mount audio and collection entries, and
HUD lifecycle/localization registries. The 24-slot bags in the catalog are
materials-only and are not the appropriate reward capacity.


### Final focused validation after the broad run

- Latest referral reducer/command/adapter/service and PBE checks: 192 passed.
- Full snapshot/session regression files: 332 passed. Autosave fixtures isolate
  unrelated join-time social, referral and membership producers; exact save FIFO
  and shared-permit assertions remain unchanged.
- Social literal-SQL and migration/title fixtures: 97 passed, including four
  real-PostgreSQL social tests.
- Buddy schema, card persistence and buddy normalization: 22 unique cases passed
  across the initial run and one corrected-fixture rerun. Production DDL upgrades
  an existing three-buddy CHECK, preserves ownership, rejects invalid writes,
  rolls back atomically and leaves its constraint OID unchanged on restart. Tier
  five settlement grants Sapling once while retaining the other three buddies.
  Real earned card rewards also pass through canonical saves and reload without
  losing another card's receipts or duplicating a stale retry.
- Mount audio, Reliquary, trinket aura and module budgets: 352 passed. Buddy/UI
  census: 128 passed. Portrait runtime routing and account buddy checks: 27 passed.
  Isolated item icons: 25 passed.
- Parent HUD lifecycle, locale, focus and client-default registries: six files
  passed. Screenshot CI coverage now includes the referral captures; its remaining
  failure is the inherited missing `bastion-ghost-crew` cone entry.
- Current `pnpm run check:types`, `pnpm run build`, `pnpm run build:server`:
  passed. Explicit changed-source Biome batches: 225 files, zero failing batches.
  `pnpm run security:gate`: passed, 13,053 files and zero high findings after priors.

Remaining baseline examples are recorded rather than weakened: the historical
character-growth ledger differs by 3,855 bytes after removing this feature's
measured additions; `components.css` has 486 raw colors against its old 471 pin;
the unchanged mobile Collections rule lacks its height reset; and Shardpike's
browser fixtures do not load their already-lazy character assets. Source comparison
establishes these examples at integration base `7bc9c74af5`; it is not a separate
full baseline execution.


### Multiple-card character storage

Receipt count follows permanent reward custody: every earned link keeps one
non-stackable, protected referral satchel. The current personal-storage ceiling
is 80 carried slots, 196 bank slots and eight bag sockets, so a character can hold
at most 284 earned-link receipts. This does not cap unredeemed active cards in the
normalized account-link tables. Transfers move the bag and remove the old receipt.
No receipt is truncated on load.

`tests/referral_reward_growth.test.ts` creates all 284 tutorial rewards through
the real grant function and moves them into legal storage positions. The save/load
fixed point is 21,685 UTF-8 bytes, with 7,973 receipt bytes. The next grant refuses
for capacity; retry, transfer, old-character removal and replacement claim pass.
With inviter rewards, 283 bags plus the raptor reins and Sapling serialize to
21,780 bytes. A conservative isolated envelope of 284 maximum-width IDs and
completion masks is 8,285 bytes; it is not a jointly reachable inventory of 284
completed cards because their other protected rewards also occupy slots.

The gear-heavy growth fixture measures 258,370 bytes. Its 8,309-byte attribution
covers extra bank capacity, discovery IDs and Sapling only, not every possible
receipt-bearing shape. The receipt-heavy cases above measure that distinct shape
without falsely combining incompatible full-inventory fixtures.


The five added receipt-growth assertions pass. Combined with the existing growth
file, the run is 15 passed and one inherited historical ledger failure. The
independent full-gear-plus-receipt upper envelope is 266,654 bytes, above the
unchanged 262,144-byte warning threshold; it is not asserted to be reachable.
Oversized recovered data remains intact. The final database review accepts the
physical bound and requests no further runtime proof.

The disposable PostgreSQL instance was stopped after validation. Game changes
remain uncommitted on `codex/referral-stamp-cards`; companion changes remain
uncommitted on `codex/referral-economy`. No referral deployment or pull request has
been published. Repository-wide QA verdict is **NOT READY for merge** while the
full gate remains red; successful scoped checks are not a claim that CI is green.


### Portrait regeneration evidence

Sapling uses the shared static buddy portrait route. The portrait job inventory now
excludes all four static buddy aliases, preventing nonexistent creature-portrait
paths from entering the audit. Updating that renderer-owned inventory requires
fresh receipts for the existing portraits. The normal capture pipeline rendered
all 355 jobs with zero failures or page errors. The Windows renderer differs from
the original Darwin environment, so 355 creature portraits and 24 finder thumbnails
have small shading/encoding differences. All 379 changed before/after pairs were
visually reviewed; subjects, framing, poses and geometry are unchanged.

The normal receipt-backed environment remint and freshness check both passed.
Four portrait suites passed all 40 tests. Genuine receipts, comparisons and review
notes are under `docs/achievements/referral-portrait-render-2026-10-09`, with the
contact sheets under `docs/screenshots/referral-portrait-render-2026-10-09`.
No manifest policy or receipt guard was relaxed.


After the portrait refresh, the client build passed again and a separate full
regeneration reproduced all 58 gate-owned artifacts byte-for-byte. Final explicit
Biome batches passed for 225 changed source/data files, the security scan passed
with zero high findings after priors, and both worktrees pass `git diff --check`.
The final CI-workflow fixture run is 26 passed and one inherited failure, solely
its missing `bastion-ghost-crew` screenshot cone entry. Both new referral screenshot
subtrees are included. The original `d188/WoC` checkout remains clean.
