# The Last Bell cast: review notes and follow-ups

Living worklist for the Farshore cast models (`scripts/assets/last_bell_crew/`,
shipped bodies in `public/models/chars/npcs/`, review page
`docs/design/last-bell-concept-art.html`).

Maintainer review of the first full pass, recorded verbatim in intent so nothing
gets quietly dropped. Status column is the honest one: `OPEN` means not started,
`FIX` means the cause is understood and the change is known, `DONE` means landed
and re-reviewed on the page.

Second pass, 2026-08-04: every plate and turn frame in the book was reviewed
figure by figure against these notes (bust, all pose plates, and the turn
frames, for all fourteen figures). Every maintainer item was CONFIRMED on the
renders; none was refuted. This pass adds per-clip precision to the recorded
items, new defects the first review did not capture (numbered onward from the
originals), a book-vs-model copy mismatch list, concrete Tripo prompt direction
for section 4, and a suggested landing order. Each addition cites the plate
that shows the defect so re-review is a file open, not a hunt.

Ordered so the cheap certain fixes land before the speculative art passes.

---

## 1. Grip and prop defects (cheap, causes understood)

These are all the same class of bug and all live in `GRIPS` in
`scripts/assets/last_bell_crew/crew.py` plus the `weapons` lists in `cast.py`.
Props are mounted in the bone's local frame (`parts.held`), so one tuning per
family fixes every clip at once. Every value in that table was chosen by
rendering candidates into a real clip and looking; these are the ones that were
read wrong.

| # | Figure | Defect | Fix | Status |
|---|---|---|---|---|
| 1.1 | Coalfast | Shield is **back to front**: the inside faces the enemy | `shield` grip is `(90, 0, 0)`, which presents the BACK. The candidate grid's `-90` variants showed the painted face, so the shield family wants `(-90, 0, 0)`. Re-run the Block-pose grid to confirm before committing, and re-check the `(0, 0.02, 0)` offset sign in the same grid: the flip moves the hand to the other side of the plane. | FIX |
| 1.2 | Marsh | Shield back to front (same cause as 1.1) | Same one-line fix; both shields share the family. | FIX |
| 1.3 | Marsh | Spear sits **sideways** in the animations | `pole` is `(0, 0, 0)`. Needs its own grid pass in `Idle`, `Block` AND `1H_Melee_Attack_Chop`: a pose that reads at rest can still be wrong mid-swing, and this one is wrong in Idle too. | FIX |
| 1.4 | Ollun | Staff is **upside down** (brass crown at the bottom) | `stave` is `(90, 0, 0)`; invert to `(-90, 0, 0)`. Grid it in `Idle` AND `Spellcast_Raise`: the inversion only reads in raised-arm clips. | FIX |
| 1.5 | Ollun | Holds the open journal **like a shield**, out in front | Remove `tools/journal_open.glb` from his `weapons` in `cast.py` (one line). If the record should stay visible, a closed book at the hip is a small `parts.plate` two-slab plus strap skinned to the hips in `build_ollun`, same idiom as the satchel. Preference stands: closed book at the hip or satchel only. | FIX (removal) / OPEN (hip book) |
| 1.6 | Ewald | Should carry **no weapon at all** | Remove the boat gaff from his `weapons` list. His outfit carries him without it. | **DONE** |
| 1.7 | Edda | Remove the second-hand item, keep only the hammer | Drop `tools/tongs.glb` from her `weapons`. | FIX |
| 1.8 | Saul | Not holding the lantern properly | Direction proposed: take it out of the hand entirely and **hang it from his belt at the left hip** (strap loop plus lantern skinned to the hips in `build_saul`, same idiom as the satchel and tool roll), with warm emissive glass (see 2.16). Reads in every clip from every angle, no wrist-rotation failure mode, and makes "the one person whose hands are the tools" literally true with both hands empty. Fallback stays the recorded one: remove it. In-hand is the worst of the three options. | OPEN (belt hang proposed) |
| 1.9 | Marsh | Spear reads as a **tribal** spear, not a warrior's | `spear_a.glb` is the only spear in the kit and it is the tribal one. Either re-point him at a different shipped polearm (`halberd.glb`) or generate a plain militia spear through the Tripo pipeline (section 4). Whichever route: also raise the `pole` grip scale from 0.62 toward 0.8 in the same pass; at current scale the spear is a torso and a half long and reads as a javelin, not a road-holder. | OPEN |
| 1.10 | Coalfast (both forms) | Sword gripped at the ricasso: roughly two fist-heights of bare handle plus the ball pommel dangle below the hand, and the red grip wrap peeks past the fist as a single bright speck that reads as a blood fleck at plate size | Offset the `blade` grip along the bone axis in `GRIPS` so the fist seats mid-grip; buries the red speck for free. | FIX |
| 1.11 | Edda | The Cheer clip buries the hammer head in her hair; the visible handle stub reads as a club | Pose-specific interpenetration, one plate only. A per-weapon `tune` override on the `haft` grip in `cast.py` could nudge it, but Cheer is a review-page pose, not a gameplay read. Recommendation: accept it. Do NOT re-grid `haft`; the hammer is the best prop in the book (section 3). | OPEN (probably accept) |

Evidence and added precision:

