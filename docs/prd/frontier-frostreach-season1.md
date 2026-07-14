# The Frostreach Frontier: Season 1 (implementation slice of frontier-pvp.md)

Status: WIP draft. Implements a focused Season 1 slice of the Frontier spec
(`docs/prd/frontier-pvp.md`, shipped-foundation note in
`docs/prd/pvp-honor-and-quartermaster.md`, #1817). Scope here is the operator's
requested v1: an always-on frost PvP zone with frost rares that drop honor and a
new hero-points currency, open PvP inside the band, honor daily quests, and a
hub vendor that sells the item-level 31 Season 1 PvP set for hero points.

## What Season 1 is

A factionless, always-on, frost-themed open-world PvP band far east of the world
(`FRONTIER_X_MIN = 14000`, past the yumi maze band and short of the Vale Cup
practice pitches). You teleport in; everyone in the band is hostile to everyone
else (no teams, the RuneScape-Wilderness rule); one safe hub holds the vendor,
the daily giver, and the graveyard. Killing the frost rares that roam it drops
honor (via the shipped `grantHonor`) and hero points (the new Season 1 currency);
hero points buy the item-level 31 PvP set from the hub Quartermaster.

## Reuse (from the #1817 honor foundation)

- `grantHonor`, honor DR, the soulbound rule, and the Warfare PvP stat: verbatim.
- `MobTemplate.rare` / `elite` / loot roll groups: the frost rares are data.
- The FURY vendor pattern (`content/pvp_honor.ts`): mirrored for the hero-point
  vendor with a new `priceHero` cost field.
- `isHostileTo` player arm: gains one Frontier clause.

## New

- `src/sim/pvp/frontier.ts`: band geometry + reward constants (single source).
- `src/sim/pvp/hero_points.ts`: the hero-points currency (`grantHeroPoints`,
  `spendHeroPoints`, `normalizeHeroPoints`), soulbound, persisted like honor.
- Frost rare templates + a Frostreach content module (zone, camps, hub NPCs).
- A hero-point Quartermaster selling the item-level 31 Season 1 set.
- Honor daily quests at the hub.
- Client wire + a hero-points wallet readout, and the enter/leave PvP surface.

## Numbers (named constants in `frontier.ts`)

| Source | Reward |
|---|---|
| Frost rare kill | 15 honor + 3 hero points (participation eligibility) |
| Open-world player kill | 2x the Fiesta kill honor base |
| Frontier daily quest | 40 honor |

Item-level 31 set: level-20 epics sourced high enough that the item-level index
reads 31 after the epic +6 bump; primary-stat sums match the slot budgets in
`item_budget.ts`; PvP ratings mirror those budgets; every piece soulbound.

## Implemented in this PR (the foundation slice)

- `frontier.ts` band geometry + reward constants; exported from `pvp/index.ts`.
- `hero_points.ts` currency: grant/spend/normalize, `PlayerMeta.heroPoints` +
  `lifetimeHeroPoints`, `CharacterState` persistence (serialize + restore), the
  `heroPoints` `SimEvent` and its `HeroPointsReason`.
- Open PvP: the `isHostileTo` Frontier clause (both players in the band and
  outside the safe hub are hostile; `isFriendlyTo` mirrors it for free).
- The honor-reason additions (`frontier_kill` / `frontier_rare` / `frontier_daily`)
  and their HUD labels.
- Frost rares (`content/frontier.ts`: Rimefang Stalker, Frostbound Revenant) and
  the reward loop (`pvp/frontier_rewards.ts`, hooked from `handleDeath`): a rare
  killed in the band drops 15 honor + 3 hero points to every contributor.
- The item-level 31 Season 1 set (`content/frontier_vendor.ts`: the Frostrend mail
  Strength/Stamina pieces, source level 25 so each reads item level 31) sold by the
  Frostreach Quartermaster for hero points via the new `priceHero` cost field
  (`items.buyItem` spends hero points, sparing lifetime). The Quartermaster spawns
  at a reserved id after the world roster (mirroring FURY), so parity is untouched.
- Tests: `tests/frontier_pvp.test.ts` (band disjointness, hub perimeter, currency
  grant/spend/persist round-trip, hostility inside/outside/hub/overworld, the
  frost-rare kill reward in-band vs out, and the hero-points vendor buy/refuse +
  item-level-31 pricing).

## Deferred to follow-up commits on this draft

The honor daily quests; the enter/leave teleport surface and the PvP window
section; the hero-points wallet readout (IWorld facet + `ClientWorld` + server
wire); the death/respawn-at-hub graveyard; the frost rare spawn camps + the
Frostreach zone label (deferred so the world-gen spawn rng and the parity goldens
stay untouched until a deliberate regen); the Book of Deeds records for the new
rares and the zone; the frost render/terrain treatment for the band.
