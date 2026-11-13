// Audition-only voice briefs for the Ignivar raid bosses. These are kept out of
// npc_voice_prompts.mjs until a human selects a candidate and finalizes it.

/**
 * @typedef {{
 *   npcId: string,
 *   takeId: string,
 *   name: string,
 *   voiceDescription: string,
 *   previewText: string,
 *   visualReferences: string[],
 *   guidanceScale?: number,
 * }} RaidBossVoicePrompt
 */

const VARKHUL_PREVIEW_TEXT = [
  '[a deep stone rumble] The spring did not die. I bound its last memory into iron.',
  '[grinding anger] You call it a prison because your flesh fears endurance.',
  '[booming] I am Varkhul, Forgefather of the Last Flame. Raise your weapons, little sparks.',
  '[a subterranean roar] Every blow will feed the furnace in my chest. By ember, stone, and anvil, I will unmake you.',
  '[fading into a low rumble] Master... I have failed you.',
].join(' ');

/** @type {RaidBossVoicePrompt[]} */
export const RAID_BOSS_VOICE_PROMPTS = [
  {
    npcId: 'ignivar',
    takeId: 'solemn-herald',
    name: 'Ignivar Ashcaller, Solemn Herald',
    voiceDescription:
      'A natural, actor-led performance for an ancient male automaton herald. Monumental low ' +
      'baritone, ceremonial and unnervingly precise, as if a vast furnace-built statue has spoken ' +
      'after centuries of silence. Each phrase is an official proclamation: narrow pitch movement, ' +
      'hammered consonants, deliberate pacing, and long authoritative pauses. Ignivar is proud to ' +
      "be Varkhul's first successful creation and announces his maker's will with absolute devotion. " +
      'Perfect discipline conceals an emerging soul and a buried need for approval. Ancient, solemn, ' +
      'regal, emotionally restrained, and clearly non-human without losing intelligibility.',
    previewText:
      'Ignivar Ashcaller awakens. Let the world burn! The sky itself will burn! I was not forged ' +
      'to kneel before doubt. I am the flame that endured every failed design, the herald who kept ' +
      "my maker's secret sealed. Come closer, little sparks. Test the purpose Varkhul hammered into " +
      'my frame. The last flame consumes all! Varkhul... the seal is broken.',
    visualReferences: [
      'docs/screenshots/ignivar-raid/boss-model-ingame-hifi.png',
      'docs/screenshots/ignivar-raid/boss-model-authoring/hero.png',
    ],
  },
  {
    npcId: 'ignivar',
    takeId: 'forge-heavy-automaton',
    name: 'Ignivar Ashcaller, Forge-Heavy Automaton',
    voiceDescription:
      'A natural, actor-led core voiced through an enormous ancient war automaton. Very deep male ' +
      'bass with dense iron weight, a furnace-like chest resonance, and a dry scorched texture. ' +
      'Words arrive like heavy mechanisms locking into place: slow attacks, hard consonants, brief ' +
      "measured gaps, and controlled bursts of heat. Ignivar is a living weapon and Varkhul's herald, " +
      'not a beast. He speaks with disciplined pride and unquestioning purpose. The massive forged ' +
      'body must be audible, while the final invocation of Varkhul reveals devotion and fear beneath ' +
      'the metal. Ancient, physically imposing, intelligible, and emotionally contained.',
    previewText:
      'Ignivar Ashcaller awakens. Let the world burn! The sky itself will burn! I was not forged ' +
      'to kneel before doubt. I am the flame that endured every failed design, the herald who kept ' +
      "my maker's secret sealed. Come closer, little sparks. Test the purpose Varkhul hammered into " +
      'my frame. The last flame consumes all! Varkhul... the seal is broken.',
    visualReferences: [
      'docs/screenshots/ignivar-raid/boss-model-ingame-hifi.png',
      'docs/screenshots/ignivar-raid/boss-model-authoring/hero.png',
    ],
  },
  {
    npcId: 'ignivar',
    takeId: 'balanced-herald',
    name: 'Ignivar Ashcaller, Balanced Herald',
    voiceDescription:
      'A natural, actor-led performance for an ancient male automaton and ceremonial herald. Deep ' +
      'resonant baritone with the physical scale of a furnace-built metal body, balanced by formal ' +
      'clarity and controlled intelligence. Deliberate medium-slow cadence, limited pitch movement, ' +
      'hammered consonants, and pauses that make every threat sound like an inevitable decree. ' +
      "Ignivar is Varkhul's first creation to endure. He is proud, devoted, and convinced that his " +
      'purpose makes him sacred. A young soul is forming beneath ancient protocols, heard as wounded ' +
      'longing rather than human sentimentality. Monumental and non-human, yet expressive enough ' +
      'that his loyalty and final fear feel real.',
    previewText:
      'Ignivar Ashcaller awakens. Let the world burn! The sky itself will burn! I was not forged ' +
      'to kneel before doubt. I am the flame that endured every failed design, the herald who kept ' +
      "my maker's secret sealed. Come closer, little sparks. Test the purpose Varkhul hammered into " +
      'my frame. The last flame consumes all! Varkhul... the seal is broken.',
    visualReferences: [
      'docs/screenshots/ignivar-raid/boss-model-ingame-hifi.png',
      'docs/screenshots/ignivar-raid/boss-model-authoring/hero.png',
    ],
  },
  {
    npcId: 'varkhul',
    takeId: 'black-anvil-colossus',
    name: 'Varkhul, Black-Anvil Colossus',
    voiceDescription:
      'Native English, fantasy diction shaped by broad Highland Scottish vowels rather than a ' +
      'fully human accent. Male-presenting, ageless. Perfect audio quality. Persona: sentient ' +
      'black-anvil colossus. Emotion: ancient, wrathful, absolute. This is a non-human voice from ' +
      'a colossal stone-and-iron forge construct, not a man speaking through a filter. An ' +
      'intelligible bass register rides above a constant subharmonic stone rumble. Word onsets ' +
      'grind into place, consonants land like slabs, rolled r sounds scrape, and breath moves like ' +
      'a bellows. Slow hammer-struck cadence. No ordinary human warmth, theatrical villain, ogre, ' +
      'or clean robot.',
    previewText: VARKHUL_PREVIEW_TEXT,
    visualReferences: [
      'docs/screenshots/ignivar-raid-expansion/concepts/varkhul_forge_master.png',
      'docs/screenshots/ignivar-raid-expansion/forgefather/sweep-slam-windup.png',
      'public/ui/mobs/varkhul_forgefather_of_the_last_flame.webp',
    ],
    guidanceScale: 0.82,
  },
  {
    npcId: 'varkhul',
    takeId: 'furnace-bound-primordial',
    name: 'Varkhul, Furnace-Bound Primordial',
    voiceDescription:
      'Native English with an old dwarven cadence and broad Scottish-shaped vowels, but no ' +
      'recognizable modern human speaker. Male-presenting, ageless. Perfect audio quality. ' +
      'Persona: furnace-bound primordial. Emotion: smoldering, furious, inexorable. This ' +
      'non-human voice is pushed through a vast furnace cavity with two simultaneous tonal layers: ' +
      'clear low words and a deeper growling undertone. Each exhale feels pressurized, and phrases ' +
      'swell from ember hush to forge blast. Hard broken consonants, uneven stone rasp, and slow ' +
      'deliberate pacing. Intelligent and kingly, never conversational, friendly, mammalian, ' +
      'ogre-like, or robotic.',
    previewText: VARKHUL_PREVIEW_TEXT,
    visualReferences: [
      'docs/screenshots/ignivar-raid-expansion/concepts/varkhul_forge_master.png',
      'docs/screenshots/ignivar-raid-expansion/forgefather/sweep-slam-windup.png',
      'public/ui/mobs/varkhul_forgefather_of_the_last_flame.webp',
    ],
    guidanceScale: 0.8,
  },
  {
    npcId: 'varkhul',
    takeId: 'obsidian-forge-idol',
    name: 'Varkhul, Obsidian Forge Idol',
    voiceDescription:
      'Native English with archaic dwarven word shapes and broad Highland vowels. Male-presenting, ' +
      'older than human. Perfect audio quality. Persona: awakened obsidian forge idol. Emotion: ' +
      'mournful, sacred, annihilating. A non-human mineral voice with very low pitch, immense ' +
      'cavity resonance, sparse breath, and a dry fractured surface. Speech feels carved rather ' +
      'than spoken: long silences, heavy vowels, chiseled consonants, and occasional tectonic ' +
      'strain. It should sound like a dormant mountain furnace has learned language, retaining ' +
      'only a trace of dwarven ancestry. No human narrator, beast, demon, or machine.',
    previewText: VARKHUL_PREVIEW_TEXT,
    visualReferences: [
      'docs/screenshots/ignivar-raid-expansion/concepts/varkhul_forge_master.png',
      'docs/screenshots/ignivar-raid-expansion/forgefather/sweep-slam-windup.png',
      'public/ui/mobs/varkhul_forgefather_of_the_last_flame.webp',
    ],
    guidanceScale: 0.78,
  },
];

