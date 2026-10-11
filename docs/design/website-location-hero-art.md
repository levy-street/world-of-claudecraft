# Website location hero art

Four website-only illustrations generated with OpenAI built-in image generation and optimized to WebP (quality 86). The originals are retained outside the public site. These are loading-screen-style illustrations based on existing locations, not gameplay screenshots or changes to game geometry.

The website crossfades every ten seconds. Static-background, phone, Save-Data and Reduce Motion modes use Eastbrook only. The video is disabled for the redesigned website.

## Sources and final prompts

Verification for this refinement:

- `node_modules/.bin/vitest run tests/auth_utils.test.ts tests/login_parity.test.ts tests/client_shell.test.ts tests/landing_backdrop.test.ts tests/steam_wishlist.test.ts tests/css_corpus.test.ts tests/css_value_validity.test.ts tests/css_raw_color_ratchet.test.ts tests/css_token_resolution.test.ts tests/focus_visible_guard.test.ts tests/styles_extraction.test.ts tests/monolith_budget.test.ts --maxWorkers=2`: 320 tests passed.
- The six CSS guard files were rerun after the transition and stacking fixes: 76 tests passed.
- `npm run check:types`: passed, including Svelte with zero errors or warnings.
- `npm run build:bundle`: passed; backdrop-filter survival passed for all 24 declarations. Final selector specificity and mobile headline refinements were also compiled and verified in Vite's live browser preview.
- `npm run security:gate`: passed, zero high findings after repository priors.
- `node_modules/.bin/biome check index.html src/main.ts src/styles/shell.website.css` and `git diff --check`: passed.
- Browser checks at 1440x1000, 1024x900, 768x1024 touch, 390x844 touch and 844x390 touch: no horizontal overflow, visible expanded tip, no trailer source or video request, and no page errors. Desktop checked actual Offline/Online option clicks, credential-panel entry, static toggle, all four scenes and transition midpoints with exactly two contributing images.
- `node scripts/gate_select.mjs`: stops at the existing i18n freshness comparison against the Git index. Generation reports 0/26 rewritten, but the earlier headline translation artifacts remain unstaged. No staging or commit was authorized; the full gate is not claimed green.

### eastbrook

Output: `public/website-hero-eastbrook-v1.webp`.

References:
- `public/textures/loading/eastbrook-square.webp`
- `docs/screenshots/eastbrook-vale-rebuild/polish/after/after-elevated-overview-desktop-ultra.png`

```text
Use case: stylized-concept
Asset type: wide 16:9 cinematic hero illustration for World of ClaudeCraft's login slideshow.
The user requires an EXISTING game area, not an invented fantasy location. Match the supplied first-party loading-screen image's faceted stylized 3D art, proportions and material language. Use only the named landmarks described below. Elevate lighting, camera and atmospheric depth, not the architecture into an invented megacity. Calm left-center for ivory website copy, main identifiable subject center-right, detailed but uncluttered. No text, words, logo, interface, labels, border or watermark. No siege. No generic added castles. Render as one cohesive premium game loading-screen illustration.
Input 1 is the art-style reference; input 2 is an actual in-game Eastbrook screenshot for the town's small scale and recognisable arrangement, ignore all screenshot UI. Scene: Eastbrook's town square in Eastbrook Vale, a modest circular fenced medieval settlement of blue-roofed stone and timber buildings, the large blue-roofed civic/church hall, central stone well, striped merchant stalls and surrounding open green pine-dotted vale. Ground-level cinematic view from the square's edge toward the hall and well. Match these existing motifs closely; no monumental bridge, harbor megacity, extra towers or invented landmarks. Two tiny adventurers near the lower edge optional. Golden dawn with fresh emerald grass, warm windows, soft mountain haze and long soft shadows.
```

### galecrest

Output: `public/website-hero-galecrest-v1.webp`.

References:
- `public/textures/loading/eastbrook-square.webp`

