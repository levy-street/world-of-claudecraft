// Pure decision for the NPC gossip/quest dialog: does the menu still have
// anything worth showing after a quest accept/turn-in?
//
// Bug fixed: talking to the tutorial-start NPC (the Marshal) and accepting or
// turning in the starter quest left `#quest-dialog` sitting open with only the
// greeting line and no buttons, because renderGossip() always re-renders the
// same window after `acceptQuest`/`turnInQuest` regardless of whether the NPC
// still has anything to offer. A fresh character only has that one quest, so
// the menu goes empty and the window should close itself instead of hanging
// around inert. NPCs with more content (other quests, a shop, a delve board,
// ...) correctly keep the window open so the player can pick the next thing.
export interface GossipMenuContent {
  questCount: number; // offerable/turn-in-ready quests shown as list items
  discussionCount: number; // in-progress "discuss" entries
  hasVendor: boolean;
  hasMarket: boolean;
  hasHeroicVendor: boolean;
  /** The WARFARE quartermaster's sectioned honor shop (#warfare-window). It sits
   *  BESIDE the generic goods row rather than replacing it (a flagged NPC still
   *  sells and buys back through the ordinary vendor window), so it needs its
   *  own field here: a flagged NPC with an empty `vendorItems` list would
   *  otherwise read as an empty menu and close itself the moment it opened. */
  hasWarfareVendor: boolean;
  hasDelveBoard: boolean;
  hasVcup: boolean;
  hasCardMaster: boolean;
  hasTraining: boolean;
}

export function gossipMenuIsEmpty(content: GossipMenuContent): boolean {
  return (
    content.questCount === 0 &&
    content.discussionCount === 0 &&
    !content.hasVendor &&
    !content.hasMarket &&
    !content.hasHeroicVendor &&
    !content.hasWarfareVendor &&
    !content.hasDelveBoard &&
    !content.hasVcup &&
    !content.hasCardMaster &&
    !content.hasTraining
  );
}
