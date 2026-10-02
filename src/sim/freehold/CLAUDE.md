# src/sim/freehold - Freeholds and Guildhalls (player housing)

Host-agnostic housing state and commands: the live freehold record, its load,
snapshot and evict lifecycle, the owner-keyed claim on the dungeon slot pool,
and the command bodies the `IWorldHousing` facet delegates into. The record is
keyed by an OWNER key (D16) that never reaches the wire; the public descriptor
carries an opaque plot id only.

- `owner_key.ts` owns the OWNER KEY (D15): `freeholdOwnerKeyOfMeta` (the host
  stamp `meta.freeholdOwnerKey`, `account:<id>` online, else the `entity:<pid>`
  fallback resolved AT READ TIME) and `freeholdKeyFor(ctx, pid)` over the live
  roster. The `entity:<pid>` key is stable within ONE Sim only: the offline
  pid is minted after the world roster, so any content change that spawns an
  entity before the player shifts it. The persistence slice must never key a
  durable row on it (the online key is the account id; an offline durable
  identity, if one is ever wanted, needs a `character:<id>` arm like
  `instanceKeyFor`'s `solo:char:<id>`). A LEAF with type-only imports, and
  deliberately so:
  `instances/dungeons.ts` resolves an owner claim's key from here, never from
  `instance.ts`, so the dungeon module's import graph never pulls this
  directory's runtime modules in.
- `instance.ts` owns the claim: `enterFreehold` (dead, in combat, no record
  or an unusable one, then a full pool answer `dead` / `combat` /
  `no_freehold` / `busy` as exactly one text-free `freeholdDenied` each, with
  nothing moved, claimed or drawn; `busy` is decided HERE, before the dungeon
  module is asked, so its English "instances are busy" error can never fire
  for a freehold). THE CORPSE RUN is `dead`'s one exception, the dungeon
  idiom: a released ghost whose corpse is bound (corpseInstanceId) to one of
  the caller's OWN live owner claims is admitted to THAT room (the corpse's,
  not the current tier's: a tier change in between leaves the corpse in the
  old room, which the vacant-claim sweep keeps while the corpse lies there)
  and resurrects at the entrance; a fresh corpse, a ghost bound elsewhere or
  to a room the reaper already freed, and a ghost with no record refuse
  `dead`. The corpse run needs no usable tier (the room comes from the bound
  claim), so a bound ghost is admitted to its body's room even when its
  record's tier is corrupt, pinned.
  A record whose tier is outside the union (a corrupt or forward-version row)
  answers `no_freehold` to a living enter, never a throw. `leaveFreehold` is false and silent
  unless the caller stands inside a live owner claim (a leave from anywhere
  else is a no-op, not a denial: D10 covers denials of an entry or a
  mutation), and ANY player inside a live owner claim may leave, not only
  its owner (the room's exit is the one way out for a sibling, a later guest
  or a body a dead relog placed there). `freeholdDefForTier` is the
  tier-to-room map, exhaustive over the tier union (the four later tiers
  alias the Cottage until their rooms land), and `freeholdDescriptorFor` a
  VALUE COPY with no owner key in it, exported for the descriptor emit of a
  later slice and reached by tests only until then. It reaches the dungeon machinery ONLY through the seam
  (`ctx.enterDungeon` / `ctx.leaveDungeon` / `ctx.instanceClaimIdAt`) and
  reads the rooms from `content/freehold`, never from `instances/dungeons.ts`
  or `data.ts`. That is the seam rule itself (a system module talks to another
  system through `SimContext`, not by import), and the import graph makes it a
  near-cycle besides: `instances/heroic_vendor.ts` and three `professions/`
  modules import this directory's barrel, so a freehold -> `instances/dungeons`
  edge would sit one import away from a loop through the barrel (the
  `pvp/index.ts` rule).
- THE TIER-CHANGE RULE lives in `instances/dungeons.ts`, not here: once a
  living owner has arrived in the room of its current tier, `enterDungeon`
  frees every other owner-keyed room still claimed under the same owner key
  unless a player stands inside it or a bound corpse lies there (pinned in
  `tests/freehold_instance.test.ts`). The
  guard is the room's `claimKey`, never the key string, so party and solo
  claims are untouched. A ghost's corpse run sweeps nothing (the sweep is
  gated on a living arrival), so the current tier's vacant claim survives it.
