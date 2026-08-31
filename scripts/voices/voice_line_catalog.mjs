import { EXTRA_LINES, yellKey } from './extra_lines.mjs';
import { voiceIdFor } from './npc_voice_prompts.mjs';

export function collectVoiceLines({
  NPCS,
  QUESTS,
  ESCORTS,
  IGNIVAR_DIALOGUE_LINES,
  VARKHUL_DIALOGUE_LINES,
}) {
  if (!Array.isArray(IGNIVAR_DIALOGUE_LINES) || !Array.isArray(VARKHUL_DIALOGUE_LINES)) {
    throw new Error('Raid boss dialogue catalogs are unavailable');
  }

  const lines = [];
  for (const npc of Object.values(NPCS)) {
    if (npc.greeting) {
      lines.push({
        key: `greeting__${npc.id}`,
        text: npc.greeting,
        voiceNpc: voiceIdFor(npc.id),
        source: `NPCS.${npc.id}.greeting`,
      });
    }
  }
  for (const quest of Object.values(QUESTS)) {
    if (quest.text) {
      lines.push({
        key: `quest__${quest.id}__offer`,
        text: quest.text,
        voiceNpc: voiceIdFor(quest.giverNpcId),
        source: `QUESTS.${quest.id}.text (giver ${quest.giverNpcId})`,
      });
    }
    if (quest.completionText) {
      lines.push({
        key: `quest__${quest.id}__complete`,
        text: quest.completionText,
        voiceNpc: voiceIdFor(quest.turnInNpcId),
        source: `QUESTS.${quest.id}.completionText (turn-in ${quest.turnInNpcId})`,
      });
    }
  }
  for (const escort of Object.values(ESCORTS ?? {})) {
    for (const [field, text] of [
      ['startText', escort.startText],
      ['successText', escort.successText],
      ['failText', escort.failText],
    ]) {
      if (text) {
        lines.push({
          key: yellKey(text),
          text,
          voiceNpc: voiceIdFor(escort.npcMobId),
          source: `ESCORTS.${escort.id}.${field} (escortee ${escort.npcMobId})`,
        });
      }
    }
  }
  for (const text of IGNIVAR_DIALOGUE_LINES) {
    lines.push({
      key: yellKey(text),
      text,
      voiceNpc: 'ignivar',
      source: `IGNIVAR_DIALOGUE_LINES ${text}`,
    });
  }
  for (const text of VARKHUL_DIALOGUE_LINES) {
    lines.push({
      key: yellKey(text),
      text,
      voiceNpc: 'varkhul',
      source: `VARKHUL_DIALOGUE_LINES ${text}`,
    });
  }
  for (const line of EXTRA_LINES) {
    lines.push({
      key: line.key,
      text: line.text,
      voiceNpc: line.voiceNpc,
      source: `EXTRA_LINES ${line.key}`,
    });
  }
  return lines;
}
