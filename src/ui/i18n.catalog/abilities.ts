// i18n source catalog - Abilities + class ability names (English values).
// Part of src/ui/i18n.catalog/; assembled into `en` by ./index.ts.
// Translations live in src/ui/i18n.locales/<lang>.ts, never here.

const abilityStringsEn = {
  abilityUi: {
    actionBar: {
      attackName: 'Attack',
      attackTooltip: 'Toggle auto-attack on your target. Right-clicking an enemy also attacks.',
      // Shown under the Attack tooltip: right-click removes the button from the bar,
      // freeing the slot (and its key) for a normal action. Restored in Options.
      attackRemoveHint: 'Right-click to remove it from the bar and free the slot.',
      emptySlot: 'Empty slot',
      slotAria: 'Action slot {slot}: {ability}',
      emptySlotAria: 'Action slot {slot}: empty',
    },
    spellbook: {
      title: 'Spellbook',
      classSubtitle: '{className} abilities',
      close: 'Close spellbook',
      resetBar: 'Reset bar',
      resetBarAria: 'Reset the current action bar to its default abilities',
      trainableAtLevel: 'Trainable at level {level}',
      learnAtLevel: 'You will learn this at level {level}.',
      knownAbilityAria: '{name}, rank {rank}. {summary}',
      unlearnedAbilityAria: '{name}. Learn at level {level}.',
      empty: 'No abilities available.',
    },
    tooltip: {
      rank: 'Rank {rank}',
      cost: '{cost} {resource}',
      ruinCost: '{cost} Wrack',
      range: '{range} yd range',
      rangeWithMin: '{min}-{max} yd range',
      instant: 'Instant',
      castSeconds: '{seconds} sec cast',
      channeledSeconds: 'Channeled ({seconds} sec)',
      cooldownSeconds: '{seconds} sec cooldown',
      passive: 'Passive',
      unavailable: 'Unavailable',
      requiresLevel: 'Requires level {level}',
      requiresForm: 'Requires {form} Form',
      requiresStealth: 'Requires stealth',
      requiresStealthSkulduggery:
        'Requires stealth (not needed at 3 Gloam or during the Shadow Veil)',
      requiresCombo: 'Consumes combo points',
      requiresTargetHealthBelow: 'Requires target below {percent}% health',
      requiresDodge: 'Only usable after the target dodges',
      requiresOutOfCombat: 'Requires being out of combat',
      onNextSwing: 'Activates on your next swing',
      offGlobalCooldown: 'Off the global cooldown',
      friendlyTarget: 'Friendly target',
      enemyTarget: 'Enemy target',
      // targetType 'any': the cast works on an enemy or an ally (Shadeslip).
      anyTarget: 'Enemy or friendly target',
      selfOnly: 'Self only',
      damageRange: '{min} to {max}',
      finisherDamage: '{base} plus {perCombo} per combo point',
    },
    resources: {
      mana: 'Mana',
      rage: 'Rage',
      energy: 'Energy',
      focus: 'Focus',
      devotion: 'Devotion',
    },
    forms: {
      bear: 'Bear',
      cat: 'Wolf',
    },
  },
};

// English only. The inline non-English arms this object and classAbilityNames
// below used to carry were legacy (pre-i18n.locales split) and unread at runtime:
// the build resolves every non-English value from src/ui/i18n.locales/<lang>.ts,
// and index.ts reads the `.en` arm alone. Having sat outside the overlay layer
// through several rename waves they had drifted to roughly 143 stale ability
// renderings per non-Latin locale, so they were deleted rather than refreshed.
// A translation is edited in the overlay, never here.
export const abilityStrings = {
  en: abilityStringsEn,
};

type AbilityEntityTranslation = {
  name: string;
  description: string;
  // Talent-conditional description shown when a talent has retired a stated
  // requirement (Cheap Trick lifting Gut Punch's stealth gate). UI-layer only,
  // resolved by tEntity when the resolved ability drops the requirement.
  descriptionNoStealth?: string;
} & Partial<Record<`specNote_${string}`, string>>;

type AbilityEntityTranslations = Record<string, AbilityEntityTranslation>;

// Labelled tuple: the two optional tails are positional, so an entry that wants
// descriptionNoStealth WITHOUT spec notes passes `undefined` for specNotes. The
// labels are what make that call site readable (and what tsc echoes on a wrong
// argument) instead of a bare trailing string nobody can identify.
type AbilityTranslationEntry = readonly [
  id: string,
  name: string,
  description: string,
  specNotes?: Record<string, string>,
  descriptionNoStealth?: string,
];

function abilityTranslations(
  entries: readonly AbilityTranslationEntry[],
): AbilityEntityTranslations {
  const translations: AbilityEntityTranslations = {};
  for (const [id, name, description, specNotes, descriptionNoStealth] of entries) {
    const row: AbilityEntityTranslation = { name, description };
    if (descriptionNoStealth) row.descriptionNoStealth = descriptionNoStealth;
    for (const [spec, note] of Object.entries(specNotes ?? {})) {
      row[`specNote_${spec}`] = note;
    }
    translations[id] = row;
  }
  return translations;
}

