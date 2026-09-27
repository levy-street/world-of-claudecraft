# Website fractured portal

Current skin: `public/website-fractured-portal-v5.webp`. The dark midnight-blue
magical interior is baked into the generated artwork. Only its exterior has
alpha transparency; there is no CSS backing or SVG mask. Sampled centre alpha
is 252 of 255 and the corner is 0, preserving the generator's native alpha.

The crown renders the original `public/worldofclaudecraft-logo.png` directly as
a separate decorative image, at its native 978:654 aspect ratio. It is not an
AI-redrawn logo. Keeping it separate prevents nine-slice form expansion from
distorting its lettering. Both decorative layers are hidden in forced colors.

The built-in OpenAI image generation tool produced the portal; Sharp trimmed
the selected 1254 by 1254 PNG, fitted it into a transparent 1024 by 1536 canvas,
and encoded it as WebP (quality 90, alpha quality 100). Responsive image slicing
allows the centre to grow for registration and recovery, while real HTML owns
all text and controls. No authentication behavior changed.

## Transparent frame exploration

Previous skin: `public/website-fractured-portal-v4.webp`, a native RGBA cutout
generated with the built-in OpenAI image generation tool. Its opening and gaps
are genuinely transparent. The stone and logo carry their own color without an
SVG alpha mask or an added dark backing. This is regenerated artwork in the
approved fractured portal style, not a pixel-identical edit of version 3.

The selected 1254 by 1254 PNG was trimmed and fitted into a transparent 1024 by
1536 canvas, then encoded as WebP at quality 90 with alpha quality 100 (418416
bytes). The generated alpha is preserved. Center and corner samples have alpha
0; the sampled logo and medallion surfaces have alpha 253 (over 99% opaque).
CSS uses responsive nine-slice widths and real HTML controls. Phone side slices
are narrower to leave space for the controls. Text shadows support legibility
through the clear aperture without adding a panel backdrop.

## Earlier versions

Previous skin: `public/website-fractured-portal-v3.svg`. This is a generated raster
asset embedded as an optimized 1024 by 1536 WebP (quality 88, 219928 bytes) inside
an SVG. The built-in OpenAI image generation tool used the approved fractured
portal concept and the actual `public/worldofclaudecraft-logo.png` as references.

The portal floats without a floor, threshold, stairs, or ground. The SVG uses a
color-matrix alpha matte to clear the generated solid-black exterior and preserve
the bright stone, gold, blue glow and dark colored interior. It has no scripts or
external resources. The frame and logo are decorative; all controls and text stay
in the page. CSS border-image preserves the crown and lower fragments while the
middle expands for registration and recovery. Existing responsive sizing, natural
form height and forced-colors fallback remain in use. Version 2 reuses the exact
approved artwork with a thresholded alpha mask that clears the neutral black fringe.
A feathered interior mask preserves the dark central backdrop. Generated cutout
attempts that painted a checkerboard instead of alpha were discarded.

Version 3 increases the exterior matte threshold to clear the remaining dark
fringe. Separate opaque paths protect the logo medallion, lettering backdrop,
staff and sword, and the entire dark inner aperture. The geometry and original
raster artwork are unchanged. This is a native SVG mask refinement, not newly
generated artwork. No external resources or scripts are embedded.

The later spacing refinement adds more horizontal and bottom clearance for all
forms. The tip icon is removed; its label and paragraph are centered inside a
narrower text area away from the lower floating stones. The redundant hero logo is
hidden in the website skin, and the genre icon is removed. Feature icon provenance
is recorded in `docs/design/website-feature-icons.md`.

## Controls and alignment

Form headings and account links are centered inside the opening. Field labels stay
left aligned. Primary buttons have notched gold bevels around a dark blue face;
secondary buttons and the world selector use recessed blue surfaces. Fields use
gold corner details, blue focus highlights, and a persistent invalid border even
while focused or hovered. Decorative button layers do not intercept pointer input
or clip the keyboard focus outline. Forced colors removes those layers.

## Verification, 14 September 2026

### Dark interior and content clearance

Version 5 corrects the hollow-frame interpretation: the dark magical surface
belongs to the image itself, with the actual project logo rendered above it.
Desktop and tablet side padding is 112px; phone padding scales from 44px to
72px. Narrower decorative side slices leave every control within the dark
aperture. The phone logo is capped at 260px so it cannot overlap headings at
600px-wide viewports. Lower padding keeps the tip and recovery actions away
from the inward-curving stones. World status text wraps instead of truncating.

Browser checks covered full world selection, registration and recovery at
320px, plus world selection at 390px, 600px, 768px, 1024px and 1920px. Text, controls and the
tip were visually checked against the actual dark opening. Registration has
112px bottom clearance and the 320px scroll width is exactly 320px. The latest
seven-file Vitest command below passed all 210 tests; Biome passed. The selective
gate remains blocked at the existing unstaged i18n freshness difference.
Read-only frontend review verified the mobile logo cap and final padding, with
no remaining actionable findings. Desktop remains centered at (960, 581) in a
1920x1080 viewport. The preview viewport override was reset after verification.

