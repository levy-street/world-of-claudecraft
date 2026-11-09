import {
  REFERRAL_BAG,
  REFERRAL_FOG_TRINKET,
  REFERRAL_HOLLOW_TRINKET,
  REFERRAL_RAPTOR_REINS,
  REFERRAL_SLIME_REINS,
} from '../../src/sim/content/referral_rewards';
import { DUNGEONS, ITEMS, MOBS, NPCS, QUESTS } from '../../src/sim/data';
import { REFERRAL_MILESTONES } from '../../src/sim/referral_cards';
import { referralCardStrings as ui } from '../../src/ui/i18n.catalog/referral_cards';
import { heading, list, type SystemWriter } from './system_writer';

export function addReferralGuide(w: SystemWriter) {
  const item = (id: string) => w.entity('item', id, ITEMS[id].name);
  const mob = (id: string) => w.entity('mob', id, MOBS[id].name);
  const quest = (id: string) => w.entity('quest', id, QUESTS[id].name);
  const setSail = quest(REFERRAL_MILESTONES[0].questId);
  const ferryman = w.entity('npc', 'ferryman_odo', NPCS.ferryman_odo.name);
  const steps = (lines: string[]) => lines.map((line) => '# ' + line).join('\n');
  const dungeonBosses = {
    hollow: { mobId: 'morthen', level: 5 },
    fogbinder: { mobId: 'vael_the_mistcaller', level: 12 },
    gravewyrm: { mobId: 'korzul_the_gravewyrm', level: 18 },
  };
  const rewards = {
    tutorial: `the ${ui.trailmateTitle} title and a ${item(REFERRAL_BAG)} (${ITEMS[REFERRAL_BAG].bagSlots} general bag slots)`,
    hollow: `${item(REFERRAL_HOLLOW_TRINKET)}, a trinket with +3 Stamina. While you wear it, a hit that drops you below 35% health without killing you gives you a shield. The shield is worth 30% of your maximum health and lasts up to 10 seconds. This can happen once every 2 minutes`,
    fogbinder: `${item(REFERRAL_FOG_TRINKET)}. It replaces the trinket from your second stamp. It gives +5 Stamina and keeps the same shield. You can also use it to gain 5 Strength, Agility, Stamina, Intellect and Spirit for 15 seconds, once every 2 minutes. Claiming it locks your card to this character for good`,
    gravewyrm: 'free basic riding training for the character on your card',
    raid: `${item(REFERRAL_SLIME_REINS)}, the mount reward for Wobbles the Slime`,
  };
  const stampRows = REFERRAL_MILESTONES.map((m) => {
    let objective: string;
    if (m.id === 'tutorial') {
      objective = `Each of you turns in ${setSail} to ${ferryman} while you are in the same party. If you turned it in on your own after starting the card, finish it on both characters on the card. Then join a party together again.`;
    } else if (m.id === 'raid') {
      objective = `Defeat a raid boss together, for example ${mob('nythraxis_scourge_of_thornpeak')} or ${mob('ignivar_herald_of_the_last_flame')}. Both characters on the card must count for the same kill. Both must also be at least the raid's lowest allowed level (20 for these raids).`;
    } else {
      const boss = dungeonBosses[m.id];
      const dungeon = w.entity('dungeon', m.dungeonId, DUNGEONS[m.dungeonId].name);
      objective = `Each of you can turn in ${quest(m.questId)} while in a group. Or you can both earn this stamp by killing ${mob(boss.mobId)} together in ${dungeon}, once both characters are level ${boss.level} or higher. This way works even if neither of you took the quest.`;
    }
    return objective + ' Your reward is ' + rewards[m.id] + '.';
  });
  w.describe(
    'Referral cards',
    'With Refer a Friend, a player who already plays and a friend they invite each earn five rewards. The invite links your two accounts together. Then you each pick one character to earn stamps with.',
    heading(
      'How to start a card',
      steps([
        `If you are inviting a friend, sign in to the online game, open Social and choose “${ui.title}”. Under “${ui.inviteTitle}”, copy the whole link from “${ui.inviteLabel}”. Send it to your friend before they make their account.`,
        'If you got the invite, open that link and choose “Create Account”. Finish signing up from that link. The game reads the invite from the link by itself. An account you already have cannot be linked to the invite later. Adding them as a friend, making a new character or typing a code will not link it.',
        `Log in on the same realm. Each of you needs a character from level 1 to 4 who has never turned in ${setSail}, the last tutorial quest. If the inviter is already high level, they can make a new character on the account that sent the link.`,
        'One player types /invite and then the other character’s name in chat. The other player accepts the party invitation. Stay on those characters, in the same party.',
        `When the stamp card window appears, each player chooses “${ui.accept}”. Joining the party does not start the card by itself. If someone said no to the window, either player can open Social again, choose “${ui.title}”, find the linked friend and choose “${ui.start}”. Both players must still accept while they meet the rules above.`,
      ]),
    ),
    heading(
      'How to earn and redeem each stamp',
      'Play the two characters named on the card, in the same party. A quest turn-in gives credit to the player who hands it in. For a boss kill, both players must be inside the dungeon or raid and count for the kill. Each player opens their own card and chooses “' +
        ui.redeem +
        '” for each stamp they earned. You can earn the stamps in any order. But each player must claim the rewards in the order below.\n\n' +
        steps(stampRows),
    ),
    heading(
      'Moving a card to another character',
      `Each pair of linked accounts can start only one card together. You can move your card before you claim The Fogbinder reward. Log in on the new character. It must be level 1 to 4 and must not have finished ${setSail} yet. Join a party with your linked friend, open your card and choose “${ui.move}”, then “${ui.confirmMove}”. Your stamps and the rewards from this card move over from the old character. Later, when you claim The Fogbinder reward, choose “${ui.understand}” and “${ui.confirmLock}”. After that, the card stays on that character for good. Your friend decides the same thing on their own card.`,
    ),
    heading(
      'Rewards for inviting friends',
      `“${ui.referrerTitle}” counts how many different friends you invited have claimed all five stamps themselves. You can see this number in ${ui.title}. Each reward below is given only once.\n\n` +
        list([
          `After 1 friend, get ${item(REFERRAL_RAPTOR_REINS)}.`,
          'After 2 friends, unlock 20 more bank slots and 5 more character slots, for good.',
          'After 3 friends, get 1,000 Claudium.',
          'After 4 friends, get another 1,000 Claudium.',
          'After 5 friends, unlock the cosmetic companion [[Flicker and Glimmer (Companion)|Flicker and Glimmer]].',
        ]) +
        `\n\nWhen a friend you invited buys their first paid [[Membership]], you also get a ${item('membership_token')}. This is separate from the five stamps.`,
    ),
    heading(
      'Summoning your friend',
      `Open the card and choose “${ui.summon}”. Your friend has one minute to accept and travel to where you are. Each player can summon that friend once every 30 minutes. To summon:\n` +
        list([
          'Both of you must be online and alive.',
          'Neither of you can be in combat or in a duel.',
          'Finish any spell you are casting first.',
          'You cannot summon while jailed or spectating, or if either account has blocked the other.',
          `Until both characters have turned in ${setSail}, they must be in the same zone.`,
        ]),
    ),
    heading(
      'Version notes',
      `The dungeon kill and level rules above are from v0.45.7. In the v0.46.0 branch as it stood on November 1, the quest turn-in is the main way to earn a dungeon stamp. To catch up by clearing the dungeon with your linked friend, you must already have turned in the matching quest. In that version, the raid stamp has no separate lowest-level rule. Some in-game hints in other languages still describe the older rules. See the [https://github.com/levy-street/world-of-claudecraft/releases/tag/v0.45.7 official v0.45.7 release notes].`,
    ),
  );
}
