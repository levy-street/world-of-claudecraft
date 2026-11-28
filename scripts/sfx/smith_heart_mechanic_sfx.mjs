// The Smith's Heart: every mechanic a player reacts to gets its own sound
// (Jose's AAA pass of 2026-11-05). Generated with the ElevenLabs Sound Effects
// API through scripts/gen_sfx.mjs and conformed like every other cue; spread
// into the SFX catalog by sfx_prompts.mjs.
//
// Two families, told apart by ear on purpose:
//   a WARNING  tells you to move: a swelling, rising, tonal build with no hit
//              (a mark landing on you, a line drawn, a floor heating, a bar)
//   an IMPACT  tells you that you got hit: a hard transient (a slam, a burst,
//              a strike, an eruption)
// Played by the fights' audio cores in src/game/smith_heart_*_audio_core.ts.

const NO = 'No music, no voice.';
const warn = (key, duration, prompt) => ({ key, duration, prompt: `${prompt} ${NO}` });
const hit = (key, duration, prompt) => ({
  key,
  duration,
  prompt: `${prompt} Single event. ${NO}`,
});
const loop = (key, duration, prompt) => ({
  key,
  duration,
  loop: true,
  prompt: `${prompt} Constant and seamlessly loopable. ${NO}`,
});

// --- Personal marks: a mechanic chose YOU (played in your own ear), one per
// element so the raid learns the four by ear.
const MARKS = [
  warn(
    'heart_mark_stone',
    1.4,
    'A rising warning swell of stone around one person: starting soft, a low grinding hum of rock and trembling grit grows steadily louder to the very end. No hit at the start, no crash, no impact.',
  ),
  warn(
    'heart_mark_storm',
    1.4,
    'An ominous warning of static charge gathering around one person: an electric hum swelling and rising in pitch, sharp crackles building. No thunder, no impact.',
  ),
  warn(
    'heart_mark_frost',
    1.4,
    'An ominous warning of frost closing on one person: a cold glassy ringing tone swelling, ice crystals crackling and creeping. No shatter, no impact.',
  ),
  warn(
    'heart_mark_fire',
    1.4,
    'An ominous warning of fire kindling around one person: a hissing ignition swelling into the rising roar of forge bellows, embers crackling. No explosion, no impact.',
  ),
];

// --- The Hammer Council.
const COUNCIL = [
  warn(
    'heart_council_rush_windup',
    2,
    'A huge stone giant planting its feet and gathering itself to charge: deep grinding of rock under strain, gravel scraping, a rumble rising in tension. No impact.',
  ),
  hit(
    'heart_council_rush_impact',
    1.8,
    'A colossal stone giant charging and crashing into rock: a thunderous body slam, boulders smashing apart, stone debris spraying.',
  ),
  hit(
    'heart_council_bond_pulse',
    1.5,
    'Two great standing stones resonating together: a deep doubled thrum of earth power pulsing outward, a heavy throb felt in the chest.',
  ),
  hit(
    'heart_council_resonance',
    1.2,
    'A crystal ore vein ringing out from a person: a bright piercing crystalline ring with a shimmering stone hum.',
  ),
  warn(
    'heart_council_shelter_strain',
    1.5,
    'A heavy stone pillar groaning under far too much weight: a continuous loud strained creaking groan of stone with fine cracks ticking and grit trickling, tense and present the whole time. No collapse.',
  ),
];

