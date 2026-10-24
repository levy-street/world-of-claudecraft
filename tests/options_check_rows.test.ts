// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '../src/game/settings';
import { t } from '../src/ui/i18n';
import { optionsCheckRow, optionsNoteRow, optionsSubheadRow } from '../src/ui/options_check_rows';

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('options checkbox and text row painters', () => {
  it('uses native checkbox state and the existing persistence/apply hook', () => {
    const settings = new Settings();
    const onSettingChange = vi.fn();
    optionsCheckRow(
      document.body,
      {
        control: 'boolToggle',
        on: false,
        key: 'targetHighlightReticle',
        labelKey: 'hudChrome.options.enemyHighlightReticle',
      },
      { settings, onSettingChange },
    );
    const box = document.querySelector('input');
    expect(box?.checked).toBe(false);
    box?.click();
    expect(settings.get('targetHighlightReticle')).toBe(true);
    expect(box?.checked).toBe(true);
    expect(onSettingChange).toHaveBeenCalledWith('targetHighlightReticle', true);
    expect(document.querySelector('label')?.textContent).toBe(
      t('hudChrome.options.enemyHighlightReticle'),
    );
  });

  it('preserves translated note and subheading rows without HTML interpolation', () => {
    optionsNoteRow(document.body, 'hud.options.on');
    optionsSubheadRow(document.body, t('hud.options.off'));
    expect(document.querySelector('.set-note')?.textContent).toBe(t('hud.options.on'));
    expect(document.querySelector('.set-subhead')?.textContent).toBe(t('hud.options.off'));
  });
});
