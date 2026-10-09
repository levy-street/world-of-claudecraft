# Sunken Bastion drowned: sculpted Blender builders

The second-generation bodies of the Sunken Bastion's drowned garrison, sculpted
whole (signed-distance fields meshed through OpenVDB, decimated, weighted from the
sculpt's own primitives, Cycles-baked to one atlas) instead of the first roster's
toy sailors (`../sunken_bastion_creatures/drowned.py`). Offline authoring tooling:
nothing here runs in the build or the game.

- `kit/`: the shared sculpt kit (SDF primitives and CSG, body-hugging plate layers,
  the biped rig and IK pose language, clip writer, bake surfaces, review renders and
  objective clip gates, the `ship.mjs` optimizer). It is the Balgath / Gravewyrm
  Sanctum trash kit, copied unchanged except one hook: `build_core.run` calls the
  creature's optional `anatomy.post_mesh(pairs)` after binding (the Revenant grows its
  head there).
- `warhound/`: the Bastion Warhound (`public/models/creatures/bastion_warhound.glb`), a
  self-contained quadruped builder (the Wildheart Great Jaguar's kit: one sculpted skin, a
  digitigrade rig, the whole-body pose language in `clips.py`) reshaped into a drowned war
  mastiff. Build from `warhound/` with `build.py -- <abs>/bastion_warhound_raw.glb --bake 2048
  --tex <abs>/tex --blend <abs>/bastion_warhound.blend` (`--voxel 0.03 --nobake` for a clay
  look); `reclip.py` re-keys the clips on a baked .blend, `anchors.py` prints the effect anchors.
- `watchman/`: the Drowned Watchman (`public/models/creatures/drowned_watchman.glb`), built
  the Revenant's way from the same kit: a gaunt head under a kettle hat, a riveted
  brigandine, a split watch coat (`tabard_weights`), the halberd and its pennon on the
  never-keyed Weapon bone, a sea-light lantern at the hip; `clips.py` has Idle, CombatIdle,
  Walk, Run, Attack, Attack2, HalberdSweep, Cast, Hit, Death. Anchors print with
  `../kit/anchors.py` (the generic one, reading `anatomy.ANCHORS`).
- `arbalest/`: the Fogbound Arbalest (`public/models/creatures/drowned_arbalest.glb`): a deep
  hood and mantle (`hood_weights`), face rags, a quilted gambeson, a quiver and the windlass
  crossbow, laid out in the frame the posed fist gives it in the shouldered aim
  (`XB_FWD`/`XB_UPV`, from `kit/hand_frame_probe.py`); the bolt, the drawn and loosed strings
  and the crank ride their own bones so Shoot and Aim show the loose (keyed scales) and the
  windlass reload. The muzzle anchor at `Shoot:0.5` is `ARBALEST_MUZZLE` in
  `bastion_creature_fx_core.ts` (`../kit/anchors.py -- <abs>/arbalest Shoot:0.5`).
- `sergeant/`: the Drowned Sergeant (`public/models/creatures/drowned_sergeant.glb`): the Revenant's
  body made heavier, a closed great helm with a T-slit over a smooth form round the head (not the
  face's own bumps), a kelp plume, three-lame pauldrons, both vambraces, the sash (`build_sash`, a
  band over the cuirass) and the bearded boarding axe (haft and iron as two rigid parts on Weapon);
  `clips.py` has Idle, CombatIdle, Walk, Run, Attack, Attack2, Rally, Hit, Death.
- `chanter/`: the Mist Chanter (`public/models/creatures/mist_chanter.glb`): the kit body thinned to
  a bent crone (bony arms, clawed hands, bare feet), a hooked-nose face, the shawl-hood of rag and
  fishing net (`net` surface), weed-hair (`hair_weights`), a rag bodice, a shell necklace, skirts to
  the ankles (`tabard_weights`, the front following the thighs) and the driftwood staff with its
  lure of sea light (a `glow_lure` part); `clips.py` has Idle, Walk, Run, Attack, Attack2, Cast,
  Ward (a loop), Hit, Death. (Her first rig served the Gravewyrm Sanctum's Thawcaller
  placeholder until that cultist got its own body, `../gravewyrm_sanctum_trash/`.)
