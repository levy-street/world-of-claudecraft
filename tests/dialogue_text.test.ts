import { describe, expect, it } from 'vitest';
import { NPCS } from '../src/sim/data';
import { formatDialogueText } from '../src/ui/dialogue_text';

describe('dialogue text placeholders', () => {
  it('replaces player names in NPC greetings', () => {
    const text = formatDialogueText(NPCS.brother_aldric_fen.greeting, 'Mira', 'priest');

    expect(text).toContain('above the water, Mira.');
    expect(text).toContain('they wade.');
    expect(text).not.toContain('$N');
  });

  it('replaces every player and class placeholder', () => {
    const text = formatDialogueText('$N, stay sharp, $C. $N!', 'Rowan', 'hunter');

    expect(text).toBe('Rowan, stay sharp, hunter. Rowan!');
  });
});
