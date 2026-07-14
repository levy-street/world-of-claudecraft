import { describe, expect, it } from 'vitest';
import { chatInputSize } from '../src/ui/chat_input_autosize';

const LIMITS = { minHeight: 36, maxHeight: 110 };
// The desktop #chat-input has a 2px top + 2px bottom border under box-sizing: border-box.
const BORDER = 4;

describe('chatInputSize', () => {
  it('keeps the floor for an empty / single-line input', () => {
    expect(
      chatInputSize({ contentHeight: 28, placeholderHeight: 0, borderY: BORDER }, LIMITS),
    ).toEqual({ height: 36, overflowY: 'hidden' });
    expect(
      chatInputSize({ contentHeight: 32, placeholderHeight: 0, borderY: BORDER }, LIMITS),
    ).toEqual({ height: 36, overflowY: 'hidden' });
  });

  it('grows with typed content while it fits under the cap', () => {
    expect(
      chatInputSize({ contentHeight: 56, placeholderHeight: 0, borderY: BORDER }, LIMITS),
    ).toEqual({ height: 60, overflowY: 'hidden' });
  });

  it('adds the border so a border-box textarea does not clip its last line', () => {
    // Without the border compensation the box would be sized at exactly the scrollHeight
    // (70) and clip its final line by the 4px border; the returned height accounts for it.
    expect(
      chatInputSize({ contentHeight: 70, placeholderHeight: 0, borderY: BORDER }, LIMITS),
    ).toEqual({ height: 74, overflowY: 'hidden' });
    expect(chatInputSize({ contentHeight: 70, placeholderHeight: 0, borderY: 0 }, LIMITS)).toEqual({
      height: 70,
      overflowY: 'hidden',
    });
  });

  it('sizes an empty box to fit its placeholder when the placeholder is the taller content', () => {
    // A textarea's scrollHeight ignores the placeholder, so an empty box measures short;
    // the placeholder measurement keeps the box tall enough to show a wrapped hint unclipped.
    expect(
      chatInputSize({ contentHeight: 22, placeholderHeight: 50, borderY: BORDER }, LIMITS),
    ).toEqual({ height: 54, overflowY: 'hidden' });
  });

  it('lets typed content win once it grows past the placeholder', () => {
    expect(
      chatInputSize({ contentHeight: 82, placeholderHeight: 50, borderY: BORDER }, LIMITS),
    ).toEqual({ height: 86, overflowY: 'hidden' });
  });

  it('caps height and shows a scrollbar once content overflows', () => {
    expect(
      chatInputSize({ contentHeight: 140, placeholderHeight: 0, borderY: BORDER }, LIMITS),
    ).toEqual({ height: 110, overflowY: 'auto' });
  });

  it('does not show a scrollbar when the border-inclusive height lands on the cap', () => {
    expect(
      chatInputSize({ contentHeight: 106, placeholderHeight: 0, borderY: BORDER }, LIMITS),
    ).toEqual({ height: 110, overflowY: 'hidden' });
    // ...but one pixel more of content past the cap does surface it.
    expect(
      chatInputSize({ contentHeight: 107, placeholderHeight: 0, borderY: BORDER }, LIMITS),
    ).toEqual({ height: 110, overflowY: 'auto' });
  });

  it('rounds fractional measurements', () => {
    expect(
      chatInputSize({ contentHeight: 60.6, placeholderHeight: 0, borderY: 0 }, LIMITS).height,
    ).toBe(61);
  });

  it('falls back to the floor for a non-finite measurement', () => {
    expect(
      chatInputSize({ contentHeight: Number.NaN, placeholderHeight: 0, borderY: 0 }, LIMITS),
    ).toEqual({ height: 36, overflowY: 'hidden' });
  });
});
