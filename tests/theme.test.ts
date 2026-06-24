import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  PRESET_ORDER,
  THEME_KNOB_ORDER,
  THEME_PRESETS,
  contrastRatio,
  ensureReadable,
  isValidHex,
  mixHex,
  parseTheme,
  relativeLuminance,
  resolveTheme,
  rgba,
  serializeTheme,
  themeCssVars,
} from '../src/ui/theme';

// Independent WCAG 2.1 contrast helper for the test (does not call the module's
// own contrastRatio, so the assertions cross-check the implementation).
function wcagContrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const ch = (i: number) => {
      const cs = parseInt(hex.slice(i, i + 2), 16) / 255;
      return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  };
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('theme pure core', () => {
  it('every preset defines every knob with a valid hex', () => {
    for (const id of PRESET_ORDER) {
      const knobs = THEME_PRESETS[id];
      for (const knob of THEME_KNOB_ORDER) {
        expect(isValidHex(knobs[knob]), `${id}.${knob}`).toBe(true);
      }
    }
  });

  it('classic preset reproduces the shipped gold palette', () => {
    const vars = themeCssVars(THEME_PRESETS.classic);
    expect(vars['--gold']).toBe('#ffd100');
    expect(vars['--border']).toBe('#6f5a2a');
    expect(vars['--color-text-light']).toBe('#f0ebd8');
    expect(vars['--color-hp']).toBe('#1eb838');
  });

  it('expands knobs into the full CSS variable set including derived colours', () => {
    const vars = themeCssVars(THEME_PRESETS.classic);
    // derived from accent
    expect(vars['--gold-dim']).toBe(mixHex('#ffd100', '#000000', 0.22));
    expect(vars['--color-primary-glow']).toBe(rgba('#ffd100', 0.2));
    // panel-bg is a gradient built from the panel knob
    expect(vars['--panel-bg']).toContain('linear-gradient');
    expect(vars['--panel-base']).toBe('#15151f');
    // scrollbar derives from border
    expect(vars['--scrollbar-thumb-hover']).toBe('#6f5a2a');
  });

  it('custom overrides win over the preset; absent knobs fall through', () => {
    const knobs = resolveTheme({ preset: 'midnight', custom: { accent: '#abcdef' } });
    expect(knobs.accent).toBe('#abcdef');
    expect(knobs.border).toBe(THEME_PRESETS.midnight.border);
  });

  it('ignores invalid custom hex values', () => {
    const knobs = resolveTheme({ preset: 'classic', custom: { accent: 'not-a-color' } as never });
    expect(knobs.accent).toBe(THEME_PRESETS.classic.accent);
  });

  it('mixHex and rgba are pure and correct at the endpoints', () => {
    expect(mixHex('#ffffff', '#000000', 0)).toBe('#ffffff');
    expect(mixHex('#ffffff', '#000000', 1)).toBe('#000000');
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(rgba('#ff8040', 0.5)).toBe('rgba(255, 128, 64, 0.5)');
  });

  it('contrast helper agrees with WCAG reference at known pairs', () => {
    // black on white is the canonical 21:1; identical colours are 1:1.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('every preset clears AA for text/muted/accent over BOTH panel and panel edge', () => {
    for (const id of PRESET_ORDER) {
      const knobs = resolveTheme({ preset: id, custom: {} });
      const vars = themeCssVars(knobs);
      const panel = vars['--panel-base'];
      const edge = vars['--panel-edge'];
      const text = vars['--color-text-light'];
      const muted = vars['--color-text-muted'];
      const accent = vars['--color-accent'];
      for (const bg of [panel, edge]) {
        expect(wcagContrast(text, bg), `${id} text on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(wcagContrast(muted, bg), `${id} muted on ${bg}`).toBeGreaterThanOrEqual(3);
        expect(wcagContrast(accent, bg), `${id} accent on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('overlay text token stays light regardless of preset (it floats over the world)', () => {
    for (const id of PRESET_ORDER) {
      const vars = themeCssVars(resolveTheme({ preset: id, custom: {} }));
      // Overlay text relies on its text-shadow over arbitrary terrain, so it must
      // remain a light value (high luminance) for every preset, never go dark.
      expect(relativeLuminance(vars['--color-text-overlay'])).toBeGreaterThan(0.7);
    }
  });

  it('custom-override guard repairs a white-on-white text/panel pair', () => {
    const knobs = resolveTheme({ preset: 'classic', custom: { text: '#ffffff', panel: '#ffffff' } });
    expect(knobs.panel).toBe('#ffffff');
    // text must have been pulled away from white to clear AA on the white panel.
    expect(knobs.text).not.toBe('#ffffff');
    expect(wcagContrast(knobs.text, knobs.panel)).toBeGreaterThanOrEqual(4.5);
  });

  it('custom-override guard repairs black-on-black too', () => {
    const knobs = resolveTheme({ preset: 'midnight', custom: { text: '#000000', panel: '#000000' } });
    expect(wcagContrast(knobs.text, knobs.panel)).toBeGreaterThanOrEqual(4.5);
  });

  it('ensureReadable leaves an already-passing pair untouched', () => {
    expect(ensureReadable('#000000', '#ffffff', 4.5)).toBe('#000000');
  });

  it('parseTheme round-trips a serialized state and rejects junk', () => {
    const state = { preset: 'parchment' as const, custom: { rage: '#112233' } };
    expect(parseTheme(JSON.parse(serializeTheme(state)))).toEqual(state);
    expect(parseTheme(null)).toEqual(DEFAULT_THEME);
    expect(parseTheme({ preset: 'bogus', custom: { accent: 'xyz' } }).preset).toBe('classic');
    expect(parseTheme({ preset: 'bogus' }).custom).toEqual({});
  });
});
