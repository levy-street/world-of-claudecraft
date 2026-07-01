# Valdris: the known world (v0.19 continent expansion)

Source material: the maintainer's lore document ("Valdris Lore Document v1.1")
and the interactive map (WOC Interactive Map). This doc maps that 2D lore
geography onto the engine's world model and records the decisions.

## Engine mapping

The engine world is a single north-running strip of zone bands (fixed width,
x in [-180, 180]; zones are contiguous z bands, see `src/sim/data.ts`). The
Valdris continent is therefore laid out as a south-to-north journey:

| # | Zone id | Name | z band | Levels | Biome |
|---|---------|------|--------|--------|-------|
| 1 | `eastbrook_vale` | Eastbrook Vale | -180..180 | 1-7 | vale |
| 2 | `mirefen_marsh` | Mirefen Marsh | 180..540 | 6-13 | marsh |
| 3 | `thornpeak_heights` | Thornpeak Heights | 540..900 | 13-20 | peaks |
| 4 | `ossara_domain` | Ossara Domain | 900..1290 | 20-28 | desert |
| 5 | `veth_confederation` | Veth Confederation | 1290..1680 | 27-34 | shadowwood |
| 6 | `kael_empire` | Kael Empire | 1680..2070 | 33-40 | highlands |
| 7 | `grey_hollows` | Grey Hollows | 2070..2250 | 28-45 | highlands |
| 8 | `thornfen_border` | Thornfen Border | 2250..2430 | 30-46 | shadowwood |
| 9 | `ironpass_crossing` | Ironpass Crossing | 2430..2610 | 30-50 | peaks |
| 10 | `emberveil_marshes` | Emberveil Marshes | 2610..2790 | 32-48 | marsh |
| 11 | `pale_crossing` | Pale Crossing | 2790..2970 | 34-50 | vale |
| 12 | `the_breach` | The Breach | 2970..3330 | 45-60 | scorched |
| 13 | `ashveil_wastes` | Ashveil Wastes | 3330..3510 | 35-45 | scorched |
| 14 | `saltbone_flats` | Saltbone Flats | 3510..3690 | 36-48 | salt |
| 15 | `duskwall_ruins` | Duskwall Ruins | 3690..3870 | 35-50 | scorched |
| 16 | `cindral_ridge` | Cindral Ridge | 3870..4050 | 38-52 | scorched |
| 17 | `redspire_pass` | Redspire Pass | 4050..4230 | 40-55 | scorched |

Zones 1-3 (the original world) are collectively **The Landing**, the tutorial
island every adventurer starts on; it carries characters to level 20 exactly
as before. Zones 7-11 are the southern contested ring, reachable without ever
entering open PvP. **The Breach is the only mandatory crossing between the
southern and northern halves of the ring**, which is faithful to the lore
("whoever controls Ironpass controls the continent's primary trade artery"
becomes "whoever wants the northern ring crosses the war zone").

Deliberate compromises of the 1D strip:

- The three faction realms are ordered by level progression (Ossara, Veth,
  Kael) instead of compass positions; the lore map's "1-42" realm labels
  become effective in-game bands 20-28 / 27-34 / 33-40 because levels 1-20
  belong to The Landing.
- The ten contested territories keep their lore level ranges verbatim and are
  split five south / five north of the Breach by those ranges.

## Level cap

`MAX_LEVEL` is now 60. The XP table is the classic per-level formula
`round100((8L + Diff(L)) * (45 + 5L))`; rows 1-20 are byte-identical to the
old table, rows 21-59 continue it. Consequences, all intentional:

- Prestige now requires level 60 and costs the 59 to 60 step (209,800) of
  post-cap lifetime XP per rank. Existing prestige ranks are preserved as
  saved (the server only caps NEW prestige commands).
- Virtual (cosmetic) levels recompute against the new table, so a capped
  veteran's displayed virtual level drops as those XP now count toward real
  levels 21+. Lifetime XP itself is untouched.
- Talent points keep the classic formula (level minus 9), so the cap grants
  up to 51 points; deeper talent tiers are follow-up content.
- Ability ranks currently end at their level 20 rows; higher-level ranks are
  follow-up content (see docs/design/spell-ranks.md before adding any).

## Factions and races

Three player factions (`PlayerFaction`), each with four playable races
(`PlayerRace`, records in `src/sim/content/races.ts`):

- Kael Empire: Human, Dwarf, Gnome, Exiled Elf.
- Confederation of Veth: Elf, Dark Fae, Frost Kin, Shadow Walker.
- Domain of Ossara: Desert Clan, Sand Mage, Nomad, Stone Warden.

Races are identity, not power: they set the faction and a cosmetic body
scale. No stats, no racial abilities (deliberate: the repo rule is never to
invent balance numbers; classic racials can be added later from real data).
Faction is derived from race and never stored separately. Characters saved
before races existed load as Human (Kael) via the standard optional-JSONB
default in `addPlayer`; their saved position (the Landing) is untouched.

Every new character of every race still spawns at The Landing's
`PLAYER_START`: the lore's tutorial island is the shared first-spawn zone,
and the faction realms are where characters travel at 20+.

## The Breach: eternal war zone

Open-world faction PvP exists ONLY inside the `the_breach` band (overworld
x range; instances are exempt). Inside it, players of DIFFERENT factions are
hostile (attackable, not heal-able); same-faction players are always
friendly. Outside the band nothing changes (duels and arena keep their own
rules, which take precedence). Deaths there are normal deaths (graveyard
release), not duel-style 1 HP floors. The rule lives in one choke point,
`Sim.isHostileTo` / `isFriendlyTo`, via `src/sim/war_zone.ts`.

## Biomes

Five new `BiomeId`s: `desert`, `shadowwood`, `highlands`, `scorched`, `salt`.
Each fills every exhaustive per-biome record (terrain shape and palette,
foliage tints and density, sky HDRI/backdrop, motes, map colors, ambience);
sky and ambience map onto the closest existing assets (no new art needed):
desert/highlands/salt reuse the vale set, shadowwood the marsh set, scorched
the peaks set. Replacing them with dedicated assets is cosmetic follow-up.
