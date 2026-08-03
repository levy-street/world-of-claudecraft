# Missing painted icons: accepted-art provenance

This record covers the complete painted-icon replacement wave accepted on 2026-08-01: 90 abilities, 101 non-weapon items, three deed crests, and 15 Heroic weapon resolver inheritances. The canonical inventory grew after the original request, so the final exact scope is 209 targets and 194 new raster paintings.

The machine-readable companion, [missing-painted-icons-accepted-art.json](missing-painted-icons-accepted-art.json), is authoritative for every exact target ID, canonical meaning, per-asset subject direction, full generation prompt, actual repository reference path and role, reference provenance/license, accepted worktree source hash, shipping hash, runtime URL, dimensions, alpha contract, weight ceiling, family grouping, and Heroic base/variant relationship.

## Lineage and ownership

Every new raster was created in one distinct call through OpenAI built-in image generation and is owned as a World of ClaudeCraft project asset, rights reserved. Repository inputs labeled CraftPix are licensed third-party style or subject references available to this project; they are recorded truthfully and are never described as first-party. No external proprietary-game art entered the lineage. Existing project-generated and commissioned references retain the ownership recorded in CREDITS.md and their mapping files.

## Deterministic processing and acceptance

Opaque ability/item masters were normalized to reviewed 512×512 sRGB PNGs in `tmp/imagegen/missing-painted-icons/accepted/`, then resized and encoded by the repository converters to exact 128×128 WebP. Deeds were generated against a flat magenta exterior, copied into the worktree, keyed with the imagegen helper's soft matte and despill, centered as exact 512×512 sRGB RGBA PNGs, and encoded by the deed converter. All outputs are capped at 15 KiB. The companion manifest pins the reviewed source and shipping identities; `scripts/icon_asset_audit.mjs` verifies decoding, hashes, dimensions, alpha, geometry, duplicate bytes, perceptual candidates, and deterministic contact sheets at every requested display size.

Heroic weapons generated no new raster or model. Their resolver first honors a direct own-property mapping and then safely inherits the base item's existing GLB-rendered JPG variant through `heroicOf`.

## Visual acceptance evidence

The accepted set was reviewed in 95 deterministic contact sheets: every ability class at 128px, 48px, and 32px; every armor, zone-quest, world-fixture, service, tool, and currency item family at 128px and 28px; and the deed batch at 512px, 128px, 40px, and 24px in both color and the unearned grayscale treatment. The sheets and machine report are retained under `tmp/imagegen/missing-painted-icons/review/final-audit/`.

The final perceptual audit reported one review candidate across 194 assets: `sunken_idol_mantle` and `wreck_wardens_mantle`, with a structural score of 0.822675. Direct inspection of both 512px sources and 128px shipping files accepted them as distinct designs that share only the intended shoulder-slot grammar. The former uses flat teal layered cloth, a central stone idol, pearls, and moss; the latter uses deep indigo drapery, curled shoulders, corroded wreck-metal rosettes, and perforated sea-green tails. No exact duplicate group was present, and the audit reported no asset-contract issue.

## Deed crest prompt and lineage records

### `dgn_wildheart_basin` - The Basin Bites Back

Subject direction: Front-facing pale-limestone jaguar gate or skull maw with open fangs cradling one jade-turquoise cenote ripple, sparse emerald vines and one restrained ritual-fire accent.

Canonical meaning: Defeat Zulgar, Voice of the Basin in the Wildheart Basin.

Full generation prompt:

