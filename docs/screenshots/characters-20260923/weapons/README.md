# Weapons

Captured 2026-10-09. Every weapon and shield a player can equip now draws a model made for the
character pack bodies, and so do the generic weapons world NPCs carry. They replace the
kit-style models, and a handful of older one-off models, that those items drew before.

Nothing about the items themselves changes: no stats, no names, no rarity, no inventory icons.
What changes is the model each one draws in the hand and on the back, how large it draws, and
what an empty weapon slot shows.

## Which model an item draws

The pack came with four sets of weapon models: a starter set, a plain "field" set, a rare set
and an epic set. On the owner's call each item draws the set one step below its own rarity,
because the epic set read as too ornate for the epic tier.

| Items | Count | Model set |
|---|---|---|
| The starting weapons and the starting round shield, plus the two class props (the hunter's crossbow, the warlock's open book) | 5 weapons, 1 shield | Starter, 8 models |
| Every other common weapon, every uncommon and rare weapon, the common heater shield | 15, 34 and 42 weapons, 1 shield | Field: ten plain shapes in up to three looks (worn iron, dark steel, aged bronze), 23 models |
| The three rare shields | 3 | Two draw the field heater, one the starter round shield |
| Epic weapons and shields | 45 weapons, 10 shields | Rare: two designs for each weapon type and two shield designs, 50 models |
| Legendary weapons | 3 | Epic: 3 of its 27 models |
| The two Varkhul forge legendaries, the hammer and the shield | 2 | Their own models, unchanged |

A Heroic copy has no row of its own and draws whatever its base item draws (19 weapons and 2
shields).

The shape follows how the item plays, not what it is called. Final Argument Greatblade is a
one-hand sword and draws the saber. Gallowglass Hammer, Tunnelking's Spade and Moonscale Saber
are one-hand items that used to draw two-hand models.

A model has one size, so a finish of the rare set serves one hand. That set has no greatsword
and no two-hand axe of its own: the straight sword draws long in every finish but teal and
anvil, the double-bit axe's one finish is the one two-hand axe, and the war maul's teal and
violet finishes are the two-hand mauls. The teal sword and the ember maul stay one-hand
because NPC guards and smiths hold them.

### Thirteen added finishes

On the owner's review, epic items that shared one finish of a design read as the same weapon.
Thirteen finishes were added so that each of these has a look no other item draws:

| Finish | Item |
|---|---|
| `sword_rare_a_jade` | Greatfang of the Basin |
| `sword_rare_a_spectral` | Deathless Greatblade |
| `sword_rare_a_molten` | Heart of the End Greatblade |
| `sword_rare_a_royal` | Vanguard's Verdict |
| `sword_rare_a_ivory` | Wildheart Tuskblade |
| `sword_rare_a_anvil` | Anvilguard Blade |
| `dagger_rare_a_frost` | Rimefang |
| `dagger_rare_a_bone` | Marrowpoint |
| `staff_rare_a_obsidian` | Emberglass Warstaff |
| `shield_rare_a_glacier` | Glacier-Hewn Bulwark |
| `shield_rare_a_deepice` | Sovereign Glacier-Hewn Bulwark |
| `shield_rare_a_dawn` | Templar's Dawn Shield |
| `shield_rare_a_crucible` | Bulwark of the Inner Crucible |

They are recolours of the pack's own painted textures: the same mesh and the same UV layout
(pinned in `tests/rare_weapon_models.test.ts`), with each material's palette remapped in
project tooling, keyed on the paint's own shading. No new art was generated for them.

### Models not in use

Twenty-four of the 27 epic models are drawn by no item yet. The files are in
`public/models/weapons/` and the shape tests cover them, but nothing loads them. Where they go
is the owner's open call.

## Size

The lengths the game clamps a held weapon to were set for the kit bodies, months before this
body existed. The character pack body measures 2.14 hand-slot units from foot to crown, the
unit every length below is in. Two things were set on the owner's review.

**By shape.** Four shapes were too big for the hand at the length they were made: the daggers
draw at 0.7 of it (the three epic dagger designs at 0.85, because their hilt is barely a fist
long), the greatswords at 2.15 where they were 2.4, the two-hand axe at 1.88 where it was 2.1,
and the two-hand mauls near 1.6. The mauls also had 0.45 of bare haft taken out of their files,
with the head and the grip left as made.

**By rarity.** A common or uncommon weapon draws at 0.8 of the size the same model has on a
rare, epic or legendary item, so a better weapon reads as a bigger one. The rule reads the
item, not the model, because the field models serve three rarities
(`src/render/characters/held_item_size_core.ts`). It covers weapons only: shields, held
off-hand items and weapon skins keep their size.

