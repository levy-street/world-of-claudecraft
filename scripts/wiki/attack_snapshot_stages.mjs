// How render_attack_snapshots.mjs stages each boss in the real offline client, using only
// the game's own /dev playtest commands (src/sim/dev/*_dev.ts, src/sim/dev_commands.ts).
//
// A stage is:
//   setup     chat lines that put the player beside the ENGAGED boss (normal difficulty)
//   post      chat lines run once the player is inside (after the loading curtain)
//   settle    sim seconds to run after setup before the first attack (arrival cinematics)
//   attacks   per wiki attack name (exactly as the wiki prints it):
//               run   chat lines that force the attack now (a /dev trigger)
//               cast  the cast label the attack shows (castId); the probe freezes the sim
//                     when that bar is CAST_FRACTION through
//               at    sim seconds after `run` to freeze when no bar is expected (or as a
//                     fallback when the bar never shows)
//               frac  override for the cast fraction (a late telegraph reads better)
//   camera    optional chase-camera override { pitch, dist, yaw } (a huge boss reads from
//             higher up, or it hides its own telegraph)
//   idle      sim seconds to keep the fight running afterwards, so attacks with no trigger
//             (timer rotations) are caught by their cast label (`casts` lists their ids)
//   casts     wiki name -> castId for attacks that only fire on their own timers
//   fractions wiki name -> cast fraction for a timer-driven bar (a late telegraph reads better)
//   approach  yards: after settle, stand the player this far from the boss (a boss that
//             engages only close up), then run approachSettle more seconds
//   rift      { rank, citadel }: stage in a real rift instead of `setup` (rift_stage_page.js)
// A boss with no stage is skipped unless UNSTAGED=1, which spawns it with /dev spawn on a
// borrowed floor and fights it for 60 s, catching attacks by castId or by the cadence timer
// reset (aoePulse, stomp). Those frames showed no attack in review (a world elite's pulse is
// an untelegraphed shared nova; a rift boss only draws its windup rings inside a rift), so
// they ship nothing until a stage exists for them.
//
// REJECTED lists captures a human reviewed and found unclear (attack not readable at
// thumbnail size); the driver skips them so a rerun does not bring them back.

const crypt = (pull) => ['/dev crypt enter normal', '/dev crypt gates', `/dev crypt pull ${pull}`];
const bastion = (tp) => [
  '/dev bastion enter normal',
  '/dev bastion gates',
  `/dev bastion tp ${tp}`,
];
const temple = (tp) => ['/dev temple enter normal', '/dev temple gates', `/dev temple tp ${tp}`];
const sanctum = (tp) => [
  '/dev sanctum enter normal',
  '/dev sanctum gates',
  `/dev sanctum tp ${tp}`,
];
const wild = (tp) => [
  '/dev wildheart enter normal',
  '/dev wildheart gates',
  `/dev wildheart tp ${tp}`,
];
const trig = (d, w, extra = {}) => ({ run: [`/dev ${d} trigger ${w}`], ...extra });

