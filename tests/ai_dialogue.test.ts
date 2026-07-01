import { describe, expect, it } from 'vitest';
import {
  buildPersonaPrompt,
  DEFAULT_DIALOGUE_MAX_WORDS,
  StaticDialogueProvider,
  staticDialogueResult,
  type DialogueRequest,
} from '../src/ai/dialogue';

const baseRequest = (overrides: Partial<DialogueRequest> = {}): DialogueRequest => ({
  locale: 'en',
  languageName: 'English',
  npc: {
    id: 'marshal_redbrook',
    name: 'Marshal Redbrook',
    title: 'Militia Captain',
    canonicalGreeting: 'Keep your blade close, $C. The Vale is not what it was.',
    zone: 'Eastbrook Vale',
    questTitles: ['Greyjaw', 'Bandit Orders'],
  },
  player: { name: 'Aldric', className: 'Warrior', level: 12 },
  ...overrides,
});

describe('AI dialogue scaffold', () => {
  it('builds a persona prompt from canonical NPC context without gameplay authority', () => {
    const prompt = buildPersonaPrompt(baseRequest());

    expect(prompt.system).toContain('optional cosmetic NPC banter');
    expect(prompt.system).toContain('simulation');
    expect(prompt.system).toContain('Never invent gameplay facts');
    expect(prompt.system).toContain('wallet instructions');
    expect(prompt.system).toContain('no markdown');
    expect(prompt.user).toContain('NPC: Marshal Redbrook, Militia Captain');
    expect(prompt.user).toContain('Locale: en');
    expect(prompt.user).toContain('Reply language: English');
    expect(prompt.user).toContain('Canonical greeting: Keep your blade close');
    expect(prompt.user).toContain('Known quest topics: Greyjaw, Bandit Orders');
    expect(prompt.user).toContain('Player: name: Aldric, class: Warrior, level: 12');
  });

  it('omits absent optional context and normalizes multi-line canonical text', () => {
    const prompt = buildPersonaPrompt(
      baseRequest({
        languageName: null,
        npc: {
          id: 'the_merchant',
          name: 'The Merchant',
          canonicalGreeting: 'Fresh stock today.\nNo refunds tomorrow.',
        },
        player: null,
      }),
    );

    expect(prompt.user).toContain('Reply language: en');
    expect(prompt.user).toContain('Canonical greeting: Fresh stock today. No refunds tomorrow.');
    expect(prompt.user).not.toContain('Player:');
    expect(prompt.user).not.toContain('Known quest topics:');
    expect(prompt.user).not.toContain('Zone:');
  });

  it('clamps prompt word budgets to a small dialogue range', () => {
    expect(buildPersonaPrompt(baseRequest({ maxWords: null })).user).toContain(
      `Limit: ${DEFAULT_DIALOGUE_MAX_WORDS} words.`,
    );
    expect(buildPersonaPrompt(baseRequest({ maxWords: 4 })).user).toContain('Limit: 12 words.');
    expect(buildPersonaPrompt(baseRequest({ maxWords: 120 })).user).toContain('Limit: 80 words.');
    expect(buildPersonaPrompt(baseRequest({ maxWords: 23.8 })).user).toContain('Limit: 23 words.');
  });

  it('returns the canonical greeting through the static fallback provider', async () => {
    const request = baseRequest({
      npc: {
        id: 'scout_maren',
        name: 'Scout Maren',
        canonicalGreeting: '  Tracks in the mud.\nEyes in the reeds.  ',
      },
    });

    await expect(new StaticDialogueProvider().generateNpcDialogue(request)).resolves.toEqual({
      text: 'Tracks in the mud. Eyes in the reeds.',
      source: 'static',
      fallback: true,
    });
    expect(staticDialogueResult(request)).toEqual({
      text: 'Tracks in the mud. Eyes in the reeds.',
      source: 'static',
      fallback: true,
    });
  });
});
