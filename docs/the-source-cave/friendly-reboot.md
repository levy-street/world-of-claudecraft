# The room, its objects, and its loot

The arena and everything in it that is not the fight itself: how contributors arrive, the
reboot button, the reward chest, the lighting, and the ambient character work. The fight is
in [encirclement-waves.md](encirclement-waves.md).

Constants are named here but not valued, because several of them have already been retuned
twice; read the value from the cited symbol.

## Friendly arrival

Every contributor starts friendly when an instance is claimed. `claimSourceCaveInstance`
sets each generated mob `hostile = false`, and `mob/locomotion.ts` recognises that
intentional state before its generic owner-less-mob hostility repair, keeps the mob idle,
and draws no random numbers.

Pre-reboot contributors amble on a short leash around their own ring seat
(`src/sim/source_cave/wander.ts`, driven from the friendly branch of `mob/locomotion.ts`),
so the roster reads alive rather than frozen. The leash stays under half the pairwise
placement floor, so the concentric rings never dissolve. After the reboot, hostile idle mobs
run the same leash, which was a playtest fix: rebooted contributors standing perfectly still
read as broken.

Interacting with a friendly contributor makes it answer one random line from
`SOURCE_CAVE_MOB_BANTER_LINES` (`mob_banter.ts`) on the say channel, so the room has
chatter before it has a fight. The gate is `isSourceCaveBanterTarget` (a cave mob, alive,
not hostile), so pressing the button ends the small talk.

## The reboot button

A one-shot `source_cave_reboot` ground object on the centre dais, rendered from the
`mushroom_red.glb` prop recoloured red (`src/render/source_cave_reboot.ts`). Its overhead
label is deliberately a warning rather than an instruction, in the hostile-red con colour
with the oversized outlined `.np-warning` style, so it reads as a dare at interaction range.

Pressing it sets every living mob in that slot hostile without assigning an aggro target,
leaving other claimed instances untouched. The pressed button is not despawned: it flips
`lootable = false` and stays as an inert prop, squashed by the renderer so it reads pressed,
with its label hidden. Removing it outright, the first behaviour, left an odd empty dais.

`SOURCE_CAVE_REBOOT_SAFE_RADIUS` (`reboot.ts`) is the muster bubble in which contributors
ignore automatic acquisition; it is now defined as the seal radius itself, so the bubble and
the visible seal are the same circle rather than two subtly different ones. The exemption
covers automatic acquisition only: direct damage, auto-attack, or an explicit pet engagement
still enters combat through the normal threat path.

The cave uses the standard group instance key without the dungeon engine's raid rejection,
so a party or a raid shares one claimed instance.

## The reaction chorus

The boss yells `What have you done?!` through the existing mob-yell channel when the button
is pressed. The two strongest non-boss contributors then react on the sim clock through
`delayedEvents` (`reboot.ts`), staggered a second or so apart, and their lines are dropped
if the reactor died in between.

All three are game-authored payloads localised through the shared
`localizeSourceCaveRebootYell` map, which leaves identical player-authored chat untouched.

## The reward chest

The chest spawns SEALED at claim time in its own alcove against the north wall
(`sourceCaveChestLocalZ`), the full room away from the centre button. That distance is a bug
fix, not decoration: the generic interact command re-scans for the nearest lootable object,
so when the two stood close together, clicking the chest could fire the reboot button.

Sealed is its own templateId (`SOURCE_CAVE_CHEST_SEALED_TEMPLATE`, the delve plate/rope
template-swap idiom). It renders as room furniture with no interact label and no sparkle:
nothing invites the player until it is actually openable. Interacting with it emits the
`Access denied.` error toast, deliberately a toast only and never a nameplate label.

Once every required combatant is dead, the 1 Hz clear pass arms it exactly once by swapping
the template. That swap is both the once-only guard and the client-side reveal, since the
renderer rebuilds the view and the label plus sparkle appearing IS the signal that it
opened.

Loot is a classic SHARED drop, not personal loot: `tappedById` is the first recipient and
`lootRecipientIds` the kill-time set, so distribution runs through the group's own configured
loot method. An everyone-passes need/greed roll returns the item to the chest, which needed
an object-kind arm added to `returnLootRollItemToCorpse`. An emptied chest stays in the room
as an inert prop.

## Lighting and dressing

The hall runs fully lit off the mains while the button is live, and snaps down to
torch-carried backup gloom when it is pressed (`updateSourceCaveMains` in the renderer): a
cosmetic per-frame blend of hemi, env, and fog over the shared delve ambience, scoped to the
cave x-band, with a fast falling edge like a breaker snapping and a slower recovery. It is
cosmetic only, the sim never reads it, and the low-graphics path keeps the fog component so
the cue survives.

The room is an open-plan dev office: bench desking, server-rack monoliths framing the centre
dais, and bookcase runs along the walls. Wall zoning keeps one bookcase run and one desk run
per wall rather than parking desks in front of shelves, and the split is mirrored between
`placeSourceCaveLibraryDressing` and `placeSourceCavePropDressing`, which must stay in
lockstep. Every desk sits outside the worst-case contributor ring so the combat space and
sight lines stay clear. There are no chest-shaped props anywhere, so the only chest
silhouette in the arena is the real reward chest.

## Coverage

`tests/source_cave_spec.test.ts` (the dais stays free, mobs stay in rings),
`source_cave_sim.test.ts` (friendly defaults, proximity cases for players, elites and pets,
hostile-but-idle activation, raid muster safety, the boss yell and the delayed reactors),
`source_cave_clear.test.ts` and `source_cave_loot.test.ts` (the sealed-to-armed swap and
shared distribution), `source_cave_i18n.test.ts` and `entity_labels.test.ts` (the yell and
label localisation), `nameplate_view.test.ts` (label visible near, hidden at range), and
`interactions.test.ts` (both click buttons and the interact key route to `interact`).

`scripts/source_cave_reboot_e2e.mjs` covers the same ground in a real browser, and
regenerates the before/after screenshots locally. Those screenshots are deliberately not
versioned.