```text
Use case: stylized-concept
Asset type: wide 16:9 cinematic hero illustration for World of ClaudeCraft's login slideshow.
The user requires an EXISTING game area, not an invented fantasy location. Match the supplied first-party loading-screen image's faceted stylized 3D art, proportions and material language. Use only the named landmarks described below. Elevate lighting, camera and atmospheric depth, not the architecture into an invented megacity. Calm left-center for ivory website copy, main identifiable subject center-right, detailed but uncluttered. No text, words, logo, interface, labels, border or watermark. No siege. No generic added castles. Render as one cohesive premium game loading-screen illustration.
Input is ONLY the loading-screen art-style reference. Location facts from src/sim/content/galecrest.ts: Galecrest is a wind-scoured coastal headland, salt-silvered grassy downs rolling to grey sea cliffs; Wickharbor is a small fishing town with boats sheltered in a harbor cove; the Old Beacon is a lighthouse on the high headland above Wickharbor. Show a cinematic view from the grassy downs across Wickharbor's modest timber-and-stone houses and wooden harbor decks toward the Old Beacon on the right headland. Small fishing boats in turquoise-grey water, open ocean horizon, wind-bent grass, warm beacon light, sea spray and layered coastal haze. No giant castle, no airships, no alpine city, no snow. Late afternoon coastal light with silver-blue sea and warm amber sun breaks.
```

### drakelands

Output: `public/website-hero-drakelands-v1.webp`.

References:
- `public/textures/loading/drakemaw-caldera.webp`

```text
Use case: stylized-concept
Asset type: wide 16:9 cinematic hero illustration for World of ClaudeCraft's login slideshow.
The user requires an EXISTING game area, not an invented fantasy location. Match the supplied first-party loading-screen image's faceted stylized 3D art, proportions and material language. Use only the named landmarks described below. Elevate lighting, camera and atmospheric depth, not the architecture into an invented megacity. Calm left-center for ivory website copy, main identifiable subject center-right, detailed but uncluttered. No text, words, logo, interface, labels, border or watermark. No siege. No generic added castles. Render as one cohesive premium game loading-screen illustration.
Input is the EXISTING Drakemaw Caldera loading-screen artwork, preserve its actual zone motifs closely while create a new wide viewpoint. Location facts from src/sim/content/drakelands.ts: the northern Drakelands has cinder dunes giving way to the Drakemaw volcanic belt of lava pools and jagged bloodglass crystal where drakes roost. Scene: looking across the Bloodglass Fields toward Drakemaw Caldera, black basalt shelves, ember-red faceted crystals, winding lava channels and volcanic cone, a few drakes circling high over the crater and grounded near egg clutches. Small adventurers lower edge for scale. No newly invented fortress or grand castle, no siege, no battle crowd. Dramatic copper-red lava illumination against cool charcoal ash clouds with readable terrain and glowing amber horizon.
```

### thornpeak

Output: `public/website-hero-thornpeak-v1.webp`.

References:
- `public/textures/loading/thornpeak-storm.webp`

```text
Use case: stylized-concept
Asset type: wide 16:9 cinematic hero illustration for World of ClaudeCraft's login slideshow.
The user requires an EXISTING game area, not an invented fantasy location. Match the supplied first-party loading-screen image's faceted stylized 3D art, proportions and material language. Use only the named landmarks described below. Elevate lighting, camera and atmospheric depth, not the architecture into an invented megacity. Calm left-center for ivory website copy, main identifiable subject center-right, detailed but uncluttered. No text, words, logo, interface, labels, border or watermark. No siege. No generic added castles. Render as one cohesive premium game loading-screen illustration.
Input is the EXISTING Thornpeak loading-screen artwork, preserve its world motifs but use a fresh cinematic framing. Location facts from src/sim/content/zone3.ts: Thornpeak Heights is a rugged high mountain zone; Highwatch is its defended wall-and-watchtower settlement, Stalker Ridge and Stormcrag its rocky ridges, Glimmermere a small mountain lake. Scene: the cobbled approach and timber watchtower at Highwatch, blue cloth banners, low stone defensive walls, rope bridge over a misty ravine, jagged peaks beyond. Main tower and ridge center-right, a small distant Glimmermere lake suggested below, warm lanterns among rain-wet stone and sparse pines. Clearing storm, silver sunlight through dramatic clouds, restrained warm gold lanterns, atmospheric blue slate mountains. No new huge palace or floating structures, no siege, no giant foreground dragon. Closely match the supplied loading-screen style.
```