- `acolyte/`: the Tidebound Acolyte (`public/models/creatures/tidebound_acolyte.glb`), grown from the
  Chanter's builder: an upright living cultist, the cowl and a tall finned mitre, robes to the feet
  with wide sleeves (`build_sleeve`), gill slits, the coral-crowned staff with its pearl of sea light
  and the conch laid out in the left hand's frame; `clips.py` has Idle, Walk, Run, Attack, Attack2,
  Mend (the Brine Mend loop), Hit, Death.
- `prisoner/`: the Shackled Prisoner (`public/models/creatures/drowned_prisoner.glb`), grown from the
  Chanter's builder: a starved body (ribs, spine knobs, the belly fallen in), the drowned grin, a
  long weed mane grown with the head, rag breeches, and the irons (`build_irons`: manacles, collar
  and ankle shackle with snapped chains, rigid on their bones); `clips.py` has Idle, Walk (the
  dragging lurch), Run, Attack, Attack2, Hit, Death, Kneel (Snapped Fetters: the arms flung wide as
  the chains break, then down on his knees, 1.5 s) and KneelLoop (held on his knees, a 4 s loop).
  Kneel and KneelLoop were added to the shipped GLB with `kit/reclip.py` on the baked .blend and
  `kit/splice_clips.mjs` (below), so its meshes and KTX2 textures are byte-for-byte the old ones.
- `turnkey/`: the Gaol Turnkey (`public/models/creatures/gaol_turnkey.glb`), grown from the Sergeant's
  builder: a bloated jailer (the gut, swollen bare arms), a studded jerkin, an apron (the front panel
  only), the executioner's hood (grown with the head, its cape on `hood_weights`), the collar and the
  chain on the left forearm, the key ring on the Weapon bone and the lantern twice (`LanternB` at the
  hip, `LanternH` in the left fist, swapped by keyed scales in LanternRaise); `clips.py` has Idle, Walk,
  Run, KeySwing, ChainLash, LanternRaise, Cast, Hit, Death. `TURNKEY_RAW_HEIGHT` and
  `TURNKEY_LANTERN_HIGH` in `bastion_creature_fx_core.ts` come from `../kit/anchors.py -- <abs>/turnkey
  LanternRaise:0.36`.
- `olen/`: Knight-Commander Olen (`public/models/creatures/knight_commander_olen.glb`), the first boss, grown
  from the Sergeant's builder: fluted plate with a brass breast sigil (`build_breast_sigil`), a grand morion
  (`_Brim`, `HelmTrim` in brass) under a horsehair crest (`build_crest`), a bevor of three lames up under the
  nose, a folded cloak (`_FoldedCloak`, its own Cape chain), greaves and cuisses, and the tower shield held by
  its upright grip in the left fist (`shield_matrix`: the board's up runs through the fist, its face is the back
  of the hand, so the clips aim the board with `hand_dir_l`/`hand_roll_l`; tune them with a probe of the posed
  board). `clips.py` has Idle, CombatIdle, Walk, Run (the shield-first charge), Attack, Attack2 (the bash),
  Attack3 (the Reaping Arc), OathCharge (the 2.5 s bar, bar-locked, a beat longer so it never wraps at the
  launch; retired with the charge), Stunned (Breached), Hit, Death, and the fallen paladin's kit, each on its
  sim bar: Consecrate (Hallowed Brine, 1.2 s, the blade planted at 0.9), ShieldThrow (Rebounding Bulwark, 1.5 s,
  the release at 1.3), ShieldCatch (0.6 s, the board back in the fist at 0.12), Judgement (Sentence of the Tide,
  1.0 s, the point levelled at 0.45), OathKneel (Unbroken Oath, 1.5 s, down at 1.1) and OathVigil (a 2.4 s loop
  in the bubble). The board rides its own never-turned `Shield` bone under the left fist (`anatomy._bones`, the
  shield parts bound to it in `dressing.py`), so ShieldThrow and ShieldCatch hide and show it by its keyed scale;
  `add_shield_bone.py` gave the already-baked .blend that bone without a re-sculpt. The one-shots start and end on
  the guard (CombatIdle), not on Idle, so the checks' Idle seams are expected there, and Consecrate, OathKneel
  and OathVigil set the sword's point in the flags on purpose (the checks' "under the ice").
