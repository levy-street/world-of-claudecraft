import { describe, expect, it } from 'vitest';
import { detectBrowserKind } from '../src/game/browser_detect';

describe('detectBrowserKind', () => {
  it('detects Chrome', () => {
    expect(
      detectBrowserKind(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        false,
      ),
    ).toBe('chrome');
  });

  it('detects Firefox', () => {
    expect(
      detectBrowserKind(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0',
        false,
      ),
    ).toBe('firefox');
  });

  it('detects Safari on desktop', () => {
    expect(
      detectBrowserKind(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        false,
      ),
    ).toBe('safari');
  });

  it('detects Safari on iOS (iPhone)', () => {
    expect(
      detectBrowserKind(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        false,
      ),
    ).toBe('safari');
  });

  it('detects Chrome on iOS as Safari (WebKit)', () => {
    expect(
      detectBrowserKind(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
        false,
      ),
    ).toBe('safari');
  });

  it('detects Edge as unsupported', () => {
    expect(
      detectBrowserKind(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        false,
      ),
    ).toBe('unsupported');
  });

  it('detects Brave as unsupported via navigator.brave flag', () => {
    expect(
      detectBrowserKind(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        true,
      ),
    ).toBe('unsupported');
  });

  it('detects Opera as unsupported', () => {
    expect(
      detectBrowserKind(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/114.0.0.0',
        false,
      ),
    ).toBe('unsupported');
  });

  it('detects Vivaldi as unsupported', () => {
    expect(
      detectBrowserKind(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Vivaldi/7.0.3495.29',
        false,
      ),
    ).toBe('unsupported');
  });

  it('defaults to supported (chrome) for an unknown user-agent (never nag on ambiguity)', () => {
    expect(detectBrowserKind('SomeRandomUA/1.0', false)).toBe('chrome');
  });
});
