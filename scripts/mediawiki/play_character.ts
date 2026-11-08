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
      'Earn experience in the world. Once you reach the level cap, press C to open your character sheet.',
    need: `Reach level ${MAX_LEVEL}, then earn ${PRESTIGE_XP_PER_RANK.toLocaleString('en-US')} more lifetime XP for each Prestige rank.`,
    steps: [
      'Take quests from NPCs with a gold exclamation mark and finish their objectives. Speak to the turn-in NPC and choose Complete Quest for the XP. Enemy kills, delve completions and profession actions that teach skill also give XP.',
      'Before the cap, stand inside a town inn out of combat to build rested XP. Kill enemies to spend that pool for extra kill XP.',
      'At the cap, keep earning XP. When you qualify, open your character sheet, click Prestige and confirm Prestige in the dialog.',
    ],
    result:
      'Normal level-ups increase your level and unlock the abilities listed in your class spellbook. Claiming Prestige adds one cosmetic rank and resets the level XP bar. You keep your level, gear, talents and lifetime XP.',
  },
  'Level experience': {
    where:
      'Check the experience bar on the HUD. The table below shows the XP needed to advance from each playable level.',
    need: 'Use the row for the level you have now. Each row gives the cost of one level.',
    steps: [
      `For example, a new level 1 character needs ${xpForLevel(1)} XP to reach level 2. Follow a quest to its turn-in NPC, choose Complete Quest, then check your bar again.`,
      'Defeat enemies between turn-ins, clear a delve, or do gathering or crafting that still awards skill progress. XP is credited as you complete the action.',
      'When the bar fills, use the next row to plan your next level. Open your spellbook with P to see the abilities you can now use.',
    ],
    result: `Levels advance automatically through ${MAX_LEVEL}. Further XP counts toward virtual levels and [[Leveling and prestige|Prestige]].`,
  },
  'Character stats': {
    where:
      'Press C anywhere to open your character sheet. Press B beside it to compare an item in your bags with your equipped gear.',
    need: 'A character is enough to inspect stats. To change a stat through gear, the piece must fit your class, level and equipment slot.',
    steps: [
      'Read your attributes and combat values on the sheet. For more health look at Stamina. For weapon damage compare attack power and the weapon itself. For casting compare your spell or healing power.',
      'Hover an item to read its bonuses and requirements. Equip a usable piece from your bags, then check the same values on the sheet.',
      'Use the descriptions below to see which attributes your class converts into health, mana, damage or avoidance. Your class page shows how its abilities use those values.',
    ],
    result:
      'Equipped gear and active effects update your character totals automatically. Items sitting in bags contribute no worn stats.',
  },
  'Specialization and talents': {
    where: 'Open Talents with N. You can change your choices away from town.',
    need: `Reach level ${ROW_LEVELS[0]}. Leave combat and finish any arena match before changing your build. The six rows open at levels ${ROW_LEVELS.join(', ')}.`,
    steps: [
      'On the Specialization tab, read the role and signature ability on each of your three specialization panels. Click View talents on the one you want to select it and open Choices.',
      'On Choices, hover the options to read their effects. Click one available option in each unlocked row. The choice applies immediately. Clicking your selected option again clears that row.',
      'Press P to find any newly granted abilities. Drag the ones you want to an action bar. To change your choices later, reopen N out of combat.',
    ],
    result:
      'Your character gains the selected specialization and the effects of the chosen rows. Only one option in each row is active at a time.',
  },
  Combat: {
    where: `For an early outdoor fight, look for Forest Wolves near x ${wolfCamp.center.x}, z ${wolfCamp.center.z} in Eastbrook Vale. Press P anywhere to review your class abilities first.`,
    need: 'A living character, a hostile target, and enough of the resource shown on the ability. Check the range and cooldown on its tooltip.',
    steps: [
      'Drag a learned ability from the spellbook to an action-bar slot. Click the enemy or press Tab to target it. Right-click an attackable enemy to start auto-attacking.',
      'Move within the range shown on the tooltip and face the target. Click the ability or press its assigned key. Let a cast finish before moving unless the tooltip says you can cast while moving.',
      'When the enemy dies, move to the body and interact with it to collect loot you are entitled to. In a party, your loot settings determine how a contested drop is awarded.',
    ],
    result:
      'Your attacks spend their listed resources and apply their effects if they connect. Eligible kills grant XP, can drop loot and can advance a matching quest objective.',
  },
  'Combat pets': {
    where:
      'Open the spellbook with P on a character who has learned a pet summon. A Hunter can instead follow [[Hunter pets]] to tame a beast.',
    need: 'Meet the summon ability’s class, specialization and level requirements. Its tooltip gives the cost and cast time. A cosmetic companion occupies a separate slot.',
    steps: [
      'Drag your summon to an action bar and use it. For example, a Frost mage who has learned Summon Water Elemental can cast it this way.',
      'For a controllable pet, select an enemy. Use Attack on the pet bar to send the pet, or choose Assist and attack the enemy yourself. Choose Passive when you want to prevent new automatic pulls.',
      'Use the commands offered for that pet. For example, click Water Jet on the elemental’s bar to channel it at one enemy. Right-click Water Jet to toggle automatic use.',
    ],
    result:
      'Your summoned pet fights using its own attacks. The entries below give its damage and abilities. Replacing a primary demon dismisses the previous one.',
  },
  'Hunter pets': {
    where: `Try a Forest Wolf camp in Eastbrook Vale near x ${wolfCamp.center.x}, z ${wolfCamp.center.z}. The family pages below list other eligible creatures by zone.`,
    need: 'A level 10 Hunter with Wildbond and an empty combat-pet slot. Pick an outdoor hostile beast or spider at or below your level. Rare, elite, boss and tame-protected creatures cannot be tamed.',
    steps: [
      'Open P and place Wildbond on an action bar. If you already own a pet, including a dead pet, the slot is occupied. Use Release Companion only if you want to give up that pet.',
      'Select the creature while it is alive and within 20 yards. Use Wildbond and finish the six-second cast.',
      'After the tame, use the pet bar to choose a stance and send your pet to attack a selected enemy. Use Patch Up to heal 10% of its maximum health each second for eight seconds, or to revive a dead pet with 50% health.',
    ],
    result:
      'You gain one full-health combat pet at your level. It starts in Defensive stance and scales with your health, armor, ranged attack power and melee haste.',
  },
  'Death and recovery': {
    where:
      'Start on the death screen. Releasing sends your spirit to a graveyard. Your corpse marker shows the way back.',
    need: 'Your character must be dead. You can wait for an available ally resurrection before releasing, or choose the graveyard route immediately.',
    steps: [
      'For an ally resurrection, accept the offered prompt before it expires. To take the graveyard route instead, choose Release Spirit.',
      'Run your ghost to your corpse to return to life. If you died in a dungeon, return through its entrance to revive at the entry or the last safe boss checkpoint.',
      'For a quicker graveyard revival, speak to the Pale Keeper and accept the resurrection there. Read the Keeper’s Toll before accepting. Delves and battlegrounds have their own recovery rules.',
    ],
    result:
      'You regain life with part of your health and mana. Returning to the corpse avoids the Keeper’s Toll. Death costs no gear, coin or XP.',
  },
  'Equipment and inventory': {
    where:
      'Press B for bags and C for your character and equipment slots. You can manage equipment in the field.',
    need: 'An item in your bags that fits the slot and your class. Check its required level, allowed armor or weapon type and any unique-equipped restriction.',
    steps: [
      'Hover a piece in your bags to compare its tooltip with the item you wear. Check the slot as well as the stats.',
      'Drag the piece onto its matching equipment slot on the character sheet. Check the slot and your totals afterward.',
      'To remove a piece, move it from the equipment slot to space in your bags. To use a consumable instead, use the item from your bags or put it on an action bar.',
    ],
    result:
      'Your worn items supply their stats and set bonuses. Swapping gear returns the displaced piece to your inventory. Consumables give the effect described on their tooltip.',
  },
  'Equipment sets': {
    where:
      'Inspect a set item in your bags (B) or on your character sheet (C). Each set entry below links its pieces and lists the bonuses.',
    need: 'Obtain enough different wearable pieces of the same named set to meet the particular bonus threshold. Each item page lists its own acquisition sources.',
    steps: [
      'Choose a set below. Pick a bonus you want and check how many pieces it requires.',
      'Follow the item links for the bosses, vendors or crafting recipes that supply those pieces. Check your class and level before spending currency.',
      'Equip the pieces in their matching slots. Hover any piece to check the set count and the active bonus. For a four-piece bonus, keep four qualifying pieces equipped at the same time.',
    ],
    result:
      'Meeting a threshold activates that bonus automatically. Dropping below it removes the bonus. Read the set’s effect for any additional combat or specialization conditions.',
  },
  'Vanguard equipment': {
    where: `Trade with ${atNpc('fury')} in Eastbrook Vale or ${atNpc('warmarshal_draven_kole')} in Highwatch, Thornpeak Heights. They carry the same Honor stock.`,
    need: 'Earn Honor from PvP, such as [[Ashen Coliseum]] or the [[Thornhollow battleground]]. Check the Honor price and equip requirements on the piece you want.',
    steps: [
      'Speak to either quartermaster and open the shop. Find the Vanguard armor for your specialization, or a weapon or accessory you can equip.',
      'Select the piece, check its cost and buy it with Honor. Open B and equip it in its named slot.',
      'For the armor bonus, collect and wear two pieces from the same specialization set, then four for its second bonus. Check any piece’s tooltip for the exact ability it changes.',
    ],
    result:
      'You own the purchased gear. Its ordinary stats and Vanguard set bonuses work in PvE and PvP. Warfare Offense and Defense affect fights against players.',
  },
  'Equipment enchants': {
    where: 'Open B. Begin from a reagent in your bags that the enchant uses.',
    need: 'The formula if the enchant must be learned, its minimum Enchanting skill, the listed reagents and an eligible item in the stated slot. Some enchants require a Perfected item.',
    steps: [
      'Choose an enchant from the list below and check its requirements and reagent quantities. If a formula is required, acquire it and use it to learn the enchant.',
      'Right-click a required reagent and choose Apply Enchant. Pick the enchant, then pick the exact bagged or equipped item you intend to enchant.',
      'Check the target and finish the enchanting cast. If a choice is disabled, check the missing reagent count, skill, learned formula and target restrictions in the picker.',
    ],
    result:
      'The successful cast spends the reagents and applies the chosen stat bonus or effect to that copy of the item. Check its tooltip to see the enchant.',
  },
  'Perfecting and promotion': {
    where:
      'Press Shift+T to open Perfecting. The window lists eligible Masterwrought copies you wear or carry. A rank exchange between Crucible pieces additionally requires the matching crafting station.',
    need: "Skill 125 in the craft that makes the piece. Each rank attempt needs one Maker's Ember, one Sundered Essence and one Prismglass Setting. For legendary promotion, bring a fully Perfected piece and one Deed of Making.",
    steps: [
      'Select the exact worn or bagged copy. Check its rank and material counts. Choose Attempt Perfecting. For the first attempt, choose Bind and Attempt if you wish to bind that copy permanently.',
      'Each attempt has an 80% chance of gaining one rank. A failure spends the materials and keeps the existing rank. Repeat until rank four.',
      'For a legendary name, select the eligible Perfected piece, choose Name and Promote, enter a permanent name and choose Forge the Legend. For an exchange instead, select another piece of the same Crucible collection at its station, choose Review rank exchange and then Bind and exchange ranks.',
    ],
    result:
      'Rank four grants the item’s Perfected bonus. Promotion spends the deed and gives the copy a legendary name and quality with the same stats. A rank exchange swaps the two ranks and binds both copies.',
  },
  Questing: {
    where: `Look for a gold exclamation mark over an NPC or on the map (M). For example, ${atNpc('marshal_redbrook')} in Eastbrook Vale offers [[Wolves at the Door]].`,
    need: 'Meet the quest’s minimum level and prerequisite quests. Its wiki page lists the giver, objectives, coordinates, map and turn-in NPC.',
    steps: [
      'Stand near the giver, interact, choose the quest by name and click Accept. Open L to read your quest log and check the objective counts.',
      'Travel to each objective marker. Kill the named enemy, collect the stated items or interact with the specified object until each counter is complete. For an escort, speak to the escort at the starting point and protect them along the route.',
      'Go to the gold question mark at the named turn-in NPC. Open the quest, choose a reward when one is offered, then click Complete Quest. The turn-in can be a different NPC from the giver.',
    ],
    result:
      'The quest leaves your active log, awards its stated XP, coin and items, and can unlock a follow-up quest. Repeatable quests have their own reset.',
  },
  'Faction standing': {
    where: `In Eastbrook Vale, talk to ${atNpc('npc_wq_taskmaster')} for world quests. [[Rift Watch (Faction)|Rift Watch]], [[Church Order (Faction)|Church Order]] and [[Automatons (Faction)|Automatons]] list their zones and quartermasters.`,
    need: 'Be eligible for the chosen world quest. The first world quests open at level 5 and individual quests can require a higher level. For a purchase, meet the standing gate and bring the currency shown for the item.',
    steps: [
      'In Kaelen’s dialogue, select “Show me the world quest board.” Select an available assignment and inspect its objective and location on the map.',
      'Travel to the marked area and complete the displayed objective. The zone determines which faction gains standing. For a weekly commendation, complete the weekly emissary charge and choose the faction at turn-in.',
      'Visit the quartermaster for the faction you want to buy from. Inspect the specific item’s price and standing requirement. For example, Church Order stock is available from Templar Althea at the Eastbrook chapel.',
    ],
    result:
      'World quest completion credits standing to the associated faction. Crossing tiers opens more quartermaster stock. A purchase spends the currency shown on the row.',
  },
  'Overworld passages': {
    where:
      'The Duskfall Passage joins Thornpeak Heights (x 10, z 770) and The Veiled Hollow (x -122, z 959). Either end can be your starting point.',
    need: 'Reach the entrance on foot or as a released spirit. Travel works in both directions.',
    steps: [
      'Open M and head to the coordinates on your current side of the passage.',
      'Walk to within 2 yards of the entrance. Crossing the trigger moves you automatically.',
      'Leave the landing to continue in the new zone. To return, approach the entrance on this side.',
    ],
    result:
      'You arrive at the opposite landing. A released spirit remains a spirit after the crossing.',
  },
  'Swimming and climbing': {
    where:
      'Enter deep water for swimming or approach a reachable ledge for climbing. Use the movement controls in the world.',
    need: 'A ledge within jumping reach for a climb. A stun or root stops you from starting one. For a long swim, plan a route back to shore.',
    steps: [
      'Walk into deep water and move forward to swim. Hold Left Ctrl to dive and Space to rise. Watch the blue breath bar underwater and surface before it empties.',
      'If the open-sea fatigue warning appears, turn back toward shore. Reaching the surface restores breath but does not make open sea safe.',
      'To climb, face the ledge, move toward it and press Space to jump. At a reachable high lip your character pulls up automatically. Let the movement finish.',
    ],
    result:
      'You cross the water or reach the top of the ledge. Staying submerged with no breath or continuing into open-sea fatigue costs health.',
  },
  Ferries: {
    where:
      'The Eastbrook Vale berth (x -125, z -54.8) connects to The Nightbloom (x -520, z 1505.2). Wickharbor in The Galecrest (x 487.3, z 385.27) connects to The Drakelands (x 515, z 1900).',
    need: 'Reach a pier while the ferry is docked. The crossing is free.',
    steps: [
      'Open the world map with M. Inspect the ferry port marker for its destination and arrival time, then head to the pier.',
      'When the ship docks, walk onto its deck. Stay on the deck when the departure countdown ends. Each scheduled stop lasts 60 seconds.',
      'Ride to the opposite berth and walk off onto the pier while the ship is docked.',
    ],
    result:
      'You reach the paired port with no fare or consumable spent. The return ship runs on the same route.',
  },
  'Mounts and riding': {
    where: `Go to the Galecrest Stables in The Galecrest. Speak to ${atNpc('stablemaster_marla')} beside the barn.`,
    need: 'For the ordinary purchase, reach level 20 and bring 80 gold for basic Riding Training. Advanced Riding Training requires basic riding and 1,000 gold. A referral card can award basic training separately.',
    steps: [
      'Speak to Marla and purchase Riding Training. Open Cosmetics with Shift+Y and choose an available appearance under Mounts.',
      'Stand on land out of combat and press Mount / Dismount (backquote by default), or tap Mount on mobile. Let the summon channel finish. Press the same control again to dismount.',
      'For greater speed, return to Marla after learning basic riding and purchase Advanced Riding Training. See [[Mount racing]] for the distinction between the retired activity and the solo course in Riding Lessons.',
    ],
    result:
      'Basic riding increases ground movement speed by 70%. Advanced riding raises it to 110%. All mount appearances use your character’s trained speed.',
  },
  'Allied Hearthstone': {
    where: `Visit ${atNpc('npc_church_order_quartermaster')} at the Eastbrook chapel, ${atNpc('npc_rift_watch_quartermaster')} in Drifthaven, or ${atNpc('npc_automaton_quartermaster')} at Wyrmwatch.`,
    need: 'Reach Vanguard standing (13,000) with an allied faction. Bring 100 of the selling faction’s currency: Order Crests, Rift Watch Marks or Automaton Cogs. You can carry one Allied Hearthstone.',
    steps: [
      'Open the quartermaster’s stock and buy [[Allied Hearthstone]]. At the destination you want as your home, speak to its quartermaster and choose Attune my Allied Hearthstone here.',
      'When you want to return, leave combat and use the stone from your bags or action bar. Complete the 10-second cast.',
      'Visit another listed quartermaster and repeat the attunement step whenever you want to change your destination.',
    ],
    result:
      'You arrive at the attuned hub. The reusable stone begins its 15-minute cooldown on arrival.',
  },
};
