import { describe, expect, it } from 'vitest';
import { BUDDY_KEYS } from '../src/sim/content/buddies';
import {
  BUDDY_PRESENCE_COLOR,
  BUDDY_REVEAL_COLOR,
  buddyDisplayName,
  buddyEventLine,
} from '../src/ui/buddy_event_lines';
import { setLanguage } from '../src/ui/i18n';

describe('buddy event chat lines', () => {
  it('every companion has its own presence line, in the presence colour', () => {
    setLanguage('en');
    const seen = new Set<string>();
    for (const key of BUDDY_KEYS) {
      const line = buddyEventLine({ type: 'buddyPresence', key });
      expect(line.color).toBe(BUDDY_PRESENCE_COLOR);
      expect(line.text.length).toBeGreaterThan(10);
      expect(line.text).not.toContain('hudChrome.');
      seen.add(line.text);
    }
    // "Different for each pet" (owner plan): no two companions share a line.
    expect(seen.size).toBe(BUDDY_KEYS.length);
  });

  it('an unknown key falls back to the shared line rather than a raw key', () => {
    setLanguage('en');
    const line = buddyEventLine({ type: 'buddyPresence', key: 'not_a_buddy' });
    expect(line.text).toBe('You feel a presence watching you.');
  });

  it('the reveal line names the companion by its localized mob name', () => {
    setLanguage('en');
    const line = buddyEventLine({ type: 'buddyRevealed', key: 'crystal_lich' });
    expect(line.text).toBe(`${buddyDisplayName('crystal_lich')} has decided to follow you.`);
    expect(line.color).toBe(BUDDY_REVEAL_COLOR);
  });
});