export const STAGES = {
  // Hollow Crypt
  sexton_marrow: {
    setup: crypt('marrow'),
    attacks: {
      Shovelful: trig('crypt', 'shovel', { cast: 'crypt_marrow_shovelful', at: 1.2 }),
      'Measured for the Grave': trig('crypt', 'grave', { at: 3.5 }),
      'Burial Toll': trig('crypt', 'toll', { cast: 'crypt_marrow_burial_toll', at: 6 }),
    },
  },
  rimeweb: {
    setup: crypt('lady'),
    attacks: {
      "Bride's Lament": trig('crypt', 'lament', { cast: 'crypt_lady_brides_lament', at: 3 }),
      'Frozen Embrace': trig('crypt', 'embrace', { cast: 'crypt_lady_frozen_embrace', at: 2 }),
      'Bridal Freeze': trig('crypt', 'freeze', { cast: 'crypt_lady_bridal_freeze', frac: 0.7 }),
    },
  },
  cantor_ilvane: {
    setup: crypt('ilvane'),
    attacks: {
      'Dirge of the Hollow': trig('crypt', 'dirge', { cast: 'crypt_ilvane_dirge', at: 2.5 }),
      'Bone Organ': trig('crypt', 'organ', { cast: 'crypt_ilvane_bone_organ', at: 8 }),
    },
  },
  morthen: {
    setup: crypt('morthen'),
    attacks: {
      'Shadow Pulse': trig('crypt', 'pulse', { cast: 'crypt_morthen_shadow_pulse', frac: 0.7 }),
      Gravecall: trig('crypt', 'gravecall', { at: 2.5 }),
      'Grasp of the Grave': trig('crypt', 'grasp', { at: 1.2 }),
      'Reap the Unquiet': trig('crypt', 'reap', {
        cast: 'crypt_morthen_reap_the_unquiet',
        frac: 0.8,
      }),
      'Rite of the Unquiet': trig('crypt', 'rite', { at: 3 }),
    },
  },
  crypt_knellwyrm: {
    setup: ['/dev crypt enter normal', '/dev crypt gates', '/dev crypt tp ring', '/dev crypt wyrm'],
    settle: 20,
    attacks: {
      'Pyre Strafe': trig('crypt', 'strafe', { cast: 'crypt_knellwyrm_pyre_strafe', frac: 0.8 }),
      'Dread Bellow': trig('crypt', 'bellow', { cast: 'crypt_knellwyrm_dread_bellow' }),
    },
    casts: {
      'Barrowflame Breath': 'crypt_barrowflame_breath',
      'Tail Lash': 'crypt_tail_lash',
      'Wing Gust': 'crypt_wing_gust',
    },
    idle: 30,
  },
  crypt_ossuary_drake: {
    setup: ['/dev crypt enter normal', '/dev crypt gates', '/dev crypt spawn drake'],
    settle: 3,
    attacks: {},
    casts: {
      'Barrowflame Breath': 'crypt_barrowflame_breath',
      'Tail Lash': 'crypt_tail_lash',
      'Wing Gust': 'crypt_wing_gust',
    },
    idle: 30,
  },
  // Sunken Bastion
  turretback_hermit: {
    setup: ['/dev bastion enter normal', '/dev bastion gates', '/dev bastion pack hermit'],
    attacks: {},
    casts: {
      'Spectral Broadside': 'ghost_captain_broadside',
      'Cursed Anchor': 'ghost_captain_anchor',
      'Phantom Boarding': 'ghost_captain_boarding',
    },
    fractions: { 'Spectral Broadside': 0.95, 'Phantom Boarding': 0.95 },
    idle: 45,
  },
  knight_commander_olen: {
    setup: bastion('olen'),
    attacks: {
      'Hallowed Brine': trig('bastion', 'brine', { at: 2.2 }),
      'Rebounding Bulwark': trig('bastion', 'bulwark', {
        cast: 'bastion_rebounding_bulwark',
        frac: 1.01,
      }),
      'Sentence of the Tide': trig('bastion', 'sentence', { at: 4.5 }),
      'Unbroken Oath': trig('bastion', 'oath', { at: 2.5 }),
    },
  },
  gaol_turnkey: {
    setup: bastion('turnkey'),
    attacks: {
      'Iron Cage': trig('bastion', 'cage', { cast: 'bastion_iron_cage', frac: 0.8, at: 2 }),
    },
  },
  gaoler_ossick: {
    setup: bastion('ossick'),
    attacks: {
      'Drowned Anchor': trig('bastion', 'anchor', {
        cast: 'bastion_drowned_anchor_cast',
        frac: 0.7,
      }),
      'Shackle Pair': trig('bastion', 'shackle', { cast: 'bastion_shackle_pair', frac: 1.01 }),
    },
    casts: { "Gaoler's Cudgel": 'bastion_gaolers_cudgel' },
    idle: 20,
  },
  vael_the_mistcaller: {
    setup: [
      '/dev bastion enter normal',
      '/dev bastion gates',
      '/dev bastion trigger introskip',
      '/dev bastion tp vael',
    ],
    settle: 2,
    attacks: {
      'Mist Surge': trig('bastion', 'surge', { cast: 'bastion_mist_surge', at: 2 }),
      'Shadow Crossing': trig('bastion', 'reap', { at: 1.5 }),
      'Gathering Fog': trig('bastion', 'veil', { at: 9 }),
    },
  },
  // Drowned Temple
  choirmother_selthe: {
    setup: temple('selthe'),
    attacks: {
      Chorus: trig('temple', 'chorus', { at: 3 }),
      Solo: trig('temple', 'solo', { at: 3 }),
      'The Score': trig('temple', 'score', { at: 4 }),
      'Moonwater Bolt': trig('temple', 'bolt', { at: 0.35 }),
      'Drowning Aria': trig('temple', 'aria', { cast: 'temple_drowning_aria', frac: 0.3 }),
      'Mere Surge': trig('temple', 'surge', { cast: 'temple_mere_surge', frac: 0.7 }),
    },
  },
  mere_hydra_head_center: {
    setup: temple('hydra'),
    attacks: {
      'Freezing Breath': trig('temple', 'breath', { cast: 'temple_tide_breath', frac: 0.7 }),
      'Venom Spit': trig('temple', 'spit', { at: 1.2 }),
      'Crushing Torrent': trig('temple', 'torrent', { cast: 'temple_crushing_torrent', frac: 0.7 }),
      Tsunami: trig('temple', 'tsunami', { cast: 'temple_hydra_tsunami', frac: 1.01 }),
      'Frostlocked Torrent': trig('temple', 'frostlock', {
        cast: 'temple_frostlocked_torrent',
        frac: 0.7,
      }),
      'Venom Current': trig('temple', 'current', { cast: 'temple_venom_current', frac: 0.7 }),
      'Toxic Rime': trig('temple', 'rime', { cast: 'temple_toxic_rime', frac: 0.7 }),
    },
  },
  tideglass_colossus: {
    setup: temple('colossus'),
    attacks: {
      'Moonlight Lance': trig('temple', 'lance', { cast: 'temple_moonlight_lance', frac: 0.7 }),
      'Tideglass Fracture': trig('temple', 'fracture', { at: 3 }),
    },
    casts: { 'Resonant Slam': 'temple_resonant_slam' },
    idle: 20,
  },
  ysolei: {
    setup: temple('ysolei'),
    attacks: {
      Undertow: trig('temple', 'undertow', { cast: 'temple_undertow', frac: 0.7 }),
      'Beckoning Moon': trig('temple', 'tears', { cast: 'temple_beckoning_moon', frac: 0.95 }),
      'Rising Tide': trig('temple', 'flood', { at: 6 }),
      'Falling Moon': trig('temple', 'fullmoon', { cast: 'temple_falling_moon', frac: 0.5 }),
    },
    casts: { 'Lunar Tide': 'temple_lunar_tide' },
    idle: 15,
  },
  // Gravewyrm Sanctum
  sledge_tusker: {
    setup: ['/dev sanctum enter normal', '/dev sanctum gates', '/dev sanctum tp tusker'],
    settle: 4,
    approach: 8,
    camera: { pitch: 1.15, dist: 24 },
    attacks: {
      'Tusk Sweep': trig('sanctum', 'sweep', { cast: 'sanctum_tusker_tusk_sweep', frac: 0.85 }),
      Trample: trig('sanctum', 'trample', { cast: 'sanctum_tusker_trample', frac: 0.85 }),
      'Spilled Braziers': trig('sanctum', 'spill', { at: 0.3 }),
    },
  },
  korgath_the_bound: {
    setup: sanctum('korgath'),
    attacks: {
      'Maul Arc': trig('sanctum', 'maul', { cast: 'sanctum_korgath_maul_arc', frac: 0.7 }),
      'Chain Flail': trig('sanctum', 'flail', { cast: 'sanctum_korgath_chain_flail', frac: 0.7 }),
      'Threshold Charge': trig('sanctum', 'charge', {
        cast: 'sanctum_korgath_threshold_charge',
        frac: 0.7,
      }),
      "Foreman's Bellow": trig('sanctum', 'bellow', {
        cast: 'sanctum_korgath_foremans_bellow',
        frac: 0.7,
      }),
      Strain: trig('sanctum', 'strain', { cast: 'sanctum_korgath_strain', frac: 0.7 }),
      'Shuddering Stomp': trig('sanctum', 'stomp', { cast: 'sanctum_korgath_stomp', frac: 1.01 }),
    },
  },
  grand_necromancer_velkhar: {
    setup: sanctum('velkhar'),
    settle: 4,
    attacks: {
      'Waking Thaw': trig('sanctum', 'thaw', { at: 0.6 }),
      'Soulfire Trench': trig('sanctum', 'trench', {
        cast: 'sanctum_velkhar_soulfire_trench',
        frac: 0.7,
      }),
      'Shadow Volley': trig('sanctum', 'volley', {
        cast: 'sanctum_velkhar_shadow_volley',
        frac: 0.7,
      }),
    },
  },
  korzul_the_gravewyrm: {
    setup: sanctum('korzul'),
    camera: { pitch: 1.2, dist: 34, yaw: 0 },
    settle: 60,
    // He breaks free over the lake and lands on the centre plates; step in once he is down.
    approach: 14,
    approachSettle: 8,
    attacks: {
      'Grave Breath': trig('sanctum', 'breath', { cast: 'sanctum_korzul_grave_breath', frac: 0.7 }),
      'Tail Sweep': trig('sanctum', 'tail', { cast: 'sanctum_korzul_tail_sweep', frac: 0.7 }),
      'Grave Inferno': trig('sanctum', 'inferno', { at: 2.5 }),
      'Wing Gale': trig('sanctum', 'gale', { cast: 'sanctum_korzul_wing_gale', frac: 0.7 }),
      'Brood from Below': trig('sanctum', 'brood', { at: 2 }),
      'Plunging Fire': {
        run: ['/dev sanctum trigger flight', '/dev sanctum trigger plunge'],
        at: 2,
      },
      'Crashing Descent': {
        run: ['/dev sanctum trigger flight', '/dev sanctum trigger descent'],
        at: 2,
      },
    },
  },
  // Wildheart Basin
  great_saurian: {
    setup: wild('saurian'),
    attacks: {
      'Tail Swipe': trig('wildheart', 'tail', { cast: 'wildheart_saurian_tail_swipe', frac: 1.01 }),
      'Earthshaking Stomp': trig('wildheart', 'stomp', {
        cast: 'wildheart_saurian_stomp',
        frac: 0.7,
      }),
    },
  },
  wildheart_beastmaster: {
    setup: wild('beastmaster'),
    attacks: {
      'Beast Pit Quake': trig('wildheart', 'quake', {
        cast: 'wildheart_beast_pit_quake',
        frac: 0.7,
      }),
      Stalk: trig('wildheart', 'stalk', { at: 2.5 }),
      'Heel!': trig('wildheart', 'heel', { cast: 'wildheart_jaguar_heel', frac: 1.01 }),
    },
  },
  the_gorgebloom: {
    setup: wild('gorgebloom'),
    attacks: {
      'Seed Rain': trig('wildheart', 'seeds', {
        cast: 'wildheart_gorgebloom_seed_rain',
        frac: 0.7,
      }),
      'Vine Lash': trig('wildheart', 'lash', { cast: 'wildheart_gorgebloom_vine_lash', frac: 0.7 }),
      Gorge: trig('wildheart', 'gorge', { cast: 'wildheart_gorgebloom_gorge', frac: 0.7 }),
      Pollinate: trig('wildheart', 'pollinate', { at: 3.5 }),
      'Thorn Sprout': trig('wildheart', 'pods', { at: 12.5 }),
    },
  },
  wildheart_high_priest: {
    setup: wild('zulgar'),
    attacks: {
      'Wildheart Pulse': trig('wildheart', 'pulse', { cast: 'wildheart_zulgar_pulse', frac: 0.7 }),
      'Hunting Spear': trig('wildheart', 'spear', {
        cast: 'wildheart_zulgar_hunting_spear',
        frac: 0.7,
      }),
      'Sun Glyphs': trig('wildheart', 'glyphs', { at: 2 }),
      "Hunter's Ambush": trig('wildheart', 'ambush', { at: 0.9 }),
      'The Idol Wakes': trig('wildheart', 'idol', { at: 2 }),
      "Idol's Breath": trig('wildheart', 'breath', { at: 1.5 }),
    },
  },
  // Raids and the world boss
  nythraxis_scourge_of_thornpeak: {
    setup: ['/dev nythraxisraid normal'],
    camera: { pitch: 1.1, dist: 30 },
    approach: 9,
    settle: 5,
    attacks: {
      'Bone Spike': { run: ['/dev nyx spike'], at: 0.5 },
      'Grave Eruption': { run: ['/dev nyx eruption'], at: 0.5 },
      'Binding Sigil': { run: ['/dev nyx sigil'], at: 0.5 },
      'Dread Curse': { run: ['/dev nyx curse'], at: 0.4 },
    },
  },
  ignivar_herald_of_the_last_flame: {
    setup: ['/dev ignivarraid', '/dev ignivarraid boss'],
    settle: 2,
    attacks: {},
    fractions: { 'Searing Torrent': 0.95 },
    idle: 40,
  },
  varkhul_forgefather_of_the_last_flame: {
    setup: ['/dev varkhulraid normal'],
    settle: 2,
    attacks: {},
    fractions: { 'Cinder Orbs': 0.95, 'Shared Pyre': 0.95, 'Tempering Ray': 0.95 },
    idle: 50,
  },
  balgath_cyclops: {
    setup: ['/dev tp 147 310', '/dev balgath wake'],
    camera: { pitch: 1.25, dist: 30 },
    settle: 4,
    attacks: {
      'Barrow Smash': { run: ['/dev balgath smash'], at: 0.8 },
      'Shockwave Stomp': { run: ['/dev balgath stomp'], at: 0.8 },
    },
  },
  // Rift bosses, in a real rift at rank S (every rankMechanics entry live), and the two
  // (Stage rift bosses ONE PER RUN, ONLY=<id>: in one browser session the second and later
  // rifts often stage a boss that never engages.)
  // Infernal Citadel bosses in a citadel run (a set piece exists only at rank C, where its
  // bosses run their full kit anyway).
  rift_boss_frost: {
    rift: { rank: 'S' },
    camera: { pitch: 1.05, dist: 26 },
    attacks: {},
    idle: 300,
  },
  rift_boss_ember: {
    rift: { rank: 'S' },
    camera: { pitch: 1.05, dist: 26 },
    attacks: {},
    idle: 300,
  },
  rift_boss_venom: {
    rift: { rank: 'S' },
    camera: { pitch: 1.05, dist: 26 },
    attacks: {},
    idle: 300,
  },
  rift_boss_necro: {
    rift: { rank: 'S' },
    camera: { pitch: 1.05, dist: 26 },
    attacks: {},
    idle: 300,
  },
  rift_boss_brute: {
    rift: { rank: 'S' },
    camera: { pitch: 1.05, dist: 26 },
    attacks: {},
    idle: 300,
  },
  rift_boss_arcane: {
    rift: { rank: 'S' },
    camera: { pitch: 1.05, dist: 26 },
    attacks: {},
    idle: 300,
  },
  rift_boss_storm: {
    rift: { rank: 'S' },
    camera: { pitch: 1.05, dist: 26 },
    attacks: {},
    idle: 300,
  },
  rift_boss_tide: {
    rift: { rank: 'S' },
    camera: { pitch: 1.05, dist: 26 },
    attacks: {},
    idle: 300,
  },
  rift_boss_ritualist: {
    rift: { rank: 'C', citadel: true },
    camera: { pitch: 1.05, dist: 26 },
    attacks: {},
    idle: 300,
  },
  rift_boss_pitlord: {
    rift: { rank: 'C', citadel: true },
    camera: { pitch: 1.05, dist: 26 },
    attacks: {},
    idle: 300,
  },
  // Dungeon elites whose named attack is a drawn cone (breathCone), in their own dungeon.
  crypt_ossuary_warrior: {
    setup: ['/dev crypt enter normal', '/dev crypt gates'],
    post: ['/dev crypt spawn warrior'],
    settle: 2,
    attacks: {},
    fractions: { 'Grave Cleave': 0.8 },
    idle: 40,
  },
  crypt_bone_brute: {
    setup: ['/dev crypt enter normal', '/dev crypt gates'],
    post: ['/dev crypt spawn brute'],
    settle: 2,
    attacks: {},
    fractions: { 'Marrow Crush': 0.8 },
    idle: 40,
  },
  drowned_watchman: {
    setup: ['/dev bastion enter normal', '/dev bastion gates'],
    post: ['/dev bastion spawn watchman'],
    settle: 2,
    attacks: {},
    fractions: { 'Halberd Sweep': 0.8 },
    idle: 40,
  },
  drowned_templeguard: {
    setup: ['/dev temple enter normal', '/dev temple gates'],
    post: ['/dev temple spawn templeguard'],
    settle: 2,
    attacks: {},
    fractions: { 'Trident Sweep': 0.8 },
    idle: 40,
  },
  lagoon_snapper: {
    setup: ['/dev temple enter normal', '/dev temple gates'],
    post: ['/dev temple spawn snapper'],
    settle: 2,
    attacks: {},
    fractions: { Snap: 0.8 },
    idle: 40,
  },
  sanctum_drakonid: {
    setup: ['/dev sanctum enter normal', '/dev sanctum gates'],
    post: ['/dev sanctum spawn scaleguard'],
    settle: 2,
    attacks: {},
    fractions: { 'Cinder Breath': 0.8 },
    idle: 40,
  },
};