// The Smith's Heart's Hammer Council (src/sim/encounters/smith_heart/
// council_voice.ts COUNCIL_LINES): one audition brief per member, its preview
// the member's own lines in the order a pull hears them. Auditions only, like
// the briefs above: nothing here is finalized until the designer picks a
// candidate (node scripts/audition_raid_boss_voices.mjs --set council).

const COUNCIL_REFS = [
  'docs/design/raid/smith_heart.md',
  'src/render/smith_heart_fx/council_bodies_core.ts',
];

/** @type {RaidBossVoicePrompt[]} */
export const HAMMER_COUNCIL_VOICE_PROMPTS = [
  {
    npcId: 'heart-guardian',
    takeId: 'quarry-colossus',
    name: 'Guardian of the Hammer, Quarry Colossus',
    voiceDescription:
      'Native English, male-presenting, ageless. Perfect audio quality. Persona: the Guardian of ' +
      'the Hammer, a vast golem of carved quarry stone that has kept a mountain forge for ' +
      'centuries. Emotion: patient, immovable, then thunderous. A non-human voice: a very low, ' +
      'slow bass with a gravel surface and a faint hollow resonance, as if the words are spoken ' +
      'from inside a stone chest. Each phrase is short and deliberate, consonants landing like ' +
      'set blocks, long pauses between sentences. Never a clean human narrator, never a robot, ' +
      'never a growling beast: an ancient guardian who does not need to shout until the ' +
      'mountain answers him.',
    previewText: [
      "[slow, a low stone rumble] Strangers in the Quarry. The Hammer's strength does not yield to flesh.",
      '[thunderous] The mountain answers me! Hide, if the stone will have you!',
      '[quiet, grinding] The stone remembers. What was theirs is mine.',
      '[cold, from far inside the rock] I am the stone now. My wrath has no body left to fail.',
      '[fading] My strength... I give it to the stone.',
      "[a last breath of dust] The Hammer's strength... is yours to carry.",
    ].join(' '),
    visualReferences: COUNCIL_REFS,
    guidanceScale: 0.7,
  },
  {
    npcId: 'heart-singer',
    takeId: 'resonant-seam',
    name: 'The Seam Singer, Resonant Seam',
    voiceDescription:
      'Native English, female-presenting, ageless. Perfect audio quality. Persona: the Seam ' +
      'Singer, a tall, slender being of stone and glowing amber crystal whose voice is the ' +
      'humming of an ore seam deep in a mountain. Emotion: serene, eerie, quietly cruel. A ' +
      'non-human voice: a clear, low alto with a soft crystalline shimmer and a faint natural ' +
      'echo, as if each word rings inside a cave. Slow, melodic phrasing that almost sings, ' +
      'breathy hushes, then a sudden cutting edge on commands. Never a sweet human singer, never ' +
      'a whisper-only ghost, never robotic.',
    previewText: [
      '[softly, almost singing] Hear the seam sing? It has waited so long for your voices.',
      '[rising to a ringing command] Sing with me, and break!',
      '[a calm hush] The stone remembers. Listen, it still sings.',
      '[echoing, inside the stone] Listen. In the stone, my song never ends.',
      '[a fading note] My song... runs into the rock...',
      '[gently] Hush now. The seam is still.',
    ].join(' '),
    visualReferences: COUNCIL_REFS,
    guidanceScale: 0.65,
  },
];