```text
Use case: stylized-concept
Asset type: transparent Book of Deeds medallion crest generated on removable chroma
Primary request: fresh separately composed hand-painted classic dark-fantasy MMORPG medallion for The Basin Bites Back (dgn_wildheart_basin)
Subject: Front-facing pale-limestone jaguar gate or skull maw with open fangs cradling one jade-turquoise cenote ripple, sparse emerald vines and one restrained ritual-fire accent.
Frame: blackened bronze or steel circular body, antique-gold double rim, exactly four small cardinal kite points, dark enamel inset
Composition: complete centered badge, target source alpha bounds x/y 56 to 455, no crop, clear at 40px and 24px
Scene/backdrop: perfectly flat solid #FF00FF exterior, one uniform color with no shadow, gradient, texture, reflection or lighting variation
Constraints: no text, ribbon, extra frame, watermark, exterior shadow or glow; do not use #FF00FF inside the medal
```

Actual image inputs:

- `docs/screenshots/wildheart/concept/wildheart-basin-keyart.jpg` - subject reference; World of ClaudeCraft project-generated art; Project asset, rights reserved
- `public/ui/deeds/dgn_drowned_temple.webp` - frame reference; World of ClaudeCraft maintainer-commissioned bespoke art; Project asset, rights reserved
- `public/ui/deeds/dgn_hollow_crypt.webp` - composition reference; World of ClaudeCraft maintainer-commissioned bespoke art; Project asset, rights reserved
- `public/ui/deeds/chr_peaks_gatherer.webp` - frame reference; World of ClaudeCraft project-generated art; Project asset, rights reserved

Accepted high-resolution master: `tmp/imagegen/missing-painted-icons/masters/deeds/dgn_wildheart_basin.png`, SHA-256 `8c92f548f5352c70fe5c3fe5177ac77f0a807313e5eb6b727a9c78d1d1abc0b3`. Accepted 512px source: `tmp/imagegen/missing-painted-icons/accepted/deeds/dgn_wildheart_basin.png`, SHA-256 `dd745c14baf4cedb77958647c39d7478dc4525f58a9d50c0c6ab428a962a6a77`, alpha bounds [59,56,453,455], 0.424255 coverage. Shipping WebP: `/ui/deeds/dgn_wildheart_basin.webp`, SHA-256 `6bdf6a17e1ddb01fb1fbc962264bf6bd2ff9bd95502f4b1f8425b1562bcbe275`, 4872 bytes. Final alpha bounds [14,14,113,113], 0.432556 coverage.

### `dgn_wildheart_basin_heroic` - Heroic: The Wildheart Basin

Subject direction: A separate trophy-war composition centered on Zulgar's spotted jaguar mask, sun-disc mantle, pale bone armor and fangs, coral feather accents, and a turquoise Wildheart Pulse.

Canonical meaning: Defeat Zulgar, Voice of the Basin in the Wildheart Basin on Heroic difficulty.

Full generation prompt:

```text
Use case: stylized-concept
Asset type: transparent Book of Deeds medallion crest generated on removable chroma
Primary request: fresh separately composed hand-painted classic dark-fantasy MMORPG medallion for Heroic: The Wildheart Basin (dgn_wildheart_basin_heroic)
Subject: A separate trophy-war composition centered on Zulgar's spotted jaguar mask, sun-disc mantle, pale bone armor and fangs, coral feather accents, and a turquoise Wildheart Pulse.
Frame: blackened bronze or steel circular body, antique-gold double rim, exactly four small cardinal kite points, dark enamel inset
Composition: complete centered badge, target source alpha bounds x/y 56 to 455, no crop, clear at 40px and 24px
Scene/backdrop: perfectly flat solid #FF00FF exterior, one uniform color with no shadow, gradient, texture, reflection or lighting variation
Constraints: no text, ribbon, extra frame, watermark, exterior shadow or glow; do not use #FF00FF inside the medal
```

Actual image inputs:

- `public/ui/mobs/wildheart_high_priest.webp` - subject reference; World of ClaudeCraft project-generated art; Project asset, rights reserved
- `docs/screenshots/wildheart/wildheart-zulgar-desktop.jpg` - subject reference; World of ClaudeCraft project-generated art; Project asset, rights reserved
- `public/ui/deeds/dgn_drowned_temple_heroic.webp` - frame reference; World of ClaudeCraft maintainer-commissioned bespoke art; Project asset, rights reserved
- `docs/screenshots/wildheart/concept/wildheart-basin-keyart.jpg` - composition reference; World of ClaudeCraft project-generated art; Project asset, rights reserved

