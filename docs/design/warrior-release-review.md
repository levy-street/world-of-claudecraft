# Warrior review checkpoint, 18 September

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

The canonical contribution gate is still open. Its first isolated attempt
stopped on Windows line-ending formatting differences; the corrected copy
then stopped on the HDR manifest mismatch described above. Neither run reached
the full test/browser/build sequence. Targeted tests and pre-push checks are
separate evidence and do not substitute for that sequence.

The public Site has not yet received this checkpoint. Publication must preserve
the existing audience, original delivery worktree, and exact source/build
identity. Further classes are outside this Warrior rollout.
