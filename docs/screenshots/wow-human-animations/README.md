# WoW human retarget review : 2026-10-10

Browser captures use the shipping WOC bodies, heads and warrior low armor,
the actual armor binding helpers and Three AnimationMixer. Before captures
use WOC Idle/Run; after captures use the retargeted Workshop clips. Negative
run labels denote cycle fractions: -0.25 means 25%, not negative playback.

The isolated viewer checks facing, pose, armor follow and death grounding.
The runtime captures additionally exercise the production character controller.

Validation on feature/wow-human-animations, based on
origin/feature/v045-integration at 0eb25c44e96:

- `npx vitest run tests/woc_wow_animations.test.mjs tests/woc_character.test.ts tests/woc_entry_preload.test.ts tests/character_clipmaps.test.ts tests/character_tpose_repair.test.ts --maxWorkers=2 --hookTimeout=30000` : 105 passed. Increased hook timeout accommodates concurrent work on this machine.
- `npx tsc --noEmit` : passed.
- `npm run build` : passed, including localization, guide and media generation.
- `npm run test:browser -- tests/browser/shardpike_throw.browser.test.ts`: four passed after matching its setup to the real deferred world-entry preload.
- Architecture and localization guard tests: 163 passed, three skipped.
- Explicit Biome checks of changed/new JavaScript and TypeScript : passed.
- `GATE_SELECT_BASE=origin/feature/v045-integration node scripts/gate_select.mjs`: generated-file freshness and malware scan pass. The fallback full suite failed the unrelated `professions_blob_growth.test.ts` save-size assertion (249,939 versus pinned 246,084 bytes). Stopped that broad run after the failure and reproduced it alone. No simulation or persistence files changed. Full gate is not green.

The low-tier offline game entered the world with zero JavaScript exceptions.
The production CharacterVisual controller was exercised on both actual WOC
rigs with heads, armor and weapons through idle, run, swim, tread, land, death
and revival. Each settled action held full weight; death grounded and revival
restored standing height. Runtime captures show those controller poses.
The translucent water reference is 0.75 yards above the pivot, matching the
simulation's surface-swim depth.

Frontend and test-coverage reviewers checked the change. Findings fixed:
preserve floor sit/riding; follow legs with armor skirts; assert all runtime
mappings, ordered socket rotations and shipped planted-foot speed. The speed
regression caught and eliminated 30 Hz resampling distortion.

Shipping libraries contain 36 clips per fit: 341,388 male bytes and 355,936
female bytes. Twelve source clips are selected; combat and casting remain WOC.

Dev deployment completed at game revision `691952a908cd57730abc12a0c5014646444921dc`
through clean woc-deploy main `03e65acad5975576bc6390046d7ecd383b45c1c2`.
Recap: 36 OK, 11 changed, zero unreachable or failed. The detector stayed at
`7a3b3e3f558b7ebc92dbdc7505bde2b9ff0a507e`. Public health and play page passed;
both hashed public animation files matched the tested local bytes exactly.
The follow-up browser setup correction changes tests only, not deployed code.

## Classic autoattack follow-up : 2026-10-11

Separate Classic Era human attack libraries now supply plain autoattacks on both
fits. Each contains 15 retargeted source clips plus aligned dual-wield main,
offhand and paired variants. Named abilities, wands and held-cast releases retain
their existing paths. The libraries add 461,692 bytes to deferred entry loading.

`autoattack-before.png` exercises the original one-hand strike through a named
ability; `autoattack-after.png` exercises plain autoattack dispatch. Additional
captures exercise dual-wield, staff, crossbow and resident bow-skin loadouts on
the production controller, with male and female rigs shown side by side.

- `node scripts/assets/wow_human/build_autoattacks.mjs`: passed; the final compressed
  GLBs provide the contact timing table, and all paired/individual dual contacts align.
- `npx vitest run tests/woc_autoattacks.test.ts --maxWorkers=1 --hookTimeout=60000`:
  six passed, including both-fit shipped-asset/socket/finite-pose/contact checks and
  same-frame dual timing regression.
- The focused companion run passed 191 existing movement, character, export,
  clipmap, T-pose repair and architecture tests. Its two new contact failures were
  fixed by measuring compressed output and then passed in the command above.
- `npx tsc --noEmit`, `npm run build`, scoped Biome and `git diff --check`: passed.
- Production browser dispatch selects the new strikes for both fits; named cleave
  retains its original strike, and the controller returns to the imported run.
  Both hands return identical timing on same-frame dual attacks.
- Selective gate passed generated-file freshness, malware scan and scoped changed
  lint, then fell back to the full suite. That broad run was stopped; the known
  unrelated `tests/professions_blob_growth.test.ts` failure was reproduced alone
  (249,939 bytes against the 246,084 pin). Full gate is not green.
- Focused frontend review completed; fixed bow selection, clean-checkout build
  directory creation and dual contact alignment. No simulation rules changed.
