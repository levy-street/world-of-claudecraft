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

/** Each voice: the audition it was chosen from, or the voice design brief it
 *  was designed from (the Guardians of the Heat and the Quench and the
 *  Masterless Strength, recast on 2026-11-09 as clones of the picked design
 *  previews in the account the pack renders with), and its treatment (null:
 *  the clean level-only chain). */
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
    audition: null,
    designed: 'regal ancient ice queen, clear, cold, elegant, rising into frightening power',
    preset: 'rime-queen-clean',
  },
  heart_heat_guardian: {
    audition: null,
    designed: 'arrogant god-like fire lord, imperious, explodes into furious roars',
    preset: 'hearth-fire-clean',
  },
  heart_masterless_strength: {
    audition: null,
    designed: 'many voices at once, roaring, chaotic rage',
    preset: 'masterless-clean',
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
  'quench.pull': '[regal, cold, elegant]',
  'quench.shatter': '[icy whisper, then sharp]',
  'quench.hole': '[calm, knowing, regal]',
  'quench.wake': '[rising into terrifying power] [commanding]',
  'quench.cross': '[sharp, imperious command]',
  'quench.flurry': '[furious, frightening power]',
  'quench.deepen': '[slow, cold whisper]',
  'quench.breath': '[exhales slowly] [cold, elegant]',
  'quench.slay_a': '[cold, final]',
  'quench.slay_b': '[softly, almost tender]',
  'quench.slay_c': '[regal, cold]',
  'quench.wipe': '[cold whisper]',
  'quench.death': '[gasping, fading, letting go]',
  // The Guardian of the Heat: the first flame's giant.
  'heat.pull': '[arrogant, imperious, god-like]',
  'heat.fist': '[contemptuous, heavy]',
  'heat.sink': '[furious roar]',
  'heat.sinkAgain': '[laughs darkly] [furious]',
  'heat.feed': '[satisfied, low and hungry]',
  'heat.rise': '[roaring, triumphant]',
  'heat.seeds': '[arrogant, slow, ominous]',
  'heat.zones': '[imperious, menacing]',
  'heat.cinder': '[laughs darkly] [mocking]',
  'heat.wheel': '[commanding, building to a roar]',
  'heat.slay_a': '[contemptuous]',
  'heat.slay_b': '[a short, scornful growl]',
  'heat.slay_c': '[imperious, solemn]',
  'heat.wipe': '[laughs darkly] [triumphant]',
  'heat.death': '[gasping, sinking, proud to the end]',
  // The Masterless Strength: the mountain's heart, "we".
  'final.arrivalWake': '[immense, slow, curious whisper]',
  'final.arrivalRise': '[growling, commanding]',
  'final.arrivalRoar': '[furious roar]',
  'final.pull': '[proud, rising rage] [shouting]',
  'final.drinkHeat': '[roaring]',
  'final.drinkQuench': '[cold, commanding]',
  'final.drinkBreath': '[shouting]',
  'final.drinkHammer': '[furious, thunderous]',
  'final.burst': '[laughs wildly] [exultant]',
  'final.anvil': '[crushing, slow, menacing]',
  'final.call': '[commanding roar]',
  'final.callAgain': '[furious, shouting]',
  'final.shattered': '[wounded, seething]',
  'final.poured': '[satisfied, deep growl]',
  'final.final': '[enraged roar]',
  'final.fury': '[chaotic, raging]',
  'final.kneel': '[gasping, fading, almost peaceful]',
  'final.rebirth': '[sudden, furious roar]',
  'final.collapse': '[desperate fury] [shouting]',
  'final.anvilsEnd': '[hollow, menacing]',
  'final.slay_a': '[contemptuous]',
  'final.slay_b': '[low growl]',
  'final.slay_c': '[quiet, satisfied]',
  'final.wipe': '[cold, quiet, menacing]',
  'final.death': '[gasping, broken]',
};

/** Mid-line performance turns (eleven_v3 audio tags), by pack id: each tag
 *  goes in front of its phrase in the synthesized text only, never the
 *  game text. */
export const SMITH_HEART_INLINE_DIRECTIONS = {
  'final.pull': { 'Good.': '[laughs darkly]', 'We will wear': '[furious roar]' },
  'final.death': {
    'But you cannot': '[bitter, defiant]',
    'We will return': '[low, menacing threat]',
  },
  'heat.sinkAgain': { 'Again you burn': '[roaring]' },
};

/** `text` with its inline tags set before their phrases. Throws on a tag
 *  whose phrase the line no longer says. */
function withInlineDirections(id, text) {
  let out = text;
  for (const [phrase, tag] of Object.entries(SMITH_HEART_INLINE_DIRECTIONS[id] ?? {})) {
    if (!out.includes(phrase)) throw new Error(`No "${phrase}" in ${id} for its inline direction`);
    out = out.replace(phrase, `${tag} ${phrase}`);
  }
  return out;
}

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
    synthesisText: `${direction} ${withInlineDirections(line.id, line.text)}`,
    preset: speaker.preset,
  };
}

/** The review copy's file name: `<moment>.mp3`, readable by the designer. */
export function reviewName(line) {
  return `${line.id.split('.').slice(1).join('.')}.mp3`;
}