- **1.1 and 1.2, how the stills hid it.** The reversal is only legible in the
  Block plates (`coalfast_pose_Block`, `coalfast_helm_pose_Block`,
  `marsh_pose_Block`); in Idle and Walking the shield sits near edge-on and
  reads fine. The cleanest single proof frame is `marsh_turn_02`: in bind pose
  the buckler lies flat on the outstretched arm with the **handle bar on the up
  face**, and that up face is what rotates toward the enemy when the arm drops
  to rest. Second symptom, same cause: the rounded knob in the middle of the
  shield face in both Block plates is the **fist clipping through the shield
  plane**, not a boss.
- **1.3, why `(0, 0, 0)` survived review.** The spear is perfectly vertical in
  the bind-pose turn frames, level in `marsh_pose_Idle`, `marsh_pose_Walking_A`
  and `marsh_pose_1H_Melee_Attack_Chop` (held flat at chest height, reads as a
  dart mid-throw), and diagonal and nearly right in `marsh_pose_Block`. Treat
  Block's current read as the target to preserve when re-gridding.
- **1.4.** `ollun_pose_Spellcast_Raise` is the proof frame: staff vertical,
  crown finial and pendant hanging below the fist like an upside-down handbell.
  In Idle and Walking the staff carries horizontally so either sign looks the
  same there. Bonus: the inversion moves the crown away from the cape it
  currently near-clips at the waist in `ollun_turn_08`.
- **1.5, worse than recorded.** Three of four plates fail:
  `ollun_pose_Block` raises the book in front of the face with the fist
  interpenetrating the cover (reads as a punched crate lid);
  `ollun_pose_Walking_A` reads as a slatted grate; `ollun_pose_Idle` reads as
  loose planks by the thigh. Only `Spellcast_Raise` reads as a book at all.
- **1.6, worse than recorded.** The "gaff" is `weapons/spear_a.glb`, the same
  tribal spear 1.9 complains about, blue feather tassels and all, on a declared
  non-combatant. `ewald_pose_Cheer` is the worst single plate in the book: the
  shaft crosses his face and the tassel overlaps his mouth, so at a glance he
  is biting the spear. The one-line deletion erases that plate's problem too.
- **1.7.** The tongs read as a rock gauntlet (Idle), broken antennae (Walking),
  and a stapler (Chop). Only the sky-silhouetted Cheer reads as tongs, and one
  plate in four does not earn a hand slot.
- **1.8, the mechanics.** `hang` `(0, 0, 0)` was evidently authored against the
  T-pose wrist frame: the lantern hangs plumb and correct in the bind-pose
  turns and, coincidentally, in `Sit_Floor_Idle`, then fails in exactly the two
  clips that are the gameplay read: `saul_pose_Idle` (floats bolted to the
  forearm, bail sideways like a key) and `saul_pose_Walking_A` (near roof-first,
  a grey birdhouse tumbling in mid-air). In `saul_turn_04` the fist clips
  inside the cage. It reads correctly only in frames nobody plays.

## 2. Model defects

Items 2.1 to 2.5 are the original recorded feedback; 2.6 onward were found in
the second pass. All of these land in `figures.py` / `parts.py` / `atlas.py`
unless the row says otherwise.

