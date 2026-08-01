# Eastbrook Vale rebuild: image-generation provenance

This record covers the accepted concept, turnaround images, and shared surface-atlas source under
`docs/screenshots/eastbrook-vale-rebuild/`. It does not grant provenance to the generated GLBs,
which receive their own shipping asset record. The deterministic grayscale atlas derived from the
accepted source is recorded separately below.

## Generation record

| Field | Value |
|---|---|
| Tool | OpenAI imagegen |
| Generation date | 2026-07-23 |
| Output status | Original AI-generated World of ClaudeCraft first-party design material |
| Upstream rights status | World of ClaudeCraft first-party captures and prior original AI-generated iterations only |
| Third-party references | None |
| RuneScape imagery | None used |
| Redistribution status | Project inclusion only; the full-color concept, turnarounds, atlas source, and comparison evidence are project assets with rights reserved and require permission to redistribute |

Exact prompt text is intentionally not reconstructed in this summary. The canonical verbatim tool
inputs, exact reference-path arrays, payload hashes, and output mapping are frozen in
[`imagegen-prompts.md`](imagegen-prompts.md). This document records lineage and acceptance outcome;
the linked record is the prompt authority.

## First-party input lineage

The accepted master lineage used these exact first-party captures at generation time:

- `tmp/eastbrook_rebuild/baseline/town-planning/current-elevated-overview-desktop-ultra.png`
- `tmp/eastbrook_rebuild/baseline/town-planning/current-planning-top-down-desktop-ultra.png`
- `tmp/eastbrook_rebuild/baseline/town-planning/current-gate-approach-desktop-ultra.png`
- `tmp/eastbrook_rebuild/baseline/town-planning/current-armoury-facade-desktop-ultra.png`
- `tmp/eastbrook_rebuild/baseline/town-planning/current-player-scale-desktop-ultra.png`

The same captures have durable evidence copies below
`docs/screenshots/eastbrook-vale-rebuild/before/`. The accepted master correction also referenced
the rejected master iterations listed below. Those iterations contain only original generated or
World of ClaudeCraft-derived imagery.

Every accepted bank, smithy, inn, chapel, weaving workshop, and toolworks turnaround used exactly
these inputs:

- the accepted master concept, whose tracked copy is
  `docs/screenshots/eastbrook-vale-rebuild/concepts/master-concept.png`;
- the Armoury facade baseline listed above;
- the player-scale baseline listed above.

The accepted civic-well and market turnarounds used the accepted master, the top-down baseline,
and the player-scale baseline. Full-gate v1 used that same three-reference set. Full-gate v2 and
the accepted wall-wing turnaround each used rejected full-gate v1, the accepted master, and the
player-scale baseline. No external game image, art pack, logo, photograph, or third-party concept
was admitted anywhere in the lineage.

