# World NPCs on the character pack bodies

Captured 2026-10-06. Every world NPC now draws on the same bodies the players wear: the body,
kit and clips of one player class, bare headed, with a face made in the character creator's
face builder. The roster is `src/render/characters/npc_looks.ts`; how an NPC is built from it is
the "Every world NPC is a WOC body" paragraph of `src/render/characters/CLAUDE.md`.

Before this change each NPC composed a body from the old KayKit part library. Those are the
"before" pictures below.

Two things follow from the new bodies and ship with them:

- **Portraits.** A unit frame that holds one of these characters (the target frame, the
  target-of-target frame, and the talking-head panel the tutorial coach speaks through) now
  draws that character's own face where the lantern crest stood. See "Portraits" below.
- **The four escort characters** (Fisher Bram, Apprentice Wren, Navigator Suli, Gravedigger
  Mosley) move too. They are mob-kind entities, so they drew the stock villager body and never
  the face the old table held for them. See "The escort characters" below.

## How the faces were made

Each look is a recreation of the face the NPC already had.

1. Every NPC's old face was shot through the creator's own turntable (`CharacterPreview`, so
   both bodies stand under the same lights), with its head piece taken off.
2. A first pass was derived from the old look: the class from the kit the NPC wore, the nearest
   new piece for each old hairstyle, beard, brow and eye shape, and the old face and body
   sliders folded onto the five face controls and the body size.
3. Colours were solved, not copied. The same stored colour draws brighter on the new heads than
   it did on the old bodies, so a grid of skin and hair colours was rendered on each head type
   and measured, and each NPC got the stored colour whose render lands on its old face's
   measured skin and hair.
4. The old and new faces were then reviewed side by side, and picked by hand where the first
   pass read wrong.

Rules the owner set for the pass:

- The class is the outfit the NPC already wore (robe: mage, leaf kit: druid, ranger tunic:
  hunter, rogue tunic: rogue, silver plate: warrior, gold plate: paladin), never its job title.
  The fur and bare chest kit became a warrior. A priest only where the NPC is one by name:
  Brother Aldric, Vicar Creel, the Pale Keeper.
- No helm, hood or hat on any NPC, so every face shows. Harbormaster Tamsin's tricorne, pipe
  and spyglass, which were built for the old head and hip bones, are retired with that rule.
- The eye controls (spacing, size, tilt) and the brow height carry character, and a cast of
  regulars has them pushed to the stop.
- Some NPCs wear a piercing preset, and heights vary inside the creator's range.
- Brother Aldric moves with everyone else. He had been kept on his old model on purpose.

## The pictures

| File | What it shows |
|---|---|
| [roster_01.jpg](roster_01.jpg) to [roster_05.jpg](roster_05.jpg) | Every look a player can meet: the old face on the left, its recreation on the right, the name and class under each pair. |
| [before-after-ingame-desktop.jpg](before-after-ingame-desktop.jpg) | Eight NPCs at their own posts in the world, the base above and this change below. Desktop, the lowest graphics preset. |
| [before-after-ingame-phone-landscape.jpg](before-after-ingame-phone-landscape.jpg) | Four of them on a phone viewport in landscape (844 by 390 at 2x), the lowest preset. |
| [after-ingame-high-desktop.jpg](after-ingame-high-desktop.jpg) | Twelve NPCs at their posts on the high tier, this change only. |
| [before-after-target-portraits.jpg](before-after-target-portraits.jpg) | The target frame of ten NPCs: the crest the base draws above, the face portrait this change draws below. Desktop, the lowest preset. |
| [before-after-escort-characters.jpg](before-after-escort-characters.jpg) | The escort characters in the world, the base above and this change below. |

The roster sheets leave out five rows of the table: the four escort characters, whose "before"
is the stock villager body and not a face from the old table (they have their own picture), and
one row for an NPC the world no longer places.

All in-game frames come from a headless Chrome on this machine's real GPU, the offline world,
the time of day pinned to noon. The base is commit `c3127cb510` served from its own checkout.