- `ossick/`: Gaoler Ossick (`public/models/creatures/gaoler_ossick.glb`), the second boss, grown from the
  Turnkey's builder into a hunched hulk (the trapezius hump, mooring-post arms, bigger fists): a bald drowned head
  in an iron brank (`build_brank`, rigid on the head and grown with it), a crossed leather harness
  (`build_harness`), his own snapped manacles (`build_manacle`), the anchor chain over the left shoulder, a kilt,
  and three twin props shown one at a time by keyed scales: the anchor (`AnchorB` on his back, its own mesh
  `OssickAnchorBack` so the renderer can hide it while his thrown anchor lies out; `AnchorH` in the left fist),
  the shackle pair (`ShackleB` at the hip, `ShackleH` in the fist) and the cudgel (`Weapon` in the right fist,
  `CudgelB` thrust through the belt while both fists heave the shackles). `clips.py` has Idle, Walk, Run, Attack,
  Attack2, AnchorHurl (1.8 s bar), ShackleHeave (1.2 s), CudgelSlam (1.0 s), Hit, Death; each bar's release is
  on its end and the rest plays out.
- `revenant/`: the Bastion Revenant (`public/models/creatures/drowned_revenant.glb`):
  `anatomy.py` (skeleton, sculpts, the morion, cutlass, buckler, barnacles, kelp),
  `dressing.py` (rigid parts and the sea-light eyes), `shading.py` (bake surfaces),
  `clips.py` (Idle, CombatIdle, Walk, Run, Attack, Attack2, Attack3, Hit, Death,
  Rise), `anchors.py` (prints the effect anchors `bastion_drowned_fx_core.ts` uses).

Build, from `revenant/` (Blender 5.2 with OpenVDB; run it at low priority, a full
bake takes about ten minutes):

```
blender -b --factory-startup --python build.py -- <abs>/drowned_revenant_raw.glb --bake 2048 --tex <abs>/tex --blend <abs>/bastion_revenant.blend --stats <abs>/stats.json
KTX_BIN=<KTX-Software bin> node ../kit/ship.mjs <abs>/drowned_revenant_raw.glb public/models/creatures/drowned_revenant.glb
node scripts/build_media_manifest.mjs generate
```

Quick clay look (no bake): add `--k 1.6 --nobake`. Reviews:
`blender -b x.blend --python ../kit/review.py -- <out> views|closeup|checks|analyze --builder <abs>/revenant [--knight knight.glb]`.
Anchors: `blender -b x.blend --python anchors.py -- <abs>/revenant`.

New clips on an already-shipped creature without re-encoding its textures: re-key them on the
baked .blend (`reclip.py`), then splice only those clips into the shipped GLB (its meshes and KTX2
images are kept as they are; the new clips are resampled like `ship.mjs` does), and regenerate the
media manifest:

```
blender -b x.blend --python ../kit/reclip.py -- <abs>/prisoner Kneel,KneelLoop <abs>/raw.glb
node scripts/assets/sunken_bastion_drowned/kit/splice_clips.mjs public/models/creatures/drowned_prisoner.glb <abs>/raw.glb Kneel,KneelLoop <abs>/out.glb
node scripts/build_media_manifest.mjs generate
```

Posing aids in `kit/`: `probe_aim.py` (which weapon directions a key pose can reach),
`hand_frame_probe.py` (the rest-space directions a posed fist turns onto given world
directions, to lay a held prop out so it points where it should in its key pose).
