import { describe, it, expect } from 'vitest';
import {
  detectBrowserEngine,
  cssEffectsTier,
  browserBodyClasses,
  BROWSER_EFFECTS_FULL,
  BROWSER_EFFECTS_REDUCED,
  BROWSER_EFFECTS_MINIMAL,
  type BrowserEnv,
} from '../src/game/browser_env';

// Real-world UA strings (trimmed) for the three engines across desktop + mobile.
const UA = {
  chromeDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  edgeDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  firefoxDesktop: 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  firefoxOld: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:102.0) Gecko/20100101 Firefox/102.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0',
  safariDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  safariOld: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1',
};

describe('detectBrowserEngine', () => {
  it('classifies Chromium desktop (Chrome + Edge)', () => {
    expect(detectBrowserEngine(UA.chromeDesktop)).toEqual({ engine: 'chromium', version: 124 });
    expect(detectBrowserEngine(UA.edgeDesktop)).toEqual({ engine: 'chromium', version: 124 });
  });
  it('classifies Gecko / Firefox and reads its version', () => {
    expect(detectBrowserEngine(UA.firefoxDesktop)).toEqual({ engine: 'gecko', version: 126 });
    expect(detectBrowserEngine(UA.firefoxOld)).toEqual({ engine: 'gecko', version: 102 });
    expect(detectBrowserEngine(UA.firefoxAndroid)).toEqual({ engine: 'gecko', version: 126 });
  });
  it('classifies desktop Safari via Version/ with no Chrome token', () => {
    expect(detectBrowserEngine(UA.safariDesktop)).toEqual({ engine: 'webkit', version: 17 });
    expect(detectBrowserEngine(UA.safariOld)).toEqual({ engine: 'webkit', version: 14 });
  });
  it('treats every iOS browser as WebKit (Apple mandates the engine)', () => {
    expect(detectBrowserEngine(UA.safariIphone).engine).toBe('webkit');
    // iOS Chrome (CriOS) must NOT read as Chromium — it is Safari under the hood.
    expect(detectBrowserEngine(UA.chromeIos).engine).toBe('webkit');
  });
  it('returns unknown for an unrecognized UA', () => {
    expect(detectBrowserEngine('SomeRandomBot/1.0')).toEqual({ engine: 'unknown', version: 0 });
    expect(detectBrowserEngine('')).toEqual({ engine: 'unknown', version: 0 });
  });
});

describe('cssEffectsTier — manual override pins the tier', () => {
  const base = { engine: 'chromium' as const, version: 124, mobile: false, renderTier: 'high' as const };
  it('honors Full/Reduced/Minimal regardless of detection', () => {
    expect(cssEffectsTier({ ...base, mobile: true, override: BROWSER_EFFECTS_FULL })).toBe('full');
    expect(cssEffectsTier({ ...base, override: BROWSER_EFFECTS_REDUCED })).toBe('reduced');
    expect(cssEffectsTier({ ...base, override: BROWSER_EFFECTS_MINIMAL })).toBe('minimal');
  });
});

describe('cssEffectsTier — auto detection', () => {
  it('desktop Chromium on a healthy GPU keeps full effects', () => {
    expect(cssEffectsTier({ engine: 'chromium', version: 124, mobile: false, renderTier: 'high' })).toBe('full');
  });
  it('any mobile drops at least to reduced; webkit/gecko mobile go minimal', () => {
    expect(cssEffectsTier({ engine: 'chromium', version: 124, mobile: true, renderTier: 'high' })).toBe('reduced');
    expect(cssEffectsTier({ engine: 'webkit', version: 17, mobile: true, renderTier: 'high' })).toBe('minimal');
    expect(cssEffectsTier({ engine: 'gecko', version: 126, mobile: true, renderTier: 'high' })).toBe('minimal');
  });
  it('the renderer dropping to the low GPU tier pulls the DOM down with it', () => {
    expect(cssEffectsTier({ engine: 'chromium', version: 124, mobile: false, renderTier: 'low' })).toBe('reduced');
    expect(cssEffectsTier({ engine: 'chromium', version: 124, mobile: true, renderTier: 'low' })).toBe('minimal');
  });
  it('old Safari / old Firefox get reduced on desktop; modern stay full', () => {
    expect(cssEffectsTier({ engine: 'webkit', version: 14, mobile: false, renderTier: 'high' })).toBe('reduced');
    expect(cssEffectsTier({ engine: 'webkit', version: 17, mobile: false, renderTier: 'high' })).toBe('full');
    expect(cssEffectsTier({ engine: 'gecko', version: 102, mobile: false, renderTier: 'high' })).toBe('reduced');
    expect(cssEffectsTier({ engine: 'gecko', version: 126, mobile: false, renderTier: 'high' })).toBe('full');
  });
  it('desktop Safari on the medium tier trims to reduced (backdrop-filter cost)', () => {
    expect(cssEffectsTier({ engine: 'webkit', version: 17, mobile: false, renderTier: 'medium' })).toBe('reduced');
  });
  it('unknown engine stays conservative', () => {
    expect(cssEffectsTier({ engine: 'unknown', version: 0, mobile: false, renderTier: 'high' })).toBe('reduced');
    expect(cssEffectsTier({ engine: 'unknown', version: 0, mobile: true, renderTier: 'high' })).toBe('minimal');
  });
});

describe('browserBodyClasses', () => {
  it('emits engine / device / tier classes', () => {
    const env: BrowserEnv = { engine: 'webkit', engineVersion: 17, mobile: true };
    expect(browserBodyClasses(env, 'minimal')).toEqual(['engine-webkit', 'is-mobile', 'fx-minimal']);
    const desk: BrowserEnv = { engine: 'gecko', engineVersion: 126, mobile: false };
    expect(browserBodyClasses(desk, 'full')).toEqual(['engine-gecko', 'is-desktop', 'fx-full']);
  });
});
