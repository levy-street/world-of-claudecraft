# Masterwrought: vision and research record

## The maintainer's brief (2026-08-06/07)
Professions are beloved and in a great place; expand them so every profession has equal
endgame content. Add purple (epic) craftable gear positioned near raid power, limited to
two equipped per character; it must be masterworked to go slightly OVER raid; the
masterworked piece may become orange. Materials come from raids, dungeons, and rifts;
recipes drop as tradable items. Power discipline is paramount: nothing may trivialize
heroic raids or S-tier rifts (the level-20 endgame band is the protected asset).
Everything ships in one branch; each phase syncs the latest release branch first; the
result must be beautiful with a wonderful user experience; all new names must be unique
to this game (no other MMO's coined names), with a dedicated renaming phase for any
shipped collisions.

## Why the design is shaped this way (research digest)
Four research streams (three web-verified) across WoW classic-through-modern, RuneScape,
FFXIV, GW2, ESO, PoE, Diablo, Albion, and EVE, plus a full codebase ground-truth pass.
The conclusions that shaped the rulings in `state.md`:

- No documented case exists, in any era or game, of crafted gear making raid drops feel
  unrewarding. The recurring real failures are compulsion (a profession you must take),
  monopoly rent, recipe lockout, irreversibility, and marketplace neglect. The packet
  designs against those five.
- Rate-limit access, not just power (WoW sparks): the soulbound bankable Maker's Ember.
- Two-axis gating (WoW crests): a tradable making-catalyst (Wyrmfall Core) gates crafting;
  a bound wearer-supplied material (Sundered Essence) gates the above-raid ceiling, so the
  buyer's own raid participation, never gold, sets their power.
- Consume raid drops as ingredients (RS3 Trimmed Masterwork): Sundered Essence extracts
  from any raid epic of the tier: the item sink, duplicate-loot value, and the raid tie in
  one mechanic, sourced from a category so no single boss's popularity reprices it.
- The two-piece cap is shipped precedent (WoW "Unique-Equipped: Embellished (2)"); its
  known failure mode is a dominant piece in a stat-light slot (Elemental Lariat), hence
  the stat-shape rules and pure-stat jewelry.
- Tradable output tolerates risk, bound output demands mercy (PoE vs D4 verified rulings):
  base apex trades freely; Perfecting binds and is fail-forward only, never bricking.
- Slot complementarity (verified Wrath 3.1 to 3.3): crafted pieces at current-tier power
  in the slots raid loot covers worst; hence the phase 08 coverage audit.
- Stat shape beats item level (Lionheart Helm six phases at minus 20 ilvl on scarce +hit):
  ratings are off the primary budget in this codebase, so rating allocations are pinned.
- The TBC failure was the gate stack (BoP + requires-profession equip + punitive exit),
  so apex gear never carries a profession requirement to equip.
- Equal-perk parity is its own failure (Wrath professions: mandatory but interchangeable):
  parity here is equal prestige and economic role via distinct levers per profession.
- Sulfuras split for the capstone: the long tradable crafted chain plus a bound personal
  final step; legendary weight comes from process (Deed of Making, unique name, visuals).
- Marketplace neglect kills order systems (WoW public orders: no quality signal, no fee
  floor): the commission UX phase adds both.
- Irreversibility out-heats imbalance: undo paths ship with the feature.

## Power placement (grounded in this codebase's formula)
Best craftable today: ilvl 23 (13-point chest) vs heroic five-mans 31 (22), raid 33 (23),
legendaries 33 to 37 (44 to 49). Base apex: recipe.level 25 -> ilvl 31 (22). Perfected:
+delta to ilvl-34-equivalent (24), one to two points over raid per slot, two slots max.
The existing legendaries remain the ceiling; this packet adds no new one. The naive
masterwork bump epic-to-legendary would be +24 points on a chest (the 1.9 multiplier
cliff), which is WHY Perfecting is a new module and `masterwork.ts` is untouched.

## The catalog (summary; authored in phases 05 to 10)
Every profession: one intermediate (skill 75), three apex products (100), one capstone
role (125). Gear crafts make cap-pool pieces and Perfect them; jewelcrafting's Prismstone
Setting is consumed by every Perfecting attempt; inscription's Deed of Making names every
orange; enchanting finishes everyone's gear (Lucent line) and Perfected pieces (Lucent
Infusion); alchemy's Quickening Catalyst is the daily time gate under every intermediate,
plus flasks and the Grand Cauldron; cooking provisions raids (role foods, The Laden
Hearth). Jewelcrafting and inscription first receive base catalogs (they ship with zero
recipes today). v1 is pure stats and bounded utility: no new proc effects anywhere.

## Future-tier design intent (NOT deliverables of this packet)
- Next content tier's apex recipes consume this tier's apex pieces (the upgrade-chain
  sink; commit recorded here so the economy is designed for it).
- Orange unique effects (per-class balance passes required first).
- A deterministic late-cycle recipe valve beyond the marks vendor (add if a recipe
  fossilizes: vendor, reputation, or quest channel).
- maxSkill 150 with the next map/level-cap expansion.

## OPEN items (resolved inside phases, tracked in state.md)
- Jewelcrafting/inscription station model (phase 05/06 decision).
- Slot coverage audit results drive final slot picks (phase 08).
- Web verification of every provisional name at authoring (each content phase; known
  shipped collisions arcanite/silverleaf handled in phase 03).
