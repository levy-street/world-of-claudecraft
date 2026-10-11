# Hand-keyed WOC body animations

Movement, emote and autoattack clips hand-keyed on the WOC male and female bind
rigs, separately for each fit. `catalog.mjs` lists every keyed clip; the ones the
game plays (`SHIPPED_CLIPS`) ship as one meshless library per fit:

- `public/models/chars/players/woc_keyed/woc_male.glb` and `woc_female.glb`, beside
  (not inside) the artist's delivery directory `players/woc/`

The bodies load them after the rig's own library (`anims_<fit>.glb`), and two
runtime modules map them: `src/render/characters/woc_keyed_animations.ts` (idle,
walk, run, backpedal, swim, tread, jump, death, and the wave, laugh, flex and bow
emotes) and `woc_autoattack_core.ts` (one-hand, two-hand, unarmed, rifle, bow and
dual-wield white swings, timed by `woc_autoattack_contacts.json`). Combat idles,
casting, strafes, climbing, sitting and weapon transitions keep the rig's own
clips. The rest of the catalog (crouch, flying, the remaining emotes and attacks,
backward run and swim directions) stays buildable for when it is wired.

## Rebuild

From the worktree root:

```sh
node scripts/assets/woc_keyed_anims/build.mjs                    # the shipped libraries
node scripts/assets/woc_keyed_anims/validate.mjs --write-contacts
node scripts/build_media_manifest.mjs generate
npx vitest run tests/woc_autoattacks.test.ts
node scripts/assets/woc_keyed_anims/build.mjs --all              # solves every keyed clip
WOC_KEYED_AUTHORING=1 npx vitest run tests/woc_keyed_anims_authoring.test.mjs
```

The authoring test runs on a solved cache and stops at once, naming the build to run, when
any clip is not solved yet.

`build.mjs --all [dir]` builds every keyed clip into `tmp/woc_keyed_anims` for
review instead. Solving reach and blade keys dominates a build, so each solved
clip spec is cached in `tmp/woc_keyed_anims/spec-cache`, keyed by the authored
spec, the rig and the solver sources (`keyed/anatomy.mjs`, `reach.mjs`,
`blade.mjs`, `spline.mjs`). A cold cache, or an edit to one of those solvers,
re-solves everything (about ten minutes); `WOC_KEYED_NO_CACHE=1` bypasses it.
The build is deterministic: the authoring test rebuilds the shipped libraries
and requires them byte for byte.

## How the keys were made

The keyed modules (`keyed/`) are the editable source: each is a list of key
poses per fit, and the build turns only those values into motion.

- **Anatomical keys** (`idle.mjs`, `run.mjs`, `walk.mjs`, `backpedal.mjs`,
  `runback.mjs`, `jump.mjs`, `death.mjs`, `attack1h.mjs`, `attack1h_1.mjs`)
  write poses directly in the controls `keyed/anatomy.mjs` documents at its
  top: pelvis position and rotation, spine/chest/neck/head [pitch, yaw, roll] in
  degrees, clavicles, arms (`raise`/`plane` or `flex`/`abd`, `twist`), elbow
  flexion, forearm rotation, wrist flexion and deviation, and IK feet that roll
  about the heel or the ball.
- **Beat keys** (every other module) go through `keyed/beat.mjs`: body-level
  targets (pelvis position and facing, how far the chest bends, turns and tips
  over the hips, where the head looks, hand and elbow positions, and the held
  prop's direction and facing) that `beat.mjs` solves into this rig's own
  controls.

The "reference" the module comments mention is the WoW human movement and
autoattack set, retargeted onto these rigs during authoring for side-by-side
comparison. Key values were chosen against it: the anatomical keys from
body-level measurements and comparison strips, and the beat keys from targets
measured off it at 6 to 14 hand-picked beat times per clip, rounded, then
adjusted by hand where the strips showed a problem. Between keys the motion
comes from this rig's splines, IK and resolvers. The clips therefore follow
that reference's poses and timing closely, by design. The reference files and
the comparison tools that read them are deliberately not in this repository,
and nothing here reads reference motion. The libraries record this in their
`wocKeyedAnimations` extras. Fresh keyframes alone do not establish legal
independence, and this method makes no such claim.

### Building blocks

- `keyed/spline.mjs` interpolates every channel separately: a Hermite spline
  through its keys, with `ease` (0 to 1) flattening a key's tangent and
  `ease: -1` passing through at constant speed. `lag` delays channels by a few
  frames for overlap and follow-through (arms after the chest, head after both).
- `keyed/reach.mjs` turns `reach` keys (a hand position and an elbow direction)
  into arm angles: IK to pose, FK to interpolate, so arcs between keys stay
  natural. Arms that swing past hanging or overhead use `armForm: 'swing'`
  (forward/sideways angles) so they do not wrap; twist and plane are unwrapped
  across keys.
- `keyed/blade.mjs` turns `blade` keys (the held prop's direction, plus an
  optional `bladeFace` for its roll) into forearm rotation and wrist angles
  within anatomical limits, solving all keys together so the forearm does not
  flip between neighbouring keys. `bladeSteady` weighs that continuity higher
  for hands that mostly hold still (emotes, crouch, flying, rest poses).
- `keyed/grip.mjs` keeps a two-handed weapon's support hand on the haft: its
  place in the weapon hand's frame is read at its keys, turned about the haft
  between them, and the arm is solved onto it every frame (`spec.grip`, with an
  optional let-go `weight`).
- Direction variants reuse one authored clip: the eight crouch directions turn
  the forward sneak about the vertical axis; the right sidestroke mirrors the
  left one (`mirrorBeat`), with the male's own leg keys.

Each clip's length is set in its module, per fit; the attack swings land at the
times `woc_autoattack_contacts.json` records (rewritten by `validate.mjs`).

## Checks and limits

`tests/woc_autoattacks.test.ts` (CI) checks the shipped libraries: they hold
exactly the keyed clips the bodies bind, every clip validates, the weapon
sockets never animate, and every melee swing's weapon point peaks at its
listed contact. `tests/woc_keyed_anims_authoring.test.mjs` (on demand, above)
re-solves every keyed clip and checks finite rotations and joint continuity,
still planted feet in the standing clips, run feet travelling at the runtime
run speed, exact loop seams, blade keys within the forearm and wrist limits,
sword tips above the floor, the support hand on the haft, distinct male and
female authoring, and the committed libraries against a fresh build.
`validate.mjs` evaluates every exported frame after compression and checks
that the dual-wield halves and pair share one contact.

Known limits: stepping clips pivot or drag a planted foot by a few millimetres
a frame on purpose; swimming and flying feet are not floor-bound; a two-handed
swing's support arm moves up to twice as fast as the reference's for a few
frames at the fastest part of a chop, because the hand stays on the haft.
None of the checks judge how the motion looks; that needs eyes on the game.
