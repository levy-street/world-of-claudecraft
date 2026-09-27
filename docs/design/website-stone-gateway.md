# Website stone gateway

The current login skin is `public/website-stone-gateway-v2.svg`. It embeds a
1024 by 1536 WebP image encoded at quality 88 (218600 bytes) and an authored SVG
silhouette. The image was generated with OpenAI's built-in image generation tool.
There are no scripts or external image references inside the SVG.

References: the approved stone gateway concept board, the project's actual
`public/worldofclaudecraft-logo.png`, and the first-party loading artwork
`public/textures/loading/eastbrook-square.webp`. The logo is incorporated into
the generated arch crest. All form controls and interface text remain live HTML.

The frame uses CSS border-image with separate arch, side and base regions. It
grows with login, registration and recovery forms. Phone and tablet breakpoints
reduce the decorative columns and crest to preserve the controls' usable width.
Forced-colors mode removes the art and uses system colors. The earlier scroll
assets are retained as design alternatives.

The website panels explicitly clear the shared mobile max-height limit. Long
registration and recovery content grows the frame instead of extending past its
base. Tablets up to 1120 pixels stack the story and gateway to preserve readable
line lengths. Native and desktop app entry styles remain outside this scope.

## Validation

- `node_modules/.bin/vitest run tests/client_shell.test.ts tests/css_corpus.test.ts tests/css_value_validity.test.ts tests/css_raw_color_ratchet.test.ts tests/css_token_resolution.test.ts tests/focus_visible_guard.test.ts tests/styles_extraction.test.ts --maxWorkers=2`: 210 tests passed.
- After final artwork and breakpoint changes, the CSS corpus, value-validity, raw-color, token-resolution and focus-visible tests passed again (64 tests).
- The final max-height correction passed another 42 value-validity, raw-color and token-resolution tests. `npm run security:gate` passed with zero high findings.
- `node_modules/.bin/biome check src/styles/shell.website.css`, `git diff --check`, and Lightning CSS compilation passed.
- Chromium covered 320, 390, 768, 1024, 1280 and 1920 pixel widths, plus 844 by 390 landscape. World selection, login, registration, unchecked marketing consent, password reveal/hide and recovery navigation passed without horizontal overflow or page errors. Forced-colors emulation removed the artwork correctly.
- `node scripts/gate_select.mjs` still stops at existing unstaged generated i18n artifacts. No staging or remote changes were performed. The full merge gate is not claimed green.

## Generation prompt

Create a single production-ready fantasy MMORPG login gateway FRAME asset, portrait 1024x1536, viewed perfectly front-on, symmetrical and orthographic. Reference 1 is the approved concept board: use ONLY its BOTTOM LEFT stone gateway as the design direction. Reference 2 is the actual World of ClaudeCraft logo: incorporate this exact logo, accurately preserving lettering 'WORLD OF CLAUDECRAFT', into the central carved crest ABOVE the arch opening, elegantly mounted as a large gold and blue emblem. No invented replacement logo. Reference 3 is the game's Eastbrook loading artwork for the stylized hand-painted 3D material style. The gateway has substantial sculpted warm grey stone blocks, restrained gold inlay, royal-blue fabric banners down the narrow outer columns, two small luminous blue crystals near the bases, warm lanterns and a few ivy leaves. The portal opening is a flat very dark desaturated blue-green blank field, softly lit only around the inner edge by a thin cyan magical rim. IMPORTANT: this is an EMPTY UI BACKGROUND FRAME, no form, no buttons, no title inside opening, no writing other than the logo crest, no tip, no text, no extra shields or emblems. Keep the central 72 percent of width and middle 63 percent of height clean, dark and empty for live interface controls. Arch is in the top 23 percent; columns narrow and vertical at outer 14 percent on each side; bottom stone plinth/steps in bottom 12 percent. Narrow side columns allow generous readable UI space. Entire gateway including logo, steps and silhouette visible, frame fills about 96 percent canvas width/height. Put any sky/landscape nowhere: outside gateway use a uniform solid near-black background, no shadows extending far outside silhouette, no checkerboard. Sophisticated premium stylized game art with rich painted textures, subtle bevel highlights, elegant worn stone, precise gold trim, soft luminous accents; not gritty, not photoreal, not plastic. No dramatic camera perspective, no dungeon scene, no other objects. Intended for nine-slice UI scaling: keep vertical midsection simple and continuous, concentrate complex ornament at arch and lower corners. Match the reference concept closely while preserving the game's actual full logo in the crest.