// --- The Guardian of the Breath: the Knotted Gale (mythic), the Summit Roar,
// the Islands of the Wind.
const BREATH = [
  hit(
    'heart_breath_knot_spawn',
    1.8,
    'A tight ball of storm wind knotting itself together and dropping onto stone: a swirling whoosh pulling in and condensing, a soft heavy thump, static crackling.',
  ),
  hit(
    'heart_breath_knot_take',
    1,
    'Someone seizing a ball of tightly bound wind: a sharp gust snapping into their hands, a heavy whooshing grip.',
  ),
  loop(
    'heart_breath_knot_carry_loop',
    3,
    'A continuous swirling vortex of storm wind, an even churning whoosh at steady volume with a low rumble and faint static crackle.',
  ),
  warn(
    'heart_breath_knot_fuse',
    2,
    'A ball of storm wind straining to burst: a rising whistling shriek of compressed air, pressure building fast, crackling. No explosion.',
  ),
  hit(
    'heart_breath_knot_throw',
    1.5,
    'A ball of storm wind hurled out over a cliff into the void: a strong throwing whoosh trailing away and fading far into the distance.',
  ),
  hit(
    'heart_breath_knot_burst',
    2.5,
    'A compressed ball of storm wind exploding: the blast hits at the very first instant, a violent concussive boom of air and thunder, then a roaring shockwave of wind decaying across a mountaintop.',
  ),
  warn(
    'heart_breath_portal_open',
    2,
    'A swirling portal of wind tearing open on stone: a rising spiralling vortex whoosh and a hollow resonant hum as it holds steady.',
  ),
  hit(
    'heart_breath_portal_hop',
    1.2,
    'Stepping through a portal of wind: a sudden sucking whoosh, a hollow pop, and a gust spitting out on the other side.',
  ),
  hit(
    'heart_breath_summit_roar',
    3,
    'A colossal blast of wind hurled from the throat of a mountain: a deep thunderous rush of air blasting outward, rumbling and howling, grit and pebbles flying. No creature voice.',
  ),
  hit(
    'heart_breath_roar_hit',
    1.2,
    'A wall of wind slamming into a person and flinging them: a heavy buffeting thump of air and a sharp whoosh hurling away.',
  ),
  hit(
    'heart_breath_ride_up',
    2,
    'A rising column of wind lifting people off a cliff into the sky: a powerful upward whoosh, a howling gust spiralling higher.',
  ),
  loop(
    'heart_breath_ride_loop',
    4,
    'Flying high through open sky carried by a gale: steady rushing wind past the ears, cloth flapping, distant howling.',
  ),
  hit(
    'heart_breath_ride_down',
    1.5,
    'Being set down by a gust of wind onto a rock island: a descending whoosh softening into a firm thump of boots on stone.',
  ),
  hit(
    'heart_breath_bulwark_up',
    2,
    'A wall of hardened wind forming around a stone giant: a rising spiralling roar of air locking into a dense humming barrier.',
  ),
  hit(
    'heart_breath_bulwark_break',
    2,
    'A barrier of hardened wind breaking apart: a sharp crack of released pressure and a roaring gust scattering in all directions.',
  ),
  hit(
    'heart_breath_isle_wake',
    1.5,
    'Wind spirits forming on a floating rock island: a swirling whoosh gathering into shapes, a soft rising howl.',
  ),
];

// --- The Guardian of the Quench: the slashes, the cold, the immunity cracked,
// The Blades Hunt (mythic).
const QUENCH = [
  warn(
    'heart_quench_slash_warn',
    2.5,
    'A sustained eerie ringing hum of a giant glass blade of ice vibrating, one continuous cold tone with a shimmering frosty edge, steady for the whole sound and slowly intensifying. No hit, no impact, no whoosh.',
  ),
  warn(
    'heart_quench_slash_lock',
    0.8,
    'A blade of ice locking onto its line: a sharp crystalline click and a high cold ring cut short.',
  ),
  hit(
    'heart_quench_slash',
    1.5,
    'A giant blade of ice flying past and slicing through: a fast screaming whoosh of cutting air, a brittle shattering slash, frost spraying.',
  ),
  warn(
    'heart_quench_cold_warn',
    1.5,
    'Frost creeping over armour and skin: a soft crackle of ice forming, a cold hiss and a low shivering wind.',
  ),
  warn(
    'heart_quench_cold_danger',
    2,
    'Ice tightening fast around a body about to freeze solid: loud creaking crackles of thickening ice, a rising glassy strain, urgent.',
  ),
  hit(
    'heart_quench_bite',
    1.2,
    'A glowing magical ice shield cracking under a deeper cold: a sharp magical shatter, frost biting through with a crunch.',
  ),
  warn(
    'heart_quench_hunt_start',
    3,
    'Four giant blades of ice screaming awake and taking flight: a rising chorus of resonating ice, a roaring cold whoosh, ice cracking everywhere.',
  ),
  loop(
    'heart_quench_hunt_loop',
    4,
    'Giant blades of ice circling fast over a frozen lake at constant volume: steady repeated whooshing passes of cutting air, glassy ringing and crackling frost, no fade in or out.',
  ),
];

