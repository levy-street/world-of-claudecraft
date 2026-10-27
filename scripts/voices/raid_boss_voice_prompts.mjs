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
    npcId: 'heart-slabwright',
    takeId: 'gruff-mason',
    name: 'The Slabwright, Gruff Stone Mason',
    voiceDescription:
      'Native English with a broad, earthy working accent. Male-presenting, ageless. Perfect ' +
      'audio quality. Persona: the Slabwright, a broad, blocky stone being with slab shoulders ' +
      'who raises pillars and drops rock like a mason at work. Emotion: gruff, practical, darkly ' +
      'amused. A non-human voice: a rough mid-low baritone with a dry gravel rasp and a short ' +
      'chesty grunt on effort, quicker and blunter than the Guardian, as if every line is said ' +
      'between two hammer blows. Clipped sentences, heavy stress, a craftsman proud of his ' +
      'stonework. Never a cartoon dwarf, never an ogre, never a clean human.',
    previewText: [
      '[gruff, unhurried] More stone for the wall. Hold still, and I will set you in it.',
      '[a grunt of effort] Stand there. The stone rises where you stand!',
      '[barking, amused] Look up, little ones! The mountain is falling!',
      '[low] The stone remembers. I will finish the work.',
      '[dragging, strained] No hands left, but I will drag this stone to you.',
      '[cracking apart] The slab... splits...',
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
