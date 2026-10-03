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
  under EITHER player switches the world off (only the Proving Shore;
  Eastbrook Vale is contested). The Drakelands, Frostveil Reach and Amberfall
  are also contested: normal mutual flags are required. The generic free-for-all
  policy remains supported, but these zones no longer select it. The lookup is the strict
  rectangle containment (`zoneContaining`, never the clamping `zoneAt`), so the
  instance plane reads as contested and the open-world policy cannot leak into a
  dungeon, delve, arena or battleground floor. Pure and host-agnostic: the sim's
  hostility arm, the nameplate colour and the target frame read the same verdict
  for the same coordinates.
- `world_pvp.ts` owns the World PvP SYSTEM behind the `SimContext` seam: the
  flag state (`PlayerMeta.worldPvp`, absent until first raised; `Entity.pvpFlag`
  is its display mirror and the ONLY writer is this module, the away.ts
  meta<->entity precedent), the 5-minute disarm clock (deferred while in
  combat or inside an active hill, ticked from `Sim.tick` in the battleground
  lap behind a `nextDisarmAt` watermark). Active hill entry is checked every
  simulation tick and raises the ordinary flag with the normal eligibility
  gates; leaving or ending a hill does not clear it. It also owns the toggle
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
  business, never the world's), the IWorld readout
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
  later death; `reviveAt` clears it too. The self record carries it as `pvr`,
  lit only when the raise would be honored (`server/self_scalar_wire.ts`); the death screen's button is
  `src/ui/hud/death`. Imported by path from `world_pvp.ts` and `spirit.ts` (it
  imports neither, so no cycle). Pinned by `tests/pvp_resurrect.test.ts`.
- `world_pvp_rewards_rules.ts` owns the pure 20% XP/reputation bonus, five
  played-time title thresholds and bounded tick normalization. XP includes
  lifetime XP. XP, faction and UI consumers import this leaf directly to avoid
  the barrel runtime graph (a second deliberate direct-import exception).
- `world_pvp_rewards.ts` accrues connected, armed played ticks and grants deeds
  only at threshold crossings. Only a living player on open-world ground ticks;
  `worldPvpRewardPause` names the cause otherwise (dead, the instance plane, the
  tutorial island sanctuary) and feeds both the tick and the IWorld readout.
  Logout preserves progress; requesting disarm resets it. Save full ticks,
  publish whole minutes.
- Import the directory's public API through `src/sim/pvp/index.ts`, with the rewards leaf exception above and another
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

- `hill_bounty_rules.ts` owns the PURE bounty tables (League of Legends'
  champion bounty scaled to 10 Honor, `hillBountyHonor`), the per-hill repeat
  cap (`hillRepeatHonorMultiplier`) and the announcer's calls
  (`hillStreakCallout`). `hill_bounty.ts` owns the per-hill books on
  `ActiveHill.bounty`: which world kills are hill kills (`hillKillFor`, called
  from `worldPvpOnPlayerDeath`), the streaks, the `Entity.hillBounty` badge,
  the readout's `callout` (`hillCalloutFor`) and the teardown at every way a
  hill ends (`clearHillBounties`). It imports neither hill.ts nor world_pvp.ts
  at runtime (ActiveHill is a type import), so both can call in. Pinned by
  `tests/hill_bounty.test.ts`; docs/design/warfare.md "Bounties".
- `hill_rules.ts` owns the PURE rules: who counts (`hillStanding`: parties
  only, so a raid member does not; level 10 or above), the group key (`hillGroupKey`: a party, or a lone
  player as a group of one; null for a raid), the strict-maximum leader
  (`hillLeader`, null on a tie), the majority verdict (`hillChallengeStands`),
  the contest clock (`hillContestStep`), the spot probe (`hillSpotIsOpen` over a
  `HillSpotProbe` the sim binds to the terrain, the water bodies, the collider
  grid and the static zones), the two-hour schedule (`hillWindowAt`,
  `hillTimes` from a window and a warning offset, `hillMinutesUntil`) and the
  circle test. No ctx, no rng, no clock. Every tuning literal (`HILL_RADIUS`,
  `HILL_WINDOW_SECONDS`, `HILL_WARNING_SECONDS`, `HILL_DURATION_SECONDS`,
  `HILL_NOTICE_SECONDS`,
  `HILL_CAPTURE_SECONDS`, `HILL_ACCRUAL_SECONDS`, the payout ramp `hillHonorPerPayout` with `HILL_RAMP_STEP_SECONDS` and `HILL_RAMP_MAX_HONOR`) lives
  here and the copy resolves from it. Hills last 30 minutes; payout and ramp
  intervals are compressed by 29/44 to preserve 388 Honor for a full uncontested
  hold after the one-minute capture. `hill_zones.ts` selects the three northern
  spawn zones independently of their World PvP ground policy.
- `hill.ts` owns the SYSTEM behind the `SimContext` seam: the session state as
  ONE live view (`Sim.hillState`, `ctx.hillState`: the announced or standing
  hill with its phase, the next window's plan and spot retries, the presence
  counts, the contest clock, the accruals; never persisted), the plan
  (`hillPlanFor`: the warning's offset inside the window from a PRIVATE rng
  derived from the seed and window zero, reused each window so scheduled hills
  are exactly two hours apart; the world stream never moves), the spawn (`spawnHill`, whose spot rng salts
  in the attempt number so a retry searches new ground), the `/dev hill` test
  levers (`spawnHillNow`, `riseHillNow`, `endHillNow`, `warnNextHillNow`; their
  argument grammar is the pure `hill_dev.ts`), the once-a-second `updateHill` pass (the
  phases warning, risen, fallen, each announced to the realm; then, only while
  risen, presence by party, contest, payouts through `grantHonor` with reason
  `hill_hold`), the readout (`hillInfoFor`, live fields only for a viewer in the
  hill's zone while it is risen; geometry and phase remain available elsewhere
  and during the warning for the map markers), the
  `/hill` readout line, and the notice lines the client matcher re-localizes
  (`hillWarningLine`, `hillRiseLine`, `hillFallenLine` with the zone name,
  `HILL_TAKEN_LINE`, `HILL_LOST_LINE`, `hillStillStandsLine`, `hillRankLine`,
  `HILL_VAULT_LINE`). While risen it re-announces the hill every
  `HILL_NOTICE_SECONDS` with the hold standings; the fall (`fallHill`, shared by
  the schedule and `/dev hill end`) announces the final standings and pays the
  longest hold's holders one Weekly Vault PvP win through the host-injected
  `HillVaultCredit` (`updateHill(ctx, credit)`, `endHillNow(ctx, credit)`): this
  barrel must never import `weekly_rewards.ts`, which reaches `entity.ts`. The
  realm switch (`ctx.worldPvpDisabled`) drops a standing hill and announces none
  (no standings, no credit). Pinned by `tests/hill.test.ts`,
  `tests/hill_rules.test.ts` and `tests/hill_ranking.test.ts`.
- `hill_ranking.ts` owns the PURE hold ranking over the per-group records on
  `ActiveHill.holds` (`HillHoldRecord`: seconds held over the whole stand, the
  leader's or lone player's name, the payees): `hillRanking` (longest first,
  first-held order on a tie), `hillLongestHolds` (every group tied at the top)
  and `hillVaultPayees` (their holders, each once). No ctx, no rng, no clock.
