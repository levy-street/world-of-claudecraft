# Membership courier

An active member learns Courier in the spellbook and can place it on an action
bar. Casting it summons an owner-only flying donkey and opens the courier window.
The window selects whole stacks from the character's bags and personal bank.
Quest items cannot travel. A trip accepts at most 24 selected stacks in total.

Dispatch moves deposits out of the bags into persistent courier custody. The
courier travels in a straight line to the nearest overworld banker. Each leg
starts and ends with ground running at seven units per second. Between three and
eight units from either end, speed and flight height ease up to 17.5 units per
second (250% of normal running speed) and two units above the ground. Very short
trips remain grounded. At arrival it deposits first, then
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
its item lists. Travel progress is a bounded saved scalar, so reconnecting during
flight restores the correct takeoff or landing phase. Target distance uses a direct
entity lookup; motion does not invalidate the bank projection.

`CourierVisual` loads the supplied `winged_mail_donkey.glb`, optimized with meshopt
and KTX2 texture compression, through deferred preloading and the renderer's
compile gate. Each instance owns its skeleton and animation mixer. Idle, Run and
Fly clips control the pose; the Fly root translation is removed from a cloned clip
because the game owns altitude. Grounded height matches PR #4240's horse buddy:
0.75 times 1.701, or 1.27575 world units. The journey window remains usable while
the cosmetic model prepares. Reduced motion retains travel and height changes
while suppressing cosmetic animation.

The supplied raw file is 2,135,232 bytes; the shipping asset is 290,048 bytes
(283.25 KiB), an 86.42% reduction. Its retained source and import command live in
`scripts/assets/courier_donkey/`; the compressed texture, skin and three clips are
pinned by the parsed-GLB tests.

Local component measurements on 2026-10-07 gave 0.218 ms mean / 0.269 ms p95 for
5,000 courier movement updates. With 5,000 unrelated entity/player records and a
1,000-row bank, a pose read averaged 0.000144 ms and movement plus owner snapshot
emission averaged 0.000616 ms. Movement and unrelated player revisions caused
zero heavy reads and zero SQL calls. Small versus grown unchanged snapshot
emission averaged 0.000502 / 0.000512 ms. These are local component measurements,
excluding durable SQL and whole-realm scheduling, not production latency guarantees.

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

The supplied-model browser fixture drives the shipping loader, `CourierVisual`
and `travelCourier` together over a non-flat ground function. Desktop, portrait
and landscape each cover both legs, with 222 rendered frames per leg, zero lift
at both ends and a two-unit cruise height. The browser confirms compressed
1024px textures, 47 joints, normalized Idle height 1.27575, correct blend weights
and zero authored root hover. These captures do not measure full-world shader
telemetry or a live multiplayer journey. Machine-readable browser and component
performance evidence is retained beside the screenshots.

- [Existing bank window before courier](../screenshots/membership/after-bank-desktop.png)
- [Courier selection, desktop](../screenshots/membership-courier/desktop-selection.png)
- [Courier selection, portrait](../screenshots/membership-courier/portrait-selection.png)
- [Courier selection, landscape](../screenshots/membership-courier/landscape-selection.png)
- [Courier carrying items](../screenshots/membership-courier/desktop-outbound.png)
- [Previous procedural donkey](../screenshots/membership-courier/donkey.png)
- [Supplied donkey, grounded](../screenshots/membership-courier/donkey-ground.png)
- [Supplied donkey, takeoff](../screenshots/membership-courier/donkey-takeoff.png)
- [Supplied donkey, flight](../screenshots/membership-courier/donkey-flight.png)
- [Supplied donkey, landing](../screenshots/membership-courier/donkey-land.png)

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
