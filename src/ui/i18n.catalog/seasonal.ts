// i18n source catalog - seasonal events (src/sim/seasonal/): the event names, the
// trick-or-treat gossip row and its feedback lines, the tricks' names, the
// pumpkin head toggle, and the event items' use lines. The sim emits ids and
// numbers only (SimEvent 'seasonal'); every sentence the player reads is here.
// English values only; the locale translations live in src/ui/i18n.locales/.
//
// Assembled into `en` by ./index.ts under the `seasonal` namespace, with NO
// per-locale blocks (no `as const`), so an event's prose is an English-only add.

export const seasonalStrings = {
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
      'Use: Put on or take off a carved pumpkin lit from inside, worn over your helmet. Only during Gourdlight Eve. Cosmetic.',
    trickJar:
      'Use: Plays a random harmless trick on you for a few seconds. Only during Gourdlight Eve. Cosmetic.',
    pouch: 'Use: Open it to receive {count} Gourdlight Sweets.',
    strawlingCharm:
      "Use: Become one of Old Thatchgrin's strawlings for {seconds} seconds. Not in combat, and only during Gourdlight Eve. Never consumed. Cosmetic.",
    sweet:
      'Earned by trick-or-treating during Gourdlight Eve. Hester Gourdwick trades cosmetics for them at her stalls in Eastbrook, Fenbridge and Highwatch.',
    // One sentence per costume (a noun spliced into a sentence cannot be localized).
    costumeSkeleton:
      'Use: Turn into a rattling skeleton for {minutes} minutes. Consumed. Not usable in combat, and entering combat ends it. Only during Gourdlight Eve. Cosmetic.',
    costumeGhost:
      'Use: Turn into a drifting ghost for {minutes} minutes. Consumed. Not usable in combat, and entering combat ends it. Only during Gourdlight Eve. Cosmetic.',
    costumeBat:
      'Use: Turn into a flapping bat for {minutes} minutes. Consumed. Not usable in combat, and entering combat ends it. Only during Gourdlight Eve. Cosmetic.',
    titleWrit:
      'Use: Earn the title {title} for this character, worn from the Book of Deeds. Consumed. Only during Gourdlight Eve. Kept if you already hold the title.',
    broom:
      "Old Thatchgrin's keepsake. It lasts only while Gourdlight Eve runs and crumbles to straw when the event ends.",
  },
  // The vendor row's token price: "{count} {item}" ({count} pre-formatted).
  tokenPrice: '{count} {item}',
};