- `gate.ts` owns explicit physical confirmation: a live nearby `freehold_gate`
  is required and no tick or proximity trigger enters a house. The shared
  `gate_rules.ts` radius is used by the sim and the client. Successful entry
  grants an absent Hearth Key if it fits; full bags keep the accepted entry
  and retry on the next accepted gate entry. Physical entry never reads or
  spends the remote-key clock. Only the owner's released bound corpse may
  use the physical corpse-run exception.
- `hearth_key.ts` owns the permanent item's remote action. Ownership comes
  from the live record, never the held tool. `entry_context.ts` checks dead,
  combat, authoritative match membership, instance regions and jail visits.
  The selected live owner claim is a silent no-op before clock/admission.
  The isolated clock is a Sim-owned `freeholdKeyReadyAtMs` account map, read
  against `lockoutNowMs` only on commands. It has exactly TWO writers, both in
  `hearth_key.ts`: `useHearthKey` after a successful remote entry, and
  `mergeFreeholdKeyReadyAt`, which installs a durable clock FORWARD ONLY; and ONE
  delete, `releaseFreeholdOnLeave` in `state.ts`, when the owner's LAST session
  leaves (checked against the roster before that function's record-gated return,
  because the durable clock is merged at install even for an account whose plot is
  held or absent). A host that reached into the Map itself would be a third writer,
  and the forward-only rule would then live in as many places as there are hosts,
  so nothing outside this directory may write it: the source scan in
  `tests/freehold_module.test.ts` lets only `hearth_key.ts` set it and only `state.ts`
  delete it, and refuses any other reference that is not a read, a declaration or a
  forwarding getter (an alias, an optional chain, a bracket call, a `clear()`, the map
  passed as an argument, or the map returned from a function). It is outside the
  serialized plot, so changing tier cannot reset it; online the eviction is safe
  because the login merge reinstalls the durable clock, and offline and headless
  keys are per entity.
  `useHearthKey` checks this LOCAL clock BEFORE the host's admission, so a key used
  through its cooldown costs the host nothing; the local clock may deny a use, never
  admit one. The host's `freeholdKeyAdmission` answers `'admit' | 'deny' | 'pending'`
  (`FreeholdKeyAdmission`, `../types.ts`): offline and headless default `'admit'`;
  a lit realm answers from the DURABLE account cooldown through
  `server/freehold_hearth_trip.ts`: `'pending'` (silent, the server
  re-dispatches the use once the advance commits or refuses), `'admit'` only for that
  committed re-dispatch, `'deny'` (`busy`) for anything else. An isolated ready value
  never authorizes a realm trip.
  This participant is not another feature flag and does not block physical
  entry on an explicitly enabled realm.
- The online entity's `dungeonEntrySeq` must mirror the accepted self-wire entry
  identity as well as the command ACK field. It is a teleport/pose observation,
  never a fresh-arrival presentation directive: reconnect or a repeated snapshot
  cannot authorize welcome, sound or first-tier camera from this number alone.
- Owner-room entry resolves `instances/owner_arrival.ts` before any claim or
  teleport mutation. Empty rooms retain the authored entry and facing; occupied
  rooms use deterministic body-safe candidates in the protected approach ahead
  of the entry, checked against static geometry and current local player bodies.
  A full approach emits one `busy` denial without changing claims, occupants or
  key deadlines. Ordinary dungeon arrivals retain their existing behavior.
- Owner-room reaping uses `instances/owner_claim_occupancy.ts`: index owner claims
  once and resolve each roster position to one candidate using the same exact
  containment predicate. Keep ordinary dungeon and widened raid footprints on
  their established paths. `instanceScanCounters` are observability only, reset
  even on non-sweep ticks; no RNG or clock enters their accounting. The server's
  freehold-record gauge reads `ctx.freeholds.size` directly, not a map walk.
  Record counts and public `freehold` presence labels must never include owner
  keys or become gameplay authority. The account Hearth's future private mirror
  belongs to account state, never transferable plot state or its descriptor.
- THE LIGHTING RULING: the realm remains dark by default. The shared slot
  capacity and empty hold, physical-entry broadcast cost, durable ownership
  and remote-key authority remain unsigned deployment prerequisites. The
  key cooldown does not bound repeated physical gate entry.
- `dev_grant.ts` owns `/dev freehold <tier>` (D24/D81): `devGrantFreeholdTier`
  needs BOTH `ctx.devCommands` AND `ctx.freeholdDevGrantEnabled` (else
  `unauthorized`, nothing written), validates the tier through the content
  tier table (`bad_tier` for an unknown id and for a not-yet-authored tier
  alike) and writes through the one tier writer. `dev_commands.ts` keeps only
  the thin chat arm and its `[dev]` dev-channel text.
