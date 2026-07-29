# Thornhollow Fields: the lore bible

The battleground's fiction, written down once so the copy that ships stays
consistent and the copy that does NOT ship stays available.

**The rule this document exists to protect: the game tells players almost none
of this.** Two sentences in the queue window and a spoiler-safe page in the
guide, and that is the whole public surface. Everything past the first section
is held back deliberately, so the place can grow later without contradicting
anything a player has already read. Do not "use up" a hook here by writing it
into player copy without deciding that is what you want.

Anchors this is written against (change these and the fiction has to move):
`src/sim/content/zone3.ts` (Thornpeak Heights), the layout in
`scripts/assets/battleground/field_plan.mjs`, the named places in its
`LOCATIONS`, and the four deeds in `src/sim/content/deeds.ts`.

---

## 1. What ships today (the whole public surface)

**The queue window**, two sentences:

> Two ruined keeps face each other across a walled hollow in the shadow of
> Thornpeak: Crimson to the south, Azure to the north, and the older Ruin
> Courtyard between them that neither has ever held. Five a side, one banner
> each, and the first to carry three of theirs home takes the field.

**The map document's own description** (`build_battleground_map.mjs` meta), and
the guide's Thornhollow Fields page, which is deliberately mechanical: how the
queue works, what the field is shaped like, what the flags and runes do.

**The place names**, which carry more fiction than any prose does: Crimson
Keep, Azure Keep, The Ruin Courtyard, Crimson Field, Azure Field.

**The deeds**: Banner in Hand, The Hollow Holds, Warden of the Hollow, A Hundred
Banners.

That is everything. A player who reads all of it knows: a walled hollow below a
mountain, two ruined keeps, an older ruin between them nobody holds, and a
banner contest.

## 2. The place

Thornhollow is a **ravine floor in old growth below Thornpeak**, the mountain
that Thornpeak Heights climbs into (Highwatch, Stormcrag, the Glimmermere). It
is emphatically **open-air**, and the renderer treats it that way: real sky,
real sun, real sculpted terrain, the only instanced region in the game with any
of those.

**Say "below" or "in the shadow of", never "under".** Thornpeak already has
genuinely subterranean content, and the guide uses exactly that construction
for it: *"a five-player descent... in the mountain's heart"*, *"the dark heart
of Thornpeak"*. "Under Thornpeak" reads as inside the mountain and collides with
the Gravewyrm Sanctum's own copy.

The hollow is a **bowl**, and the terrain says so: the Ruin Courtyard sits about
two yards below the ravine floor, and each keep stands on a terrace two yards
above it. Water drains toward the middle. Nothing grows tall in the courtyard.

## 3. The three claims (the shape of the conflict)

The field's whole geometry is an argument between three eras, oldest first:

1. **The Ruin Courtyard** is the oldest thing here and nobody's. The hollow
   heart ruin at its centre is a roofless shell of dressed stone with fallen
   columns thrown down around it, older than either keep and built by neither.
   Its walls are what stop a caster in one main gate holding the other, which is
   the layout's single most load-bearing sight property: the ruin decides the
   middle by simply being in the way. **Whose it was is deliberately unwritten.**
2. **The two curtain walls** came later and are the same build as each other:
   somebody once tried to carve this hollow into thirds and hold the middle.
   Each is pierced by exactly two crossings, a wide main gate and a gatehouse
   whose offset doors force a jog past an ambush corner. Whoever built them was
   thinking about being attacked from both ends at once.
3. **The two keeps** are the newest and the most ruined, which is the detail
   worth keeping: they were thrown up fast at either end of a hollow that
   already had walls in it, and they have already failed once. Each is sealed
   but for its mouth. Neither has ever taken the courtyard.

## 4. Crimson and Azure

Two war-hosts, named for their colours rather than their houses, which is how
the hollow's own dead would have known them. Crimson holds the south keep,
Azure the north. **Neither is the aggressor and neither is owed the field**: the
map is point-symmetric to the yard, and the fiction has to stay symmetric with
it. Any line that makes one side the rightful holder is wrong.

What they are fighting over is not the ground. It is the **banner** each keep
still flies, and the fact that the other side can take it and carry it home.
Three captures ends it because three is what the hosts agreed on, not because
anything on the field changes hands. (The count is `BG_CAPS_TO_WIN`, a tuning
constant; the fiction only cares that the hosts agreed on a number.)

The graveyards beside each keep are the hosts' own, and they are old enough to
be full. A fallen champion rises in their team's plot and waits for the wave,
which is a rite rather than a mechanic: the hollow gives its dead back.

## 5. Hooks, unspent

Deliberately unanswered, in rough order of how much room each leaves:

- **Who built the heart ruin, and what the courtyard was before it was a
  battlefield.** The biggest hook and the one to spend last.
- **What failed here the first time.** Both keeps are ruins. Nothing says who
  broke them or whether the two hosts were on the same side when it happened.
- **Why the hollow is walled at all.** The curtains predate the keeps and were
  built by someone who expected an attack from both ends.
- **What the hosts were before they were Crimson and Azure**, and whether the
  colours are older than the quarrel.
- **The hollow's relationship to Thornpeak's cult content above it.** Adjacency
  is established (same mountain); a connection is not, and it is free either way.
- **Why the dead rise in the plots.** Currently a rite; could become a property
  of the hollow itself.

## 6. Writing rules

- **Symmetry is the hard rule.** Crimson and Azure get identical treatment in
  every line. The field is point-mirrored and so is the fiction.
- **The ruin stays unexplained** in any player-facing copy until someone
  deliberately spends that hook.
- **No numbers in flavour.** Captures, timers, honor, and rating live in the
  guide's mechanical sections, never in the lore paragraphs.
- **Below, never under** (see section 2).
- **Spoiler-safe:** the guide is a public wiki page and stays concept-level; the
  same policy every other guide page follows.
- Every player-visible string here is a `t()` key in
  `src/ui/i18n.catalog/`, and a new wordy one needs its five non-Latin fills in
  the same change (the M16 rule).
