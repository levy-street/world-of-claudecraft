// Extra voiced lines that don't live on an NpcDef/QuestDef — dynamic encounter
// dialogue emitted as chat 'yell' events (currently the Nythraxis raid from
// PR #665, src/sim/sim.ts `nythraxisSay`). gen_npc_lines.mjs synthesizes these
// alongside the greeting/quest lines.
//
// `voiceNpc` is the voice folder/id the line is spoken in (must exist in
// scripts/voices/voice_ids.json). Brother Aldric reuses his existing voice.

// Stable clip key for a spoken line. MUST stay identical to the runtime
// derivation in src/ui/hud.ts (yellVoiceKey) so playback can look the clip up
// from the live event text.
export function yellKey(text) {
  return 'yell__' + text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
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
];
