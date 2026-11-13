import { ROW_LEVELS } from '../../src/sim/content/talent_rows';
import { getActiveWorldContent, NPCS } from '../../src/sim/data';
import { MAX_LEVEL, PRESTIGE_XP_PER_RANK, xpForLevel } from '../../src/sim/types';
import type { PlayPath } from './play_path';

function atNpc(id: string) {
  const npc = NPCS[id];
  return `${npc.name} (x ${npc.pos.x}, z ${npc.pos.z})`;
}

const wolfCamp = getActiveWorldContent().camps.find((camp) => camp.mobId === 'forest_wolf')!;

export const characterPaths: Record<string, PlayPath> = {
  'Leveling and prestige': {
    where:
      'Earn experience (XP) out in the world. When you reach the top level, press C to open your character sheet.',
    need: `Reach level ${MAX_LEVEL}. Then earn ${PRESTIGE_XP_PER_RANK.toLocaleString('en-US')} more lifetime XP for each Prestige rank.`,
    steps: [
      'Get quests from NPCs with a gold exclamation mark and do what they ask. Then talk to the NPC who takes the quest back and choose Complete Quest to get the XP. You also get XP from killing enemies, finishing delves, and profession actions that raise your skill.',
      'Before the top level, stand inside a town inn while out of combat. This builds up rested XP. Rested XP gives you extra XP when you kill enemies, until it runs out.',
      'At the top level, keep earning XP. When you have enough, open your character sheet, click Prestige, and confirm in the box that pops up.',
    ],
    result:
      'Each normal level-up raises your level and unlocks the abilities listed in your class spellbook. Each Prestige gives you one rank, which is only for show, and empties the level XP bar. You keep your level, gear, talents and lifetime XP.',
  },
  'Level experience': {
    where:
      'Look at the experience bar on your screen. The table below shows how much XP you need to go up from each level.',
    need: 'Find the row for the level you are now. Each row shows the XP for one level.',
    steps: [
      `For example, a new level 1 character needs ${xpForLevel(1)} XP to reach level 2. Take a quest to the NPC who takes it back, choose Complete Quest, then look at your bar again.`,
      'Between quests, defeat enemies, clear a delve, or gather and craft things that still raise your skill. You get the XP as soon as you finish each action.',
      'When the bar fills up, use the next row to plan your next level. Press P to open your spellbook and see the abilities you can now use.',
    ],
    result: `You go up levels on your own until level ${MAX_LEVEL}. After that, XP counts toward extra "virtual" levels and [[Leveling and prestige|Prestige]].`,
  },
  'Character stats': {
    where:
      'Press C anywhere to open your character sheet. Press B to open your bags next to it, so you can compare an item in your bags with what you are wearing.',
    need: 'Any character can look at their stats. To change a stat with gear, the item must suit your class, your level and the equipment slot.',
    steps: [
      'Read your stats on the sheet. Stamina gives more health. For weapon damage, compare your attack power and the weapon itself. For spells, compare your spell power or healing power.',
      'Hover over an item to see its bonuses and what you need to use it. Put on an item from your bags that you can use. Then look at the same numbers on the sheet again.',
      'The descriptions below show which stats your class turns into health, mana, damage or dodging hits. Your class page shows how its abilities use those stats.',
    ],
    result:
      'The gear you wear and the effects on you change your totals by themselves. Items that are only in your bags do not give you their stats.',
  },
  'Specialization and talents': {
    where: 'Press N to open Talents. You do not need to be in a town to change your choices.',
    need: `Reach level ${ROW_LEVELS[0]}. Leave combat and finish any arena match before you change your build. The six rows open at levels ${ROW_LEVELS.join(', ')}.`,
    steps: [
      'On the Specialization tab, you see three specialization panels. Read the role and main ability on each one. Click View talents on the one you want. This picks it and opens Choices.',
      'On Choices, hover over the options to read what they do. Click one option you can pick in each open row. It works right away. Click the option you picked again to clear that row.',
      'Press P to find any new abilities you got. Drag the ones you want onto an action bar. To change your choices later, press N again while out of combat.',
    ],
    result:
      'Your character gets the specialization you picked and the effects of the rows you chose. Only one option in each row can be on at a time.',
  },
  Combat: {
    where: `For an easy first fight outdoors, look for Forest Wolves near x ${wolfCamp.center.x}, z ${wolfCamp.center.z} in Eastbrook Vale. You can press P anywhere to look at your class abilities first.`,
    need: 'You need to be alive, an enemy to fight, and enough of the resource the ability uses (shown on it). Check the range and cooldown on its tooltip.',
    steps: [
      'Drag an ability you have learned from the spellbook to a slot on an action bar. Click the enemy or press Tab to target it. Right-click an enemy you can attack to start auto-attacking.',
      'Get within the range shown on the tooltip and face the target. Click the ability or press its key. Stand still until a cast finishes, unless the tooltip says you can cast while moving.',
      'When the enemy dies, walk to the body and click it to pick up loot that is yours. In a party, your loot settings decide who gets a drop that more than one player wants.',
    ],
    result:
      'Your attacks use up the resource they list and do their effects when they hit. A kill can give XP, drop loot and count toward a quest that asks for it, if you are allowed to get credit for it.',
  },
  'Combat pets': {
    where:
      'Press P to open the spellbook on a character who has learned a pet summon. A Hunter can follow [[Hunter pets]] to tame a beast instead.',
    need: 'You need the class, specialization and level that the summon ability asks for. Its tooltip shows the cost and cast time. A cosmetic companion (one that is only for show) uses a different slot.',
    steps: [
      'Drag your summon ability to an action bar and use it. For example, a Frost mage who has learned Summon Water Elemental can cast it this way.',
      'If you can control the pet, target an enemy. Click Attack on the pet bar to send the pet. Or choose Assist and attack the enemy yourself. Choose Passive to stop the pet from starting new fights on its own.',
      'Use the commands that pet has. For example, click Water Jet on the elemental’s bar to aim it at one enemy. Right-click Water Jet to turn automatic use on or off.',
    ],
    result:
      'Your pet fights with its own attacks. The entries below list its damage and abilities. If you summon a new main demon, the old one goes away.',
  },
  'Hunter pets': {
    where: `Try a Forest Wolf camp in Eastbrook Vale near x ${wolfCamp.center.x}, z ${wolfCamp.center.z}. The family pages below list, by zone, other creatures you can tame.`,
    need: 'You need to be a level 10 Hunter with Wildbond and have an empty combat-pet slot. Pick an enemy beast or spider outdoors that is your level or lower. You cannot tame rare, elite, boss or tame-protected creatures.',
    steps: [
      'Press P and put Wildbond on an action bar. If you already have a pet, even a dead one, your pet slot is full. Use Release Companion only if you want to give that pet up for good.',
      'Target the creature while it is alive and no more than 20 yards away. Use Wildbond and wait for the six-second cast to finish.',
      'After taming, use the pet bar to pick a stance and send your pet to attack an enemy you target. Use Patch Up to heal your pet for 10% of its maximum health each second for eight seconds. Patch Up can also bring a dead pet back with 50% health.',
    ],
    result:
      'You get one combat pet at your level with full health. It starts in Defensive stance. It gets stronger as your health, armor, ranged attack power and melee haste go up.',
  },
  'Death and recovery': {
    where:
      'You start on the death screen. If you release, your spirit goes to a graveyard. A marker on your screen shows the way back to your body.',
    need: 'Your character must be dead. You can wait to see if an ally can bring you back before you release. Or you can go the graveyard way right away.',
    steps: [
      'If an ally offers to bring you back to life, accept the offer before it runs out. To use the graveyard way instead, choose Release Spirit.',
      'Run your ghost back to your body to come back to life. If you died in a dungeon, go back in through its entrance. You come back to life at the entrance or at the last safe boss checkpoint.',
      'To come back faster, talk to the Pale Keeper at the graveyard and accept the offer there. Read the Keeper’s Toll first. Delves and battlegrounds have their own rules.',
    ],
    result:
      'You come back to life with some of your health and mana. Running back to your body means you do not pay the Keeper’s Toll. Dying never costs you gear, coin or XP.',
  },
  'Equipment and inventory': {
    where:
      'Press B for your bags and C for your character and equipment slots. You can change your gear anywhere.',
    need: 'An item in your bags that fits the slot and your class. Check its level, the kinds of armor or weapon you are allowed to use, and whether it says Unique-Equipped (you can only wear one).',
    steps: [
      'Hover over an item in your bags to compare it with what you are wearing. Check the slot as well as the stats.',
      'Drag the item onto the matching equipment slot on the character sheet. Then check the slot and your totals.',
      'To take an item off, drag it from the equipment slot to an empty space in your bags. To use a consumable (an item that gets used up), use it from your bags or put it on an action bar.',
    ],
    result:
      'The items you wear give their stats and set bonuses. When you swap gear, the item you took off goes back into your bags. Consumables do what their tooltip says.',
  },
  'Equipment sets': {
    where:
      'Look at a set item in your bags (B) or on your character sheet (C). Each set below links to its pieces and lists its bonuses.',
    need: 'Get enough different wearable pieces of the same set to reach the bonus you want. Each item page says where to get that item.',
    steps: [
      'Pick a set below. Pick a bonus you want and see how many pieces it needs.',
      'Follow the item links to find the bosses, vendors or crafting recipes that give those pieces. Check your class and level before you spend any money.',
      'Wear the pieces in their matching slots. Hover over any piece to see your set count and which bonus is on. For a four-piece bonus, wear four pieces of the set at the same time.',
    ],
    result:
      'When you wear enough pieces, the bonus turns on by itself. If you drop below that number, the bonus turns off. Read the set’s effect for any extra rules about combat or specialization.',
  },
  'Vanguard equipment': {
    where: `Shop with ${atNpc('fury')} in Eastbrook Vale or ${atNpc('warmarshal_draven_kole')} in Highwatch, Thornpeak Heights. Both sell the same Honor items.`,
    need: 'Earn Honor by fighting other players, for example in the [[Ashen Coliseum]] or the [[Thornhollow battleground]]. Check the Honor price and what you need to wear the item you want.',
    steps: [
      'Talk to either quartermaster and open the shop. Find the Vanguard armor for your specialization, or a weapon or accessory you can use.',
      'Pick the item, check the price and buy it with Honor. Press B and put it on in its slot.',
      'For the armor bonus, wear two pieces from the same specialization set. Wear four for the second bonus. Check any piece’s tooltip to see exactly which ability it changes.',
    ],
    result:
      'The gear is yours. Its normal stats and Vanguard set bonuses work against monsters and players. Warfare Offense and Defense change fights against players.',
  },
  'Equipment enchants': {
    where:
      'Press B. Start with a reagent (an enchanting material) in your bags that the enchant uses.',
    need: 'You need the formula, if the enchant must be learned. You also need its minimum Enchanting skill, the listed reagents, and an item that fits the slot it names. Some enchants only work on a Perfected item.',
    steps: [
      'Pick an enchant from the list below. Check what it needs and how many reagents. If it needs a formula, get the formula and use it to learn the enchant.',
      'Right-click one of the reagents and choose Apply Enchant. Pick the enchant. Then pick the exact item in your bags or on your character that you want to enchant.',
      'Make sure you picked the right item, then let the enchanting cast finish. If a choice is greyed out, check the picker to see what is missing: reagents, skill, the formula, or the right kind of item.',
    ],
    result:
      'When the cast works, it uses up the reagents and puts the bonus or effect on that one item. Look at the item’s tooltip to see the enchant.',
  },
  'Perfecting and promotion': {
    where:
      'Press Shift+T to open Perfecting. The window lists the Masterwrought items you wear or carry that you can perfect. To swap ranks between two Crucible pieces, you also need to be at the right crafting station.',
    need: "Skill 125 in the craft that makes the piece. Each try needs one Maker's Ember, one Sundered Essence and one Prismglass Setting. To make an item legendary, bring a fully Perfected piece and one Deed of Making.",
    steps: [
      'Pick the exact item, worn or in your bags. Check its rank and how many materials you have. Choose Attempt Perfecting. The first time, choose Bind and Attempt if you are happy to bind that item to you forever.',
      'Each try has an 80% chance (4 in 5) to add one rank. If it fails, you still lose the materials, but the item keeps the rank it had. Keep trying until rank four.',
      'To make it legendary, pick a Perfected piece that can be promoted and choose Name and Promote. Type a name (you cannot change it later) and choose Forge the Legend. To swap ranks instead, pick another piece from the same Crucible collection at its station. Choose Review rank exchange, then Bind and exchange ranks.',
    ],
    result:
      'At rank four the item gets its Perfected bonus. Promoting uses up the deed and gives the item a legendary name and quality, with the same stats. A rank swap trades the ranks of the two items and binds both to you.',
  },
  Questing: {
    where: `Look for a gold exclamation mark over an NPC or on the map (M). For example, ${atNpc('marshal_redbrook')} in Eastbrook Vale gives you [[Wolves at the Door (Quest, Eastbrook Vale)|Wolves at the Door]].`,
    need: 'Be at least the quest’s level and finish any quests that must come before it. Its wiki page shows who gives it, what to do, where to go, a map, and who to take it back to.',
    steps: [
      'Stand near the quest giver and click them. Pick the quest by name and click Accept. Press L to open your quest log and see how much you still need to do.',
      'Go to each objective marker. Kill the named enemy, collect the items, or click the object until each counter is full. For an escort quest, talk to the person at the start and keep them safe along the way.',
      'Go to the gold question mark over the NPC who takes the quest back. This can be a different NPC from the one who gave it. Open the quest, pick a reward if you are offered one, then click Complete Quest.',
    ],
    result:
      'The quest leaves your log. You get its XP, coin and items, and it can open the next quest in the chain. Repeatable quests reset on their own schedule.',
  },
  'Faction standing': {
    where: `In Eastbrook Vale, talk to ${atNpc('npc_wq_taskmaster')} for world quests. The [[Rift Watch (Faction)|Rift Watch]], [[Church Order (Faction)|Church Order]] and [[Automatons (Faction)|Automatons]] pages list their zones and quartermasters.`,
    need: 'You must be allowed to take the world quest you pick. The first world quests open at level 5, and some need a higher level. To buy something, you need high enough standing and the currency shown for the item.',
    steps: [
      'In Kaelen’s menu, pick “Show me the world quest board.” Pick a quest you can take and look at its goal and place on the map.',
      'Go to the marked area and do the task. The zone decides which faction you gain standing with. For a weekly commendation, finish the weekly emissary task and pick the faction when you hand it in.',
      'Visit the quartermaster of the faction you want to buy from. Check the item’s price and the standing you need. For example, Templar Althea at the Eastbrook chapel sells Church Order items.',
    ],
    result:
      'Finishing a world quest gives standing with that zone’s faction. Reaching a new standing tier opens more items at the quartermaster. Buying an item costs the currency shown next to it.',
  },
  'Overworld passages': {
    where:
      'The Duskfall Passage joins Thornpeak Heights (x 10, z 770) and The Veiled Hollow (x -122, z 959). You can start from either end.',
    need: 'Get to the entrance on foot, or as a spirit after you release. You can travel either way.',
    steps: [
      'Press M and go to the coordinates on your side of the passage.',
      'Walk to within 2 yards of the entrance. When you step in, you move across by yourself.',
      'Walk away from the landing to keep going in the new zone. To go back, walk into the entrance on that side.',
    ],
    result:
      'You arrive at the landing on the other side. If you were a spirit, you are still a spirit.',
  },
  'Swimming and climbing': {
    where:
      'Go into deep water to swim, or walk up to a ledge you can reach to climb. Use your normal movement keys.',
    need: 'To climb, you need a ledge you can reach with a jump. You cannot start a climb while stunned or rooted. For a long swim, plan a way back to shore.',
    steps: [
      'Walk into deep water and move forward to swim. Hold Left Ctrl to dive and Space to go up. Watch the blue breath bar underwater and come up for air before it runs out.',
      'If the open-sea fatigue warning shows up, turn back toward shore. Coming up for air fills your breath bar, but it does not make the open sea safe.',
      'To climb, face the ledge, move toward it and press Space to jump. At a high edge you can reach, your character pulls up by itself. Wait for the movement to finish.',
    ],
    result:
      'You get across the water or up onto the ledge. You lose health if you stay underwater with no breath left, or keep going into open-sea fatigue.',
  },
  Ferries: {
    where:
      'The Eastbrook Vale dock (x -125, z -54.8) goes to The Nightbloom (x -520, z 1505.2). Wickharbor in The Galecrest (x 487.3, z 385.27) goes to The Drakelands (x 515, z 1900).',
    need: 'Get to a pier while the ferry is there. The trip is free.',
    steps: [
      'Press M to open the world map. Look at the ferry port marker to see where it goes and when it arrives. Then go to the pier.',
      'When the ship arrives, walk onto its deck. Stay on the deck when the countdown ends. The ship waits at each stop for 60 seconds.',
      'Ride to the other dock. Walk off onto the pier while the ship is stopped.',
    ],
    result:
      'You reach the other port without paying or using up any item. The ship comes back the same way.',
  },
  'Mounts and riding': {
    where: `Go to the Galecrest Stables in The Galecrest. Talk to ${atNpc('stablemaster_marla')} beside the barn.`,
    need: 'To buy basic Riding Training, reach level 20 and bring 80 gold. Advanced Riding Training needs basic riding first and costs 1,000 gold. A referral card can also give you basic training.',
    steps: [
      'Talk to Marla and buy Riding Training. Press Shift+Y to open Cosmetics and pick a look you own under Mounts.',
      'Stand on land, out of combat. Press Mount / Dismount (the backquote key ` unless you changed it), or tap Mount on mobile. Wait for the summon to finish. Press the same key again to get off.',
      'To go faster, go back to Marla after you learn basic riding and buy Advanced Riding Training. See [[Mount racing]] to learn how the old, retired race is different from the solo course in Riding Lessons.',
    ],
    result:
      'Basic riding makes you move 70% faster on the ground. Advanced riding makes it 110%. Every mount look uses the speed you have trained.',
  },
  'Allied Hearthstone': {
    where: `Visit ${atNpc('npc_church_order_quartermaster')} at the Eastbrook chapel, ${atNpc('npc_rift_watch_quartermaster')} in Drifthaven, or ${atNpc('npc_automaton_quartermaster')} at Wyrmwatch.`,
    need: 'Reach Vanguard standing (13,000) with an allied faction. Bring 100 of that faction’s currency: Order Crests, Rift Watch Marks or Automaton Cogs. You can only carry one Allied Hearthstone.',
    steps: [
      'Open the quartermaster’s shop and buy an [[Allied Hearthstone]]. Then pick the place you want as your home. Talk to that place’s quartermaster and choose Attune my Allied Hearthstone here.',
      'When you want to go back, leave combat and use the stone from your bags or action bar. Wait for the 10-second cast to finish.',
      'To change where the stone takes you, visit another quartermaster from the list and attune the stone there.',
    ],
    result:
      'You arrive at the place you attuned. You can use the stone again and again. Its 15-minute cooldown starts when you arrive.',
  },
};