// The whole Smith's Heart raid (docs/design/raid/smith_heart.md section 7):
// a second take for each Council member and two for each guardian and the
// Masterless Strength, every preview its own lines in the order a pull hears
// them. The Council's first takes above stay in the audition, so every boss
// is judged on several candidates
// (node scripts/audition_raid_boss_voices.mjs --set heart).

const HEART_REFS = ['docs/design/raid/smith_heart.md'];

const GUARDIAN_PREVIEW = [
  "[a slow, heavy growl] Strangers in the Quarry. The Hammer's strength does not yield to flesh.",
  '[a war cry] The mountain answers me! Hide, if the stone will have you!',
  '[grim] Stand in my path, then. The mountain does not turn aside.',
  '[cold contempt] Crushed, as ore beneath the hammer.',
  '[thunderous] Then let the whole Quarry fall!',
  "[a last breath of dust] The Hammer's strength... is yours to carry.",
].join(' ');

const SINGER_PREVIEW = [
  '[softly, almost singing] Hear the seam sing? It has waited so long for your voices.',
  '[a ringing command] Sing with me, and break!',
  '[delighted] Wake, sleeping stone. Rise where they stand!',
  '[a sweet, cruel lilt] Hear that? One note fewer.',
  '[echoing] Listen. In the stone, my song never ends.',
  '[a fading note] My song... runs into the rock...',
].join(' ');

