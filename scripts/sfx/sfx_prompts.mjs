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

import { FURY_SFX } from './fury_sfx.mjs';
import { UI_SFX_CATALOG } from './ui_sfx.mjs';
import { WARRIOR_CONTACT_SFX } from './warrior_contact_sfx.mjs';
import { WARRIOR_FALLBACK_SFX } from './warrior_fallback_sfx.mjs';
import { WARRIOR_VOICE_SFX } from './warrior_voice_sfx.mjs';

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
  ...FURY_SFX,
  ...WARRIOR_CONTACT_SFX,
  ...WARRIOR_VOICE_SFX,
  ...WARRIOR_FALLBACK_SFX,
  // --- Movement & footsteps -------------------------------------------------
  FOOT('foot_grass', 'on soft grass and dry leaves, light leather boot'),
  FOOT('foot_dirt', 'in wet mud and soft dirt, faint squelch'),
  FOOT('foot_stone', 'on hard stone and loose gravel, gritty scrape'),
  FOOT('foot_wood', 'on hollow wooden planks, dull creak'),
  FOOT('foot_snow', 'crunching into fresh deep snow, soft compression'),
  FOOT('foot_water', 'splashing through shallow water, wet splash'),
  {
    key: 'mount_run_valorsteed',
    custom: true,
  },
  {
    key: 'mount_run_grag_bear',
    custom: true,
  },
  {
    key: 'mount_run_stalkglider_snail',
    custom: true,
  },
  {
    key: 'mount_run_aether_hover_cycle',
    custom: true,
  },
  {
    key: 'mount_run_shadowjump_toad',
    custom: true,
  },
  {
    key: 'mount_run_stormfeather_griffin',
    custom: true,
  },
  {
    key: 'mount_run_thunderstrut_gobbler',
    custom: true,
  },
  // The Lanternback Troll and the Chimeglass Tortoise deliberately have NO
  // mount_run_ entry. Both shipped synthesised cues and both read as cheap and
  // nagging at the mounted gallop's ~0.46s stride beat; rather than keep
  // tuning a synth, they now borrow the player's own surface footfall
  // (foot_<surface>) through Sfx.mountRun's fallback branch. A mount is opted
  // into that fallback purely by the ABSENCE of its key here, so adding one
  // back is all it takes to give either of them a bespoke stride again.
  // Wobbles the Slime (developer mount) borrows the footfall the same way
  // until a bespoke squelch is generated for it.
  {
    key: 'mount_run_goblin_rocket_sled_start',
    custom: true,
  },
  {
    key: 'mount_run_goblin_rocket_sled',
    custom: true,
    loop: true,
  },
  {
    // The sled's summon call, fired once when the summon channel completes and
    // the mount appears. Never on dismount, never for a rider already mounted
    // when they come into view.
    key: 'mount_summon_goblin_rocket_sled',
    custom: true,
  },
  {
    key: 'mount_run_goblin_rocket_sled_stop',
    custom: true,
  },
  {
    key: 'mount_run_goblin_rocket_sled_reverse_start',
    custom: true,
  },
  {
    key: 'mount_run_goblin_rocket_sled_reverse',
    custom: true,
    loop: true,
  },
  {
    key: 'mount_run_goblin_rocket_sled_reverse_stop',
    custom: true,
  },
  {
    key: 'mount_summon_rallycart_rxt',
    custom: true,
  },
  {
    key: 'mount_run_rallycart_rxt_idle',
    custom: true,
    loop: true,
  },
  {
    key: 'mount_run_rallycart_rxt_start',
    custom: true,
  },
  {
    key: 'mount_run_rallycart_rxt',
    custom: true,
    loop: true,
  },
  {
    key: 'mount_run_rallycart_rxt_stop',
    custom: true,
  },
  // Reverse, the same three-part shape the sled uses. The engine builds these
  // key names generically (`mount_run_<mountKey>_reverse*`), so the takes were
  // on disk and reachable by code but absent from this catalog, which meant
  // they were never in SFX_CLIPS and reversing the cart was silent.
  {
    key: 'mount_run_rallycart_rxt_reverse_start',
    custom: true,
  },
  {
    key: 'mount_run_rallycart_rxt_reverse',
    custom: true,
    loop: true,
  },
  {
    key: 'mount_run_rallycart_rxt_reverse_stop',
    custom: true,
  },
  {
    // Takeoff and touchdown for the cart, five and four takes respectively.
    // A mount that carries no jump/land set falls back to the rider's own
    // move_jump/move_land, so these two keys are the whole opt-in: no shipped
    // mount changes behavior by their existing.
    key: 'mount_jump_rallycart_rxt',
    custom: true,
  },
  {
    key: 'mount_land_rallycart_rxt',
    custom: true,
  },
  {
    key: 'mount_run_terrorspark_groundshaker_start',
    custom: true,
  },
  {
    // The sustain take of the windup/loop/winddown set: driven through
    // Sfx.loop() at runtime (see mountEngine in src/game/sfx.ts), not
    // playAt, so the manifest's own `loop` flag must say so too, even
    // though nothing reads it at runtime today.
    key: 'mount_run_terrorspark_groundshaker',
    custom: true,
    loop: true,
  },
  {
    // The Drakemaw Raptor's sprint: the gobbler's two-legged gallop donor,
    // pitched down in sfx_speed_map.json so the heavier raptor reads deeper.
    key: 'mount_run_drakemaw_raptor',
    custom: true,
  },
  {
    key: 'mount_run_terrorspark_groundshaker_stop',
    custom: true,
  },
  {
    // The Lantern Hall Destrier's whinny as it rears on its hind legs (a standing jump while
    // mounted, src/render/mount_rear_core.ts): two takes generated with the ElevenLabs Sound
    // Effects API (eleven_text_to_sound_v2, 2026-10-16) and picked by the maintainer, prompt
    // "A powerful heavy war horse rearing up and letting out a loud, proud whinny neigh, with a
    // short snort at the end, realistic recording, close, no music, no voices, about 2 seconds".
    // Stored as custom masters so a paid regeneration never replaces the picked takes; the
    // variant pool rotates them with a no-repeat bias.
    key: 'mount_neigh_lantern_hall_destrier',
    custom: true,
  },
  {
    // The Viridian Valestrider's summon call: an authored bird cry played once
    // when the 1.5s summon channel completes and the mount appears.
    // Sfx.mountSummon resolves `mount_summon_<key>` per mount and stays silent
    // for a mount with no authored take, so the other mounts are unaffected.
    key: 'mount_summon_avian_strider',
    custom: true,
  },
  {
    // The Valestrider's gait beat, six variants. Rotated per stride by playAt's
    // variant pool, which is what stops a bird jogging past sounding like a
    // metronome. This REPLACES the rider's own footsteps while mounted: it is
    // part of the world mix and does not answer to the on-foot footstep toggle.
    key: 'mount_run_avian_strider',
    custom: true,
  },
  {
    // Takeoff and touchdown, on the airborne edges.
    key: 'mount_jump_avian_strider',
    custom: true,
  },
  {
    key: 'mount_land_avian_strider',
    custom: true,
  },
  {
    // Fired together at the APEX of a jump, not at takeoff: the bird calls out
    // and beats its wings at the top of the arc. Two keys rather than one baked
    // pair so the variants rotate independently and the mix can be tuned apart.
    key: 'mount_squawk_avian_strider',
    custom: true,
  },
  {
    key: 'mount_flap_avian_strider',
    custom: true,
  },
  {
    // The Mech Bird's gait beat: the recorded servo footsteps assembled 1-2-1
    // (step one, step two, step one) per stride by scripts/gen_mech_bird_sfx.mjs.
    key: 'mount_run_mech_bird',
    custom: true,
  },
  {
    // The Mech Bird's standstill powered-on hum: driven through Sfx.loop()
    // while mounted and stationary (see mountIdle in src/game/sfx.ts), so the
    // manifest loop flag must say so, like the tank engine sustain above.
    key: 'mount_idle_mech_bird',
    custom: true,
    loop: true,
  },
  {
    // Launch servo one-shot: replaces the generic move_jump while riding the
    // Mech Bird (the mount-aware arm of Sfx.movement).
    key: 'mount_jump_mech_bird',
    custom: true,
  },
  {
    // Landing clank one-shot: replaces the generic move_land while riding.
    key: 'mount_land_mech_bird',
    custom: true,
  },
  {
    // Real recording (not ElevenLabs): the cart's rolling/creaking bed, held
    // as a continuous loop while the mount moves rather than a per-stride
    // one-shot like mount_run_* above. A wheeled cart has no stride to hang
    // a one-shot on -- the sound is continuous by nature, so it runs through
    // sfx.ts's loop()/unloop() the way the campfire and forge ambiences do.
    key: 'mount_loop_rickshaw_mount',
    custom: true,
    loop: true,
  },
  {
    // The Bonebound Rickshaw's summon call, fired once when the summon channel
    // completes and the mount appears. Never on dismount, and never for a rider
    // already mounted when they come into view. Silent for any mount without an
    // authored take, so this key is the whole opt-in.
    key: 'mount_summon_rickshaw_mount',
    custom: true,
  },
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
  {
    key: 'player_hurt_female',
    custom: true,
    duration: 0.6,
    prompt:
      'A human warrior grunting in sudden sharp pain from taking a hit. Single short grunt. Female voice.',
  },
  {
    key: 'player_death_female',
    custom: true,
    duration: 1.3,
    prompt:
      "A human warrior's final pained death cry as she collapses to the ground. Single death cry fading out. Female voice.",
  },
  {
    key: 'player_eat_food',
    custom: true,
    duration: 2.2,
    prompt: 'A person taking a bite of food and chewing. Single bite, no music.',
  },
  {
    key: 'player_drink_water',
    custom: true,
    duration: 1.7,
    prompt: 'A person drinking water from a waterskin, swallowing. Single gulp, no music.',
  },
  {
    key: 'player_drink_potion',
    custom: true,
    duration: 1.0,
    prompt: 'A person uncorking a small vial and quaffing a potion in one gulp. No music.',
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
  {
    key: 'fear_shout',
    custom: true,
  },
  {
    key: 'fear',
    custom: true,
  },
  {
    key: 'intimidating_shout',
    custom: true,
  },
  {
    key: 'battle_shout',
    custom: true,
  },
  {
    key: 'demoralizing_shout',
    custom: true,
  },
  {
    key: 'emboldening_roar',
    custom: true,
  },
  {
    key: 'defiant_bellow',
    custom: true,
  },
  {
    key: 'rallying_cry',
    custom: true,
  },
  {
    key: 'ice_block',
    custom: true,
  },
  {
    key: 'frost_nova',
    custom: true,
  },
  {
    key: 'hammer_of_justice',
    custom: true,
  },
  {
    key: 'entangling_roots',
    custom: true,
  },
  {
    key: 'blind',
    custom: true,
  },
  {
    key: 'cloak_of_shadows',
    custom: true,
  },
  {
    key: 'scorch',
    custom: true,
  },
  {
    key: 'pyroblast',
    custom: true,
  },
  {
    key: 'meteor',
    custom: true,
  },
  {
    key: 'flamestrike',
    custom: true,
  },
  {
    key: 'frozen_orb',
    custom: true,
  },
  {
    key: 'glacial_spike',
    custom: true,
  },
  {
    key: 'blizzard',
    custom: true,
    loop: true,
  },
  {
    key: 'blink',
    custom: true,
  },
  {
    key: 'arcane_blast',
    custom: true,
  },
  {
    key: 'shadowstep',
    custom: true,
  },
  {
    key: 'cheap_shot',
    custom: true,
  },
  {
    key: 'ambush',
    custom: true,
  },
  {
    key: 'backstab',
    custom: true,
  },
  {
    key: 'garrote',
    custom: true,
  },
  {
    key: 'sap',
    custom: true,
  },
  {
    key: 'sinister_strike',
    custom: true,
  },
  {
    key: 'eviscerate',
    custom: true,
  },
  {
    key: 'stealth',
    custom: true,
  },
  {
    key: 'vanish',
    custom: true,
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
    // Real recording (not ElevenLabs), custom-authored to loop cleanly
    // through the runtime's own loop=true playback (no seam crossfade of
    // its own, see src/game/sfx.ts's loop()): the hammer rhythm deliberately
    // breaks pattern instead of repeating a fixed beat, and 375ms of true
    // silence on each side, after the strike decay rings out, absorbs both
    // the splice points and MP3 encoder priming/padding at the wrap. custom
    // is load-bearing here: it is what makes conform preserve the author's
    // own mix level (preserveLoudness) instead of retargeting integrated
    // LUFS toward the generated-content target, which would otherwise clamp
    // this percussive, high-crest-factor recording's gain down hard trying
    // to hit -14 LUFS under a -6dBFS peak ceiling built for synthetic clips.
    key: 'amb_forge',
    duration: 14,
    loop: true,
    custom: true,
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
  {
    // Project-generated (not ElevenLabs): scripts/gen_tavern_ambience_sfx.mjs synthesizes
    // the Mirefen tavern's room of talk, mugs and hearth crackle from fixed seeds and mixes
    // in the Fenbridge town theme rendered from the procedural score, baking a crossfaded
    // wrap so the runtime's plain loop=true playback has no seam. custom is load-bearing: the
    // generator masters the bed itself (about -17 LUFS, peaks near -8 dBFS), so conform only
    // enforces the true-peak ceiling and never retargets it. stereo: a non-positional bed
    // (src/game/sfx.ts plays it through the tavern ambience's lowpass, never a panner).
    key: 'amb_tavern',
    duration: 44,
    loop: true,
    stereo: true,
    custom: true,
    prompt:
      'A lively medieval tavern room: overlapping talk and laughter, mugs clinking, a hearth crackling and a little lute music from the corner. Seamless loop.',
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

  // Group ready-check three-note prompt (custom recording, not
  // ElevenLabs/generated). Replaces the hardcoded three-oscillator procedural
  // chime that used to live directly in src/game/audio.ts (readyCheck()).
  { key: 'ui_ready_check', custom: true },

  // Polymorph "sheep" transformation bleat (custom recording, not
  // ElevenLabs/generated). Replaces the procedural saw/sine synth placeholder.
  { key: 'ui_sheep', custom: true },

  // Weapon stow toggle (Z key, custom recording, not ElevenLabs/generated).
  // Replaces the procedural noise+tone synth pair that used to live directly
  // in src/game/audio.ts (weaponSheathe()/weaponUnsheathe()).
  { key: 'ui_weapon_sheathe', custom: true },
  { key: 'ui_weapon_unsheathe', custom: true },

  // Whisper notification (custom recording, a real tambourine hit, not
  // ElevenLabs/generated). Replaces the old procedural "two glassy notes"
  // placeholder; see the cue description below, still pending an update.
  { key: 'ui_whisper', custom: true },

  // Generic invalid-action buzz (custom recording, not ElevenLabs/generated).
  // Replaces the old procedural "low interface buzz" placeholder. Covers
  // every failure reason (cooldown, resource, range, everything else) with
  // one rate-limited cue; splitting by failure reason was tried and
  // deliberately reverted.
  { key: 'ui_error', custom: true },

  // Cosmetic/skin unlock chime (custom recording, not ElevenLabs/generated).
  // Previously the Season 1 Armory skin-event claim flow reused ui_level_up
  // (audio.levelUp()), so a real level-up and a cosmetic unlock sounded
  // identical. See SkinEventController's lock-button handler in
  // src/ui/hud/cosmetics/skin_event_controller.ts.
  { key: 'ui_cosmetic_unlock', custom: true },

  // Duel/arena start gong (custom recording, not ElevenLabs/generated).
  { key: 'ui_duel_start', custom: true },

  // Arena rating-loss defeat chime (custom recording, not ElevenLabs/generated).
  // Upgrades the placeholder tone; see the 'arenaResult' loss branch in hud.ts.
  { key: 'ui_arena_loss', custom: true },

  // Generic interface click (custom recording, not ElevenLabs/generated).
  // The single highest-frequency UI cue (100+ call sites: tabs, checkboxes,
  // window buttons, dungeon-finder queue/role buttons, options changes).
  { key: 'ui_click', custom: true },

  // Currency reward ping (custom recording, not ElevenLabs/generated), three
  // takes so the no-repeat-random picker rotates them (sell/buyback, mail
  // postage, bank deposit/withdraw, trade completion).
  { key: 'ui_coin', custom: true },

  // Item pickup rustle/tick (custom recording, not ElevenLabs/generated),
  // five takes so the no-repeat-random picker rotates them.
  { key: 'ui_loot_item', custom: true },

  // Duel/arena/Vale-Cup end cadence (custom recording, not ElevenLabs/generated).
  { key: 'ui_duel_end', custom: true },

  // Inventory bag close (custom recording, not ElevenLabs/generated).
  { key: 'ui_bag_close', custom: true },

  // Inventory bag open (custom recording, not ElevenLabs/generated).
  { key: 'ui_bag_open', custom: true },

  // Duel/arena/Vale-Cup countdown tick (custom recording, not ElevenLabs/generated).
  { key: 'ui_duel_countdown', custom: true },

  // Duel challenge / party invite / guild invite / arena queue pop / Vale
  // Cup match-found (custom recording, not ElevenLabs/generated). Shared
  // "a match is starting" vocabulary across all five, deliberately, per
  // Jamie 2026-07-18: party and guild invite used to be the separate,
  // misnamed ui_quest_accept (now retired).
  { key: 'ui_duel_challenge', custom: true },

  // --- Wand auto-attacks (custom recordings, not ElevenLabs) ----------------
  // Distinct from the matching proj_<school> real-spell-cast sound, see
  // WAND_CUES in src/ui/combat_sfx.ts (feature/sfx-wand-attack-cues, #1973).
  { key: 'wand_arcane', custom: true },
  { key: 'wand_holy', custom: true },
  { key: 'wand_shadow', custom: true },

  // --- Card Duel minigame (custom recordings, not ElevenLabs) --------------
  // Match win/lose deliberately reuse ui_duel_end/ui_arena_loss, no dedicated
  // recordings for those (see src/game/audio.ts).
  { key: 'ui_card_play', custom: true },
  { key: 'ui_card_reveal', custom: true },
  { key: 'ui_card_round_push', custom: true },
  { key: 'ui_card_shuffle', custom: true },

  // --- Fishing (custom recordings, replacing the retired synth placeholders
  // in scripts/sfx/ui_sfx.mjs) --------------------------------------------
  // fishBite is the one gameplay-timing cue of the family (it opens the live
  // reel window, audio.ts's ungated play() arm); fishCast/fishReel are
  // feedback notifications. Multi-take (no-repeat-random picker).
  { key: 'ui_fish_cast', custom: true },
  { key: 'ui_fish_bite', custom: true },
  { key: 'ui_fish_reel', custom: true },

  // --- Gathering node harvests (custom recordings, not ElevenLabs) ----------
  // One cue per GatherNodeType ('ore'/'wood'/'herb', src/sim/types.ts), fired
  // from the gatherResult sim event. Multi-take (no-repeat-random picker).
  { key: 'ui_gather_ore', custom: true },
  { key: 'ui_gather_wood', custom: true },
  { key: 'ui_gather_herb', custom: true },

  // --- Gathering tool-out cue, per node type (custom recordings) -----------
  // Fires at gather CAST START (audio.gatherCast(nodeType)), a "pulling the
  // tool out" beat for the cast bar's anticipation window; distinct from the
  // completion cue above. Falls back to the flat ui_gather_cast placeholder
  // (scripts/sfx/ui_sfx.mjs) when no node type is known. Multi-take.
  { key: 'ui_gather_cast_ore', custom: true },
  { key: 'ui_gather_cast_wood', custom: true },
  { key: 'ui_gather_cast_herb', custom: true },

  // Rare-or-better gather stinger: layers ALONGSIDE the ui_gather_<nodeType>
  // cue above, one tier per rolled MaterialRarity (common/uncommon get none).
  { key: 'ui_gather_rare', custom: true },
  { key: 'ui_gather_epic', custom: true },
  { key: 'ui_gather_legendary', custom: true },

  // --- Crafting completion, per craft family (custom recordings) -----------
  // One cue per CRAFT_RING entry (src/sim/content/professions.ts), fired from
  // the craftResult sim event keyed off recipeId's craft family.
  { key: 'ui_craft_engineering', custom: true },
  { key: 'ui_craft_alchemy', custom: true },
  { key: 'ui_craft_cooking', custom: true },
  { key: 'ui_craft_leatherworking', custom: true },
  { key: 'ui_craft_tailoring', custom: true },
  { key: 'ui_craft_inscription', custom: true },
  { key: 'ui_craft_enchanting', custom: true },
  { key: 'ui_craft_jewelcrafting', custom: true },
  { key: 'ui_craft_weaponcrafting', custom: true },
  { key: 'ui_craft_armorcrafting', custom: true },

  // Masterwork proc (custom recording): layers ALONGSIDE the ui_craft_<family>
  // cue above on a masterwork craft, not a replacement for it (Jamie's
  // explicit design call, 2026-07-18).
  { key: 'ui_masterwork', custom: true },

  // Disenchant proc (custom recording): the enchanting profession's own
  // action, separate from the craftByFamily set above since disenchant does
  // not go through the recipe/craftResult path (src/sim/professions/
  // enchanting.ts disenchantItem). Triggered from the bag item action menu
  // (src/ui/bag_item_action_menu.ts).
  { key: 'ui_craft_disenchant', custom: true },

  // Salvage proc (custom recording): the enchanting profession's ungated
  // break-any-item-for-generic-materials action (src/sim/professions/
  // salvage.ts), separate from disenchant's rare+ arcane-materials path.
  { key: 'ui_craft_salvage', custom: true },

  // Buried Hoard: locally authored earth/wood reveal and a warm resonant bed.
  { key: 'hoard_entrance_open', custom: true },
  { key: 'hoard_entrance_hum', custom: true, loop: true },
  { key: 'hoard_tide_build', custom: true },
  { key: 'hoard_tide_rush', custom: true, loop: true },
  { key: 'hoard_tide_crash', custom: true },
  { key: 'hoard_tide_hit', custom: true },

  // --- Rift mechanics (custom recordings, src/sim/rift/) --------------------
  // World-anchored one-shots and point-source loops for the procedural Rift
  // dungeon's headline floor mechanics (src/sim/rift/runs.ts, portals.ts),
  // played via the spellfxAt world event's optional sfxKey override.
  { key: 'rift_portal_spawn', custom: true }, // a natural rift portal opening in the world
  { key: 'rift_portal_enter', custom: true }, // stepping through into the instance
  { key: 'rift_portal_drone', custom: true, loop: true }, // point-source loop near an open, unentered portal
  { key: 'rift_gate_grind', custom: true }, // the rift gate mechanic's portcullis grinding open
  { key: 'rift_boulder_impact', custom: true }, // the rolling-lane hazard bowling over a player
  { key: 'rift_boulder_roll', custom: true, loop: true }, // point-source loop near an active rolling-lane hazard
  { key: 'rift_ice_start', custom: true }, // launching onto the ice-slide zone
  { key: 'rift_ice_glide', custom: true, loop: true }, // point-source loop for a player currently gliding
  { key: 'rift_ice_stop', custom: true }, // skidding to a halt off the ice
  { key: 'rift_lava_tick', custom: true }, // the 1 Hz lava/blackwater hazard burn tick

  // --- The Smith's Heart: the Hammer Council (ElevenLabs Sound Effects) ------
  // Positioned one-shots and one loop for the council's moments, played by
  // src/game/smith_heart_council_audio.ts off the council's own cues and cast
  // bars (the base council and mythic's Soul in the Stone).
  {
    key: 'heart_council_wrath_charge',
    duration: 4,
    prompt:
      'A deep earthquake rumble building over four seconds inside a stone quarry: grinding bedrock, small stones rattling loose, pressure rising to a peak. No music.',
  },
  {
    key: 'heart_council_wrath_blast',
    duration: 2,
    prompt:
      'A massive stone shockwave blast in a quarry: a huge boom of rock splitting, a wall of dust and gravel rushing outward, a deep sub impact. Single event, no music.',
  },
  {
    key: 'heart_council_pillar_rise',
    duration: 1.5,
    prompt:
      'A heavy stone pillar bursting up out of a rock floor: a violent grinding crack, debris thrown, a deep thud as it locks in place. No music.',
  },
  {
    key: 'heart_council_pillar_crack',
    duration: 1,
    prompt:
      'A large stone column cracking under strain: a sharp rock fracture snap with crumbling chips and a short gritty trickle of dust. No music.',
  },
  {
    key: 'heart_council_pillar_collapse',
    duration: 2.5,
    prompt:
      'A tall stone column toppling and breaking apart: a groaning tilt, then a massive crash of falling rubble and settling dust. No music.',
  },
  {
    key: 'heart_council_pillar_pulse',
    duration: 0.8,
    prompt:
      'A low resonant hum pulse from a stone pillar: one soft deep thrum of earth energy, short and dull. No music.',
  },
  {
    key: 'heart_council_rock_fall',
    duration: 1.2,
    prompt:
      'A huge boulder falling from high above: a deep rushing whoosh growing louder as it descends, no impact. No music.',
  },
  {
    key: 'heart_council_rock_impact',
    duration: 1.6,
    prompt:
      'A giant boulder slamming into a stone floor: a heavy crunching boom, rock shattering apart, a spray of gravel. Single impact, no music.',
  },
  {
    key: 'heart_council_seam_bolt',
    duration: 1,
    prompt:
      'A crystalline shard bolt flying and shattering on impact: a bright glassy whoosh ending in a ringing crystal break. No music.',
  },
  {
    key: 'heart_council_song_cast',
    duration: 3,
    prompt:
      'An eerie resonant hum swelling inside a cave, like an ore vein ringing: layered crystalline tones over a low drone, rising for three seconds. Wordless, no melody, no music.',
  },
  {
    key: 'heart_council_soul_take',
    duration: 2,
    prompt:
      'A rush of spectral energy pouring into stone: a deep ghostly whoosh that sinks into rock and ends in a low resonant awakening hum. No music, no voice.',
  },
  {
    key: 'heart_council_echo_charge',
    duration: 3,
    prompt:
      'A tense rising rumble with ember crackle charging inside a stone pillar over three seconds, pressure building to a peak. No music.',
  },
  {
    key: 'heart_council_echo_blast',
    duration: 1.8,
    prompt:
      'A fiery stone shockwave bursting from a pillar: a deep boom with an ember whoosh and rolling rock dust. Single event, no music.',
  },
  {
    key: 'heart_council_slab_grind',
    duration: 3,
    loop: true,
    prompt:
      'A huge stone slab being dragged slowly across a rock floor: continuous heavy grinding and scraping over a deep rumble. Seamless loop, no music.',
  },
  {
    key: 'heart_council_slab_crush',
    duration: 1.2,
    prompt:
      'A massive stone slab slamming down and crushing: a heavy crunching thud with cracking rock. Single impact, no music.',
  },
  {
    key: 'heart_council_song_pulse',
    duration: 1.2,
    prompt:
      'A resonant crystalline sound pulse ringing out across a cavern: a deep bell-like ring of stone with a shimmering shockwave. Wordless, no melody, no music.',
  },
  {
    key: 'heart_council_soul_pip',
    duration: 0.8,
    prompt:
      'A sharp crystal chip breaking off a stone with a bright magical spark and a quick shimmer. Short, no music.',
  },
  {
    key: 'heart_council_soul_burst',
    duration: 2.5,
    prompt:
      'A stone pillar bursting with released spirit energy: a bright shattering crack, a ghostly whoosh rising and fading away, rubble falling. No music, no voice.',
  },

  // --- The Smith's Heart: the Guardian of the Breath (ElevenLabs Sound Effects)
  // Positioned one-shots and two loops for the Storm Cornice fight, played by
  // src/game/smith_heart_breath_audio.ts off the fight's cues, its wind's
  // phases and the guardian's bars.
  {
    key: 'heart_breath_gather',
    duration: 2.5,
    prompt:
      'A great gale gathering on a mountain summit: a deep rising howl of wind swelling through hollow stone, a huge creature drawing breath, building to a peak. No music, no voice.',
  },
  {
    key: 'heart_breath_blow_loop',
    duration: 5,
    loop: true,
    prompt:
      'A steady, powerful gale roaring across an exposed mountaintop plateau, wind rushing and buffeting, grit hissing over stone, constant and loopable. No music.',
  },
  {
    key: 'heart_breath_calm',
    duration: 2.5,
    prompt:
      'A roaring gale dying away to a long soft sigh of wind over stone, the air falling still. No music, no voice.',
  },
  {
    key: 'heart_breath_inhale',
    duration: 5,
    prompt:
      'An enormous stone creature inhaling: air sucked violently in through a vast hollow throat, a vortex of wind roaring inward and rising in pitch and pressure. No music, no voice.',
  },
  {
    key: 'heart_breath_exhale',
    duration: 2,
    prompt:
      'A colossal exhaled blast of wind: a deep whump of air pressure and a roaring gust hurled outward, grit and pebbles scattering across stone. Single event, no music.',
  },
  {
    key: 'heart_breath_storm_break',
    duration: 4,
    prompt:
      'Wind sucked inward to a sudden tense silence, then electric static crackling and building, a deep stone groan straining under pressure. No music, no voice.',
  },
  {
    key: 'heart_breath_tear',
    duration: 3,
    prompt:
      'A stone shell bursting apart with a huge thunderclap: rock fragments flung outward, a roaring surge of crackling lightning, thunder rolling across the sky. No music.',
  },
  {
    key: 'heart_breath_strike',
    duration: 1.5,
    prompt:
      'A close lightning strike hitting stone: a sharp searing crack of electricity and a short booming thunder snap. Single event, no music.',
  },
  {
    key: 'heart_breath_fork',
    duration: 1.2,
    prompt:
      'Chain lightning leaping from target to target: rapid sharp electric zaps and crackles jumping in quick succession. No music.',
  },
  {
    key: 'heart_breath_discharge',
    duration: 2.5,
    prompt:
      'A massive bolt of lightning discharging into the ground: a blinding electric crack, a deep thunder boom and a crackling electric hum fading. No music.',
  },
  {
    key: 'heart_breath_gale_loop',
    duration: 4,
    loop: true,
    prompt:
      'A small whirling tornado spinning across stone: a twisting whooshing wind vortex with debris rattling, constant and loopable. No music.',
  },
  {
    key: 'heart_breath_toss',
    duration: 1,
    prompt:
      'A sudden whoosh of whirlwind flinging something into the air, a sharp gust and a tumble. Short, no music.',
  },
  {
    key: 'heart_breath_calm_land',
    duration: 1.8,
    prompt:
      'A gentle protective blessing landing on stone: a soft bright chime and a hush as the wind around falls quiet, calm and reassuring. No music, no voice.',
  },
  {
    key: 'heart_breath_swell',
    duration: 2,
    prompt:
      'Rolling thunder rumbling across a dark storm sky, deep and growing, with distant crackles of lightning. No music.',
  },
  {
    key: 'heart_breath_fall',
    duration: 1.8,
    prompt:
      'A rush of wind howling down past a cliff edge into a deep chasm, falling away into the distance. No music, no voice.',
  },

  // --- The Smith's Heart: the Guardian of the Quench (ElevenLabs Sound Effects)
  // Positioned one-shots for the Frozen Lake fight, played by
  // src/game/smith_heart_quench_audio.ts off the fight's cues, the cracks as
  // they appear and the guardian's awakening bar.
  {
    key: 'heart_quench_freeze',
    duration: 1.5,
    prompt:
      'A body being encased in ice in an instant: a fast crystalline crackle of freezing water locking solid, a sharp glassy tightening. No music, no voice.',
  },
  {
    key: 'heart_quench_shatter',
    duration: 1.6,
    prompt:
      'A thick block of ice exploding apart: a bright violent shatter, shards of ice tinkling and skittering across a frozen lake, a cold whoosh. Single event, no music.',
  },
  {
    key: 'heart_quench_crack',
    duration: 2.5,
    prompt:
      'Thick lake ice groaning and cracking under heavy weight: a deep resonant twang of stressed ice, a spreading crackle racing outward. No music.',
  },
  {
    key: 'heart_quench_hole',
    duration: 2,
    prompt:
      'Lake ice giving way: a loud crack and collapse of breaking ice, a heavy splash of freezing water surging up through the hole, chunks of ice bobbing. No music.',
  },
  {
    key: 'heart_quench_plunge',
    duration: 1,
    prompt:
      'A person plunging through ice into freezing water: a heavy splash and gurgle, ice chunks knocking, a gasp-like rush of bubbles. No music, no voice.',
  },
  {
    key: 'heart_quench_climb',
    duration: 1.5,
    prompt:
      'Someone hauling themselves out of icy water onto ice: water pouring and dripping off, a scrape on ice, a wet slap. No music, no voice.',
  },
  {
    key: 'heart_quench_wake_charge',
    duration: 4,
    prompt:
      'Deep ice groaning and straining under a frozen lake, a rising crystalline choir-like hum of resonating ice building in tension for four seconds. Wordless, no melody, no music.',
  },
  {
    key: 'heart_quench_wake',
    duration: 3,
    prompt:
      'Giant swords of ice tearing free from a frozen lake: a huge explosive crack of breaking ice, massive shards bursting upward, a ringing crystalline resonance like a struck glass bell. No music, no voice.',
  },
  {
    key: 'heart_quench_echo',
    duration: 1.5,
    prompt:
      'A blast of freezing wind and ice released from a floating crystal blade: a sharp resonant ice whoosh with a glassy echo tail. Single event, no music.',
  },
  {
    key: 'heart_quench_cross',
    duration: 2,
    prompt:
      'Two enormous ice blades swooping fast across a frozen lake: a deep doubled whoosh of cutting air, ice crackling and splintering in their wake. No music.',
  },
  {
    key: 'heart_quench_rim',
    duration: 0.5,
    prompt:
      'A ring of shore ice heaving up out of a frozen lake: a deep grinding rumble of ice plates pushing upward, cracking and settling. No music.',
  },
];

// --- The Smith's Heart: the Guardian of the Heat, TAKES STILL TO GENERATE.
// The ElevenLabs credits ran out before this fight's sounds were made, so
// src/game/smith_heart_heat_audio_core.ts builds every Heat sound from the
// pack's existing samples (pitched and layered). These are the prompts for
// the fight's own takes: when credits return, move each row into SFX above
// (then `npm run sfx:gen`, `npm run sfx:conform`, `npm run sfx:manifest`) and
// point its cue at `heart_heat_<name>`. Deliberately NOT in SFX: a row there
// without its committed file fails the manifest's conformance checks.
export const HEAT_SFX_TO_GENERATE = [
  {
    key: 'heart_heat_ray',
    duration: 1,
    prompt:
      'A focused ray of white-hot fire fired from a singing crystal: a bright crystalline tone over a searing hiss and crackle of flame striking a body. Single event, no music.',
  },
  {
    key: 'heart_heat_ray_back',
    duration: 1.2,
    prompt:
      'A ray of fire swallowed by a huge living flame: a deep rising whoomph of fire being drawn in, a low satisfied roar of a furnace-like blaze growing hotter. No music, no voice.',
  },
  {
    key: 'heart_heat_pulse',
    duration: 0.8,
    prompt:
      'A soft heavy wave of heat rolling outward from a great fire: a low breathy whoosh of hot air with a faint crackle, short and unobtrusive. No music.',
  },
  {
    key: 'heart_heat_windup',
    duration: 6,
    prompt:
      'A colossal fire building toward an explosion: a rising roar of white-hot flame swelling for six seconds, crystal ringing and cracking under the strain, pressure mounting. Wordless, no melody, no music.',
  },
  {
    key: 'heart_heat_overheat',
    duration: 3,
    prompt:
      'A gigantic eruption of white fire filling a stone hall: a blinding thunderous blast of flame, a shockwave of roaring heat, crystal shards bursting, a long crackling tail. Single event, no music.',
  },
  {
    key: 'heart_heat_crystal_rise',
    duration: 2,
    prompt:
      'A glowing crystal tearing up out of cracked basalt: stone grinding and splitting, a rising bright crystalline chime humming with fire. No music.',
  },
  {
    key: 'heart_heat_crystal_fade',
    duration: 1.5,
    prompt:
      'A fire crystal burning out and cracking apart: a glassy splintering crack, the inner flame guttering out with a soft sigh, cinders tinkling. No music.',
  },
  {
    key: 'heart_heat_burn',
    duration: 0.6,
    prompt:
      'A short sharp sizzle of skin-searing heat, a hot crackle close to the ear. Single event, no music, no voice.',
  },
  {
    key: 'heart_heat_channel_brim',
    duration: 4,
    prompt:
      'A channel of liquid fire filling up and about to overflow: a deep rumbling bubbling of molten flame rising for four seconds, hissing and crackling. No music.',
  },
  {
    key: 'heart_heat_channel_flow',
    duration: 3,
    prompt:
      'A river of white-gold fire rushing down a stone channel: a powerful roaring flow of flame, crackling and hissing, pouring over an edge into a chasm. No music.',
  },
  {
    key: 'heart_heat_embers',
    duration: 1.5,
    prompt:
      'Burning embers scattered on a stone floor catching alight: a low smouldering crackle and hiss flaring up. No music.',
  },
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