### Native alpha cutout

Version 4 was visually reviewed at 390px and 1920px against mountain, volcanic,
coastal and town scenes, including login and registration. The registration form
retained 104px bottom clearance on phone. A 320px check found a 4px decorative
overhang; reducing the smallest-screen pseudo-element inset removed it, and the
scroll width then measured exactly 320px. Desktop composition still measured
(960, 581), exactly centered below the navigation at 1920x1080. The browser's
viewport override was reset and the live preview left on world selection.

The native WebP metadata and sampled alpha values above were verified with Sharp.
Small colored details in the generated rim were reviewed at display size and do
not form the old continuous black fringe. The seven-file Vitest command below
passed 210 tests. Biome and whitespace checks passed. The selective gate stopped
at the same pre-existing i18n freshness difference. No files were staged, and
later full-gate checks were not certified. Read-only frontend review found no
confirmed CSS or behavior regression.

### Hero composition and matching chrome

Latest desktop adjustment: at least 1600px wide and 960px high, the composition
centers in the viewport space below the navigation. Shorter or narrower laptop
screens retain the approved top spacing. Browser measurement at 1920x1080 put the
hero midpoint at (960, 581), matching the midpoint below the 82px header exactly.
At 1280x800 the portal remained 560px wide with 46px between its panel and header.
Light coastal and dark mountain backgrounds were visually checked with v3.
Alpha checks at six logo/interior sample points were fully opaque (255), and four
exterior points were transparent (0). The validation decoded the embedded WebP
to PNG in memory for librsvg compatibility, without changing the shipping SVG.
The seven-file focused Vitest command below passed 210 tests; Biome and whitespace
checks passed. The selective gate again stopped on existing i18n freshness.

The desktop hero is constrained to 1080px with a 40px column gap and a portal up
to 560px wide. Desktop content begins 36px below the header instead of stretching
vertically through the viewport. Compact laptops from 960px to 1120px use a
two-column layout with a 28px gap; smaller tablets and phones retain a stacked
layout. Larger portal padding keeps field labels clear of the stone fragments.
The header and footer use the portal's navy, gold and cyan palette, angular
controls and restrained faceted details. Mobile navigation has explicit closed
and open states, and large touch screens use the desktop navigation layout.

The website scroll container no longer reserves a visible scrollbar rail, allowing
the header and footer to meet both viewport edges. Its scrolling behavior remains
enabled. Browser measurements confirmed exact right edges at 1280px and 320px,
no horizontal overflow, and a scrollable container. Responsive checks covered
320px, 768px, 1024px, 1120px, 1280px and 1920px; the 1024px portal measured about
508px, and the desktop portal measured 560px with about 44px between columns.
The mobile menu opens and closes, and the registration form keeps natural height
with 132px desktop and 104px phone bottom clearance. Header, footer and laptop
screenshots were visually reviewed. Large-touch behavior was reviewed in CSS;
no device emulation of that input mode was available in this pass.

The seven-file focused Vitest command below passed 210 tests again. After the
scrollbar refinement, `node_modules/.bin/biome check src/styles/shell.website.css`
and the CSS corpus, value-validity, token-resolution and focus-visible guard
tests were rerun. `node scripts/gate_select.mjs` still stops at the existing
unstaged generated translation difference; no files were staged.

For the icon and edge cleanup, the same focused test command below again passed
all 210 tests. Biome and whitespace checks passed. Browser checks at 320px and
768px passed world selection, login, registration and recovery containment, with
104px or 126px bottom clearance and no horizontal overflow. Desktop and phone
screenshots were visually reviewed. The remaining extended viewport checks and
`node_modules/.bin/tsc --noEmit` were interrupted when the local processes stopped;
they are not reported as passing. The selective gate again stopped at the existing
i18n freshness difference. After restarting Vite on port 5174, the in-app preview
loaded successfully and a browser computed-style check confirmed the tip is centered.

- `node_modules/.bin/biome check src/styles/shell.website.css src/styles/tokens.css`:
  passed.
- `node_modules/.bin/vitest run tests/client_shell.test.ts tests/css_corpus.test.ts tests/css_value_validity.test.ts tests/css_raw_color_ratchet.test.ts tests/css_token_resolution.test.ts tests/focus_visible_guard.test.ts tests/styles_extraction.test.ts --maxWorkers=2`:
  7 files, 210 tests passed after the final control changes.
- `git diff --check`: passed.
- Local Playwright browser checks at 320x740, 768x1024, 1440x1000 and 844x390:
  no page errors or horizontal overflow; world selection, login validation,
  keyboard focus, password reveal, registration containment, disabled buttons,
  and forced-colors button fallback passed. Input text remains at least 16px and
  fields at least 56px high. Registration retains 78px or 100px bottom padding;
  the optional marketing checkbox remains unchecked.