const BREATH_PREVIEW = [
  '[vast, unhurried] You climbed to the top of the mountain to steal its breath? Then breathe with me.',
  '[drawing breath, hushed] Come closer. All of you.',
  '[a roaring gale] Enough breath. Now the storm!',
  '[booming] Hear the summit roar!',
  '[cold] Another one given to the wind.',
  '[fading on a last breath] The Breath... goes back... to the mountain...',
].join(' ');

const QUENCH_PREVIEW = [
  '[cold, very calm] Warm blood on my lake. It will not stay warm for long.',
  '[a frozen whisper] Frozen through. Now break.',
  '[a ringing command] Blades of the Smith, wake! Hunt them across the ice!',
  '[exhaling frost] Breathe in the deep cold.',
  '[quiet, final] Tempered... and broken.',
  '[letting go] The cold... lets go... The Quench is yours.',
].join(' ');

const HEAT_PREVIEW = [
  '[ancient, warm] You walk into the first flame. Nothing leaves it unchanged.',
  '[a booming roar] I rise with the first fire!',
  '[rising] The Hearth turns! Keep pace with it, or burn!',
  '[satisfied] Another spark goes home to the flame.',
  '[fierce] Ash, all of you. The Hearth burns on.',
  '[sinking, gentle] The flame... sinks back... into the stone. Carry it well.',
].join(' ');

const MASTERLESS_PREVIEW = [
  '[immense, slow] Who wakes the heart of the mountain?',
  '[a grinding command] Stone, rise. Bind to us.',
  "[a colossal roar] We are the Smith's strength, and we have no master!",
  '[cold] You carry the four veins in your blood. We will take them back, and seal the mountain over you.',
  '[thunderous] Enough! Every vein at once!',
  '[fading, almost tender] The hand... was never coming back.',
].join(' ');