| Shape | Common and uncommon | Rare and above |
|---|---|---|
| One-hand sword | 1.60 | 2.00 |
| Greatsword | 1.72 | 2.15 |
| Dagger | 0.72 | 0.90 |
| One-hand mace | 1.12 | 1.40 to 1.45 |
| Two-hand maul | 1.26 | 1.58 to 1.60 |
| One-hand axe | 1.16 | 1.45 to 1.50 |
| Staff | 1.82 | 2.28 |
| Spear | 2.00 | 2.50 |
| Wand | 0.87 | 1.09 |

The size is applied about the hand, so the whole fit shrinks with the model and a handle that
sits through the fist still does. The carry on the back keeps the same size.

## In the hand

Measured on the live rig: a hand slot's origin is the middle of the closed fist, and the right
slot's +X points at the ground in the idle hold and at the enemy in the battle stance and
through the swing. A weapon is in the hand when its handle passes through that origin, and a
one-sided head faces the cut when it lies toward that side. The owner's review found five
things, each traced to where a file puts its handle against its own origin:

- **One-hand axes floated beside the fist.** Their files are centred on the whole axe, blade
  and all, so the haft ran 0.13 to 0.2 to one side. A grip row brings the haft through the hand.
  The starter axe was also held edge up, and takes a half turn.
- **The curved rare dagger was held edge up**, with a bowed hilt off the palm. It takes a half
  turn and an offset.
- **The epic daggers were held by the guard**: their files put the origin where hilt meets
  guard. Each is raised onto the hilt. The fang (Voidsong, Dirk of the Sundered Veil) is
  turned so its point curls up at rest, the owner's call.
- **The starter staff was held behind its leather wrap.** It is slid back until the fist
  closes on the wrap.
- **The two-hand mauls had too much handle**, fixed in the files as above.

All of it lives in the per-model grip table (`src/render/characters/weapon_grip.ts`); no file's
origin was moved. `tests/pack_weapon_hand_seat.test.ts` decodes every pack weapon, places it
with the transform the attach path uses and cuts it across the palm, for both hands and at
both sizes: the handle within 0.03 of the slot's axis, nothing wider than a handle in the palm,
one-sided heads toward the cut.

## Nothing equipped, nothing in hand

A character with no weapon equipped used to keep the class's stock kit weapon in the hand: the
slot drew its base model whenever it had no item. A body that follows real equipment now
leaves the hand empty (`AssembleOptions.bareWhenUnarmed`, `tests/unarmed_empty_hand.test.ts`):
every player in the world, at birth, on a live unequip and on the back, and the previews that
show a character's own hands (character select, the character sheet, the Armory try-on, the
mount preview). Character creation still shows the class's starting kit.

- Unarmed is both hands empty for every class: the hunter's crossbow and the warlock's book
  are the class body's own props, and they are left off too until a weapon is equipped.
- The off hand is independent: a shield or a second weapon still shows beside an empty weapon
  hand.
- A mob drawn on a class body keeps the weapon it is drawn with (the Nythraxis court's visions
  are mobs on the knight, mage and rogue bodies).
- An equipped weapon whose id names no model, on a client older than the item, still draws the
  class weapon as a stand-in.

## Shields

The starter round shield has its own arm seat and back carry; the pointed and round pack
shields share the heater's, and the tall epic tower shield has its own. A flat plate draws
without the character rim, which laid a grey film over the whole face of a board seen at a
grazing angle (`RIMLESS_HELD_MODELS`).

The pack shields' roll is set in the battle stance, the owner's rule: there the shield is
presented in front of the body and stands straight up and down. In the idle hold the arm hangs
the other way up, so the board hangs with its top low and forward. That is the accepted
consequence.

## How the models were brought in

The files are the pack's own geometry and paint. Four things were set around them, because of
how the game attaches a held model:

- **A wrapper node.** The attach path resets the transform of a model's only top node, which
  is where the pack files keep their grip offset. Each file has one empty node above it, so
  the grip the artist set survives.
- **Long hafts head-up.** A held weapon's far end points forward in the hand and hangs low on
  the back, which is right for a blade. A staff's head and a spear's point belong up over the
  shoulder, so those files are turned over about the grip and one grip row turns them back for
  the hand.
- **The crossbow and the book** are laid out like the kit props they replace, so they take
  those props' seats, clips and carries unchanged. The book is turned half a turn about its
  spine in the hand so it opens toward its reader. The hunter's and the warlock's wiki stills
  were rendered again.
- **512 px textures.** The pack shipped 1024 px textures, about 210 to 300 KB a file. The models
  in the game were rebuilt from the pack's editable sources at 512 px with KTX2 and meshopt:
  43 to 108 KB a file (the open book is 190 KB), 8.8 MB for all 108.