| # | Figure | Defect | Fix | Status |
|---|---|---|---|---|
| 2.1b | Ewald | Wanted a bigger, custom beard | `parts.beard` builds a partial shell over the MEASURED jaw: rings at four heights, each following the head profile, widest under the jaw and tapering to a point. Kept strictly BELOW the mouth (the nose apex measures z=1.52, and anything starting above about 1.46 climbs over the mouth and the shipped moustache and reads as a muzzle). Two build errors worth remembering: rings with different vertex counts get stitched across mismatched angles and produce a spiked tangle, so every ring uses the same step count; and `front` is in TURNS, where the face is -0.25 (-pi/2), not -0.5, which put the first beard on his cheek. | **DONE** |
| 2.1 | Ewald | **Haircut pokes through the hat**, and the crown reads as having no top | Solved GEOMETRICALLY and then MEASURED. `parts.tuck_under_hat` pulls the head's vertices above the brim inward, ramped with height; `parts.outside_shell` ray-casts every head vertex against the hat and the build RAISES if any is outside, so the defect cannot come back silently. Three separate causes were found, only the first of which was the recorded one: (a) hair wider than the crown wall; (b) 49 vertices ABOVE the hat entirely, because the head reaches z=2.253 and the crown stopped at 2.180, so the skull burst out of the top (this is the "no top" read, not a missing cap); (c) after the hair was solved, 4 SKIN vertices at the ear tops still pierced the wall. Fixes: a shrink that starts at 0.72 AT the brim rather than 1.0 (the band just above the brim is where the wall is tightest), a hard z ceiling, a crown raised to 2.235, a flat top ring instead of a single apex (a fan to a point builds a cone), and the tuck applied to skin as well as hair. ORDER IS LOAD-BEARING: the hat is fitted FIRST off the untouched skull, because tucking first shrinks the profile it measures and silently re-sizes the approved geometry. | **DONE** |
| 2.2 | Saul | "Some messed up things on the front of his shirt" | The four apron patches, unequally guilty: the two white linen ones read as stickers, the leather one reads as a **hole** in the apron, and the tonal canvas one actually reads as a repair. Keep the tonal canvas patch plus ONE enlarged linen patch, drop the other two, and seat them flatter (smaller standoff, thinner). Same numbers pass: pull the whole bib and skirt standoff in slightly; from the side the apron currently reads as a sandwich board with an air gap (`saul_turn_02`, `saul_turn_10`). | FIX |
| 2.3 | Tam | Reads too much like a **shaman**. Needs normal town clothes. | Drivers ranked by guilt, from the renders: (1) bare torso and arms, shirtless-under-pelt is the core shaman read; (2) the **fang necklace**, trophy teeth are the loudest single signal; (3) the jagged teal fur mantle and zigzag hems; (4) the belt of large pale discs reading as talisman stones. The teal HUE is innocent: it is his entity colour, and the palette chip already promises "the bell-keeper's coat" that the render never delivers. Full recipe below the table. | FIX |
| 2.4 | Tam | Needs **hair** (currently bald) | Route now known, no Tripo needed: a short cropped **grey horseshoe band**, temple around the nape to temple, bald crown kept (nobody else in the cast is balding, the elder dome is a good silhouette), joining the existing beard line. Build it as a `parts.hug_profile` band hugging the skull (the `parts.souwester` technique), painted the grey hair ramp `build_tam` ALREADY authors and the bald head never samples. Tripo only if the faceted band fails at bust size. Also fixes the worst back view in the cast: `tam_turn_06` currently reads as one continuous naked mass, bald dome into bare back. | FIX |
| 2.5 | Edda | Wants a **plaited** haircut | Not achievable by repaint: the rogue head's hair is fixed geometry. Shape that will read: convert the EXISTING right-shoulder side-fall into a single chunky braid, three to four alternating paired lobes tapering from nape over the shoulder to sternum length, ending in a wrapped tie plus a short tuft; keep the swept fringe untouched. At gameplay size "plait" is carried entirely by the notched silhouette and the tie bobble, never by weave texture, so do not model strands. Cheapest build is procedural (overlapping flattened lobes lofted along a curve in `parts.py`, hair ramp, skinned to the head bone); Tripo (section 4) only if the lobes read mechanical. | FIX |
| 2.6 | Coalfast (helm) | **The crest reads as separate horns, not a fore-and-aft comb**, from front and three-quarter: a ragged mohawk of disconnected bronze chunks (`coalfast_helm_bust`, `_pose_1H_Melee_Attack_Chop`, `_pose_Block`), and from dead front a "crown of three spikes" because the helm's own crown fins take the bronze trim and compete with the comb (`coalfast_helm_turn_00`). The side profile is ALREADY right, a low continuous arc, exactly the memorial quotation (`turn_02`, `_08`, `_10`). | Two-part fix, all in `parts.comb_crest` tuning plus one re-UV: (a) the crest follows the measured skull while the helm dome curves away, so mid steps bury and end steps stand free as teeth; deepen the sink, thicken the comb, enforce a monotonic profile or shorten it until no step separates; (b) re-UV the helm's own crown fins to the plate cell so only the comb is bronze. Real tuning-and-re-render pass, not a one-liner, but no Tripo. Preserve the side read; it is correct. | FIX |
| 2.7 | Coalfast | The roll of names, THE authored detail, reads as a jagged zigzag trim strip, not hanging name-plates (`coalfast_pose_Idle`, `_pose_Walking_A`, `_turn_00`) | `parts.tag_row` tuning in `build_coalfast`: fewer plates (5 to 3), wider, thicker, less drop, so each plate resolves at plate size. Numbers only, then re-render. | FIX |
| 2.8 | Marsh | The signature **asymmetric pauldron is invisible**: the lames are the same plate cell at nearly the same value as the arm under them, so the shoulders read symmetric from every angle | Give the lames contrast (markedly lower `shade_t`, or edge them in the trim cell) and grow radius and spread by roughly a fifth. "One good pauldron and nothing on the other" is his authored detail; right now it does not exist on screen. | FIX |
| 2.9 | Marsh | A small white scrap floats at the chest lashings (`marsh_pose_Idle`, `_pose_Walking_A`, `_turn_00`) and a grey-white ragged patch hangs below the lower band from the rear quarter (`_turn_10`); both read as texture glitches | Likely the strap ribbon endpoints or a pale region of the spare cell the lashing UVs land in. Open the scene, identify, then either move the lashings to a solid hemp cell or trim the strap path. Small investigation, then a one-line tune. | FIX |
| 2.10 | Marsh | The bronze **rank badge** does not land: the re-UV produces a vertical tan stripe down the sternum crossing the lashings; nothing reads as an issued badge | Targeted repaint of the actual badge polys, or accept the stripe and fix the palette-chip copy (section 8). Low priority. | OPEN |
| 2.11 | Ollun | **The "hood" is not a hood, it is long blue hair.** The build recolours the mage head's hair to robe slate and hides the hat; no hood geometry exists (`parts.hood` sits unused in `parts.py`). The topology still says hair everywhere: centre part line at the crown, framing locks past the shoulders, scalloped strand tips (`ollun_bust`, `_turn_00`, `_turn_02`). The gender read the hood was meant to settle partially survives. | Real art pass, the only one among the crew figures: build an actual cowl shell (crown dome plus draped sides, robe cell) over the existing re-UV'd hair, via `parts.hood` or a `hug_profile` build, sized to clear the ears (which also fixes the skin-coloured ear tabs currently piercing the "cloth" mass in the turns). Keep the re-UV underneath so any poke-through reads as hood lining, the exact 2.1 trick. | FIX |
| 2.12 | Ollun | **Blue eyebrows**: the brow faces sit on the head's hair cell, so the hair re-UV swept them to robe slate; the carefully authored dark hair ramp now paints nothing visible | Exclude the brow UV islands from the `crew.reuv` sweep (or restore them to the hair cell after it). Small code fix. | FIX |
| 2.13 | Edda | A grey **shard cluster at the left ear** sticks out of the hair silhouette and reads as floating debris from rear quarters (`edda_bust`, `_pose_Idle`, `_pose_Cheer`, `_turn_02`, `_04`, `_08`) | It is not built in `build_edda`: it is a rogue.glb base accessory landing on a default grey cell. Add the mesh to the `crew.load_base` hide tuple once identified (or re-cell it to the hair ramp). See the base-accessory audit, section 9. | FIX |
| 2.14 | Edda | The **charge rack**, her signature detail, does not survive its own scale: four star-glass charges read as a strip of pale pixel studs front-on and visibly float off the chest strap in profile (`edda_pose_Idle`, `_turn_02`) | Numbers-only: enlarge width and thickness, bump the caps to match, and reduce the standoff so they seat on the strap (`parts.tag_row` params in `build_edda`). | FIX |
| 2.15 | Saul | An unexplained **sage-green box clips the apron edge** at his left waist (`saul_pose_Idle`, `_turn_00`, `_turn_10`); it is in none of his four palette colours and reads as a green ledger glued on | Not built in `build_saul`: the mage_classic base body's belt book on a default cell. Hide it via the `load_base` hide tuple, or re-cell to leather so it merges with the instrument-roll story. (Ollun's equivalent belt stack plausibly reads as his kit; leave his.) | FIX |
| 2.16 | Saul | **The lantern has no light**: the glass renders inert grey, half of why the prop reads as a birdcage. At gameplay size a lantern is read by its glow before its silhouette. | Warm emissive on the lantern glass (`crew.flat_material` already supports `emission`; the creatures use it). Do this whichever mount 1.8 lands on. | FIX |
| 2.17 | Tam | **The striker clips his face in the Cheer plate**: the bronze head sits on his brow and the haft crosses the cheek in front of the eye, composing as him about to hit himself (`tam_pose_Cheer`). The collision exists in the live clip, not just the still. | Shorten the head end or angle the striker outboard slightly in `build_tam`, then re-render Cheer to confirm. Small geometry tune. Keep the striker itself: it is right (section 3). | FIX |
| 2.18 | Tam | **The hip bell is invisible** in every frame, swallowed by the kilt and belt geometry. Dead tris and a lost story beat (the ordinary bell before the Bellheart). | Move it outboard and forward until proud of the kilt (coordinate tune), or delete it. | FIX |
| 2.19 | Tam | The striker's grip band renders near-white (bone cell) and reads as bandage tape; the palette chip promises pale leather | Override the bone cell in `build_tam`'s palette; first verify with one candidate render which cell the fang necklace samples, so the fix does not recolour the fangs by accident (they may share it; 2.3 recolours the fangs anyway, so sequence this after 2.3). | FIX |
| 2.20 | Ewald | The **rope coils are invisible** in every plate and turn: tar-dark on oilskin-dark at the shoulder, near-zero contrast, partly swallowed by the arm geometry. An authored detail delivering nothing. | Repaint the coil cell lighter (leather or canvas) and push the loop radii proud of the shoulder, or delete the coils; the hat carries him without. | FIX |
| 2.21 | Ewald | The **fare tin reads as a floating gold cube**: the cord is too thin to see at plate size, and in Block the tin swings toward the chest edge and reads detached | Thicken the cord and reduce the tin's standoff so it seats against the tabard. One-line tunes in `build_ewald`. | FIX |
| 2.22 | Nell | Recorded, deliberately NOT actioned (see section 3): her three authored details do not survive the render. The **tally cord and knots are invisible** in every frame including the angles facing her right hip ("the only characterisation in the book that is a number" currently ships as zero); the hand-bell reads as a brown nub at the fist; the satchel stands proud of the hip with a shadow gap in profile (`nell_turn_02`). | Parked per the maintainer's "leave her alone". If she is ever reopened, the one worthwhile change is tally-cord legibility (enlarge the knots, move the cord clear of the belt pouch); the bell and satchel seatings are cheaper still and genuinely optional at gameplay size. | OPEN (parked) |

