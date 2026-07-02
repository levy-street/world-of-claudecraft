// Divergence-only dialect overlay for "en_CA" over base locale "en".
//
// "en_CA" inherits from "en": the build (scripts/i18n_build.mjs) resolves it as
// nested `en` -> this overlay, so any key absent here falls through to English. This file
// therefore carries ONLY the keys whose value differs from en; every other key is
// intentionally omitted. A key must NOT be re-added with a value equal to en
// (redundant duplication). Every key here must be a real `en` leaf
// path (tests/i18n_overlay_key_membership.test.ts + the byte gate). Keys are in `en`'s
// leaf order.

import type { TranslationKey } from '../i18n.catalog';

export const en_CA: Partial<Record<TranslationKey, string>> = {
  'hudChrome.perf.textColor': 'Text Colour',
  'hudChrome.perf.bgColor': 'Background Colour',
  'hudChrome.perf.colorTheme': 'Colour Theme',
  'hudChrome.perf.thresholds': 'Colour-Coded Warnings',
  'classDetails.labels.armor': 'Armour',
  'classDetails.lore.paladin':
    'Paladins are holy crusaders who support allies with blessings, heal wounds with Holy Light, and protect the weak in heavy armour.',
  'classDetails.lore.druid':
    'Druids channel nature, healing wounds, entangling foes, and shifting into animal forms for defence or damage.',
  'fiesta.category.offense': 'Offence',
  'fiesta.category.defense': 'Defence',
  'itemUi.kind.armor': 'Armour',
  'itemUi.stats.armor': 'Armour',
  'itemUi.tooltip.armorStat': '{value} Armour',
  // Stat tooltips keep the en prose; only the Armor -> Armour spelling diverges.
  'hudChrome.statInfo.effects.armor': '+{value} Armour',
  'entities.abilities.holy_shock.name': 'Holy Shock',
  'entities.abilities.holy_shock.description':
    'Shocks a friendly target with Holy energy, healing them for {damage}. (Holy signature)',
  'entities.abilities.holy_shield.name': 'Holy Shield',
  'entities.abilities.holy_shield.description':
    'Shields you with Holy power for 10 sec, increasing armor by 90 and striking melee attackers for 12 Holy damage. (Protection signature)',
  'entities.abilities.repentance.name': 'Repentance',
  'entities.abilities.repentance.description':
    'Puts the enemy in a state of meditation for up to 6 sec. Any damage breaks the effect. (Retribution signature)',
  'entities.abilities.bestial_wrath.name': 'Bestial Wrath',
  'entities.abilities.bestial_wrath.description':
    'Sends you into a bestial rage, increasing attack power by 55 for 15 sec. (Beast Mastery signature)',
  'entities.abilities.trueshot_aura.name': 'Trueshot Aura',
  'entities.abilities.trueshot_aura.description':
    'Inspires nearby allies, increasing attack power by 35 for 5 min. (Marksmanship signature)',
  'entities.abilities.wyvern_sting.name': 'Wyvern Sting',
  'entities.abilities.wyvern_sting.description':
    'Stings the enemy from range, incapacitating it for up to 4 sec. Any damage breaks the effect. (Survival signature)',
  'entities.abilities.arcane_power.name': 'Arcane Power',
  'entities.abilities.arcane_power.description':
    'Fills you with arcane power, increasing spell power by 28 for 12 sec. (Arcane signature)',
  'entities.abilities.combustion.name': 'Combustion',
  'entities.abilities.combustion.description':
    'Focuses your fire magic so your next attack is a critical strike. (Fire signature)',
  'entities.abilities.cone_of_cold.name': 'Cone of Cold',
  'entities.abilities.cone_of_cold.description':
    'Blasts nearby enemies with frost for {damage} Frost damage. (Frost signature)',
  'entities.abilities.cold_blood.name': 'Cold Blood',
  'entities.abilities.cold_blood.description':
    'Focuses your killing intent so your next attack is a critical strike. (Assassination signature)',
  'entities.abilities.blade_flurry.name': 'Blade Flurry',
  'entities.abilities.blade_flurry.description':
    'Unleashes a flurry of blades, increasing attack speed by 20% for 12 sec. (Combat signature)',
  'entities.abilities.hemorrhage.name': 'Hemorrhage',
  'entities.abilities.hemorrhage.description':
    'Strikes the enemy for weapon damage plus {damage} and causes bleeding damage over 12 sec. Awards 1 combo point. (Subtlety signature)',
  'entities.abilities.power_infusion.name': 'Power Infusion',
  'entities.abilities.power_infusion.description':
    'Infuses a friendly target with power, increasing spell power by 28 for 15 sec. (Discipline signature)',
  'entities.abilities.holy_nova.name': 'Holy Nova',
  'entities.abilities.holy_nova.description':
    'Causes an explosion of Holy light, healing nearby allies for {damage} and damaging nearby enemies. (Holy signature)',
  'entities.abilities.shadowform.name': 'Shadowform',
  'entities.abilities.shadowform.description':
    'Assume a Shadowform, empowering shadow magic until you shift back. Cast again to return to normal form. (Shadow signature)',
  'entities.abilities.elemental_mastery.name': 'Elemental Mastery',
  'entities.abilities.elemental_mastery.description':
    'Calls on elemental mastery, making your next spell instant. (Elemental signature)',
  'entities.abilities.shamanistic_rage.name': 'Shamanistic Rage',
  'entities.abilities.shamanistic_rage.description':
    'Releases shamanistic rage, restoring 160 mana. (Enhancement signature)',
  'entities.abilities.natures_swiftness.name': "Nature's Swiftness",
  'entities.abilities.natures_swiftness.description':
    'Calls on nature to make your next spell instant. (Restoration signature)',
  'entities.abilities.siphon_life.name': 'Siphon Life',
  'entities.abilities.siphon_life.description':
    'Siphons life from the enemy, causing {damage} Shadow damage over 30 sec and healing you for the damage done. (Affliction signature)',
  'entities.abilities.fel_domination.name': 'Fel Domination',
  'entities.abilities.fel_domination.description':
    'Dominates fel energies, making your next spell instant. (Demonology signature)',
  'entities.abilities.conflagrate.name': 'Conflagrate',
  'entities.abilities.conflagrate.description':
    'Consumes your Immolate on the enemy to ignite them for {damage} Fire damage. (Destruction signature)',
  'entities.abilities.moonkin_form.name': 'Moonkin Form',
  'entities.abilities.moonkin_form.description':
    'Assume Moonkin Form, empowering spellcasting until you shift back. Cast again to return to normal form. (Balance signature)',
  'entities.abilities.feral_charge.name': 'Feral Charge',
  'entities.abilities.feral_charge.description':
    'Charge an enemy and root it for 1 sec. 8-25 yd range. (Feral signature)',
  'entities.abilities.swiftmend.name': 'Swiftmend',
  'entities.abilities.swiftmend.description':
    'Consumes a heal-over-time effect on a friendly target to heal them for {damage}. (Restoration signature)',
  'entities.abilities.rebuke.name': 'Rebuke',
  'entities.abilities.rebuke.description':
    'Interrupts spellcasting and prevents any spell in that school from being cast for 4 sec. (Paladin talent)',
  'entities.abilities.crusader_strike.name': 'Crusader Strike',
  'entities.abilities.crusader_strike.description':
    'Strikes the target for weapon damage plus {damage} Holy damage. (Paladin talent)',
  'entities.abilities.holy_wrath.name': 'Holy Wrath',
  'entities.abilities.holy_wrath.description':
    'Unleashes holy power, damaging nearby enemies for {damage}. (Paladin talent)',
  'entities.abilities.divine_shield.name': 'Divine Shield',
  'entities.abilities.divine_shield.description':
    'Shields you with holy power, absorbing a massive amount of damage for 8 sec. (Paladin talent)',
  'entities.abilities.avenging_wrath.name': 'Avenging Wrath',
  'entities.abilities.avenging_wrath.description':
    'Calls down avenging power, increasing attack power and spell power for 20 sec. (Paladin talent)',
  'entities.abilities.hammer_of_wrath.name': 'Hammer of Wrath',
  'entities.abilities.hammer_of_wrath.description':
    'Hurls a holy hammer at a wounded enemy for {damage} Holy damage. Only usable below 20% health. (Paladin talent)',
  'entities.abilities.counter_shot.name': 'Counter Shot',
  'entities.abilities.counter_shot.description':
    'Interrupts spellcasting and prevents any spell in that school from being cast for 4 sec. (Hunter talent)',
  'entities.abilities.frost_trap.name': 'Frost Trap',
  'entities.abilities.frost_trap.description':
    'Freezes enemies at the target area in place for 3 sec. (Hunter talent)',
  'entities.abilities.mend_pet.name': 'Mend Pet',
  'entities.abilities.mend_pet.description':
    'Heals a friendly target for {damage} over 15 sec. (Hunter talent)',
  'entities.abilities.multi_shot.name': 'Multi-Shot',
  'entities.abilities.multi_shot.description':
    'Fires several missiles, striking nearby enemies for {damage}. (Hunter talent)',
  'entities.abilities.deterrence.name': 'Deterrence',
  'entities.abilities.deterrence.description':
    'Increases your dodge chance by 50% for 10 sec. (Hunter talent)',
  'entities.abilities.aspect_of_the_wild.name': 'Aspect of the Wild',
  'entities.abilities.aspect_of_the_wild.description':
    'Inspires nearby allies with wild strength, increasing attack power for 5 min. (Hunter talent)',
  'entities.abilities.kick.name': 'Kick',
  'entities.abilities.kick.description':
    'Interrupts spellcasting and prevents any spell in that school from being cast for 4 sec. (Rogue talent)',
  'entities.abilities.preparation.name': 'Preparation',
  'entities.abilities.preparation.description':
    'Finishes the cooldown on Sprint, Evasion, and Vanish. (Rogue talent)',
  'entities.abilities.ghostly_strike.name': 'Ghostly Strike',
  'entities.abilities.ghostly_strike.description':
    'Strikes the enemy for weapon damage plus {damage} and briefly increases dodge. Awards 1 combo point. (Rogue talent)',
  'entities.abilities.cloak_of_shadows.name': 'Cloak of Shadows',
  'entities.abilities.cloak_of_shadows.description':
    'Wraps you in shadows, absorbing damage for 5 sec. (Rogue talent)',
  'entities.abilities.shadowstep.name': 'Shadowstep',
  'entities.abilities.shadowstep.description':
    'Steps through the shadows toward your target. (Rogue talent)',
  'entities.abilities.silence.name': 'Silence',
  'entities.abilities.silence.description': 'Silences the target for 4 sec. (Priest talent)',
  'entities.abilities.psychic_scream.name': 'Psychic Scream',
  'entities.abilities.psychic_scream.description':
    'Frightens nearby enemies for up to 4 sec. Damage may break the effect. (Priest talent)',
  'entities.abilities.inner_focus.name': 'Inner Focus',
  'entities.abilities.inner_focus.description':
    'Makes your next spell free. Lasts 60 sec. (Priest talent)',
  'entities.abilities.desperate_prayer.name': 'Desperate Prayer',
  'entities.abilities.desperate_prayer.description':
    'Instantly heals you for {damage}. (Priest talent)',
  'entities.abilities.prayer_of_healing.name': 'Prayer of Healing',
  'entities.abilities.prayer_of_healing.description':
    'Heals nearby allies for {damage}. (Priest talent)',
  'entities.abilities.mind_sear.name': 'Mind Sear',
  'entities.abilities.mind_sear.description':
    'Channels shadow energy at the target area, damaging nearby enemies each second for {damage}. (Priest talent)',
  'entities.abilities.earthbind.name': 'Earthbind',
  'entities.abilities.earthbind.description':
    'Binds nearby enemies to the earth, rooting them for 2 sec. (Shaman talent)',
  'entities.abilities.healing_stream.name': 'Healing Stream',
  'entities.abilities.healing_stream.description':
    'Restores a friendly target over 12 sec. (Shaman talent)',
  'entities.abilities.chain_lightning.name': 'Chain Lightning',
  'entities.abilities.chain_lightning.description':
    'Hurls lightning at the target area, damaging nearby enemies for {damage}. (Shaman talent)',
  'entities.abilities.bloodlust.name': 'Bloodlust',
  'entities.abilities.bloodlust.description':
    'Whips nearby allies into a frenzy, increasing attack speed for 15 sec. (Shaman talent)',
  'entities.abilities.spell_lock.name': 'Spell Lock',
  'entities.abilities.spell_lock.description':
    'Interrupts spellcasting and prevents any spell in that school from being cast for 5 sec. (Warlock talent)',
  'entities.abilities.howl_of_terror.name': 'Howl of Terror',
  'entities.abilities.howl_of_terror.description':
    'Frightens nearby enemies for up to 3 sec. Damage may break the effect. (Warlock talent)',
  'entities.abilities.curse_of_exhaustion.name': 'Curse of Exhaustion',
  'entities.abilities.curse_of_exhaustion.description':
    'Curses the target, slowing movement by 30% for 12 sec. (Warlock talent)',
  'entities.abilities.death_coil.name': 'Death Coil',
  'entities.abilities.death_coil.description':
    'Blasts the enemy for {damage} Shadow damage, then horrifies them for 3 sec. This version does not heal the caster. (Warlock talent)',
  'entities.abilities.chaos_bolt.name': 'Chaos Bolt',
  'entities.abilities.chaos_bolt.description':
    'Hurls a bolt of chaotic fire for {damage} Fire damage. (Warlock talent)',
  'entities.abilities.metamorphosis.name': 'Metamorphosis',
  'entities.abilities.metamorphosis.description':
    'Assume demonic power, increasing armor and attack power for 20 sec. (Warlock talent)',
  'entities.abilities.skull_bash.name': 'Skull Bash',
  'entities.abilities.skull_bash.description':
    'Interrupts spellcasting and prevents any spell in that school from being cast for 4 sec. (Druid talent)',
  'entities.abilities.innervate.name': 'Innervate',
  'entities.abilities.innervate.description':
    'Instantly restores 200 of your current resource. (Druid talent)',
  'entities.abilities.frenzied_regeneration.name': 'Frenzied Regeneration',
  'entities.abilities.frenzied_regeneration.description':
    'Regenerates health over 10 sec. Bear Form only. (Druid talent)',
  'entities.abilities.berserk.name': 'Berserk',
  'entities.abilities.berserk.description':
    'Increases attack power for 15 sec. (Druid talent)',
  'entities.abilities.tranquility.name': 'Tranquility',
  'entities.abilities.tranquility.description':
    'Channels restorative energy, healing nearby allies each second. (Druid talent)',
};
