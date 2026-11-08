import { RELIQUARY_TRACK_CAP } from '../../src/ui/reliquary_tracker_view';
import type { PlayPath } from './play_path';

export const collectionPaths: Record<string, PlayPath> = {
  'Book of Deeds': {
    where: 'Open the Book of Deeds anywhere (Shift+Z by default).',
    need: 'Choose an available deed. Check the named quest, activity, item or count on its page. A deed marked retired cannot be newly earned.',
    steps: [
      'Select a deed category and open a deed. Read its requirement and progress. Add it to your watchlist if you want the objective visible while playing.',
      'Use one character to complete the stated requirement. For a multi-part deed, finish each listed part on that character. Use the linked deed article below for the exact checklist.',
      'Reopen the Book to see the earned date, character and reward. Use the Book to wear an unlocked title or border.',
    ],
    result:
      'The game records the deed automatically. Renown and any title or border are shared across the account. Earning the same deed on another character does not add its Renown twice.',
  },
  'The Reliquary': {
    where: 'Open The Reliquary anywhere (Shift+X by default).',
    need: 'Choose a shelf, then a page with a missing relic. Check the source shown for the missing piece.',
    steps: [
      'Select the shelf and page. Inspect the missing silhouette to identify the relic you need. You can pin up to ' +
        RELIQUARY_TRACK_CAP +
        ' pages to follow them on this character.',
      "Follow the relic's source: for example, defeat its named boss at the stated difficulty or obtain its required crafted piece. The first qualifying acquisition on any character fills that silhouette.",
      'Reopen the page to see the fill. Collect every required piece on the page to illuminate it. Check your Curator rank for cosmetic rewards.',
    ],
    result:
      'Collection progress is account-wide. Retired and Personal pages do not gate completion. Account weapon skins can fill their pages but do not score Curator rank.',
  },
  Companions: {
    where: 'Open Cosmetics (Shift+Y by default) and select the companion collection.',
    need: 'An unlocked companion. Each entry below gives its own source. For example, Tug, the Warhorse is bought from an Honor quartermaster, while Crystal Lich comes from Heroic Nythraxis.',
    steps: [
      'Meet the listed unlock condition. If you won a boss companion, leave the instance to reveal it.',
      'In Cosmetics, select the collected companion and choose Summon. To put it away, choose Dismiss.',
      "For automatic corpse looting, right-click the summoned companion's target frame (double-tap on touch) and choose Enable Autoloot.",
    ],
    result:
      'The companion follows this character. Online, it is collected for your account. Auto-loot picks up eligible loot you can carry within 30 yards of you, outside raid instances.',
  },
  'Mount appearances': {
    where: 'Open Cosmetics (Shift+Y by default), then Mounts.',
    need: 'Learn riding from Stablemaster Marla Hitchen before summoning a mount. You also need the appearance you want to wear. See [[Mounts and riding]] for training and collectible reins.',
    steps: [
      'Find the appearance in Mounts. Choose Preview to inspect it. The card indicates whether you own it.',
      'On an owned appearance select Wear, then summon your mount. Use Take off on the worn skin to remove it.',
      'For appearances shared through collectible mount items, keep the item in the bags or bank of a character on the account.',
    ],
    result:
      "Your mount uses the chosen look. This choice belongs to the character. Speed comes from that character's riding training.",
  },
  'Weapon appearances': {
    where: 'Open Cosmetics (Shift+Y by default) and select Skins.',
    need: 'Own the skin and equip a weapon of the matching type. For example, a sword skin requires a compatible sword.',
    steps: [
      'Choose an appearance from the list below to identify the type and source. Obtain it, then equip the compatible weapon.',
      'Open Skins, find the owned skin under its weapon type, and choose Apply.',
      'To restore the underlying weapon appearance, choose Detach on the applied skin.',
    ],
    result:
      'Your equipped weapon changes appearance. Its damage and stats stay the same. Skin ownership is shared across your account.',
  },
  Membership: {
    where:
      'Online, open the WOC Store and select Membership. For gear and account storage, visit a banker and select the Account bank.',
    need: 'An active membership for the benefits. To add 30 days with an item, obtain a [[Membership Token (30 Days)]] from another player or from a supported store purchase.',
    steps: [
      'For a purchased token, select Buy membership token, complete the purchase, then return on the purchasing character and select Collect purchased token. Take the delivered token from the purchase parcel or your mailbox.',
      'Open your bags and use the token to add 30 days to your account. A token still in your bags can be traded instead.',
      'With membership active, open the Account bank at a banker and choose Claim membership gear. Equip all seven membership armor pieces to activate the XP bonus. The staff is separate.',
    ],
    result:
      'Membership grants access to the account bank, 10 extra character slots, an extra bag slot and half the usual auction tax. The full armor set gives 20% more XP while membership is active. The matching referral-set bonus does not stack with it.',
  },
  'Mobile Play': {
    where:
      'Enter the game on a phone or tablet. Your movement stick appears at the left and Quick Actions at the bottom of the game screen.',
    need: 'A touchscreen for the touch layout. A supported connected controller can also operate the game.',
    steps: [
      'Drag the left stick to move. Drag on the world to turn the camera. Pinch with two fingers to zoom.',
      'Select a target, then tap an ability on the on-screen action bar. Tap Quick Actions to open a window. Tap More in that menu for additional windows.',
      'With a controller, use the left stick to move and right stick to look. In a window such as Bags, use the on-screen pointer. Adjust bindings, deadzone and camera speed in the controller settings.',
    ],
    result:
      'These controls perform the same actions and open the same character windows as desktop controls. Rewards come from the activity you complete.',
  },
  'Agents and Bots': {
    where:
      'For a local practice agent, open a terminal in a checkout of the game. The example runs outside the browser.',
    need: 'The game source, its Node dependencies, and Python with gymnasium and numpy installed.',
    steps: [
      'From the repository root, run npm ci, then npm run build:env. This builds the local simulation used by the example.',
      'Install the Python dependencies with python -m pip install gymnasium numpy. Run python python/example_random_agent.py from the repository root.',
      'The example starts a Warrior, samples actions, and resets the episode after completion. To control your own agent, use the observation returned by reset, pass an action to step, and call close when finished.',
    ],
    result:
      'The example prints the available actions, observation shape, step rate and total training reward. This local simulation has its own character and does not award items or experience to your online character.',
  },
};
