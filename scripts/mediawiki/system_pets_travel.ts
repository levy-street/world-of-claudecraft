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
    'A primary pet fights beside its owner. Summoning a replacement demon dismisses the previous primary pet. Temporary undead and the Pyre Colossus can fight alongside a primary pet. A cosmetic companion has a separate slot.',
    heading(
      'Stances',
      list([
        'Passive: the pet does not pick a target on its own.',
        'Assist: the pet takes your active hostile target after you attack it.',
        'Defensive: the pet looks for enemies attacking you or the pet, or an enemy you are actively fighting, within 50 yards of itself.',
        'Aggressive: the pet looks for nearby hostile targets within 18 yards while you are active. After one minute without owner activity it stops pulling fresh enemies.',
        'While mounted, the pet follows you in every stance.',
      ]),
    ),
    heading(
      'Commands',
      list([
        `An eligible melee pet can Growl once every ${PET_GROWL_INTERVAL} seconds. A manual taunt from outside 5 yards waits until the pet closes to melee range. Ranged pets cannot force a taunt.`,
        `Revive Pet returns a dead pet to your side with ${percent(PET_REVIVE_HP_FRACTION)} of maximum health rounded to the nearest whole point, with a minimum of 1.`,
        'Demon Heal costs 55 mana. For 5 seconds it heals the living demon each second for 8% of its maximum health rounded up, capped at the health missing.',
      ]),
    ),
  );
  w.describe(
    'Hunter pets',
    `You can tame a hostile open-world beast or spider at or below your level if it is neither elite, rare, a boss, nor specifically protected from taming. You must have no existing pet, even a dead one. A successful tame creates a full-health pet, synchronizes its level to yours and starts it in Defensive stance.`,
    `The pet adds ${percent(PET_OWNER_HP_SHARE)} of your maximum health and ${percent(PET_OWNER_ARMOR_SHARE)} of your armor to its base values. Its attack power equals ${percent(PET_OWNER_AP_SHARE)} of your ranged attack power. Each inherited health, armor and attack power amount rounds to a whole point. It copies ${percent(PET_OWNER_HASTE_SHARE)} of your melee haste. When your stats change the game recalculates these shares.`,
    "Feed a hurt pet a food item from your bags. Over 5 seconds it receives one heal each second equal to the food's health value divided by five and rounded up. Feeding again replaces the existing effect.",
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
      "Creatures in this family share the hunter-pet inheritance rules. The built-in overworld camp list below filters out protected, rare, elite and boss templates. You must still meet the individual creature's level and target a hostile creature.",
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
      `Summoned by ${[...names].join(', ')} at the owner's level. See ${mob(id)} for the underlying creature.`,
      heading(
        'Base statistics',
        list([
          `Maximum health: ${s.hpBase} + ${s.hpPerLevel} x (level minus 1), before modifiers. Armor: ${s.armorPerLevel} x (level minus 1).`,
          `Weapon damage rolls from 80% to 125% of ${dmg}, with each endpoint rounded to the nearest whole number. Base time between attacks is ${s.attackSpeed} seconds.`,
        ]),
      ),
      r
        ? `The ranged attack reaches ${r.range} yards and deals ${r.school} damage. When the projectile lands, a successful hit rolls weapon damage plus (pet attack power / 14) x weapon speed in seconds. It bypasses armor, can be fully resisted and has a 5% chance to deal double damage before pet damage modifiers.`
        : '',
      r?.active
        ? `${r.name} can also fire a commanded extra projectile once every ${r.active.cooldown} seconds.`
        : '',
      r?.spellVuln
        ? `A hit increases magic damage taken by ${percent(r.spellVuln.amp)} for ${r.spellVuln.duration} seconds. Repeated hits refresh it.`
        : '',
      jet
        ? `Water Jet channels for ${jet.duration} seconds. It deals ${Math.round(jet.total / (jet.duration / jet.interval))} Frost damage every ${jet.interval} second(s) and reduces the target to ${percent(jet.slow)} movement speed during the effect. Cooldown: ${jet.cooldown} seconds.`
        : '',
      chain
        ? `${chain.name} pulls an eligible enemy from farther than ${chain.triggerRange} but no farther than ${chain.maxRange} yards to ${chain.pullRange} yards from the pet, with line of sight. Bosses, controlled pets, evading and crowd-control-immune targets cannot be pulled. Cooldown: ${chain.cooldown} seconds.`
        : '',
      cleave
        ? `Cleave splashes ${percent(cleave.mult)} of a pet weapon strike onto other visible enemies within ${cleave.radius} yards of its primary target, before each target's armor. Cooldown: ${cleave.cooldown} seconds.`
        : '',
      petCanForceTaunt(id)
        ? 'This melee template is eligible to force a taunt when its command is available.'
        : 'This pet cannot taunt.',
    );
  }
  w.describe(
    'Companions',
    `With buddy auto-loot enabled, your companion searches for the nearest lootable corpse within ${BUDDY_LOOT_RANGE} yards of you that you personally tapped or that holds loot reserved for you. It walks to the corpse to pick up what you can carry. It skips other players' free-for-all corpses, stops while you are dead and does not collect in raid instances.`,
  );
  w.describe(
    'Overworld passages',
    'Walk into either end of a passage to arrive at the opposite landing. A released spirit can also use these links.',
    list(
      PORTALS.map((p) => {
        const side = (x: number, z: number) => {
          const zone = zoneContaining(x, z);
          return `${zone ? `${w.entity('zone', zone.id)}, ` : ''}x ${x}, z ${z}`;
        };
        return `${words(p.id)}: ${side(p.a.x, p.a.z)} to ${side(p.b.x, p.b.z)}. Trigger radius ${p.radius > 0 ? p.radius : 2} yards.`;
      }),
    ),
  );
  w.describe(
    'Allied Hearthstone',
    `Use ${w.entity('item', 'allied_hearthstone', ITEMS.allied_hearthstone.name)} near an allied hub for the first attunement, or bind it to a hub at its quartermaster. Activate it out of combat and finish the 10-second cast to travel to the chosen hub. The 15-minute cooldown starts on arrival.`,
    heading(
      'Destinations',
      list(Object.values(FACTION_HUB_LANDINGS).map((h) => `${h.name}: x ${h.x}, z ${h.z}.`)),
    ),
  );
}