// --- The Guardian of the Heat: its own takes (the 2026-10-27 rebuild's
// prompts, borrowed samples until now), plus Cinder Grip and the Wheel.
const HEAT = [
  warn(
    'heart_heat_fist_charge',
    3,
    'A colossal fist of stone and crystal rising and drawing back over a burning pool: a deep grinding of basalt, a rising roar of fire gathering power, crystal humming louder.',
  ),
  hit(
    'heart_heat_fist_land',
    2.5,
    'A gigantic fist of basalt slamming into a stone floor: a thunderous ground-shaking impact, rock cracking and bursting, a whoomph of white-gold fire, debris raining down.',
  ),
  hit(
    'heart_heat_swell',
    3,
    'A wall of molten rock rolling fast across a stone floor: a heavy grinding surge of lava, a crackling roar of fire cresting, hissing spatter.',
  ),
  hit(
    'heart_heat_flare',
    1,
    'A bolt of white-hot fire hurled across a hall and striking a body: a sharp searing whoosh and a crackling hit of flame.',
  ),
  hit(
    'heart_heat_sink',
    2.5,
    'A giant of stone and fire sinking into a pool of lava: a huge deep gurgling plunge, molten rock heaving and splashing, a long bubbling settle.',
  ),
  hit(
    'heart_heat_rise',
    3,
    'A giant of stone and fire rising out of a pool of lava: molten rock sheeting off stone, a deep heaving surge, a rising roar of flame.',
  ),
  warn(
    'heart_heat_river',
    2,
    'A river of white-gold fire bursting out of a pool and rushing across stone: a short hot rush of flowing flame, crackling and hissing. Soft.',
  ),
  hit(
    'heart_heat_bolt',
    0.8,
    'A small ember falling from above and striking: a short falling whistle and a soft crackling pop of fire.',
  ),
  hit(
    'heart_heat_spawn',
    1.2,
    'A small creature of fire climbing out of cracked stone: a bubbling crackle of flame, stone scraping, a soft whoosh.',
  ),
  hit(
    'heart_heat_feed',
    2,
    'A creature of fire diving into a great pool of flame and the pool flaring: a deep whoomph, a blast of fire roaring outward, a heavy rumble.',
  ),
  warn(
    'heart_heat_kindling',
    1,
    'A burning sigil marking a person: a bright crackling ignition, a rising hiss of kindling catching fire.',
  ),
  warn(
    'heart_heat_seed',
    0.8,
    'A glowing seed of fire landing on stone: a soft heavy thud and a low throbbing hum of heat.',
  ),
  hit(
    'heart_heat_seed_burst',
    1.5,
    'A seed of fire bursting: a deep concussive detonation of flame, a crackling shockwave rolling outward.',
  ),
  hit(
    'heart_heat_hatch',
    1,
    'A small fire spirit hatching from a burst of flame: a crackling pop and a bright fluttering whoosh.',
  ),
  warn(
    'heart_heat_zone_build',
    4,
    'Sizzling red-hot stone and a low rumbling roar of heat from a forge floor, sustained and continuous for the whole four seconds, crackling and hissing, slowly intensifying. No explosion.',
  ),
  hit(
    'heart_heat_ignite',
    2,
    'A whole band of floor erupting into a sheet of fire: a massive roaring whoosh of flame bursting upward, a crackling tail.',
  ),
  hit(
    'heart_heat_cinder_land',
    2,
    'A huge living fireball crashing down onto stone: a heavy thunderous impact, a burst of roaring flame, rock cracking.',
  ),
  loop(
    'heart_heat_cinder_roll',
    3,
    'A great ball of fire rolling slowly across stone: a deep rumbling roll, crackling and hissing flame, a low menacing roar.',
  ),
  hit(
    'heart_heat_cinder_knock',
    0.8,
    'A great ball of fire struck hard and knocked back: a heavy thump, a crack of cooling crust, a burst of sparks.',
  ),
  hit(
    'heart_heat_cinder_burst',
    2,
    'A great ball of fire exploding on contact: a blinding thunderous blast of flame, a roaring shockwave, a long crackling tail.',
  ),
  hit(
    'heart_heat_settle',
    3,
    'A great pool of fire settling calm after a battle: a long low sigh of dying flame, molten rock cooling and ticking, stone settling.',
  ),
  hit(
    'heart_heat_grip',
    1,
    'A searing brand of fire biting into plate armour: a sharp sizzle and hiss of burning metal, embers crackling.',
  ),
  warn(
    'heart_heat_wheel_warn',
    4,
    'Wide slices of stone floor round a pool of lava heating to eruption: a deep rising rumble, glowing cracks hissing and ticking, pressure building. No explosion.',
  ),
  hit(
    'heart_heat_wheel_erupt',
    2,
    'Wide slices of a stone floor erupting into fire: a massive roaring burst of flame and molten rock bursting upward, a crackling tail.',
  ),
];

