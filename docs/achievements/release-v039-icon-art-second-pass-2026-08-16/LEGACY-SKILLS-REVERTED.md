# Legacy skill repaints: reverted from shipping

The legacy-skills family of this batch (58 class ability icons, recorded in
legacy-druid-hunter.json, legacy-shaman-rogue-priest.json, and
legacy-warrior-warlock-mage.json) was walked back from release/v0.39.0 on
2026-08-19 before it shipped to prod.

Owner ruling: live class ability icons carry piloting muscle memory and are
frozen at their pre-v0.39 art. See docs/design/spell-icon-freeze.md and
tests/spell_icon_freeze.test.ts.

The cohort records above are sealed by the aggregate second-pass record and
tests/release_v039_icon_art.test.ts, so this note rides beside them instead of
editing them: they remain the immutable history of what the art pass produced
and reviewed, and the paintings they record stay available for any future
deliberate, announced icon refresh. Every other family in this batch (auras,
pet commands, currencies, Delve affixes, Fiesta, Reliquary) shipped as
recorded.
