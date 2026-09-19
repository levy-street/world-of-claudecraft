# Warrior review checkpoint, 19 September

The Warrior art at `876ec612` includes the approved Red Harvest contact work,
purpose-specific steel and blood attacks, acoustic shouts, equipment-bound
defenses, native spins, and the final area-impact and Leap refinements. This
record supplements the individual Warrior design/review reports; it does not
certify the art as AAA or replace Tony's hands-on review.

## Completed visual evidence

External evidence is retained in `work/studio-contact-pass`:

- `warrior-final-warrior-complete-cycle-one-sept18`: all 45 representative
  Warrior fixtures, Ultra, ordinary Studio camera.
- `warrior-final-warrior-complete-cycle-two-frozen`: all 45 fixtures, Ultra,
  outdoor context. Capture-only controls were hidden; the actual camera and
  effects were unchanged. This precedes Leap's final three palette constants.
- `warrior-final-warrior-leap-storm-final`: final Leap plus accurately sampled
  Bladestorm receiving impacts, outdoors.
- `warrior-final-warrior-area-final-reduced`: all seven final area/Leap
  refinements, reduced motion, outdoors.
- `warrior-final-warrior-area-six-quality-verified`: the same seven abilities
  across all six presets, 42 successful fixtures. Each report retains its
  source hashes, exact state samples and capture script fingerprint.
- `warrior-natural-timing-warrior-final-sept18`: three 30-second legal
  rotations against five dummies without mid-take resource/cooldown resets.
  Each measured 7ms median and 14ms p95 on this laptop. Audio was off and there
  was no hostile attacker; these results do not prove audio or raid performance.

Every completed batch above reported no runtime errors, missing assets or
source drift. Older family reports supply their own low-tier and specialization
coverage. The final six-preset batch covers seven refinements, not every
Warrior fixture at every setting. The first outdoor cycle-two attempt was
invalidated by a build-triggered reload. The first all-quality attempt failed
before any fixture because the sandboxed browser could not start. Neither
failed attempt receives acceptance credit.

## Reproducible packaging correction

The independent validation clone exposed a genuine media-manifest mismatch:
Git's Windows text heuristic inserted four carriage-return bytes into each of
the two Evergarden HDR headers. Their committed blobs are correct; the previous
manifest had been generated from converted working-copy bytes.

`.gitattributes` now protects HDR images as binary. The two local files were
restored from their exact committed blobs and the owning generator regenerated
the manifest. There is no HDR asset-content change in Git. The renderer's HDR
decoder produced identical pixel buffers before and after this correction at
both resolutions. The art captures therefore remain representative of the
decoded lighting; the production asset URLs now match committed bytes.

`tests/hdr_asset_bytes.test.ts` reproduced two failures before the fix and
passes all five cases afterwards. It tests actual Git clean filtering under
three conversion policies and the two shipping fingerprints. It does not claim
to perform an operating-system checkout roundtrip.

## Remaining release status

The canonical contribution gate is still open. The exact committed validation
copy subsequently completed its full Vitest step with 3,529 passing files,
103 failing files and 31 skipped files. It stopped there; later canonical
stages did not run. The retained full log identifies Windows/tooling failures,
explicit timeouts and real assertion failures. These are not all established
baseline failures, and the run is not a passing release gate.

The Warrior reconciliation corrected Bloodletting's authored torso lean from
16 to 10 degrees. Its actual shipped blade now crosses the representative torso
plane at 0.45990 native units, above the unchanged 0.4 minimum. All other clips,
contact timing, foot tracks and root motion are unchanged. The original contact,
performance, clip-map and architecture suites passed all 158 cases. Matching
captures are retained in `docs/screenshots/warrior-readiness-v25` as
`bloodletting-contact-before.png` and `bloodletting-contact-after.png`.