## What world NPCs hold

The generic weapons NPCs carry were kit models too. They now hold the rare set, one finish per
prop: guards a rare sword (with the pointed rare shield for the sword-and-shield set), sentries
the rare spear, clergy and scholars a rare staff, smiths the war maul, and groundskeepers the
glaive in place of the scythe. Scouts hold the starter crossbow and scholars the starter book.
The named props (walking staff, oak stave, wood axe, knife) are their own models and stay.

## Kit models retired

Thirty kit weapon models that nothing draws any more were removed, with their previews:
`adv_axe_1handed`, `adv_axe_2handed`, `adv_druid_staff`, `adv_staff`, `adv_sword_1handed`,
`adv_sword_2handed`, `adv_wand`, `axe_a`, `axe_c`, `axe_d`, `dagger_a`, `dagger_b`, `dagger_c`,
`hammer_a`, `hammer_b`, `hammer_c`, `hammer_d`, `scythe`, `spear_a`, `staff_a`, `staff_b`,
`staff_d`, `sword_b`, `sword_c`, `sword_d`, `sword_e`, `sword_f`, `sword_g`, `wand_a` and
`wand_b`.

Left on disk on purpose: `sword_a`, `axe_b`, `staff_c` and `adv_dagger` (the asset pipeline's
style references), `adv_sword_2handed_color` (an animation tool names it), the kit files the
class bodies name as their default hands (mobs drawn on those bodies hold them), and four older
one-off models no item draws any more (`purple_axe`, `purple_sword`, `purple_dagger`,
`redskull_dagger`).

## Weight

- `public/models/weapons/` goes from 110 files and 9.9 MB to 188 files and 17.0 MB.
- **The download before the world opens grows by 4.4 MB.** Every item's held model is in the
  boot preload, so a weapon can attach the moment it is equipped. That set of held models goes
  from 63 files and 4.25 MB to 108 files and 8.63 MB (weapon skins stream on demand and are not
  counted). This change does not address it.
- The 24 epic models no item draws are 2.3 MB on disk and are never fetched.

## The pictures

| File | What it shows |
|---|---|
| [before-after-in-hand-1.jpg](before-after-in-hand-1.jpg) | The warrior's, the hunter's and the warlock's starting kits, and common, uncommon and rare weapons in hand: the base above, this change below. Desktop, the lowest graphics preset. |
| [before-after-in-hand-2.jpg](before-after-in-hand-2.jpg) | Epic and legendary weapons in hand, the same way. The forge legendaries are the last card: unchanged. |
| [before-after-on-the-back.jpg](before-after-on-the-back.jpg) | Ten of those kits sheathed. Desktop, the lowest preset. |
| [before-after-unequipped.jpg](before-after-unequipped.jpg) | A warrior, a hunter and a warlock after the game's own unequip of both hands. Desktop, the lowest preset. |
| [before-after-phone-landscape.jpg](before-after-phone-landscape.jpg) | Five kits on a phone viewport in landscape (844 by 390 at 2x), the lowest preset. |
| [after-in-hand-1-common.jpg](after-in-hand-1-common.jpg) to [after-in-hand-5-legendary.jpg](after-in-hand-5-legendary.jpg) | Every weapon and shield in the game in hand, one sheet a rarity, this change only. Desktop, the high tier. |

All frames come from a headless Chrome on this machine's real GPU, the offline world, the time
of day pinned to noon. Every card but the hunter's and the warlock's is the same male warrior
with the items put straight onto the character, so class and level rules stay out of the way.
The base is commit `c3127cb510` served from its own checkout; the two commits between it and
this change's parent do not touch held weapons. In the catalogue sheets each picture is framed
on its own weapon, so sizes do not compare from one picture to the next.

## Limits

- One desktop GPU. The phone frames are a phone-sized viewport on that GPU, not a phone.
- The catalogue and the hand measurements are the male warrior body. The female body's height
  was measured (2.12), its hands were not, and no female frame is in these sheets.
- No swing, block, mounted or swimming pose was captured at the final sizes. Earlier passes
  looked at one swing per class and per shape, before the sizes changed.
- The five epic shapes no item draws were seated by measurement only; none was seen in a hand.
- The thirteen added finishes are palette recolours, not an artist's repaint.
- The boot download grows, as said under Weight.
- A character in a shapeshift form is built with no weapon and so takes the empty-hand rule
  too. No form body has a hand prop today, so nothing shows.
- The world editor's asset catalogue is a generated file that was already out of date; it still
  lists the thirty retired kit models. Regenerating it also brings in every other model added
  since it was last built (it grows from 1334 to 1606 entries), so it was left for its own
  change.
