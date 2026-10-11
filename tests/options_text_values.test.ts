import { describe, expect, it } from 'vitest';
import { formatNumber, t } from '../src/ui/i18n';
import { optionsText } from '../src/ui/options_text_values';

describe('optionsText', () => {
  it('renders a plain sentence as is', () => {
    expect(optionsText('hudChrome.options.frameRateCapStatusInert')).toBe(
      t('hudChrome.options.frameRateCapStatusInert'),
    );
  });

  it('resolves key placeholders through t()', () => {
    const out = optionsText('hudChrome.options.gpuBackendActive', {
      backend: 'hudChrome.options.gpuBackendActiveNameVulkan',
    });
    expect(out).toContain(t('hudChrome.options.gpuBackendActiveNameVulkan'));
    expect(out).not.toContain('{backend}');
  });

  it('formats numeric placeholders for the locale', () => {
    const out = optionsText('hudChrome.options.frameRateCapStatusPaced', undefined, {
      fps: 36,
      hz: 1440,
    });
    expect(out).toContain(formatNumber(36));
    expect(out).toContain(formatNumber(1440));
    expect(out).not.toMatch(/\{fps\}|\{hz\}/);
  });
});
