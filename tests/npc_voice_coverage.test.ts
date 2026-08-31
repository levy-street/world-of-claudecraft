// Guards the NPC voice-over pipeline's WIRING, not its audio. Rendering clips needs
// an ElevenLabs key, so nothing here asserts an mp3 exists; what it does assert is
// that every line the game can speak resolves to a designed voice, that recurring
// characters collapse onto one voice, and that no two different lines can claim the
// same clip file. Those are the failure modes that go silently wrong: a new NPC ships
// mute, or a reworded bark quietly stops matching its clip.
//
// Adding an NPC or an escort? Add a VOICE_PROMPTS entry (text only, no API call) in
// scripts/voices/npc_voice_prompts.mjs, or a VOICE_ALIAS row if it is an existing
// character recurring under a new id. Authoring guide: docs/design/npc_voices.md.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXTRA_LINES, yellKey } from '../scripts/voices/extra_lines.mjs';
import { VOICE_ALIAS, VOICE_PROMPTS } from '../scripts/voices/npc_voice_prompts.mjs';
import { collectVoiceLines } from '../scripts/voices/voice_line_catalog.mjs';
import { ESCORTS, NPCS, QUESTS } from '../src/sim/data';
import { IGNIVAR_DIALOGUE_LINES } from '../src/sim/encounters/ignivar_dialogue';
import { VARKHUL_DIALOGUE_LINES } from '../src/sim/encounters/varkhul_dialogue';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const voiceIds: Record<string, string> = JSON.parse(
  readFileSync(join(repoRoot, 'scripts/voices/voice_ids.json'), 'utf8'),
);
const promptIds = new Set<string>(VOICE_PROMPTS.map((p: { npcId: string }) => p.npcId));

const allLines = () =>
  collectVoiceLines({
    NPCS,
    QUESTS,
    ESCORTS,
    IGNIVAR_DIALOGUE_LINES,
    VARKHUL_DIALOGUE_LINES,
  });

describe('NPC voice prompt catalog', () => {
  it('declares each voice exactly once', () => {
    const ids = VOICE_PROMPTS.map((p: { npcId: string }) => p.npcId);
    expect([...new Set(ids)]).toHaveLength(ids.length);
  });

  it('gives every voice a description and a sample the design endpoint will accept', () => {
    for (const p of VOICE_PROMPTS as {
      npcId: string;
      voiceDescription: string;
      sampleText: string;
    }[]) {
      // The text-to-voice design endpoint requires a 20+ char description; the sample
      // is padded to 100 by gen_npc_voices.mjs, so only the description is a hard floor.
      expect(p.voiceDescription.length, p.npcId).toBeGreaterThan(20);
      expect(p.sampleText.trim().length, p.npcId).toBeGreaterThan(0);
    }
  });

  it('aliases recurring characters onto a declared voice, never onto another alias', () => {
    for (const [from, to] of Object.entries(VOICE_ALIAS as Record<string, string>)) {
      expect(promptIds.has(to), `${from} -> ${to}`).toBe(true);
      expect(promptIds.has(from), `${from} must not also be its own voice`).toBe(false);
      expect(Object.hasOwn(VOICE_ALIAS, to), `${to} must not itself be aliased`).toBe(false);
    }
  });

  it('has a designed ElevenLabs voice id for every declared voice', () => {
    const undesigned = [...promptIds].filter((id) => !voiceIds[id]);
    expect(undesigned).toEqual([]);
  });

  it('speaks every declared voice at least once (no orphan voice)', () => {
    const spoken = new Set(allLines().map((l) => l.voiceNpc));
    expect([...promptIds].filter((id) => !spoken.has(id))).toEqual([]);
  });
});

describe('NPC voice line coverage', () => {
  it('resolves every speakable line to a declared voice', () => {
    const unvoiced = allLines()
      .filter((l) => !promptIds.has(l.voiceNpc))
      .map((l) => `${l.source} -> no voice "${l.voiceNpc}"`);
    expect(unvoiced).toEqual([]);
  });

  it('never lets two different lines claim the same clip file', () => {
    const byKey = new Map<string, string>();
    const collisions: string[] = [];
    for (const l of allLines()) {
      const prev = byKey.get(l.key);
      if (prev !== undefined && prev !== l.text) collisions.push(`${l.key}: ${prev} / ${l.text}`);
      byKey.set(l.key, l.text);
    }
    expect(collisions).toEqual([]);
  });
});

describe('yell clip keys', () => {
  // Escort barks and encounter yells are looked up at runtime from the LIVE chat text
  // by yellVoiceKey in src/ui/hud_voice_cues.ts (extracted out of src/ui/hud.ts with
  // the HUD's other voice-clip key resolvers). If that derivation and the generator's
  // yellKey ever drift, every yell goes silent with no other symptom, so pin them
  // together.
  const voiceCuesSrc = readFileSync(join(repoRoot, 'src/ui/hud_voice_cues.ts'), 'utf8');

  it('keeps yellVoiceKey byte-identical in shape to the generator', () => {
    const body = voiceCuesSrc.slice(
      voiceCuesSrc.indexOf('function yellVoiceKey'),
      voiceCuesSrc.indexOf('}', voiceCuesSrc.indexOf('function yellVoiceKey')),
    );
    expect(body).toContain('.toLowerCase()');
    expect(body).toContain("replace(/[^a-z0-9]+/g, '_')");
    expect(body).toContain("replace(/^_+|_+$/g, '')");
    expect(body).toContain('.slice(0, 60)');
    expect(body).toContain('`yell__$');
  });

  it('slugs real content barks the way the runtime will', () => {
    // Reference implementation copied from hud_voice_cues.ts yellVoiceKey; if this
    // ever needs a change, the generator and the resolver must change with it.
    const reference = (text: string) =>
      `yell__${text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60)}`;
    const texts = [
      ...Object.values(ESCORTS).flatMap((e) => [e.startText, e.successText, e.failText]),
      ...(EXTRA_LINES as { text: string }[]).map((e) => e.text),
      ...IGNIVAR_DIALOGUE_LINES,
      ...VARKHUL_DIALOGUE_LINES,
    ];
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(yellKey(text), text).toBe(reference(text));
  });
});