Red Harvest's saturated-pool test still expected the retired tall extraction
columns. It now verifies the approved full-width blade sweeps: two paths with
over 12 units of lateral reach, under one unit of vertical spread, and both
receiving seams surviving the same-frame saturated pool. The choreography and
admission suites passed all 15 cases. No live Harvest effect was changed by this
test correction. Contact/audio fixtures now check exact receiving-surface
positions and the authored Bloodletting bite; their three suites passed 93 cases.

The CI screenshot checkout now includes all four referenced Warrior evidence
folders. The exact set-equality guard passed after the full run released its
load; earlier timeout attempts remain recorded. The renderer readiness pin and
actual callback tests preserve rejection, shutdown and generation-retirement
coverage. Targeted passes do not retroactively turn the full gate green.

The final focused Warrior check ran all 85 suites whose filenames cover Warrior,
Fury, Harvest, Bloodletting, ribbon admission and shield outcomes: all 785 tests
passed. The separate held-state and pulse-ownership fixture repairs passed all
31 tests. These results establish the stated focused scope only.

The public Site received this checkpoint as version 29. Its exact source is
game commit `5f9547dd5dd23018b73e8ca91cc9168cd37e249e`; the delivery tree is
preserved at `43e2b7902b0e5b2a0d7f66d35577ac8a258ab6fa`. The live preview passed
three Warrior specialization casts, audio-control activation, Ultra, Art view
and the 390-pixel mobile layout with no browser errors or missing assets. The
live Bloodletting contact asset matches the reviewed local SHA-256. This does
not establish subjective sound approval or a passing full contribution gate.
Further classes are outside this Warrior rollout.

Tony requested review before the broader pass on swings, footwork, weight
shifts and recovery. That pass remains paused. His subsequent Twinstrike blood
coherence and Onrush ending feedback authorizes those specific corrections;
it does not reopen the broader movement pass.

## Follow-up: coherent blood and Onrush arrival

Twinstrike now uses Red Harvest's torn blood film and directional impact atlas.
Its two opposing cuts have wider silhouettes, a brief contact catch and the same
dark receiving incision. The second cut remains heavier than the first; Red
Harvest retains the larger final sweep. The actual hit count, victim-following
wound, miss/block handling and short clear times are unchanged. Matching first
and second contact images are in `docs/screenshots/warrior-readiness-v25` as
`twinstrike-blood-before-first.png`, `twinstrike-blood-after-first.png`,
`twinstrike-blood-before-second.png` and `twinstrike-blood-after-second.png`.

Onrush receives an authored planted arrival brace in its existing animation
asset. The finish compresses into a short hold and recovers with equipment still
held, without adding a sword sweep or gameplay damage. The original rush and
Leap tracks are unchanged. The presentation's old arrival test required a
separation below 2.5 yards, while the real movement stops within 4 yards. The
correction shares the gameplay range and distinguishes raw displayed movement
from the gait's brief anti-jitter hold. Real simulated charges and the Studio
capture reproduced the original gap; the corrected capture plays the brace
before returning to idle. The earlier 50ms stepped capture did not itself
reproduce an unwanted automatic chop, so it does not prove that artifact occurs
under every timing. `onrush-ending-before.png` and `onrush-ending-after.png`
record the changed finish in the same evidence folder.

These are specific review corrections. Final visual approval remains Tony's,
and the broader movement pass and whole-game gate remain open as stated above.

The final focused feedback check passed 23 suites and 324 tests, including the
actual simulation stopping distance, native arrival asset, two-entity animation
scratch, movement/cast interruption and blood-contact pool reuse. Native TypeScript
checking and scoped Biome checks also passed. Natural playback passed eight
Onrush takes: near/far charges across all three specs plus immediate walking and
an explicit follow-up cast. Every uninterrupted take recorded at least two real
autoattack damage events; all takes retained the final runtime hashes and reported
no errors. This is scoped feedback evidence, not a replacement for the open full
gate or Tony's visual review. Final quality-matrix evidence is recorded separately
with the delivery so it retains its actual capture provenance.
