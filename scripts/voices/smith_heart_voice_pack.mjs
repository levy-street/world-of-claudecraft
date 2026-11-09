// The Smith's Heart's voice pack: who speaks each line, in which finalized
// voice, through which elemental treatment (raid_boss_voice_processing.mjs
// SMITH_HEART_VOICE_PROCESSING_PRESETS), and the performance direction each
// line is synthesized with (eleven_v3 audio tags). The lines themselves come
// from the sim (src/sim/encounters/smith_heart/voice_lines.ts
// SMITH_HEART_VOICE_LINES); the clip key is the runtime's (yellKey of the
// English), so the client finds a clip by the live yell.
//
// Rendered and published by scripts/render_smith_heart_voice_pack.mjs.

import { yellKey } from './extra_lines.mjs';

/** Each voice: the audition it was chosen from, its treatment (null: the
 *  clean level-only chain), and the TTS model. */
export const SMITH_HEART_SPEAKERS = {
  heart_hammer_guardian: {
    audition: { boss: 'heart-guardian', take: 'bedrock-warlord', candidate: 3 },
    preset: 'quarry-stone',
  },
  heart_seam_singer: {
    audition: { boss: 'heart-singer', take: 'resonant-seam', candidate: 3 },
    preset: 'seam-crystal',
  },
  heart_breath_guardian: {
    audition: { boss: 'heart-breath', take: 'storm-horn', candidate: 2 },
    preset: 'summit-gale',
  },
  captain_thessaly: { audition: null, preset: null },
  heart_quench_guardian: {
    audition: { boss: 'heart-quench', take: 'lake-empress', candidate: 1 },
    preset: 'rime-lake',
  },
  heart_heat_guardian: {
    audition: { boss: 'heart-heat', take: 'hearth-titan', candidate: 3 },
    preset: 'hearth-fire',
  },
  heart_masterless_strength: {
    audition: { boss: 'heart-masterless', take: 'four-vein-chorus', candidate: 1 },
    preset: 'masterless-heart',
  },
};

export const SMITH_HEART_TTS_MODEL = 'eleven_v3';

/** The performance direction of every line, by its pack id
 *  (`<speaker>.<moment>`). */
