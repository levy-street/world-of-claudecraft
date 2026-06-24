import { describe, it, expect } from 'vitest';
import { chatInputSize } from '../src/ui/chat_input_autosize';

const LIMITS = { minHeight: 32, maxHeight: 110 };

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
