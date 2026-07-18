// Authoritative sound-effect catalog — consumed by scripts/gen_sfx.mjs.
// Each entry: { key, prompt, duration (seconds 0.5 to 30), loop?, generator?,
// custom?, stereo? }. Additional takes are discovered from <key>_1.mp3,
// <key>_2.mp3, and so on. The runtime cycles those files in numeric order.
// Human-readable design + spatial behaviour: docs/design/sound_effects.md.
//
// stereo: true keeps the published asset two-channel. It is set only on global
// ambience beds whose L/R width is audible and which never pass through a
// positional panner. Point ambience (campfire/forge) and every other cue are
// mono (positional playAt downmixes to
// mono, personal playUi sums to the mono master), so the conform step in
// gen_sfx.mjs encodes it single-channel. This is the channel half of the asset
// standard checked by scripts/sfx_conform.mjs and documented in
// docs/design/sound_effects.md.
//
// Keys map to public/audio/sfx/<key>.mp3 and to src/game/sfx_manifest.generated.ts.
// Prompts are written for the ElevenLabs Sound Effects model: concise, concrete,
// single-event, "no music, no speech" where it matters. Footsteps/impacts are ONE
// hit (the engine pitch-randomizes and alternates to avoid repetition).

import { UI_SFX_CATALOG } from './ui_sfx.mjs';

// UI cues in the baked-tone generator's list that already have a real
// recording dropped in over the synth placeholder (see gen_ui_sfx.mjs's
// skip-if-exists behavior). Add a key here the same change a real recording
// replaces its placeholder, so conform stops re-targeting its loudness.
const UI_SFX_CUSTOM_OVERRIDES = new Set(['ui_level_up']);

const FOOT = (key, surface) => ({
  key,
  custom: true,
  duration: 0.5,
  prompt: `A single isolated footstep ${surface}. One step only, close and dry, no music, no voice.`,
});

// idle is optional: a family only gets a mob_<family>_idle catalog entry once
// its idle recording is actually ready. Not calling mob() with an idle prompt
// leaves that family out of the catalog entirely, so an unready family is
// never flagged as a missing or unrecognized sfx file.
const mob = (family, who, aggro, attack, death, hurt, idle) => {
  for (const [name, value] of Object.entries({ family, who, aggro, attack, death, hurt })) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`mob('${family}', ...): missing or invalid '${name}' argument`);
    }
  }
  if (idle !== undefined && (typeof idle !== 'string' || idle.length === 0)) {
    throw new Error(`mob('${family}', ...): invalid 'idle' argument`);
  }
  const entries = [
    {
      key: `mob_${family}_aggro`,
      custom: true,
      duration: 1.2,
      prompt: `${who} ${aggro}. A single short creature vocalization, no music, no human speech.`,
    },
    {
      key: `mob_${family}_attack`,
      custom: true,
      duration: 0.9,
      prompt: `${who} ${attack}. A single short aggressive vocalization, no music, no human speech.`,
    },
    {
      key: `mob_${family}_death`,
      custom: true,
      duration: 1.4,
      prompt: `${who} ${death}. A single dying vocalization fading out, no music, no human speech.`,
    },
    {
      key: `mob_${family}_hurt`,
      custom: true,
      duration: 0.6,
      prompt: `${who} ${hurt}. A single short pained reaction vocalization, no music, no human speech.`,
    },
  ];
  if (idle !== undefined) {
    entries.push({
      key: `mob_${family}_idle`,
      custom: true,
      duration: 1.6,
      prompt: `${who} ${idle}. A single relaxed ambient vocalization, no aggression, no music, no human speech.`,
    });
  }
  return entries;
};