export const SMITH_HEART_DIRECTIONS = {
  // The Guardian of the Hammer: a war-leader of quarry stone.
  'guardian.pull': '[slow, heavy, menacing]',
  'guardian.wrath': '[a thunderous war cry]',
  'guardian.rush': '[grim, building to a roar]',
  'guardian.collapse': '[furious roar]',
  'guardian.slay_a': '[cold contempt]',
  'guardian.slay_b': '[grim satisfaction]',
  'guardian.death': '[weakening, grinding to a halt]',
  'guardian.remember': '[low, grinding, vengeful]',
  'guardian.soul': '[cold, echoing from inside the rock]',
  'guardian.wipe': '[quiet, final]',
  'guardian.defeat': '[a last breath of dust]',
  // The Seam Singer: the ore seam's song.
  'singer.pull': '[softly, almost singing]',
  'singer.song': '[a ringing command]',
  'singer.wake': '[delighted, commanding]',
  'singer.rock': '[playful, then sharp]',
  'singer.hush': '[amused, then fierce]',
  'singer.slay_a': '[a sweet, sad lilt]',
  'singer.slay_b': '[a sweet, cruel lilt]',
  'singer.death': '[a fading note]',
  'singer.remember': '[a calm hush]',
  'singer.soul': '[echoing, from inside the stone]',
  'singer.wipe': '[gently, a lullaby]',
  'singer.defeat': '[a last fading note]',
  // The Guardian of the Breath: the summit's bellows.
  'breath.pull': '[vast, unhurried]',
  'breath.blow': '[a low, rushing whisper]',
  'breath.inhale': '[drawing breath, hushed]',
  'breath.storm': '[a roaring gale]',
  'breath.cradle': '[soft, cruel]',
  'breath.drawn': '[ominous]',
  'breath.isles': '[commanding the winds]',
  'breath.bulwark': '[enraged]',
  'breath.roar': '[booming]',
  'breath.knot': '[mocking]',
  'breath.slay_a': '[cold]',
  'breath.slay_b': '[indifferent]',
  'breath.slay_c': '[a long exhale]',
  'breath.wipe': '[a sighing wind]',
  'breath.death': '[fading on a last breath]',
  // Captain Thessaly of Highwatch, on the Cornice with the raid.
  'thessaly.pull': '[shouting over the wind]',
  'thessaly.isles': '[urgent, shouting]',
  'thessaly.circle_a': '[urgent]',
  'thessaly.circle_b': '[firm, shouting]',
  'thessaly.circle_c': '[urgent]',
  'thessaly.inhale': '[alarmed, shouting]',
  'thessaly.storm': '[shouting, alarmed]',
  'thessaly.fall': '[shouting]',
  'thessaly.victory': '[relieved, proud]',
  'thessaly.wipe': '[steady, encouraging]',
  // The Guardian of the Quench: the frozen lake's keeper.
  'quench.pull': '[cold, very calm]',
  'quench.shatter': '[a frozen whisper]',
  'quench.hole': '[calm, knowing]',
  'quench.wake': '[a ringing command]',
  'quench.cross': '[sharp command]',
  'quench.flurry': '[fierce, rising]',
  'quench.deepen': '[a slow, cold whisper]',
  'quench.breath': '[exhaling frost]',
  'quench.slay_a': '[quiet, final]',
  'quench.slay_b': '[softly, soothing]',
  'quench.slay_c': '[cold, calm]',
  'quench.wipe': '[a frozen whisper]',
  'quench.death': '[letting go]',
  // The Guardian of the Heat: the first flame's giant.
  'heat.pull': '[ancient, warm, ominous]',
  'heat.fist': '[heavy, slow]',
  'heat.sink': '[a booming roar]',
  'heat.sinkAgain': '[furious]',
  'heat.feed': '[satisfied, low]',
  'heat.rise': '[a booming roar]',
  'heat.seeds': '[slow, ominous]',
  'heat.zones': '[a deep rumble]',
  'heat.cinder': '[mocking]',
  'heat.wheel': '[rising, commanding]',
  'heat.slay_a': '[satisfied]',
  'heat.slay_b': '[a short growl]',
  'heat.slay_c': '[solemn]',
  'heat.wipe': '[fierce]',
  'heat.death': '[sinking, gentle]',
  // The Masterless Strength: the mountain's heart, "we".
  'final.arrivalWake': '[immense, slow, curious]',
  'final.arrivalRise': '[a grinding command]',
  'final.arrivalRoar': '[a colossal roar]',
  'final.pull': '[cold, immense]',
  'final.drinkHeat': '[roaring]',
  'final.drinkQuench': '[a cold command]',
  'final.drinkBreath': '[booming]',
  'final.drinkHammer': '[thunderous]',
  'final.burst': '[exultant]',
  'final.anvil': '[crushing, slow]',
  'final.call': '[a commanding roar]',
  'final.callAgain': '[furious]',
  'final.shattered': '[wounded, grim]',
  'final.poured': '[a deep, satisfied rumble]',
  'final.final': '[a colossal roar]',
  'final.fury': '[wild, raging]',
  'final.kneel': '[fading, almost peaceful]',
  'final.rebirth': '[a sudden roar]',
  'final.collapse': '[desperate fury]',
  'final.anvilsEnd': '[hollow, final]',
  'final.slay_a': '[cold]',
  'final.slay_b': '[a low rumble]',
  'final.slay_c': '[quiet, satisfied]',
  'final.wipe': '[cold, quiet]',
  'final.death': '[fading, almost tender]',
};

/** A sim line as the pack renders it: its clip key, its voice, treatment and
 *  the text it is synthesized from. Throws on a line with no direction or no
 *  speaker (a new line must be directed before it ships). */
export function packLine(line) {
  const speaker = SMITH_HEART_SPEAKERS[line.voiceNpc];
  if (!speaker) throw new Error(`No Smith's Heart speaker for ${line.voiceNpc}`);
  const direction = SMITH_HEART_DIRECTIONS[line.id];
  if (!direction) throw new Error(`No performance direction for ${line.id}`);
  return {
    id: line.id,
    key: yellKey(line.text),
    voiceNpc: line.voiceNpc,
    text: line.text,
    synthesisText: `${direction} ${line.text}`,
    preset: speaker.preset,
  };
}

/** The review copy's file name: `<moment>.mp3`, readable by the designer. */
export function reviewName(line) {
  return `${line.id.split('.').slice(1).join('.')}.mp3`;
}
