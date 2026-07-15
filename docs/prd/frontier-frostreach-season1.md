# The Frostreach Frontier: Season 1 (implementation slice of frontier-pvp.md)

Status: WIP draft. Implements a focused Season 1 slice of the Frontier spec
(`docs/prd/frontier-pvp.md`, shipped-foundation note in
`docs/prd/pvp-honor-and-quartermaster.md`, #1817). Scope here is the operator's
requested v1: an always-on frost PvP zone with frost rares that drop honor and a
new hero-points currency, open PvP inside the band, honor daily quests, a hub
vendor that sells the item-level 31 Season 1 PvP set for hero points, and a PvP-window
travel surface to enter and leave the zone the same way you queue Fiesta or the Arena.

## What Season 1 is

A factionless, always-on, frost-themed open-world PvP band far east of the world
(`FRONTIER_X_MIN = 14000`, past the yumi maze band and short of the Vale Cup
practice pitches). You travel in from the PvP window; everyone in the band is
hostile to everyone else (no teams, the RuneScape-Wilderness rule); one safe hub
holds the vendor, the daily giver, and (planned) the graveyard. Killing the frost
rares that roam it drops honor (via the shipped `grantHonor`) and hero points (the
new Season 1 currency); hero points buy the item-level 31 PvP set from the hub
Quartermaster.

## Geometry (single source: `src/sim/pvp/frontier.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `FRONTIER_X_MIN` / `FRONTIER_X_MAX` | 14000 / 20000 | the band's x-extent, clear of the arena (4200), delve (4800+), and yumi (8000-12000) bands and the Vale Cup pitches (30000) |
| `FRONTIER_HUB` | `{ x: X_MIN + 40, z: 0 }` | the safe-hub centre; the vendor and Marshal spawn here |
| `FRONTIER_HUB_RADIUS` | 34 | the safe circle: PvP is suppressed inside it (`inFrontierHub`) |

`isFrontierPos(x)` is the band test every system keys off (hostility, rewards, the
travel surface, the world-bounds exemptions). The band lives on the same heightfield
as the overworld, just far away, reached only by the travel command below.

## How you enter and leave (the PvP-window travel surface)

The Frontier is a persistent zone, not a matchmade bracket, so there is no queue:
the PvP window (the Ashen Coliseum / arena window, which already hosts the 1v1, 2v2,
Fiesta, and yumi queues) gains a **Frostreach Frontier** control that shows
**Travel to the Frontier** when you are outside and **Return from the Frontier** when
you are inside.

- `IWorld.frontierEnter()` / `frontierLeave()` (the `IWorldDuelArena` facet), wired
  as the `frontier_enter` / `frontier_leave` commands. Implemented in the offline
  `Sim` and the online `ClientWorld`; server-authoritative in `server/game.ts`.
- Enter hard-teleports the player to a deterministic per-player ring around the hub
  centre (no rng, no stacking), after remembering the overworld spot they came from
  in `PlayerMeta.frontierReturn` (persisted, so leaving still works across a relog).
  Leave teleports back to that spot and clears the record.
- Gated: you cannot enter while dead (the shared "can't while dead" toast) or in
  combat, and you cannot leave in combat (no teleport-escape from a fight). Those
  rejections are silent no-ops the window guards by disabling the button; the module
  adds no new localized strings. A jailed session is blocked from `frontier_enter`.
- The control rides in BOTH the offline and live arena panels (the zone is always-on,
  not an online-only feature), so its inside/combat state joins the window's render
  signature and flips promptly as you travel.

## Rewards (named constants in `frontier.ts`)

| Source | Reward |
|---|---|
| Frost rare kill | 15 honor + 3 hero points, to every contributor (participation eligibility) |
| Open-world player kill | 2x the Fiesta kill honor base (`FRONTIER_KILL_HONOR_MULT`) |
| Frontier daily quest | 100 honor (`FRONTIER_DAILY_HONOR`) |

## The Season 1 gear set (item level 31, `content/frontier_vendor.ts`)

The Frostrend set: item-level-31 epic mail Strength/Stamina, one tier above FURY's
item-level-28 warfare set. Registered at source level 25 so the item-level index reads
31 after the epic +6 quality bump; primary-stat sums equal `primaryStatBudget(31,
'epic', slot)` per slot; every piece soulbound with no copper value, bought only with
hero points from the Frostreach Quartermaster (Vaelka Frostwarden) in the hub.

| Piece | Slot | Stats | Hero points |
|---|---|---|---|
| Frostrend Helm | helmet | str 8 / sta 10 | 70 |
| Frostrend Spaulders | shoulder | str 7 / sta 9 | 55 |
| Frostrend Hauberk | chest | str 10 / sta 12 | 90 |
| Frostrend Girdle | waist | str 7 / sta 8 | 45 |
| Frostrend Legguards | legs | str 9 / sta 11 | 80 |
| Frostrend Gauntlets | gloves | str 7 / sta 8 | 45 |
| Frostrend Sabatons | feet | str 6 / sta 8 | 45 |
| Frostrend Choker | neck | str 6 / sta 8 | 45 |
| Frostrend Band | ring | str 6 / sta 7 | 40 |

## Reuse (from the #1817 honor foundation)

- `grantHonor`, honor DR, the soulbound rule, and the Warfare PvP stat: verbatim.
- `MobTemplate.rare` / `elite` / the rare-contributor roster: the frost rares are data.
- The FURY vendor pattern (`content/pvp_honor.ts`): mirrored for the hero-point
  vendor with a new `priceHero` cost field.
- `isHostileTo` player arm: gains one Frontier clause.
- The daily-reset boundary: the host `utcDay` string the honor arena taper already uses.

## Implemented in this PR

- `frontier.ts` band geometry + reward constants; exported from `pvp/index.ts`.
- `hero_points.ts` currency: grant/spend/normalize, `PlayerMeta.heroPoints` +
  `lifetimeHeroPoints`, `CharacterState` persistence (serialize + restore), the
  `heroPoints` `SimEvent` and its `HeroPointsReason`.
- Open PvP: the `isHostileTo` Frontier clause (both players in the band and outside
  the safe hub are hostile; `isFriendlyTo` mirrors it for free).
- The honor-reason additions (`frontier_kill` / `frontier_rare` / `frontier_daily`)
  and their HUD labels.
- Frost rares (`content/frontier.ts`: Rimefang Stalker, Frostbound Revenant) and the
  reward loop (`pvp/frontier_rewards.ts`, hooked from `handleDeath`): a rare killed in
  the band drops 15 honor + 3 hero points to every contributor.
- The item-level 31 Frostrend set sold by the Frostreach Quartermaster for hero points
  via the new `priceHero` cost field (`items.buyItem` spends hero points, sparing
  lifetime). The Quartermaster spawns at a reserved id after the world roster (mirroring
  FURY), so parity is untouched.
- The honor daily-quest mechanism (`quests/daily_quest.ts`): a repeatable quest resets
  once per host day; a daily is never marked permanently `questsDone`; its per-day
  completion lives in `PlayerMeta.dailyQuests` (persisted); `QuestDef.honorReward` grants
  honor on turn-in via `grantHonor`. The first daily, `frontier_daily_muster`, is given by
  the hub Frontier Marshal (Marshal Dregg), pays 100 honor, and is completable at the hub
  today (report to the Marshal, requisition from the Quartermaster, muster back).
- The PvP-window travel surface (`pvp/frontier_entry.ts` + the arena window control): the
  `frontierEnter`/`frontierLeave` IWorld facet, both-world implementations, the server
  wire and its jail block, the persisted `frontierReturn`, and the Enter/Leave button in
  both arena panels.
- Tests (`tests/frontier_pvp.test.ts`): band disjointness, hub perimeter, currency
  grant/spend/persist round-trip, hostility inside/outside/hub/overworld, the frost-rare
  kill reward in-band vs out, the hero-points vendor buy/refuse + item-level-31 pricing,
  the daily-reset leaf, the daily turn-in paying 100 honor + re-opening next day without
  entering `questsDone`, and the enter/leave teleport (hub arrival, return-spot memory and
  restore, the dead/combat/already-inside no-ops, and the `frontierReturn` persistence
  round-trip). Plus the seam pins (`world_api_parity`, `command_schema`, `command_facets`).

## Deferred to follow-up commits on this draft

- The frost rare spawn CAMPS: a player-gated spawner that only spawns the rares while a
  player is in the band, so the always-idle mob wander rng never forks the parity goldens.
  This is the linchpin follow-up: it makes the rares appear in-world and unlocks the
  kill/PvP dailies (which target the rares).
- The hero-points wallet readout (an `IWorld` currency facet + `ClientWorld` mirror +
  the server `self` snapshot field) so the client shows the hero-points balance the way it
  shows honor.
- The death/respawn-at-hub graveyard for the band.
- The Book of Deeds records for the new rares and the zone (cosmetic titles / Renown).
- The frost render/terrain treatment for the band and the Frostreach zone label.
- Richer dailies (kill N rares, defeat N players) once the spawner and a PvP-kill
  objective type land.

## Design rationale (why these choices)

- **Travel, not a queue.** Fiesta and the Arena are matchmade instances you are
  teleported into; the Frontier is one shared persistent place, so it gets a direct
  travel button, not a queue. Putting it in the same window keeps the "all PvP starts
  here" mental model the operator asked for.
- **Parity-safe by construction.** Every new world entity (the Quartermaster, the
  Marshal) spawns at a reserved id AFTER the rng-driven world roster and draws no rng,
  and the travel teleport is command-only, so none of it perturbs the deterministic
  golden traces. The rare spawner is deferred precisely because always-present idle mobs
  DO draw wander rng every tick; it needs the player-gated design above.
- **Soulbound everything.** Honor, hero points, and the Frostrend set are all soulbound,
  matching the #1817 rule: PvP progression cannot be bought, traded, or funneled.