/** `mobId|Attack name` pairs a reviewer rejected (attack not clearly visible). */
export const REJECTED = new Set([
  // No readable effect in the frame (the attack is a buff, a projectile too small to read,
  // or its marks had already cleared).
  'choirmother_selthe|Moonwater Bolt',
  'choirmother_selthe|The Score',
  'gaoler_ossick|Shackle Pair',
  'mere_hydra_head_center|Tsunami',
  'sledge_tusker|Spilled Braziers',
  'turretback_hermit|Spectral Broadside',
  'vael_the_mistcaller|Gathering Fog',
  'ysolei|Beckoning Moon',
  'wildheart_beastmaster|Stalk',
  'the_gorgebloom|Pollinate',
  'grand_necromancer_velkhar|Waking Thaw',
  'great_saurian|Tail Swipe',
  // A rift bigCast is a cast bar only: no ground telegraph is ever drawn for it.
  'rift_boss_ember|Pyroclasm',
  'rift_boss_necro|Marrow Harvest',
  'rift_boss_pitlord|Rain of Brimstone',
  'rift_boss_storm|Thunderhead',
  'rift_boss_arcane|Arcane Detonation',
  // The frame shows the room's own pentagram floor, not a telegraph of the attack.
  'rift_boss_ritualist|Blood Sigil',
  // Washed out by the ice glare, or no readable shape.
  'korzul_the_gravewyrm|Tail Sweep',
  'korzul_the_gravewyrm|Wing Gale',
  'nythraxis_scourge_of_thornpeak|Binding Sigil',
  'nythraxis_scourge_of_thornpeak|Bone Spike',
  'nythraxis_scourge_of_thornpeak|Dread Curse',
  'nythraxis_scourge_of_thornpeak|Grave Eruption',
  'sledge_tusker|Tusk Sweep',
  // The boss is not in the frame (Korzul stays in his break-free flight above the lake,
  // so the camera rig, which orbits the player, never has him or his marks in view).
  'korzul_the_gravewyrm|Brood from Below',
  'korzul_the_gravewyrm|Crashing Descent',
  'korzul_the_gravewyrm|Grave Inferno',
  'korzul_the_gravewyrm|Plunging Fire',
  // The frame only shows an earlier attack's leftover marks, so it would mislabel them.
  'knight_commander_olen|Rebounding Bulwark',
  'turretback_hermit|Phantom Boarding',
]);