The Tam repaint (2.3), full recipe, all in `build_tam` with existing crew
palette names, no Tripo:

- **Torso: give him the coat the chip promises.** Re-UV the body mesh's skin
  cell to cloth (`crew.reuv` on the body only; the head is a separate mesh so
  the face keeps skin). Chest and arms become a sleeved coat. Paint cloth as
  watch-teal wool (his entity colour family, darkened toward a wool read).
- **Mantle: pelt to collar.** Drop the fur cell to storm-grey wool or oiled
  leather; the jagged mantle edge in a cloth colour reads as a rough-cut heavy
  collar, which is the note's own instruction landing.
- **Kilt: drab town wool**, one tone, killing the zigzag two-tone hem read.
- **Fangs and belt discs: repaint to bell bronze** once a candidate render
  confirms which cell they sample. Teeth become small bronze fittings and the
  discs become bronze bosses: "more bronze on him than on anyone" made true
  instead of shamanic.
- Keep: bronze trim, leather boots, the skin ramp, the grey hair ramp (2.4
  consumes it), and the face, which is already exactly right.

## 3. Approved, do not touch

- **Nell** looks great. Leave her alone. (Second pass concurs at figure level:
  best-balanced figure in the cast, youngest face, the scale reads against the
  adults, the back view is clean. Her detail-level gaps are recorded as 2.22
  and deliberately parked, not forgotten.)