// --- The Masterless Strength (the final boss): the quarters, the Overload, the
// kits, the intermissions, the final phase and Mythic's hidden phase.
const FINAL = [
  hit(
    'heart_final_quarter_shift',
    2,
    'A giant crystal heart of stone taking root in new ground: a deep crunch of rock roots stabbing into stone, a resonant crystalline chord swelling.',
  ),
  hit(
    'heart_final_vein_shock',
    1.8,
    'A shockwave of raw earth magic surging through crystal veins in a stone floor: a deep electric-stone boom and a crackling ripple racing outward.',
  ),
  warn(
    'heart_final_overload_rising',
    3,
    'A great crystal straining with too much power: a rising whining resonance, crackling energy, stone groaning, tension building to the edge. No explosion.',
  ),
  hit(
    'heart_final_overload_pulse',
    1,
    'A heavy pulse of raw energy from a giant crystal heart: one deep throbbing thump with a crystalline shimmer.',
  ),
  hit(
    'heart_final_overload_burst',
    3,
    'A giant crystal heart bursting with power: the blast hits at the very first instant, a concussive boom and shattering crystal, then a rolling roar of released energy decaying through a stone hall.',
  ),
  hit(
    'heart_final_unbound',
    1.2,
    'A crystal giant burning with unbound power: a fierce roaring flare of energy, crackling and throbbing.',
  ),
  warn(
    'heart_final_anvil_warn',
    5,
    'A colossal iron anvil hanging overhead on straining chains: heavy metal creaks and groans from the very first moment, a deep hum rising steadily for the whole sound, loudest at the end. No impact.',
  ),
  hit(
    'heart_final_anvil_fall',
    2.5,
    'A colossal iron anvil slamming down onto stone: an enormous metallic clang and a crushing boom, the ground shaking, debris scattering.',
  ),
  warn(
    'heart_final_tremor_warn',
    2,
    'The ground cracking open under someone: a continuous deep grinding rumble of splitting stone that builds steadily for the whole sound, ticks and pebbles skittering faster, loudest at the end. No eruption.',
  ),
  hit(
    'heart_final_tremor',
    1.5,
    'Stone erupting upward out of a crack in the floor: a violent rocky burst, a deep crunch and gravel spraying.',
  ),
  hit(
    'heart_final_whirl',
    1.5,
    'A spinning column of fire sweeping into a person: a roaring whoosh of flame and a crackling burning hit.',
  ),
  hit(
    'heart_final_orb_take',
    1.2,
    'Stepping onto an orb of storm energy and absorbing it: a crackling electric zap pulled inward, a bright sizzling pop.',
  ),
  hit(
    'heart_final_stone_shell',
    1.5,
    'Stone closing around a person like a shell: from the first instant, rock plates grind quickly together and lock with a dull heavy thud.',
  ),
  warn(
    'heart_final_bolt_charge',
    2,
    'Sustained crackling electricity and a buzzing electric hum gathering between two stone hands, continuous for the whole sound and slowly intensifying. No thunder, no strike.',
  ),
  hit(
    'heart_final_stride',
    2.5,
    'A giant of stone and crystal striding heavily across a hall: thunderous footsteps shaking the floor, a rushing whoosh of elemental energy trailing.',
  ),
  hit(
    'heart_final_shield_up',
    2,
    'A dome of shimmering crystal energy closing over a giant: a rising resonant hum locking into place, layered elemental shimmer.',
  ),
  hit(
    'heart_final_splinter_rise',
    2,
    'An elemental creature clawing up out of a stone floor: rock bursting, a rush of elemental energy, debris raining.',
  ),
  hit(
    'heart_final_pour',
    2.5,
    'Raw elemental energy pouring into a giant: a streaming rush of power flowing in, a deep swelling hum ending in a heavy surge.',
  ),
  warn(
    'heart_final_shear_warn',
    2,
    'A giant elemental creature drawing back for a huge cleaving blow: a heavy grinding wind-up, air pulled back in a rising whoosh, tension. No impact.',
  ),
  hit(
    'heart_final_shear',
    1.5,
    'A massive cleaving blow of stone and elemental power: a brutal sweeping whoosh ending in a crushing slash, rock cracking.',
  ),
  hit(
    'heart_final_toll',
    2.5,
    'A great bell made of ice ringing out once across a hall: a deep frozen toll with a glassy shimmering decay and frost crackle.',
  ),
  hit(
    'heart_final_shield_break',
    2,
    'A dome of crystal energy shattering: a huge bright crystalline smash, shards ringing and scattering, a rush of released power.',
  ),
  hit(
    'heart_final_awaken',
    3.5,
    'Four elemental forces awakening at once round a great hall: fire roaring, wind howling, ice cracking, stone rumbling together, swelling into a massive deep surge.',
  ),
  hit(
    'heart_final_fury',
    1.5,
    'A crystal giant raging with unchecked power: a violent throbbing blast of energy, crackling and roaring.',
  ),
  hit(
    'heart_final_mix_turn',
    1.5,
    'A huge forge anvil struck once deep underground: a heavy resonant metallic boom with a long humming crystal ring.',
  ),
  hit(
    'heart_final_kneel',
    3.5,
    'A giant crystal heart faltering and dying down: a long descending groan of failing energy, crystal dimming with fading crackles, a heavy collapse into silence.',
  ),
  hit(
    'heart_final_rebirth',
    5,
    'A huge crystal heart beating back to life: slow thunderous heartbeats speeding up and swelling, elemental energy rushing in, a rising roar.',
  ),
  warn(
    'heart_final_unmade',
    3,
    'A vast stone platform starting to break apart: a deep fracturing rumble beneath, huge cracks splitting, dust pouring, ominous.',
  ),
  warn(
    'heart_final_quarter_crack',
    4,
    'A huge section of stone floor cracking before it falls: deep groaning stone, spreading cracks snapping and popping, gravel pouring into a void below, rising tension.',
  ),
  hit(
    'heart_final_quarter_fall',
    4,
    'An enormous section of stone floor breaking away and falling into a deep abyss: a thunderous crack, a massive grinding collapse, rubble tumbling away into the depths.',
  ),
  hit(
    'heart_final_body_fall',
    2.5,
    'Falling down into a deep dark cavern: rushing air howling past and growing fainter, a long fall, a faint distant rumble far below.',
  ),
  hit(
    'heart_final_rebuild',
    3,
    'Broken stone floor rising back up and fitting together: heavy rocks grinding and lifting, locking into place with deep thuds, a swelling magical hum.',
  ),
];

export const SMITH_HEART_MECHANIC_SFX = [
  ...MARKS,
  ...COUNCIL,
  ...BREATH,
  ...QUENCH,
  ...HEAT,
  ...FINAL,
];
