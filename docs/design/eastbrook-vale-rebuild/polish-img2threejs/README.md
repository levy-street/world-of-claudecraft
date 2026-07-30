# Eastbrook polish img2threejs intake

This packet applies the installed `img2threejs` 1.3.0 intake and strict sculpt contract to the
replacement Ravenpost mailbox and the new Eastbrook noticeboard. Both are original stylized
World of ClaudeCraft assets for a real-time browser MMO. They are procedural reconstructions
from AI-generated turnarounds, not mesh extraction, photogrammetry, or manufacturing models.

## Reference decision

The full turnaround sheets are conditional composition references because each sheet contains
several panels. Seven isolated views per object were cropped, visually inspected, admitted with
`check_reference_admission.py`, and hashed. All fourteen primary crops passed the empty-mask,
fragmentation, minimum-size, and duplicate-angle gates. The mailbox's complete rear crop had a
silhouette pHash within six bits of its front crop, so the duplicate gate correctly kept it out
of the primary set. A tighter rear-detail crop was admitted instead; the rear three-quarter view
still carries the complete rear silhouette. Together, the front, side, rear-detail, two
three-quarter, and grazing views provide enough evidence to infer complete low-poly volumes.

Small panel-to-panel changes remain possible because the turnarounds are generated images. The
spec therefore locks one canonical component contract instead of copying every incidental mark.
No readable lettering, third-party crest, or proprietary symbol is permitted.

## Shipping material decision

The generated images contain baked studio illumination, so their pixels cannot establish exact
albedo, roughness, normal, height, or ambient-occlusion maps. The shipping implementation must
not pretend otherwise. Both assets use the repository's established Eastbrook alternative:

- semantic vertex-color zones carry timber, stone, cobalt roof, parchment, iron, and gold;
- one external shared Eastbrook detail atlas adds restrained mid-frequency grain;
- roughness and emissive response remain independent runtime scalars by semantic family;
- no reference crop or inferred PBR map is embedded in either GLB;
- no texture is duplicated between the assets;
- Low uses the same value and color grouping through its Lambert-compatible material path.

This deliberate game-ready alternative is stricter than silently accepting low-confidence PBR
extraction from a lit reference. Neutral, grazing, dusk, Low, and Ultra renders still have to
prove that bevels, relief, seams, value grouping, and contact darkening survive relighting.

## Locked budgets

| Asset | Triangle target | Hard ceiling | Materials | Primitives | Embedded textures |
|---|---:|---:|---:|---:|---:|
| Ravenpost mailbox | `2,000` | `3,000` | `2` | `2` | `0` |
| Eastbrook noticeboard | `1,500` | `2,500` | `2` | `2` | `0` |

Both assets are floor-seated, centered on X/Z, use +Y up and +Z front, and expose stable sockets
and compound collider intent. They remain fully legible and available on every graphics preset.

The accepted optimized mailbox measures 1,640 triangles, 2 primitives, 2 materials
(`MailboxOpaque` and `MailboxMetal`), 32,884 bytes, and bounds of 1.65 by 1.05 by 2.9 yards.
The accepted optimized noticeboard measures 1,184 triangles, 2 primitives, 2 materials
(`EastbrookNoticeboardSurface` and `EastbrookNoticeboardHardware`), 24,684 bytes, and bounds
of 2.4 by 0.6 by 2.6 yards. Both use `EXT_meshopt_compression` and
`KHR_mesh_quantization`, remain centered and floor-seated, and embed no textures.

## Gate state

Each spec begins at the locked `blockout` pass and advances only after a rendered screenshot,
comparison sheet, AI vision review, and all applicable critical feature scores meet the exact
`0.7` threshold. A global average cannot hide a failed critical identity feature. The completed
shipping packets record all seven sequential reviews through optimization and reconcile the
locked budgets with the inspected GLB outputs.

The per-object folders contain admitted-view provenance, a completed pre-spec assessment, a
mapped detail inventory, the strict `ObjectSculptSpec`, and the admitted crops used by later
comparison sheets.