- **Ewald's hat and outfit** are the strongest thing in the pass. Only fix the
  hair poke-through; change nothing else. Why it works, stated so it can be
  used as the bar for every other figure: ONE silhouette prop that reads from
  all twelve angles before any colour arrives (the sou'wester, low crown
  preserving the chibi head, the long back tail the one asymmetry that stops it
  reading as a farmer's hat); a THREE-VALUE outfit (pale salt-canvas light,
  oilskin dark, rust neckerchief the single warm accent); and palette
  discipline where the one bright thing on him (the bronze tin) is literally
  the only bright thing on him.
- **The sealed helm's fit is the reference implementation**: zero poke-through
  at any angle. Whatever the measured-skull fit did there is what 2.1 and 2.11
  should reproduce.
- **Marsh** and **Coalfast** read well as figures and are properly distinct
  from each other, confirmed at every angle sampled. One amendment: "their
  problems are all props" has a single exception, the sealed form's crest
  (2.6), which is bespoke geometry, not a prop.
- **Edda** is fine apart from the second-hand item and the hair. Her hammer is
  the best prop in the book (chamfered black iron head at proper chibi
  overscale, rope-wrapped grip, natural end-of-handle idle carry): do not touch
  it, and do not let the plait or tongs work trigger a re-grid of `haft`.
- Tam is "fine" apart from clothes and hair. His face is exactly right (heavy
  pale-grey brows, full grey beard, weathered skin) and the striker is clearly
  HIS; both survive 2.3 untouched.
- **Saul's `Sit_Floor_Idle` plate** ("the rest he does not take") is the most
  characterful plate in the book. Keep the pose selection through the 1.8 work.

## 4. The creatures need a different pipeline

The maintainer's read, which supersedes the skeleton-repaint approach for the
break-spawned:

> Riftspawn need to be more **demonic**, and more like **something from a dream**,
> to be true to the lore. We need a few runs through the image-to-GLB pipeline
> using Tripo to make some really cool looking things that match the art style but
> are more **nightmare-like**. Same for all the NPCs. **The wolf and spiders are
> the weakest.**

What that means concretely:

- The KayKit skeleton repaint was the right move away from the Quaternius blobs,
  but a skeleton is a *dead body*, not an unfinished one. The lore is "unfinished
  rooms from the Dreamer's Sleeping World pressing into the waking world", which
  wants dream-logic wrongness rather than undeath.
- `void_stalker` (wolf) and `tidemill_stalker` (spider) are the weakest figures in
  the book. Both are ordinary animals with a colour wash. Neither says rift.
- Route: the `asset-pipeline` skill (Tripo API, `scripts/asset_pipeline/pipeline.mjs`)
  to generate candidates from concept prompts, then the `image-to-glb` workflow and
  Blender for fit, scale, rig and fine-tuning. Expect several runs; judge candidates
  on a contact sheet before committing to one.
- Art-style constraint: whatever comes out must sit next to the KayKit chibi cast
  without looking like a different game. Nightmare-like, not photoreal, not gory.

Same pipeline is the answer for the hair items (2.4, 2.5) if the procedural
routes proposed there fail, and for 1.9's militia spear.

### 4.1 What the current five actually read as (second pass)

- **breach_wretch**: a cute toy skeleton minion in a torn vest. All undead,
  zero rift. The page promises a bruise-violet hooded silhouette; no hood reads
  on screen from any angle (see section 8).
- **riftspawn**: the most generic of the three, a classic dungeon skeleton in a
  purple mantle with a **brown belt, gold buckle and work shorts**. The
  wardrobe actively fights the lore: a belt someone buckled says "dressed
  corpse", undeath plus civilisation, the two things the brief excludes.
- **sundered_horror**: the closest to demonic (horned beast skull, real bulk,
  good weight in the walk) but it reads as forged, fitted, painted armour,
  which implies a smith and a culture. Craft, not an unfinished room.
- **void_stalker**: a stock handpainted wolf. The violet tint at its shipped
  strength is invisible in every frame (the build comment claiming the tint
  alone makes it rift-touched is refuted by the renders); what survives is
  charcoal with cream socks, and the highest-contrast features are the most
  domesticated ones. The bust reads companion animal.
- **tidemill_stalker**: a clean garden spider whose moss tint reads as natural
  camouflage, so the wash makes it MORE ordinary. From roughly a third of the
  orbit the boss is an olive boulder with legs (`_turn_04`, `_turn_06`): a
  rear-view identity hole exactly where its carried roof belongs.

### 4.2 The systemic failure: star-glass does not read anywhere

The one mark every break-spawned thing is supposed to share fails on all five
figures, three different ways: the wretch's chest shards read as ribs through
the torn vest; the riftspawn's rib shards are occluded inside the ribcage (a
tiny teal sliver at the waistline is all that survives); the horror's "six
shards driven through the shoulders, the most of anything in the book" renders
as one small dark fin visible from some angles, wrong value; the wolf and
spider have none (theirs were cut, section 6). Rule for every replacement:
star-glass is **material language**, a dark glass body toward the Starless
violet with only a pale emissive rim, grown THROUGH the mesh with puckered,
discoloured entry geometry, never pale emissive spikes standing off a normal
body. And unify the eye glow: the wretch and horror burn ice blue, the
riftspawn currently cream; one family, one colour.

### 4.3 Why the cut bolt-ons failed, and the structural rule

