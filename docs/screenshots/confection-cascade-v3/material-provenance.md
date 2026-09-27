# Confection Cascade walnut material provenance

This original walnut texture supports the third visual pass of the Confection
Cascade coffer. It supplies the organic grain under the CSS lighting, molding,
and decorative gold elements. It contains no game UI, text, or third-party art.

## Generation

- Tool: OpenAI built-in `image_gen.imagegen`, text-only generation.
- Date: 2026-09-06.
- Reference images: none.
- Requested dimensions: 1024 x 1024.
- Returned dimensions: 1254 x 1254, opaque sRGB PNG.
- Source file: `/Users/demihenderson/.codex/generated_images/01a075f5-97e4-7be3-a6c0-51e034242133/exec-35117f56-24af-4299-9705-7d074230efd2.png`.
- Source bytes: 2,415,311.
- Source SHA-256: `47dfd81f84376301f10497fb2159ae88a31c5e4dd2afa2291cbd4562f7dc1a6b`.

Exact prompt:

```text
Use case: photorealistic-natural
Asset type: seamless game UI material texture, one square 1024 x 1024 image for a medieval fantasy confectionery coffer.
Primary request: a photorealistic refined dark walnut surface filling the entire image, with tangible fine organic flowing wood grain, tiny subtle pores, and a softly waxed aged patina. Warm rich brown with restrained natural contrast, premium hand-finished walnut that feels real at close range.
Composition: flat orthographic top-down material scan, uninterrupted surface with organically varied fine grain predominantly vertical. Seamless and tileable on all four edges. Even detail scale throughout. Intended for repeated use at about 256 CSS pixels per tile.
Lighting: diffuse perfectly even illumination, no directional shadows or baked highlights, no vignette.
Constraints: material texture only. No planks, boards, seams, cracks, edges, borders, frame, objects, knots that dominate the image, ornament, carvings, text, lettering, watermark, perspective, or distinct central subject. No metallic elements. No strong gloss or orange cast. Fully opaque.
```

## Shipping asset

- Path: `public/ui/minigames/confection-walnut.webp`.
- Dimensions: 1254 x 1254, opaque sRGB WebP.
- Bytes: 194,398.
- SHA-256: `5a6154009964a91b3027492e21655b16273e22702015e0fc4e37059f4dd5f6cc`.
- Transformation: Sharp WebP transcode only, `webp({ quality: 84, effort: 6 })`.
- No resizing, cropping, compositing, recoloring, or manual artwork editing.
- Original PNG remains at the generated-image path; only the optimized WebP ships.

Visual inspection of the source and shipping WebP confirmed fine organic walnut
grain, an even flat view, and no added text, frame, objects, or dominant knots.
The prompt requests tileability; exact edge continuity is not asserted by this
record. Final game component captures cover the integrated material appearance.

Attribution: World of ClaudeCraft, original project art generated with OpenAI.
Redistribution follows the project-asset row in `CREDITS.md`.
