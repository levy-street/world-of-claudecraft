# Membership courier

An active member learns Courier in the spellbook and can place it on an action
bar. Casting it summons an owner-only flying donkey and opens the courier window.
The window selects whole stacks from the character's bags and personal bank.
Quest items cannot travel. A trip accepts at most 24 selected stacks in total.

Dispatch moves deposits out of the bags into persistent courier custody. The
courier flies directly to the nearest overworld banker at 17.5 units per second,
250% of the normal seven-unit running speed. At arrival it deposits first, then
collects the exact bank stacks requested at dispatch, then follows the owner's
current position home. Changes to a requested bank stack invalidate that request;
the courier never substitutes a different item occupying its old index.

Full banks leave undeposited cargo with the courier. Full bags leave returned
cargo waiting for space, with retries at one-second intervals. Transfer helpers
preserve item instances and material provenance and move whole requested stacks.
Existing journeys finish after membership expires; new dispatches require active
membership. Logout saves custody and freezes travel. Private instances cannot
start a trip, and a returning courier waits while its owner is dead or inside one.

## Ownership and durability

`src/sim/courier/` owns actions, movement, identities, cached readouts and storage
validation behind `SimContext`. `CharacterState.courier` is saved in the same
character snapshot as bags and bank. Cargo counts toward existing mount ownership,
quest reward recovery and membership armour ownership/perfection. Character
renames and item-name moderation also visit cargo.

`server/courier_wire.ts` reserves existing personal-bank ledger admission before
bank mutations, records the deposit and withdrawal legs separately, and reuses the
existing fenced character-save transaction and outbox. There are no new tables,
queries during movement, save timers or realm-wide courier collections. Normal
bank commands retain their proximity checks. Rollback to code predating courier
custody requires returning cargo first; old character serializers do not know this
new storage field.

The request limit is 12 KiB. Custody admission reserves space for normalization,
armour perfection and movement metadata, keeping valid persisted trips within
that envelope. Corrupt oversized owned cargo fails loading rather than truncating
items. Excess or invalid withdrawal intent can be dropped without losing cargo.

## Presentation and cost

Snapshots contain a small owner-only pose and a separately revision-gated bank and
cargo payload. Broad player revisions update a scalar without rebuilding the bank.
The courier window refreshes on the HUD's slow band; position changes do not repaint
its item lists. `CourierVisual` loads the original donkey GLB through deferred
preloading and the renderer's compile gate. The journey window remains usable
while the cosmetic model prepares. Reduced motion removes wing animation and bob.

Local component measurements on 2026-10-07 gave 0.240 ms mean / 0.328 ms p95 for
5,000 courier movement updates. An admitted 24-selection exchange with a 1,000-row
bank averaged 2.255 ms / 3.824 ms p95. Unchanged and unrelated player revisions
caused zero heavy reads. These are component measurements, excluding durable SQL
and whole-realm scheduling, not production latency guarantees.

## Verification and images

Behavior is pinned in `tests/courier.test.ts`, `courier_integration.test.ts`,
`courier_server.test.ts`, `courier_wire.test.ts`, `courier_window.test.ts` and the
paired visual and asset tests. They cover exact custody, order of exchange,
membership and action-bar parity, overflow banks, ownership recovery, audit
refusal, save/load boundaries and cached reads. Adjacent mount, rename and
moderation suites cover the new storage location.

The browser captures exercise the shipping window component at desktop,
portrait and landscape sizes, including a two-direction selection and dispatch.
They are component fixtures, not a capture of a full multiplayer world.

- [Existing bank window before courier](../screenshots/membership/after-bank-desktop.png)
- [Courier selection, desktop](../screenshots/membership-courier/desktop-selection.png)
- [Courier selection, portrait](../screenshots/membership-courier/portrait-selection.png)
- [Courier selection, landscape](../screenshots/membership-courier/landscape-selection.png)
- [Courier carrying items](../screenshots/membership-courier/desktop-outbound.png)
- [Flying donkey model](../screenshots/membership-courier/donkey.png)

## QA record (2026-10-07)

- Final focused Vitest run: 31 files, 1,502 passed, four existing skips. This
  combined the courier suites, wire and command inventories, HUD and locale
  guards, ownership/moderation tests, and renderer/provenance contracts.
- `npm run test:browser`: 65 files, 523 passed.
- `npm run check:types`: game, admin and bot checks passed.
- `npm run build:env`, `npm run build:server`, `npm run build:bot`, and
  `npm run build:bundle`: passed.
- `npm run gate`: artifact generation/freshness, SFX, malware and changed-file
  formatting passed. The full Vitest step suffered a worker JavaScript heap
  exhaustion and was stopped; it is not a green full gate. Its renderer provenance
  failure was repaired with the owning remint tool and passed in the final focused
  run. `npx vitest run tests/corpse_harvest_sim.test.ts --maxWorkers=1` passed all
  99 tests on retry after the full run's timeout.

Database-performance, server hot-path, security/persistence and fresh coverage
reviews cleared their findings. A real PostgreSQL courier save/reload run was not
performed; serialization and reload were exercised through the actual Sim, and
the live server tests exercised the existing audit admission and outbox seams.
The PR still needs a complete green repository gate before merge.