The mill roof was attempted as prop seating: rigid slate courses hovering over
a compact thorax, no load path, and leg motion re-advertised the gap every
frame. Carried weight must deform the body around it: a broken asymmetric roof
wedge, snapped rafters stabbing INTO a bulging abdomen, web and moss strapping
under the thorax. The star-glass shards failed for colour (pale blue plus
strong emission equals ice), placement (uniform dorsal offsets equal arranged
plates, not growth) and zero entry integration. Both are dead as prop passes on
stock bodies, and both are mandatory INSIDE the Tripo generations, where roof
and abdomen, glass and flesh, are one mesh. The spider's rear-view identity
hole becomes the identity: the roof faces backward.

### 4.4 Wrongness devices that survive KayKit chibi at gameplay size

Use these when authoring prompts and judging candidates:

- **Architectural fragments as body parts** (doorway torso, window eye, stair
  spine, roof-ridge shoulders): the highest-leverage device, because chunky
  painted low-poly architecture is native to the KayKit style and cannot look
  like a different game.
- **Unfinished parts as clean flat cuts** revealing a single flat "unpainted"
  colour: reads at fifty pixels because it is a value break, not detail.
- **Wrong number of things** (limbs, eyes, windows): silhouette-level, reads at
  any size.
- **Floating disconnected parts** with deliberate gaps: already an accepted
  chibi trope (golem fists), free wrongness, and simpler to skin.
- Fails in this style, avoid: soft dissolving or melting edges (faceted low
  poly cannot do soft; the nearest safe equivalent is a trail of discrete
  floating chips, or leave dissolve to renderer VFX), translucency and ghost
  shaders (fight the opaque hand-painted cell look), anything organic-wet or
  gory (excluded by the brief anyway).
- **Dream-things wear drapes or nothing, never tailoring.** No belts, buckles,
  shorts or vests on any replacement.

### 4.5 Tripo prompt candidates

Common suffix for every prompt: "stylized hand-painted low-poly game asset,
chunky faceted chibi style, flat color cells, T-pose (bipeds) or neutral
stance, neutral background, not photorealistic". Author albedo dark and near
the sim entity colour so the runtime tint reinforces instead of vanishing
(see 4.6). Two to three candidates per figure; judge on a contact sheet.

- **breach_wretch** (small, fast, swarm; wants full biped clip reuse):
  1. Doorway-hood scamp: a small chibi hooded figure whose bruise-violet hood
     opens onto empty darkness with a single pale-blue glass gleam where a face
     should be, no body inside the drape except stubby bone-pale legs and
     oversized three-fingered hands. (Keeps the promised hooded silhouette.)
  2. Half-built villager: a chibi child-sized mannequin left mid-assembly, half
     smooth violet-grey plaster, half raw unpainted blocks, one arm complete
     and the other ending in a clean flat cut, a glass splinter through one
     shoulder.
  3. Lath-and-shutter imp: a scampering creature cobbled from cottage offcuts,
     window-shutter chest, lath-strip limbs, roof-shingle cowl, violet-washed
     wood, one glowing ice-blue eye.
- **riftspawn** (common trash biped; wants the full clip reuse):
  1. Unfinished person: a chibi biped the dream never finished, featureless
     oval head with a single seam where a face should start, torso open at the
     chest like a rough doorway with faint pale-blue light inside, one arm
     normal and one still raw frame.
  2. Room-corner demon: a small horned demon whose torso is the corner of an
     unfinished room, a leaded window opening in the chest glowing pale blue,
     roof-lath shoulder spurs, torn violet drape, no belt, no tailoring.
  3. Wrong-count sleeper: a sleepwalking figure in a violet sheet-like shroud,
     four arms with the extra pair folded across the chest, bare pale feet,
     star-glass breaking out of its back, eyes closed with blue glow beneath
     the lids.
- **sundered_horror** (world elite, the only figure taller than a person;
  reduced clip set is fine):
  1. Bell-tower colossus: a giant whose torso is a broken bell-tower section,
     an arched doorway in the chest with a cracked bronze bell hanging inside,
     magenta-stained cold stone, six star-glass shards through the shoulders,
     stair-step spine ridge. (Ties the world elite to the Last Bell itself;
     bell bronze is a palette anchor the whole book already speaks.)
  2. Floating-fist masonry giant: stacked unfinished masonry with scaffold
     poles still embedded, forearms fully detached and floating at the wrists,
     wound-magenta mortar seams glowing faintly.
  3. Collapsed-room giant: a brute assembled from one fallen room, a door slab
     for a chest, a single glazed window as its only eye glowing ice blue,
     roof-ridge shoulders shedding slates.
- **void_stalker** (must still read wolf-shaped at a glance; threat class is
  gameplay information):
  1. Half-rendered wolf: unmistakable wolf silhouette whose hindquarters fray
     into raw unfinished triangular facets, as if the dream stopped rendering
     it, glowing pale-blue glass seams along the breaks. (Strongest lore fit.)
  2. Wrong-anatomy wolf: wolf silhouette with subtly wrong anatomy, neck
     slightly too long, one joint too many in the legs, a hump of translucent
     violet glass grown through the shoulders, small glowing pale eyes.
  3. Wolf-shaped tear: a wolf-shaped hole in the night, matte void-black
     flecked with tiny pale star points, silhouette edges breaking into small
     floating chips, a glowing seam where the eyes should be. (Riskiest for
     distance readability; the glowing face feature is non-negotiable.)
