// Machine-readable companion to docs/design/npc_voices.md — the source of truth
// for ElevenLabs voice design. One entry per DISTINCT voice (17 total). Brother
// Aldric and Scout Maren each get a single voice even though they recur across
// zones under suffixed NPC ids (brother_aldric_fen, scout_maren_highwatch, …);
// gen_npc_lines.mjs maps those recurring ids back to the base voice via VOICE_ALIAS.
//
// Each `voiceDescription` is the voice-direction paragraph from npc_voices.md;
// `sampleText` is that NPC's "Voice test" sentence. npcId uses the canonical
// content key from src/sim/content/{zone1,zone2,zone3,temple}.ts.

/** @typedef {{ npcId: string, name: string, voiceDescription: string, sampleText: string }} VoicePrompt */

/** @type {VoicePrompt[]} */
export const VOICE_PROMPTS = [
  // -- Eastbrook Vale ------------------------------------------------------
  {
    npcId: 'the_merchant',
    name: 'The Merchant',
    voiceDescription:
      'Warm, silver-tongued auctioneer — mid-range, lightly gravelled, perpetually amused. ' +
      "Rolling crier's cadence that could sell you your own boots; honeyed, persuasive, each " +
      'line lifting on a lilt of opportunity. Age 50s, unhurried. Male.',
    sampleText:
      'Step right up, friend — buy from every adventurer in the realm, or lay out your wares and let the coin come find you.',
  },
  {
    npcId: 'marshal_redbrook',
    name: 'Marshal Redbrook',
    voiceDescription:
      'Weathered military baritone, clipped and grave, gravel under every word. Low, steady, ' +
      'weary authority — short, hard sentences, no wasted breath. Age 50s, granite-firm. Male.',
    sampleText:
      "Keep your blade close and your eyes open. The Vale is not what it was — and I've buried good men who forgot it.",
  },
  {
    npcId: 'trader_wilkes',
    name: 'Trader Wilkes',
    voiceDescription:
      "Bright, chatty everyman tenor — friendly, quick, faintly nasal. Cheerful grocer's patter, " +
      'open vowels, easy laugh in the throat. Age 40s. Male.',
    sampleText: 'Fresh bread, clean water, fair prices — now what can I get for you today, eh?',
  },
  {
    npcId: 'apothecary_lin',
    name: 'Apothecary Lin',
    voiceDescription:
      'Soft, careful alto — precise, slightly hushed, measuring both herbs and words. Cool, ' +
      'smooth, faint cautionary edge. Age 30s–40s. Female.',
    sampleText:
      'Tread carefully in the eastern woods... not everything that blooms there means you well.',
  },
  {
    npcId: 'brother_aldric',
    name: 'Brother Aldric',
    voiceDescription:
      'Resonant, sorrowful clergyman — warm baritone, worn and reverent, carrying old grief. ' +
      'Measured, compassionate, a tightening hush of dread beneath the devotion. Age 60s, ' +
      'devout, haunted. Male.',
    sampleText:
      'The Light keep you, child. Even the dead find no rest here of late — and I fear the mountain is listening.',
  },
  {
    npcId: 'smith_haldren',
    name: 'Smith Haldren',
    voiceDescription:
      'Big, booming, smoke-roughened bass — chest-deep, half-shouted over a forge. Blunt warmth, ' +
      'consonants hammered like hot steel. Age 40s–50s. Male.',
    sampleText:
      "Mind the sparks! Good steel's the difference between a scar and a grave — so don't skimp, eh?",
  },
  {
    npcId: 'fisherman_brandt',
    name: 'Fisherman Brandt',
    voiceDescription:
      'Creaky, salt-cured old sailor — raspy, sing-song, wandering. Quavering with age and ' +
      'sea-wind, muttering odd gurgling asides. Slow, briny. Age 70s. Male.',
    sampleText:
      "Grlmurlgrl— ahh, sorry, lad, been listenin' to them fish-men too long down by the water.",
  },
  {
    npcId: 'foreman_odell',
    name: 'Foreman Odell',
    voiceDescription:
      "Gruff, dust-choked working-man's growl — loud, exasperated, blunt. Flattened vowels, " +
      'short temper. Age 50s. Male.',
    sampleText:
      "The whole dig's crawlin' with those candle-headed vermin — and I want 'em GONE, you hear?",
  },

  // -- Mirefen Marsh -------------------------------------------------------
  {
    npcId: 'warden_fenwick',
    name: 'Warden Fenwick',
    voiceDescription:
      "Low, watchful baritone — slow, deliberate, damp-cool and grim. Dry survivor's humor " +
      'underneath. Age 40s–50s. Male.',
    sampleText:
      "Hold at the gate. Past those reeds, the fen does the killing for us — and it's never short of work.",
  },
  {
    npcId: 'provisioner_hale',
    name: 'Provisioner Hale',
    voiceDescription:
      "Wry, rough-and-ready quartermaster's tenor — practical, dry-witted, worn at the edges. " +
      'Brisk, sardonic. Age 40s. Male.',
    sampleText:
      'Dry boots, dry bread, dry powder — and at Fenbridge, you get two of the three on a good day.',
  },
  {
    npcId: 'herbalist_yara',
    name: 'Herbalist Yara',
    voiceDescription:
      'Low, earthy contralto — slow, knowing, a marsh-witch reading the thicket. Husky, grounded, ' +
      'faintly ominous. Age 40s–50s. Female.',
    sampleText:
      'Mind the thicket west of the road... the webs hang thick as sailcloth this season.',
  },
  {
    npcId: 'scout_maren',
    name: 'Scout Maren',
    voiceDescription:
      'Quick, low, hushed — a ranger just above a whisper, clipped and urgent, half-listening to ' +
      'the treeline. Taut, breathless. Age 20s–30s. Female.',
    sampleText:
      "Quiet feet, short blade — that's what keeps you breathing out here. Speak quick, I'm due back in the reeds.",
  },

  // -- Thornpeak Heights ---------------------------------------------------
  {
    npcId: 'captain_thessaly',
    name: 'Captain Thessaly',
    voiceDescription:
      'Commanding, wind-scoured contralto — proud, resolute, two centuries of duty in the tone. ' +
      'Cold air, steel resolve, a faint tremor beneath. Age 40s. Female.',
    sampleText:
      'Two hundred years this wall has held — and it will not break on my watch, though I feel it groan.',
  },
  {
    npcId: 'quartermaster_bree',
    name: 'Quartermaster Bree',
    voiceDescription:
      'Brisk, no-nonsense mezzo — overworked, dryly funny, rattling off inventory like a sergeant. ' +
      'Tired smirk behind the words. Age 30s–40s. Female.',
    sampleText:
      "Wool, hardtack, steel-shod boots — Highwatch runs on all three, and I'm short of every blessed one.",
  },
  {
    npcId: 'armorer_hode',
    name: 'Armorer Hode',
    voiceDescription:
      'Deep, curt, forge-hardened bass — fewer words, harder edges. Cold-mountain gruffness over ' +
      'banked heat. Age 50s. Male.',
    sampleText: "Forge is hot, grindstone's turning. If it cuts — I sell it. Simple as that.",
  },
  {
    npcId: 'loremaster_caddis',
    name: 'Loremaster Caddis',
    voiceDescription:
      "Dry, curious scholar's tenor — precise, slightly distracted, alight with intellectual " +
      'hunger and a thread of unease. Age 50s–60s. Male.',
    sampleText:
      'Mind the loose shale. The mountain has been... restless of late — and I intend to learn precisely why.',
  },

  // -- Glimmermere Temple --------------------------------------------------
  {
    npcId: 'tidewatcher_ondrel',
    name: 'Ondrel Vane',
    voiceDescription:
      'Hushed, haunted, faintly hypnotic — quiet awe drifting like tide-water, an eerie sleepless ' +
      'edge. Slow, lulling, otherworldly. Age 30s–40s. Male.',
    sampleText:
      "The mere drinks the moonlight... and gives back the drowned. Thirty nights I've watched that gate — and tonight, it is open.",
  },

  // -- Abandoned Crypt raid (PR #665) --------------------------------------
  {
    npcId: 'nythraxis',
    name: 'Nythraxis, Scourge of Thornpeak',
    voiceDescription:
      'A monstrous undead tyrant-king risen from the crypt — a vast, cavernous bass, slow and ' +
      'imperious, grinding like a tomb door over stone. Two centuries of grief twisted into mad, ' +
      'regal cruelty; the cold echo of a dead throne room behind every word. Commanding, contemptuous, ' +
      'unhurried, with a guttural rasp of decay. Age ancient. Male.',
    sampleText:
      'I built a kingdom that should have outlived the stars. Kneel before your king. Another kingdom comes to challenge me — and you too will join the rest.',
  },
];

// Recurring NPC records → the base voice that speaks for them. gen_npc_lines.mjs
// consults this so every Aldric/Maren zone variant reuses one designed voice.
export const VOICE_ALIAS = {
  brother_aldric_fen: 'brother_aldric',
  brother_aldric_highwatch: 'brother_aldric',
  scout_maren_highwatch: 'scout_maren',
};

/** Resolve any NPC content id to the id of the voice that should speak for it. */
export function voiceIdFor(npcId) {
  return VOICE_ALIAS[npcId] ?? npcId;
}
