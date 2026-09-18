# Confection Cascade frame provenance

Original project artwork made with OpenAI built-in `image_gen.imagegen` on 2026-09-06.
No third-party artwork or reference image was used for initial generation.

The first generation illustrated a checkerboard but did not provide alpha. It was
rejected for integration. A built-in edit replaced only that background with black.
The shipping asset is **opaque RGB**, intended for CSS screen blending; no alpha
was fabricated and no background was removed with an image-processing script.

## Generation prompt

```text
Use case: stylized-concept
Asset type: one production game UI frame sprite, a square reusable antique-gold picture frame with a genuinely transparent center and transparent exterior. Request 1536 x 1536 RGBA.
Primary request: a highly realistic, masterfully crafted medieval fantasy gold frame for an enchanted confectioner's coffer. Replace crude flat vector scrolls with believable sculpted metal. Front-facing perfectly orthographic view, no perspective. One unified continuous frame, exactly square with four joined right-angle corners. Rich antique gold/brass with dimensional mouldings, shallow engraved elven leaves, fine beaded inner rim, minute hammer marks and darker patina in recessed carving. Refined premium craftsmanship, not gaudy plastic.
Composition: frame occupies almost all the image with only a small consistent transparent safety margin. Uniform rail thickness about 12 percent of image width. Corners contain restrained sculpted leafwork inside the silhouette, precisely connected to all rails. Straight uninterrupted rail sections between corners; no central crest, jewel, emblem, text, or projecting decorations. Large empty transparent square aperture, at least 70 percent of width/height. The four corners and horizontal/vertical rails must align accurately and form one coherent object. Same thickness and inner/outer border geometry all around. Intended for nine-slice scaling to square and wide rectangular UI panels, so keep elaborate carving within corners and straight middle rail sections simple and repeatable.
Lighting: soft museum product lighting from upper left, realistic bevel highlight and gentle physical occlusion within the metal, no external cast shadow, no bloom, sparkle or magic effects baked in.
Materials: restrained deep honey gold, polished edges, satin metal faces, dark aged recesses; finely detailed but clean silhouette readable at small display sizes.
Constraints: ONLY the single frame sprite. Truly transparent alpha for the whole central aperture and every pixel outside the metal. No checkerboard pattern, black/white solid backdrop, wood, velvet, canvas backing, paintings, objects, letters, labels, UI, watermark, icons, or floating flourishes. No disconnected lines, overhanging scrolls, overlapping competing borders, large jewels or chunky plastic shapes.
```

Rejected source: `/Users/demihenderson/.codex/generated_images/01a0755a-4bc1-7141-94b0-39009ed6a4b8/exec-9541d840-23a4-4724-b90e-00e7d9974373.png`.

## Selected background-edit prompt

```text
Use case: background-extraction
Edit target: the supplied square gold frame sprite. Preserve the exact frame geometry, realistic gold material, every carved leaf, shading, dimensions, corner joins and engraved details unchanged.
Change ONLY the white/gray checkerboard background, both in the central aperture and outside the frame, to one perfectly uniform pure black RGB #000000. There must be no checkerboard, transparency illustration, gray pixels, gradients, fog, texture, light spill or glow anywhere in the empty background. The empty central aperture and outer margins are completely flat pure black. Keep a clean accurate edge against all metal. Do not add or remove any metalwork or change its color. No text. This is a production sprite for additive compositing, so the empty pixels must be exactly black.
```

## Shipping file

- Selected source: `/Users/demihenderson/.codex/generated_images/01a0755a-4bc1-7141-94b0-39009ed6a4b8/exec-39b9c290-16d0-4eac-953a-86a6db1554e1.png`.
- Source SHA-256: `ec61f956f08eb2900771bafe87e68e63e31cd5657a1247a13cbdbcd36c81f1dc`.
- Saved asset: `public/ui/minigames/confection-frame-v4.webp`.
- Dimensions: 1024 x 1024, opaque sRGB WebP.
- Bytes: 142,266.
- Shipping SHA-256: `4584e9a1701c1ed3fdebacad65653ef7794cf214551ce24619ff2475900f18d3`.
- Mechanical delivery conversion: Sharp resize to 1024 x 1024, fit inside, no enlargement, followed by WebP quality 90, effort 6. No painting, recoloring, or matte removal.
- Original generated PNGs remain intact. The optimized WebP is the only frame source shipped.
- CSS uses the same 22-percent corner slices on lid, tray, result and button frames. Defeat uses the same artwork with subdued display lighting.
- Attribution and redistribution: World of ClaudeCraft original project art; with the project only, as recorded in `CREDITS.md`.
