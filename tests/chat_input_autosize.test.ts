import { describe, it, expect } from 'vitest';
import { chatInputSize, chatInputVisibleHeight } from '../src/ui/chat_input_autosize';

const LIMITS = { minHeight: 32, maxHeight: 110 };

describe('chatInputVisibleHeight', () => {
  it('uses typed content height once the user has entered text', () => {
    expect(chatInputVisibleHeight(44, 72, true, 4)).toBe(48);
  });

  it('uses the taller placeholder while the input is empty', () => {
    expect(chatInputVisibleHeight(28, 52, false, 4)).toBe(56);
  });

  it('falls back to the value height for an empty input with a short placeholder', () => {
    expect(chatInputVisibleHeight(28, 0, false, 4)).toBe(32);
  });

  it('ignores non-finite measurements and clamps negative borders', () => {
    expect(chatInputVisibleHeight(Number.NaN, 40, false, -4)).toBe(40);
    expect(chatInputVisibleHeight(40, Number.NaN, true, Number.NaN)).toBe(40);
  });
});

describe('chatInputSize', () => {
  it('keeps the floor for an empty / single-line input', () => {
    expect(chatInputSize(28, LIMITS)).toEqual({ height: 32, overflowY: 'hidden' });
    expect(chatInputSize(32, LIMITS)).toEqual({ height: 32, overflowY: 'hidden' });
  });

  it('grows with content while it fits under the cap', () => {
    expect(chatInputSize(60, LIMITS)).toEqual({ height: 60, overflowY: 'hidden' });
    expect(chatInputSize(110, LIMITS)).toEqual({ height: 110, overflowY: 'hidden' });
  });

  it('caps height and shows a scrollbar once content overflows', () => {
    expect(chatInputSize(140, LIMITS)).toEqual({ height: 110, overflowY: 'auto' });
  });

  it('rounds fractional measurements', () => {
    expect(chatInputSize(60.6, LIMITS).height).toBe(61);
  });

  it('does not show a scrollbar when a fractional height rounds down to the cap', () => {
    expect(chatInputSize(110.4, LIMITS)).toEqual({ height: 110, overflowY: 'hidden' });
    // ...but a fraction that rounds up past the cap does.
    expect(chatInputSize(110.6, LIMITS)).toEqual({ height: 110, overflowY: 'auto' });
  });

  it('falls back to the floor for a non-finite measurement', () => {
    expect(chatInputSize(Number.NaN, LIMITS)).toEqual({ height: 32, overflowY: 'hidden' });
  });
});
