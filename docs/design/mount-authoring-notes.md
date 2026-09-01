# World of ClaudeCraft: authoring a new mount, lessons from the Bonebound Rickshaw

Written after shipping the rickshaw mount (PR #3293) through four review rounds. This is
institutional knowledge that isn't fully written down anywhere else in the repo yet.
Read `.claude/skills/image-to-glb/SKILL.md` and `docs/image-to-glb-asset-workflow.md` first
for the general asset pipeline; this doc is the mount-specific delta plus gotchas.

## The high-level shape of a mount

A mount is at minimum:
1. A GLB asset (`public/models/mounts/<name>.glb`), authored via a procedural factory
   (`scripts/assets/<name>/model.js`) + exporter (`scripts/assets/<name>/export_<name>.mjs`),
   same pattern as any other image-to-glb asset.
2. A `MountVisualDef` entry in `src/render/mount_visuals.ts`.
3. A sim content record in `src/sim/content/mounts.ts` (speed, unlock/grant path).
4. An item def for the reins in `src/sim/content/items.ts` (the mount is granted via
   consuming this item).
5. i18n keys: `hudChrome.mounts.name_<id>` / `desc_<id>` in
   `src/ui/i18n.catalog/hud_chrome.ts`, wired in `src/ui/mount_labels.ts`
   (`MOUNT_NAME_KEYS`/`MOUNT_DESC_KEYS`), PLUS real non-Latin fills
   (zh_CN/zh_TW/ja_JP/ko_KR/ru_RU) in the SAME change if the strings are "wordy"
   (the M16 rule: `tests/i18n_completeness.test.ts` catches it even at PR tier).
6. Item icon art at `public/ui/items/reins_<id>.webp` plus a provenance row in
   `public/ui/items/mapping.json` (see the whole section below, this bit hurts).
7. If it needs a Reliquary collection-catalog entry: `RELIQUARY_HORIZON_MOUNTS` in
   `src/sim/content/reliquary.ts`, plus updating the pinned catalog totals in
   `tests/reliquary_content.test.ts` and `tests/profile_page.test.ts` (they hardcode
   owned/total counts and "N slots" title text: grep for the count and update every
   place it's pinned, not just the obvious one).
8. If it's a rideable creature/humanoid puller (not just a static vehicle): its own
   `VisualDef` in `src/render/characters/manifest.ts`, composed at runtime, see the
   puller section below, this is where the rickshaw's worst bug lived.

## The puller: give it its OWN VisualDef, never repoint a shared one

If your mount has a pulling/carrying NPC-shaped rig (like the rickshaw's skeleton),
**do not** repoint an existing shared `VisualDef` key to a different GLB or reduced clip
set to make it fit the mount. The rickshaw's very first cut did exactly this: it repointed
`skel_minion` (shared by real mob content, `delve_skel_wraith` among others) to a
KayKit-FREE-tier rebuild with a reduced clip set, silently breaking every other consumer
of that key. This was blocker #1 in round 1 review and it was a real live-game regression,
not a nitpick.

**Correct pattern:** mint a new key, e.g. `skel_rickshaw_puller`, pointing at its own GLB
(`skeleton_minion_free.glb` in our case, NOT the same file as `skeleton_minion.glb`), with
its own clip set (`RICKSHAW_PULLER_CLIPS`). The mount's render module
(`src/render/<mount>.ts`) composes this visual onto the cart's socket at runtime; it is
never baked into the vehicle GLB itself. Never assume a name like `skel_warrior_bare` is
safe to leave lying around unused either: round 3/4 review caught a dead VisualDef entry
left over from an earlier, abandoned design; delete anything you stop using.

### If the puller rig needs geometry fixed via a source-pack rebuild
If you rebuild a rig from a raw asset pack (KayKit etc.) because `build_assets.mjs`'s
shared `meshopt()` step corrupts it (this happened here: a multi-primitive skinned
character with several body-part SkinnedMeshes each on its own local bind transform,
meshopt+quantization explodes every part to a giant bounding box), write a STANDALONE
script (see `scripts/assets/rebuild_kaykit_skeletons_free.mjs`) rather than touching
`build_assets.mjs` itself. `build_assets.mjs` is a pinned source-fingerprint input for
an unrelated asset family (Eastbrook); editing it shifts THEIR fingerprint hashes and
breaks tests that have nothing to do with your mount. Write to a NEW output filename
(`_free.glb` suffix or similar), never overwrite the existing shared GLB in place, even
if you're "just fixing a bug": something else in the live game may depend on that
file's exact current clip set.

## Wheel spin: procedural rotation, not baked clips, and it belongs in the mount's OWN module

Two authored attempts at a baked wheel-spin animation clip both failed for the same
reason: an Idle clip that pins the wheel to identity rotation causes a visible snap-back
whenever the mount transitions to/from moving (crossfading a spin clip out drags the
wheel back toward bind rotation, which reads as the wheel spinning BACKWARDS for an
instant on every stop). The fix is a plain per-frame node-rotation function
(`spinMountWheels` here) driven by measured ground travel distance, not an animation
system at all.

**Where this code lives matters.** It was originally inline in `renderer.ts`. Round-2
review moved it to the mount's own `src/render/<mount>.ts` module (with its
`ROLLING_WHEEL_NODES` name-lookup constant, deadzone constant, and a scratch-object for
allocation-free bounds measurement): this is the correct home per the repo's
module-first rule (`renderer.ts` is an explicit non-growth coordinator). If you copy this
pattern for a new mount, put the equivalent function in YOUR mount's own module from the
start, don't let it land in `renderer.ts` even temporarily.

**The wheel node names are a load-bearing, silently-breakable contract.** Whatever names
your `model.js` gives the wheel nodes (`Wheel_L`/`Wheel_R` here), the render-side lookup
matches by exact string. A rename in `model.js` with no corresponding test breaks wheel
spin with ZERO test failing anywhere: the mount just silently stops rolling. Pin the
node names in your asset contract test (see the asset-test section below).

## Audio: one continuous held loop, not per-stride one-shots, for a rolling vehicle

A walking/galloping mount plays a per-stride one-shot cue via `mountRun`. A ROLLING
vehicle mount (wheels, no footfalls) should instead register a single continuous
`mount_loop_<key>` SFX clip and drive it through `Sfx.mountLoop`/`stopMountLoop`:
- One `AudioBufferSourceNode` is created and HELD across the whole ride, never
  stopped/restarted on movement-flag flicker (a moving flag going false then true
  again within the same short window, e.g. bumping into terrain, must NOT retrigger
  the sound). Only the gain ramps: `mountLoop(...)` with `moving=false` ramps gain to 0
  but keeps the source alive; `stopMountLoop` is the only thing that actually releases
  the slot.
- `mountRun` (the per-stride cue) must become a deliberate NO-OP for any mount whose key
  has a `mount_loop_*` entry in `SFX_CLIPS`: don't let both systems fire for the same
  mount. If you copy an existing test that loops `MOUNT_KEYS` unconditionally, it WILL
  break the moment you add a `mount_loop_*` key; filter with
  `MOUNT_KEYS.filter((k) => !(\`mount_loop_${k}\` in SFX_CLIPS))` and add an explicit
  negative test asserting your new mount does NOT play the per-stride one-shot.
- On the renderer side: `mountLoopActive` needs its own boolean field on `EntityView`,
  gated separately from `mountVisualKey`. The naive gate ("call stopMountLoop when
  mountVisualKey !== ''") is wrong because `mountVisualKey` resets to `''` in the SAME
  frame the final stop call is still needed: you'll leak a held audio source on every
  dismount if you don't track "was I actually looping" as its own flag.
- Reset any mount-specific per-entity render state (wheel accumulator, wheel radius
  cache, etc.) on the REAL dismount path (`removeView`), not only on a mount-swap path.
  Two different code paths clear this state and it's easy to only patch one.

## Real PBR surface maps: KTX2 compression is not optional, and the tool is easy to miss

If your mount ships real UV-mapped surface textures (not the vertex-color-only
convention older static props use), every embedded GLB texture MUST be KTX2/Basis
(`KHR_texture_basisu`) before it ships: `tests/glb_texture_compression.test.ts` enforces
this tree-wide. The exporter chain does NOT do this automatically; it emits webp. The
mandatory final step after ANY exporter run is:
```
node scripts/assets/compress_glb_textures.mjs public/models/mounts/<name>.glb
node scripts/build_media_manifest.mjs generate
```
**Real gotcha discovered this session:** the `ktx` CLI tool (KhronosGroup/KTX-Software
4.3+) is not preinstalled and was previously treated as "just not available in this
environment," which was WRONG: it downloads fine directly from the GitHub releases page
(Linux x86_64 tarball, no sudo needed, just extract and add `bin/` to PATH). Don't accept
"the compression tool isn't available" as a permanent blocker without actually trying a
direct download first.

Document the mandatory step directly in your exporter's own header comment (see
`export_rickshaw_mount.mjs`'s header): it's the kind of thing that gets forgotten on the
NEXT asset that copies your exporter as a template, and a stale in-header TODO comment
("no ktx binary was available") is exactly the kind of thing a thorough reviewer will
catch and make you fix.

## The asset contract test: pin everything a silent break could hide

Your `tests/<mount>_asset.test.ts` (mirror `tests/rickshaw_mount_asset.test.ts`) should pin:
- Exact shipped bytes (sha256), so a re-export is always a deliberate, reviewed change.
- The material contract driving surface-map export (names, roughness/metalness/uvScale
  ranges), if you have one (`RICKSHAW_MATERIAL_CONTRACT` pattern in `model.js`).
- `root.listExtensionsRequired()` includes `KHR_texture_basisu` (redundant with the
  tree-wide compression test, but catches a regression scoped to THIS asset immediately
  instead of via a slower whole-repo sweep) plus every texture's `getMimeType() ===
  'image/ktx2'`.
- Every non-emissive material's primitive has both `COLOR_0` (vertex-baked shading,
  every procedural asset in this pipeline rides this) AND `TEXCOORD_0` if it has real
  surface maps.
- No skins/animations/cameras on the vehicle GLB itself if wheel spin and puller gait
  are both driven procedurally at runtime: the GLB should be a plain static mesh.
- The exact wheel/socket node names the renderer looks up by string (see above).
- DON'T write a no-op assertion that tests `node:crypto` instead of the actual asset
  (a bit-flip hash-mismatch test was caught and removed in round 3 review: if you're
  tempted to prove "the hash check actually catches drift," do it by literally mutating
  a byte of the real file in the test, not by hand-computing a hash of unrelated bytes).

## Design-doc hygiene: the sculpt spec WILL be fact-checked against the code

`docs/design/<mount>/object-sculpt-spec.json` (the img2threejs-style authoring doc) is
treated as load-bearing documentation, not a scratch note: a thorough reviewer reads it
and cross-checks every claim against the actual shipped files. Concretely:
- If your puller design changes mid-project (ours went from "reuses the existing
  skeleton_warrior.glb combat rig" to "gets its own skel_rickshaw_puller on
  skeleton_minion_free.glb"), the spec's `revisionNote`, `stageScope.thisPass`, and
  `objectClass.notes` all need updating in the SAME pass, or a reviewer will flag stale
  rig references in three separate places.
- `stageScope.deferred` is a promise about what did NOT ship. The moment a "deferred"
  item actually ships (wheel spin, puller gait, whatever), move it out of that list.
  Leaving a shipped feature listed as deferred reads as either sloppy or dishonest to a
  reviewer who diffs your claims against the commit.
- `authoringNote`/`sourceImage` fields that reference a specific admission-gate process
  (e.g. `check_reference_admission.py`'s per-crop pHash verdicts) must actually describe
  what that gate produces. If your references are real-world photographs rather than an
  AI-generated concept sheet, that pHash/crop-verdict gate was never run against them:
  say so plainly rather than implying a verification step happened that didn't.
- If the material system evolves after the spec is first authored (vertex-color-only to
  real UV PBR maps, in our case), don't leave the old framing standing uncorrected next
  to newly-fixed content: a reader will hit the contradiction immediately.

## Comment hygiene: a moved function leaves stale pointers everywhere

When you extract a function like `spinMountWheels` out of `renderer.ts` into its own
module, grep the WHOLE tree for comments that say "renderer.ts's spinMountWheels" (or the
equivalent for whatever you moved): they don't move themselves. We had six of these
scattered across `mounts.ts`, `mount_visuals.ts`, `characters/manifest.ts`, and the
model.js exporter itself, all still saying "renderer.ts" a full two review rounds after
the function had actually moved. `grep -rn "renderer.ts's <fn>"` across the repo before
calling a refactor done.

Similarly: a comment describing an item as available "while X and Y remain unbuilt" needs
updating the moment X or Y actually ships. Match the phrasing convention an existing
sibling item already uses (we copied the tank mount's "while the feature remains under
development" wording rather than re-litigating new phrasing).

## Item icon art: the real gate is stricter than it looks

- `public/ui/items/mapping.json` requires EXACTLY ONE provenance owner (an `entries[]`
  row or membership in exactly one `generatedBatches[].itemIds`) for every wired item id,
  checked at CONVERT time (`npm run assets:items` refuses to run without it), not after.
  Add the provenance row FIRST, then convert.
- `tests/item_icons.test.ts` hard-fails on two different item ids sharing byte-identical
  art ("different item ids must not ship byte-identical placeholder art"). You cannot
  reuse an existing icon verbatim as a stopgap for a new item, even temporarily, even with
  honest provenance notes saying it's a reuse: the gate does not have an escape hatch for
  this. If you don't have new art yet, the honest move is to leave the item with no
  dedicated icon at all (falls back to the procedural placeholder) and flag it, not to
  duplicate a neighbor's file.
- Master art intake requirements (`scripts/lib/item_icon_intake.mjs`): single-frame,
  square, minimum 512x512, must decode as sRGB, and if it carries an alpha channel every
  pixel's alpha must be fully opaque (255): a "transparent PNG" that's actually 100%
  opaque under the hood passes; genuine transparency does not. `npm run assets:items`
  downscales to the shipped 128px webp and DELETES the source master automatically; if
  you want to keep the master for reference, copy it elsewhere first.
- Follow `docs/design/item-icon-art-style.md` (contract id `woc-item-icon-v1`) for the
  actual generation brief: opaque dark painted vignette, top-left warm key light, cool
  deep shadow, centered subject at 68 to 76 percent fill, no UI border/text/watermark/
  transparency. For a mount specifically, the "Mount collectible" family row wants "a
  recognizable three-quarter mount bust or vehicle portrait with tack and personality,"
  explicitly NOT just loose reins.
  - **Real trap we hit:** an AI-generated image that also depicted the mount's puller
    creature was WRONG when the puller's actual in-game rig doesn't match what got drawn
    (ours showed a hunched quadruped beast-skull creature; the real puller is a bipedal
    humanoid skeleton). Showing a different creature than what players actually see is a
    genuine content-accuracy defect, not a style nit. The lower-risk fix: draw the
    vehicle/mount object alone and omit the puller entirely; the style contract
    explicitly allows a vehicle-only portrait, and it sidesteps the whole
    accuracy-vs-the-real-rig problem.
  - Also watch framing margins on a generated image: elements (lantern top, wheel edge,
    banner top) touching or crossing the image edge violate the "safe padding on all four
    sides" rule and need a regenerate/recrop, not a ship-as-is.

## Reliquary + i18n: multiple pinned totals, not just the obvious one

Adding a mount to the Reliquary catalog touches more pinned numbers than it looks like:
`tests/reliquary_content.test.ts`'s `SOURCE_PENDING_RULING.horizons_mounts` array AND its
owned/total catalog counts AND its slot-total count AND a "three slots" to "four slots"
title-text literal; separately, `tests/profile_page.test.ts` pins its OWN catalog total
that will regress if you only fix the reliquary test's copy. Run the FULL test suite, not
a hand-picked subset, after any Reliquary catalog change: a targeted test list is exactly
how this kind of cross-file pinned-count regression slips through unnoticed.

## Process lessons, not code lessons

- **Use the real gate, not a curated list.** `node scripts/gate_select.mjs` or
  `npm run gate`: self-assembled "I'll just run the tests I think are relevant" lists
  reliably miss real regressions (a Reliquary catalog total pin broke in a totally
  different test file than the one being edited, caught only by running the whole suite).
  Also true of the item-art audit gates: adding one new icon shifted pinned counts and
  hashes across four separate files, not just the mapping.json entry you'd expect.
- **Never rebase a feature branch onto the release branch.** Team-wide policy as of
  2026-08-11: merge the release branch INTO your feature branch instead
  (`git merge upstream/release/vX.Y.Z`). Rebasing rewrites history on a branch that may
  already be pushed or reviewed, and it was causing real release problems team-wide.
- **`git checkout --ours`/`--theirs` semantics SWAP between rebase and merge**, a fact
  that matters less now that rebasing is off the table, but if you ever resolve a merge
  conflict by hand: `--ours` is your own branch, `--theirs` is the branch being merged in,
  the opposite of what those flags mean during a rebase. When in doubt, use an
  unambiguous `git checkout upstream/<branch> -- <file>` instead of relying on
  ours/theirs at all.
- **A tool/environment mismatch can look like a code regression.** Re-rendering all 230
  mob portraits with a slightly different Chrome build than whatever produced the
  currently-committed images produces small-but-real pixel drift (about 0.7/channel
  average) across EVERY portrait, even on a completely unmodified checkout. Isolate this
  by testing against a clean, untouched base before assuming a fingerprint mismatch means
  your branch broke something; it might mean your tooling doesn't match whoever generated
  the baseline, which is a different problem with a different (and possibly
  undoable-by-you) fix.
- **A gate that requires "owner-reviewed" sign-off cannot be self-certified by rerunning
  its script.** The item-art audit's `--refresh-verdict` deliberately refuses to bless a
  new, previously-unreviewed icon; it only updates bookkeeping for an already-reviewed
  set. Follow the existing `incrementalReviews` pattern (append an entry, don't force the
  script past its own guard) and get the actual reviewing human to look at the art first.
