# Solid emerald and lock hardware

Generated with the built-in `image_gen.imagegen` tool on 2026-09-06. References
are existing project-generated artwork, not third-party assets. The first two
outputs painted a checkerboard instead of producing actual alpha. Those outputs
were rejected for delivery and edited using the same built-in tool to give the
artwork a pure black surround. The final RGB assets are deliberately displayed
normally on opaque, beveled black-enamel mounts. No screen blend, luminance mask,
manual background removal, or recoloring is applied.

## Jewel prompt

Reference: `public/ui/minigames/confection-jewels-v5.webp`.

```text
Use case: background-extraction
Edit target: the supplied horizontal five-emerald gold ornament.
Keep the EXACT five-gem arrangement, shapes, symmetry, intricate gold leafwork and overall low wide proportions. Improve the material depth subtly: saturated emerald green facets, rich dark-green interior facets, warm solid gold with high-contrast polished edges and real dark recesses. Every gem and metal pixel must be fully opaque and rich in color, never see-through or faded.
Remove ONLY the black background from around and between the ornament, replacing it with genuine transparent alpha. Output an RGBA PNG asset with alpha=0 for background and alpha=255 over all metal and gemstones, with only edge antialiasing partially transparent. This must be actual alpha, not a painted checkerboard. No background color, no white/grey checkerboard illustration, no glow, no haze. One centered horizontal ornament, 3:1 landscape. Preserve full silhouette and generous safety margin. No text or additional objects.
```

Intermediate, rejected checkerboard image:
`/Users/demihenderson/.codex/generated_images/01a0755a-4bc1-7141-94b0-39009ed6a4b8/exec-f1cfe2a6-6e9e-4240-821a-a1033794b624.png`.

## Lock prompt

Reference: `public/ui/minigames/confection-clasp-v4.webp`.

```text
Use case: stylized-concept
Reference image: existing medieval fantasy gold keyhole escutcheon, use its engraved leafwork, gold and keyhole shape as the style reference.
Create one masterfully crafted low wide lock ornament for a premium medieval confectioner's coffer. Orthographic straight front view. Central substantial gold escutcheon with a clearly cut dark keyhole, joined to elaborate MIRRORED wing-like gold leaf-and-vine scrollwork extending to both left and right. Small engraved rosettes and layered bevels on both sides, with tiny symmetrical dark-green enamel details. Exactly bilateral symmetry. The lock remains the focal point. Width about 3.4 times height, central lock taller than the graceful side details. Realistic solid antique gold and brass, warm saturated gold faces, darker bronze recesses, fine chasing, tiny decorative studs and crisply polished raised edges. Luxurious believable sculpted hardware, not flat filigree, no glow or haze.
Composition: a single connected ornament, low wide landscape 3:1 canvas, full silhouette with consistent safety margins. Genuine transparent alpha background around and between the metal, RGBA PNG. All metal and enamel must be alpha=255, entirely opaque; only empty background alpha=0. No painted checkerboard or solid white/black/gray background, no box, no frame rail, no text, no watermark, no floating separate parts.
```

Intermediate, rejected checkerboard image:
`/Users/demihenderson/.codex/generated_images/01a0755a-4bc1-7141-94b0-39009ed6a4b8/exec-7c418e01-8638-4678-afc8-1483ffb2fdae.png`.

## Final background edit

The following exact prompt was applied separately to each intermediate image:

```text
Use case: precise-object-edit
Edit target: the supplied gold and emerald hardware ornament.
Keep the exact ornament, every gemstone, every engraved gold detail, arrangement, size, lighting, outline and placement unchanged. Change ONLY the illustrated white/gray checkerboard background to one uniform pure black RGB #000000. Every empty background pixel around and between the ornament must be pure black. No checkerboard, no grey, no gradient, no haze or light spill. Preserve all rich solid gold colors, dark engraved recesses and vivid green facets exactly. Do not add a frame, text, new objects, or glow. Keep the full original canvas and geometry. This sprite will be displayed normally on a deliberate black-enamel hardware mounting plate, not using a screen blend.
```

## Delivery

The original PNG outputs remain intact. Mechanical delivery processing uses Sharp:
`resize({ width: 768 }).webp({ quality: 90, effort: 6 })`, retaining the source
aspect ratio and RGB color. There is no alpha channel in either final image.

The adjacent [asset manifest](asset-manifest.json) records source and shipping
paths, SHA-256, dimensions and byte counts. Shipping files:

- `public/ui/minigames/confection-jewels-v6.webp`: 768 x 256, 50,078 bytes.
- `public/ui/minigames/confection-lock-v6.webp`: 768 x 384, 71,626 bytes.
