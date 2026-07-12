// Season 1 Armory: purchasable weapon-skin cosmetics (paid tiers only; the free
// Wrought Iron commons are not sold and are not listed here). Source of truth for
// the store catalogue, pricing, and lore. Skins are ACCOUNT-wide unlocks bought
// with Claudium through the economy service; the skin id doubles as the economy
// SKU item id (kind 'skin'), so ids here must stay in lockstep with the service
// catalog. Cosmetic only: a skin never changes weapon stats, reach, or speed.
//
// `model` is the held-model basename under public/models/weapons/<model>.glb
// (registered in src/render/characters/assets.ts and, for rare and above, in the
// WEAPON_VFX spec map in src/render/weapon_vfx.ts). The sim never loads models;
// it carries the key so server and clients agree on what everyone sees.

import type { WeaponSkinType } from '../types';

export type { WeaponSkinType } from '../types';

export type WeaponSkinRarity = 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface WeaponSkinDef {
  /** Store SKU / economy-service item id (kind 'skin'). */
  id: string;
  name: string;
  /** Display collection (one per rarity in Season 1). */
  collection: string;
  rarity: WeaponSkinRarity;
  weaponType: WeaponSkinType;
  /** Held-model basename under public/models/weapons/. */
  model: string;
  /** Whole USD; Claudium cost is priceUsd * WEAPON_SKIN_CLAUDIUM_PER_USD. */
  priceUsd: number;
  season: 1;
  /** Collection flagship (epic) or hero (legendary) callout. */
  badge?: 'flagship' | 'hero';
  /** Ranged handling override: a bow-slot skin held and fired like a crossbow
   *  (the class's authored shoulder-aim attack, right-hand attach) instead of
   *  the drawn bow. Guns and launchers aim; they are not drawn. Cosmetic only:
   *  the sim never reads it (the Auto Shot draw time is skin-agnostic). */
  handling?: 'crossbow';
  /** In-game look, one line (inspect panel subtitle). */
  look: string;
  /** Armory codex lore (inspect panel body). */
  lore: string;
}

/** Peg: 1 Claudium = 0.01 USD, mirrored from the economy service. */
export const WEAPON_SKIN_CLAUDIUM_PER_USD = 100;

export const WEAPON_SKIN_TYPES: readonly WeaponSkinType[] = [
  'sword',
  'axe',
  'mace',
  'dagger',
  'staff',
  'wand',
  'bow',
  'crossbow',
];

export function isWeaponSkinType(value: string): value is WeaponSkinType {
  return (WEAPON_SKIN_TYPES as readonly string[]).includes(value);
}

export const WEAPON_SKIN_RARITY_ORDER: readonly WeaponSkinRarity[] = [
  'uncommon',
  'rare',
  'epic',
  'legendary',
];

export const WEAPON_SKIN_PRICE_USD: Record<WeaponSkinRarity, number> = {
  uncommon: 2,
  rare: 10,
  epic: 30,
  legendary: 50,
};

const S1 = {
  guildmark: 'Guildmark',
  emberwrought: 'Emberwrought',
  hoarfrost: 'Hoarfrost',
  fallenStar: 'Fallen Star',
} as const;

