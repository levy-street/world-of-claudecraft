// Hand-authored voiced lines that don't live on any content record: dynamic
// encounter dialogue emitted as chat 'yell' events (currently the Nythraxis raid
// from PR #665, src/sim/encounters/nythraxis.ts). gen_npc_lines.mjs synthesizes
// these alongside the greeting/quest lines.
//
// Escort-quest barks are ALSO yell-channel lines, but they live on EscortDef
// records (startText/successText/failText), so gen_npc_lines.mjs derives them
// straight from the content bundle using `yellKey` below. Do not copy them here:
// a duplicated literal would silently stop matching when the content text is
// reworded, and the clip would go quiet.
//
// `voiceNpc` is the voice folder/id the line is spoken in (must exist in
// scripts/voices/voice_ids.json). Brother Aldric reuses his existing voice.

// Stable clip key for a spoken line. MUST stay identical to the runtime
// derivation in src/ui/hud_voice_cues.ts (yellVoiceKey) so playback can look the
// clip up from the live event text.
export function yellKey(text) {
  return (
    'yell__' +
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60)
  );
}

const N = (text) => ({ key: yellKey(text), voiceNpc: 'nythraxis', text });
const A = (text) => ({ key: yellKey(text), voiceNpc: 'brother_aldric', text });

export const EXTRA_LINES = [
  // Nythraxis, Scourge of Thornpeak (the raid boss) — new voice.
  N('Malric...'),
  N('What have you done'),
  N('Another kingdom comes to challenge me'),
  N('You will join the rest'),
  N('I built a kingdom'),
  N('I will not lose it again'),
  N('Kneel before your king'),
  N('Rise once more'),
  N('Your king commands it'),
  N('Another priest...'),
  N('Your spirit belongs to me'),
  N('Witness true eternity!'),
  N('You cannot stop what was promised..'),
  // Brother Aldric (raid ally) — reuses his existing voice.
  A('Your kingdom is gone, Nythraxis'),
  A('Yet you still cling to it'),
  A('Champions, listen carefully!'),
  A('The wardstones still bind his soul.'),
  A('When the time comes, do not ignore them.'),
  A('Fail and we all perish'),
  // Ferryman Odo, the Proving Shore's guiding voice: his own designed
  // old-man voice (VOICE_PROMPTS ferryman_odo).
  // EXPLICIT stable keys, not yellKey: these are played by key from the
  // island coach (src/ui/bootcamp.ts GUIDE_VOICE_LINES pins the same
  // literals; tests/coach_prompt_view.test.ts holds the two lists together),
  // and the on-screen caption is the LOCALIZED hudChrome.bootcamp.voice* row
  // while this text is what the English VO speaks.
  {
    key: 'guide__odo__arrival',
    voiceNpc: 'ferryman_odo',
    text: 'Easy ashore, friend. See the golden path at your feet? It knows the way better than I do. Follow it.',
  },
  {
    key: 'guide__odo__first_flag',
    voiceNpc: 'ferryman_odo',
    text: 'That is one flag down. Keep those legs moving, only two to go.',
  },
  {
    key: 'guide__odo__run_done',
    voiceNpc: 'ferryman_odo',
    text: 'A clean run, that. Overseer Pell holds your reward, go claim it.',
  },
  {
    key: 'guide__odo__station_done_a',
    voiceNpc: 'ferryman_odo',
    text: 'Fine work. On to the next, the path is already lit for you.',
  },
  {
    key: 'guide__odo__station_done_b',
    voiceNpc: 'ferryman_odo',
    text: 'You are getting the hang of this, no mistake.',
  },
  {
    key: 'guide__odo__veer_off',
    voiceNpc: 'ferryman_odo',
    text: 'Hold up, friend, that is the wrong way. The golden path is behind you.',
  },
  {
    key: 'guide__odo__graduate',
    voiceNpc: 'ferryman_odo',
    text: 'The bell is rung for you. Eastbrook waits across the water, and you are ready for it.',
  },
];
