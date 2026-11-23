# Hood controls and class animation follow-up

> Record of an earlier state of this branch (see the note at the top of
> [the parent page](../README.md)): file names, counts and `tmp/` driver paths below
> describe that state, not the shipped tree.

The character preview canvas intercepted desktop clicks on the helmet eye. Its
stacking context now stays below equipment controls. The state propagation and
the shipped hood meshes did not need changes.

Real pointer checks cover the desktop sheet and the mobile landscape sheet.
The game is landscape-gated on mobile; these checks do not claim portrait support.
The live game matrix clicked the eye for every class and both body fits, checking
the preference, the paperdoll, the world model and hair restoration each time.
Both profiles passed with no page errors. The evidence is in
`desktop-matrix.json` and `mobile-matrix.json`.

| Capture | Result |
| --- | --- |
| [Before desktop](before-desktop-click-ignored.png) | Clicking the eye leaves the hood hidden. |
| [After desktop, shown](after-desktop-shown.png) | Hunter hood visible. |
| [After desktop, hidden](after-desktop-hidden.png) | Hood hidden and hair restored. |
| [After mobile, shown](after-mobile-shown.png) | Female Hunter hood visible. |
| [After mobile, hidden](after-mobile-hidden.png) | Hood hidden and hair restored. |

Validation commands:

- `npm run test:browser -- tests/browser/char_window_helm_toggle.browser.test.ts --maxWorkers=1`: 2 tests passed. The desktop test failed before the CSS change. It uses actual pointer hit-testing and also checks that the uncovered preview remains interactive.
- `npm run test:browser -- tests/browser/woc_hood.browser.test.ts --maxWorkers=1`: 18 tests passed against the shipped GLBs, covering repeated toggles, unequip and default kit restoration.
- `node_modules/.bin/vitest run tests/css_corpus.test.ts tests/css_value_validity.test.ts tests/css_raw_color_ratchet.test.ts tests/css_token_resolution.test.ts tests/mobile_window_layout.test.ts tests/character_presentation_wiring.test.ts tests/woc_parts.test.ts tests/woc_character.test.ts --maxWorkers=3`: 133 tests passed.
- `node tmp/hood_class_matrix.mjs` and `PROFILE=mobile node tmp/hood_class_matrix.mjs`: all 18 models passed in each live-game profile. The temporary capture driver is local; the JSON and screenshots retain its results.

The class combat animation review is tracked in the parent character QA report.
Equipped weapon presentation is deliberately deferred at the user's request.