export const SFX = [
  // --- Movement & footsteps -------------------------------------------------
  FOOT('foot_grass', 'on soft grass and dry leaves, light leather boot'),
  FOOT('foot_dirt', 'in wet mud and soft dirt, faint squelch'),
  FOOT('foot_stone', 'on hard stone and loose gravel, gritty scrape'),
  FOOT('foot_wood', 'on hollow wooden planks, dull creak'),
  FOOT('foot_snow', 'crunching into fresh deep snow, soft compression'),
  FOOT('foot_water', 'splashing through shallow water, wet splash'),
  {
    key: 'move_jump',
    custom: true,
    duration: 0.5,
    prompt:
      'A person leaping upward: a quick exertion of leather and gear with a soft fabric rustle. No voice, no music.',
  },
  {
    key: 'move_land',
    custom: true,
    duration: 0.6,
    prompt:
      'A person landing from a jump: boots thud onto the ground with armor and gear settling. No voice, no music.',
  },
  {
    key: 'move_splash',
    custom: true,
    duration: 0.9,
    prompt: 'A body plunging into water with a big heavy splash, then settling ripples. No music.',
  },
  {
    key: 'move_swim',
    custom: true,
    duration: 0.8,
    prompt: 'One slow swimming stroke pushing through water, a gentle churning splash. No music.',
  },

  // --- Melee swings ---------------------------------------------------------
  {
    key: 'melee_swing_blade',
    custom: true,
    duration: 0.5,
    prompt:
      'A sword slicing fast through the air, a sharp metallic whoosh. Single swing, no impact, no music.',
  },
  {
    key: 'melee_swing_heavy',
    custom: true,
    duration: 0.6,
    prompt:
      'A heavy two-handed axe swung hard through the air, a deep powerful whoosh. Single swing, no impact, no music.',
  },
  {
    key: 'melee_swing_light',
    custom: true,
    duration: 0.5,
    prompt:
      'A small dagger slashing quickly through the air, a light fast whoosh. Single swing, no impact, no music.',
  },
  {
    key: 'melee_unarmed',
    custom: true,
    duration: 0.5,
    prompt:
      'A fist or claw swiping fast through the air, a dull quick whoosh. Single swing, no music.',
  },
  {
    key: 'melee_bow',
    custom: true,
    duration: 0.5,
    prompt:
      'A bowstring releasing with a twang and an arrow zipping away fast. Single shot, no music.',
  },

  // --- Physical impacts & defenses -----------------------------------------
  {
    key: 'impact_flesh',
    custom: true,
    duration: 0.5,
    prompt: 'A blade striking flesh, a wet meaty thud. Single hit, no music.',
  },
  {
    key: 'impact_metal',
    custom: true,
    duration: 0.5,
    prompt:
      'A weapon clanging hard against steel plate armor, a bright metallic ring. Single hit, no music.',
  },
  {
    key: 'impact_leather',
    custom: true,
    duration: 0.5,
    prompt: 'A weapon striking leather armor and hide, a dull padded thud. Single hit, no music.',
  },
  {
    key: 'impact_bone',
    custom: true,
    duration: 0.5,
    prompt: 'A weapon cracking dry bone, a sharp brittle crack. Single hit, no music.',
  },
  {
    key: 'combat_block',
    custom: true,
    duration: 0.5,
    prompt: 'A shield blocking a heavy blow, a metallic clank. Single hit, no music.',
  },
  {
    key: 'combat_parry',
    custom: true,
    duration: 0.5,
    prompt: 'Two metal blades clashing and sliding apart, a ringing parry. Single hit, no music.',
  },
  {
    key: 'combat_dodge',
    custom: true,
    duration: 0.5,
    prompt:
      'A fast whoosh of an attack swinging past and missing, a clean whiff. No impact, no music.',
  },
  {
    key: 'combat_crit',
    custom: true,
    duration: 0.6,
    prompt:
      'A brutal devastating critical strike: a heavy bone-crunching impact with a sharp metallic ring. Single hit, no music.',
  },
  {
    key: 'player_hurt',
    custom: true,
    duration: 0.6,
    prompt: 'A human warrior grunting in sudden sharp pain from taking a hit. Single short grunt.',
  },
  {
    key: 'player_death',
    custom: true,
    duration: 1.3,
    prompt:
      "A human warrior's final pained death cry as he collapses to the ground. Single death cry fading out.",
  },

  // --- Spell casts (looping while channeling) ------------------------------
  {
    key: 'cast_fire',
    duration: 2.0,
    loop: true,
    prompt:
      'A building roar of fire being conjured: crackling flames gathering and intensifying. Seamless loop, no music.',
  },
  {
    key: 'cast_frost',
    duration: 2.0,
    loop: true,
    prompt:
      'Ice crystals forming and crackling: a cold frosty shimmer building. Seamless loop, no music.',
  },
  {
    key: 'cast_arcane',
    duration: 2.0,
    loop: true,
    prompt:
      'Ethereal arcane energy humming and shimmering, a magical resonance building. Seamless loop, no music.',
  },
  {
    key: 'cast_shadow',
    duration: 2.0,
    loop: true,
    prompt:
      'Dark shadow magic whispering: an ominous low void hum building. Seamless loop, no music.',
  },
  {
    key: 'cast_holy',
    duration: 2.0,
    loop: true,
    prompt:
      'A holy golden light building: a soft angelic shimmer and glow. Seamless loop, no music.',
  },
  {
    key: 'cast_nature',
    duration: 2.0,
    loop: true,
    prompt:
      'Earthy nature magic growing: rustling leaves and a low primal hum building. Seamless loop, no music.',
  },
  // Per-ability cast loop override (custom recording, not ElevenLabs). See
  // castKeyForAbility in src/ui/hud.ts: lightning_bolt uses this clip instead
  // of its school default (arcane).
  { key: 'cast_lightning_bolt', custom: true, loop: true },
  // Chain Heal's one-shot cast clip (custom recording). See src/ui/hud.ts:
  // the castStart handler plays this instead of the nature cast loop.
  { key: 'cast_chain_heal', custom: true, loop: false },

  // --- Spell projectiles ----------------------------------------------------
  {
    key: 'proj_fire',
    custom: true,
    duration: 0.6,
    prompt:
      'A fireball launching and whooshing away through the air, roaring flame. Single launch, no music.',
  },
  {
    key: 'proj_frost',
    custom: true,
    duration: 0.6,
    prompt: 'A frostbolt streaking through the air, an icy crystalline zip. Single shot, no music.',
  },
  {
    key: 'proj_arcane',
    custom: true,
    duration: 0.5,
    prompt:
      'An arcane missile zapping through the air, a magical electric zip. Single shot, no music.',
  },
  {
    key: 'proj_shadow',
    custom: true,
    duration: 0.6,
    prompt:
      'A shadow bolt flying through the air, a dark whooshing void streak. Single shot, no music.',
  },
  {
    key: 'proj_holy',
    custom: true,
    duration: 0.5,
    prompt:
      'A bolt of holy light streaking through the air, a bright shimmering zip. Single shot, no music.',
  },
  {
    key: 'proj_nature',
    custom: true,
    duration: 0.5,
    prompt:
      'A glob of nature energy flying through the air, an organic whoosh. Single shot, no music.',
  },

  // --- Spell impacts --------------------------------------------------------
  {
    key: 'impact_fire',
    custom: true,
    duration: 0.8,
    prompt:
      'A fireball exploding on impact, a fiery burst with crackling flames. Single explosion, no music.',
  },
  {
    key: 'impact_frost',
    custom: true,
    duration: 0.7,
    prompt:
      'Ice shattering and freezing on impact, a crystalline crack and tinkle. Single hit, no music.',
  },
  {
    key: 'impact_arcane',
    custom: true,
    duration: 0.6,
    prompt: 'An arcane burst exploding, a sparkly magical detonation. Single hit, no music.',
  },
  {
    key: 'impact_shadow',
    custom: true,
    duration: 0.7,
    prompt: 'A shadow spell imploding darkly, an ominous magical burst. Single hit, no music.',
  },
  {
    key: 'impact_holy',
    custom: true,
    duration: 0.7,
    prompt: 'A radiant burst of holy light, a shimmering divine impact. Single hit, no music.',
  },
  {
    key: 'impact_nature',
    custom: true,
    duration: 0.7,
    prompt:
      'An earthy nature impact, a wet splat of poison and snapping vines. Single hit, no music.',
  },
  {
    key: 'spell_nova',
    custom: true,
    duration: 0.9,
    prompt:
      'An expanding magical nova shockwave bursting outward in all directions. Single burst, no music.',
  },

  // --- Heals & auras --------------------------------------------------------
  {
    key: 'heal_impact',
    custom: true,
    duration: 0.8,
    prompt:
      'A gentle healing spell washing over someone, a soft restorative chime and warm glow. Single effect, no music.',
  },
  {
    key: 'buff_apply',
    custom: true,
    duration: 0.7,
    prompt:
      'An empowering positive magical buff settling on a hero, an uplifting bright shimmer. Single effect, no music.',
  },
  {
    key: 'debuff_apply',
    custom: true,
    duration: 0.7,
    prompt:
      'An ominous dark curse settling on a target, a sickly negative whoosh. Single effect, no music.',
  },

  // --- Creature vocalizations ----------------------------------------------
  ...mob(
    'beast',
    'A wolf',
    'snarling with an alert growl',
    'lunging with a vicious biting snarl',
    'yelping and whimpering as it dies',
    'yelping sharply in sudden pain',
    'panting quietly with a low idle whine',
  ),
  ...mob(
    'boar',
    'A wild boar',
    'snorting angrily and squealing',
    'charging with a furious grunt',
    'squealing as it dies',
    'squealing sharply in sudden pain',
    'snorting and shuffling calmly',
  ),
  ...mob(
    'spider',
    'A giant spider',
    'hissing and chittering in alarm',
    'lunging with a sharp hiss',
    'hissing weakly as it shrivels and dies',
    'chittering sharply in sudden pain',
    'clicking mandibles softly in an idle chitter',
  ),
  ...mob(
    'mudfin',
    'A murloc fish-man',
    'warbling a startled gurgling cry',
    'croaking and gurgling as it strikes',
    'gurgling a wet death rattle',
    'croaking sharply in sudden pain',
    'gurgling low and contentedly',
  ),
  ...mob(
    'burrower',
    'A small kobold',
    'yipping a startled bark',
    'snarling and biting',
    'squealing as it dies',
    'yelping sharply in sudden pain',
    'sniffing and grunting idly',
  ),
  ...mob(
    'humanoid',
    'A bandit',
    'shouting an angry war cry',
    'grunting with effort as he strikes',
    'crying out in pain as he dies',
    'grunting sharply in sudden pain',
    'muttering and shifting restlessly',
  ),
  ...mob(
    'undead',
    'A skeleton',
    'rattling its bones with a hollow groan',
    'moaning hollowly as it strikes',
    'clattering apart into a pile of bones',
    'rattling sharply in sudden impact',
    'creaking and groaning low',
  ),
  ...mob(
    'troll',
    'A troll',
    'roaring a guttural alert',
    'grunting savagely as it strikes',
    'groaning heavily as it dies',
    'grunting sharply in sudden pain',
    'grunting low and idle',
  ),
  ...mob(
    'ogre',
    'A huge ogre',
    'bellowing a deep alert roar',
    'grunting heavily as it smashes down',
    'groaning a ground-shaking death',
    'bellowing sharply in sudden pain',
    'grumbling low in a lazy idle',
  ),
  ...mob(
    'elemental',
    'An energy elemental',
    'crackling with a humming alert surge',
    'bursting with surging energy as it strikes',
    'dissipating in a fading crackle',
    'crackling sharply in sudden disruption',
    'humming a low idle crackle',
  ),
  ...mob(
    'dragonkin',
    'A dragonkin',
    'roaring fiercely with a flap of wings',
    'snapping a biting roar as it strikes',
    'roaring as it collapses dying',
    'roaring sharply in sudden pain',
    'rumbling a low idle growl',
  ),
  ...mob(
    'demon',
    'A demon',
    'snarling with a sinister hiss',
    'shrieking a demonic strike',
    'wailing in agonized demonic death',
    'shrieking sharply in sudden pain',
    'hissing softly in an idle murmur',
  ),
  ...mob(
    'reptile',
    'A large reptilian predator',
    'hissing with a low guttural rasp',
    'shrieking with a sharp reptilian snap',
    'hissing weakly as it goes still',
    'hissing sharply in sudden pain',
    'breathing in a low idle rasp',
  ),

  // --- Ambient loops --------------------------------------------------------
  {
    key: 'amb_wind_vale',
    duration: 8,
    loop: true,
    stereo: true,
    prompt:
      'A gentle pleasant breeze through a green forest valley, soft wind and distant rustling leaves. Seamless loop, no music.',
  },
  {
    key: 'amb_wind_marsh',
    duration: 8,
    loop: true,
    stereo: true,
    prompt:
      'An eerie damp marshland: a low mournful breeze with distant frogs and insects. Seamless loop, no music.',
  },
  {
    key: 'amb_wind_peaks',
    duration: 8,
    loop: true,
    stereo: true,
    prompt:
      'A cold howling mountain wind across bleak high rocky peaks, gusty. Seamless loop, no music.',
  },
  {
    key: 'amb_birds',
    duration: 8,
    loop: true,
    stereo: true,
    prompt: 'Calm daytime forest ambience with gentle distant birdsong. Seamless loop, no music.',
  },
  {
    key: 'amb_water',
    duration: 6,
    loop: true,
    stereo: true,
    prompt:
      'Gentle lake water lapping at the shore with soft flowing ripples. Seamless loop, no music.',
  },
  {
    key: 'amb_campfire',
    duration: 5,
    loop: true,
    prompt: 'A crackling campfire with popping embers and steady flames. Seamless loop, no music.',
  },
  {
    key: 'amb_forge',
    duration: 6,
    loop: true,
    prompt:
      'A blacksmith forge: a roaring furnace with rhythmic hammer strikes ringing on an anvil. Seamless loop, no music.',
  },
  {
    key: 'amb_dungeon',
    duration: 8,
    loop: true,
    stereo: true,
    prompt:
      'A dark stone dungeon interior: echoing water drips and a low ominous drone. Seamless loop, no music.',
  },
  {
    key: 'amb_rain',
    duration: 8,
    loop: true,
    stereo: true,
    prompt:
      'Steady rainfall pattering on the ground with occasional distant thunder. Seamless loop, no music.',
  },
  {
    key: 'amb_snow',
    duration: 8,
    loop: true,
    stereo: true,
    prompt: 'A soft muffled snowy wind, quiet and cold. Seamless loop, no music.',
  },

  // --- Custom recordings (not ElevenLabs) ----------------------------------
  { key: 'quest_accept', custom: true },
  { key: 'quest_ready', custom: true },
  { key: 'quest_complete', custom: true },

  // --- Lockpick minigame (custom recordings, not ElevenLabs) ------------------
  // custom: true means gen_sfx.mjs will never call the API for these, even with
  // --force. Drop the MP3 into public/audio/sfx/ and add an entry here to register
  // any future custom recording in the same way.
  { key: 'lockpick_advanced_1', custom: true },
  { key: 'lockpick_advanced_2', custom: true },
  { key: 'lockpick_advanced_3', custom: true },
  { key: 'lockpick_advanced_4', custom: true },
  { key: 'lockpick_begin', custom: true },
  { key: 'lockpick_bind', custom: true },
  { key: 'lockpick_bonus', custom: true },
  { key: 'lockpick_end', custom: true },
  { key: 'lockpick_fail', custom: true },
  { key: 'lockpick_page_cleared', custom: true },
  { key: 'lockpick_retry', custom: true },
  { key: 'lockpick_slip', custom: true },
  { key: 'lockpick_success', custom: true },
  { key: 'lockpick_trap', custom: true },

  // --- Interface and event feedback ----------------------------------------
  // These are generated locally by scripts/gen_ui_sfx.mjs (baked synth tones,
  // the default until a real recording replaces one, see gen_ui_sfx.mjs's
  // skip-if-exists behavior). Keeping them in the authoritative catalog makes
  // every live GameAudio cue editable in SFX Studio. UI_SFX_CUSTOM_OVERRIDES
  // marks the keys that already have a real recording in place: conform
  // treats those as pre-mastered (peak-safety only, never loudness-retargeted,
  // see the `custom` flag's meaning in conform_audio.mjs), same as any other
  // hand-authored key below.
  ...UI_SFX_CATALOG.map((entry) =>
    UI_SFX_CUSTOM_OVERRIDES.has(entry.key) ? { ...entry, custom: true } : entry,
  ),

  // Book of Deeds unlock chime (custom recording, not ElevenLabs/generated).
  // Previously deed unlocks reused ui_level_up (audio.levelUp()), so the same
  // sound fired for both real level-ups and every achievement, wearing thin
  // fast. See handleDeedUnlocks in src/ui/hud.ts.
  { key: 'ui_achievement', custom: true },
  { key: 'temporal_clock', custom: true },

  // --- Wand auto-attacks (custom recordings, not ElevenLabs) ----------------
  // Distinct from the matching proj_<school> real-spell-cast sound, see
  // WAND_CUES in src/ui/combat_sfx.ts (feature/sfx-wand-attack-cues, #1973).
  { key: 'wand_arcane', custom: true },
  { key: 'wand_holy', custom: true },
  { key: 'wand_shadow', custom: true },
];

// Family ids that have creature vocalizations (used by the integration layer to
// know which mobs have sound; templateId overrides handled in code, e.g. boar).
export const MOB_VOICE_FAMILIES = [
  'beast',
  'boar',
  'spider',
  'mudfin',
  'burrower',
  'humanoid',
  'undead',
  'troll',
  'ogre',
  'elemental',
  'dragonkin',
  'demon',
  'reptile',
];
