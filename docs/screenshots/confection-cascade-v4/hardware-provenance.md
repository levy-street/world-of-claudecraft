# Confection Cascade hardware provenance

The fourth visual pass uses original generated hardware artwork for the clasp,
emerald crest, and barrel hinges. All artwork was generated with the OpenAI
built-in `image_gen.imagegen` tool on 2026-09-06. The first generation for each
piece used only the exact text prompt below, with no reference images.

## Background and optimization

The tool returned an opaque RGB checkerboard for each transparency request.
A single built-in extraction edit per piece also returned RGB. Those six
checkerboard files are rejected and do not ship. A final built-in edit of each
original replaced the checkerboard with black. The shipping images are opaque
sRGB sprites intended for CSS `screen` blending; they do not have an alpha
channel. No manual background removal or painted matte was performed.

Each selected PNG was resized to a 384px longest edge and converted with Sharp:

```js
await sharp(source)
  .resize({
    width: 384,
    height: 384,
    fit: 'inside',
    withoutEnlargement: true,
    kernel: 'lanczos3',
  })
  .webp({ quality: 90, effort: 6 })
  .toFile(output);
```

This preserves the original aspect ratio within integer pixel rounding. No
cropping, recoloring, compositing, matte changes, or manual painting was applied.
The original PNGs remain intact at their generated-image paths. Only the
optimized WebPs ship in `public/ui/minigames/`. The three files total 62,708 bytes,
reduced from 524,996 bytes for the initial full-resolution WebP encodings.

Visual review of all selected PNGs and shipping WebPs checked the sculpted metal,
engraving, believable hardware shape, preserved gem/keyhole details, and clean
black surroundings. The optimized images retain visible relief, highlights,
gemstone texture, and functional hardware details. Shipping-file outer borders
are pure black. Bounds below were remeasured after resizing and include pixels
whose maximum RGB channel exceeds 12; they are useful sizing guides, not alpha
bounds.

## Shipping files

| Asset | Dimensions | Bytes | Visible bounds (x, y, width, height) |
|---|---|---:|---|
| `public/ui/minigames/confection-clasp-v4.webp` | 288 x 384 | 22,044 | 56, 40, 176, 304 |
| `public/ui/minigames/confection-crest-v4.webp` | 307 x 384 | 23,616 | 56, 27, 195, 329 |
| `public/ui/minigames/confection-hinge-v4.webp` | 384 x 192 | 17,048 | 39, 21, 306, 147 |

### Clasp

- Shipping SHA-256: `444917d0c0938c398c941f79d7875a564abbc9159ff73160dc0248175aba7ecd`.
- Selected source: `/Users/demihenderson/.codex/generated_images/01a075f5-97e4-7be3-a6c0-51e034242133/exec-d1933726-66ae-412f-b289-be367a165fe7.png`.
- Selected source dimensions: 1086 x 1448, opaque sRGB PNG.
- Selected source bytes: 1,530,326.
- Selected source SHA-256: `73e2b5d75cbeb9ad2a99247186fea74f02ea0360e5306891523a3591e5df2704`.
- Original generation: `/Users/demihenderson/.codex/generated_images/01a075f5-97e4-7be3-a6c0-51e034242133/exec-bc9e0200-20fe-4f92-a00d-9b22e78c9b7f.png`.
- Original generation dimensions: 1086 x 1448, opaque sRGB PNG.
- Original generation bytes: 1,874,991.
- Original generation SHA-256: `714f4876ea3a591c25f2fa14ab590cc481cc0412f6caebc4ffdf0f421acf0c0b`.
- Rejected extraction edit: `/Users/demihenderson/.codex/generated_images/01a075f5-97e4-7be3-a6c0-51e034242133/exec-102595e7-892a-4388-b25f-52f8b9af50f3.png`.
- Rejected edit dimensions: 1086 x 1448, opaque sRGB PNG.
- Rejected edit bytes: 1,782,759.
- Rejected edit SHA-256: `2672cbd06e6a6382e7c78e14748fdd4589fac1b4b5798c51d4df2bda2b297459`.

Exact original generation prompt:

```text
Use case: product-mockup
Asset type: single isolated transparent-background game UI hardware sprite for a premium medieval fantasy confectionery coffer. Original artwork.
Style: realistic dimensional cast antique gold and warm brass, very fine engraved vine details, elegantly sculpted molding, darker naturally worn crevices, restrained aged patina, convincing polished metal bevels, soft upper-left illumination. Handcrafted and refined, designed to remain legible at 35 to 55 screen pixels. Straight-on orthographic front view, symmetrical upright placement. Transparent background with a real alpha channel, not white or checkerboard painted into the image. No floor, scenery, surrounding frame, text, labels, extra objects, or external cast shadow. Fill the canvas with one hardware piece and a small transparent margin. Fully cut out object, clean soft antialiased edges.
Subject: one small vertical rounded metal clasp lock plate, a realistic sculpted escutcheon for the front apron of a wooden confectionery box. Softly curved shoulders, slender shaped lower tip, believable domed cast construction, a tiny recessed keyhole and subtle surrounding engraved foliage. The keyhole is small, softly shadowed and physically inset into the brass, not a big cartoon black shape. Elegant premium craftsmanship, no padlock body, no hanging chain. The entire piece has an approximately 3:4 width-to-height silhouette. One centered object only.
```

### Crest

- Shipping SHA-256: `2d898dfb4c549cbe34974be1bb735453c3281963b4fef374ea93d7ca39ee80d0`.
- Selected source: `/Users/demihenderson/.codex/generated_images/01a075f5-97e4-7be3-a6c0-51e034242133/exec-c502a1b7-980f-4901-a1c6-15ce1780e748.png`.
- Selected source dimensions: 1122 x 1402, opaque sRGB PNG.
- Selected source bytes: 1,394,360.
- Selected source SHA-256: `e8d9a8600a374528925feda7e53051fe09ab88ff54d4c6a99b3c1bddc5ca2483`.
- Original generation: `/Users/demihenderson/.codex/generated_images/01a075f5-97e4-7be3-a6c0-51e034242133/exec-bba992f3-8b4e-49f6-a01b-6598214a1a3b.png`.
- Original generation dimensions: 1122 x 1402, opaque sRGB PNG.
- Original generation bytes: 1,785,234.
- Original generation SHA-256: `df81e294266e9d7c8ca6ba4632e2aa9ae6f2172fd739c959fd75effbca24f67f`.
- Rejected extraction edit: `/Users/demihenderson/.codex/generated_images/01a075f5-97e4-7be3-a6c0-51e034242133/exec-985f7deb-f6f3-4153-9100-c79f99355109.png`.
- Rejected edit dimensions: 1122 x 1402, opaque sRGB PNG.
- Rejected edit bytes: 1,699,210.
- Rejected edit SHA-256: `fbf901678ac554884b236d714b7ef870a9638329f95d50b9bb8bf9ac0bddf9c6`.

Exact original generation prompt:

```text
Use case: product-mockup
Asset type: single isolated transparent-background game UI hardware sprite for a premium medieval fantasy confectionery coffer. Original artwork.
Style: realistic dimensional cast antique gold and warm brass, very fine engraved vine details, elegantly sculpted molding, darker naturally worn crevices, restrained aged patina, convincing polished metal bevels, soft upper-left illumination. Handcrafted and refined, designed to remain legible at 35 to 55 screen pixels. Straight-on orthographic front view, symmetrical upright placement. Transparent background with a real alpha channel, not white or checkerboard painted into the image. No floor, scenery, surrounding frame, text, labels, extra objects, or external cast shadow. Fill the canvas with one hardware piece and a small transparent margin. Fully cut out object, clean soft antialiased edges.
Subject: one elegant vertical oval emerald cabochon in a slender dimensional sculpted gold leaf bezel. Deep translucent forest-green gemstone, softly domed and polished with a realistic upper-left reflection, surrounded by delicate symmetrical gold acanthus leaves and fine engraved vines. A modest oval ornament for the centre of the lid of a medieval confectionery coffer. Refined and airy proportions, not an oversized crown, no spikes or wings. Approximately 4:5 width-to-height silhouette. One centered object only.
```

### Hinge