export const WEAPON_SKINS: Record<string, WeaponSkinDef> = {
  // ── Guildmark (Uncommon, 2 USD): signed armorer work, no enchantment ──
  guildmark_arming_sword: {
    id: 'guildmark_arming_sword',
    name: 'Guildmark Arming Sword',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'sword',
    model: 'guildmark_arming_sword',
    priceUsd: 2,
    season: 1,
    look: 'Blued steel blade, bronze fishtail crossguard, teal-dyed leather grip, small stamped guild sigil.',
    lore: "Where the wrought blade is anonymous, this one is signed. An armorer earns the right to sink his mark into the ricasso only once the World Market's Merchant will vouch for his steel, and Smith Haldren's mark is vouched for. Blued against the Vale's damp, balanced to a hair. You pay for the stamp as much as the sword, and it is worth it.",
  },
  brasscap_axe: {
    id: 'brasscap_axe',
    name: 'Brasscap Hatchet',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'axe',
    model: 'brasscap_hatchet',
    priceUsd: 2,
    season: 1,
    look: "Polished steel bit, brass cap and langets on a lacquered ash haft, tidy wrap, a maker's stamp.",
    lore: "A stamped axe is a boast you can hold. The brass cap and langets are half armour, half signature: they keep the haft from splitting and they catch the tavern light so everyone knows you bought Armorer Hode's work, not a militia hand-me-down. 'If it cuts, I sell it,' the Highwatch smith says. This one cuts.",
  },
  tempered_flanged_mace: {
    id: 'tempered_flanged_mace',
    name: 'Tempered Flanged Mace',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'mace',
    model: 'tempered_flanged_mace',
    priceUsd: 2,
    season: 1,
    look: 'Six-flanged tempered blue-steel head, brass collar and pommel, wine-red leather grip.',
    lore: "Six flanges of blued, tempered steel, each ground to open a helm, capped in brass and wound in wine-red leather. The realm's armorers don't make ugly weapons even when the work is brutal. This one was commissioned through the World Market, not pulled off a rack; somewhere there's a ledger with a proud buyer's name and the sum he paid Hode for it.",
  },
  guildmark_dirk: {
    id: 'guildmark_dirk',
    name: 'Guildmark Dirk',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'dagger',
    model: 'guildmark_dirk',
    priceUsd: 2,
    season: 1,
    look: 'Slim tempered-steel dirk, bronze guard and pommel nut, dark-green cord grip, stamped sigil.',
    lore: "What a made man wears when the sword stays home: slim, tempered, stamped with the same mark that certifies a full blade, worn on the belt like a signet with an edge. Understated to everyone but those who can read an armorer's proof. Quartermaster Bree keeps a drawer of them at Highwatch for officers who've earned the wall's respect.",
  },
  brasscrown_staff: {
    id: 'brasscrown_staff',
    name: 'Brasscrown Walking Staff',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'staff',
    model: 'brasscrown_walking_staff',
    priceUsd: 2,
    season: 1,
    look: 'Hardwood staff topped with a turned brass crown finial, brass ferrule, dyed leather band.',
    lore: "Turned from seasoned hardwood and crowned with a brass finial the Eastbrook smiths cast by the hundred but perfect by the one. It belongs to the sort of traveller who wants to be taken seriously at Fenbridge's gate and Highwatch's wall alike. A walking stick that has never truly needed to walk; the dyed band matches a coat you can guess the price of.",
  },
  lacquered_wand: {
    id: 'lacquered_wand',
    name: 'Lacquered Rod',
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'wand',
    model: 'lacquered_rod',
    priceUsd: 2,
    season: 1,
    look: 'Slender deep-red lacquered wand, two polished brass bands, small rounded brass tip.',
    lore: "Deep-red lacquer in seven patient coats, banded twice in polished brass: the kind of wand a hedge-mage buys off the World Market once they've started charging real coin and want to look it. It channels the Light no better than a birch stick. But it gleams magnificently across the Merchant's counter, and half of minor magic has always been being believed.",
  },
  fletcher_s_guild_bow: {
    id: 'fletcher_s_guild_bow',
    name: "Fletcher's Guild Bow",
    collection: S1.guildmark,
    rarity: 'uncommon',
    weaponType: 'bow',
    model: 'fletcher_s_guild_bow',
    priceUsd: 2,
    season: 1,
    look: 'Lacquered walnut recurve bow, brass limb tips, waxed linen string, a guild stamp on the riser.',
    lore: "The closest thing the realm has to a guild is a fletcher's stamp on the riser, a promise about what's inside, the way a vintner seals a cask. Lacquered walnut, brass at the limb tips, a waxed linen string that won't fray through a Mirefen rain. Every joint argues for the price. Draw it once past the Widow Thicket and the argument wins.",
  },

  // ── Emberwrought (Rare, 10 USD): mountain-fire banked into the metal ──
  cinderbrand_sword: {
    id: 'cinderbrand_sword',
    name: 'Cinderbrand',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'sword',
    model: 'cinderbrand',
    priceUsd: 10,
    season: 1,
    look: 'Dark forged-steel blade, fuller filled with glowing ember-orange runes, heat-cracks, a smouldering gem in the guard.',
    lore: "The first blade quenched not in water but in Blessed Embers raked from Stormcrag, the coals the Highwatch smiths swear 'burn blue and clean, because the mountain remembers its old oath.' Banked into the fuller, that fire smoulders ember-orange and will not die; the runes stay warm to a bare hand on the coldest night of the wall. Cinderbrand never needs lighting. It simply refuses to go out.",
  },
  emberbite_axe: {
    id: 'emberbite_axe',
    name: 'Emberbite',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'axe',
    model: 'emberbite',
    priceUsd: 10,
    season: 1,
    look: 'Blackened-iron axe with ember-orange cracks glowing through the bit, a banked-coal gem, wisps of heat.',
    lore: 'Armorer Hode worked a live coal of mountain-fire into the heart of the bit, so the edge never truly cools between blows. The cracks breathe orange on the downswing, as if the strike wakes something the first forging left sleeping in the iron. They say a Stormcrag elemental gave up the ember for it; they say a great many things at Highwatch when the wind is up.',
  },
  smoulderfall_mace: {
    id: 'smoulderfall_mace',
    name: 'Smoulderfall',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'mace',
    model: 'smoulderfall',
    priceUsd: 10,
    season: 1,
    look: 'Dark iron flanges glowing ember-orange along their inner cracks, a molten-cored gem in the head.',
    lore: "A mace that carries its own hearth: a molten-cored stone chipped from the Sanctum seal that was 'wrought with mountain-fire,' set glowing in the head. The flanges stay warm to the touch and warmer where they land; a Highwatch sergeant swears a blow from it leaves a bruise that glows faintly till morning. The mountain's fire, at last made for breaking rather than sealing.",
  },
  ashspark_dagger: {
    id: 'ashspark_dagger',
    name: 'Ashspark Shiv',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'dagger',
    model: 'ashspark_shiv',
    priceUsd: 10,
    season: 1,
    look: 'Short blackened blade veined with glowing ember-orange, a tiny smouldering gem in the pommel, ash and spark.',
    lore: "A back-alley blade with the mountain's fire smuggled into its pommel-stone, an armorer's quiet joke: even a cutpurse might carry an ember of the first forging. Blackened, veined with orange, always a shade too warm in the sheath. Draw it in the dark under Highwatch and the glow lights your hand just enough to find the gap in a man's guard.",
  },
  forgeheart_staff: {
    id: 'forgeheart_staff',
    name: 'Forgeheart Stave',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'staff',
    model: 'forgeheart_stave',
    priceUsd: 10,
    season: 1,
    look: 'Iron-shod staff crowned with a caged glowing ember core, ember runes up the shaft, rising heat-shimmer.',
    lore: "A living coal of mountain-fire caged in iron at its crown. Loremaster Caddis calls it proof that the fire of the first forging can be bound to serve, not only to seal. Heat-shimmer rises from it in a thin, endless ribbon; a mage who carries one never wants for a forge or a watch-fire. The ember, they whisper, was drawn from Voskar the Emberwing's own breath, and it has not cooled since.",
  },
  emberwrought_wand: {
    id: 'emberwrought_wand',
    name: 'Emberwrought Wand',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'wand',
    model: 'emberwrought_wand',
    priceUsd: 10,
    season: 1,
    look: 'Blackened-metal wand tipped with a glowing ember coal in iron claws, hairline heat-cracks, warm inner light.',
    lore: 'The wand that named the grade. When a Highwatch armorer first set a coal of mountain-fire in iron claws and made it answer a mortal hand, even the Priests of the Light stopped calling it heresy and started calling it useful. Warm, patient and quietly dangerous: the ember at its tip has burned, unbroken, since before its owner drew breath.',
  },
  cinderlatch_crossbow: {
    id: 'cinderlatch_crossbow',
    name: 'Cinderlatch',
    collection: S1.emberwrought,
    rarity: 'rare',
    weaponType: 'crossbow',
    model: 'cinderlatch',
    priceUsd: 10,
    season: 1,
    look: 'Blackened-steel crossbow, ember-orange glow seeping from cracks in the prod, a smouldering coal in the tiller.',
    lore: "The strangest of the ember-forged: the mountain's fire poured into a machine. Orange seeps from cracks in the prod, and a smouldering coal in the tiller keeps the string from ever stiffening in Thornpeak's cold or Mirefen's damp. Its bolts leave the groove already warm and land warmer. A hunter's answer to a wall where the enemy does not feel the cold either.",
  },

  // ── Hoarfrost (Epic, 30 USD): carved and grown from Thornpeak glacier ──
  ice_fang_sword: {
    id: 'ice_fang_sword',
    name: 'Ice Fang',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'sword',
    model: 'ice_fang',
    priceUsd: 30,
    season: 1,
    badge: 'flagship',
    look: 'Curved blade of pale glacial ice, jagged rime crystals along the spine, a glowing cyan frozen core in the fuller, icicle crossguard.',
    lore: "The flagship of the frozen grade, and the piece every collector reaches for first. Ice Fang was carved, not forged, from a fang of the glacier that caps Thornpeak above Highwatch, its cyan core burning cold as the light off the Glimmermere. It rimes the very air it cuts. The wall-guard swear one soldier carried it the night the high snows held the Wyrmcult back, and 'bought the wall a winter.'",
  },
  glaciersplit_axe: {
    id: 'glaciersplit_axe',
    name: 'Glaciersplit',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'axe',
    model: 'glaciersplit',
    priceUsd: 30,
    season: 1,
    look: 'Head of translucent blue glacier-ice, cracked interior glowing cyan, frost crystals bristling, a haft trailing cold vapor.',
    lore: 'Hewn from the blue heart of the Thornpeak glacier, where two centuries of ice have pressed the cold until it glows on its own. It trails vapour even at rest, and the crack of it landing is a crevasse opening under Stalker Ridge. Highwatch gives its fallen to the ice up there; so this is a weapon meant to keep the thaw, and whatever the thaw would wake, at bay.',
  },
  rimecrusher_mace: {
    id: 'rimecrusher_mace',
    name: 'Rimecrusher',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'mace',
    model: 'rimecrusher',
    priceUsd: 30,
    season: 1,
    look: 'Cluster of jagged ice crystals around a glowing cyan core, hoarfrost creeping down a silvered haft.',
    lore: "Not carved but grown: Thornpeak ice coaxed around a cold cyan core until it set as hard as Hode's best steel. Hoarfrost creeps down the silvered haft toward the hand and never quite arrives. Where it strikes, water freezes; where it rests, the ground whitens. The grave-cold of the peaks, made small enough to swing at the things that climb the wall.",
  },
  frostbite_dagger: {
    id: 'frostbite_dagger',
    name: 'Frostbite',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'dagger',
    model: 'frostbite',
    priceUsd: 30,
    season: 1,
    look: 'Wickedly thin dagger of clear blue ice, a glowing cyan vein down the center, needle frost crystals, hoarfrost hilt.',
    lore: 'Thin as a held breath and twice as cold: a splinter of Thornpeak glacier honed to a single glowing vein, so keen the wound is frozen shut before the blood remembers to run. Its name is borrowed from the grave-chill the dead carry down off the peaks. It never needs sharpening; ice does not dull, Loremaster Caddis notes drily, it only waits.',
  },
  hoarfrost_vigil_staff: {
    id: 'hoarfrost_vigil_staff',
    name: 'Hoarfrost Vigil',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'staff',
    model: 'hoarfrost_vigil',
    priceUsd: 30,
    season: 1,
    look: 'Silvered staff crowned with a floating, slowly rotating shard of glowing cyan ice, radiating crystals and cold vapor.',
    lore: "The staff of the watch that never sleeps on Highwatch's wall. Its crown is a shard of cyan tarn-ice that floats free of the silver and turns, slowly, of its own accord: always, the guard swear, toward the cold that gathers beneath the peaks. To carry the Vigil is to stand two hundred years of watch in a single night, and promise not to look away.",
  },
  everwinter_wand: {
    id: 'everwinter_wand',
    name: 'Shard of Everwinter',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'wand',
    model: 'shard_of_everwinter',
    priceUsd: 30,
    season: 1,
    look: 'A single spike of glowing cyan glacier-ice, hoarfrost blooming from a silver collar, faint cold mist.',
    lore: "A spike of glowing glacier-ice, said to be broken from the deep tarn below the Sanctum, where the mountain's cold has teeth. Hoarfrost blooms endlessly from its silver collar and never melts, not by fire nor by summer. Mages keep it close for the cold it lends their work, and keep it far on the nights it seems to lean toward Nythraxis's crypt, and listen.",
  },
  winterbite: {
    id: 'winterbite',
    name: 'Winterbite',
    collection: S1.hoarfrost,
    rarity: 'epic',
    weaponType: 'bow',
    model: 'winterbite',
    priceUsd: 30,
    season: 1,
    look: 'Silvered steel and blue-ice bow, a glowing cyan frozen core in the riser, a nocked arrow of solid ice, cold vapor.',
    lore: "A bow of silvered steel and Thornpeak ice, its riser lit by a cold cyan core that freezes the arrow to the string. It nocks a shaft of solid glacier-ice that reforms each draw; the archer carries no quiver on the wall, only the cold. Highwatch held Stalker Ridge through a siege with one like it: a single bowman, they say, and a winter's worth of arrows that were always already there.",
  },

  // ── Fallen Star (Legendary, 50 USD): worked from the Mirefen crater ──
  solheim_sword: {
    id: 'solheim_sword',
    name: 'Solheim, Last Light of the Dawn',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'sword',
    model: 'solheim_last_light_of_the_dawn',
    priceUsd: 50,
    season: 1,
    badge: 'hero',
    look: 'Greatsword forged from a fallen star, molten-gold core splitting the blade, cosmos-black steel edged in starlight, golden shards orbiting the guard, aurora ribbon.',
    lore: "When the star fell out of the western sky and 'burst like a forge' beyond the Widow Thicket, Brother Aldric pulled its still-smouldering heart from the Mirefen crater and begged the realm's smiths to work 'a thing that does not belong to this world.' They made one greatsword of it: Solheim. Its molten-gold core splits the cosmos-black blade like dawn cracking a night sky, and shards of star-metal orbit the guard on paths no hand set. Only one was ever forged. There will not be another.",
  },
  skyrender_axe: {
    id: 'skyrender_axe',
    name: "Skyrender, the Firmament's Wound",
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'axe',
    model: 'skyrender_the_firmament_s_wound',
    priceUsd: 50,
    season: 1,
    look: 'Head like a torn piece of night sky, molten-gold cracks and constellation etchings, starlight shards hovering, an aurora shimmer trailing the edge.',
    lore: "Beaten from the crater's rim, where the fallen star tore the sky's own reflection out of Mirefen and left a wound that still steams. The head looks like a piece of torn night: molten-gold cracks, constellations no scholar at Highwatch can name, an aurora bleeding off the edge with every swing. Brother Aldric blessed it and would not touch it. To lift it is to hold the hole the heavens left.",
  },
  starfall_mace: {
    id: 'starfall_mace',
    name: 'Starfall, Judgment of the Heavens',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'mace',
    model: 'starfall_judgment_of_the_heavens',
    priceUsd: 50,
    season: 1,
    look: 'Captive molten-gold star-core ringed by orbiting fragments, cosmos-black flanges veined with starlight, aurora spilling from the seams.',
    lore: 'A star-core caught the instant before it died, ringed with the debris that fell with it, frozen an inch from oblivion. Its cosmos-black flanges run with trapped starlight, and aurora spills from the seams when it is raised. The old Priests of the Light called a falling star a judgment, a verdict handed down from above that no shield was meant to stop, and named this after the one that came down on Mirefen.',
  },
  astravyr_dagger: {
    id: 'astravyr_dagger',
    name: 'Astravyr, Fang of the Fallen Star',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'dagger',
    model: 'astravyr_fang_of_the_fallen_star',
    priceUsd: 50,
    season: 1,
    look: 'A sliver of a fallen star, molten-gold glowing edge on cosmos-black metal, a bright star-mote orbiting the pommel, a thin aurora trail.',
    lore: 'The smallest piece of the star Aldric hauled from the crater, and by some reckonings the most dangerous. A single sliver of that other-worldly heart, its molten-gold edge riding cosmos-black metal, a lone star-mote circling the pommel like a moon that lost its world. It weighs almost nothing and parts almost anything. Small enough to hide, bright enough to find in the dark by its own light.',
  },
  cosmarch_staff: {
    id: 'cosmarch_staff',
    name: 'Cosmarch, Spire of the Endless Void',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'staff',
    model: 'cosmarch_spire_of_the_endless_void',
    priceUsd: 50,
    season: 1,
    look: 'Orbiting cluster of golden star-shards around a molten-gold core, constellation-etched cosmos-black shaft, aurora ribbons winding upward.',
    lore: "A shaft of star-metal crowned with a molten-gold core and a ring of golden shards that march around it in slow, endless orbit: a little cosmos, etched with constellations that match no sky over Thornpeak. Aurora winds up its length like smoke that forgot to rise. Those who bore it claimed they could feel the void turning through it, the way Ysolei's mere 'drinks the moonlight': patient, and cold, and looking back.",
  },
  emberwish_wand: {
    id: 'emberwish_wand',
    name: 'Emberwish, Mote of the Dying Sun',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'wand',
    model: 'emberwish_mote_of_the_dying_sun',
    priceUsd: 50,
    season: 1,
    look: 'Captive molten-gold dying-star mote wreathed in orbiting sparks, cosmos-black shaft etched with glowing constellations.',
    lore: 'Not the fallen star itself but the last mote of a dying one: a single molten-gold ember of a sun already gone out, wreathed in the sparks that were its final light. Its cosmos-black shaft is etched with the constellations that watched it die. The Mirefen crofters say it grants one wish to whoever holds it at true dusk; they also say every soul who held it wished for more time, and that the Drowned Moon granted none of them any.',
  },
  encore_bow: {
    id: 'encore_bow',
    name: 'Encore, the Second Falling Star',
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'bow',
    model: 'encore_the_second_falling_star',
    handling: 'crossbow',
    priceUsd: 50,
    season: 1,
    look: 'Comically oversized star-cannon: a cosmos-black barrel etched with glowing golden constellations, a flared bell muzzle with a molten-gold comet shell seated inside, brass fittings, a wooden shoulder stock.',
    lore: "The smiths who worked the fallen star made six relics of it and still had a barrel's worth of star-metal left over, and by then the apprentices had opinions. What came off the anvil is either the realm's first gun or its smallest siege engine: a shoulder cannon that does not so much loose a shot as request a second star, aimed. Brother Aldric declined to bless it, reasoning that anything that loud has already been noticed by heaven. Hunters adore it. Nothing downrange ever has.",
  },
  meteorlatch_crossbow: {
    id: 'meteorlatch_crossbow',
    name: "Meteorlatch, the Sky's Last Judgment",
    collection: S1.fallenStar,
    rarity: 'legendary',
    weaponType: 'crossbow',
    model: 'meteorlatch_the_sky_s_last_judgment',
    priceUsd: 50,
    season: 1,
    look: 'Meteoric star-metal, molten-gold core along the tiller, cosmos-black limbs etched with constellations, a nocked bolt of pure starfire.',
    lore: "Forged of raw meteoric star-metal while the Mirefen crater still glowed, debris 'too hot to handle,' hammered into limbs of cosmos-black etched with constellations, a molten-gold core banked along the tiller. It nocks no bolt but conjures one: a shaft of starfire, loosed like a verdict and landing like the end of one. When Highwatch feared even the deathless crown of Nythraxis might not be the worst thing beneath the peaks, this is the weapon they wanted on the wall. Aim it well.",
  },
};

export const WEAPON_SKIN_LIST: readonly WeaponSkinDef[] = Object.values(WEAPON_SKINS);

export const WEAPON_SKIN_COLLECTIONS: readonly string[] = [
  S1.guildmark,
  S1.emberwrought,
  S1.hoarfrost,
  S1.fallenStar,
];

export function weaponSkinClaudiumCost(def: WeaponSkinDef): number {
  return def.priceUsd * WEAPON_SKIN_CLAUDIUM_PER_USD;
}
