import { describe, expect, it } from 'vitest';
import { IGNIVAR_DEATH_YELL } from '../src/sim/encounters/ignivar';
import { VARKHUL_DEATH_YELL } from '../src/sim/encounters/varkhul';
import { localizeSimText } from '../src/ui/sim_i18n';

describe('Ignivar raid death dialogue localization', () => {
  it('recognizes both historical boss yells at the client boundary', () => {
    expect(IGNIVAR_DEATH_YELL).toBe('Varkhul... the seal is broken.');
    expect(VARKHUL_DEATH_YELL).toBe('Master... I have failed you.');
    expect(localizeSimText(IGNIVAR_DEATH_YELL)).not.toBeNull();
    expect(localizeSimText(VARKHUL_DEATH_YELL)).not.toBeNull();
  });
});