- Shipping SHA-256: `9d4ab9c612f51965d5b63bd48fa214a7401be29449a8112a47854a7a6ccbcfe8`.
- Selected source: `/Users/demihenderson/.codex/generated_images/01a075f5-97e4-7be3-a6c0-51e034242133/exec-6553a02d-0b6f-4f5c-a6b6-3a4883cecbc1.png`.
- Selected source dimensions: 1774 x 887, opaque sRGB PNG.
- Selected source bytes: 1,674,991.
- Selected source SHA-256: `902dd7eecdf9377e5630ed56b90120880e58d6bacbdff330cbb2c1cea27f277c`.
- Original generation: `/Users/demihenderson/.codex/generated_images/01a075f5-97e4-7be3-a6c0-51e034242133/exec-33166809-1cb5-4146-a130-2fe5834a272d.png`.
- Original generation dimensions: 1774 x 887, opaque sRGB PNG.
- Original generation bytes: 2,016,203.
- Original generation SHA-256: `a4c83fbb336e67f99c49707cc1c4ad3ce2e3f7fb81ce2fc72b6ebe208419e6b2`.
- Rejected extraction edit: `/Users/demihenderson/.codex/generated_images/01a075f5-97e4-7be3-a6c0-51e034242133/exec-b74286be-fe99-49f9-96fc-7f09f31b8485.png`.
- Rejected edit dimensions: 1774 x 887, opaque sRGB PNG.
- Rejected edit bytes: 2,124,946.
- Rejected edit SHA-256: `5aa77ee3e33095b39fc5ab73988b822dfd56d00367f06b17bd7827d289a6e65c`.

Exact original generation prompt:

```text
Use case: product-mockup
Asset type: single isolated transparent-background game UI hardware sprite for a premium medieval fantasy confectionery coffer. Original artwork.
Style: realistic dimensional cast antique gold and warm brass, very fine engraved vine details, elegantly sculpted molding, darker naturally worn crevices, restrained aged patina, convincing polished metal bevels, soft upper-left illumination. Handcrafted and refined, designed to remain legible at 35 to 55 screen pixels. Straight-on orthographic front view, symmetrical upright placement. Transparent background with a real alpha channel, not white or checkerboard painted into the image. No floor, scenery, surrounding frame, text, labels, extra objects, or external cast shadow. Fill the canvas with one hardware piece and a small transparent margin. Fully cut out object, clean soft antialiased edges.
Subject: one small horizontal brass barrel hinge with two attached engraved screw plates extending above and below the barrel. Believable three-segment cylindrical knuckle construction, hinge pin ends and four tiny countersunk brass screws anchoring the two plates. Fine vine engraving on the softly shaped screw plates, smooth functional barrel clearly visible. A practical premium antique coffer hinge seen directly from the front in an open flat position, no wood included. Approximately 2:1 width-to-height silhouette. One centered object only.
```

## Exact edit prompts

Each rejected extraction edit referenced its matching original generation file:

```text
Use case: background-extraction
Edit target: the provided hardware sprite.
This image currently has an opaque fake checkerboard painted behind the object. Remove that entire checkerboard and all white background, replacing it with ACTUAL TRANSPARENCY in a PNG alpha channel. The pixels outside the object must have alpha 0. Do not paint any checkerboard, white, gray, or colored substitute. Preserve the metal object exactly: silhouette, position, dimensions, engraving, gold color, lighting, gemstone or keyhole where present. Preserve the original canvas dimensions. Preserve natural antialiased object edges, and keep the object's interior fully opaque. Deliver a genuine transparent-background isolated object asset. No other change.
```

Each selected black-background edit also referenced its matching original
generation file, not the rejected extraction edit:

```text
Use case: precise-object-edit
Edit target: the provided isolated antique gold hardware object.
Change ONLY the background: replace all the white and gray checkerboard surrounding the object with perfectly solid pure black, RGB (0, 0, 0), hex #000000. Make every background pixel pure black right up to the object's antialiased edge. No gradient, halo, noise, shadow, texture, floor, reflection, checkerboard, or vignette in the background. Preserve the hardware object's exact silhouette, position, dimensions, engraving, gold color, lighting, gemstone or keyhole where present. Preserve the original canvas dimensions. The result is an OPAQUE black-background sprite for additive screen blending, not a transparent image. Do not alter the object and do not add anything.
```

Attribution: World of ClaudeCraft, original project art generated with OpenAI.
No third-party artwork entered the lineage. The project attribution row in
`CREDITS.md` links to this record.