- **tidemill_stalker** (must still read spider-shaped; elite solo boss the
  player orbits):
  1. Fused roof-bearer (primary): a giant spider fused with the building it
     burrowed through, a broken slate mill-roof wedge grown into its bulging
     moss-covered abdomen, snapped rafters jutting like spines, pale glass
     glowing in the cracks. (Directly resolves the floating shelf and fills
     the rear-view hole.)
  2. Hermit-crab mill: a spider wearing the crushed tidemill roof as its
     abdomen the way a hermit crab wears a shell, mossy shingles, a snapped
     ridge beam, a millstone fragment in the wreckage.
  3. Dream-built spider: a spider the dream assembled from the mill it
     destroyed, legs of splintered dark roof beams, a faceted slate-and-moss
     body, star-glass at the joints. (Watch that beam-legs keep enough taper
     to read spider, not scaffold.)

### 4.6 Contact-sheet judging criteria and integration constraints

- Thumbnail test first: reject any wolf candidate that loses the head-and-tail
  wolf read at thumbnail size, any spider that loses the stance; require a
  rear-view accent on the spider (the roof) and a front-face anchor (an eye
  cluster or single glowing eye group).
- The sim entity colours are load-bearing and non-negotiable: the renderer
  applies them as runtime tints (`tintedMaterial`,
  `src/render/characters/assets.ts`). Author replacement albedo dark and close
  to the tint so the lerp reinforces; the current wolf is the failure case.
- Triangle and material budget: the class of the current creature bodies
  (a few thousand tris, one or two materials); decimate Tripo output to match.
- Rigging: wretch and riftspawn target a standard biped so existing clip
  families retarget, or re-bake a reduced Idle/Walk/Run/Attack/Hit/Death set.
  The horror already ships happily on a reduced set: the `GOLEM_SPAWN` ClipMap
  pattern in `src/render/characters/manifest.ts` (declare only clips the GLB
  actually ships, pinned by `tests/character_clipmaps.test.ts`) is exactly the
  contract every Tripo-generated body should reuse.
- Keep the spider's death: the current death splay is the best frame either
  stalker produces; whatever replaces the body, keep a death that fans the legs.
- Express the encounters: the wolf hunts guttering watchfires, so a faint
  emissive that reads at firelight distance sells it; the spider burrows with
  webbed exits, so soil and web at the leg bases carry it.
- Scale ordering fix regardless of art path: the wretch is currently taller
  than the riftspawn; "the small ones come in numbers" should be the smaller
  of the two.
