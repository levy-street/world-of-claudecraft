# Gravewyrm Sanctum trash: sculpted Blender builders

The Ice Tomb's trash bodies, sculpted whole (signed-distance fields meshed through
OpenVDB, decimated, weighted from the sculpt's own primitives, Cycles-baked to one
atlas), replacing the re-tinted placeholder rigs (`src/render/characters/
sanctum_creature_looks.ts`; the shipped looks are `sanctum_trash_looks.ts`). Offline
authoring tooling: nothing here runs in the build or the game.

- `kit/`: the shared sculpt kit (the Balgath / Korgath kit: SDF primitives and CSG,
  body-hugging plate layers, the biped rig and IK pose language, clip writer, bake
  surfaces, `review.py` renders and objective clip gates, `reclip.py` to re-key the
  clips on a baked .blend without re-baking, `ship.mjs` meshopt + KTX2 optimizer,
  `deliver.sh` the delivery pack). Each builder finds it at `../../kit`.
- `boneguard/`: the Sanctum Boneguard (`public/models/creatures/sanctum_boneguard.glb`)
  and its Raised Bonewalker variant (`--variant bonewalker`,
  `sanctum_raised_bonewalker.glb`): one rig and ten clips, Thaw the entrance.

- `thawcaller/cultistas/`: the Broodsworn Thawcaller (`sanctum_thawcaller.glb`), a Codex-built
  cultist (its own frozen builder: analytic two-bone poses baked on a 30 fps half-frame
  timeline, ten skinned material parts). `reclip.py` bakes named clips onto the delivered
  .blend and re-exports the raw GLB (`ThawTheHeld` was added this way); ship with
  `kit/ship.mjs`. `kit/clip_sheet30.py` renders its review frames.

- `goadsmith/cultistas/`: the Broodsworn Goadsmith (`sanctum_goadsmith.glb`), the same
  Codex cultist builder; `BrandingIron` added with its `reclip.py`.

- `pyre_tender/cultistas/`: the Broodsworn Pyre-Tender (`sanctum_pyre_tender.glb`), shipped as
  delivered (its frozen builder kept for reproduction).

- `rime_whelp/builder/`: the Rime Whelp (`sanctum_rime_whelp.glb`), a self-contained copy of
  the Korzul builder made young (shorter neck, bigger head, stubby horns, short intact wings,
  frosted hide, ice-blue eyes and a frost-blue mouth), built at Korzul's scale and rescaled
  to 3.2 yd (`build.py rescale`). `clips.py` adds `RimeBreath` (contact 0.60 s plus the
  one-frame key lead). `jaw_damp.py` eases every clip's jaw toward rest on the baked .blend
  (the young head has no modelled mouth cavity, so a wide gape stretched the lip seam);
  the shipped build ran it twice (0.5 then 0.55).

- `ogre/builder/`: the Ogre Sledge-Hauler (`sanctum_sledge_hauler.glb`), on the shared kit: the
  head grown 1.4x about the top of the neck (`anatomy.HEAD_SCALE`) and the fur mantle kept off
  the face and off the upper arms; his own ice block rides the Weapon bone between his palms
  in IceBlockToss only (RELEASE 1.25 s, the frame the fx block takes off).

- `splinter/builder/`: the Glacier Splinter (`sanctum_glacier_splinter.glb`), on the shared kit:
  faceted convex ice chunks, each rigid on its own bone, over a rune-iron core with the heart
  crystal in the chest window. `clips.py` adds `Fracture` (the split's stagger: every piece jolts
  out from the core and grinds back; CRACK 0.3 s); Death ends on the core's flare at 2.0 s, the
  Shatter's fuse.

Build (Blender 5.2, absolute output paths; keep one Blender job at a time):

    blender -b --factory-startup --python <builder>/build.py -- <abs>/<key>_raw.glb \
      --bake 2048 --tex <abs>/tex --blend <abs>/<key>.blend --stats <abs>/stats.json

`--nobake` (and a coarse `--voxel`) gives a clay look for review. Ship with
`KTX_BIN=<KTX-Software bin> node kit/ship.mjs <raw glb> <out glb>`.