- THE ONE-WRITER RULES: `state.ts` is the only file that writes
  `ctx.freeholds` (`loadFreehold`, `ensureFreeholdRecord`, `evictFreehold` and
  the join/leave hooks over them) or a record's `tier`
  (`setFreeholdTier`,
  pinned by a source scan in `tests/freehold_dev_grant.test.ts`), and
  `applyFreeholdOwnerStamp` there is the only writer of the host owner stamp
  on `PlayerMeta` (called once, from `addPlayer`, through
  `seedFreeholdOnJoin`). Every later grant, upgrade or load goes through
  those, never through a second assignment site.
- THE FLAG RULING (recorded in `commands.ts`): the server dispatch gate is the
  ONE gate; no command body re-checks `ctx.freeholdsEnabled`. The sim honors
  the flag in one place, the two record INSERTERS in `state.ts`
  (`loadFreehold`, `ensureFreeholdRecord`): both insert nothing on a dark
  host, so neither the `addPlayer` seed today nor a persistence loader later
  can seed a dark realm, every dark enter answers `no_freehold`, and there is
  no second gate to drift. `seedFreeholdOnJoin` still applies the host stamp
  on a dark host, so a later lit read sees the right key.
- RETENTION: `seedFreeholdOnJoin` is the first record inserter, and
  `releaseFreeholdOnLeave` (from `removePlayer`, while the leaver is still on
  the roster) is its paired evict: the record goes ONLY when no other live
  player shares the owner key (two characters of one account share one
  record; the last session out evicts). The roster walk there is a pure
  existence check, so its iteration order cannot matter; the Map iteration
  rule below still binds anything that walks `ctx.freeholds` itself. On a lit
  host every leave walks the roster once (every joining player holds a
  record, bots and RL agents included, which `ctx.freeholds.size` counts);
  an owner-key to live-session-count index kept by the same two hooks is the
  named O(1) shape if that walk ever shows up in the leave cost. The
  server's linkdead displacement seeds the replacement BEFORE the evict of
  the displaced session runs (its leave awaits twice before removePlayer),
  and the evict is a no-op only because the sibling scan finds the new
  session; persistence must not inherit that ordering.

- `types.ts` owns the shared shapes (`FreeholdState`, the public
  `FreeholdView` and `FreeholdLayoutView`, the tier and visit-policy unions).
  Data only: no logic, no `SimContext`, so the server row mapper and the wire
  import the same names. Names may gain members later and are never renamed.
- `should_spawn_npc.ts` owns surface NPC admission: dynamic definitions stay
  excluded, and the furnisher requires the host opt-in. It reads no live state
  and draws nothing; `surface_npc_bootstrap.ts` applies it during construction.
- `crafted_availability.ts` owns `isFreeholdCraftAvailable`, the content-identity
  predicate used by recipe acquisition, training, crafting, vendor admission and
  presentation. It receives the host opt-in as a value and reads no live world,
  so catalog identities and saved ownership remain available on a dark host.