- Frontend review: final invalid-border specificity fix verified; no remaining
  findings.
- `node scripts/gate_select.mjs`: stopped at i18n freshness because generated
  translations already in the working tree differ from staged/committed copies.
  No files were staged. Later full-gate checks have not been certified by this run.

Visual review covered desktop and phone controls. This refinement changes the
website presentation only; authentication behavior and API contracts are unchanged.

## Version 4 source prompt

A transparent PNG game UI sprite, isolated object with true alpha background. Premium World of ClaudeCraft fractured magical portal FRAME, absolutely hollow transparent opening. Tall oval-rounded rectangular ring composed of twelve disconnected floating chunks of faceted grey stone, elegant gold inset ornament, bright thin cyan electric magic joining the pieces, a few small floating cyan crystals. At the top crown a solid opaque gold-and-blue fantasy crest reads exactly 'WORLD OF CLAUDECRAFT', arranged WORLD OF above CLAUDECRAFT, a large gold C on a dark blue circular medallion behind the lettering, small blue-orb staff on left and sword on right. The logo's own solid surfaces remain opaque, no added dark backing around it. Hand-painted stylized 3D classic MMORPG item artwork matching sophisticated stone portal UI. Front-on view, symmetrical usable central opening. No black outline, no cast shadow, no scene, no ground, no stairs. The empty opening and all space between fragments must be actual alpha transparency. Do not draw a checkerboard background. Square 1024x1024 canvas with portrait portal centered, height 94% of canvas, width 64% of canvas; leave transparent side margins. ALL pixels not part of stone, gold, logo or blue magic must be transparent. This is an isolated inventory-style game sprite, not a concept art scene or a webpage.

## Version 5 source prompt

Transparent PNG isolated game UI sprite with a genuine alpha channel. A tall oval magical portal of disconnected faceted grey stone chunks, ornate gold inlays, floating blue crystals and thin bright cyan energy connecting them. Premium hand-painted classic MMORPG style. The entire INNER oval is a SOLID OPAQUE dark midnight navy magical surface with very subtle blue mist and a few dim stars, calm empty space for login controls. The inner oval is NOT transparent. Only the OUTSIDE silhouette is transparent, with clean alpha edges, no matte or outline. There is NO LOGO, NO TEXT, no medallion, no staff or sword, no emblem. Leave the top centre as a plain dark navy surface between the upper stones for an official logo to be placed later. No stairs, ground, floor, scenery, cast shadow, checkerboard, labels, form controls or background. Symmetric front-on tall portrait portal occupies 64% of the width and 94% of the height on a SQUARE 1024x1024 transparent canvas, transparent side margins. Keep grey/gold stones slim at the outer perimeter, central dark space wide. True alpha only outside. Dark portal interior must be fully opaque.

## Original source prompt

Create ONE production-ready empty magical FRACTURED PORTAL frame asset for the World of ClaudeCraft website. Portrait 1024x1536, front-on orthographic, all pieces fully visible. Reference 1 is a concept board: faithfully develop ONLY the BOTTOM LEFT 'Fractured portal', not the other three options. Reference 2 is the game's official logo: integrate this complete gold and blue World of ClaudeCraft logo accurately above the portal opening, preserving its lettering and proportions. The design is a tall floating rounded-rectangular magical aperture surrounded by about 12 clearly separated chunks of elegant sculpted grey stone, engraved antique gold inlays, a few tiny floating stone shards, and thin electric-blue magic connecting the gaps. Pieces hover in midair, visibly disconnected. There is no conventional doorway: absolutely NO stairs, steps, floor, flat stone base, threshold, platform, foundations, earth, grass, ivy, banners, lanterns, ground contact or scene. Bottom edge consists only of three curved suspended fragments with open gaps between them; no horizontal walkable surface. Centre is a uniformly very dark desaturated navy-green blank portal field with a subtle cyan rim. NO controls, buttons, headings, tip text, runic writing or other lettering anywhere except the logo above. Essential UI geometry: central blank opening from x=150 to x=874 through the middle, at least 70 percent of canvas width; outer stone pieces confined to the outer 150px on left and right. Logo and crown pieces fully within top 390px. Bottom curved fragments within bottom 240px. The center must stay completely clean for real HTML login controls, not an illustration or a map. Crisp refined hand-painted stylized 3D fantasy game material detail, faceted stone, warm gold bevels, charming classic MMORPG art direction; subtly asymmetrical suspended pieces, restrained glow and particles. Outside the silhouette and in gaps between outer fragments, use a single completely flat solid black background (no gradient, no checkerboard, no scene). Inside opening stays calm dark blue-green. Entire silhouette including floating stones uses 96 percent of canvas width/height with modest empty margin. Keep the logo approximately 480px wide, centered, and do not stretch it. Premium game UI asset, isolated single object, not a webpage screenshot or comparison board.
