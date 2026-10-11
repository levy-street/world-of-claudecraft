import { afterEach, describe, expect, it, vi } from 'vitest';
import { openHeaderWiki } from '../src/game/website_navigation';

afterEach(() => vi.unstubAllGlobals());

describe('header wiki navigation', () => {
  it('opens a separate isolated tab on the website without navigating the login tab', () => {
    const open = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal('window', { open, location: { assign } });
    openHeaderWiki(false);
    expect(open).toHaveBeenCalledWith('/wiki', '_blank', 'noopener,noreferrer');
    expect(assign).not.toHaveBeenCalled();
  });

  it('preserves navigation in native and desktop shells', () => {
    const open = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal('window', { open, location: { assign } });
    openHeaderWiki(true);
    expect(assign).toHaveBeenCalledWith('/wiki');
    expect(open).not.toHaveBeenCalled();
  });
});
