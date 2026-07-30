// Chat timestamps — the pure formatting helper behind the classic-WoW "Show
// Timestamps" interface option. DOM-free, so it's snapshot-tested directly.
import { describe, expect, it } from 'vitest';
import { clampChatClock, formatChatTimestamp } from '../src/ui/hud/chat/chat_timestamp';

// Build a Date at a fixed local wall-clock time (year/month/day are irrelevant
// — only hours/minutes are formatted).
const at = (h: number, m: number) => new Date(2020, 0, 1, h, m, 0);

// Pin the locale to en so the snapshot asserts the English readout regardless
// of the runtime's active language (the formatter is locale-aware now).
describe('formatChatTimestamp (en)', () => {
  it('24-hour format zero-pads hours and minutes', () => {
    expect(formatChatTimestamp(at(14, 32), '24h', 'en')).toBe('[14:32]');
    expect(formatChatTimestamp(at(9, 5), '24h', 'en')).toBe('[09:05]');
    expect(formatChatTimestamp(at(0, 0), '24h', 'en')).toBe('[00:00]');
    expect(formatChatTimestamp(at(23, 59), '24h', 'en')).toBe('[23:59]');
  });

  it('12-hour format uses AM/PM and a non-padded 12-based hour', () => {
    expect(formatChatTimestamp(at(14, 32), '12h', 'en')).toBe('[2:32 PM]');
    expect(formatChatTimestamp(at(9, 5), '12h', 'en')).toBe('[9:05 AM]');
    // midnight and noon both render as 12, not 0
    expect(formatChatTimestamp(at(0, 15), '12h', 'en')).toBe('[12:15 AM]');
    expect(formatChatTimestamp(at(12, 0), '12h', 'en')).toBe('[12:00 PM]');
  });
});

describe('clampChatClock', () => {
  it('keeps a valid 12h value', () => {
    expect(clampChatClock('12h')).toBe('12h');
  });
  it('defaults junk, null, and 24h to 24h', () => {
    expect(clampChatClock('24h')).toBe('24h');
    expect(clampChatClock(null)).toBe('24h');
    expect(clampChatClock('garbage')).toBe('24h');
    expect(clampChatClock('')).toBe('24h');
  });
});
