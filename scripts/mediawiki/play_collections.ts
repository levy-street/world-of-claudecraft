import { RELIQUARY_TRACK_CAP } from '../../src/ui/reliquary_tracker_view';
import type { PlayPath } from './play_path';

export const collectionPaths: Record<string, PlayPath> = {
  'Book of Deeds': {
    where: 'Open the Book of Deeds from anywhere (Shift+Z by default).',
    need: 'Pick a deed you can still earn. Its page names the quest, activity, item or number you need. A deed marked retired cannot be earned any more.',
    steps: [
      'Pick a deed category and open a deed. Read what it asks for and how far along you are. Add it to your watchlist if you want to see the goal while you play.',
      'Do what the deed asks on one character. If the deed has several parts, finish every part on that same character. The deed pages below give the exact checklist.',
      'Open the Book again to see the date you earned it, the character who earned it and the reward. You can wear an unlocked title or border from the Book.',
    ],
    result:
      'The game saves the deed for you. Renown and any title or border are shared by every character on your account. Earning the same deed on another character does not give its Renown a second time.',
  },
  'The Reliquary': {
    where: 'Open The Reliquary from anywhere (Shift+X by default).',
    need: 'Pick a shelf, then a page with a missing relic. Look at where the missing piece comes from.',
    steps: [
      'Pick the shelf and the page. Look at the empty outline (silhouette) to see which relic you need. You can pin up to ' +
        RELIQUARY_TRACK_CAP +
        ' pages to follow them on this character.',
      'Get the relic from its source. For example, defeat its named boss on the right difficulty, or get the crafted piece it needs. The first time any of your characters gets it the right way, its outline fills in.',
      'Open the page again to see it filled in. Collect every piece the page needs to light up the whole page. Check your Curator rank for look-only (cosmetic) rewards.',
    ],
    result:
      'Your collection is shared by every character on your account. Retired and Personal pages do not count toward completion. Account weapon skins can fill their pages, but they do not raise your Curator rank.',
  },
  Companions: {
    where: 'Open Cosmetics (Shift+Y by default) and pick the companion collection.',
    need: 'A companion you have unlocked. Each entry below says where to get it. For example, you buy Tug, the Warhorse from an Honor quartermaster. Crystal Lich comes from Heroic Nythraxis.',
    steps: [
      'Do what the entry says to unlock it. If you won a companion from a boss, leave the instance to see it.',
      'In Cosmetics, pick the companion you collected and choose Summon. To send it away, choose Dismiss.',
      "To have it loot bodies for you, right-click the summoned companion's target frame (double-tap on a touch screen) and choose Enable Autoloot.",
    ],
    result:
      'The companion follows this character. When you play online, it is saved for your whole account. Autoloot picks up loot you are allowed to take and have room for, within 30 yards of you. It does not work inside raids.',
  },
  'Mount appearances': {
    where: 'Open Cosmetics (Shift+Y by default), then Mounts.',
    need: 'Learn riding from Stablemaster Marla Hitchen before you can summon a mount. You also need the look (appearance) you want to use. See [[Mounts and riding]] for training and reins you can collect.',
    steps: [
      'Find the look in Mounts. Choose Preview to see it. The card shows whether you own it.',
      'On a look you own, choose Wear, then summon your mount. To remove it, choose Take off on the look you are wearing.',
      'Some looks come from mount items that are shared with your account. Keep that item in the bags or bank of any character on the account.',
    ],
    result:
      "Your mount uses the look you picked. This choice is only for this character. Your mount's speed comes from that character's riding training.",
  },
  'Weapon appearances': {
    where: 'Open Cosmetics (Shift+Y by default) and pick Skins.',
    need: 'Own the skin and hold a weapon of the same type. For example, a sword skin needs a sword it fits.',
    steps: [
      'Pick a look from the list below to see its weapon type and where to get it. Get it, then equip a weapon it fits.',
      'Open Skins, find the skin you own under its weapon type, and choose Apply.',
      'To get your weapon’s normal look back, choose Detach on the skin you applied.',
    ],
    result:
      'Your weapon looks different. Its damage and stats stay the same. Every character on your account owns the skins you have.',
  },
  Membership: {
    where:
      'Online, open the WOC Store and pick Membership. For gear and account storage, visit a banker and pick the Account bank.',
    need: 'An active membership for the benefits. To add 30 days with an item, get a [[Membership Token (30 Days)]] from another player or from a store purchase that includes one.',
    steps: [
      'To buy a token, choose Buy membership token and finish the purchase. Then go back to the character you bought it on and choose Collect purchased token. Take the token from the purchase parcel or your mailbox.',
      'Open your bags and use the token to add 30 days to your account. You can trade a token instead, as long as it is still in your bags.',
      'While your membership is active, open the Account bank at a banker and choose Claim membership gear. Wear all seven membership armor pieces to turn on the XP bonus. The staff does not count as part of the set.',
    ],
    result:
      'Membership gives you the account bank, 10 more character slots, one more bag slot and half the normal auction tax. The full armor set gives 20% more XP while membership is active. The matching referral set gives the same bonus, but the two do not add together.',
  },
  'Mobile Play': {
    where:
      'Start the game on a phone or tablet. Your movement stick is on the left, and Quick Actions is at the bottom of the screen.',
    need: 'A touch screen for the touch controls. A connected game controller that the game supports also works.',
    steps: [
      'Drag the left stick to move. Drag on the world to turn the camera. Pinch with two fingers to zoom.',
      'Pick a target, then tap an ability on the action bar on the screen. Tap Quick Actions to open a window. Tap More in that menu for more windows.',
      'With a controller, use the left stick to move and the right stick to look around. In a window such as Bags, use the pointer on the screen. Change buttons, deadzone and camera speed in the controller settings.',
    ],
    result:
      'These controls do the same things and open the same character windows as the desktop controls. Rewards come from the activity you finish.',
  },
  'Agents and Bots': {
    where:
      'For a practice agent on your own computer, open a terminal in a copy of the game’s code. The example runs outside the browser.',
    need: 'The game’s source code, its Node packages, and Python with gymnasium and numpy installed.',
    steps: [
      'From the main folder of the code, run npm ci, then npm run build:env. This builds the local game that the example uses.',
      'Install the Python packages with python -m pip install gymnasium numpy. Then run python python/example_random_agent.py from the main folder.',
      'The example starts a Warrior, tries random actions, and starts the episode over when it ends. To control your own agent, use the observation that reset gives back, pass an action to step, and call close when you are done.',
    ],
    result:
      'The example prints the actions you can use, the shape of the observation, how fast it steps and the total training reward. This local game has its own character. It does not give items or experience to your online character.',
  },
};
