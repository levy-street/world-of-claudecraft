# Clue Scrolls and caskets

Stage 3 of the world-quests scope: completing the day's board in the level 16
to 20 bracket earns a Clue Scroll, the scroll opens a multistep treasure hunt
with persistent progress, and the last step hands a casket. This page is the
design contract; the anchors are `src/sim/clue_scrolls.ts` (the engine),
`src/sim/content/clue_hunts.ts` (the authored hunts and the constants) and
`tests/clue_scrolls*.test.ts` (the pinned rules).

## The entitlement

- A character at `CLUE_SCROLL_MIN_LEVEL` or above earns one Clue Scroll the
  moment the last zone slot of the day's board turns in: every rotating zone
  slot the character is eligible for (a slot above the character's level is
  not counted, since many zone quests open at 17 to 20), a rerolled
  replacement counting once, the always-active dailies not required. The
  check runs in the completion arm of `creditWorldQuest`; the cycle it paid
  for is recorded (`clueScrollCycle`) so a day never pays twice.
- The lower bracket never sees this layer: below the level the slate check
  is skipped entirely.
- Scrolls are items (`CLUE_SCROLL_ITEM_ID`): soulbound, never sold or listed,
  stacking to `CLUE_SCROLL_STACK_MAX`. An entitlement that cannot be held is
  lost and said so in the chat log.

## The hunt

- Using a scroll with no hunt active consumes it and starts a hunt drawn
  deterministically from the starter pool (`CLUE_HUNTS`) through the sim's
  `Rng`; the hunt id and the step index persist on the character
  (`clueHunt` on the save, the `cluh` self key online) and survive the daily
  reset, a relog and a reconnect.
- One hunt at a time. Using a scroll while a hunt is active does nothing
  except on a dig step (below). Abandoning a hunt (`abandonClueHunt`, the
  `clue_hunt_abandon` command; a tracker affordance is a follow-up) returns
  nothing. NPC and deliver steps require the same talk range as any quest
  giver, so a client cannot resolve them from afar.
- Step families in the first version: landmark (stand at a zone landmark),
  npc (talk to a named NPC), emote (perform an emote at a landmark), deliver
  (bring items to a named NPC, consumed), dig (use the scroll on a hidden
  spot). Riddles, environmental puzzles and combat clues are the named
  follow-up families; the engine only ever reads the step def, so a new
  family is a new union arm and a new hook.
- Every step's clue is prose the player reads in the quest tracker
  (`clues.<huntId>.<step>`); the sim emits only ids and step indices
  (`clueHuntStep` events) and the client resolves the text.

## The casket

- Finishing a hunt pays `CLUE_HUNT_STANDING` with the faction that owns the
  zone of its last step (every authored hunt ends with a dig in a faction's
  land), under the cap for the character's level.
- The last step hands a Treasure Casket (`TREASURE_CASKET_ITEM_ID`), a
  soulbound usable item. Because a scroll can be earned every day, the
  casket's ordinary value is deliberately modest: copper scaled by level and a
  stack of one top-tier gathering material. The extras are rare, rolled in a
  fixed order through the sim's `Rng`: a piece from the lowest delve chest
  rung for the owner's class, a small stack of Heroic Marks, and Grumbol the
  Lanternback (`reins_lanternback_troll`), a mount the casket is the only
  source of. Every odd and count is a named constant in
  `src/sim/clue_casket.ts`, a working rule to tune in playtests, and pinned by
  test. The mount roll is always drawn; a character who already owns the
  mount receives nothing from it, so the rng sequence never depends on the
  collection.
- Treasure-exclusive rewards stay separate from ordinary world-quest rewards
  and quartermaster stock. Deeds mark the first casket and the tenth, and the
  tenth grants a title.
- An unlucky casket never erases the day's other rewards: the world-quest
  payouts and faction standing land at turn-in, before the scroll.

## Verification

Offline, online and headless share the engine: the hooks live behind the
`SimContext` seam, the state rides the character save and the owner-only
snapshot, and the tests drive a real `Sim` through a whole hunt, the reset
boundary, a relog and the refusal paths (below level, lower bracket, no
replacement, full stack, wrong spot, wrong NPC, missing items).
