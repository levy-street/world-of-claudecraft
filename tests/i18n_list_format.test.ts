import { afterEach, describe, expect, it } from 'vitest';
import { formatList, setLanguage } from '../src/ui/i18n';

afterEach(() => setLanguage('en'));

describe('formatList', () => {
  it('uses locale-aware conjunction punctuation', () => {
    setLanguage('en');
    expect(formatList(['A', 'B', 'C'])).toBe('A, B, and C');
    setLanguage('zh_CN');
    expect(formatList(['A', 'B', 'C'])).toBe('A、B和C');
  });

  it('supports compact unit lists for metadata without an English separator', () => {
    expect(formatList(['Random affixes', 'Raid-forged'], { style: 'short', type: 'unit' })).toBe(
      'Random affixes, Raid-forged',
    );
  });
});