- The plate-fidelity discipline (`_tint_material` in `figures.py` reproducing
  the renderer's multiply-tint exactly) carries into whatever renders the
  replacement concept plates.
- Worth carrying from the current pass: the riftspawn's violet-grey void-bone
  ramp as a material colour, the horror's wound-magenta plus cold-stone
  palette, the intent lines (wretch is crowd pressure, riftspawn is the thing
  you kill twelve of, the horror is the only figure taller than a person).
- Interim only if creatures must ship before Tripo lands: crank the wolf's
  tint strength toward near-black violet and give it emissive star-glass eyes
  (a real improvement that tops out at "shadow wolf"); nothing on the spider
  is worth interim effort.

## 5. Review-page requirement

**DONE.** Idle, walk, the attack and Block now play per figure under "In motion",
with a pause-all control, honouring `prefers-reduced-motion`.

Static plates hid exactly the defects in section 1: a shield that reads fine
standing still is obviously reversed once it moves.

Implementation as landed: `plates.py` samples 12 frames across each clip from ONE
fixed camera station (the pose plates re-fit per frame, which would make a walk
cycle bob in and out), `build_concept_book.mjs` stitches them to a sprite sheet,
and CSS `steps()` walks it with no JS timer.

Two traps worth recording, both hit on the way:

- The sheet carries **N+1 cells**, the last a duplicate of the first. With
  percentage `background-position`, 0 percent aligns the image's left edge and 100
  percent its right, so the reachable range is `(cells - 1)` cell widths. Padding
  to N+1 makes `steps(N)` land exactly on cells 0 to N-1 and wrap clean; without
  it every step lands a fraction of a cell off and the animation smears.
- `aspect-ratio` takes **unitless** numbers. Feeding it `px` values is invalid and
  collapses the stage to zero height.

Resolved differently than the second pass proposed: the turntable STAYS (orbiting a
model is how a silhouette gets checked) but the static pose plates are gone, so the
misrepresentation it warned about no longer contradicts anything on the page. Its
original wording follows.

Second-pass note: **the bind-pose turntable systematically misrepresents
every held prop** (the shield reads as a serving tray, the sword as an antenna,
and Saul's lantern reads correct ONLY in T-pose), and it hides grip defects by
construction; even after the section 1 fixes it will contradict the posed
plates. Render the turntables at the Idle beat instead (a `plates.py` change),
or let the sprite sheets make the turntable secondary. The second pass
independently confirms the requirement: animated plates would have surfaced
1.1 through 1.5 and 1.8 immediately.

## 6. Already-known open items (carried from the first pass)

- **Tidemill Stalker's carried mill roof** is not modelled. Slate courses were
  prototyped and cut; every seating read as a floating shelf. Resolved in
  principle by section 4: dead as a prop pass, mandatory as generated-in-one-
  mesh geometry (see 4.3).
- **Star-glass shards on the wolf and spider** were built and cut; they read as
  pale ice spikes standing off the back. Same resolution: see 4.2 and 4.3 for
  the material-language rule the replacements follow.

## 7. Not in scope, decided

- **Outrider Bren gets no model.** He dies before the campaign starts and never
  appears; the point of him is the chair nobody sits in. A still life of his gear
  was built and cut.

## 8. Book vs model copy mismatches

The concept book's contract is that the copy cannot drift from what shipped.
These are the places it currently does. Each needs either the model fixed or
the copy fixed; none should stand.

| Where | The claim | The render | Resolution |
|---|---|---|---|
| Coalfast helm | "Sealed" / "the same harness, now closed" | The visor mesh is hidden in BOTH forms; the finale face is fully open | Maintainer's call: un-hide the visor for the helm form (one line in `build_coalfast`), or soften the copy. The open face is arguably right for a named NPC and rhymes with the bare head at post. |
| Ollun | "Hooded" | Recoloured hair, no hood geometry | Fix the model (2.11); the copy's reasoning is sound. |
| Saul | "Short dark cut" | A tied queue with a bobble at the nape, which reads fine and male | Fix the copy. |
| Breach wretch | "A low, quick, hooded silhouette" plus a bruise-violet hood palette chip | No hood reads from any angle; bare bone-grey skull | Verify in the scene whether the base hood mesh exists and lost its cell or is absent; moot if section 4 replaces the body, but fix the copy meanwhile. |
| Edda | Soot up the forearms and down the hem | Forearms read as black gloves; the hem shows no darkening in any frame | Darken the hem shade band in the palette, or drop the claim. |
| Tam | Striker grip "pale leather" chip | Near-white bone cell, reads as bandage tape | Fix the model (2.19). |
| Marsh | "One rank badge, the only issued thing he owns" | A vertical tan stripe down the sternum | Fix the model or the copy (2.10). |
| Tidemill stalker | Palette chip "tidemill slate, roof it has not shed"; design note "carries star-glass for now" | `build_creature` builds no bespoke geometry; neither slate nor star-glass appears in any render | Fix the copy now (the page currently misrepresents the model in exactly the way its own design notes call unacceptable); the model catches up via section 4. Also delete the dead shard params (`shards`, `shard_len`, `shard_base`) still carried in `cast.py` for both stalkers. |

## 9. Cross-cutting sweeps

- **Measure the defect, do not eyeball it, and check the measurement itself.**
  The first coverage test for 2.1 binned the hat's vertices into (angle, height)
  cells and compared radii. A sou'wester has geometry at five heights only, so
  four of eight height bands came back empty, reported radius zero, and flagged
  every vertex in the gaps: it reported 93 failures that were artefacts of the
  test and did not move when the model changed. The give-away was that the count
  barely responded to a parameter that should have driven it. Replaced with a ray
  cast from the head axis through each vertex, which asks the geometry directly;
  the same figure then reported 82 with no tuck falling monotonically to 0. Any
  coverage or containment check on a low-poly shell should ray-cast, and a check
  whose output does not respond to the input is a broken check, not a stubborn bug.
- **Scope a check to the whole surface, not the part you suspect.** The same
  assertion, scoped to hair vertices, passed while four skin vertices at the ear
  tops still pierced the crown.

- **Base-accessory audit.** Two figures shipped unbuilt base-mesh accessories
  on default palette cells (Edda's ear cluster 2.13, Saul's belt book 2.15).
  Before the next render pass, walk every `crew.load_base` figure once in the
  scene and check for unhidden base accessories; each finding is a one-line
  hide. (Ollun's belt stack plausibly reads as his kit; leaving it is a
  choice, not an oversight.)
- **The grid discipline, generalised.** 1.3's lesson now has three
  confirmations (1.3, 1.4, 1.8): a grip authored against one wrist frame reads
  wrong in every other. Every grip family's candidate grid gets rendered in
  the clips that actually move the wrist (Idle, Block, Chop, Spellcast_Raise
  as applicable), never Idle alone, and per the house method the winner is
  chosen by looking, not by reasoning about axes.
- **Regenerate the book after each wave** so chips and copy match the renders
  again, and re-review on the page (the `DONE` bar above).

## 10. Suggested landing order

1. **Wave 1, one-liners, one build-and-render batch:** 1.1, 1.2 (shield flip
   plus offset sign check), 1.4 (stave flip), 1.5 (journal removal), 1.6
   (gaff removal), 1.7 (tongs removal), 1.10 (blade seat), the `cast.py` dead
   shard params, and the pure copy fixes from section 8.
2. **Wave 2, numbers-only tunings, same session:** 1.3 (pole grid), 2.2
   (patches and apron seat), 2.7 (name tags), 2.8 (pauldron), 2.14 (charges),
   2.16 (lantern emissive), 2.17 (striker), 2.18 (hip bell), 2.19 (grip band),
   2.20 (coils), 2.21 (fare tin), 2.9 (scrap, small investigation first).
3. **Wave 3, small art passes, all in `figures.py` / `parts.py`:** 1.8
   (lantern belt hang), 2.1 (Ewald hair re-UV), 2.3 (Tam repaint), 2.4
   (horseshoe band), 2.5 (plait), 2.6 (crest), 2.11 plus 2.12 (Ollun cowl and
   brows).
4. **Wave 4, the Tripo pipeline (section 4):** all five creatures, judged on
   contact sheets; 1.9's militia spear rides this batch unless `halberd.glb`
   is accepted in wave 1.
5. **In parallel, page work (section 5):** sprite-sheet clips per figure and
   the Idle-beat turntable.

Waves 1 and 2 are a single sitting and remove roughly half the list. Wave 3 is
where art judgement re-enters; re-render and re-review each figure on the page
before marking `DONE`.
