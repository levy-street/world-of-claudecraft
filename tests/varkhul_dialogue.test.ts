import { describe, expect, it } from 'vitest';
import { VARKHUL_DIALOGUE, VARKHUL_DIALOGUE_LINES } from '../src/sim/encounters/varkhul_dialogue';
import { localizeSimText } from '../src/ui/sim_i18n';

describe('Varkhul encounter dialogue', () => {
  it('pins the five approved Obsidian Forge Idol lines', () => {
    expect(VARKHUL_DIALOGUE_LINES).toEqual([
      'The spring did not die. I bound its last memory into iron.',
      'You call it a prison because your flesh fears endurance.',
      'I am Varkhul, Forgefather of the Last Flame. Raise your weapons, little sparks.',
      'Every blow will feed the furnace in my chest. By ember, stone, and anvil, I will unmake you.',
      'Master... I have failed you.',
    ]);
    expect(new Set(VARKHUL_DIALOGUE_LINES).size).toBe(VARKHUL_DIALOGUE_LINES.length);
    expect(VARKHUL_DIALOGUE.death).toBe('Master... I have failed you.');
  });

  it('registers every approved line at the client localization boundary', () => {
    for (const line of VARKHUL_DIALOGUE_LINES) {
      expect(localizeSimText(line), line).not.toBeNull();
    }
  });
});
