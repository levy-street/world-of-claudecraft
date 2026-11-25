import { FACTION_HUB_LANDINGS } from '../../src/sim/content/faction_vendors';
import {
  ABILITIES,
  getActiveWorldContent,
  ITEMS,
  MOBS,
  PORTALS,
  zoneContaining,
} from '../../src/sim/data';
import { BUDDY_LOOT_RANGE } from '../../src/sim/pet/buddy_autoloot';
import { PET_REVIVE_HP_FRACTION } from '../../src/sim/pet/pet_commands';
import {
  PET_OWNER_AP_SHARE,
  PET_OWNER_ARMOR_SHARE,
  PET_OWNER_HASTE_SHARE,
  PET_OWNER_HP_SHARE,
  TAMEABLE_FAMILIES,
} from '../../src/sim/pet/pet_scaling';
import { petCanForceTaunt } from '../../src/sim/pet/pet_taunt_gate';
import { type AbilityEffect, PET_GROWL_INTERVAL } from '../../src/sim/types';
import { heading, list, percent, type SystemWriter, words } from './system_writer';

function summonTemplate(effect: AbilityEffect) {
  switch (effect.type) {
    case 'summonDemon':
      return effect.mobId;
    case 'summonPet':
    case 'summonUndead':
      return effect.templateId;
    case 'summonPyreColossus':
      return 'pyre_colossus';
    default:
      return null;
  }
}

