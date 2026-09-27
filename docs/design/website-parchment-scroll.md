# Website parchment scroll

The main website uses `public/website-parchment-scroll-v1.svg` as a decorative
skin behind the live mode, login, registration and recovery controls. This SVG
embeds a 1024 by 1536 pixel WebP encoded at quality 88. Generated with OpenAI's built-in
image generation tool on 2026-09-14. No game-world locations are depicted.

An authored SVG clip path follows the scroll's outline. The generator returned an opaque image despite the transparency
request; a second extraction attempt also returned opaque pixels and was discarded.
The deployed asset embeds the original artwork with the vector silhouette, never the
discarded checkerboard image. CSS border-image divides the artwork into nine regions,
keeping the curled ends at a fixed size while the middle grows with the form. The skin
is decorative and pointer-transparent. UI text, form controls and focus indicators remain HTML/CSS.

## Painted game-style refinement

`public/website-parchment-scroll-v2.svg` is the current version. It embeds a new
built-in image generation edit using the original scroll as the target and
`public/textures/loading/eastbrook-square.webp` as the first-party style reference.
Blue and gold cuffs and painted corner ornament match the loading artwork.
The original v1 is retained as the approved previous option.

Final v2 prompt:

Use image 1 as the EDIT TARGET: this exact blank upright parchment scroll asset. Use image 2 ONLY as a STYLE REFERENCE: World of ClaudeCraft's actual Eastbrook loading artwork, with handcrafted stylized 3D shapes, rich royal-blue accents, golden trim, warmly painted materials and charming classic fantasy MMO art direction. Refine the scroll into a more premium, detailed artifact that belongs in that game. Preserve the EXACT outer silhouette, canvas size 1024x1536, position, width, height, side-edge contour, top and bottom roll placement, and the brown background of image 1 so it fits the existing website mask and nine-slice layout. Keep the clean blank ivory writing area unchanged in value and completely empty. Upgrade the material from photographic paper into refined hand-painted fantasy vellum with soft sculpted folds, gently faceted highlights on the curled paper, beautiful warm ivory grain and restrained edge patina. Add narrow royal-blue lacquer bands with brushed antique gold edges near the far left and far right of BOTH existing curled rolls, entirely WITHIN the existing roll silhouette. Bands should feel like exquisite crafted ornament inspired by the blue-and-gold architecture in reference 2, not huge metal rods. Delicate embossed gold leaf/vine scrollwork confined to the rolled paper and tiny tasteful corner flourishes just inside the upper and lower corners. More material depth, fine artisanal details, polished believable soft golden illumination, softly occluded curled ends, boutique game UI quality. Keep ornament restrained and entirely in the outermost 8 percent of width and top/bottom 12 percent of height. No ornament, pattern, line, symbol, map, text, writing, or seal in the central blank writing area. No characters, landscapes, weapons, logo, title, UI buttons, center emblem, glow effects, extra objects, border frame around the central paper, hanging ribbons, or watermark. Do not alter the silhouette or background. Output ONLY the single upgraded blank scroll asset, not a webpage mockup.

## Validation

- `node_modules/.bin/vitest run tests/client_shell.test.ts tests/css_corpus.test.ts tests/css_value_validity.test.ts tests/css_raw_color_ratchet.test.ts tests/css_token_resolution.test.ts tests/focus_visible_guard.test.ts tests/styles_extraction.test.ts --maxWorkers=2`: 210 tests passed.
- After final frame changes, the value-validity, token-resolution and raw-color tests passed again (42 tests). After the forced-colors override, value-validity and raw-color passed again (38 tests).
- `node_modules/.bin/biome check src/styles/shell.website.css src/styles/tokens.css` and `git diff --check`: passed. Lightning CSS compilation passed.
- Chromium: reviewed the mode and login screens at desktop and phone sizes. Checked 1024, 768, 844 landscape and 320 pixel widths for overflow, always-visible tip, clear bottom-curl spacing, world selection and page errors. All passed. Forced-colors emulation confirmed the artwork is removed in favor of system colors.
- Frontend reviewer identified a low-contrast focus ring; corrected to parchment ink. Added a forced-colors treatment following the final review.
- `node scripts/gate_select.mjs`: stops at the existing i18n freshness check because generated translations are unstaged. No translations were staged. Full merge readiness is not claimed.

## Final source prompt

Create one production-quality transparent PNG asset for a premium fantasy MMORPG login interface: an empty realistic parchment scroll, seen perfectly straight-on, orthographic, portrait aspect ratio 2:3. This is a reusable nine-slice UI frame, NOT a screenshot or mockup. A single upright unrolled sheet of luxurious fine warm ivory vellum, subtle natural paper fibers and faint age variation, softly irregular hand-cut left and right edges, carefully curled horizontal parchment rolls at the very top and bottom, with real paper thickness visible in small spiral ends, realistic soft ambient occlusion beneath the curls. Elegant, restrained craftsmanship, like a museum-quality illuminated manuscript before text is applied. No wooden rods, no metal bars. Soft light from upper left. Most of the sheet is clean flat pale ivory with extremely subtle warm mottling; edge patina is restrained warm ochre, NOT dirty orange or heavily distressed. The central 80 percent width and 76 percent height must remain uninterrupted clean blank paper for live UI controls. Top and bottom curls entirely confined to outer 12 percent of height, no objects or ornaments in center. Fill 96 percent of canvas width and height, modest transparent margin on all four sides. Genuinely transparent background outside the scroll, no backdrop, no checkerboard rendered, no desk, no scene, no extra objects. All corners visible. Crisp realistic material detail, sophisticated AAA fantasy game UI asset. No text, no writing, no symbols, no logo, no seal, no ribbon, no runes, no illustrated maps, no ornamental frame, no watermark. The silhouette must be rectangular enough to stretch its middle vertically without distorting the top and bottom rolled edges.
