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
    hollow: `${item(REFERRAL_HOLLOW_TRINKET)}, a trinket with +3 Stamina. While equipped, taking damage that leaves you alive below 35% health gives you a shield worth 30% of your maximum health. It lasts up to 10 seconds and can trigger once every 2 minutes`,
    fogbinder: `${item(REFERRAL_FOG_TRINKET)}, which replaces the trinket from your second stamp. It now gives +5 Stamina, keeps its shield and gains an on-use effect that adds 5 Strength, Agility, Stamina, Intellect and Spirit for 15 seconds, once every 2 minutes. Claiming it permanently locks your card to this character`,
    gravewyrm: 'free basic riding training for your assigned character',
    raid: `${item(REFERRAL_SLIME_REINS)}, the mount reward for Wobbles the Slime`,
  };
  const stampRows = REFERRAL_MILESTONES.map((m) => {
    let objective: string;
    if (m.id === 'tutorial') {
      objective = `Each of you turns in ${setSail} to ${ferryman} while in the same party. If you turned it in separately after starting the card, finish it on both assigned characters and form a party together again.`;
    } else if (m.id === 'raid') {
      objective = `Defeat a raid boss together, for example ${mob('nythraxis_scourge_of_thornpeak')} or ${mob('ignivar_herald_of_the_last_flame')}. Both assigned characters must qualify for the same kill. Both must also meet the raid's minimum level (20 for these raids).`;
    } else {
      const boss = dungeonBosses[m.id];
      const dungeon = w.entity('dungeon', m.dungeonId, DUNGEONS[m.dungeonId].name);
      objective = `Each of you can turn in ${quest(m.questId)} while grouped. You can also earn both stamps by killing ${mob(boss.mobId)} together in ${dungeon} once both characters are level ${boss.level} or higher. You can take this route even if neither of you picked up the quest.`;
    }
    return objective + ' Your reward is ' + rewards[m.id] + '.';
  });
  w.describe(
    'Referral cards',
    'Refer a Friend lets an existing player and a newly invited player earn five rewards each. The invitation binds the two accounts. You then choose the two characters that will earn stamps together.',
    heading(
      'How to start a card',
      steps([
        `If you are inviting a friend, sign in to the online game, open Social and choose “${ui.title}”. Under “${ui.inviteTitle}”, copy the complete URL from “${ui.inviteLabel}”. Send it to your friend before they create their account.`,
        'If you received the invitation, open that link and choose “Create Account”. Finish signing up from the link. The game reads the referral from the URL automatically. An existing account cannot be linked later by adding a friend, making a new character or entering a code.',
        `Log in on the same realm. Each of you needs a level 1 to 4 character who has never turned in ${setSail}, the final tutorial quest. An experienced inviter can use a new character on the account that sent the link.`,
        'One player types /invite followed by the other character’s name in chat. The other player accepts the party invitation. Stay on those characters in the same party.',
        `When the stamp-card prompt appears, each player chooses “${ui.accept}”. Accepting the party invite alone does not start the card. If the prompt was declined, either player can reopen Social, choose “${ui.title}”, find the bound friend and select “${ui.start}”. Both players still need to accept while eligible.`,
      ]),
    ),
    heading(
      'How to earn and redeem each stamp',
      'Use the two characters named on the card, in the same party. A quest turn-in gives credit to the player who hands it in. For a boss kill, both players must be inside the instance and qualify for the kill. Each player opens their own card and selects “' +
        ui.redeem +
        '” for each earned stamp. You can earn stamps in any order, but each player must claim their rewards in the order below.\n\n' +
        steps(stampRows),
    ),
    heading(
      'Moving a card to another character',
      `Each pair of bound accounts can start one card together. Before claiming The Fogbinder reward, log in on your replacement character, level 1 to 4 with ${setSail} still unfinished. Join a party with your bound friend, open your card and choose “${ui.move}”, then “${ui.confirmMove}”. Your stamps and the rewards from this card transfer from the old character. When you later redeem The Fogbinder, choose “${ui.understand}” and “${ui.confirmLock}” to make that assignment permanent. Your friend makes their own choice on their card.`,
    ),
    heading(
      'Rewards for inviting friends',
      `“${ui.referrerTitle}” counts different invited friends who have personally redeemed all five stamps. You can see this count in ${ui.title}. Each threshold pays once.\n\n` +
        list([
          `After 1 friend, receive ${item(REFERRAL_RAPTOR_REINS)}.`,
          'After 2 friends, unlock 20 permanent bank slots and 5 extra character slots.',
          'After 3 friends, receive 1,000 Claudium.',
          'After 4 friends, receive another 1,000 Claudium.',
          'After 5 friends, unlock the cosmetic companion [[Flicker and Glimmer (Companion)|Flicker and Glimmer]].',
        ]) +
        `\n\nWhen an invited friend buys their first paid [[Membership]], the inviter also receives a ${item('membership_token')}. This is separate from the five stamps.`,
    ),
    heading(
      'Summoning your friend',
      `Open the card and choose “${ui.summon}”. Your friend has one minute to accept and travel to your position. Each player can summon that friend once every 30 minutes. Both must be online, alive, out of combat, and outside duels. Finish casting first. Summons are unavailable while jailed or spectating, or if either account has blocked the other. Until both characters have turned in ${setSail}, they must be in the same zone.`,
    ),
    heading(
      'Version notes',
      `The dungeon kill and level rules above are from v0.45.7. In the v0.46.0 branch snapshot of November 1, the quest turn-in is the primary route. Its dungeon catch-up rule requires the player to have already turned in the corresponding quest before clearing the dungeon with their bound friend. The raid credit check in that snapshot has no separate minimum-level condition. Some non-English in-game hints still describe the earlier rules. See the [https://github.com/levy-street/world-of-claudecraft/releases/tag/v0.45.7 official v0.45.7 release notes].`,
    ),
  );
}
