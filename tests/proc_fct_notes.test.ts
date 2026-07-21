import { describe, expect, it } from 'vitest';
import { procAuraConsumeSelfNoteText, procAuraGainSelfNoteText } from '../src/ui/proc_fct_notes';

describe('proc FCT self-note text', () => {
  it('shows the localized aura display name when a next-cast aura arms', () => {
    expect(procAuraGainSelfNoteText('Third Verse', 'next_cast_free')).toBe('Third Verse');
    expect(procAuraGainSelfNoteText('Searing Light', 'next_cast_free')).toBe('Searing Light');
    expect(procAuraGainSelfNoteText('Non Proc Buff', 'buff_ap')).toBeNull();
  });

  it('shows the consume label for each next-cast proc kind', () => {
    expect(procAuraConsumeSelfNoteText('next_cast_free')).toBe('Free');
    expect(procAuraConsumeSelfNoteText('next_execute_free')).toBe('Free');
    expect(procAuraConsumeSelfNoteText('next_cast_instant')).toBe('Instant');
    expect(procAuraConsumeSelfNoteText('next_cast_cheap')).toBe('Cheap!');
    expect(procAuraConsumeSelfNoteText('buff_ap')).toBeNull();
  });
});
