import { beforeAll, describe, expect, it } from 'vitest';
import { ensureLocaleLoaded, formatNumber, setLanguage, t } from '../src/ui/i18n';

// The hud_chrome.ts catalog module (namespace hudChrome.*) is English-only by design
// (no per-locale blocks), with translations living in the locale overlays. These keys
// were added by the hardcoded-string sweep; pin that they exist in en and resolve to
// real translations under a non-en locale (i.e. the overlays were filled, pending=0).
const HUD_CHROME_KEYS = [
  'hudChrome.tips.joinChannels',
  'hudChrome.keybinds.emoteWheel',
  'hudChrome.keybinds.targetFriendly',
  'hudChrome.keybinds.targetFriendlyNext',
  'hudChrome.talents.defaultBuildName',
  'hudChrome.options.clickMoveLeft',
  'hudChrome.options.clickMoveRight',
] as const;

// Typed against the real TranslationKey union (a misspelled key fails tsc here).
const EN: Record<(typeof HUD_CHROME_KEYS)[number], string> = {
  'hudChrome.tips.joinChannels':
    'Tip: type /join world or /join lfg to chat with players across the world.',
  'hudChrome.keybinds.emoteWheel': 'Emote Wheel',
  'hudChrome.keybinds.targetFriendly': 'Target Nearest Friendly',
  'hudChrome.keybinds.targetFriendlyNext': 'Cycle Friendly Target',
  'hudChrome.talents.defaultBuildName': 'Build {n}',
  'hudChrome.options.clickMoveLeft': 'Left Click',
  'hudChrome.options.clickMoveRight': 'Right Click',
};

describe('hudChrome.* keys (English-only catalog module)', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('es');
  });

  it('every new key resolves to its exact English value under en', () => {
    setLanguage('en');
    for (const key of HUD_CHROME_KEYS) {
      expect(t(key), key).toBe(EN[key]);
    }
    setLanguage('en');
  });

  it('the translatable keys resolve to non-English under es', () => {
    setLanguage('es');
    // emoteWheel / clickMoveLeft / talents.defaultBuildName / tips.joinChannels are all
    // translated in Spanish. (defaultBuildName keeps the "Build" loanword in some locales
    // such as de_DE, so this assertion uses es, which translates it.)
    const translated = [
      'hudChrome.keybinds.emoteWheel',
      'hudChrome.options.clickMoveLeft',
      'hudChrome.talents.defaultBuildName',
      'hudChrome.tips.joinChannels',
    ] as const;
    for (const key of translated) {
      expect(t(key), `${key} should be translated in es`).not.toBe(EN[key]);
    }
    setLanguage('en');
  });
});

// The settings sliders that the sweep routed through formatNumber: en output must stay
// byte-identical to the historical hand-rolled "50%" / "90°" forms.
describe('settings-slider formatter en byte-identity', () => {
  it('percent slider renders NN%', () => {
    setLanguage('en');
    expect(formatNumber(0.5, { style: 'percent', maximumFractionDigits: 0 })).toBe('50%');
  });

  it('field-of-view slider renders NN°', () => {
    setLanguage('en');
    expect(`${formatNumber(90, { maximumFractionDigits: 0 })}°`).toBe('90°');
  });
});
