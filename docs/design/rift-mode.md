# Rift Mode architecture

Rift Mode is a shared overworld race whose dungeon runtime remains isolated per
group. A natural portal owns one `RiftEvent`; each solo player or party entering
that event owns a separate `RiftInstance`. Instances share only the immutable
content artifact and the event's atomic first-clear claim.

## Runtime flow

1. `rift/portals.ts` keeps one deterministic C/B/A/S portal open in EVERY
   eligible new-world zone, cycling hourly (a zone's next portal opens one
   cycle after the previous one opened).
2. The existing procedural generator creates the draft and remains authoritative
   for layouts, colliders, mechanics, and safe spawn points.
3. `rift/upgrader_draft.ts` immediately builds a validated heuristic upgrade. The
   live realm may replace it with an AI result before anybody enters.
4. Entry freezes the artifact (`contentLocked`) and allocates one independent
   instance per group. Every competing instance receives the same artifact hash.
5. `rift/race.ts` performs the single-threaded check-and-write first-clear claim.
   The winner receives the race rewards; every other instance keeps running and
   completes as the race loser when its own boss falls, with an egress but NO
   completion loot (no gear ladder, no sealed cache, no first-clear extras): a
   loser keeps only what dropped off the mobs. The first mob kill marks an
   instance PROGRESSED, which binds its members to it WoW-raid style; unspoiled
   instances recycle when their members regroup, so a freshly formed party
   shares one clean run.
6. `rift/persistence.ts` saves portal deadlines, event history, winner metadata,
   scheduler state, and upgrade artifacts. Runtime party instances are never
   restored after a realm restart.

## AI Dungeon Upgrader

The server integration is optional and disabled unless configured. Model output
is untrusted data: `rift/upgrade.ts` rebuilds a bounded manifest and rejects unknown
themes, invented monster IDs, incompatible rosters/bosses, arbitrary stats,
executable content, excessive prose, and excess asset requests. Invalid, timed-out,
over-budget, or late responses leave the deterministic heuristic artifact in use.

The dedicated-service configuration is:

- `RIFT_UPGRADER_URL`
- `RIFT_UPGRADER_API_KEY` (optional when the service uses network identity)
- `RIFT_UPGRADER_TIMEOUT_MS` (2-60 seconds, default 20 seconds)
- `RIFT_UPGRADER_MAX_REQUESTS_PER_HOUR` (1-24, default 4)

Direct OpenAI Responses API mode is selected only when both are present:

- `OPENAI_API_KEY`
- `RIFT_UPGRADER_MODEL`

`RIFT_UPGRADER_OPENAI_URL` may override the official Responses endpoint. Secrets
remain server-side and are never emitted, persisted in Rift state, or sent to a
client.

## Rank difficulty