export function addPetAndTravelRules(w: SystemWriter) {
  const mob = (id: string) => w.entity('mob', id, MOBS[id]?.name);
  w.describe(
    'Combat pets',
    'Your main pet fights beside you. You can only have one main pet. If you summon a new demon, your old main pet goes away. Short-lived undead and the Pyre Colossus can fight next to your main pet. A cosmetic companion does not take up a pet spot.',
    heading(
      'Stances',
      list([
        'Passive: the pet never picks a target by itself.',
        'Assist: after you attack an enemy, the pet attacks your target too.',
        'Defensive: the pet looks for enemies within 50 yards of itself. It goes after enemies attacking you or the pet, or an enemy you are fighting.',
        'Aggressive: while you are active, the pet attacks enemies within 18 yards. If you do nothing for one minute, it stops starting fights with new enemies.',
        'While you ride a mount, the pet just follows you, whatever its stance.',
      ]),
    ),
    heading(
      'Commands',
      list([
        `A melee pet that has Growl can use it once every ${PET_GROWL_INTERVAL} seconds. If you order a taunt from more than 5 yards away, the pet waits until it is close enough to hit. Ranged pets cannot force a taunt.`,
        `If your pet was alive when you died, it comes back when you are brought back to life. It returns with ${percent(PET_REVIVE_HP_FRACTION)} of its maximum health, rounded to the nearest whole point, and always at least 1. A Hunter can instead cast Patch Up to bring the pet back at 50% health.`,
        'Demon Heal costs 55 mana. It only works on a demon that is alive. For 5 seconds, it heals the demon once each second for 8% of its maximum health, rounded up. It never heals more than the health the demon is missing.',
      ]),
    ),
  );
  w.describe(
    'Hunter pets',
    `You can tame a hostile beast or spider out in the open world. It must be your level or lower. It cannot be elite, rare, a boss, or a creature that is marked as untameable. You must not have a pet already, not even a dead one. When the tame works, you get a pet with full health. Its level is set to match yours, and it starts in Defensive stance.`,
    `Your pet gets some of your stats on top of its own. It adds ${percent(PET_OWNER_HP_SHARE)} of your maximum health and ${percent(PET_OWNER_ARMOR_SHARE)} of your armor to its base values. Its attack power is ${percent(PET_OWNER_AP_SHARE)} of your ranged attack power. Each of these health, armor and attack power amounts is rounded to a whole point. It also gets ${percent(PET_OWNER_HASTE_SHARE)} of your melee haste. When your stats change, these amounts update too.`,
    "To heal a hurt pet, feed it a food item from your bags. It heals once each second for 5 seconds. Each heal is the food's health value divided by five, rounded up. Feeding it again replaces the healing that is still going.",
  );
  const camps = getActiveWorldContent().camps;
  for (const family of TAMEABLE_FAMILIES) {
    const seen = new Map<string, Set<string>>();
    for (const c of camps) {
      const template = MOBS[c.mobId];
      if (
        !template ||
        template.family !== family ||
        template.elite ||
        template.rare ||
        template.boss ||
        template.untameable
      )
        continue;
      const zone = zoneContaining(c.center.x, c.center.z);
      if (!zone) continue;
      const locations = seen.get(c.mobId) ?? new Set<string>();
      locations.add(w.entity('zone', zone.id));
      seen.set(c.mobId, locations);
    }
    w.article(
      'Hunter pets',
      family === 'beast' ? 'Beasts' : 'Spiders',
      'Pet family',
      "Creatures in this family follow the same Hunter pet rules for the stats they get from you. The list below shows where they live in the open world. It leaves out untameable, rare, elite and boss creatures. You must still be at least the creature's level, and it must be hostile.",
      list([...seen].map(([id, zones]) => `${mob(id)} in ${[...zones].join(', ')}`)),
    );
  }
  const summons = new Map<string, Set<string>>();
  for (const a of Object.values(ABILITIES).filter((a) => !a.hiddenFromPlayer)) {
    for (const effect of [a.effects, ...(a.ranks ?? []).map((r) => r.effects)].flat()) {
      const id = summonTemplate(effect);
      if (!id) continue;
      const names = summons.get(id) ?? new Set<string>();
      names.add(a.name);
      summons.set(id, names);
    }
  }
  for (const [id, names] of summons) {
    const s = MOBS[id],
      r = s.petRanged,
      jet = r?.jet,
      chain = s.petChainPull,
      cleave = s.petCleave;
    const dmg = `(${s.dmgBase} + ${s.dmgPerLevel} x (level minus 1))`;
    w.article(
      'Combat pets',
      s.name,
      'Combat pet',
      `Summoned by ${[...names].join(', ')} at the same level as its owner. See ${mob(id)} for the creature it is based on.`,
      heading(
        'Base statistics',
        list([
          `Maximum health: ${s.hpBase} + ${s.hpPerLevel} x (level minus 1), before any bonuses. Armor: ${s.armorPerLevel} x (level minus 1).`,
          `Each weapon hit deals a random amount from 80% to 125% of ${dmg}. Both ends of that range are rounded to the nearest whole number. The base time between attacks is ${s.attackSpeed} seconds.`,
        ]),
      ),
      r
        ? `The ranged attack reaches ${r.range} yards and deals ${r.school} damage. When the shot lands and hits, it deals weapon damage plus (pet attack power / 14) x weapon speed in seconds. Armor does not lower it, but the target can fully resist it. It has a 5% chance to deal double damage. That doubling happens before any pet damage bonuses.`
        : '',
      r?.active
        ? `${r.name} can also fire one extra shot when you command it, once every ${r.active.cooldown} seconds.`
        : '',
      r?.spellVuln
        ? `A hit increases magic damage taken by ${percent(r.spellVuln.amp)} for ${r.spellVuln.duration} seconds. Each new hit starts the timer again.`
        : '',
      jet
        ? `Water Jet channels for ${jet.duration} seconds. It deals ${Math.round(jet.total / (jet.duration / jet.interval))} Frost damage every ${jet.interval} second(s). While it lasts, the target moves at only ${percent(jet.slow)} of its normal speed. Cooldown: ${jet.cooldown} seconds.`
        : '',
      chain
        ? `${chain.name} pulls an enemy toward the pet. The enemy must be farther than ${chain.triggerRange} yards away but no farther than ${chain.maxRange} yards. It is pulled to ${chain.pullRange} yards from the pet. The pet must be able to see it. Bosses, pets under someone's control, enemies that are evading, and enemies immune to crowd control cannot be pulled. Cooldown: ${chain.cooldown} seconds.`
        : '',
      cleave
        ? `Cleave also hits other enemies with ${percent(cleave.mult)} of a pet weapon strike. They must be visible and within ${cleave.radius} yards of the main target. Each target's armor then lowers that damage. Cooldown: ${cleave.cooldown} seconds.`
        : '',
      petCanForceTaunt(id)
        ? 'This melee pet can force a taunt when its command is ready.'
        : 'This pet cannot taunt.',
    );
  }
  w.describe(
    'Companions',
    'Open Cosmetics and pick a companion you have collected. Choose Summon to have it follow this character. Choose Dismiss to send it away. When you play online, all characters on your account share the same collection.',
    `With your companion summoned, right-click its target frame (double-tap on a touchscreen) and choose Enable Autoloot. Your companion then looks for the nearest body with loot within ${BUDDY_LOOT_RANGE} yards of you. It must be an enemy you tagged yourself, or one with loot saved for you. Your companion walks over and picks up what you have room to carry. It skips bodies that other players can loot freely. It stops while you are dead, and it does not loot in raids.`,
  );
  w.describe(
    'Overworld passages',
    'Walk into either end of a passage to come out at the other end. You can use them as a ghost too, after you release your spirit.',
    list(
      PORTALS.map((p) => {
        const side = (x: number, z: number) => {
          const zone = zoneContaining(x, z);
          return `${zone ? `${w.entity('zone', zone.id)}, ` : ''}x ${x}, z ${z}`;
        };
        return `${words(p.id)}: ${side(p.a.x, p.a.z)} to ${side(p.b.x, p.b.z)}. Walk within ${p.radius > 0 ? p.radius : 2} yards of an end to use it.`;
      }),
    ),
  );
  w.describe(
    'Allied Hearthstone',
    `Use ${w.entity('item', 'allied_hearthstone', ITEMS.allied_hearthstone.name)} near an allied hub to set it the first time. You can also link it to a hub at that hub's quartermaster. To travel, use it while out of combat and finish the 10 second cast. You arrive at the hub you chose. The 15 minute cooldown starts when you arrive.`,
    heading(
      'Destinations',
      list(Object.values(FACTION_HUB_LANDINGS).map((h) => `${h.name}: x ${h.x}, z ${h.z}.`)),
    ),
  );
}
