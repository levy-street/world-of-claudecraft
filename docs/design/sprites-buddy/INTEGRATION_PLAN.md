# Sprite buddy: integration plan

Status: steps 1 and 2 are done (the asset, the `buddy_sprites` VisualDef with
Run and the fidgets, the live flames), and step 3 apart from a player-facing
source (the catalog, template, whistle, icon, portrait, names and tests are in;
it is granted by `/dev buddy sprites` and the admin grant only). Still open: a
ClipMap slot for Search, a hop state for Jump, and step 4, the runtime
expression layer.

Step 4 of the model pipeline guide (compress and wire into the game), plus a
runtime expression layer so the faces react to the game instead of only playing
what each clip has baked in.

## Where it lands

Buddies only exist on `feature/v045-integration` (the v0.45.0 release branch
and `main` have none). Build on whichever branch carries the buddy system when
this starts, in its own worktree.

## 1. Asset

- Source: `docs/design/sprites-buddy/sprites_buddy.glb` (rebuild with `animate_sprites.py`,
  `faces.py`, `export_glb.py`).
- Contents: one skinned rig, 4,776 tris, 2 face meshes with 9 morph targets
  (`EyesBlink`, `EyesHappy`, `EyesWide`, `EyesSquint`, `EyesLookL`,
  `EyesLookR`, `MouthBigSmile`, `MouthO`, `MouthFlat`), 10 clips at 30 fps:
  `Idle` (6 s loop), `Walk` (0.8 s loop), `Run` (0.9 s loop), `Search` (4 s
  loop), `Jump` (1.5 s), and idle fidgets `Idle_Nuzzle` (3.2 s),
  `Idle_Peekaboo` (4.4 s), `Idle_Dance` (3.6 s), `Idle_Doze` (5.6 s),
  `Idle_Leapfrog` (2.6 s). Every one-shot starts and ends exactly on the Idle
  pose; every loop closes.
- Compress: textures to KTX2 and meshopt geometry, matching the live buddies
  (`KHR_texture_basisu`). Confirm the compressed GLB still carries the morph
  targets and the `weights` animation channels (quantization must not drop
  them), then re-run the playback comparison against the source rig.
- Place at `public/models/buddies/sprites.glb`; regenerate the media manifest.

## 2. Wiring (render)

`src/render/characters/manifest.ts`, a `buddy_sprites` VisualDef next to
`buddy_horse` etc.:

```ts
buddy_sprites: {
  url: `${BUDDIES_DIR}/sprites.glb`,
  height: 0.75, // tune in game against the other buddies
  clips: {
    ...BUDDY_CLIPS,
    run: 'Run',
    jump: 'Jump',
    idleVariants: ['Idle_Nuzzle', 'Idle_Peekaboo', 'Idle_Dance', 'Idle_Doze', 'Idle_Leapfrog'],
    idleVariantCadence: { everySec: 9, jitterSec: 5 },
  },
},
```

`Search` has no ClipMap slot today. The buddy already runs an autoloot errand
(`src/sim/buddies.ts`); play `Search` while it is on that errand, through a
small optional ClipMap field rather than a one-off renderer branch.

## 3. Wiring (content and sim)

Follow `archived-features/buddies-and-cosmetics/README.md` for what a buddy
needs end to end: catalog entry and template, acquisition, inventory/whistle
item with WebP icon art, names and i18n, CREDITS row, and the
buddy/collections/wire/save tests.

## 4. Runtime expression layer

The clips keep their authored expressions. A new
`src/render/characters/buddy_face.ts` runs right after the mixer each frame
(beside `this.dials?.apply(dt)` in `visual.ts` `updateMixer`) and layers
reactions on top of whatever the clip wrote, combining per shape with max so
the clip and the layer never fight:

- Natural blinks every 2 to 6 s (random, per sprite), so the 6 s Idle never
  repeats its blinks on a visible beat.
- Eyes follow: `EyesLookL`/`EyesLookR` from the angle to the owner's target, or
  to the owner when idle.
- Reactions to owner events, short eased envelopes: loot or quest progress =
  happy; owner hit = wide eyes and "o"; owner below 30% health = squint and flat
  mouth; level up = happy and big smile with a longer hold.
- Only meshes that have these morph names are touched, so every other
  character is unaffected. A few float writes per frame per buddy.

Tests: unit tests for the layer (blink timing, max-combine with clip values,
envelopes), a contract test pinning the GLB clip names and morph target names,
and the manifest wiring. Then check it in game (`npm run dev`) beside the
existing buddies.
