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