- `state.ts` owns the record lifecycle over the live `ctx.freeholds` map on
  the `guild_bank.ts` idiom: `defaultFreeholdState` (every account's tier-0
  Inn Room), `loadFreehold` (the ONE load path, load-once, an empty owner key
  ignored), `serializeFreehold` (a value copy, null when nothing is loaded so
  the persistence caller skips the write) and `evictFreehold` (the sanctioned
  drop). It must stay pure: no SQL, no rng, no clock; the server owns rows.
  Retention: the map is keyed by owner and grows with every load, so the
  first `loadFreehold` caller pairs with `evictFreehold` at account or
  character unload in the same change. Today that pairing is
  `server/freehold_persist.ts`, which retains on the join path and releases on
  leave, and `releaseFreeholdOnLeave`, which evicts at the last same-key session
  out. The table itself is KEEP-FOREVER and deliberately
  absent from the swept-table list `server/main.ts` hands
  `server/retention_sweep.ts`: it is bounded at a small number of
  plots per account and never grows per event, session or day, so the reverse
  foreign-key account cascade is its only removal path. That absence is pinned
  in `tests/server/main_retention_wiring.test.ts`, beside the same decision for
  `bank_ledger`.
  THE PLOT IDENTITY DIVERGES BY HOST, accepted and recorded rather than fixed.
  ONLINE, `server/freehold_install.ts` installs a default carrying the identity
  the store minted on the ABSENT arm of a durable load, so an online record
  answers to a unique id from its FIRST session, except a record seeded where no
  answer could be installed, which carries the stand-in and is write-blocked by
  the store's refusals: a hold (including a durable re-ask refused on
  capacity), both handshake asks throwing with no loaded entry to answer for
  them, a minted name the install refuses as inadmissible, a loaded QUIESCED
  entry over a row (its replay carries no document, so the entry installs
  nothing; a run of thrown writes does not quiesce, so its entry replays its
  kept edits instead), or a join answer WITHHELD at install
  (`server/freehold_join_answer.ts`: nothing loaded could vouch for it).
  OFFLINE AND HEADLESS
  there is no store and no minter, so every record on those hosts carries the
  one literal stand-in `PENDING_FREEHOLD_PLOT_ID` forever, and two offline
  records are therefore indistinguishable by `plotId`. That is harmless while
  the id is PRESENTATION ONLY, which `types.ts` states as a rule: no sim rule
  may branch on it, no admission may test it, no lookup may key on it. IT IS NOT
  HARMLESS TO A CONSUMER THAT KEYS ON IT, which would be correct online and
  colliding offline, so THE PHASE THAT MAKES `plotId` LOAD-BEARING AS A KEY MUST
  SUPPLY A MINTER FOR THOSE HOSTS FIRST. Anything minting an id inside this
  directory draws from `Rng`, never a clock and never `Math.random`: an id
  minted from a clock forks the three hosts on one seed, which is exactly the
  class of fork the parity gate only catches once a record exists. Carried as a
  named gate in `docs/freeholds/persistence-rollout-contract.md` section 8a.
  DETERMINISM, before anyone iterates it: `ctx.freeholds` is a `Map`, so it
  walks in INSERTION order, and that order is host-dependent (server:
  per-account login arrival; offline: one record; headless: whatever the env
  seeds). Sim code that iterates the map MUST sort by owner key first.
  Relying on Map order forks the three hosts on one seed, and it is the kind
  of fork the parity gate only catches once a record actually exists.
- `persisted.ts` owns the durable SHAPE and the versioned load. It is the one
  place that decides what a stored plot means: `normalizeFreehold` classifies a
  durable value into five arms (absent, loaded with the list of safely repaired
  known scalars, unsupported, malformed, oversize),
  `persistedFreeholdFromState` projects the live record down to the durable
  subset, `freeholdStateFromPersisted` rebuilds it, and
  `persistedFreeholdBytes` measures what the save path would write. THE
  PRESERVATION RULE, which is the reason this file exists: only genuinely
  ABSENT data resolves to the free Inn Room default. Unsupported, malformed and
  oversize content is never repaired, never dropped and never re-read as
  absence; it stays on disk exactly as it is and the account is write-blocked,
  because the owner's furnishings are in that row and nothing else holds a
  second copy. It is pure: no clock, no rng, no server import. The row-count
  and string-length ceilings are checked BEFORE any deep allocation, the byte
  ceiling before the result is returned, and every ceiling is content-derived
  and recorded in `docs/freeholds/content-numbers-workbook.md` section H.
- `load_report.ts` is the bounded diagnostic leaf beside it, the
  `professions/farm_load_report.ts` shape. It owns NO log call of its own: it
  returns a bounded diagnostic or null, and `server/freehold_persist.ts` is its
  one caller, putting the line on its own warn port so the store stays
  driveable from a Vitest. An absent row and a clean load both answer null, so
  an ordinary boot says nothing. What it does carry is COUNTS AND
  CLASSIFICATION ONLY. It must never carry an owner
  key, an account id, a plot id or an item id, and must never echo a corrupt
  string back: an over-long identifier echoed into a log is the same unbounded
  bytes problem wearing a log costume.
- `commands.ts` owns one exported body per wire command, shaped
  `(ctx, pid, ...args)`. Each resolves the caller in-module through
  `ctx.resolve(pid)` the way `professions/enchanting.ts`,
  `professions/gathering.ts` and `mounts_training.ts` do (not
  `professions/farming.ts`: its Sim delegate resolves the caller first) and
  then returns. `freeholdEnter` confirms through `gate.ts` and `freeholdLeave` delegates
  to `instance.ts`; for the eight others the numbered later work named
  on each body puts the real decision there, re-validating the payload shape
  in the module so the offline host enforces what the server guard enforces.
  None of those eight may mutate state, emit an event or draw rng until its
  owner lands it, so a host that runs them is indistinguishable from one that
  does not.
