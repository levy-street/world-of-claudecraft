# Release v0.39 icon-art first pass

This pass audited `release/v0.39.0` at `d2d1a8ad5c11` and started the next painted-art
wave. The audit traced live content definitions through the UI resolvers, compared the
release with the prior whole-catalog art audit, inspected every major raster family, and
reviewed the current skill catalog as contact sheets at runtime sizes.

## Accepted first batch

The release had eight synthetic pet action-bar commands with exact procedural recipes but
no shipping paintings. These commands are shared by Hunter, Mage, and Warlock pets, so the
new art lives in the neutral `public/ui/skills/pet/` family instead of claiming one player
class. `PET_ACTION_IMAGE_IDS` is the closed registry, `abilityImageUrl` owns its static URL
projection, and the old recipes remain available as resilience fallbacks.

The newer `cheater_mark` sanction aura also had only an exact procedural recipe. The new
`AURA_IMAGE_IDS` and `auraImageUrl` seam gives exact runtime aura identities a first-class
painted route without pretending they are abilities. Ordinary auras still reuse matching
ability paintings through the same resolver.

Accepted assets:

- `pet_attack`
- `pet_growl`
- `pet_water_jet`
- `pet_feed`
- `pet_mend`
- `pet_passive`
- `pet_defensive`
- `pet_aggressive`
- `cheater_mark`

The exact prompts, ordered repository references, source hashes, shipping hashes, and
processing contract are recorded in [accepted-art.json](accepted-art.json). Current mapping
ownership lives in `public/ui/skills/pet/mapping.json` and `public/ui/auras/mapping.json`.

## Visual review

- [Desktop before and after](../../screenshots/release-v039-icon-art-first-pass-2026-08-16/icon-art-before-after-desktop.png)
- [Mobile and circular-crop review](../../screenshots/release-v039-icon-art-first-pass-2026-08-16/icon-art-before-after-mobile.png)

The review page renders the release's actual procedural recipes beside the committed WebPs.
It also exercises the pet paintings at 32px, 40px, and 48px, including the mobile circular
crop, and the exact aura painting at 13px, 16px, 28px, 34px, and 40px.

## Catalog findings

The large primary registries are healthy. Every live player ability reaches painted skill
art. The item, profession, deed, specialization, class, chrome, crest, map-marker, mob,
rank, and weapon inventories are complete under their existing mapping and test contracts.
`ITEM_ART_PENDING` and `DEED_ART_PENDING` remain empty. Heroic weapon aliases deliberately
reuse their base item painting.

The remaining work is concentrated in smaller or hand-maintained routes:

1. Persistent combat-state auras. `RUNTIME_AURA_ICON_SOURCE_IDS` covers a large authored
   alias set, but several important player states still collapse to generic kind art.
   This pass maps Convergence, Heating Up, Thunder Charges, Warspirit Cadence, Water Jet,
   its slow, and Feed Pet to their exact existing paintings.
   The next highest-value identities include Stormcast, Mending Current, Battle Trance,
   Cauterize states, Sated, Soul Fragments, Affliction Doom, Destruction Ruin, Icicles, and
   Winter's Chill. The already-mapped names now serve as composition anchors rather than
   remaining fallback debt.

2. Exact procedural-only battleground identities. The sprint, battle, ward, and carried-flag
   runes remain authored recipes rather than WebPs. The carried flag has the strongest UX
   value because its aura is also the player's drop-flag control.

3. Always-visible visual outliers. `defensive_stance` is a flat transparent rune beside two
   painterly Warrior stance icons. The older Warrior custom group and several legacy Druid,
   Shaman, Mage, and demon-summon icons are the next style-cohesion wave. The generic source
   pack mappings also remain useful replacement targets even though their files are valid.

4. Talent identity collisions. Every choice has an icon and no row duplicates itself, but
   several choices share exact paintings across the full talent window. The largest clusters
   reuse Power Word: Shield, Frostjaw Trap, and Lightning Shield art.

5. Currency UI. Gold, silver, and copper are still CSS circles on most money surfaces. `$WOC`
   uses an inconsistent purple dot or large site logo. Honor and Delve Marks are text-only,
   while Heroic Mark art already exists but is not reused by its vendor. A coordinated
   currency-medallion wave is the strongest non-combat follow-up.

6. Disabled zone plates. `MAP_ART_ENABLED` remains false because the old per-zone paintings
   no longer match current geography. Fresh terrain-only plates require exact topology and
   should be handled as a dedicated map-art project, not mixed into an icon batch.

7. Provenance drift. `challenging_roar.webp` is valid painted art and correctly wired, but its
   generated source ownership is absent from the Druid mapping. That record should be repaired
   from the original generation evidence or the icon should be regenerated with complete
   lineage. This pass does not invent missing provenance.

8. Raw-family test coverage. VFX sprites, emotes, proc overlays, daily chest art, active
   cursors, and Claudium ladders have weaker reverse-inventory and raster-quality contracts
   than the main icon families. The current files decode, but future work should add one
   focused raw-raster integrity suite and derive more aura coverage from live producers.

## Deliberate non-gaps

- Cooldown visuals reuse ability art plus overlays and do not need separate paintings.
- Rift and Delve mechanic fallbacks are intentional procedural symbols with exhaustive
  semantic routing.
- The Reliquary specimen vial is authored inline SVG. A painted replacement is optional
  polish, not missing art.
- The old attack, friendly, and default cursor PNGs were deliberately superseded. They are
  cleanup candidates, not icons that should be restored to runtime.
- The Mage Water Elemental Guide omission should be fixed through the existing deterministic
  model-still pipeline, not image generation.

## Verification

The contribution finished with the following green checks:

- `node scripts/item_art_audit.mjs --verify-only`: 822 shipping files cover 837 live
  item definitions, including 16 intentional Heroic weapon aliases.
- Focused icon, resolver, lineage, and whole-catalog regression runs: 57 tests and the
  final 26-test provenance subset passed.
- `npm run check:ts`, targeted Biome checks, JSON parsing, and `git diff --check`: passed.
- `node scripts/gate_select.mjs`: all 12 steps passed; 911 test files passed, 8 skipped,
  with 16,330 tests passed and 80 skipped. Its browser leg passed 19 files and 129 tests.
- `npm run gate`: all 12 full-mirror steps passed; 2,804 test files passed, 12 skipped,
  with 39,056 tests passed, 2 expected failures, and 115 skipped. Its browser leg passed
  19 files and 129 tests.
- Independent frontend review: PASS with no confirmed finding.
- Independent regression-coverage review: READY after exact HUD routing, accepted-record,
  evidence, registry, and mapping-to-manifest provenance pins were added.

The committed screenshots are exact runtime-size and circular-crop review evidence from a
purpose-built asset page. They are not an authenticated live-game HUD capture; a live
desktop and coarse-pointer mobile landscape capture remains useful follow-up visual proof.
