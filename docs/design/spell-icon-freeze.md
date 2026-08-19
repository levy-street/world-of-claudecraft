# Spell icon freeze

Owner ruling, 2026-08-19: **zero visual change to a live class ability icon**,
ever, without a deliberate maintainer re-mint. This is a product constraint,
not an art-quality judgement.

## Why

Players pilot their characters by visual muscle memory. An ability icon is
recognized on the bar as a color blob and silhouette in peripheral vision,
under time pressure, in PvE rotations and PvP alike. Changing a live icon,
even to strictly better art, degrades every existing player until they
relearn the button, and the relearning window lands exactly where the stakes
are highest: mid-combat. Icon fidelity is cosmetic; icon identity is an input
device.

This ruling was made when the v0.39 icon art pass (PR #3459) repainted 58
legacy class skill icons and was walked back before shipping to prod. The
paintings themselves passed art review and remain archived in the cohort
records under docs/achievements/release-v039-icon-art-second-pass-2026-08-16/
(marked reverted-from-shipping) in case a future major release ever wants an
icon refresh as a deliberate, announced, player-facing event.

## What is frozen

- Every `public/ui/skills/<class>/*.webp` for the nine playable classes.
  Enforced byte-for-byte by `tests/spell_icon_freeze.test.ts` against the
  manifest `tests/fixtures/spell_icon_freeze.sha256.json`.

## What is NOT frozen

- `public/ui/skills/pet/`: pet command art, explicitly exempt by the same
  ruling (those icons replaced procedural placeholders with no accumulated
  muscle memory).
- The per-class `mapping.json` manifests: metadata (license, provenance)
  edits are not visual changes.
- Aura, currency, Delve affix, Fiesta, Reliquary, profession, mount, and
  every other icon family: art passes remain welcome there. If one of those
  families accumulates live hand-recognized identity over time, extending the
  freeze to it is a follow-up ruling, not an automatic effect of this one.
- NEW ability icons: a new ability ships whatever icon its author lands; the
  freeze starts the moment it is minted into the manifest.

## Changing a frozen icon anyway

A change must be a maintainer decision made in the open, never a side effect
of an art pass:

1. Get the owner ruling recorded (issue or PR body).
2. `UPDATE_SPELL_ICON_FREEZE=1 npx vitest run tests/spell_icon_freeze.test.ts`
   re-mints the manifest; the fixture diff is the reviewable record of exactly
   which icons changed.
3. The PR body carries before/after art and the player-facing comms plan
   (patch notes at minimum).