- `Sim` keeps thin same-named delegates for the facet (the `IWorldHousing`
  members right after the farming block in `sim.ts`). Every one but
  `housingNowMs` delegates into this directory, the two descriptors included, so
  lighting a member is an edit HERE and never a growing body inside the
  zero-slack `sim.ts` coordinator. `housingNowMs` deliberately has no
  module counterpart: it is a one-line alias for the host clock the coordinator
  already owns, and it stays that way. If it ever needs a decision, it moves
  into this directory first rather than growing a body on the coordinator.
- `housingNowMs` is the `farmNowMs` clock base, and it must NEVER be read from
  inside `tick()`. On the authoritative server `cfg.lockoutNowMs` is a real wall
  clock, so a housing pass that sampled it per tick (a condition decay or a
  ledger-due sweep at 13 are the obvious candidates) would fork the world off
  its seed. It is a COSMETIC base for a consumer comparing one housing timestamp
  against "now", nothing more; the authoritative facts stay descriptor fields.
- `ClientWorld.buildPresenceSeq` (the online half, `src/net/online.ts`) is
  RESERVED for C03 and carries two properties later work must not overread. No
  server-side ordering or drop logic exists yet: `server/freehold_wire.ts`
  type-guards the field and discards it, so nothing is reordered or dropped
  today. And it is advisory rather than dense: the counter advances even when
  the frame is not actually sent (spectating, or a closed socket), so C03 must
  treat it as monotonic-WITH-GAPS and never as a contiguous count.
- The host opt-in is `SimConfig.freeholdsEnabled` (D85: optional, default
  false; the stock offline world and the headless env pass true, the server
  maps its realm env), read only as the `ctx.freeholdsEnabled` primitive.
  The editor viewport (`src/editor/3d/viewport.ts`) and custom editor
  play-test maps boot dark by design; only the stock offline world and the
  headless env opt in.
- `ctx.freeholdsEnabled` gates the furnisher through surface NPC construction
  and new crafted-furnishing acquisition through `isFreeholdCraftAvailable`.
  The Eastbrook gate prompt reads it when its owner lands.
- Golden parity traces cover the dark arm, pinned by the source boundary in
  `tests/freehold_npc_spawn.test.ts`. That suite pins the unchanged dark
  construction fingerprint, full geometry, and deterministic lit construction;
  `tests/freehold_module.test.ts` proves inert commands on each configuration
  and the dark-host inserters.
- No store, ledger-service or ownership-service vocabulary anywhere in this
  directory: the sim is a game core, and everything that sells or transfers a
  plot stays outside `src/sim/`.
