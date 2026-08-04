# Hunter quiver icon art brief

Six committed WebPs are needed before this branch can pass
`tests/item_icons.test.ts` (guard A). Every non-weapon item is auto-entered into
`ITEM_IMAGE_IDS` (`src/ui/icons.ts`), and `ITEM_ART_PENDING` is pinned empty, so
there is no defer path: the art is the last blocking step.

## Files

```
public/ui/items/moggers_hide_quiver.webp
public/ui/items/cragmaw_huntquiver.webp
public/ui/items/gravewyrm_bone_quiver.webp
public/ui/items/direfang_quiver.webp
public/ui/items/heroic_gravewyrm_bone_quiver.webp
public/ui/items/heroic_direfang_quiver.webp
```

The two `heroic_` files are the auto-generated raid/dungeon upgrade clones. They
must be byte-distinct from their base (guard I), so give each a visibly hotter
treatment rather than re-encoding the base art.

## Process

1. Generate the six masters as square, high-resolution images.
2. Drop them into `public/ui/items/` named exactly as above.
3. Run `npm run assets:items` (converts to WebP, downscales to the served 128px
   square, deletes the source).
4. Add one `generatedBatches` entry to `public/ui/items/mapping.json` recording
   `batchId`, `source`, `license`, `styleReference`, `commonPrompt`,
   `itemIds[]`, and `itemDirections{}`. That row is the licensing record, so it
   must describe what was actually run.
5. `npx vitest run tests/item_icons.test.ts`.

## Common prompt (house style, current batch convention)

> Fresh, physically distinct premium hand-painted dark-fantasy MMORPG inventory
> art of one tangible centered object on an opaque blue-black or charcoal
> atmospheric vignette. Top-left key light, restrained rim accents, crisp
> readable silhouette, intentional safe margins, and visual-mass centering.
> Uncluttered composition and a plain unbusy backdrop so the object reads
> instantly at small size. No UI border, rarity frame, circular halo, text,
> watermark, mannequin, character, scenic diorama, crop, or giant external aura.

## Per-item directions

Shared subject note: every one of these is a QUIVER, an arrow container worn at
the hip or back. Show the vessel as the subject with a few arrow shafts and
fletchings reading out of the mouth; never a bow, never loose arrows alone, and
never a character wearing it.

### moggers_hide_quiver, "Mogger's Hide Quiver" (uncommon, item level 7)

- Acquisition: drops from Mogger, the level 6 rare elite in Eastbrook, the same
  bandit leader who drops the caster's Valefire Lantern.
- Subject: a crude bandit-made quiver of coarse stitched hide over a bent bark
  frame, hand-cut lacing, a plain iron ring, scuffed and rain-darkened. Four or
  five rough arrows with uneven grey goose fletching. Field-improvised gear
  taken off a roadside bandit: no ornament, no metalwork beyond the ring.

### cragmaw_huntquiver, "Cragmaw Huntquiver" (rare, item level 17)

- Acquisition: drops from Old Cragmaw, the level 14 rare elite beast of
  Thornpeak Heights, alongside Cragmaw's Huntcord and the Cragmaw Prowlboots.
- Subject: a highland hunter's quiver built from thick beast hide with the fur
  still on one flank, closed with a carved antler toggle and a braided sinew
  cord matching the Huntcord's lacework. Cold grey-blue highland cast. Arrows
  fletched with barred brown raptor feathers. Trophy-built from the beast it
  drops from, but practical working gear, not a ceremonial piece.

### gravewyrm_bone_quiver, "Gravewyrm Bone Quiver" (rare, item level 23)

- Acquisition: drops from Korzul the Gravewyrm, the level 20 boss of the
  five-player Gravewyrm Sanctum.
- Subject: a quiver whose ribbed frame is built from pale wyrm rib bone lashed
  with dark waxed cord over green-black scaled hide, a single dull verdigris
  clasp. Faint crypt-damp staining toward the base. Arrows with black fletching.
  Necromantic sanctum craft: cold and grave-lit, no glow, no visible magic.

### direfang_quiver, "Direfang Quiver" (epic, item level 29)

- Acquisition: drops from Nythraxis, Scourge of Thornpeak, the ten-player raid
  boss. Shares its display-name family with the Direfang leather set.
- Subject: a masterwork quiver of blackened boiled leather over a dark
  wyrm-bone spine, banded with tarnished silver-black fittings and a fanged
  motif at the mouth echoing the Direfang set. Deep violet-black with restrained
  cold rim light along the metal only. Arrows with iridescent raven fletching.
  Unmistakably endgame, but still a physical object: no aura, no glow field.

### heroic_gravewyrm_bone_quiver (heroic clone of the Gravewyrm rung)

- Same silhouette as `gravewyrm_bone_quiver`, upgraded: bone bleached brighter,
  cord re-wrapped in deep crimson, clasp re-struck in dark gold, a faint ember
  cast in the recesses. Must read as the same quiver reforged, and must be a
  visibly different image from the base.

### heroic_direfang_quiver (heroic clone of the raid rung)

- Same silhouette as `direfang_quiver`, upgraded: fittings re-struck in hot
  gold-bronze, the fanged motif sharper and inlaid, a restrained ember-red rim
  along the leather seams. Same rule: same quiver reforged, visibly distinct
  image from the base.