const classAbilityNamesEn = {
  entities: {
    abilities: abilityTranslations([
      // The Vale Cup sport kit (docs/prd/vale-cup.md).
      ['sport_kick', 'Kick', 'Knock the ball along the ground toward the aim point.'],
      [
        'sport_shoot',
        'Shoot',
        'Hold to build power, release to shoot at goal. Too much power sails over.',
      ],
      ['sport_pass', 'Pass', 'Roll a firm pass to your targeted teammate, leading their run.'],
      ['sport_boot', 'Big Boot', 'A long lofted boot toward the aim point. The crowd loves it.'],
      ['sport_hoof', 'Hoof It', 'Hammer the ball low and hard up the field.'],
      ['sport_punt', 'Long Punt', "A keeper's punt, high and far."],
      ['sport_feint', 'Feint', 'A quick sidestep burst toward the aim point.'],
      ['sport_dive', 'Dive', 'Fling yourself toward the aim point. A crossing ball sticks to you.'],
      [
        'sport_shoulder',
        'Shoulder',
        'A fair harvest-truce shoulder. Sends them tumbling off the ball.',
      ],
      ['sport_second_wind', 'Fresh Legs', 'Find your legs: move 50% faster for 4 sec.'],
      [
        'flamestrike',
        'Flamestrike',
        'Calls down a burst of flame at the target area, dealing {damage} Fire damage to enemies caught in the blast.',
      ],
      [
        'rain_of_fire',
        'Rain of Fire',
        'Spends 3 Wrack to rain fire over the target area for {damage} Fire damage each second for 4 sec, increasing to 6 sec at rank 2. Desolation calls down the first wave immediately.',
      ],
      [
        'volley',
        'Volley',
        'Rain arrows over an 8-yard area for 3 sec. Enemies in the area take {damage} Physical damage every 0.5 sec. Damage increases with Ranged Attack Power.',
      ],
      [
        'pack_command',
        'Pack Command',
        "Command your living pet to strike for 36 to 48 Physical damage. Damage increases with the pet's Attack Power. A hit restores 20 Focus and grants 1 Pack Ferocity for 30 sec, up to 3. Each stack increases all damage dealt by your pet by 10%. This strike uses the stacks you had before the hit.",
      ],
      [
        'stampede',
        'Stampede',
        'Summon 3 beasts for 12 sec. Each attacks every 2 sec for {damage} Physical damage. The shown damage includes 8% of your Ranged Attack Power before pet damage bonuses. The beasts snapshot Pack Ferocity when summoned, gaining 10% damage per stack. While Stampede is on cooldown, successful Pack Commands have a 20% chance to reset it, guaranteed after 5 failed chances. It cannot reset while the beasts are active. (Packlord)',
      ],
      [
        'unleash_beast',
        'Unleash Beast',
        "Consume 3 Pack Ferocity after your pet strikes for 42 to 53 Physical damage and claps every enemy within 6 yards for 57 to 75. The clap deals 50% more damage to enemies other than the main target. The strike and clap use Pack Ferocity's full 30% pet damage bonus and increase with the pet's Attack Power. For 8 sec afterward, the pet deals 25% more damage, attacks 35% faster, and makes Fell Shot cleave up to 2 enemies within 5 yards of the target.",
      ],
      [
        'measured_shot',
        'Measured Shot',
        'Shoot the target for {damage} Physical damage. A hit restores 20 Focus. Damage increases with Ranged Attack Power.',
      ],
      [
        'cold_focus',
        'Cold Focus',
        // Absolute, not "50% more": the Coldsight 2pc adds a flat 5 after the
        // window rewrite (25 -> 35 for wearers is not 50 percent), so only the
        // absolute base value composes honestly with the set tooltip.
        'For 12 sec, Measured Shot restores 30 Focus, and Long Draw costs 25% less and casts 30% faster. (Coldsight signature)',
      ],
      [
        'bloodhook',
        'Bloodhook',
        'Charge to an enemy and apply Bloodhook Wound, dealing 34 base Physical damage plus 26% of your Ranged Attack Power over 12 sec in 4 ticks. (Fieldcraft signature)',
      ],
      [
        'shrapnel_charge',
        'Shrapnel Charge',
        'Hit the target for 24 to 30 Physical damage and up to 4 other enemies within 6 yards for 13 to 17. Other targets also bleed for 12 damage over 6 sec. If the main target has your Bloodhook Wound, deal 1 wound tick immediately. Direct damage increases with Ranged Attack Power.',
      ],
      [
        'bloodtrail_assault',
        'Bloodtrail Assault',
        'For 12 sec, Bloodhook spreads a 60%-strength wound to up to 2 enemies within 5 yards, Woundrend commands an 18-damage pet attack, and Shrapnel Charge gains 2 yards of radius, deals 25% more base damage to its main target, and triggers 50% more wound damage.',
      ],
      [
        'trailbreak',
        'Trailbreak',
        'Leap 12 yards backward. If you have Hunting Momentum, refresh it and arm Re-entry for 12 sec.',
      ],
      ['wildheart', 'Wildheart', 'Immediately restore 30% of your maximum health.'],
      [
        'shellskin',
        'Shellskin',
        'Reduce damage taken by 60% for 8 sec, but prevent attacks while active.',
      ],
      [
        'frostjaw_trap',
        'Frostjaw Trap',
        'Place a trap at the selected enemy or at your feet. It arms after 0.75 sec and lasts 30 sec. The first enemy to trigger it is rooted for 3 sec, and enemies within 4 yards are slowed by 50% for 4 sec.',
      ],
      [
        'pack_rally',
        'Pack Rally',
        "Adopt Courser's Guise. You, your companion, and group or raid allies within 30 yards gain 30% movement speed and 10% attack, casting, and channeling speed for 10 sec.",
      ],
      [
        'hurricane',
        'Galeheart',
        'Calls a hurricane onto the target area for 6 sec, battering enemies for {damage} Nature damage each second.',
      ],
      [
        'earthquake',
        'Faultwake',
        'Shake an 8-yard area for 6 sec, dealing {damage} Nature damage every 1.5 sec. Damage increases with Spell Power. Thundercall: at 5 Thunder, deal 100% more damage and consume all Thunder.',
      ],
      [
        'heroic_strike',
        'Reaver Strike',
        'A strong attack that increases melee damage by {damage}. Activates on your next swing.',
      ],
      [
        'battle_shout',
        'Iron Bellow',
        'A shout that increases the attack power of all party members by {buff}% for 30 min.',
      ],
      [
        'demoralizing_shout',
        'Direhowl',
        'Lets out a fearsome shout, reducing the damage dealt by all nearby enemies by {buff}% for 20 sec.',
      ],
      [
        'charge',
        'Onrush',
        'Rushes an enemy, generating 9 rage and stunning it for 1 sec. 8-25 yd range.',
      ],
      [
        'thunder_clap',
        'Quaking Blow',
        'Blasts nearby enemies for {damage} damage and slows their attacks by 10% for 10 sec.',
      ],
      [
        'hamstring',
        'Hobbling Cut',
        'Maims the enemy for {damage} damage, slowing its movement by 50% for 15 sec.',
      ],
      ['bloodrage', 'Blood Toll', 'Generates 10 rage at the cost of health.'],
      [
        'overpower',
        'Redhand',
        'Instant attack for weapon damage plus {damage}. Only usable after the target dodges. Cannot be dodged.',
      ],
      [
        'execute',
        'Early Grave',
        'Attempt to finish off a wounded foe, causing {damage} damage. Only usable on enemies below 20% health.',
      ],
      ['slam', 'Brute Swing', 'Slams the opponent for weapon damage plus {damage}.'],
      [
        'cleave',
        'Reaping Arc',
        'A sweeping strike that hits all enemies in front of you for {damage} damage.',
      ],
      [
        'defensive_stance',
        'Guarded Stance',
        'A defensive combat stance: you generate 30% more threat but deal and take 10% less damage. Cast again to leave the stance.',
      ],
      [
        'sunder_armor',
        'Armor Shear',
        "Sunders the target's armor, reducing it by {damage}% per application. Stacks up to 5 times. Generates a high amount of threat.",
      ],
      [
        'taunt',
        'Goad',
        'Goads the target: your threat rises to match its most hated enemy and it is compelled to attack you for 3 sec.',
      ],
      [
        'fireball',
        'Cinderbolt',
        'Hurls a fiery ball that causes {damage} Fire damage plus additional damage over time.',
      ],
      [
        'fireball_form',
        'Ember Form',
        'Transform into a blazing ember, increasing movement speed by {buff}%. You cannot attack or cast spells while transformed. Recast to return to your normal form.',
      ],
      [
        'frost_armor',
        'Hoarfrost Mantle',
        'Encases you in frost, increasing armor by {buff} for 30 min.',
      ],
      [
        'arcane_intellect',
        'Aether Insight',
        'Increases the Intellect of all party members by {buff}% for 30 min.',
      ],
      [
        'frostbolt',
        'Rimelance',
        'Launches a bolt of frost, causing {damage} Frost damage and slowing movement by 40%.',
      ],
      [
        'blazing_barrier',
        'Blazing Barrier',
        'Wreathe yourself in flame, absorbing {damage} damage for 60 sec. (Fire)',
      ],
      [
        'cold_snap',
        "Winter's Recall",
        'Finishes the cooldown on Flitstep, Frostveil, and Greater Invisibility. (Mage talent)',
      ],
      [
        'greater_invisibility',
        'Greater Invisibility',
        'Vanish for 20 sec and remove 2 damage-over-time effects. When the invisibility ends, take 90% less damage for 2 sec. (Mage talent)',
      ],
      [
        'hot_streak',
        'Hot Streak',
        'Passive: two critical strikes in a row with your Fire spells (Cinderbolt, Cinderfall, Scald, Pyrelance or Flamestrike) make your next Pyrelance or Flamestrike instant and free. The spenders count toward the NEXT streak, free casts included; a Flamestrike counts once however many enemies it strikes, and only the initial impact ever counts. (Fire)',
      ],
      [
        'ice_floes',
        'Ice Floes',
        'Your next two spells with a cast time can be cast while moving. Lasts 15 sec. (Mage talent)',
      ],
      [
        'ignition',
        'Ignition',
        'Passive: your spell critical strikes burn the target for 30% of the damage dealt over 6 sec, stacking. (Fire mastery)',
      ],
      [
        'mass_barrier',
        'Mass Barrier',
        'Shields you and up to 4 nearby allies within 30 yd, each absorbing 130 damage for 60 sec. (Mage talent)',
      ],
      [
        'overload',
        'Overload',
        'Your next spell is amplified by 40% but costs 50% more mana. Lasts 10 sec. (Mage talent)',
      ],
      [
        'power_echo',
        'Power Echo',
        'Your next direct spell repeats at 50% power on the same target. Lasts 10 sec. (Mage talent)',
      ],
      [
        'rings_of_frost',
        'Ring of Frost',
        'Summons a ring for 10 sec. Enemies crossing its perimeter are frozen for 4 sec. (Mage talent)',
      ],
      [
        'rune_of_power',
        'Rune of Power',
        'Inscribe a rune of power at your feet for 15 sec: allies standing within 8 yd deal 10% more damage. (Mage talent)',
      ],
      [
        'summon_water_elemental',
        'Summon Water Elemental',
        'Summon a Water Elemental to fight beside you, hurling Waterbolts at your target and channeling Water Jet. (Frost)',
      ],
      [
        'ice_lance',
        'Ice Lance',
        "Hurl a shard of ice, dealing {damage} Frost damage, tripled against a frozen target. Spends Fingers of Frost, or a charge of Winter's Chill, to treat the target as frozen. (Frost)",
      ],
      [
        'flurry',
        'Winterlash',
        "Loose three icy bolts for {damage} Frost damage each and plant Winter's Chill on the target: its next 2 incoming compatible spells treat it as frozen. Brain Freeze makes Winterlash instant and skips its cooldown. (Frost)",
      ],
      [
        'frozen_orb',
        'Frostglobe',
        'Release an orb of swirling frost that drifts forward for 8 sec, dealing {damage} Frost damage each second to nearby enemies and slowing them by 30%. Each striking pulse generates one Icicle. (Frost)',
      ],
      [
        'blizzard',
        'Blizzard',
        'Calls an ice storm onto the target area for 6 sec, dealing {damage} Frost damage each second and slowing enemies by 40%. Each enemy struck shaves 0.5 sec off Frostglobe, up to 3 sec per cast. (Frost)',
      ],
      [
        'glacial_spike',
        'Rimeneedle',
        'Conjure a massive spike of ice, consuming 5 Icicles to deal {damage} Frost damage and freeze the target in place for 4 sec. (Frost)',
      ],
      [
        'glacial_front',
        'Glacial Front',
        'Hold to gather a widening front of frost, then release it in a cone. Longer charges reach farther and deal more damage. All enemies hit are slowed by 50% for 4 sec; maximum charge also roots them for 1 sec. (Frost)',
      ],
      [
        'dragons_breath',
        "Dragon's Breath",
        'Hold to gather a widening breath of flame, then release it in a cone. Longer charges reach farther and deal more damage. Enemies hit are disoriented and damage breaks the effect; maximum charge always critically strikes and counts once toward Hot Streak. (Fire)',
      ],
      [
        'fingers_of_frost',
        'Fingers of Frost',
        'Rimelance has a 15% chance to grant Fingers of Frost, up to 2 charges: your next Ice Lance treats its target as frozen. (Frost)',
      ],
      [
        'brain_freeze',
        'Brain Freeze',
        'Rimelance has a 20% chance to make your next Winterlash instant and free of its cooldown. (Frost)',
      ],
      [
        'shatter',
        'Brittle Ruin',
        "Your spells gain 50% critical strike chance against frozen targets. Fingers of Frost and Winter's Chill count as frozen. (Frost)",
      ],
      [
        'conjure_water',
        'Waterbind',
        'Conjures 2 bottles of water, restoring mana when drunk. Higher ranks conjure purer water.',
      ],
      [
        'conjure_food',
        'Breadbind',
        'Conjures 2 servings of bread, restoring health when eaten. Higher ranks conjure heartier fare.',
      ],
      ['fire_blast', 'Cinderfall', 'Blasts the enemy for {damage} Fire damage. Instant.'],
      [
        'arcane_missiles',
        'Aether Darts',
        'Launches Aether Darts at the enemy, causing {damage} Arcane damage each second for 3 sec.',
      ],
      [
        'polymorph',
        'Bewitch',
        'Transforms the enemy into a toad for up to {duration} sec. The toad wanders and heals rapidly. Any damage breaks the effect. Beasts and humanoids only.',
      ],
      [
        'frost_nova',
        'Icebind',
        "Freezes all nearby enemies in place for up to 8 sec, dealing {damage} Frost damage. The root breaks after cumulative damage equal to 15% of the target's maximum health, with a minimum of 20 and a maximum of 60 damage.",
      ],
      [
        'arcane_explosion',
        'Aetherburst',
        'A burst of Arcane energy hits all nearby enemies for {damage} Arcane damage.',
      ],
      ['scorch', 'Scald', 'Scalds the enemy for {damage} Fire damage. Quick to cast.'],
      [
        'pyroblast',
        'Pyrelance',
        'Hurls an immense fiery boulder that causes {damage} Fire damage plus additional damage over time.',
      ],
      ['ice_barrier', 'Frostveil', 'Shields you in ice, absorbing {damage} damage for 60 sec.'],
      [
        'sinister_strike',
        'Wicked Slash',
        'An instant strike for weapon damage plus {damage}. Awards 1 combo point.',
        {
          assassination: 'Adds 1 Venom Ritual (max 6).',
          combat:
            'While Redline is active, this button becomes Haymaker: 130% weapon damage plus 10, awards 2 combo points, and adds 1 Redline (max 4).',
        },
      ],
      [
        'eviscerate',
        'Dirt Nap',
        'Finishing move that causes {damage}.',
        {
          assassination:
            'At 6 Venom Ritual, this button becomes Venomrend: a strike that instantly deals all the damage your bleeds would still have dealt, plants a fresh venom wound, and restores 20 energy.',
          combat:
            'Landing this with 4 or more combo points starts Redline for 8 sec: Wicked Slash becomes Haymaker and this button becomes Lights Out (45 plus 35 per combo point, hitting 25% harder for each Redline built, restores 25 energy). Spend it before Redline ends.',
        },
      ],
      [
        'backstab',
        'Craven Thrust',
        "Drive your dagger into the target's back for 150% weapon damage plus {damage}. Must be behind the target. Requires a dagger. Awards 1 combo point.",
        {
          assassination:
            'Each strike adds 1 Venom Ritual (max 6) and refunds 15 energy. At 6 Venom Ritual, Dirt Nap becomes Venomrend (it deals all your remaining bleed damage at once).',
        },
      ],
      [
        'gouge',
        'Eye Jab',
        'Strikes the target for {damage} damage, incapacitating it for 4 sec. Any damage breaks the effect. Awards 1 combo point.',
      ],
      ['evasion', 'Ghostfoot', 'Increases your dodge chance by 50% for 15 sec.'],
      [
        'slice_and_dice',
        'Cutthroat Tempo',
        'Finishing move that increases melee attack speed by 30% for 12 sec plus 4 sec per combo point (5 combo points: 32 sec).',
      ],
      ['sprint', 'Swift Heels', 'Increases your movement speed by 70% for 15 sec.'],
      [
        'kidney_shot',
        'Low Blow',
        'Finishing move that stuns the target for 1 sec plus 1 sec per combo point (5 combo points: 6 sec).',
      ],
      [
        'ambush',
        "Lurker's Strike",
        'Strike from the shadows for 250% weapon damage plus {damage}. Must be stealthed and behind the target. Requires a dagger. Awards 1 combo point.',
        {
          subtlety:
            'Used from Duskveil this adds 1 Gloam (max 3). At 3 Gloam you can use it WITHOUT stealth and from any angle: that use costs nothing, spends all 3 Gloam, starts the 6 sec Shadow Veil, and hits for double.',
        },
      ],
      [
        'stealth',
        'Duskveil',
        'Conceals you in the shadows: enemies barely notice you, but you move 50% slower. Attacking or taking damage breaks Duskveil. Cast again to step out.',
        { subtlety: 'Each opener you use from Duskveil adds 1 Gloam (max 3).' },
      ],
      ['adrenaline_rush', 'Quickened Blood', 'Your blood runs hot, instantly restoring 60 energy.'],
      [
        'garrote',
        'Throat Wire',
        "Loop a wire around the enemy's throat, causing {damage} damage now and bleeding it for {overTime} over 18 sec. Must be stealthed. Awards 1 combo point.",
        {
          subtlety:
            'Used from Duskveil this adds 1 Gloam (max 3). At 3 Gloam you can use it WITHOUT stealth: that use costs nothing, spends all 3 Gloam, and starts the 6 sec Shadow Veil.',
        },
      ],
      [
        'cheap_shot',
        'Gut Punch',
        'Strike the target for {damage} damage, stunning it for 4 sec. Must be stealthed. Awards 2 combo points.',
        {
          subtlety:
            'Used from Duskveil this adds 1 Gloam (max 3). At 3 Gloam you can use it WITHOUT stealth: that use costs nothing, spends all 3 Gloam, and starts the 6 sec Shadow Veil.',
        },
        // Shown when Cheap Trick has retired the stealth requirement: same prose
        // with the "Must be stealthed." sentence dropped, so the tooltip no longer
        // contradicts the requirement line.
        'Strike the target for {damage} damage, stunning it for 4 sec. Awards 2 combo points.',
      ],
      [
        'sap',
        'Sap',
        'Incapacitates the target for 8 sec without breaking Duskveil or starting a fight. Must be stealthed and out of combat. Any damage breaks the effect.',
      ],
      [
        'crippling_poison',
        'Leaden Venom',
        'Strikes the target with a leaden venom, dealing {damage} Nature damage and slowing its movement speed by 50% for 12 sec.',
      ],
      [
        'melting_acid',
        'Melting Acid',
        'Splashes the target with a caustic poison, dealing {damage} Nature damage and reducing its armor by 5% for 12 sec.',
      ],
      [
        'nightshade_coating',
        'Nightshade Coating',
        'Coats the target in nightshade, dealing {damage} Nature damage and reducing the healing it receives by 25% for 12 sec.',
      ],
      [
        'expose_armor',
        'Armor Breach',
        'Finishing move that exposes the target for 30 sec: each combo point spent reduces its armor by 2% (5 combo points: {damage}%).',
      ],
      [
        'rupture',
        'Bleed Out',
        'Finishing move that wounds the target: it bleeds every 2 sec, for 6 sec plus 2 sec per combo point (5 combo points: 16 sec and {damage} total damage).',
      ],
      [
        'vanish',
        'Smokefade',
        'Melt from sight, entering Duskveil even in combat. You move 50% slower while hidden. Lasts up to 10 sec.',
      ],
      [
        'instant_poison',
        "Adder's Bite",
        'Coats your weapon for 30 min, causing each of your melee swings to deal 8 additional Nature damage.',
      ],
      [
        'deadly_poison',
        'Festering Venom',
        'Coats your weapon for 30 min, causing each of your melee swings to deal 14 additional Nature damage.',
      ],
      [
        'blind',
        'Dirt Toss',
        "Tosses dirt into the target's eyes, causing it to wander disoriented for 8 sec. Any damage breaks the effect.",
      ],
      [
        'seal_of_righteousness',
        'Oathbrand',
        'Fills you with Holy power for 30 sec, causing each of your melee swings to deal {damage} additional Holy damage.',
      ],
      [
        'judgement',
        'Verdict',
        'Unleashes your active Seal upon the enemy, consuming it to deal its stored Holy damage.',
      ],
      [
        'holy_light',
        'Mending Light',
        'Quickly heals a friendly target for {damage}. Restoring health generates 1 Devotion, even without a specialization. Radiant Resonance or Solar Reprisal makes it instant.',
      ],
      [
        'divine_ascension',
        'Divine Ascension',
        'Consume 20 Devotion to gain 5 Ascension charges for up to 45 sec. Marked abilities consume one charge and gain an additional effect.',
      ],
      [
        'aura_mastery',
        'Sacred Concord',
        'For 8 sec, empower every active Devotion and Requital Aura in your group. Bastion Devotion reduces damage by 15%; Requital deals 15 Holy damage. Multiple uses refresh instead of stacking.',
      ],
      [
        'devotion_ward',
        'Bastion Devotion',
        'Reduce damage taken by you and party members by 5% until death or replacement. Replaces your own Requital Aura. Another Paladin casting Bastion Devotion refreshes it instead of stacking; Radiant, Dawn, and Grace Devotion coexist.',
      ],
      [
        'hammer_of_grace',
        'Hammer of Grace',
        'Instantly hurl a holy hammer at an enemy within 20 m for {damage}, restoring 70 mana, healing yourself for 50% of damage dealt, and generating 1 Devotion when it deals damage. Solar Reprisal lets Hammer of Grace ignore its cooldown and heal you for 100% of damage dealt.',
      ],
      [
        'hushbrand',
        'Hushbrand',
        'Interrupts spellcasting and prevents spells from that school for 4 sec.',
      ],
      [
        'guardian_covenant',
        'Guardian Covenant',
        'Protects a friendly target and yourself, reducing damage taken by 20% for 8 sec. Defaults to you when no friendly target is selected.',
      ],
      ['solar_step', 'Solar Step', 'Increase your movement speed by 150% for 2 sec.'],
      [
        'solar_invocation',
        'Solar Invocation',
        'Instantly heal an ally for {damage} or deal moderate Holy damage to an enemy. Either use generates 1 Devotion. During Ascension, a healing cast also heals allied players within 10 m of the target for half as much.',
      ],
      [
        'radiant_devotion',
        'Radiant Devotion',
        'Increase the spell power of you and party members by 20 for 30 min. Replaces your own Dawn or Grace Devotion. Another Paladin casting Radiant Devotion refreshes it instead of stacking; a different Devotion coexists.',
      ],
      [
        'dawn_devotion',
        'Dawn Devotion',
        'Increase the attack power of you and party members by 40 for 30 min. Replaces your own Radiant or Grace Devotion. Another Paladin casting Dawn Devotion refreshes it instead of stacking; a different Devotion, and Warrior shouts, coexist.',
      ],
      [
        'grace_devotion',
        'Grace Devotion',
        'You and party members restore 15 mana every 5 sec and pay 3% less mana for 30 min. Replaces your own Radiant or Dawn Devotion. Another Paladin casting Grace Devotion refreshes it instead of stacking; a different Devotion coexists.',
      ],
      [
        'recall_the_fallen',
        'Recall the Fallen',
        'Returns a dead group member to life at your side with 35% health and mana. A Sunmender of level 16 or higher instead calls back every fallen member of the group within 30 yards and in your line of sight.',
      ],
      [
        'beacon_of_light',
        'Beacon of Light',
        'Mark one group member as your Beacon of Light. 50% of your effective direct healing on another group member within 60 m also heals the Beacon. Area and periodic healing do not transfer. Lasts until either of you dies.',
      ],
      [
        'final_edict',
        'Final Edict',
        "Deliver a crushing weapon strike and generate 1 Devotion when it deals damage. A successful hit reduces Dawnfall's remaining cooldown by 2 sec. Successful auto-attacks and Final Edict hits have a 15% chance to grant Dawn's Wrath for 8 sec. Ascension also releases a Holy explosion around you.",
      ],
      [
        'dawnfall',
        'Dawnfall',
        "Deal {damage} Holy damage to nearby enemies and generate 1 Devotion. Hitting at least one enemy reduces Final Edict's remaining cooldown by 2 sec. Ascension increases its damage and radius.",
      ],
      [
        'sun_gods_verdict',
        'Verdict of the Sun God',
        'Judge an enemy beneath the Verdict of the Sun God for 30 sec. Final Edict and Dawnfall inscribe one charge on a successful hit. The ability that lands the third charge dictates the sentence: Final Edict unleashes devastating damage on the condemned; Dawnfall detonates the verdict, damaging and stunning nearby enemies for 1.5 sec.',
      ],
      [
        'valkyrs_calling',
        "Valkyr's Calling",
        'Ascend into the air, becoming immune to damage as you fly toward the enemy. After 2 sec, descend upon the target area for {damage} Holy damage and generate 1 Devotion. Ascension increases the impact damage by 50% and consumes 1 charge.',
      ],
      [
        'faithforged_guard',
        'Debt of Light',
        'For 8 sec, the next enemy hit against you is answered: up to {buff} damage is denied and returned to the attacker as Holy damage, and you gain 1 Devotion. Only one blow is answered. Ascension raises the amount it can answer by 50%.',
      ],
      [
        'mercy_lance',
        'Mercy Lance',
        'Deal {damage} Holy damage to an enemy and generate 1 Devotion when it deals damage. During Ascension, it consumes 1 charge to guarantee a critical hit.',
      ],
      [
        'sacred_form',
        'Sacred Form',
        'Enter a sacred state until death, increasing healing by 10%, spell critical chance by 5%, and reducing threat generated by 50%. Sunmender only.',
      ],
      [
        'dawns_embrace',
        "Dawn's Embrace",
        'Deliver a powerful heal and generate 1 Devotion. Radiant Resonance reduces its mana cost by 50% and cast time to 1.5 sec. Ascension makes it instant and increases its healing by 35%.',
      ],
      [
        'radiant_chorus',
        'Radiant Chorus',
        "Heal nearby allies for {damage} and generate 1 Devotion. Effectively healing at least 2 allies grants Radiant Resonance: your next Mending Light is instant, or your next Dawn's Embrace costs 50% less mana and casts in 1.5 sec. Ascension increases Radiant Chorus healing and radius.",
      ],
      [
        'life_covenant',
        'Life Covenant',
        "Reduce an ally's damage taken by 40% for 6 sec. During Ascension it also grants a 120-point shield without consuming a charge.",
      ],
      [
        'aegis_first_dawn',
        'Aegis of the First Dawn',
        'Channel for 5 sec, creating a 10 meter holy dome. Allies inside are healed every second and take 50% less damage. Completing the channel releases a final heal and grants 30% movement speed for 4 sec.',
      ],
      [
        'vowkeeper_strike',
        'Vowkeeper Strike',
        'Strike with high threat and generate 1 Devotion. A successful strike has a 20% chance to grant Solar Reprisal for 8 sec; each successful block has a 25% chance. Solar Reprisal empowers your next Sunward Disc, Hammer of Grace, or Mending Light. Ascension also grants a small absorption shield.',
      ],
      [
        'bastion_rite',
        'Bastion Rite',
        'Reduce physical damage taken by 20% and increase block chance by 20% for 6 sec. Ascension extends the duration to 10 sec.',
      ],
      [
        'sunward_disc',
        'Sunward Disc',
        'Requires a shield. Hurl a radiant disc that strikes and then bounces between nearby enemies. Each damaging impact generates 1 Devotion. Solar Reprisal makes Sunward Disc cost no mana, ignore its cooldown, and deal 20% more damage. Ascension empowers 5 bounces.',
      ],
      [
        'sacred_challenge',
        'Sacred Goad',
        'Compel an enemy to attack you. During Ascension it also reduces all damage received by 15% for 4 sec without consuming a charge.',
      ],
      [
        'devotion_aura',
        'Steadfast Aura',
        'Increases the armor of all party members by {buff}% for 30 min.',
      ],
      [
        'blessing_of_might',
        'Oath of Iron',
        'Blesses the party, increasing the attack power of all party members by {buff}% for 30 min.',
      ],
      [
        'divine_protection',
        'Ward of Faith',
        'A sacred ward absorbs {damage}% of your maximum health for {duration} sec. Enduring Protection increases the ward.',
      ],
      ['hammer_of_justice', 'Sundering Gavel', 'Stuns the target for {duration} sec.'],
      [
        'lay_on_hands',
        'Last Rite',
        'A massive surge that restores {damage}% of your maximum health and generates 1 Devotion when it restores health. 10 min cooldown.',
      ],
      [
        'holy_taunt',
        'Sacred Goad',
        'Goads the target: your threat rises to match its most hated enemy and it is compelled to attack you for 3 sec.',
      ],
      [
        'flash_of_light',
        'Lightmend',
        'A quick, efficient burst of Light that heals a friendly target for {damage}. Restoring health generates 1 Devotion, even without a specialization.',
      ],
      [
        'exorcism',
        'Rite of Expulsion',
        'Banishes the wicked with Holy wrath, causing {damage} Holy damage.',
      ],
      [
        'consecration',
        'Holy Ground',
        'Consecrate the ground beneath you for 9 sec, dealing {damage} Holy damage with high threat every second. The first impact generates 1 Devotion. Faithwardens take 10% less damage while standing inside. Ascension increases its damage.',
      ],
      [
        'bastion_sweep',
        'Bastion Sweep',
        'Sweep your equipped shield through enemies in a 180 degree frontal arc for {damage} Holy damage with high threat and generate 1 Devotion. Ascension increases damage by 30% and radius to 8 m.',
      ],
      [
        'oath_chain',
        'Oath Chain',
        'Instantly bind a distant enemy with a sacred chain. The enemy travels toward you at 18 m per second until it reaches 3 m, then is slowed by 50% for 4 sec. During Ascension it binds a second nearby enemy. Bosses cannot be pulled or slowed.',
      ],
      [
        'veilbound_march',
        'Veilbound March',
        'Become ethereal for 4 sec, gaining 40% movement speed and 30% armor and becoming immune to roots, slows, and displacement. Enemies you pass through are Veil Marked for 6 sec, taking Holy damage each second, dealing 20% less damage to you, and generating extra threat. The first mark grants 1 Devotion. When the march ends, nearby marked enemies take a final burst. Ascension increases the burst by 50% and lightly pulls them toward you.',
      ],
      [
        'veilbound_mark',
        'Veil Mark',
        'Takes Holy damage each second, deals 20% less damage to the Paladin who applied the mark, and generates additional threat toward that Paladin.',
      ],
      [
        'righteous_fury',
        'Burning Oath',
        'Passively increases the threat generated by your Holy damage by 30%. Faithwarden only.',
      ],
      [
        'retribution_aura',
        'Requital Aura',
        'Surrounds you and your party with holy energy until death or replacement. Enemies that strike an affected ally in melee take {buff} Holy damage, and affected allies deal {buff} additional Holy damage with auto-attacks. Replaces your own Bastion Devotion. Another Paladin casting Requital Aura refreshes it instead of stacking.',
      ],
      [
        'tame_beast',
        'Wildbond',
        'Begins taming a beast to be your companion. It must be your level or lower and not an elite. Your pet follows you, attacks your enemies, and holds threat of its own. You may have one pet at a time.',
      ],
      ['dismiss_pet', 'Release Companion', 'Releases your pet back to the wild.'],
      [
        'raptor_strike',
        'Gutting Strike',
        'Strike for 10% weapon damage plus {damage}. A hit restores 15 Focus and grants 1 Hunting Momentum. Damage increases with Attack Power through weapon damage.',
      ],
      [
        'aspect_of_the_hawk',
        "Harrier's Guise",
        "Adopt Harrier's Guise, increasing your Attack Power by {buff} for 30 min.",
      ],
      [
        'serpent_sting',
        'Venom Barb',
        'Deal {damage} total Nature damage over 15 sec, once every 3 sec. Damage increases with Ranged Attack Power.',
      ],
      [
        'arcane_shot',
        'Fell Shot',
        'Shoot the target for {damage} Arcane damage. Damage increases with Ranged Attack Power.',
      ],
      [
        'concussive_shot',
        'Rattling Shot',
        'Shoot the target for {damage} Physical damage and slow it by 50% for 4 sec. Damage increases with Ranged Attack Power.',
      ],
      [
        'mongoose_bite',
        'Woundrend',
        'Strike for 45% weapon damage plus {damage}. If the target has your Bloodhook Wound, deal 1 wound tick immediately and refresh the wound to 12 sec. Damage increases with Attack Power through weapon damage.',
      ],
      [
        'hunting_momentum',
        'Hunting Momentum',
        'Passive: Gutting Strike grants 1 Hunting Momentum for 8 sec, up to 3. At 3 stacks, Woundrend deals 45% more strike damage and consumes the stacks. (Fieldcraft)',
      ],
      [
        'fieldcraft_reentry',
        'Armed Re-entry',
        'Passive: Trailbreak refreshes Hunting Momentum and arms your next Gutting Strike or Bloodhook for 12 sec. Gutting Strike deals 15% more damage per stack. Bloodhook deals 18 to 24 extra Physical damage, increased by 15% per stack and by Ranged Attack Power. At 3 stacks, either attack consumes Hunting Momentum. (Fieldcraft)',
      ],
      [
        'wing_clip',
        'Fettering Slash',
        'Slash the target for {damage} Physical damage and slow it by 40% for 10 sec. Damage increases with Attack Power.',
      ],
      [
        'aspect_of_the_monkey',
        "Marten's Guise",
        "Adopt Marten's Guise, increasing your dodge chance by 8% for 30 min.",
      ],
      [
        'aspect_of_the_cheetah',
        "Courser's Guise",
        "Adopt Courser's Guise, increasing your movement speed by 30% for 30 min. While active, taking damage dazes you, halving your movement speed for 4 sec (each hit refreshes the daze).",
      ],
      [
        'aimed_shot',
        'Long Draw',
        'Shoot the target for {damage} Physical damage. Damage increases with Ranged Attack Power.',
      ],
      [
        'rapid_fire',
        'Fevered Draw',
        'Fire 6 shots over 2.4 sec while moving. Each shot deals {damage} Physical damage and increases with Ranged Attack Power.',
      ],
      [
        'smite',
        'Scouring Hymn',
        'Deal {damage} Holy damage. Damage increases with Spell Power. Doctrine: heal each linked ally for 30% of the damage. If no ally is linked, heal the lowest-health party member for 15%.',
      ],
      [
        'lesser_heal',
        'Whispered Prayer',
        'Heal a friendly target for {damage}. Healing increases with Spell Power.',
      ],
      [
        'power_word_fortitude',
        'Litany of Resolve',
        'Increase the Stamina of every party member by {buff}% for 30 min.',
      ],
      [
        'shadow_word_pain',
        'Dirge of Decay',
        'Deal {damage} total Shadow damage over 18 sec, once every 3 sec. Damage increases with Spell Power. Vespers: deal 10% more damage, and each tick on your Effigy grants 1 Gloomtithe.',
      ],
      [
        'power_word_shield',
        'Psalm of Warding',
        'Shield a friendly target, absorbing {damage} damage for 30 sec. Doctrine also links the target to your Holy damage for 30 sec.',
      ],
      [
        'renew',
        'Lingering Grace',
        'Heal the target for {damage} over 15 sec, once every 3 sec. Healing increases with Spell Power.',
      ],
      [
        'mind_blast',
        'Mindfracture',
        'Deal {damage} Shadow damage. Damage increases with Spell Power. Vespers binds a target with your Dirge of Decay as its Effigy, grants 1 Gloomtithe, and echoes 30% of the damage to up to 3 other enemies with your Dirge.',
      ],
      [
        'heal',
        'Solemn Prayer',
        'Heal a friendly target for {damage}. Healing increases with Spell Power.',
      ],
      [
        'mind_flay',
        'Litany of Woe',
        'Channel for 3 sec, dealing {damage} Shadow damage each second. Damage increases with Spell Power.',
      ],
      [
        'flash_heal',
        'Urgent Prayer',
        'Heal a friendly target for {damage}. Healing increases with Spell Power.',
      ],
      [
        'lightning_bolt',
        'Arc Bolt',
        'Deal {damage} Nature damage. Damage increases with Spell Power. Thundercall: a hit grants 1 Thunder.',
      ],
      [
        'thunder_reservoir',
        'Thunder Reservoir',
        'Passive: Arc Bolt and Skybranch grant Thunder, up to 5. At 5 Thunder, Earthen Jolt deals 125% more damage or Faultwake deals 100% more damage, then consumes all Thunder. (Thundercall)',
      ],
      [
        'rockbiter_weapon',
        'Stonebound Weapon',
        'Imbue your weapon for 30 min. Each swing deals {damage} extra damage. Warspirit also gains 40% armor and 20% Stamina, takes 15% less damage, is immune to critical strikes from creatures, and generates two and three quarter times as much threat. Earthen Jolt forces its target to attack you for 3 sec, and Thunder Ward grants 10% damage reduction for 3 sec.',
      ],
      [
        'healing_wave',
        'Mending Waters',
        "Heal a friendly target for {damage}. Healing increases with Spell Power. Spiritcall: store 50% of the full heal before overhealing as Mending Current for 12 sec, up to 30% of the target's maximum health.",
      ],
      [
        'earth_shock',
        'Earthen Jolt',
        'Deal {damage} Nature damage. Damage increases with Spell Power. Thundercall: at 5 Thunder, deal 125% more damage and consume all Thunder. Stonebound: force the target to attack you for 3 sec.',
      ],
      [
        'lightning_shield',
        'Thunder Ward',
        'Surround yourself with lightning for 10 min. The next 3 melee attacks against you deal {buff} Nature damage to the attacker, at most once every 5 sec.',
      ],
      [
        'flame_shock',
        'Cinder Jolt',
        'Deal {damage} Fire damage, then {overTime} Fire damage over 12 sec. The initial hit increases with Spell Power.',
      ],
      [
        'flametongue_weapon',
        'Pyrebrand Weapon',
        'Imbues your weapon for 30 min. Each swing deals {damage} additional Fire damage.',
      ],
      [
        'frost_shock',
        'Rime Jolt',
        'Deal {damage} Frost damage and slow the target by 50% for 8 sec. Damage increases with Spell Power.',
      ],
      [
        'frostbrand_weapon',
        'Rimebound Weapon',
        'Imbues your weapon with biting frost: each swing deals {damage} additional damage for 5 min.',
      ],
      [
        'ghost_wolf',
        'Shadewolf',
        'Become a Shadewolf and move 40% faster. Cast again to return to your normal form.',
      ],
      [
        'stormstrike',
        'Ancestral Strike',
        'Strike for weapon damage plus {damage} and advance Warspirit Cadence by 2 steps. Damage increases with Attack Power through weapon damage.',
      ],
      [
        'shadow_bolt',
        'Gloom Bolt',
        'Sends a shadowy bolt at the enemy for {damage} Shadow damage.',
      ],
      [
        'demon_skin',
        'Fiendhide',
        'Demonic skin increases your armor by {buff} for 30 min. Pact Deepened can double this armor and reduce magic damage taken while Fiendhide is active.',
      ],
      [
        'immolate',
        'Burning Pact',
        'Burns the enemy for {damage} Fire damage and an additional {overTime} over 15 sec.',
      ],
      [
        'corruption',
        'Blackrot',
        'Corrupts the target, causing {damage} Shadow damage over 18 sec.',
      ],
      [
        'evil_eye',
        'Evil Eye',
        'Marks one enemy as the focus of your curses. Moving the Eye preserves Condemnation but does not refresh its 20 sec expiry.',
      ],
      [
        'maledict_gaze',
        'Maledict Gaze',
        'Your Maledict Eye attacks your selected primary Evil Eye every 2.5 sec for Shadow damage. Possess the Evil Eye doubles its attack speed.',
      ],
      [
        'needle_of_fate',
        'Needle of Fate',
        'Pierces the enemy for {damage} Shadow damage and generates {needleDoom} Condemnation on impact if it still bears your Evil Eye. Completing a cast moves your primary Evil Eye to the target and adds a Fate Thread for 12 sec, up to 3. Fate Threads stay with you when the Eye moves or its target dies. Targeting a secondary Coven Eye swaps it with the primary Eye.',
      ],
      [
        'sentence',
        'Sentence',
        'Consumes all Condemnation and Fate Threads to pass sentence on the enemy. Each Thread increases damage by 6%. Added effects escalate at 20, 50, 80, and 100 Condemnation. Its damage scaling flattens after level 16.',
      ],
      ['life_tap', 'Hard Bargain', 'Converts {damage} health into {damage} mana.'],
      [
        'cursed_accomplice',
        'Cursed Accomplice',
        'Links your Maledict Eye when no ally is selected, making its Gaze generate 2 Condemnation. Linking one selected group member makes only their damage to your Evil Eye generate 3 instead. A new link replaces the previous one and may trigger once every 2 sec.',
      ],
      [
        'curse_of_agony',
        'Hex of Anguish',
        'Curses the target with agony: {damage} Shadow damage over 24 sec.',
      ],
      [
        'drain_life',
        'Consume',
        "Consumes the target's vitality, dealing {damage} Shadow damage each second and transferring 70% of it as health. Affliction transfers all of it instead. When channeled on your primary Evil Eye, it consumes all Fate Threads at the start, and each Thread generates 1 extra Condemnation per tick.",
      ],
      [
        'litany_of_guilt',
        'Litany of Guilt',
        'Curses your primary Evil Eye for 6 sec. Condemnation gains release a wave that damages up to 2 other enemies within 8 yards, at most once per second. Rank 2 extends it to 8 sec and 4 enemies.',
      ],
      [
        'cinderhide',
        'Cinderhide',
        'Hardens your skin to cooling slag for 10 sec, reducing all damage taken by 25%.',
      ],
      [
        'umbral_anchor',
        'Umbral Anchor',
        'First cast: anchors your shadow at your feet for 5 min. Recast within 40 m to return there, consuming the anchor and starting a 45 sec cooldown.',
      ],
      [
        'soulwell',
        'Soulwell',
        'Summons a Soulwell for 3 min. While outside combat, group members can refill their Soul Stones up to 3. A Soul Stone restores 25% of maximum health and shares the potion cooldown.',
      ],
      [
        'hex_of_violence',
        'Hex of Violence',
        'Hexes the enemy for 8 sec. Its next 3 damaging actions each generate 7 Condemnation and lash it for 17 Shadow damage.',
      ],
      [
        'cruel_pact',
        'Cruel Pact',
        'Sacrifices 12% of your maximum health to restore 1.5% of your maximum mana and generate 20 Condemnation. Cannot be used at or below 20% health.',
      ],
      [
        'vicarious_suffering',
        'Vicarious Suffering',
        'Links your suffering for 8 sec and generates up to 15 Condemnation from hostile hits. On yourself, reduces damage taken by 20%. On an ally, redirects up to 20% to you without taking you below 15% health.',
      ],
      [
        'possess_evil_eye',
        'Possess the Evil Eye',
        'The Maledictor possesses your primary Evil Eye for 15 sec and generates 35 Condemnation. Needle of Fate casts in 1 sec and generates 2 extra Condemnation, Consume can be channeled while moving, and Sentence deals 25% more damage and releases a delayed echo for 60% damage, tapering to 30% across levels 17-20.',
      ],
      [
        'hour_of_judgment',
        'Hour of Judgment',
        'Calls judgment upon your primary Evil Eye for 15 sec, granting 40 Condemnation and 3 Fate Threads, activating Possession, doubling Condemnation generated through the primary Eye, and increasing Sentence damage by 20%. The first Sentence refunds 50 Condemnation.',
      ],
      [
        'coven',
        'Coven',
        'Creates secondary Evil Eyes on up to 4 nearby enemies for 15 sec. They feed the shared Condemnation pool at 50%, and Sentence echoes to them for 35% damage.',
      ],
      [
        'fear',
        'Harrow',
        "Strikes terror into the enemy, leaving it cowering for up to 5 sec. Damage totaling 8% of the target's maximum health breaks the effect.",
      ],
      [
        'searing_pain',
        'Sear',
        'Sears the enemy with agonizing fire for {damage} Fire damage. Quick to cast.',
      ],
      [
        'shadowburn',
        'Duskfire',
        'Spends 1 Wrack to execute an enemy below 20% health for {damage} Shadow damage. Refunds its Wrack if the claimed target dies within 5 sec.',
      ],
      [
        'ruinous_brand',
        'Ruinous Brand',
        'Brands an enemy for 15 sec. Your next 3 direct spells echo for 25% damage against the branded enemy, or copy 50% damage to it when cast against another target.',
      ],
      [
        'wrath',
        'Wildbolt',
        'Hurls a bolt of nature energy for {damage} Nature damage.',
        {
          balance:
            'In Moonwing Form, each completed cast adds 1 Moontide (max 3). At 3 Moontide, Moonseed becomes Moonsurge and Skyfall becomes Sunwake.',
        },
      ],
      ['healing_touch', 'Wildmend', 'Heals a friendly target for {damage}.'],
      [
        'mark_of_the_wild',
        'Wildward',
        'Places the Wildward on the party, increasing all attributes of all party members by {buff}% for 30 min.',
      ],
      [
        'moonfire',
        'Lunar Tempest',
        'Burns the enemy with moonfire for {damage} Arcane damage plus damage over time.',
        { balance: 'Keep it burning: Moonseed extends it by 6 sec.' },
      ],
      [
        'moonseed',
        'Moonseed',
        'Moonwing Form only. Strikes for {damage} Arcane damage, adds 1 Moontide (max 3), and extends your Lunar Tempest by 6 sec, up to {duration} sec per application. At 3 Moontide, this button becomes Moonsurge: an instant strike for 136 to 162 Arcane damage (plus spell power) that spends all 3.',
      ],
      [
        'rejuvenation',
        'Wildbloom',
        'Heals the target for {damage} over 12 sec.',
        {
          restoration:
            'Planting a NEW bloom adds 1 Verdance (max 5). At 5 Verdance, Fleetmend becomes Overbloom.',
        },
      ],
      [
        'thorns',
        'Briarguard',
        'Thorns sprout from the target: melee attackers take {buff} Nature damage.',
      ],
      ['entangling_roots', 'Gripping Roots', 'Roots the target in place for up to 12 sec.'],
      [
        'bear_form',
        'Bruin Form',
        'Shapeshift into a bear: armor +110%, maximum health +30%, greatly increased attack power, your attacks build rage and generate 30% more threat. Cast again to return to caster form.',
      ],
      [
        'maul',
        'Bonecrush',
        'A mauling attack that increases melee damage by {damage} and causes a high amount of threat. Activates on your next swing. Bruin Form only.',
        {
          feral:
            'Each hit that lands adds 1 Old Blood; at 3 Old Blood this button becomes Marrowbreak: a strike for 78 to 96 damage at high threat; below half health it instead shields you for 18% of your maximum health and refunds 15 rage.',
        },
      ],
      [
        'growl',
        'Menace',
        'Menaces the target: your threat rises to match its most hated enemy and it is compelled to attack you for 3 sec. Bruin Form only.',
      ],
      [
        'challenging_roar',
        'Baleful Roar',
        'A baleful roar: every enemy within 10 yards is taunted, its threat toward you rising to match its most hated enemy, and it is compelled to attack you for 3 sec. Bruin Form only.',
      ],
      [
        'cat_form',
        'Wolf Form',
        'Shapeshift into a wolf: agility rises with your level, attack power +8 plus 2 per level, your attacks use energy and combo points, and you generate 29% less threat. Cast again to return to caster form.',
      ],
      [
        'claw',
        'Rendclaw',
        'Claw the enemy for weapon damage plus {damage}. Awards 1 combo point. Wolf Form only.',
        { feral: 'Each hit that lands adds 1 Old Blood (max 3).' },
      ],
      [
        'ferocious_bite',
        'Gorebite',
        'Finishing move that causes {damage}. Wolf Form only.',
        {
          feral:
            'Each hit that lands adds 1 Old Blood; at 3 Old Blood this button becomes Redharvest, which spends the Old Blood for a stronger strike that also instantly deals all the damage your Flense and Bloodrift would still have dealt, and restores energy.',
        },
      ],
      [
        'swipe',
        'Sweeping Claws',
        'Sweep your claws through nearby enemies for {damage} damage. Causes extra threat. Bruin Form only.',
        { feral: 'Each hit that lands adds 1 Old Blood (max 3).' },
      ],
      [
        'regrowth',
        'Second Bloom',
        'Heals a friendly target for {damage} and an additional amount over 21 sec.',
        { restoration: 'Planting a NEW bloom adds 1 Verdance (max 5).' },
      ],
      ['barkskin', 'Oakhide', 'Your skin hardens like bark, increasing armor by 150 for 15 sec.'],
      // Tank defensive cooldowns (paladin / druid), one distinct mechanic each.
      [
        'sacred_bulwark',
        'Sacred Bulwark',
        'For {duration} sec, the next enemy hit that would kill you is denied, restoring you to 35% health instead.',
      ],
      [
        'primal_reflexes',
        'Primal Reflexes',
        'Your instincts sharpen, increasing your chance to dodge by 50% for 6 sec.',
      ],
      [
        'starfire',
        'Skyfall',
        'Calls down a bolt of stellar fire, causing {damage} Arcane damage.',
        {
          balance:
            'In Moonwing Form, each completed cast adds 1 Moontide (max 3). At 3 Moontide, this button becomes Sunwake: an instant strike for 80 to 100 Nature damage plus a 45 burn over 9 sec, restoring 35 mana and spending all 3.',
        },
      ],
      [
        'travel_form',
        'Fleet Form',
        'Instantly shift into a swift fleet form, increasing movement speed by 40%. You cannot use other abilities while shifted, but can shift in or out of combat, ideal for escaping.',
      ],
      ['enrage', 'Stoke', 'Generates 20 rage instantly. Bruin Form only.'],
      ['bash', 'Concuss', 'Stuns the target for 2 sec. Bruin Form only.'],
      ['faerie_fire', 'Witchlight', "Decreases the target's armor by {damage}% for 40 sec."],
      [
        'hibernate',
        'Slumber',
        'Forces the target into a deep sleep for up to 8 sec. Any damage will awaken it.',
      ],
      [
        'dash',
        'Dash',
        'Sprint forward, increasing movement speed by 50% for 15 sec. Wolf Form only.',
      ],
      [
        'pounce',
        'Slinkstrike',
        'A stealth opener that stuns the target for 2 sec. Awards 1 combo point. Wolf Form only.',
      ],
      [
        'insect_swarm',
        'Stinging Swarm',
        'The enemy is swarmed by insects, taking {damage} Nature damage over 12 sec.',
      ],
      [
        'tigers_fury',
        'Wolfsblood',
        'Surges {rage} energy and increases attack power by {buff} for {duration} sec. Wolf Form only.',
      ],
      [
        'rip',
        'Bloodrift',
        'Finishing move that makes the target bleed every 2 sec for 24 sec: 36 damage plus 24 per combo point spent (5 combo points: {damage} total). Wolf Form only.',
        { feral: 'The landed hit adds 1 Old Blood (max 3).' },
      ],
      [
        'mortal_strike',
        'Maiming Strike',
        'A vicious strike dealing weapon damage plus {damage}. (Arms signature)',
      ],
      [
        'bloodthirst',
        'Bloodletting',
        'Instantly attack in a blood frenzy for 60% weapon damage plus {damage}. (Fury signature)',
      ],
      [
        'shield_slam',
        'Shieldcrack',
        'Slam the target with your shield for 50% weapon damage plus {damage} and massive threat. (Protection signature)',
      ],
      [
        'whirlwind',
        'Bladed Gyre',
        'Spin in a deadly arc, striking all nearby enemies for {damage}. (Fury talent)',
      ],
      [
        'berserker_rage',
        'Seething Fury',
        'Enter a seething fury, generating 20 rage. (Warrior talent)',
      ],
      [
        'crusader_strike',
        'Oathstrike',
        'Strikes the target for weapon damage plus {damage} Holy damage. (Paladin talent)',
      ],
      [
        'chain_heal',
        'Cascading Mend',
        'Heal a friendly target for {damage}, then jump to up to 2 allies within 12 yards. Each jump heals for 50% of the previous target. Each ally reached consumes your remaining Mending Current and immediately heals for 125% of the amount consumed. The initial heal increases with Spell Power. (Spiritcall signature)',
      ],
      [
        'galeheart_weapon',
        'Galeheart Weapon',
        'Imbue both weapons for 30 min, enabling Warspirit Cadence.',
      ],
      [
        'warspirit_cadence',
        'Warspirit Cadence',
        'Passive: Dual-wield attacks have no extra miss chance. Every 3rd landed weapon attack triggers 2 Galeheart Echoes for 25% Nature damage and grants Stormcast for 12 sec. Stormcast makes your next Arc Bolt, Jolt, or Mending Waters instant and cost 50% less Mana. Ancestral Strike counts as 2 attacks. (Warspirit)',
      ],
      [
        'stormsurge',
        'Stormsurge',
        'Passive: While Ancestral Strike is on cooldown, consuming Stormcast has a 25% chance to reset it. If the first 3 chances fail, the 4th always resets it. (Warspirit)',
      ],
      [
        'lifespring_weapon',
        'Lifespring Weapon',
        'Imbue your weapon for 30 min. Mending Waters and Tidecall add 20% more healing to Mending Current.',
      ],
      [
        'unleash_weapon',
        'Unleash Weapon',
        'Trigger your active weapon enchant. Pyrebrand: deal 54 to 64 Fire damage plus 30% of your Spell Power and gain 2 Thunder. Galeheart: strike with your weapon, advance Warspirit Cadence, and gain 20% attack speed for 6 sec. Stonebound: strike for 75% weapon damage, force the target to attack you for 3 sec, and take 20% less damage for 4 sec. Lifespring: consume Mending Current, heal for 125% of its remaining healing, and reduce the next hit within 8 sec by 50% of the health restored.',
      ],
      [
        'elemental_trance',
        'Elemental Trance',
        'Enter an elemental trance for 15 sec, reducing damage taken by 30% and converting 20% of all damage you deal into mana. (Warspirit signature)',
      ],
      [
        'primal_exaltation',
        'Primal Exaltation',
        'For 12 sec, Thundercall Arc Bolt and Skybranch cast 50% faster, while Arc Bolt grants 2 Thunder; Warspirit triggers its cadence every 2 weapon hits; Spiritcall adds 50% more healing to Mending Current. (Shaman talent)',
      ],
      [
        'stoneward',
        'Stoneward',
        'Protects one ally for 60 sec with 6 charges. Damage consumes a charge to heal 5% maximum health, once every 3 sec. (Shaman talent)',
      ],
      [
        'tidecall',
        'Tidecall',
        "Heal a friendly target for {damage}. Healing increases with Spell Power. Add the full heal before overhealing to Mending Current, up to 30% of the target's maximum health.",
      ],
      [
        'soul_harvest',
        'Essence Reap',
        'Tears at the enemy soul for {damage} Shadow damage and creates 1 Soul Fragment, up to 5.',
      ],
      [
        'soul_lance',
        'Soul Lance',
        'Hurls a spectral lance for {damage} Shadow damage. Against your Ossuary Mark, 50% of its damage is added to the mark.',
      ],
      [
        'raise_graveguard',
        'Raise Graveguard',
        'Raises a permanent defensive companion. Graveguard automatically taunts, intercepts 20% of your damage through Grave Dominion, and Reaping Command makes it taunt and take 30% less damage for 4 sec.',
      ],
      [
        'raise_skeletal_warrior',
        'Raise Skeletal Warrior',
        'Spends 1 Soul Fragment to add a persistent Skeletal Warrior to your 2-slot Dominion. Only one may serve you. It cleaves nearby enemies for 45% damage every 6 sec, and Reaping Command pins its target with a 40% slow for 4 sec.',
      ],
      [
        'raise_bone_mage',
        'Raise Bone Mage',
        'Spends 2 Soul Fragments to add a persistent ranged Bone Mage to your 2-slot Dominion. Only one may serve you. Its attacks expose the target to 5% more magic damage for 6 sec, and Reaping Command raises that weakness to 8%.',
      ],
      [
        'bone_armor',
        'Bone Armor',
        'Wraps you in bone, absorbing damage equal to 20% of your maximum health.',
      ],
      [
        'corpse_explosion',
        'Corpse Explosion',
        'Sacrifices a Skeletal Warrior first, then a Bone Mage, and a Gravewing only as a last resort. Among duplicates it chooses the one with the least remaining duration, then the weakest, to deal {damage} Shadow damage at the chosen location.',
      ],
      [
        'funeral_harvest',
        'Funeral Harvest',
        'When an enemy recently damaged by you or your undead dies, you gain 1 Soul Fragment. This can occur once every 3 sec.',
      ],
      [
        'ossuary_mark',
        'Ossuary Mark',
        'Marks an enemy for 15 sec, storing 20% of damage dealt by you and your undead. Recast to detonate it. If the marked enemy dies, it explodes within 6 yards and creates 1 Soul Fragment.',
      ],
      [
        'unholy_command',
        'Unholy Command',
        'Spends 3 Soul Fragments to command all of your undead to deal 25% more damage and act 20% faster for 12 sec.',
      ],
      [
        'reaping_command',
        'Reaping Command',
        "Spends 2 Soul Fragments to command every undead servant to strike in unison. Graveguards taunt and brace, Warriors pin, Bone Mages expose magic defenses, and Gravewing rends all enemies hit. Reaping Command ignores and does not reset each servant's own ability cooldown.",
      ],
      [
        'sacrifice_undead',
        'Sacrifice Undead',
        'Destroys one Dominion servant to restore 25% of your maximum health.',
      ],
      [
        'raise_gravewing',
        'Raise Gravewing',
        'Spends 2 Soul Fragments to add a persistent Gravewing to your 2-slot Dominion. Only one may serve you. It cleaves nearby enemies for 65% damage every 5 sec, and Reaping Command makes every enemy struck take 8% more damage for 5 sec.',
      ],
      [
        'army_of_the_dead',
        'Army of the Dead',
        'Tears open a grave portal to raise a temporary Skeletal Warrior, Bone Mage, and Gravewing for 20 sec, filling the ranks your standing Dominion servants leave empty.',
      ],
      [
        'metamorphosis',
        'Lich Form',
        'Become a Lich for 20 sec, creating 3 Soul Fragments and increasing your spell damage and casting speed by 20%. Your undead deal 50% more damage and act 20% faster, and Soul Lance pierces through its target to strike up to 2 nearby enemies for 50% of its damage. (Necromancy signature)',
      ],
      [
        'holy_shock',
        'Lightjolt',
        'Shocks a friendly target with Holy energy to heal them, or an enemy for {damage} Holy damage. (Holy signature)',
      ],
      [
        'holy_shield',
        'Hallowed Wall',
        'Gain 30% block and a shield that absorbs {damage}% of your maximum health for {duration} sec, releasing a pulse of threat. Ascension strengthens and extends the defense.',
      ],
      [
        'bestial_wrath',
        'Howling Rage',
        'Grant 3 Pack Ferocity. Your next Unleash Beast within 20 sec deals 50% more strike and clap damage, and its frenzy lasts 12 sec instead of 8. (Packlord signature)',
      ],
      [
        'trueshot_aura',
        'Sureflight Aura',
        'Increase the Attack Power of allies within 30 yards by 10% for 30 min. (Marksmanship signature)',
      ],
      [
        'wyvern_sting',
        'Drakesting',
        'Stings the enemy from range, incapacitating it for up to 4 sec. Any damage breaks the effect. (Survival signature)',
      ],
      [
        'arcane_power',
        'Aether Surge',
        'Increases spell damage by 20% and spell haste by 10% for 10 sec. (Arcane signature)',
      ],
      [
        'combustion',
        'Phoenix Trance',
        'Combust: for 10 sec your Fire spells always critically strike, including bolts already in flight. Off the global cooldown. These crits build Hot Streak like any other, and casting it finishes the Cinderfall charge currently recharging. (Fire signature)',
      ],
      [
        'icy_veins',
        'Coldsurge',
        'Increases spell haste by 30% and prevents cast interruption and pushback for 10 sec. (Frost signature)',
      ],
      [
        'cold_blood',
        "Killer's Calm",
        'Focuses your killing intent so your next attack is a critical strike. (Knifework signature)',
      ],
      [
        'blade_flurry',
        'Mirrored Blades',
        'Unleashes a flurry of blades, increasing attack speed by 20% for 12 sec. (Thuggery signature)',
      ],
      [
        'hemorrhage',
        'Red Ribbon',
        'Strikes the enemy for weapon damage plus {damage}, causes bleeding damage over 12 sec, and increases bleed damage taken by 40%. Awards 1 combo point. Every 2nd use adds 1 Gloam (max 3). (Skulduggery signature)',
      ],
      [
        'power_infusion',
        'Anointing',
        'Anoints a friendly target, increasing damage, healing, and casting speed by 20% for 15 sec.',
      ],
      [
        'holy_nova',
        'Sunburst Canticle',
        'Heal allies within 10 yards for {damage} and deal 24 to 30 Holy damage to enemies in the same area. Both amounts increase with Spell Power. (Benison baseline)',
      ],
      [
        'shadowform',
        'Gloamveil',
        'Enter Gloamveil, increasing your Shadow damage by 25%. Cast it again to leave Gloamveil. (Vespers signature)',
      ],
      [
        'elemental_mastery',
        'Primal Mastery',
        'For 12 sec, Arc Bolt grants 2 Thunder. Your next Arc Bolt or Skybranch is instant, and your next full Thunder payoff deals 25% more damage. (Thundercall signature)',
      ],
      [
        'siphon_life',
        'Veinleech',
        'Siphons life from the enemy, causing {damage} Shadow damage over 30 sec and healing you for the damage done. (Affliction signature)',
      ],
      [
        'conflagrate',
        'Conflagrate',
        'Advances one future tick of your Burning Pact, then ignites the target for {damage} Fire damage. Generates 1 Wrack and 1 Desolation. Holds {charges} charges. (Destruction signature)',
      ],
      [
        'moonkin_form',
        'Moonwing Form',
        'Shapeshift into a fearsome Moonkin, increasing your spell damage by 20% and your armor by 50%. Lasts until you shift out. Cast again to return to caster form. (Balance signature)',
      ],
      [
        'feral_charge',
        'Primal Surge',
        'Unleash a primal surge. In Wolf Form, Energy regeneration is increased by 100% for 10 sec. In Bruin Form, instantly generates 50 Rage. (Feral signature)',
      ],
      [
        'swiftmend',
        'Fleetmend',
        'Consumes a heal-over-time effect on a friendly target to heal them for {damage}. Wildbloom and Second Bloom plantings add Verdance; at 5 Verdance this button becomes Overbloom, which instantly heals every ally carrying your heal-over-time effects for 60% of what those effects had left. (Groveheart signature)',
      ],
      [
        'moonlash',
        'Moonsurge',
        'Spends your 3 Moontide for a heavy strike of {damage} Arcane damage: the damage choice. Sunwake spends the same 3 Moontide, so pick one.',
      ],
      [
        'sunlance',
        'Sunwake',
        'Spends your 3 Moontide for a strike of {damage} Nature damage plus a {overTime} burn over 9 sec, and restores 35 mana: the mana choice. Moonsurge spends the same 3 Moontide, so pick one.',
      ],
      [
        'redharvest',
        'Redharvest',
        'Spends your 3 Old Blood: strike for {damage}, instantly deal all the damage your Flense and Bloodrift would still have dealt, remove both bleeds, and restore {rage} energy. Works with zero combo points.',
      ],
      [
        'marrowbreak',
        'Marrowbreak',
        'Spends your 3 Old Blood for a heavy, high-threat strike of {damage} damage. Below half health it instead shields you for 18% of your maximum health for 8 sec and refunds 15 rage.',
      ],
      [
        'overbloom',
        'Overbloom',
        'Spends your 5 Verdance: every ally carrying your heal-over-time effects is instantly healed for {buff}% of the healing those effects had left, the effects are removed, and the target gets a fresh Wildbloom.',
      ],
      [
        'summon_imp',
        'Summon Emberkin',
        'Summons an Emberkin under the command of the Warlock. The Emberkin casts Felbolt at your enemies from afar. Summoning a new demon dismisses your current one. You may have one demon at a time.',
      ],
      [
        'summon_voidwalker',
        'Summon Duskmurk',
        'Summons a Duskmurk under the command of the Warlock. This sturdy demon taunts enemies and uses Abyssal Chain to drag distant normal enemies back into reach. Bosses cannot be pulled. Summoning a new demon dismisses your current one. You may have one demon at a time.',
      ],
      [
        'summon_succubus',
        'Summon Duskborn',
        'Summons a Duskborn under the command of the Warlock. The Duskborn is a fragile demon that strikes quickly and hits hard in melee. Summoning a new demon dismisses your current one. You may have one demon at a time.',
      ],
      [
        'summon_felhunter',
        'Summon Spellhound',
        'Summons a Spellhound under the command of the Warlock. The Spellhound harries enemies from range with Gloombite and excels at hunting spellcasters. Summoning a new demon dismisses your current one. You may have one demon at a time.',
      ],
      [
        'summon_felguard',
        'Summon Warfiend',
        'Summons a Warfiend under the command of the Warlock. The Warfiend is a durable melee demon that wades into battle and holds its own. Summoning a new demon dismisses your current one. You may have one demon at a time.',
      ],
      [
        'summon_infernal',
        'Summon Pyre Colossus',
        'Calls a Pyre Colossus down at the target area, dealing 64-79 Fire damage on impact. It fights for 30 sec without replacing your demon, burns nearby enemies every 2 sec, and generates 1 Wrack every 1 sec.',
      ],
      [
        'summon_doomguard',
        'Summon Wraithborn',
        'Binds a Wraithborn to your will — an elite demon that rains heavy Shadow damage from afar. A long cooldown gates its devastating power. Summoning a new demon dismisses your current one. You may have one demon at a time.',
      ],
      [
        'battle_stance',
        'Battle Stance',
        'An aggressive combat stance: you generate 10% more rage. The default stance for Arms and Protection.',
      ],
      [
        'berserker_stance',
        'Berserker Stance',
        'A reckless combat stance: your critical strikes land 3% more often and hit for 3% more. The Fury warrior always fights in this stance.',
      ],
      [
        'sweeping_strikes',
        'Widening Arc',
        'For 12 sec your single-target attacks also strike 1 nearby enemy for full damage. (Arms)',
      ],
      [
        'deep_wounds',
        'Gaping Wounds',
        'Passive: your Maiming Strike leaves the target bleeding for Physical damage over 6 sec. (Arms)',
      ],
      [
        'enrage_passive',
        'Mayhem',
        'Passive: while Enraged you deal 7% more damage, attack 25% faster and move 10% faster for 4 sec. Bloodletting has a 30% chance to Enrage you; Red Harvest always does. (Fury)',
      ],
      [
        'raging_gale',
        'Twinstrike',
        'Instantly strike with your weapon twice, each hit dealing 40% weapon damage plus {damage}, and generate 4 rage. Stores up to 2 charges. (Fury)',
      ],
      [
        'red_harvest',
        'Red Harvest',
        'Spend everything: strike three times in a frenzy for 65% weapon damage plus {damage} each, always Enraging you. (Fury)',
      ],
      [
        'furious_mending',
        'Furious Mending',
        'For 10 sec you take 20% reduced damage, and while it lasts your Bloodletting heals you for 20% of your maximum health. (Fury)',
      ],
      [
        'emboldening_roar',
        'Emboldening Roar',
        'Lets loose an emboldening roar: you and friendly players within 40 yards are Emboldened, and your next 3 abilities are guaranteed critical strikes. (Fury)',
      ],
      [
        'raised_guard',
        'Raised Guard',
        'Brace behind your shield: you take 50% reduced Physical damage for 6 sec. Stores up to 2 charges. (Protection)',
      ],
      [
        'iron_resolve',
        'Iron Resolve',
        'Grit your teeth and ignore the pain: spends up to 40 rage (20 minimum) to absorb {absorbPerRage} damage per rage spent, lasting up to 10 sec. (Protection)',
      ],
      [
        'faultline',
        'Faultline',
        'Send a shockwave through the ground: enemies in front of you within 8 yards take {damage} damage and are stunned for 3 sec. (Protection)',
      ],
      [
        'defiant_bellow',
        'Defiant Bellow',
        'A defiant bellow: every enemy within 10 yards is taunted, compelled to attack you for 3 sec. (Protection)',
      ],
      [
        'breachmaker',
        'Breachmaker',
        'Batter the target for weapon damage plus {damage} and crack its guard: your own attacks against it deal 20% more damage for 8 sec. (Arms)',
      ],
      [
        'measured_fury',
        'Measured Fury',
        'Your measured fury sharpens your economy: your abilities cost 10% less rage. (Arms)',
      ],
      [
        'seasoned_soldier',
        'Seasoned Soldier',
        'Your critical auto-attacks generate 10% more rage. (Arms)',
      ],
      [
        'diabolical_twinstrike',
        'Diabolical Twinstrike',
        'While Enraged, your Twinstrike deals 15% more damage. (Fury)',
      ],
      [
        'cleaving_blows',
        'Cleaving Blows',
        'Red Harvest always refunds a charge of Twinstrike. (Fury)',
      ],
      [
        'sudden_death',
        'Sudden Death',
        'Your auto-attacks have a chance to let you cast Early Grave on a target at any health, costing no rage. (Arms)',
      ],
      [
        'storm_bolt',
        'Thunderhurl',
        'Hurl your weapon at the target for {damage}, stunning it for 3 sec.',
      ],
      [
        'piercing_howl',
        'Piercing Howl',
        'A piercing shout that slows all enemies within 15 yards by 50% for 8 sec.',
      ],
      [
        'die_by_sword',
        'Die by the Sword',
        'Defensive cooldown: for 8 sec you take 30% less damage and dodge far more attacks.',
      ],
      [
        'intervene',
        'Intervene',
        'Rush to a friendly player, shielding them from {damage} damage for 6 sec.',
      ],
      [
        'recklessness',
        'Recklessness',
        'Enrage: your rage generation increases by 50% and your critical strike chance by 20% for 12 sec.',
      ],
      [
        'sanguine_aura',
        'Sanguine Aura',
        'Imbue your weapon with the blood of your foes: you and your melee allies gain 10% attack speed and 10% damage for 20 sec.',
      ],
      [
        'victory_rush',
        "Victor's Surge",
        'Strike for weapon damage plus {damage} and heal 20% of your maximum health. Only usable within 20 sec of killing an enemy.',
      ],
      [
        'intimidating_shout',
        'Intimidating Shout',
        'A terrifying shout that sends up to 5 enemies within 8 yards fleeing in fear for 4 sec. Damage may break the effect.',
      ],
      [
        'revenge',
        'Revenge',
        'Attack in a wide arc, dealing 18 to 24 Physical damage to all enemies in front of you. Above 5 targets the damage is reduced. When you dodge or parry, your next Revenge may cost no rage. (Protection)',
      ],
      [
        'heroic_leap',
        'Vaulting Charge',
        'Leap to the target area, dealing {damage} damage to nearby enemies on landing.',
      ],
      [
        'rallying_cry',
        'Valor Roar',
        'Lets loose a valorous roar, granting you and party members within 40 yards 20% additional maximum health for 10 sec. Protection: they also take 5% less damage for the duration.',
      ],
      [
        'aspect_of_the_wild',
        'Wildfang Rally',
        'Inspires allies within 30 yd with wild strength, increasing attack power by 45 and attack speed by 5% for 5 min. (Hunter talent)',
      ],
      [
        'avatar',
        'Avatar',
        'Transform into a colossus for 20 sec, breaking enemy control effects on you (boss control is unaffected) and increasing your damage dealt by 20%.',
      ],
      [
        'avenging_wrath',
        'Zealwing',
        'Unfurl physical wings of golden holy power, gaining 10 Devotion and doubling Devotion generated by your abilities for 15 sec. Also increases damage and healing done by 20%. Dawnreaver: enables Tolling Hammer against any target.',
      ],
      ['berserk', 'Red Haze', 'Increases attack power by 70 for 15 sec. (Druid talent)'],
      [
        'bladestorm',
        'Bladestorm',
        'Become a whirling storm of steel, striking all enemies within 6 yards for {damage} every second for 4 sec.',
      ],
      ['blink', 'Flitstep', 'Teleports you 15 yd forward and breaks roots. (Mage talent)'],
      [
        'bloodlust',
        'Storm Chorus',
        'Increase the attack, casting, and channeling speed of group or raid allies within 30 yards by 30% for 15 sec. Affected allies cannot benefit from Storm Chorus or Temporal Acceleration again for 10 min. (Shaman talent)',
      ],
      [
        'chain_lightning',
        'Skybranch',
        'Strike up to 3 enemies within 10 yards for {damage} Nature damage each. Thundercall: a hit grants 1 Thunder. Damage increases with Spell Power.',
      ],
      [
        'abyssal_rift',
        'Abyssal Rift',
        'Tears open a rift at the selected location, pulling enemies within 8 yards to its center, dealing {damage} Shadow damage, and stunning them for 2 sec. Bosses take damage but resist the pull and stun.',
      ],
      [
        'chaos_bolt',
        'Ruinbolt',
        'Spends 3 Wrack to hurl a heavy bolt of chaotic fire for {damage} Fire damage. Desolation shortens its cast by 30%.',
      ],
      [
        'dark_pact',
        'Sanguine Covenant',
        'Sacrifices 10% of your current health to absorb damage equal to 30% of your maximum health for 8 sec.',
      ],
      [
        'cloak_of_shadows',
        'Shadecloak',
        'Wraps you in shadows, absorbing 420 damage for 5 sec. (Rogue talent)',
      ],
      [
        'cone_of_cold',
        'Frostsweep',
        'Blasts nearby enemies with frost for {damage} Frost damage. (Mage talent)',
      ],
      [
        'counterspell',
        'Spellsever',
        'Counters enemy spellcasting, preventing any spell in that school from being cast for 6 sec. (Mage talent)',
      ],
      [
        'curse_of_exhaustion',
        'Leaden Hex',
        'Curses the target, slowing movement by 30% for 12 sec. (Warlock talent)',
      ],
      [
        'death_coil',
        'Morrowlash',
        'Strikes the enemy for {damage} Shadow damage, then horrifies them for 3 sec. (Warlock talent)',
      ],
      [
        'deep_freeze',
        'Deadfrost',
        'Deep freezes the target, dealing {damage} Frost damage and stunning it for 4 sec. (Mage talent)',
      ],
      ['desperate_prayer', 'Last Prayer', 'Instantly heals you for 30% of maximum health.'],
      [
        'deterrence',
        'Bristleguard',
        'Increases your dodge chance by 25 percentage points and reduces all damage taken by 30% for 10 sec. (Hunter talent)',
      ],
      [
        'earthbind',
        'Gripping Earth',
        'Roots enemies within 4 yd of the target point for 2 sec, then slows them by 40% for 6 sec. (Shaman talent)',
      ],
      [
        'evocation',
        'Aetherwell',
        'Channel for 6 sec: each second restores 100 mana and builds 8 spell power, stacking while you channel and lasting 15 sec. (Mage talent)',
      ],
      [
        'flurry_of_knives',
        'Flurry of Knives',
        'Lash every enemy within 6 yd with thrown knives for {damage} Physical damage and gain 2 combo points. (Rogue talent)',
      ],
      [
        'frenzied_regeneration',
        'Savage Mending',
        'Restores 40% of your maximum health over 10 sec. Bruin Form only.',
      ],
      [
        'frost_trap',
        'Rime Snare',
        'Places a frost trap at your feet that arms after 1.5 sec. The first enemy to touch it is frozen for 3 sec, unable to move or act. One trap at a time. Lasts 60 sec. (Hunter talent)',
      ],
      [
        'ghostly_strike',
        'Wraith Strike',
        'Strikes the enemy for weapon damage plus {damage} and increases your dodge chance by 15% for 7 sec. Awards 1 combo point. (Rogue talent)',
      ],
      [
        'hammer_of_wrath',
        'Tolling Hammer',
        "Hurl a holy hammer for {damage} damage and generate 1 Devotion. Usable below 20% health, or during Divine Ascension or Zealwing. Dawn's Wrath grants an additional cast against any target that ignores its current cooldown and deals 20% more damage. Ascension increases its damage by 30%.",
      ],
      [
        'healing_stream',
        'Springwell',
        'Restores 120 health to a friendly target over 12 sec. (Shaman talent)',
      ],
      [
        'howl_of_terror',
        'Dread Chorus',
        "Frightens nearby enemies for up to 5 sec. Damage totaling 8% of a target's maximum health breaks its fear. (Warlock talent)",
      ],
      [
        'ice_block',
        'Cold Coffin',
        'Encases you in solid ice for 8 sec, making you immune to all damage. Removes existing ordinary harmful effects and prevents new ordinary control effects. Usable while stunned or polymorphed. You cannot act while encased. Recast to cancel. (Mage)',
      ],
      [
        'inner_focus',
        'Stilled Mind',
        'Makes your next Priest spell free and uninterruptible. Lasts 60 sec.',
      ],
      [
        'innervate',
        'Lifesap',
        'Living sap wells up in you for 10 sec, restoring 20 of your current resource in waves: mana, Rage, or Energy, and shifting forms does not break it. Sleep, stun, or stasis stills the sap. (Druid talent)',
      ],
      // Baseline class interrupts.
      [
        'pummel',
        'Jawcrack',
        "Interrupts the target's spellcast and prevents casting from that school for 4 sec.",
      ],
      [
        'kick',
        'Boot',
        "Interrupts the target's spellcast and prevents casting from that school for 4 sec.",
      ],
      ['mend_pet', 'Patch Up', 'Heals a friendly target for {damage} over 15 sec. (Hunter talent)'],
      [
        'meteor',
        'Skystone',
        'Calls down a meteor at the target area, dealing {damage} Fire damage and burning the ground. (Mage talent)',
      ],
      [
        'temporal_mend',
        'Temporal Mend',
        'Draws an ally a moment forward in time, mending {damage} health as the body settles into its healthier future self. (Chronomancy signature)',
      ],
      [
        'temporal_barrier',
        'Temporal Barrier',
        'Shifts the target a heartbeat out of the present, a temporal shell absorbing {damage} damage for 10 sec before the timeline snaps back.',
      ],
      [
        'temporal_echo',
        'Temporal Echo',
        'Marks an ally with an echo of a healthier moment, mending {damage} health at once. For {duration} sec, part of the Arcane damage you deal is drawn back through the echo to heal them.',
      ],
      [
        'temporal_cascade',
        'Temporal Cascade',
        'Sends an echo cascading through your group: the target and up to four of their nearest allies are mended at once and each marked for {duration} sec, drawing part of the Arcane damage you deal back through their echoes to heal them. (Chronomancy)',
      ],
      [
        'temporal_reversal',
        'Temporal Reversal',
        "Rewinds a fallen ally's timeline, returning them to life at your side with 35% of their health and mana, even in the thick of combat. (Chronomancy)",
      ],
      [
        'collective_reversal',
        'Collective Reversal',
        'Rewinds every fallen member of your group or raid within 40 yards and in your line of sight, returning them to life at your side with 30% health and mana. Cannot be cast in combat. (Chronomancy)',
      ],
      [
        'ancestor_return',
        "Ancestors' Return",
        'Call every fallen member of your group or raid within 40 yards and in your line of sight back to your side with 30% health and mana. Cannot be cast in combat. (Spiritcall)',
      ],
      [
        'temporal_rewind',
        'Rewind',
        'Sends an arcane wave through your group or raid, rewinding time to restore 30% of the damage each ally within 40 yards took over the last 5 seconds (up to 35% of their maximum health). Cannot be a critical effect. (Chronomancy)',
      ],
      [
        'temporal_hourglass',
        'Hourglass of Suspension',
        'Place a temporal hourglass at the selected location. Beneath an enemy, it suspends them for {hostilePveDuration} sec in PvE or {hostilePvpDuration} sec in PvP and prevents all actions; damage breaks the effect. At your feet or beneath a group ally, it grants stasis for {duration} sec, prevents damage and actions, restores {healing}% of maximum health, and makes cooldowns recover {selfCooldownRecovery}% faster for you or {allyCooldownRecovery}% faster for an ally. On empty ground, the hourglass waits for {groundDuration} sec and affects the first valid unit to step on it. The beneficial aura can be removed manually.',
      ],
      [
        'temporal_acceleration',
        'Temporal Acceleration',
        'Accelerates the flow of time for your group or raid, increasing attack, casting, and channeling speed by 30% for 15 sec. Allies recently affected by Temporal Acceleration or Storm Chorus are too exhausted to benefit. (Chronomancy)',
      ],
      [
        'perfect_moment',
        'Perfect Moment',
        'Seize your perfect moment: instantly gain 4 Arcane Charges, and for 10 sec Aether Darts does not consume them. (Chronomancy)',
      ],
      [
        'arcane_surge',
        'Aether Surge',
        "Draws a surge of raw aether through the enemy for {damage} damage. Each cast leaves an Arcane Charge that raises your next Aether Surge's damage and cast speed (5% faster each) but sharply raises its mana cost, stacking up to 4; Aether Darts spends the charges. Each cast can also arm Aether Rush, making your next Aether Surge free and twice as fast to cast.",
      ],
      [
        'mind_sear',
        'Thoughtburn',
        'Channel for 3 sec, dealing {damage} Shadow damage each second to enemies within 8 yards of the target area. Damage increases with Spell Power. (Priest talent)',
      ],
      [
        'multi_shot',
        'Splitshot',
        'Loose a spread at the target area, dealing {damage} Physical damage to enemies within 8 yd. Cannot be aimed within 8 yd of you. (Hunter talent)',
      ],
      [
        'prayer_of_healing',
        'Choirmend',
        'Heal allies within 30 yards for {damage}. Healing increases with Spell Power. (Benison)',
      ],
      [
        'preparation',
        'Contingency',
        'Finishes the cooldown on Swift Heels, Ghostfoot, and Smokefade. (Rogue talent)',
      ],
      [
        'presence_of_mind',
        'Racing Mind',
        'Makes your next spell with a cast time instant. Lasts 60 sec. (Mage talent)',
      ],
      [
        'psychic_scream',
        'Terror Canticle',
        'Frighten enemies within 8 yards for up to 4 sec. Damage may break the effect.',
      ],
      [
        'counter_shot',
        'Hushing Shot',
        'Interrupt the target and prevent spells from that school for 4 sec.',
      ],
      [
        'rebuke',
        'Reproach',
        "Interrupts the target's spellcast and prevents casting from that school for 4 sec.",
      ],
      [
        'shadowstep',
        'Shadeslip',
        'Steps through the shadows to your target, friend or foe, without breaking Duskveil. (Rogue talent)',
      ],
      ['silence', 'Hushword', 'Silences the target for 4 sec. (Priest talent)'],
      [
        'smoke_screen',
        'Smoke Screen',
        'Vanish into a cloud of smoke, increasing your chance to dodge by 30% for 8 sec.',
      ],
      [
        'sacrilegious_march',
        'Sacrilegious March',
        'Increases movement speed by 35%, but sacrifices 2% of your maximum health each second. Cast again to cancel. It switches off at 20% health.',
      ],
      [
        'spellsteal',
        'Spellplunder',
        'Steals a beneficial magic effect from an enemy, transferring it to yourself.',
      ],
      [
        'startle_shot',
        'Startle Shot',
        'A wild shot that disorients the target for {duration} sec. Any damage breaks the effect.',
      ],
      [
        'skull_bash',
        'Headbutt',
        "A lunging headbutt that interrupts the target's spellcast and locks that school for 4 sec.",
      ],
      [
        'spell_lock',
        'Abyssal Gag',
        'Interrupts enemy spellcasting and prevents casting from that school for 4 sec.',
      ],
      [
        'thieves_chorus',
        "Thieves' Chorus",
        'A whistled signal spurs your group on, increasing attack, casting, and channeling speed by 10% for 10 sec. Allies recently affected by a group haste burst are too exhausted to benefit. (Rogue talent)',
      ],
      [
        'tranquility',
        'Gladesong',
        'Channels restorative energy for 4 sec, healing allies within 30 yd for 42 to 52 each second. (Druid talent)',
      ],
      [
        'venom_dart',
        'Venom Dart',
        'Flick a poisoned dart for {damage} Nature damage. Awards 1 combo point.',
        {
          assassination:
            'Adds 1 Venom Ritual and extends your venom wound by 6 sec (the wound never goes above 20 sec).',
        },
      ],
      [
        'body_blow',
        'Haymaker',
        'A heavy blow for 130% weapon damage plus 10. Awards 2 combo points and adds 1 Redline (max 4). (Thuggery)',
      ],
      [
        'knockout_blow',
        'Lights Out',
        'Ends Redline with a knockout: strike for 45 plus 35 per combo point, hitting 25% harder for each Redline you built, and recover 25 energy. Use it before Redline runs out or the knockout is lost. (Thuggery)',
      ],
      [
        'veilstrike',
        'Shadow Veil',
        "For 6 sec: your Duskveil openers work without stealth and from any angle, you deal 10% more damage, and your first Lurker's Strike inside it hits for double. (Skulduggery)",
      ],
      [
        'venomrend',
        'Venomrend',
        'Spends your 6 Venom Ritual: strike for 100 plus 55 per combo point, instantly deal all the damage your bleeds would still have dealt, then apply a fresh venom wound (120 damage over 20 sec). Restores 20 energy. (Knifework)',
      ],
      [
        'typhoon',
        'Typhoon',
        'A blast of wind knocks back all enemies within 8 yd and dazes them, slowing their movement by 50% for 4 sec.',
      ],
      [
        'voidfeast',
        'Voidfeast',
        'Devours a magic effect (a beneficial one from an enemy, or a harmful one from an ally) and heals you for 6% of your maximum health. Only usable when there is an effect to devour.',
      ],
      ['veilstep', 'Veilstep', 'Step 10 yards forward through the veil.'],
      [
        'scouring_mercy',
        'Scouring Mercy',
        'Deal 72 to 84 Holy damage to an enemy or heal a friendly target for 130 to 155. Both amounts increase with Spell Power. Damage also heals each Doctrine-linked ally for 30%, or the lowest-health party member for 15% if no ally is linked. (Doctrine signature)',
      ],
      [
        'seraphic_vigil',
        'Seraphic Vigil',
        'Protect one ally for 30 sec. The first hit that leaves them below 35% health consumes the Vigil and heals them for {buff}. (Benison signature)',
      ],
      [
        'summon_tithefiend',
        'Call Tithefiend',
        'Consume all Gloomtithe to summon a Tithefiend. It lasts 6, 8, 10, 12, or 15 sec at 1 to 5 stacks and attacks every 2 sec. Each attack deals 20 to 24 Shadow damage plus 8 per extra stack and increases with your Spell Power. At 5 stacks, the fiend grows larger and deals 25% more damage. It prefers your Effigy. Each hit restores 1% maximum Mana and echoes 15% of its damage to up to 3 other enemies with your Dirge of Decay. (Vespers signature)',
      ],
      ['martyrs_aegis', "Martyr's Aegis", "Reduce one ally's incoming damage by 40% for 8 sec."],
      [
        'choir_of_deliverance',
        'Choir of Deliverance',
        'Channel for 6 sec, healing party members within 30 yards for {damage} every 2 sec. Healing increases with Spell Power.',
      ],
    ]),
  },
};

export const classAbilityNames = {
  en: classAbilityNamesEn,
};

export { abilityTranslations, classAbilityNamesEn };
