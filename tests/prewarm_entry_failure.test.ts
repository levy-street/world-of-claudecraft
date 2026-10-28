import { expect, it, vi } from 'vitest';
import { handlePrewarmEntryFailure } from '../src/game/prewarm_entry_failure';
import { PrewarmCompletionError } from '../src/render/prewarm_completion';

it('offers reload on incomplete desktop preparation while preserving ordinary fail-soft entry', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const fatal = vi.fn();
    expect(handlePrewarmEntryFailure(new Error('optional warm'), fatal)).toBe(false);
    expect(fatal).not.toHaveBeenCalled();
    expect(handlePrewarmEntryFailure(new PrewarmCompletionError('unsettled links'), fatal)).toBe(
      true,
    );
    expect(fatal).toHaveBeenCalledOnce();
    expect(fatal.mock.calls[0][0]).toContain('unsettled links');
  } finally {
    warn.mockRestore();
  }
});