- Import the directory's public API through `src/sim/freehold/index.ts`
  (explicit re-export lists, never `export *`). A module that ever needs a
  runtime import from a package that imports this barrel stays out of the list
  and is imported by path, exactly as `pvp/index.ts` documents; the item dispatcher imports `hearth_key.ts` directly because its context
  predicates reach existing simulation systems.
  ONE STANDING EXCEPTION, and it is the majority of the importers: a consumer
  that wants nothing but TYPES imports `./types` (or `.../freehold/types`)
  directly rather than the barrel. `src/sim/sim_context.ts` does, to keep the
  seam out of a barrel cycle it does not need: the type-only import would
  compile, since types are erased, but the directory's own modules import back
  through it, so this is a convention worth keeping rather than a compiler
  compulsion. `src/world_api/housing.ts`,
  `src/net/freehold_snapshot_wire.ts` and `server/freehold_wire.ts` do because
  the seam, the wire and the server should pull in no runtime value from the
  sim package at all. Runtime consumers use the barrel, including `sim.ts`,
  recipe acquisition and profession training/crafting, the Heroic Quartermaster
  and the pure presentation consumers of `isFreeholdCraftAvailable`.
  TWO STATED EXCEPTIONS, so they read as decisions rather than as drift, and the
  list under each is EXHAUSTIVE: an importer added without a line here is drift
  by definition. FIRST, the SERVER's durable and gate consumers.
  The server files below reach these leaves by path, and they are ONE consumer
  split across files as the store was extracted, not separate decisions:
  `server/freehold_persist.ts` (`persisted.ts`, `state.ts`, `load_report.ts`),
  `server/freehold_persist_wiring.ts` (`persisted.ts`, `types.ts` for
  `FREEHOLD_VISIT_POLICIES`), the composition root beside it, the module that
  came off the root:
  `server/freehold_liveness.ts` (`persisted.ts`, `state.ts`), which binds the
  store's four liveness reads to the live map for the root and the store's
  suite alike, and the modules that came off the store:
  `server/freehold_install.ts` (`hearth_key.ts`, `persisted.ts`,
  `state.ts`, `types.ts`), `server/freehold_write_seal.ts` (`persisted.ts`,
  `state.ts`), `server/freehold_load_outcome.ts` (`load_report.ts`,
  `persisted.ts`), `server/freehold_hearth_load.ts` (`persisted.ts`, for the
  stored byte bound its login-pair read passes),
  `server/freehold_persist_types.ts` (`persisted.ts`, type-only, for the ports
  and the entry record) and `server/freehold_wire.ts`
  (`gate_rules.ts`, `types.ts`).
  The realm's remote Hearth trip is one more consumer split across its core
  and the binding to the game pieces: `server/freehold_hearth_trip.ts`
  (`hearth_key.ts`, type-only, for the three-valued admission answer) and
  `server/freehold_hearth_trip_host.ts` (`gate_rules.ts`, `hearth_key.ts`,
  `owner_key.ts`), which matches a session to the account by its owner key,
  merges the durable clock forward through `mergeFreeholdKeyReadyAt` and
  re-dispatches the use by item id.
  An extraction inherits the exception rather than creating one, which is why
  they are listed together; `server/freehold_revision_probe.ts` deliberately
  imports NOTHING from the sim, which is what makes it three integers and a
  boolean. The list is pinned in `tests/freehold_module.test.ts` so it cannot go
  stale the next time a module comes off. These are the server-side durable
  consumers of leaves whose vocabulary nothing else wants, and
  `FREEHOLD_VISIT_POLICIES` is deliberately off the barrel for that reason:
  putting a server-facing durable vocabulary on the surface every UI and sim
  caller reads, for one consumer, is the cost the rule above exists to avoid.
  `server/game.ts` is a by-path importer of a different kind: it
  reaches `gate_rules.ts` only, for the one item id the dark-realm gate, the
  jail gate and the coordinator's dispatch key on, which the sim dispatches on
  by use type rather than by id.
  SECOND, the CLIENT modules import `gate_rules.ts` by path for its value
  constants: `src/ui/hud/housing/gate_prompt_controller.ts`,
  `src/ui/hud/housing/hearth_key_tooltip.ts`, `src/game/nearby_interaction.ts`,
  `src/game/nearby_interaction_core.ts`, `src/game/interactions.ts`, and the
  render cores that draw, pick and prewarm the gate:
  `src/render/delve_interactable_visibility_core.ts`,
  `src/render/pick_resolution.ts` and `src/render/prewarm_policy.ts`. Routing
  those through the barrel would pull `commands.ts`, `instance.ts` and
  `persisted.ts` into the client bundle for a handful of numbers, so
  `gate_rules.ts` is licensed here as a client-safe leaf; the list is derived
  and pinned by `tests/freehold_module.test.ts`.
- Design: `docs/prd/woc/freeholds-and-guildhalls-research.md` (the research
  and the decision record it cites).
- Cover changes in `tests/freehold_module.test.ts` (the dark-host pins: null
  descriptors, the shared clock base, every stub mutation-free and draw-free,
  the lit pair's text-free dark refusal, the record round-trip, the vocabulary
  and purity source scan), `tests/freehold_instance.test.ts` (the claim, the
  refusals, the reap, the relog, the busy pool, determinism),
  `tests/freehold_offline_default.test.ts` (the default record, the dark host,
  the save, the paired evict), `tests/freehold_dev_grant.test.ts` (the
  permission matrix, the chat arm, the one tier writer),
  `tests/freehold_gate_and_key.test.ts` (the gate confirmation, the forward-only
  durable clock merge, the remote use with its local clock and the host
  admission), the `freehold_claim`
  and `freehold_hearth_key` parity scenarios, `tests/freehold_state.test.ts` (the
  durable record: the
  five load arms, the two measured byte ceilings and their fixtures, the
  save-path refusal and the writable-implies-readable property), and
  `tests/sim_context.test.ts` (the `freeholds` live view and the
  `freeholdsEnabled` / `freeholdDevGrantEnabled` read-throughs).
