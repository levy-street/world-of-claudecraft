# src/sim/pvp - WARFARE progression and rating rules

Host-agnostic PvP progression: the honor currency, the combat ratings, and the
honor-vendor spawn. WARFARE is the player-facing umbrella name; internal `pvp*`
identifiers stay as descriptive compatibility names for the two mechanical
ratings.

- `honor.ts` owns currency grants, reward constants, UTC-day rollover, and the
  anti-farm diminishing returns. It must use `SimContext` state and the
  HOST-provided UTC day, never a wall clock.
- `honor_event.ts` owns the weekly Double Honor Weekend: the window decision
  (pure weekday arithmetic, no `Date`, on TWO host-provided keys: `resetDay`
  plus the `eventLeadDay` probe read `DOUBLE_HONOR_LEAD_HOURS` ahead of now,
  open when either reads a weekend day, so the window runs Friday 3 PM to
  Monday 3 AM realm time) and the event multiplier the four BATTLEGROUND
  award paths in `honor.ts` apply (result, kill, assist, first-win bonus;
  arena and Fiesta honor never read it, per the issue's 5v5-only scope).
  During the window a played-out loss or draw also pays the WIN base (the
  weekend loss boost in `awardBattlegroundHonor`). The event stays off only
  when BOTH keys are empty (no host calendar): a host feeds both keys or
  neither, never just one.
- `power.ts` owns rating conversion, the independent offense/defense caps, the
  hostile-player damage multiplier, and WARFARE Vitality's health fraction
  (`pvpVitalityFromRating`). It must stay pure and deterministic.
- `vitality.ts` decides WHERE Vitality applies (never on the instance plane
  outside a battleground or arena match) and flips `Entity.pvpVitalityActive`,
  recalculating only players whose state changed; `entity.ts` applies the
  fraction to maxHp. Pinned by the `WARFARE Vitality` block in `tests/honor.test.ts`.
- `honor_persist.ts` owns the persisted form of the honor ledger and its daily
  DR window (`savedHonorState` / `loadHonorState`), moved out of the Sim
  coordinator's serialize/load so a new honor field lands here, not in `sim.ts`.
- `world_pvp_rules.ts` owns the World PvP (`/pvp` flag) PURE rules: the pair
  verdict over the two flags AND the two zone policies (`worldPvpPairHostile`,
  also read by the renderer and the HUD through `src/ui/pvp_hostile_core.ts`)
  with its same-player and party/raid exemptions (`worldPvpPairExempt`, which
  cuts through every zone, free-for-all ground included; a shared guild is NOT
  an exemption, guildmates outside one group fight), the marking rule
  (`worldPvpHitMarksAttacker`: only a hit that needed NO flag marks, so hitting
  a flagged player never does), the gold stake, the equal split with the killing
  blow taking the remainder, the grey-level rule, and the per-pair DR multiplier
  (shared `HONOR_REPEAT_DR`) over its own `WORLD_PVP_DR_WINDOW_SECONDS` (one
  hour) window. It also declares `WorldPvpZonePolicy`, the three-answer type the
  next bullet resolves. No ctx, no rng, no clock.
- `world_pvp_zones.ts` owns the ground policy: which of `'sanctuary'`,
  `'contested'` and `'ffa'` applies at a position (`worldPvpZonePolicyAt`) or to
  a zone record (`worldPvpZonePolicyOf`), read off `ZoneDef.worldPvp`
  (data-as-code in `src/sim/content/`, absent meaning contested). A sanctuary
  under EITHER player switches the world off (the Proving Shore and Eastbrook
  Vale, so a new character cannot be fought); both players on free-for-all
  ground are hostile with no flag at all (the Drakelands, the Frostveil Reach and
  the Amberfall, the map's top row); everything else is the mutual-flag rule. The lookup is the strict
  rectangle containment (`zoneContaining`, never the clamping `zoneAt`), so the
  instance plane reads as contested and the open-world policy cannot leak into a
  dungeon, delve, arena or battleground floor. Pure and host-agnostic: the sim's
  hostility arm, the nameplate colour and the target frame read the same verdict
  for the same coordinates.
- `world_pvp_spoils.ts` owns the World PvP DROP: when the victim and the
  killing blow are both flagged, the kill resolution in `world_pvp.ts` hands the
  blow's gold share to `placeWorldPvpSpoils`, which puts it on the victim's body
  beside a `pvp_trophy_skull`, tapped to the killer so the ordinary corpse
  loot path takes it. The skull is a PROVENANCE-TRACKED stack
  (`world_pvp_trophy.ts`, fed to the material registry as
  `trophyMaterialItemIds`): every skull shares one bag stack, and each unit
  carries its victim as a material-source bucket (`worldPvpSkullSources`, the
  victim's gatherer identity plus the name they died under), so the counts ride
  every bank, mail, trade and market path materials already ride. The client
  lists the buckets as "2 x Taken from Bet" and names a single-victim stack
  "<name>'s Skull" (`src/ui/item_copy_name_core.ts`). `settleWorldPvpSpoils`
  pays anything unlooted to the killer (or refunds the gold to the victim when
  the killer is gone) the moment the body stops being one: `spirit.ts` calls it
  on release and on every revive, and the zone pass sweeps any other exit
  (`sweepWorldPvpSpoils`). The books row is `WorldPvpBooks.spoils` (victim pid
  -> killer pid), bounded by the flagged players lying dead with spoils. It must
  not import `bags.ts` (that module loads the material tables at import time,
  before the content they derive from); the room check is `ctx.canAddItem`.
  `world_pvp_trophy.ts` is a dependency-free leaf for the same reason: the
  material registry evaluates it before most of the sim loads.
- `skull_bag.ts` owns the Skull Bag, the honor-vendor sub-inventory for trophy
  skulls (`WORLD_PVP_SKULL_BAG_ITEM_ID`, declared in the trophy leaf; the stock
  row is `WORLD_PVP_GOODS_STOCK` in `content/pvp_honor.ts`). Its contents are
  `PlayerMeta.skullBag`, ONE material-source composition with no cap, absent
  when empty. `storeLootedSkulls` is the loot hook (the corpse take in
  `interaction.ts` and the spoils settlement both call it before their bag-room
  check), `skullBagAction` the one command entry (IWorld `skullBagAction`, wire
  `skull_bag`, dispatched by `server/world_pvp_wire.ts`; the action is
  untrusted here and every selection is read through the canonical
  composition validator), `skullBagInfoFor` the readout (folded into the
  IWorld readout by `worldPvpReadoutFor`, but never into the server's 2 Hz
  `worldPvpInfoFor`: online it rides its own change-gated `skb` key), and
  `savedSkullBag` / `loadSkullBag` the persisted form `savedWorldPvpFields` /
  `loadWorldPvpState` carry (`skullBagLoadValid` is the load guard
  `material_slot_load.ts` runs, refusing a corrupt bag like any skull stack). Like the spoils module it
  must not import `bags.ts`; the room check is `ctx.canAddItem`. Tests:
  `tests/skull_bag.test.ts`, the client half in `tests/skull_bag_view.test.ts`.
- `world_pvp.ts` owns the World PvP SYSTEM behind the `SimContext` seam: the
  flag state (`PlayerMeta.worldPvp`, absent until first raised; `Entity.pvpFlag`
  is its display mirror and the ONLY writer is this module, the away.ts
  meta<->entity precedent), the 5-minute disarm clock (deferred while in
  combat, ticked from `Sim.tick` in the battleground lap behind a
  `nextDisarmAt` watermark so an idle realm pays one comparison), the toggle
  cooldown, the realm kill switch (`ctx.worldPvpDisabled`, server env
  `WORLD_PVP_DISABLED=1`), the session books (`Sim.worldPvpBooks`, a live
  `ctx.worldPvpBooks` view: the assist recency rows, the paid-death guard, the
  watermark; swept once a minute so a player who leaves without dying leaves no
  row), the twice-a-second zone pass that announces a crossing once
  (`WORLD_PVP_FFA_ENTER_LINE` / `WORLD_PVP_FFA_LEAVE_LINE`, plus
  `WORLD_PVP_SANCTUARY_LINE` for a FLAGGED player entering a sanctuary; the
  hostility arm never waits on it, it re-reads the ground live), the damage /
  aid / death hooks the combat hub calls directly (the damage hook marks an
  unflagged aggressor who opens on an unflagged player, `WORLD_PVP_MARKED_LINE`;
  the SHARED aid hook `worldPvpOnPlayerAided` raises an unflagged caster's flag
  when they heal, shield or buff a FLAGGED player who is in a world fight, the
  classic rule, and is called from `combat/heal.ts` plus the `absorb` and
  `buffTarget` sites in `combat/effect_dispatch.ts`; aid to an UNFLAGGED player
  or given or received inside a sanctuary marks nobody), the kill resolution
  (stake + honor pool, integer copper and integer honor, zero rng, paid exactly
  once per death; gold is staked by a FLAGGED victim and taken by FLAGGED
  contributors only; two players mid-duel with each other are the duel's
  business, never the world's), the server-only `worldPvpKill` record each paid
  death fires for the Discord kill feed (both resolution arms, a no-earner kill
  included; no pid, no text, no rng; `server/event_frame.ts` strips it from
  client frames), the IWorld readout
  (`worldPvpInfoFor`, whole-second countdown so the self wire elides it), the
  `/pvp` chat arms' entry points, and the persisted record (`savedWorldPvpFields`
  / `loadWorldPvpState`, the countdown stored as remaining seconds and
  re-anchored on load; the level gate and the kill switch hold on restore). The
  diminishing returns are per PAIR and live in the session books
  (`WorldPvpBooks.killsByPair`, `worldPvpPairRepeats` / `notePairKill`), keyed by
  both characters' rename-proof identities over a rolling
  `WORLD_PVP_DR_WINDOW_SECONDS` window that opens at the first kill of that
  victim: a relog cannot reset them (the identity survives it) and a realm
  restart does, which is the owner's hour-window tuning. The persisted UTC-day
  counter is GONE (`honor.ts` no longer carries `worldKillRepeats` /
  `noteWorldKill` / `HonorArenaDailyState.worldKillsByVictim`); do not
  reintroduce a calendar-day window here. Every player notice is sim English
  with a matcher row in `src/ui/sim_i18n.ts` (the `worldPvp.*` block; the
  placeholder-free lines register in the auto-built EXACT map, the parametrized
  ones need a RULE). Numbers and rules: `docs/design/warfare.md`, "World PvP
  income"; tests: `tests/world_pvp.test.ts`, `tests/world_pvp_rules.test.ts`,
  `tests/world_pvp_zones.test.ts`, `tests/world_pvp_server_dispatch.test.ts`,
  and the matcher round trip in `tests/world_pvp_view.test.ts`.
- `world_pvp_bounty_rules.ts` owns the World PvP bounty PURE rules: the streak
  that earns one (`WORLD_PVP_BOUNTY_STREAK`), the doubled pool a holder's death
  pays (`worldPvpKillHonorPool`) and the holder's own per-victim honor curve
  (`worldPvpBountyHolderMultiplier` over `WORLD_PVP_BOUNTY_HOLDER_DR`). No ctx,
  no rng, no clock. `world_pvp_bounty.ts` owns the SYSTEM half: the streak and
  the bounty on `PlayerMeta.worldPvp` (session-only, never persisted),
  `Entity.bounty` as the display mirror written ONLY there (the `bty` entity
  wire bit, `server/entity_status_wire.ts` / `src/net/entity_status_wire.ts`),
  and the realm and holder notices the client matcher re-localizes (the
  `worldPvp.bounty*` rows in `src/ui/sim_i18n.ts`). Its two callers are
  `world_pvp.ts`'s death hook (any death ends a bounty; a paid kill builds a
  flagged contributor's streak) and its disarm pass (the flag dropping ends
  it). Numbers: `docs/design/warfare.md`, "World PvP bounties"; tests:
  `tests/world_pvp_bounty.test.ts`.
- `world_pvp_forfeit.ts` owns the departure forfeit: `worldPvpFightOpponent`
  (the most recent live, world-hostile enemy who hit the player inside the
  assist window, else the one they hit) and `forfeitWorldPvpFightOnDeparture`,
  which the SERVER calls from `socketClosed` and from `leave()` (every logout,
  kick and takeover; skipped for an escrow-quarantined session that can no
  longer save), via `server/world_pvp_departure.ts`; the offline Sim and the
  RL env have no departure to judge. It kills the leaver through `ctx.handleDeath` with
  `WorldPvpBooks.forfeitVictim` set, so `worldPvpOnPlayerDeath` resolves the
  kill by its usual rules but HOLDS each gold share instead of paying it.
  `world_pvp_payouts.ts` owns the held shares (`WorldPvpMetaState.pending` on
  the WINNER, persisted as remaining seconds, capped at
  `WORLD_PVP_PENDING_PAYOUT_LIMIT` on load) and the due pass `updateWorldPvp`
  runs behind the `nextPayoutAt` watermark. Delay: `WORLD_PVP_FORFEIT_PAYOUT_SECONDS`
  in `world_pvp_rules.ts`. Lines: `worldPvpForfeitKillLine`,
  `worldPvpForfeitPayoutLine` (matcher rows in `src/ui/sim_i18n.ts`). Tests:
  `tests/world_pvp_forfeit.test.ts`, `tests/world_pvp_departure.test.ts`.
- `warfare_quartermaster.ts` spawns Warmarshal Draven Kole, the Highwatch
  WARFARE honor vendor, under his RESERVED entity id
  (`WARFARE_QUARTERMASTER_ENTITY_ID`, `1_000_000_002`, the singleton band
  beside `VALE_CUP_BRAM_ID` and `FURY_ENTITY_ID`). His `NpcDef` lives in
  `content/zone3.ts` with `dynamic: true` so the generic world-init NPC loop
  skips him: creating him in table order would shift the entity id of every
  NPC, camp mob, and ground object created after him and red the parity
  goldens. The `Sim` ctor spawns him after the rng-drawing camp loop through
  the same rng-free `findSafePos` path the generic loop uses, so neither
  `nextId` nor the shared rng stream moves
  (`tests/warfare_vendor_npc.test.ts` asserts both). His stock is the one
  canonical `content/pvp_honor.ts` table, shared with FURY.
- `world_pvp_rewards_rules.ts` owns the five literal played-time thresholds,
  the seven-day counter cap, saved-tick sanitization and the pure 10% XP bonus.
  `grantXp` imports the leaf directly and applies the bonus before rested XP and
  lifetime accounting; pending disarm and the realm kill switch stop it. The
  multiplier is XP-only and does not change faction reputation.
- `world_pvp_rewards.ts` advances one bounded scalar per connected, armed
  player per tick and grants permanent deeds only at five threshold crossings.
  Dead players, disconnect grace, leaving players, sanctuaries and PvE
  instances pause it. Arena (ranked, Fiesta and Protect Yumi) and battleground
  membership keeps time running while alive, including prep and return holds;
  membership uses two keyed probes rather than scanning match collections.
  `worldPvpInfoFor` shares the pause predicate and sends whole played minutes
  as seconds, while saves retain precise ticks. Reward leaf imports are direct
  because exporting the system through the barrel would introduce a runtime
  cycle through entity/deed initialization.
- `pvp_resurrect.ts` owns the PvP Resurrect RULE (owner rule 2026-10-02): a
  player death outside the instance plane, not jailed, whose killing blow came
  from a hostile player or that took a hostile player's hit within
  `PVP_RESURRECT_WINDOW_SECONDS` (10), offers a raise at the graveyard Release
  picks at full health and mana with no Keeper's Toll. `worldPvpOnPlayerDeath`
  stamps `Entity.pvpResurrect` at every player death from the same hostile-hit
  books the kill credit reads; the raise is `spirit.ts` `pvpResurrect` (refused
  to a ghost). A living player's death resets the stamp before deciding it
  (`combat/damage.ts` `handleDeath`), so a revive that skips `reviveAt`
  (battleground seating, the delve respawn) can never carry an offer into a
  later death; `reviveAt` clears it too. The raise waits
  `PVP_RESURRECT_WAIT_SECONDS` (15) from the death (`Entity.pvpResurrectWait`,
  counted down in `combat/auras.ts` `updateTimers`, which visits corpses; a
  second death-hook pass never restarts it), shipped on the self record as whole
  seconds `pvrw`. The self record carries the offer as `pvr`,
  lit only when the raise would be honored (`server/self_scalar_wire.ts`); the death screen's button is
  `src/ui/hud/death`. Imported by path from `world_pvp.ts` and `spirit.ts` (it
  imports neither, so no cycle). Pinned by `tests/pvp_resurrect.test.ts`.
- Import the directory's public API through `src/sim/pvp/index.ts`, with ONE
  deliberate exception: `warfare_quartermaster.ts` is NOT re-exported there
  (see the comment in `index.ts`). It needs `createNpc` from `../entity` at
  runtime while `entity.ts` imports this barrel, so re-exporting it would
  close a value-level ESM cycle. Its single consumer is the Sim coordinator at
  world init; import it by path.
- Keep reward amounts and rating curves named and covered in
  `docs/design/warfare.md`.
- Cover changes in `tests/honor.test.ts` and `tests/pvp_honor_gear.test.ts`,
  including host parity, PvE non-interference, cap behavior, and exact reward
  accounting.

## King of the Hill

- `hill_rules.ts` owns the PURE rules: who counts (`hillStanding`: parties
  only, so a raid member does not; any level does), the group key (`hillGroupKey`: a party, or a lone
  player as a group of one; null for a raid), the strict-maximum leader
  (`hillLeader`, null on a tie), the majority verdict (`hillChallengeStands`),
  the per-group contest clocks (`hillProgressStep`: a rival only pauses a clock,
  nobody counted inside drops it), the key a hold or a clock follows across a
  group change (`hillSuccessorKey`), the spot probe (`hillSpotIsOpen` over a
  `HillSpotProbe` the sim binds to the terrain, the water bodies, the collider
  grid and the static zones), the three-hour schedule (`hillWindowAt`,
  `hillTimes` from a window and a warning offset, `hillMinutesUntil`) and the
  circle test. No ctx, no rng, no clock. Every tuning literal (`HILL_RADIUS`,
  `HILL_WINDOW_SECONDS`, `HILL_WARNING_SECONDS`, `HILL_DURATION_SECONDS`,
  `HILL_NOTICE_SECONDS`, `HILL_VAULT_MIN_INSIDE_SECONDS`, `HILL_VAULT_MIN_HOLD_SECONDS`,
  `HILL_CAPTURE_SECONDS`, `HILL_ACCRUAL_SECONDS`, the flat payout `HILL_HONOR_PER_PAYOUT`) lives
  here and the copy resolves from it.
- `hill.ts` owns the SYSTEM behind the `SimContext` seam: the session state as
  ONE live view (`Sim.hillState`, `ctx.hillState`: the announced or standing
  hill with its phase, the next window's plan and spot retries, the presence
  counts, the contest clock, the accruals; never persisted), the plan
  (`hillPlanFor`: the warning's offset inside the window from a PRIVATE rng
  derived from the seed and the window's ordinal, the rift portal precedent, so
  the world stream never moves), the spawn (`spawnHill`, whose spot rng salts
  in the attempt number so a retry searches new ground), the `/dev hill` test
  levers (`spawnHillNow`, `riseHillNow`, `endHillNow`, `warnNextHillNow`; their
  argument grammar is the pure `hill_dev.ts`), the once-a-second `updateHill` pass (the
  phases warning, risen, fallen, each announced to the realm, with the server-only
  `hillAnnounced` twin for the Discord PvP channel beside each line: no text, no pid,
  times relative to the announcement; then, only while risen, presence by party,
  the holder following its roster across a group change (`reconcileHolder`) and
  clocks following theirs (`carryProgress`), contest, payouts through `grantHonor` with reason
  `hill_hold`), the readout (`hillInfoFor`, live fields only for a viewer in the
  hill's zone while it is risen, so the self wire elides it elsewhere), the
  `/hill` readout line, and the notice lines the client matcher re-localizes
  (`hillWarningLine`, `hillRiseLine`, `hillFallenLine` with the zone name,
  `HILL_TAKEN_LINE`, `HILL_LOST_LINE`, `hillStillStandsLine`, `hillRankLine`,
  `HILL_VAULT_LINE`). While risen it re-announces the hill every
  `HILL_NOTICE_SECONDS` with the hold standings; the fall (`fallHill`, shared by
  the schedule and `/dev hill end`) announces the final standings and, when the
  longest hold lasted `HILL_VAULT_MIN_HOLD_SECONDS`, pays its holders one Weekly
  Vault PvP win through the host-injected
  `HillVaultCredit` (`updateHill(ctx, credit)`, `endHillNow(ctx, credit)`): this
  barrel must never import `weekly_rewards.ts`, which reaches `entity.ts`. The
  realm switch (`ctx.worldPvpDisabled`) drops a standing hill and announces none
  (no standings, no credit). Pinned by `tests/hill.test.ts`,
  `tests/hill_rules.test.ts` and `tests/hill_ranking.test.ts`.
- `hill_ranking.ts` owns the PURE hold ranking over the per-group records on
  `ActiveHill.holds` (`HillHoldRecord`: seconds held over the whole stand, the
  leader's or lone player's name, the payees): `hillRanking` (longest first,
  first-held order on a tie), `hillLongestHolds` (every group tied at the top)
  and `hillVaultPayees` (their holders, each once; nobody when the longest hold
  is under the floor). No ctx, no rng, no clock.
