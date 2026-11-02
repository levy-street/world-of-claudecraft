// i18n source catalog - seasonal events (src/sim/seasonal/): the event names, the
// trick-or-treat gossip row and its feedback lines, the tricks' names, the
// pumpkin head toggle, and the event items' use lines. The sim emits ids and
// numbers only (SimEvent 'seasonal'); every sentence the player reads is here.
// English values only; the locale translations live in src/ui/i18n.locales/.
//
// Assembled into `en` by ./index.ts under the `seasonal` namespace, with NO
// per-locale blocks (no `as const`), so an event's prose is an English-only add.

export const seasonalStrings = {
  pumpkins: {
    name: 'Haunted Pumpkin',
    title: 'Haunted Pumpkins',
    world: 'World',
    progress: '{label}: {current}/{total}',
    found:
      'You light a Haunted Pumpkin in {zone}: {count}/{total}. Gourdlight Sweets received: {sweets}.',
    flash: 'Haunted Pumpkin found! {count}/{total}',
  },
  event: {
    gourdlight_eve: {
      name: 'Gourdlight Eve',
    },
  },
  trickOrTreat: {
    row: 'Trick or treat!',
    rowAria: 'Say trick or treat to {name}',
    knockedHint: 'You already knocked here today. The door opens again after the daily reset.',
    treat: '{name} hands you a treat.',
    trick: '{name} plays a trick on you: {trick}!',
    alreadyKnocked: 'You already trick-or-treated {name} today.',
    notActive: 'Gourdlight Eve is not running right now.',
    tooFar: 'Step closer to knock.',
    // The banner flash for each outcome ({count} pre-formatted).
    treatFlash: {
      one: 'Treat! {count} Gourdlight Sweet',
      few: 'Treat! {count} Gourdlight Sweets',
      many: 'Treat! {count} Gourdlight Sweets',
      other: 'Treat! {count} Gourdlight Sweets',
    },
    trickFlash: 'Trick! {trick}',
  },
  tricks: {
    gourdlight_trick_bat: 'Batty',
    gourdlight_trick_skeleton: 'Rattled Bones',
    gourdlight_trick_fumes: 'Green Fumes',
    gourdlight_trick_strawling: 'Strawling Guise',
    // the costume draughts' looks (content/gourdlight_eve.ts GOURDLIGHT_COSTUMES)
    gourdlight_costume_skeleton: 'Skeleton Costume',
    gourdlight_costume_ghost: 'Ghost Costume',
    gourdlight_costume_bat: 'Bat Costume',
  },
  pumpkinHead: {
    on: 'You put on the Carved Pumpkin Head.',
    off: 'You take off the Carved Pumpkin Head.',
  },
  jarTrick: 'The jar pops open: {trick}!',
  guise: 'The charm crackles and the straw climbs over you: {trick}!',
  costume: 'You drink the draught and change: {trick}!',
  titleGranted: 'You read the writ. New title earned: {title}.',
  titleKnown: 'You already hold that title, so you keep the writ.',
  boundItemGone: 'Gourdlight Eve is over, and your {item} crumbles back into straw.',
  // Item tooltip "Use:" lines (the item tooltip appends them to the event items).
  itemUse: {
    pumpkinHead:
      'Use: Put on or take off a carved pumpkin lit from inside, worn over your helmet. Cosmetic.',
    trickJar: 'Use: Plays a random harmless trick on you for a few seconds. Cosmetic.',
    pouch: 'Use: Open it to receive {count} Gourdlight Sweets.',
    strawlingCharm:
      "Use: Become one of Old Thatchgrin's strawlings for {seconds} seconds. Not in combat. Never consumed. Cosmetic.",
    sweet:
      'Earned by trick-or-treating during Gourdlight Eve. Hester Gourdwick trades cosmetics for them at her stalls in Eastbrook, Fenbridge and Highwatch.',
    // One sentence per costume (a noun spliced into a sentence cannot be localized).
    costumeSkeleton:
      'Use: Turn into a rattling skeleton for {minutes} minutes. Consumed. Not usable in combat, and entering combat ends it. Cosmetic.',
    costumeGhost:
      'Use: Turn into a drifting ghost for {minutes} minutes. Consumed. Not usable in combat, and entering combat ends it. Cosmetic.',
    costumeBat:
      'Use: Turn into a flapping bat for {minutes} minutes. Consumed. Not usable in combat, and entering combat ends it. Cosmetic.',
    // Hester's toys (content/gourdlight_eve.ts GOURDLIGHT_TOYS; seasonal/seasonal_toys.ts)
    toyPrank:
      "Use: Throw it at another visible player within {range} yards. Their head becomes a glowing jack-o'-lantern for {seconds} seconds, and they can right-click it off. Neither of you can be in combat, and you cannot be stealthed. Never consumed: usable again after {cooldown} seconds. Kept permanently and usable year-round. Cosmetic.",
    toyLantern:
      'Use: Set the lantern down in front of you. A small ghost circles you for {seconds} seconds. Not usable in combat or while stealthed. Never consumed: usable again after {cooldown} seconds. Kept permanently and usable year-round. Cosmetic.',
    toyBats:
      'Use: Open the sack. A squeaking swarm of bats bursts out and scatters around you for {seconds} seconds. Not usable in combat or while stealthed. Never consumed: usable again after {cooldown} seconds. Kept permanently and usable year-round. Cosmetic.',
    toyCandleShadows:
      'Use: Light the candle in front of you. For {seconds} seconds its flames throw dancing shadows of a cat, a bat and a witch onto the ground around it, for everyone nearby to see. Not usable in combat or while stealthed. Never consumed: usable again after {cooldown} seconds. Kept permanently and usable year-round. Cosmetic.',
    toyCauldron:
      'Use: Set a big bubbling cauldron down in front of you. It stands for {standing} seconds, and any player who drinks from it bursts in green bubbles and turns into a goblin for {seconds} seconds, replacing any costume they wear. Neither setting it down nor drinking works in combat or while stealthed, and entering combat ends the goblin form. Never consumed: usable again after {cooldown} seconds. Kept permanently and usable year-round. Cosmetic.',
    titleWrit:
      'Use: Earn the title {title} for this character, worn from the Book of Deeds. Consumed. Kept if you already hold the title.',
    broomSources:
      'Bought from Hester Gourdwick for {count} Emberwoven Sheaves, or, rarely, dropped by Old Thatchgrin on a day you loot him. Riding it requires the riding skill. Kept permanently and rideable year-round.',
    sheaf:
      'Old Thatchgrin gives one each day you loot him, until you own the Emberbristle Broom. Hester Gourdwick trades {count} for the broom at her stalls in Eastbrook, Fenbridge and Highwatch. Unspent sheaves are kept for the next Gourdlight Eve.',
  },
  // Hester's toys at play (SimEvent 'seasonal' what 'toy' | 'pranked' | refusals).
  toy: {
    prank: 'You throw the pumpkin. It splats onto {name}!',
    lantern: 'You set the lantern down, and a little ghost drifts out to keep you company.',
    bats: 'You open the sack, and a swarm of startled bats bursts out!',
    candleShadows: 'You light the candle, and shadows begin to dance around its flames.',
    cauldron: 'You set the cauldron down, and it starts to bubble.',
    cauldronDrink: 'You drink from the cauldron, burst in green bubbles and turn into a goblin!',
    pranked: '{name} splats a pumpkin on your head! Right-click it off, or wear it proudly.',
    prankedFlash: 'Pranked by {name}!',
    prankNeedsPlayer: 'The pumpkin only splats on another player who is not in combat.',
    hidden: 'Step out of the shadows first: a toy would give you away.',
  },
  // Item tooltip source lines: where an item comes from, when no shop sells it.
  itemSource: {
    pumpkinHead:
      'Dropped by Old Thatchgrin, in his pumpkin field past Boar Meadow, the first time you loot him. No vendor sells it.',
  },
  // The Boo! daily (src/sim/seasonal/gourdlight_dailies.ts): the gossip row at a
  // townsperson, its hints, and the fright's feedback lines.
  boo: {
    row: 'Boo!',
    rowAria: 'Leap out at {name} and shout boo',
    needsCostume:
      'Put on a costume first: a costume draught, a bat or skeleton trick, the Strawling Charm, the Carved Pumpkin Head or a goblin sip from the Gurglegreen Cauldron.',
    frightenedHint: '{name} is still jumpy from your last fright. Find someone else.',
    landed: 'You leap out at {name} with a BOO! They shriek and nearly drop everything.',
    flash: 'BOO! {name} is frightened!',
    noCostume: 'Without a costume, {name} only laughs at you. Put one on first.',
    already: '{name} has had enough frights for one day.',
    notOnErrand: 'Hester has not asked you to frighten anyone today.',
  },
  // The vendor row's token price: "{count} {item}" ({count} pre-formatted).
  tokenPrice: '{count} {item}',
  // Old Thatchgrin keeps night hours (src/sim/mob/slumber.ts awakeAt 'night'): the name of
  // the state he wears on his pole by day, and the two yells of his dusk wake and dawn
  // climb (content/gourdlight_eve_scarecrow.ts THATCHGRIN_SLUMBER; re-localized from the
  // sim's English by src/ui/sim_i18n.ts).
  thatchgrin: {
    poleBound: 'Pole-Bound',
    wakeYell: 'NIGHT falls on the patch! Who walks in MY field?',
    sleepYell: 'Sun is up. Back on the post, back to watching.',
  },
};