The accepted surface-atlas source used exactly three admitted first-party project images: the
accepted Eastbrook master concept, the committed close-view Grand Armoury evidence, and the
committed banker-chest evidence. They supplied only the project's established material language
and examples of the flat surfaces needing detail. No external material library, photograph, game
texture, logo, or third-party art entered the atlas lineage. The exact inputs, prompt, generated
output ID, UTC timestamp, and payload hash are frozen in
[`imagegen-prompts.md`, Record 10](imagegen-prompts.md#record-10-shared-eastbrook-surface-atlas-reference).

## Prompt intent and acceptance summary

This summary is not prompt text and must not be used as a substitute for the source prompt record.

- **Master concept intent:** show a compact fortified Eastbrook around the preserved Grand
  Armoury, one civic well, six subordinate service buildings including a distinct inn, three
  market stalls, and six road-aligned open wall passages. Retain the established stylized
  low-poly World of ClaudeCraft palette and player-readable spacing.
- **Turnaround intent:** isolate one target on a neutral background, show front, rear, both sides,
  several three-quarter views, preserve cobalt roof, stone, plaster, dark timber, warm windows,
  gold trim, and restrained cyan accents, and include a player proxy where scale matters.
- **Wall intent:** show one complete wall wing suitable for composing around a provable five-yard
  opening, including masonry course rhythm, gate-side watch pillar, rail cap, and banded leaf.
  Curvature in the image is assembly-level evidence; the shipping GLB is a straight bounded chord
  whose placements collectively create the concentric ring.
- **Surface-atlas intent:** provide one straight-on 4-by-4 grid of sixteen original Eastbrook
  material families with exact quarter-cell boundaries and no labels, logos, perspective, or
  directional scene lighting. The full-color output is source evidence, not the runtime map.
- **Surface-atlas derivation:** crop and resize every source quadrant independently, convert it to
  deterministic luminance, normalize its second-through-ninety-eighth percentile range into RGB
  `192..255`, assemble sixteen `128 x 128` cells, and encode one lossless `512 x 512` WebP. This
  creates a neutral detail multiplier while leaving GLB vertex colors as palette authority.
- **Acceptance test:** every required service has an identifiable silhouette; the Armoury remains
  visually subordinate only to itself and is not redesigned by the concept; the town center and
  road mouths remain open; turnarounds expose enough sides to support a procedural reconstruction;
  and ambiguous generated details remain subject to the strict sculpt specification.

## Accepted files

Hashes are SHA-256 of the exact tracked PNG bytes. Dimensions are decoded pixel dimensions, not
display dimensions.

| Accepted path | Dimensions | SHA-256 |
|---|---:|---|
| `docs/screenshots/eastbrook-vale-rebuild/concepts/master-concept.png` | `1672 x 941` | `47dea5d471c7ccc4f5b9e206a4359a0b6dcd50695d1463b08f6c8c0a3b9ede50` |
| `docs/screenshots/eastbrook-vale-rebuild/turnarounds/bank.png` | `1536 x 1024` | `39e3ccada6fbf13f8ad96a24929b8eecffa32ea36268ba2c1ae074c517cbcefc` |
| `docs/screenshots/eastbrook-vale-rebuild/turnarounds/chapel.png` | `1536 x 1024` | `dfee757c0625f2d579c550ff5f2e5d0f0be8ab77dfcf914995280f84adba5e1b` |
| `docs/screenshots/eastbrook-vale-rebuild/turnarounds/civic-well-beacon.png` | `1536 x 1024` | `ba631ef564e61e55f9ef4f12d789489786d5fae14ef23cf8cf5804ed133aec02` |
| `docs/screenshots/eastbrook-vale-rebuild/turnarounds/inn.png` | `1536 x 1024` | `88de3747c11fea77dd2393329cde8b3e7fee50a08c64ca02e9a7df673a2dd91a` |
| `docs/screenshots/eastbrook-vale-rebuild/turnarounds/market-stall-fence.png` | `1448 x 1086` | `d741336727175d6adf9c3405078fdb0282615126438dfe12c0122feae9fa5dba` |
| `docs/screenshots/eastbrook-vale-rebuild/turnarounds/smithy.png` | `1536 x 1024` | `9db55397f90a3600543bf7c45e5ab80c27882c40c1a1b690bf91a218239fc7af` |
| `docs/screenshots/eastbrook-vale-rebuild/turnarounds/toolworks.png` | `1536 x 1024` | `bede6f11e6a690b00a43b2f14d0cf7ef30781cdead576cae4ad5bb67cb794901` |
| `docs/screenshots/eastbrook-vale-rebuild/turnarounds/wall-wing.png` | `1586 x 992` | `bccc4fedc945b9359e7c7672a78c46ad777b438ddb61fd3e81969f9fe6562cc9` |
| `docs/screenshots/eastbrook-vale-rebuild/turnarounds/weaving-workshop.png` | `1536 x 1024` | `4ce8a8b671491f0908114d719acf7a2a1ae4ad2f3f1f9354998b7c9bb853453e` |
| `docs/screenshots/eastbrook-vale-rebuild/materials/eastbrook-surface-atlas-source.png` | `1254 x 1254` | `abec3036f8887e9c94972dab52aea664f18a74696db6b6d24cc48a4cfbe22b7d` |

## Derived shipping atlas

The generator original remains in the Codex generated-images store as
`019f91f4-8f50-7963-9204-7c8f970e5dc6/exec-b8b82e03-0fea-435e-9c21-5ac59b6c8981.png`;
both it and the copied source are exactly `2,633,550` bytes. Copying the accepted bytes into the
repository did not move or alter it. The committed processor and exact semantic contract are
`scripts/assets/eastbrook_town/{surface_atlas.mjs,build_surface_atlas.mjs}` and
`scripts/assets/specs/eastbrook_town_surface_atlas.json`.

| Derived path | Dimensions | Bytes | SHA-256 | Role |
|---|---:|---:|---|---|
| `public/textures/eastbrook_surface_atlas.webp` | `512 x 512` | `141666` | `d66f2fab603aa83e6c73c6fc4bdde2d545a6d8c1a0d4a58d42a3fb227e5a3f9b` | Lossless, high-key grayscale runtime detail multiplier; external to every GLB |
| `docs/screenshots/eastbrook-vale-rebuild/materials/eastbrook-surface-atlas-comparison.png` | `1072 x 544` | `878888` | `ea6ba64e200f305f079cc858a4daf5d28dc8c240acd83895729237c521d26576` | Full-color source at left and decoded shipping multiplier at right |

The full-color source and the comparison image containing it are rights-reserved design evidence.
The derived shipping WebP is a separate project asset licensed for redistribution with the
project, as recorded by its own row in `CREDITS.md`. The atlas source fingerprint is
`b6b666385a17aa6c0ac4fedeb1a4c25d78992c26634dfc60d40591268ab685cf`, separate from the
town GLB source fingerprint. The asset test literal-pins both fingerprints and proves that all
nine GLBs still contain zero embedded textures. Visual acceptance verifies cell isolation and
pattern retention; it does not claim byte-level continuity between opposite cell edges. Runtime
UVs therefore remain inside the selected semantic cell. Exactly one loaded runtime texture is
shared by the nine new town GLBs, preserved Grand Armoury, banker chest, rebuilt Ravenpost
mailbox, and Eastbrook noticeboard across Standard and Lambert-compatible graphics paths.

## Rejected iterations

Rejected files remain outside Git in the Codex generated-images store. Their identifiers and
hashes are retained here for auditability, but the files must not be copied into the repository.

| Iteration | Generated filename | SHA-256 | Rejection reason |
|---|---|---|---|
| Master v1 | `exec-af7a282a-9957-4b91-90d0-6459b8ec3b48.png` | `943b5a345697c5ac7779e6ed1b64d34f96a8f91e84ee0b5a163882b17f7a618f` | Strong six-gate and open-center read, but it showed only five subordinate service buildings, omitted the inn, and materially over-interpreted the Armoury silhouette. |
| Master v2 | `exec-2bd52573-c9c1-4788-920d-d7a9d494c97b.png` | `9f3dc65f9f20410089d30575383349f1e6c9c2bbc13f484b5c0b436270aeac80` | Improved spacing and service cues, but still omitted the inn and retained Armoury silhouette drift. |
| Full gate v1 | `exec-15f97054-6544-40a4-9e89-d83a5b250848.png` | `31e25eef7e91f9b92108f54da6273a0c3b19fd3d80a0f98fed05bc6a35df83eb` | Rendered only one wall half-wing, so a symmetric five-yard passage could not be verified. |
| Full gate v2 | `exec-e0d8fc58-fe92-4a21-86be-b16a650d57be.png` | `634383e90a22261d0374755a7067da04f8380c575364996828c6f797b0598f7d` | Again decomposed the gate into disconnected halves and never showed a complete opening. Reference admission therefore moved to one complete wing; shipping realizes it as bounded straight chord modules placed concentrically around test-pinned five-yard gaps. |

Rejection is permanent for these exact bytes. A future design may reuse an idea only through a new
reviewed output, never by silently promoting one of the rejected files.

## Reproducibility and integrity checks

Before merge and whenever an accepted image changes:

```sh
shasum -a 256 \
  docs/screenshots/eastbrook-vale-rebuild/concepts/master-concept.png \
  docs/screenshots/eastbrook-vale-rebuild/turnarounds/*.png \
  docs/screenshots/eastbrook-vale-rebuild/materials/eastbrook-surface-atlas-source.png \
  public/textures/eastbrook_surface_atlas.webp \
  docs/screenshots/eastbrook-vale-rebuild/materials/eastbrook-surface-atlas-comparison.png

sips -g pixelWidth -g pixelHeight \
  docs/screenshots/eastbrook-vale-rebuild/concepts/master-concept.png \
  docs/screenshots/eastbrook-vale-rebuild/turnarounds/*.png \
  docs/screenshots/eastbrook-vale-rebuild/materials/eastbrook-surface-atlas-source.png \
  public/textures/eastbrook_surface_atlas.webp \
  docs/screenshots/eastbrook-vale-rebuild/materials/eastbrook-surface-atlas-comparison.png

node scripts/assets/eastbrook_town/build_surface_atlas.mjs --write
node scripts/assets/eastbrook_town/build_surface_atlas.mjs --check
```

Any hash change creates a new reference version. It requires renewed admission, a revised
provenance row, and re-review of every sculpt feature that cites the changed image.

## Finishing-pass imagegen evidence

The finishing pass used the installed OpenAI `imagegen` workflow with only first-party World of
ClaudeCraft inputs: the accepted rebuild concept, accepted turnaround sheets, and committed
in-game Eastbrook captures. No World of Warcraft, RuneScape, Witcher, or other proprietary game
image was supplied. The user references those games only as high-level MMORPG readability and
public-noticeboard archetype guidance.

| Accepted path | Dimensions | Bytes | SHA-256 | Permitted use |
|---|---:|---:|---|---|
| `docs/screenshots/eastbrook-vale-rebuild/polish/concepts/master-concept.png` | `1672 x 940` | `2992869` | `c962f4ab4b404342b148f428ba020f21062432fadd5cdb85526fb4688c5973a0` | Composition and palette evidence only; never coordinate authority |
| `docs/screenshots/eastbrook-vale-rebuild/polish/turnarounds/ravenpost-mailbox.png` | `1536 x 1024` | `1817015` | `ea809fe8de8798a58dbfb6d5d293a337cafb42402f60c8f4d42093f4dbc954f4` | Mailbox silhouette, proportions, complete sides/rear, material zones, and scale |
| `docs/screenshots/eastbrook-vale-rebuild/polish/turnarounds/noticeboard.png` | `1536 x 1024` | `1801175` | `002a7adcff9780a55d91c261fb39693b6a0e8c35272caa29ded8ee57cdb6232e` | Noticeboard silhouette, roof, rear bracing, blank-paper rhythm, material zones, and scale |

All three outputs live under generated-image directory
`019f91f4-8f50-7963-9204-7c8f970e5dc6`. The imagegen response did not expose call IDs. C2PA
metadata identifies the trained-algorithm source; exact prompts, input paths, output IDs, hashes,
and UTC file timestamps are frozen in Records 11-13 of `imagegen-prompts.md`. The copied bytes
match the generated originals exactly.

Vision review admitted both isolated sheets after verifying stable proportions across front,
right, rear, left, both three-quarter views, and the grazing/player-scale view. The mailbox
scored `0.90` globally, with all critical raven-post, pitched-roof, mail-slot, stone-foot, and
complete-rear systems at or above `0.88`. The noticeboard scored `0.91` globally, with its
roofed-frame silhouette, stone-seated posts, blank notice field, complete rear braces, and scale
systems at or above `0.88`. Both exceed the `0.70` img2threejs global and critical-feature gate.
The master concept scored `0.80` for the narrower composition goal: distributed stalls, stronger
perimeter occupation, an open center, Armoury hierarchy, mailbox, noticeboard, and beacon glow.
Generated perspective is not trusted for literal wall/gate geometry, so measured layout tests
supersede it wherever they differ.

These original PNGs are rights-reserved design evidence. Their deterministic procedural GLB
interpretations are separate project assets licensed for redistribution with the project, as
recorded in `CREDITS.md`.
