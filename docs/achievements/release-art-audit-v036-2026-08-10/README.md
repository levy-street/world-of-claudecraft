# Release v0.36 art audit

This audit compares the artwork-overhaul merge at `91c0d1978ee35b40628f15cdd28defbb146f34ad`
with release head `32abfff7b0cbee34123dc36f69ed3fcab24f7a65`. It reviewed all 58
first-parent release arrivals, 1,658 net changed paths, and all 198 changed runtime art
files. Whole-catalog checks then covered item, ability, talent, deed, class, specialization,
profession, chrome, mob portrait, and Guide image routes.

## Accepted corrections

- Added nine distinct painted Reliquary deed crests. The deed registry is now 271 of 271.
- Added painted Emberkin Felbolt and Gloomshade Abyssal Chain pet-action icons.
- Added a dedicated Vale Cup ball target portrait instead of the unrelated wolf fallback.
- Normalized 36 oversized Mage and Warrior skill paintings to the 128px shipping contract,
  reducing their combined size from 10,852,710 bytes to 271,244 bytes. Three of the 36 are the
  hand-authored ("custom-user") Warrior icons double_charge, crushing_charge, and
  combat_mastery, which were serving full desktop resolution at 20x to 24x the converter's
  15 KiB cap. Their bytes are pinned by `tests/warrior_authored_assets.test.ts`, so that pin
  was updated deliberately in the same change, and the 128px contract was added beside it: the
  paintings are untouched, the guard still fails on any substitution, and it now also fails on
  a return to full resolution. Provenance is unchanged in
  `public/ui/skills/warrior/mapping.json`.
- Restored painted identity for 110 exact runtime aura states and 11 closed generated families
  while retaining generic art for ambiguous mob, control, sickness, and shared resource states.
- Removed four same-row talent art collisions by selecting distinct existing painted sources.
- Corrected target, target-of-target, and pet portrait routing for entity-kind collisions and
  transient guardians, including three distinct Stampede beasts.
- Reused exact mob portraits for all 19 Reliquary slain marks.
- Added decode-failure recovery for painted chrome and Guide stills.

The remaining catalogs were complete and already conformant. In particular, all current items,
player abilities, specializations, classes, professions, and primary chrome routes have unique,
reachable art.

## Evidence

- [Reliquary deed generation and acceptance](reliquary-deed-art.md)
- [Warlock pet-action accepted art](warlock-pet-action-art.accepted.json)
- [Vale Cup ball accepted portrait](vale-cup-ball-portrait.accepted.json)
- [Skill normalization record](../release-v036-skill-normalization-2026-08-10/README.md)
- [Skill before and after evidence](../../screenshots/release-v036-skill-normalization-2026-08-10/)

Focused verification completed with 19 test files and 215 tests passing, TypeScript passing,
Biome passing with only pre-existing warnings and informational suggestions, and a clean
`git diff --check`. The full repository gate was intentionally skipped at the user's request.