Rank (C/B/A/S) is the ONLY difficulty axis: a rift never scales with party size,
and mob levels are capped at 22 (23 at S), so all four ranks differ purely
through the spawn-time stat transform in `rift/ranks.ts`, the rank mechanic
budget (C=1 .. S=4 of a boss's `rankMechanics` kit), and the hazard gate.
Rifts are group content at every rank including C.

The ladder is calibrated onto the v0.30 dungeon ladder: C is a normal dungeon
(normal Gravewyrm Sanctum's own line), B is the heroic five-man line at 1.0x, A
is 1.2x heroic, S is 1.33x heroic. Health and damage are split by mob class
(spawn-list trash, boss, boss-summoned add), because one multiplier per rank
cannot serve two classes at once. The full derivation, the Monte Carlo benches,
the decision ledger, and pre-measured fallback options are in
[../rift-rank-monte-carlo-analysis.md](../rift-rank-monte-carlo-analysis.md);
every tuning literal and floor is pinned by
`tests/rift_difficulty_floors.test.ts`. Re-run the benches with
`npm run sim:rift`.

Note that only SPAWN-LIST templates (`RIFT_TRASH_IDS`) may be substituted into a
floor roster by an upgrade manifest. The shared summoned-add templates are
non-boss and appear in the bone, void and citadel theme rosters, but they are
non-elite and carry no loot table, so `applyRiftUpgrade` filters them out.

## Monster and asset safety

`content/rift/monster_index.ts` indexes every static Rift `MobTemplate` by role,
rarity, family, mechanics, lore, theme, biome, and stat profile. The upgrader may
compose encounters from this index, but combat always resolves through static
templates in `MOBS`.

Runtime asset generation is separately opt-in:

- `RIFT_RUNTIME_ASSETS=1`
- `RIFT_ASSET_PIPELINE_URL`
- `RIFT_ASSET_PIPELINE_API_KEY` (optional)
- `RIFT_ASSET_TIMEOUT_MS`
- `RIFT_ASSET_MAX_REQUESTS_PER_EVENT` (1-2, default 1)

The bridge submits bounded GLB jobs and records only an opaque job ID. A generated
binary is not hot-loaded into a live race. It must first pass QA and be promoted to
the immutable asset manifest, preserving graphics fairness, cacheability, and the
rule that no untrusted remote URL enters entity wire data.

## Progression

First-clear loot includes a class-appropriate non-fungible Riftbound band, Rift
Essence, and (on A and S clears) one Rift gem per winner. The band's static
ItemDef is a stat-free shell; the copy's `rift` payload records the clear's
rank, its essence upgrades, and its socketed gems, and `src/sim/rift/band_ladder.ts`
prices the whole ring from those three inputs:

- **Item level.** The rank sets the base (`RIFT_BAND_TIER_BASE_ILVL`), every
  essence upgrade raises it by one (`RIFT_BAND_MAX_UPGRADE` steps, essence cost
  2, 4, 6, 8, 10), and `RIFT_BAND_ILVL_CAP` holds the ladder one step under the
  current raid ring line, so a maxed band is the best ring outside the raid and
  never the best ring in the game. The tooltip's item-level line reads the copy
  (`src/ui/rift_band_tooltip.ts`), since `item_level.ts` has no drop source to
  derive it from.
- **Primary stats.** The epic-ring budget at that item level
  (`item_budget.ts` `primaryStatBudget`), split 3:2 on the class shell's
  primary and secondary stat. A band at level N carries exactly what an authored
  epic ring at level N would.
- **Gems.** Sockets never touch the item level or the primary budget. A gem is
  one combat rating line keyed by colour (`RIFT_GEM_RATING_STAT`: crimson is
  crit, azure is haste, verdant is hit), `RIFT_GEM_RATING` each, sized so a
  full S band (two sockets) stays under the single rating line the raid rings
  carry. Sockets are replaceable: a full band takes a new gem in place of its
  oldest one, which is destroyed, so a player retunes hit against crit or haste
  without discarding the band. There is no forge enchant (the original third
  forge command retired with the ladder; its wire token survives as a
  dispatch-only no-op because the vocabulary is append-only).

The rolled aggregate applies while equipped, survives save/load and wire
round-trips, and is rebuilt from the bounded inputs at every load rather than
trusted from JSONB (`sanitizeRiftGearInstance`): a ladder retune resizes every
existing band at its next load, and the pre-ladder payload fields (`baseStats`,
`enchant`) are dropped there. Bands are forge-only: the enchanting profession
refuses them by id. Salvage returns rank-and-upgrade-scaled Rift Essence.
Pinned by `tests/rift_band_ladder.test.ts` and `tests/rift_progression.test.ts`.

Rift Essence and the rank-dependent gems are plain, freely tradeable forge
currency: tradeable in person, mailable, and listable on the World Market and the
guild bank, like any other crafting material. This is deliberate, not an
oversight: unlike the three first-clear Riftbound rings (owner-bound personal
reward gear, `RIFT_GEAR_ITEM_IDS`), the currency is boss loot bound by the
ranked portal spawn cadence, never a re-grantable faucet, so closing its market
and mail routes (the way a re-grantable faucet or a store SKU is closed
elsewhere in the item catalog) has no exploit to guard against.

The forge (upgrade, socket) is an NPC service: Riftwright Maelis
(`riftForge: true` in `content/farshore.ts`, Gullhaven's Watch Meadow) opens the
Rift Forge window (`src/ui/hud/rift_forge/`, a pure view-core plus a thin
window on the guild-board shape) through the structured `riftForge` interact
event, the bank precedent. The place rule lives in the sim
(`rift/forge_gate.ts`, `nearRiftForge`): both forge operations refuse away
from a riftForge NPC with the shared "too far from the Rift Forge" error line
(returned as reason `too_far`, never emitted as a `riftForgeResult`, the `dead`
contract), so the offline world, the headless env, and the authoritative server
enforce it identically. Only bagged bands are forgeable (the sim resolves the
target through the inventory); the window lists a worn band with an unequip
hint. The forge currency ladder is the sim's own (`riftUpgradeCost`, 2 essence
at the first step rising by 2 per step to the fifth; one gem per socket, a
full band replacing its oldest gem), quoted by the window from those exports
rather than re-derived. The window also quotes the item level each essence
step buys (`rift/band_ladder.ts` `riftBandItemLevel`).

The server's `RIFT_FORGE_ENABLED` gate (`server/rift_forge_gate.ts`, pinned by
`tests/rift_forge_gate.test.ts`) is an ops kill switch rather than an
opt-in: `0` (or `false`, `off`, `no`) closes the two wire commands, unset
and anything else keeps them open. The dispatch arms (`server/rift_forge_dispatch.ts`)
answer the `commandOutcome` ack with the sim verdict, and the client sends
them through `cmdWithOutcome`, so a closed realm or a sim refusal always
surfaces as a visible status line in the window, never as silence. Each
refused-while-closed attempt still books the `woc_rift_forge_refused_total`
counter. The retired third token, rift_enchant_item, is outside the switch on
purpose: its arm is a no-op that can spend nothing, so a crafted frame
carrying it books no refusal and is a deliberate blind spot, not a leak. The
switch only works where the server sees the variable: `docker-compose.yml`
forwards it, and a deploy template that renders its own compose must too.
