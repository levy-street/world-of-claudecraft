# Release v0.39 icon-art second pass

This pass closes the runtime-reachable painted-art gaps found after the first v0.39 audit and replaces the most conspicuous legacy flat or clip-art skill icons.

## Accepted scope

- 223 accepted paintings from 224 built-in image-generation calls.
- 165 new painted identities: 128 runtime auras, 6 Delve affixes, 20 Fiesta augments, 4 Fiesta powerups, 6 currencies, and 1 Reliquary specimen.
- 58 legacy skill replacements across Druid, Hunter, Mage, Priest, Rogue, Shaman, Warlock, and Warrior.
- One rejected and regenerated output: the first Dismiss Pet attempt failed its 16px review. Every other painting passed on its first generation call.

The sealed aggregate record is [accepted-art.json](accepted-art.json). It pins every cohort record and each new-family shipping catalog by SHA-256. Per-asset prompts, reference roles, source hashes, accepted hashes, processing, and review decisions remain in the referenced cohort records and mappings.

## Runtime outcome

- All 410 live abilities and all 72 hotbar-eligible items resolve to painted art.
- Attack, all 8 shared pet commands, and both live pet signature actions resolve to painted art.
- Exact aura images now have a first-class registry/probe and survive the HUD resolver without requiring a procedural recipe.
- 89 exact mob aura IDs route through a closed audited map to 44 truthful family paintings.
- The final shared `fear_incap` identity uses source-neutral victim art because its wire payload can come from player or mob fear effects and does not identify the caster.
- All 20 Fiesta augments, 4 Fiesta powerups, 8 powerup component aura IDs, and 6 rollable Delve affixes resolve to exact paintings.
- Gold, silver, copper, WOC token, Honor, Delve Mark, and the existing Heroic Mark now render as art beside localized text on their live balance and price surfaces.
- The Reliquary Perfect Specimen mark now uses a painted transparent vial instead of the flatter inline treatment.
- The Vale Cup primary seat paints the move it casts, and the loot-ready nameplate marker is now an authored satchel-and-glint canvas symbol instead of a dollar sign.

## Deliberate boundaries

- Unknown or future aura and affix IDs retain safe generic fallbacks.
- Registered but currently non-rollable Delve affixes remain on fallback art until their simulation hooks exist.
- Dynamic state chrome such as cooldown sweeps, charges, locks, rank rings, and pending/revealed state remains CSS, canvas, or SVG rather than painted raster art.
- The stale disabled zone plates are a separate geography-aligned map project. This change does not enable old plates against the current topology.
- The Guide Water Elemental still belongs to the deterministic model-still pipeline, not image generation.

## Visual contract

Aura, ability, Fiesta, Delve, and currency paintings use opaque borderless square art with one dominant semantic motif, deep dark-fantasy values, controlled glow, crisp focal edges, and soft atmospheric peripheries. The Reliquary specimen retains transparent cutout behavior. Assets were reviewed at their real runtime sizes, including 13px or 16px micro reads, grayscale, and circular crops where applicable.

## Visual evidence

- [First-pass desktop before and after](../../screenshots/release-v039-icon-art-first-pass-2026-08-16/icon-art-before-after-desktop.png)
- [First-pass mobile before and after](../../screenshots/release-v039-icon-art-first-pass-2026-08-16/icon-art-before-after-mobile.png)
- [Legacy skill replacement review](../../screenshots/release-v039-icon-art-second-pass-2026-08-16/legacy-skill-replacements.png)
- [Runtime aura family review](../../screenshots/release-v039-icon-art-second-pass-2026-08-16/runtime-aura-families.png)
- [Gameplay UI family review](../../screenshots/release-v039-icon-art-second-pass-2026-08-16/gameplay-ui-families.png)

## Verification

Focused resolver, registry, provenance, image-contract, action-bar, currency, Delve, Fiesta, Reliquary, nameplate, and legacy-repaint tests pass. The final repository gate results are recorded in the contribution handoff.
