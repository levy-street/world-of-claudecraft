# Warrior reference implementation, working art review

This is a development checkpoint, not final AAA acceptance. The close visual
target is Tony's Warrior board, image (10), described in
[the reference intake brief](vfx-reference-123-v25.md). Warrior remains first
in the continuing all-kit pass. Preserve the model palette and use material on
the contact surface, brief edge highlights and particles to make effects read.

## Shieldcrack

The performance is a loaded offhand shield strike. Native Shield_Bash arm and
chest poses supply guard, chamber, drive and recoil. The new authored clip moves
the hips into contact while both feet stay planted. It holds contact from
0.15 to 0.18 seconds and returns to the starting pose at 0.68 seconds.

[The exporter](../../scripts/build_warrior_contact_anims.mjs) bakes two-bone leg
locking offline. No solver runs during gameplay. A 90 Hz draft had 0.000916
native units of left foot drift between exported keys, exceeding the 0.0005
review tolerance. The 180 Hz export reduced the measured maximum to 0.0000966
without changing the acceptance threshold. Root motion remains zero; the left
shield socket advances 0.4867 native units from chamber to contact. The shipped
clip is preserved intact by signature preparation and normal melee playback.

The contact sculpture uses six thick beveled steel plates with open seams,
a pointed lower silhouette and a curved profile. The broad shape, full-height
edge paths and victim contact persist at reduced detail. Extra sparks, metal
fragments, grounded chips and a short rolling-dust sprite use existing pools.
This is a brief shield collision; it does not imply a new barrier or area hit.
The actual target still owns the crush imprint and contact feedback.

## Twinstrike and Red Harvest

The Bloodrush board calls for substantial torn crimson material beneath narrow
bright cutting edges. The authored red enamel texture now follows the existing
curved blade geometry, with open tears, darker folds and detached fragments.
The finisher retains its larger final cut and all existing contact/audio timing.
It still needs continued review for the relationship between its bright seam,
thick surface and final crossing composition. No effect scale was reduced.

## Texture sources and preparation

Both new raster materials were made with the built-in image-generation tool,
using Tony's Warrior image as the explicit style reference. Source prompts:

- `warrior_blood_blade.png`: a horizontal unwrapped crimson enamel blade strip,
  narrow pale red cutting seam, thick oxblood folds, irregular tears and red
  fragments; no fire, smoke, character or text. The first output painted a
  checkerboard instead of transparency and was rejected. A second image edit
  replaced every background/checkerboard region with a solid black matte.
  The shader derives coverage from the painted surface and maps its cutting
  region onto the mesh; it never displays the black rectangle.
- `warrior_forged_steel.png`: a full-bleed swatch of dark hammered blue-grey
  shield steel, broad irregular facets, pits, gouges, sparse silver scratches
  and restrained copper wear; no glass, shield emblem, border or lettering.

Final assets live in `public/textures/vfx/production/`. Their shared textures
are bound after material cloning, so eight crest slots do not duplicate them.
Steel uses mipmaps for stable distant detail. Both the ordinary catalogue and
active Warrior preparation upload the textures before the corresponding
geometry becomes visible. The active recipe now has three texture uploads and
five existing-pool shape preparations, 23 individually scheduled units.

## Review still required

Checkpoint evidence: 124 tests in 16 focused suites pass, final typecheck passes,
and all 18 real casts across six graphics presets resolve the expected positive
damage components without capture/page/context errors. Shieldcrack's hit,
absorb, miss, dodge and parry paths are exercised through the actual painter and
sequencer. Absorption shows steel collision without a body imprint.

Matching camera stills at yaw 1.9, pitch 0.4 and distance 18:

| Ability | Before | Current development |
| --- | --- | --- |
| Shieldcrack, first contact | [Before](../screenshots/vfx-v25-warrior-materials/shieldcrack-before.png) | [After](../screenshots/vfx-v25-warrior-materials/shieldcrack-after.png) |
| Twinstrike, first cut | [Before](../screenshots/vfx-v25-warrior-materials/twinstrike-before.png) | [After](../screenshots/vfx-v25-warrior-materials/twinstrike-after.png) |
| Red Harvest, final cut | [Before](../screenshots/vfx-v25-warrior-materials/red-harvest-before.png) | [After](../screenshots/vfx-v25-warrior-materials/red-harvest-after.png) |

The authored shield is moved toward its caster, capped by available separation,
to keep its curved face on the near side of the victim. The actual body contact
does not move. Its cold-pool fallback has angular shoulders and a lower point.
The comparison documents progress; it does not close the following art work.

- Compare matching normal-camera before/after images and stronger close views.
- Judge shield silhouette from the side and whether the victim hides too much
  of its material; preserve a clear contact location when adjusting placement.
- Check the blood texture's painted seam against the independent bright edge.
- Repeat on light/dark terrain, slopes, moving victims, clustered enemies and
  sustained rotations, at every quality setting and reduced motion.
- Complete Warrior, then Rogue and all remaining kits, followed by two full
  visual improvement cycles. Focused tests and a passing capture are not a
  substitute for that art acceptance or the final contribution gate.