Accepted high-resolution master: `tmp/imagegen/missing-painted-icons/masters/deeds/dgn_wildheart_basin_heroic.png`, SHA-256 `0b4c8ebd81c3e7649c23c93ac055abe3f8922df0679ed198f64e2d58c92a87bd`. Accepted 512px source: `tmp/imagegen/missing-painted-icons/accepted/deeds/dgn_wildheart_basin_heroic.png`, SHA-256 `bdb1f9fcff4171f09eaf3ecf2fa39ece35225e29b53502c510cfe22dd0a236f4`, alpha bounds [60,56,452,455], 0.418285 coverage. Shipping WebP: `/ui/deeds/dgn_wildheart_basin_heroic.webp`, SHA-256 `7640ae22f08da8f378b2219b60668089cc728266d06c2f1196164fc2daf7de8d`, 5996 bytes. Final alpha bounds [15,14,113,113], 0.426208 coverage.

### `pvp_card_duel_first_win` - House Rules

Subject direction: Two opposed or fanned gilded fantasy cards on dark plum enamel: one decisive face-up card with abstract jewel pips and a ruby center, one ornate face-down card.

Canonical meaning: Win a Card Duel at the Card Master.

Full generation prompt:

```text
Use case: stylized-concept
Asset type: transparent Book of Deeds medallion crest generated on removable chroma
Primary request: fresh separately composed hand-painted classic dark-fantasy MMORPG medallion for House Rules (pvp_card_duel_first_win)
Subject: Two opposed or fanned gilded fantasy cards on dark plum enamel: one decisive face-up card with abstract jewel pips and a ruby center, one ornate face-down card.
Frame: blackened bronze or steel circular body, antique-gold double rim, exactly four small cardinal kite points, dark enamel inset
Composition: complete centered badge, target source alpha bounds x/y 56 to 455, no crop, clear at 40px and 24px
Scene/backdrop: perfectly flat solid #FF00FF exterior, one uniform color with no shadow, gradient, texture, reflection or lighting variation
Constraints: no text, ribbon, extra frame, watermark, exterior shadow or glow; do not use #FF00FF inside the medal
```

Actual image inputs:

- `public/ui/chrome/cards.webp` - subject reference; World of ClaudeCraft project-generated art; Project asset, rights reserved
- `public/ui/deeds/pvp_duel_first_win.webp` - frame reference; World of ClaudeCraft maintainer-commissioned bespoke art; Project asset, rights reserved
- `public/ui/deeds/pvp_arena_first_win.webp` - composition reference; World of ClaudeCraft maintainer-commissioned bespoke art; Project asset, rights reserved
- `public/ui/deeds/chr_peaks_gatherer.webp` - frame reference; World of ClaudeCraft project-generated art; Project asset, rights reserved

Accepted high-resolution master: `tmp/imagegen/missing-painted-icons/masters/deeds/pvp_card_duel_first_win.png`, SHA-256 `0b95c80ff33fc5052b368c27407da882fcbe110bbd5c86fda5124483b1849acb`. Accepted 512px source: `tmp/imagegen/missing-painted-icons/accepted/deeds/pvp_card_duel_first_win.png`, SHA-256 `44de5b484a9bff1793ce23a218681d6d6940fe7813506bd134f4ccba5c20c065`, alpha bounds [56,57,455,454], 0.416470 coverage. Shipping WebP: `/ui/deeds/pvp_card_duel_first_win.webp`, SHA-256 `5c16fa2351320b2d53ac2e95aa4073289a883fe767003b1412ed8e8e0df16a53`, 5020 bytes. Final alpha bounds [14,14,113,113], 0.424072 coverage.