## What a hub draws

`renderer.perfStats()` read from a fixed spot 12 yards in front of one NPC of each hub, the
median of 40 samples after the hub had settled. Both arms were read back to back in one
session.

| Tier | Hub | NPC views | Draw calls, before | after | Triangles, before | after |
|---|---|---|---|---|---|---|
| High | Eastbrook | 22 | 1192 | 1074 | 4.39 M | 4.45 M |
| High | Fenbridge | 9 | 1245 | 1213 | 7.51 M | 7.54 M |
| High | Highwatch | 14 | 1273 | 1145 | 6.46 M | 6.54 M |
| High | Wyrmwatch | 4 | 436 | 414 | 2.56 M | 2.58 M |
| Low | Eastbrook | 22 | 431 | 368 | 1.40 M | 1.44 M |
| Low | Fenbridge | 9 | 357 | 319 | 2.13 M | 2.15 M |
| Low | Highwatch | 14 | 599 | 515 | 3.67 M | 3.70 M |
| Low | Wyrmwatch | 4 | 215 | 197 | 1.49 M | 1.50 M |

Fewer draw calls in every hub on both tiers, and about one to three percent more triangles.

How far these numbers go:

- They are counts, not timings. No frame time and no GPU time was measured, so nothing here
  says a hub runs faster or slower.
- The change arm was the working tree before it was committed.
- Wandering mobs differ between two runs of one hub (zero to two bodies), so a difference under
  about twenty draws is noise.
- One desktop GPU. No phone was measured.

## Portraits

NPCs never had a portrait: a frame holding one drew the `status_npc` crest. Their faces are now
real, so the frame draws them the way a player's frame draws the face that player built: a
live headshot of the class body wearing the character's own head, with the kit's helm or hood
off (`src/render/characters/portrait.ts`, the lane and the cache the player portraits already
use). The rule is `src/ui/nonplayer_portrait_core.ts`: a character with an authored look shows
its face, every other mob keeps its committed portrait, anything else keeps its crest. The
portrait is the same on every graphics preset.

- No portrait file is committed for any NPC. The face is drawn from the roster row, so a look
  edited in `npc_looks.ts` changes the portrait with it.
- The first time a character is targeted its headshot is captured over a few frames, and the
  crest shows until it lands, as the class crest does for a player. The capture's first slice
  starts in the task that asked, as it already does for a targeted player. Its cost was not
  measured.
- The captures share the players' bounded portrait cache. A face that falls out of it is
  captured again the next time that character is targeted, and with NPC faces in it the cache
  turns over sooner: a frame whose face was evicted can fall back to its crest (the player's
  own frame to the class face) for the length of one recapture.
- The talking-head panel asks again with each line while its speaker's face is still owed,
  never repaints a face that has landed, and goes back to the crest when its line is gone.

## The escort characters

Fisher Bram, Apprentice Wren, Navigator Suli and Gravedigger Mosley are created as mobs by
their escort quests, which is why the first pass left them on the stock villager body. They now
wear their roster rows like any NPC: the class body, the face, the body size, the bare head and
the held prop. A mob that only shares an id with an NPC (the dungeon's Sexton Marrow) keeps its
own body. Wren and Suli keep their mob templates' 0.95 scale, which multiplies the body size
their rows name. The escorts were not started for these shots, so the four were not seen
walking or fighting.

Every mob has a committed portrait file in the deterministic mob portrait ledger. These four
rows were re-rendered by the unchanged pipeline, which draws the class body they now wear with
its stock head. No frame shows those four files any more: their frames draw the live face.

## Not in this change

- The seated caravan drivers are built by their wagon and still draw the old villager body.
- Humanoid enemies are untouched.
- The old outfit colourways do not carry over: every NPC of a class wears that class's kit as
  it ships.
- Nothing was measured on a physical phone. A profile without the crowd prefetch streams each
  NPC's hairstyle and class set when the NPC first comes into view; the body, its nameplate and
  its click target never wait for either.
