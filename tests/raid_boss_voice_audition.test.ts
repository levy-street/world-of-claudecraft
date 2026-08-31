import { describe, expect, it } from 'vitest';
import { RAID_BOSS_VOICE_PROMPTS } from '../scripts/voices/raid_boss_voice_prompts.mjs';
import {
  auditionRelativeDir,
  buildVoiceDesignRequest,
  buildVoiceFinalizationRequest,
  normalizeVoiceDesignPreviews,
  seedForVoiceDesign,
  voiceIdFromFinalizationResponse,
} from '../scripts/voices/voice_design_audition.mjs';

describe('raid boss voice audition prompts', () => {
  it('grounds one natural-performance brief for each raid boss', () => {
    expect(
      RAID_BOSS_VOICE_PROMPTS.map((prompt: { npcId: string; takeId: string }) => ({
        npcId: prompt.npcId,
        takeId: prompt.takeId,
      })),
    ).toEqual([
      { npcId: 'ignivar', takeId: 'solemn-herald' },
      { npcId: 'ignivar', takeId: 'forge-heavy-automaton' },
      { npcId: 'ignivar', takeId: 'balanced-herald' },
      { npcId: 'varkhul', takeId: 'black-anvil-colossus' },
      { npcId: 'varkhul', takeId: 'furnace-bound-primordial' },
      { npcId: 'varkhul', takeId: 'obsidian-forge-idol' },
    ]);

    for (const prompt of RAID_BOSS_VOICE_PROMPTS as {
      npcId: string;
      voiceDescription: string;
      previewText: string;
      visualReferences: string[];
    }[]) {
      expect(prompt.voiceDescription.length, prompt.npcId).toBeGreaterThanOrEqual(20);
      expect(prompt.voiceDescription.length, prompt.npcId).toBeLessThanOrEqual(1000);
      expect(prompt.previewText.length, prompt.npcId).toBeGreaterThanOrEqual(100);
      expect(prompt.previewText.length, prompt.npcId).toBeLessThanOrEqual(1000);
      if (prompt.npcId === 'varkhul') {
        expect(prompt.voiceDescription.toLowerCase(), prompt.npcId).toContain('non-human');
        expect(prompt.voiceDescription.toLowerCase(), prompt.npcId).not.toContain(
          'natural, actor-led',
        );
      } else {
        expect(prompt.voiceDescription.toLowerCase(), prompt.npcId).toContain('natural');
      }
      expect(prompt.visualReferences.length, prompt.npcId).toBeGreaterThan(0);
    }
  });
});

describe('voice design audition request', () => {
  it('uses the expressive v3 model and a stable boss-specific seed', () => {
    const prompt = RAID_BOSS_VOICE_PROMPTS[0];

    expect(buildVoiceDesignRequest(prompt)).toEqual({
      voice_description: prompt.voiceDescription,
      text: prompt.previewText,
      model_id: 'eleven_ttv_v3',
      seed: seedForVoiceDesign('ignivar:solemn-herald'),
      guidance_scale: 0.45,
    });
    expect(auditionRelativeDir(prompt)).toEqual(['ignivar', 'solemn-herald']);
    expect(seedForVoiceDesign('ignivar:solemn-herald')).toBe(1922119354);
    expect(seedForVoiceDesign('ignivar:solemn-herald')).not.toBe(
      seedForVoiceDesign('ignivar:forge-heavy-automaton'),
    );
  });

  it('lets accent-critical takes request stronger prompt adherence', () => {
    const varkhulPrompts = RAID_BOSS_VOICE_PROMPTS.filter(({ npcId }) => npcId === 'varkhul');

    expect(
      varkhulPrompts.map((prompt) => ({
        takeId: prompt.takeId,
        guidanceScale: buildVoiceDesignRequest(prompt).guidance_scale,
      })),
    ).toEqual([
      { takeId: 'black-anvil-colossus', guidanceScale: 0.82 },
      { takeId: 'furnace-bound-primordial', guidanceScale: 0.8 },
      { takeId: 'obsidian-forge-idol', guidanceScale: 0.78 },
    ]);
  });

  it('rejects an out-of-range prompt guidance scale', () => {
    const prompt = RAID_BOSS_VOICE_PROMPTS[0];

    expect(() => buildVoiceDesignRequest({ ...prompt, guidanceScale: 1.1 })).toThrow(
      'guidance scale must be between 0 and 1',
    );
  });

  it('refuses unsafe take ids before they can become output paths', () => {
    expect(() => auditionRelativeDir({ npcId: 'ignivar', takeId: '../escape' })).toThrow(
      'Unsafe audition id',
    );
  });

  it('retains every valid preview instead of silently accepting the first', () => {
    const response = {
      previews: [
        { generated_voice_id: 'voice-a', audio_base_64: 'YQ==' },
        { generated_voice_id: 'voice-b', audio_base_64: 'Yg==' },
        { generated_voice_id: 'voice-c', audio_base_64: 'Yw==' },
      ],
    };

    expect(normalizeVoiceDesignPreviews(response)).toEqual([
      { candidate: 1, generatedVoiceId: 'voice-a', audioBase64: 'YQ==' },
      { candidate: 2, generatedVoiceId: 'voice-b', audioBase64: 'Yg==' },
      { candidate: 3, generatedVoiceId: 'voice-c', audioBase64: 'Yw==' },
    ]);
  });

  it('finalizes the explicitly selected candidate without redesigning the voice', () => {
    const prompt = RAID_BOSS_VOICE_PROMPTS.find(
      ({ npcId, takeId }: { npcId: string; takeId: string }) =>
        npcId === 'ignivar' && takeId === 'forge-heavy-automaton',
    );
    if (!prompt) throw new Error('Missing Ignivar forge-heavy audition prompt');
    const metadata = {
      boss: 'ignivar',
      take: 'forge-heavy-automaton',
      candidates: [
        { candidate: 1, generatedVoiceId: 'voice-a' },
        { candidate: 2, generatedVoiceId: 'voice-b' },
      ],
    };

    expect(buildVoiceFinalizationRequest(prompt, metadata, 2)).toEqual({
      voice_name: 'WoC Ignivar Ashcaller, Forge-Heavy Automaton',
      voice_description: prompt.voiceDescription,
      generated_voice_id: 'voice-b',
    });
    expect(() => buildVoiceFinalizationRequest(prompt, metadata, 3)).toThrow(
      'Candidate 3 is unavailable',
    );
    expect(voiceIdFromFinalizationResponse({ voice_id: 'final-voice' })).toBe('final-voice');
    expect(() => voiceIdFromFinalizationResponse({})).toThrow(
      'Voice finalization returned no voice id',
    );
  });

  it('rejects incomplete responses before writing an unusable audition', () => {
    expect(() => normalizeVoiceDesignPreviews({ previews: [] })).toThrow(
      'Voice Design returned no previews',
    );
    expect(() =>
      normalizeVoiceDesignPreviews({
        previews: [{ generated_voice_id: 'voice-a' }],
      }),
    ).toThrow('preview 1 has no audio');
  });
});