/** @type {RaidBossVoicePrompt[]} */
export const SMITH_HEART_NEW_VOICE_PROMPTS = [
  {
    npcId: 'heart-guardian',
    takeId: 'bedrock-warlord',
    name: 'Guardian of the Hammer, Bedrock Warlord',
    voiceDescription:
      'Native English, male-presenting, ageless. Perfect audio quality. Persona: the Guardian of ' +
      'the Hammer, a war-leader of living quarry stone the size of a gatehouse, who has struck ' +
      'the mountain for an age. Emotion: martial, proud, crushing. A non-human voice: a huge, ' +
      'chesty basso profundo with a coarse gravel grain, every word struck like a hammer on rock, ' +
      'clipped battle commands, a war cry that fills a quarry. Slow and heavy when he speaks, ' +
      'explosive when he shouts. Never a human soldier, never a robot, never a snarling beast.',
    previewText: GUARDIAN_PREVIEW,
    visualReferences: COUNCIL_REFS,
    guidanceScale: 0.72,
  },
  {
    npcId: 'heart-singer',
    takeId: 'cavern-choir',
    name: 'The Seam Singer, Cavern Choir',
    voiceDescription:
      'Native English, female-presenting, ageless. Perfect audio quality. Persona: the Seam ' +
      'Singer, a slender spirit of amber crystal grown in a mountain seam, whose speech is half ' +
      'song. Emotion: hypnotic, wistful, then piercing. A non-human voice: a high, pure mezzo ' +
      'with a glassy ring and a long cave reverberation, phrases that rise and fall like a chant, ' +
      'soft sung vowels, a bright cutting edge when she commands the stone. Light and airy where ' +
      'the Guardian is heavy. Never a pop singer, never a whisper-only ghost, never robotic.',
    previewText: SINGER_PREVIEW,
    visualReferences: COUNCIL_REFS,
    guidanceScale: 0.66,
  },
  {
    npcId: 'heart-breath',
    takeId: 'summit-gale',
    name: 'Guardian of the Breath, Summit Gale',
    voiceDescription:
      'Native English, male-presenting, ageless. Perfect audio quality. Persona: the Guardian of ' +
      'the Breath, a living bellows of storm granite on a mountain summit, its mouth a horn of ' +
      'stone the wind blows through. Emotion: vast, exultant, merciless. A non-human voice: a ' +
      'deep, open, airy baritone carried on breath, long exhaled vowels like wind across a ' +
      'cliff, hushed and close on the indrawn breath, then a booming roar like a gale tearing ' +
      'over a ridge. Unhurried, sweeping phrasing. Never a human narrator, never a whisper-only ' +
      'ghost, never robotic.',
    previewText: BREATH_PREVIEW,
    visualReferences: HEART_REFS,
    guidanceScale: 0.68,
  },
  {
    npcId: 'heart-breath',
    takeId: 'storm-horn',
    name: 'Guardian of the Breath, Storm Horn',
    voiceDescription:
      'Native English, genderless, ancient. Perfect audio quality. Persona: the Guardian of the ' +
      'Breath, a colossus of storm stone and crystal that breathes the mountain wind and wakes ' +
      'the thunder. Emotion: wild, proud, elemental. A non-human voice: a resonant, hollow tenor ' +
      'with a howling, horn-like timbre and rushing air around every word, as if spoken through ' +
      'a great stone horn; sudden thunderous bursts on commands, a sighing hush between them. ' +
      'Never a human actor, never a monster growl, never robotic.',
    previewText: BREATH_PREVIEW,
    visualReferences: HEART_REFS,
    guidanceScale: 0.66,
  },
  {
    npcId: 'heart-quench',
    takeId: 'glacier-matron',
    name: 'Guardian of the Quench, Glacier Matron',
    voiceDescription:
      'Native English, female-presenting, ageless. Perfect audio quality. Persona: the Guardian ' +
      'of the Quench, a giant of frost-bound granite and clear lake ice who keeps the frozen ' +
      'lake where the smith once tempered his blades. Emotion: glacial, patient, pitiless. A ' +
      'non-human voice: a low, cold contralto, very calm and very slow, crisp consonants like ' +
      'cracking ice, a breathy frost on every exhale, a deep lake stillness behind each line; it ' +
      'rises to a hard, ringing command. Never a sweet human woman, never a witch cackle, never ' +
      'robotic.',
    previewText: QUENCH_PREVIEW,
    visualReferences: HEART_REFS,
    guidanceScale: 0.66,
  },
  {
    npcId: 'heart-quench',
    takeId: 'rime-sovereign',
    name: 'Guardian of the Quench, Rime Sovereign',
    voiceDescription:
      'Native English, male-presenting, ageless. Perfect audio quality. Persona: the Guardian ' +
      'of the Quench, a towering ice colossus crowned with frozen blades, warden of the frozen ' +
      'lake where steel was tempered. Emotion: austere, unhurried, deadly. A non-human voice: a ' +
      'deep, glassy bass-baritone with a brittle crystalline edge, slow measured words that hiss ' +
      'like hot steel plunged into water, long frozen silences, a hollow echo of a vast ice ' +
      'cavern. Never a human narrator, never a growl, never robotic.',
    previewText: QUENCH_PREVIEW,
    visualReferences: HEART_REFS,
    guidanceScale: 0.66,
  },
  // The Quencher, the ice queen of her own model (2026-11-08): three regal
  // takes of an ancient queen of the lake, calm, cold and commanding.
  {
    npcId: 'heart-quench',
    takeId: 'ice-queen',
    name: 'Guardian of the Quench, Ice Queen',
    voiceDescription:
      'Native English, female, ageless. Perfect audio quality. Persona: the Guardian of the ' +
      'Quench, an ancient ice queen, a regal giantess of dark stone in a gown of ice with a crown ' +
      'of ice shards, who cooled every blade the smith forged in her lake. Emotion: calm, cold, ' +
      'commanding, utterly certain. A rich, low mezzo-soprano, poised and imperious, every word ' +
      'measured and crystal clear, a faint frosty breath between lines; she never hurries; her ' +
      'command rings like ice cracking across a lake. Regal, never a witch, never a whisper ' +
      'throughout, never robotic.',
    previewText: QUENCH_PREVIEW,
    visualReferences: HEART_REFS,
    guidanceScale: 0.7,
  },
  {
    npcId: 'heart-quench',
    takeId: 'frozen-sovereign',
    name: 'Guardian of the Quench, Frozen Sovereign',
    voiceDescription:
      'Native English, female, ageless. Perfect audio quality. Persona: an ancient queen of ice ' +
      'who has ruled a frozen lake since the first steel was tempered in it. Emotion: majestic, ' +
      'serene, pitiless. A deep, velvety contralto with royal gravity, slow and deliberate, the ' +
      'stillness of deep winter in every pause, a soft resonance as if spoken in a vast frozen ' +
      'hall; her commands are sharp and absolute. A queen, never a hag, never sweet, never ' +
      'robotic.',
    previewText: QUENCH_PREVIEW,
    visualReferences: HEART_REFS,
    guidanceScale: 0.7,
  },
  {
    npcId: 'heart-quench',
    takeId: 'lake-empress',
    name: 'Guardian of the Quench, Lake Empress',
    voiceDescription:
      'Native English, female, ageless. Perfect audio quality. Persona: the empress of a frozen ' +
      'lake, an immortal ice queen crowned in frost, elegant and dangerous. Emotion: cold, ' +
      'composed, faintly amused, then fierce. A clear, cool, elegant alto with a crystalline ' +
      'edge, precise diction, a hint of an icy shimmer on long vowels, the calm of someone who ' +
      'has never lost; it rises to a ringing, imperious command. Regal and cold, never a witch ' +
      'cackle, never breathy, never robotic.',
    previewText: QUENCH_PREVIEW,
    visualReferences: HEART_REFS,
    guidanceScale: 0.7,
  },
  {
    npcId: 'heart-heat',
    takeId: 'hearth-titan',
    name: 'Guardian of the Heat, Hearth Titan',
    voiceDescription:
      'Native English, male-presenting, primordial. Perfect audio quality. Persona: the ' +
      'Guardian of the Heat, a giant of black basalt and white-gold crystal sunk to its waist in ' +
      'the first wellspring of fire, seven times the height of a man. Emotion: ancient, warm, ' +
      'overwhelming, then furious. A non-human voice: an enormous, resonant bass with a deep ' +
      'chest roar and a crackling, ember-dry texture, slow words that swell like a furnace ' +
      'breathing, a booming roar when the fire rises. Never a human villain, never a demon, ' +
      'never robotic.',
    previewText: HEAT_PREVIEW,
    visualReferences: HEART_REFS,
    guidanceScale: 0.7,
  },
  {
    npcId: 'heart-heat',
    takeId: 'wellspring-colossus',
    name: 'Guardian of the Heat, Wellspring Colossus',
    voiceDescription:
      'Native English, male-presenting, primordial. Perfect audio quality. Persona: the ' +
      'Guardian of the Heat, a colossus of basalt with white fire for a heart, keeper of the ' +
      "smith's first flame. Emotion: solemn, wrathful, majestic. A non-human voice: a very deep, " +
      'rumbling basso with a rough, smoky rasp and a roaring heat behind every vowel, ' +
      'deliberate and grand like an old god speaking from a pit of fire, hard explosive ' +
      'consonants, sudden blasts of rage. Never a human actor, never a monster, never robotic.',
    previewText: HEAT_PREVIEW,
    visualReferences: HEART_REFS,
    guidanceScale: 0.68,
  },
  {
    npcId: 'heart-masterless',
    takeId: 'mountain-heart',
    name: 'The Masterless Strength, Mountain Heart',
    voiceDescription:
      'Native English, genderless, older than the world. Perfect audio quality. Persona: the ' +
      'heart of a mountain, a vast crystal binding a colossus of floating rock, the four ' +
      'strengths of a vanished smith speaking as one, always "we". Emotion: colossal, hollow, ' +
      'relentless. A non-human voice: an immense, slow, cavernous bass that seems to come from ' +
      'deep underground, a crystalline ring over it and stone grinding beneath; each word is a ' +
      'decree, long pauses like a great heartbeat, overwhelming roars. Never a human narrator, ' +
      'never a monster, never robotic.',
    previewText: MASTERLESS_PREVIEW,
    visualReferences: HEART_REFS,
    guidanceScale: 0.7,
  },
  {
    npcId: 'heart-masterless',
    takeId: 'four-vein-chorus',
    name: 'The Masterless Strength, Four-Vein Chorus',
    voiceDescription:
      'Native English, genderless, primordial. Perfect audio quality. Persona: a living ' +
      'mountain heart of crystal whose voice is four elemental strengths speaking together. ' +
      'Emotion: vast, cold, absolute, with buried grief. A non-human voice: a deep, resonant, ' +
      'layered voice like a choir of one, booming low register, a hollow cathedral echo, a ' +
      'humming crystal overtone and the rumble of shifting rock beneath, slow and ceremonial, ' +
      'erupting into overwhelming fury. Never a human actor, never a demon, never robotic.',
    previewText: MASTERLESS_PREVIEW,
    visualReferences: HEART_REFS,
    guidanceScale: 0.68,
  },
];

/** Every audition the Smith's Heart's voices are chosen from: the Council's
 *  first takes and the new ones. */
export const SMITH_HEART_VOICE_PROMPTS = [
  ...HAMMER_COUNCIL_VOICE_PROMPTS,
  ...SMITH_HEART_NEW_VOICE_PROMPTS,
];
