# Polished gold mounting plates

Created with the built-in `image_gen.imagegen` editing tool on 2026-09-06.
The edit targets were the project's existing v6 jewel and lock images. Each edit
replaces only the surrounding black area with brushed gold and a broad specular
reflection. Emerald facets, green inlays, dark engraved recesses and the black
keyhole remain intact. There is no animation or blend-mode change.

## Jewel prompt

Reference: `public/ui/minigames/confection-jewels-v6.webp`.

```text
Use case: precise-object-edit
Asset type: medieval fantasy game ornamental hardware on a gold mounting plate.
Primary request: Change only the pure black empty backdrop surrounding the ornament into a continuous opaque sheet of polished warm antique gold, with a very fine brushed metal grain and a broad soft diagonal specular shine. Rich golden midtones, subtle minute burnished texture, brighter champagne-gold reflection across the upper left, deeper honey-gold toward the lower right. This gold backing fills the entire canvas right to every edge; no black matte or empty border remains around the ornament.
Keep the exact foreground ornament, all its raised gold carving, tiny studs, symmetrical side details, size and placement unchanged. Preserve dark recesses, crisp contact shadows and the gemstone/enamel colors so the raised ornament remains distinct from its new gold backing. Use restrained realistic material reflections, no magical glow, no extra objects, no frame outline, no text, no watermark, no transparency or checkerboard. Same aspect ratio as the reference.
Input image is the edit target: the five-emerald ornament. Preserve all FIVE vibrant green jewels and every facet, without tinting them gold. Preserve the exact centered bilateral arrangement and wide 3:1 canvas.
```

## Lock prompt

Reference: `public/ui/minigames/confection-lock-v6.webp`.

```text
Use case: precise-object-edit
Asset type: medieval fantasy game ornamental hardware on a gold mounting plate.
Primary request: Change only the pure black empty backdrop surrounding the ornament into a continuous opaque sheet of polished warm antique gold, with a very fine brushed metal grain and a broad soft diagonal specular shine. Rich golden midtones, subtle minute burnished texture, brighter champagne-gold reflection across the upper left, deeper honey-gold toward the lower right. This gold backing fills the entire canvas right to every edge; no black matte or empty border remains around the ornament.
Keep the exact foreground ornament, all its raised gold carving, tiny studs, symmetrical side details, size and placement unchanged. Preserve dark recesses, crisp contact shadows and the gemstone/enamel colors so the raised ornament remains distinct from its new gold backing. Use restrained realistic material reflections, no magical glow, no extra objects, no frame outline, no text, no watermark, no transparency or checkerboard. Same aspect ratio as the reference.
Input image is the edit target: the engraved winged lock. Preserve the central keyhole as solid dark black, NOT gold, and preserve the tiny dark-green enamel inlays. Keep both engraved wings and the exact centered bilateral arrangement on the original 2:1 canvas.
```

## Delivery

Both selected outputs were mechanically resized to 768px wide and converted with
Sharp using `resize({ width: 768 }).webp({ quality: 90, effort: 6 })`. No raster
retouching or background removal was performed outside the image generation tool.
The original generated PNGs remain intact. Both shipping files are opaque RGB.

- `public/ui/minigames/confection-jewels-v7.webp`: 768 x 256, 99,744 bytes.
- `public/ui/minigames/confection-lock-v7.webp`: 768 x 384, 141,928 bytes.

The [asset manifest](asset-manifest.json) records absolute source paths, shipping
paths, SHA-256 and delivery metadata.
