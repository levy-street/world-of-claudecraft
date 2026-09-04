# Masterwrought art completion

This evidence package seals the final painted-art completion wave for Masterwrought. It keeps
historical evidence immutable while recording the current 165 item paintings, 11 deed crests,
and five related interface assets accepted on 2026-09-02.

## Scope

- 81 newly required item paintings and 84 painted replacements for project-owned SVG stand-ins.
- 10 new Masterwrought deed crests and one replacement for the interim Farming 100 crest.
- One Farming profession emblem, one Well Fed aura, one farm-patch map marker, and two primary
  launcher icons.
- Historical-to-current item closure: 1128 - 84 + 165 = 1209 exact painted item files.

## Evidence index

- `accepted-art.json` is the machine-readable current manifest for 176 item and deed targets,
  the 85-entry supersession ledger, and the five supplemental interface pins.
- `accepted-aura-art.json` remains the dedicated Well Fed aura acceptance record.
- `final-item-art-audit-verdict.json` binds the complete 1,209-file live item catalog to its
  deterministic machine checks and 240 reviewed contact sheets.
- `supersession-before.json` preserves the 84 pre-task item placeholder hashes and owners.
- `generation-reports/` preserves six disjoint item generation reports, the all-items review,
  the deed and interface report, and the root-generated Farming and Well Fed report.

The committed generation reports preserve raw generator paths and hashes. The accepted manifest
independently measures the final shipping WebP bytes, dimensions, color space, alpha, and geometry.
Temporary source masters remain under the gitignored `tmp/imagegen/masterwrought-art-2026-09-02/`
tree in the accepting worktree.

The supersession records are immutable snapshots of the pre-replacement tree. Paths in those
records may name placeholder sources that were later removed; their exact bytes remain recoverable
from commit `6742cd8bf2e65b44b5f8a8887d3ec767c258eff2`. The six superseded deed masters
are recoverable from their recorded commits. Only the four tome-fingerprint inputs that still
have a live source role remain committed.

## Runtime visual evidence

`docs/screenshots/masterwrought-art-completion-2026-09-02/` contains the canonical LOW-preset
runtime capture set. Its numbered frames cover the seven non-blocking item watch identities on
desktop and mobile, the Farming gathering row on desktop and mobile, farm pins on desktop and
mobile maps, the new launcher chrome on desktop and the mobile-controller rail, Well Fed in the
live aura bar, all 11 deeds across their three real Book categories, and Harvestmaster in the
Reliquary.

The canonical capture runner completed all 13 requested targets and asserted the exact painted
runtime URLs before each frame. Its manifest retains 28 expected offline API 502 notices and 62
optional world-model prefetch notices; there were no target failures or art decode failures.

## Supplemental interface art

### farm-patch

Prompt SHA-256: `006643284ba064e127b0a091e3e509f40b669350d6bf3b7dc048b0b6686411b5`

References, in order:

1. `public/ui/map-markers/gather_herb.webp`: Approved gathering-marker style reference for bold botanical silhouette, near-black contour, broad value groups, and tiny-size readability; herb identity excluded.
2. `public/ui/map-markers/station_kitchens.webp`: Approved station-marker style reference for compact low rounded mass, warm top-left light, and tactile finish; cauldron identity excluded.

```text
Use case: stylized-concept
Asset type: chroma-keyed square fantasy MMORPG map and minimap marker master
Primary request: paint the farm patch marker (shipping filename farm_patch.webp) in the World of ClaudeCraft woc-map-marker-art-v2 language.
Input images: Image 1 is the approved gathering-marker style reference for a bold botanical silhouette, near-black painted contour, broad value groups, and readability at tiny sizes. Image 2 is the approved station-marker style reference for a compact low rounded mass, warm top-left light, and tactile painted finish. Do not copy their herb sprig or cauldron objects.
Scene and background: perfectly uniform solid flat #FF00FF magenta across every exterior pixel, corner, and interior gap around the marker, with no gradient, texture, vignette, terrain, cast shadow, reflection, or pink spill. No magenta may appear inside the marker.
Subject and identity: one compact low oval patch of tilled dark loam with exactly three bold curved furrows and exactly one crisp central green sprout consisting of one short stem and exactly two broad leaves. A slim pale-gold exterior keyline cleanly separates the complete loam-and-sprout silhouette. The sprout is a farm seedling, not a gathered herb bundle.
Composition: one centered optically balanced marker, broad low oval soil mass with the two-leaf sprout rising above it, roughly 68 percent square fill, generous safe transparent-key perimeter, near-black inner contour, only two or three broad value groups. Every cue must survive 18px, 20px, 24px, and 28px rendering and grayscale.
Style: hand-painted classic dark-fantasy MMORPG map heraldry, tactile earth and leaf surfaces, warm upper-left key light, cool lower-right shadow, crisp silhouette and restrained detail.
Constraints: exactly one sprout, exactly two leaves, two or three bold furrows; no flower, fruit, seed packet, herb bundle, grass cluster, hoe, sickle, shovel, watering can, basket, fence, pot, hands, readiness glow, halo, pulse, tracking ring, cooldown arc, lock, label, text, letters, numbers, runes, pseudo-writing, UI frame, medallion, watermark, checkerboard, transparency, split sheet, collage, cropped silhouette, or magenta interior detail.
```

The source was keyed, centered, and encoded to the canonical 64px marker contract. Runtime map
and minimap painters use the painting when loaded and retain their established procedural fallback.
The two chrome icons use the same transparent-key workflow at 128px. The Farming profession emblem
and Well Fed aura retain their complete prompts in `generation-reports/root-special.json`.
