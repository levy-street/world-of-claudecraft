import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Source-text guards for the graphics-tier effect wiring. The pure resolver is
// exhaustively unit-tested (ui_effects_profile.test.ts); these pin the load-bearing
// HOST + CSS rules that have no other regression backstop: the applier seam, the
// main.ts dispatch, and the four effect buckets the tokens drive. A live
// computed-style proof on the built bundle confirms the cascade RESOLVES correctly;
// this guards that the rules do not silently disappear from source (a moved comment
// or a careless reformat) before that proof would ever run.
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const tokensCss = read('src/styles/tokens.css');
const hudCss = read('src/styles/hud.css');
const applier = read('src/ui/ui_effects_applier.ts');
const main = read('src/main.ts');

describe('tokens.css - :root seeds (full-Ultra defaults) + glass low drop', () => {
  it('seeds the three --fx-* tokens to their full-effect values so calc/var reads are inert by default', () => {
    expect(tokensCss).toContain('--fx-shadow: 1;');
    expect(tokensCss).toContain('--fx-ambient-anim: running;');
    expect(tokensCss).toContain('--motion-scale: 1;');
  });

  it('drops glass whole-rule at the low tier, -webkit-first, !important to cross cascade layers', () => {
    expect(tokensCss).toContain(':root[data-fx-level="low"] *');
    // -webkit twin must precede the standard prop (the Lightning minify gotcha).
    const webkitIdx = tokensCss.indexOf('-webkit-backdrop-filter: none !important;');
    const stdIdx = tokensCss.indexOf('\n    backdrop-filter: none !important;');
    expect(webkitIdx).toBeGreaterThan(-1);
    expect(stdIdx).toBeGreaterThan(webkitIdx);
  });
});

describe('hud.css - glow scales with --fx-shadow (0 at low), structural shadows literal', () => {
  it('multiplies the four decorative outer-glow blurs by --fx-shadow', () => {
    expect(hudCss).toContain('0 0 calc(8px * var(--fx-shadow, 1)) #e74c3c99'); // player portrait
    expect(hudCss).toContain('0 0 calc(8px * var(--fx-shadow, 1)) #4fc3ff66'); // rest indicator
    expect(hudCss).toContain('0 0 calc(5px * var(--fx-shadow, 1)) #ff5533aa'); // combo pips
    expect(hudCss).toContain('0 0 calc(7px * var(--fx-shadow, 1)) #e74c3c99'); // party-frame combat
  });

  it('keeps the inset structural shadow literal (not token-scaled)', () => {
    expect(hudCss).toContain('inset 0 0 12px #0009');
  });
});

describe('hud.css - ambient loops gate on --fx-ambient-anim + --motion-scale', () => {
  it('gives every ambient loop a play-state token (paused at low/reduced)', () => {
    const playStates =
      hudCss.match(/animation-play-state: var\(--fx-ambient-anim, running\);/g) ?? [];
    // combat-flash, rest, talent, fiesta, party-badge, daily-rewards chest + icon, ai-tag
    expect(playStates.length).toBe(8);
  });

  it('calms each ambient duration by --motion-scale (near-zero, never 0, under reduced-motion)', () => {
    for (const dur of ['1s', '2s', '1.6s', '1.4s']) {
      expect(hudCss).toContain(`animation-duration: calc(${dur} * var(--motion-scale, 1));`);
    }
  });
});

describe('hud.css - the death-warning vignette holds full tint on ALL THREE calming axes', () => {
  it('drops the breathe + holds --lhv-opacity under OS reduced-motion, the setting, and the low tier', () => {
    // The @media OS axis pre-existed; the setting + low-tier axes are the additions.
    expect(hudCss).toContain('@media (prefers-reduced-motion: reduce) {');
    expect(hudCss).toContain('body.reduce-motion #low-health-vignette {');
    expect(hudCss).toContain(':root[data-fx-level="low"] #low-health-vignette {');
    // Each axis drops the animation outright and holds the FULL tint (never the dim
    // 0%-keyframe a paused animation would freeze on).
    const holds = hudCss.match(/animation: none;\s*opacity: var\(--lhv-opacity\);/g) ?? [];
    expect(holds.length).toBe(3);
  });
});

describe('hud.css - Reduce Motion never hides the damage numbers', () => {
  it('drops the FCT rise outright and holds full opacity (a 0.01ms forwards rise would freeze on the opacity-0 end keyframe, hiding every number for its pooled lifetime)', () => {
    const rule = hudCss.match(/body\.reduce-motion \.fct \{[^}]*\}/);
    expect(rule).not.toBeNull();
    // Same shape as the low-health-vignette calming axes: animation off, value held.
    expect(rule?.[0]).toContain('animation: none !important;');
    expect(rule?.[0]).toContain('opacity: 1;');
    // The old shed (finish-the-rise-instantly) must be gone: forwards fill lands it
    // on the invisible end frame.
    expect(rule?.[0]).not.toContain('animation-duration');
  });
});

describe('hud.css - FCT crit sheds the pop at low (keeps the number)', () => {
  it('swaps the crit keyframes for the plain rise at the low tier only', () => {
    expect(hudCss).toContain(':root[data-fx-level="low"] .fct.crit {');
    expect(hudCss).toContain('animation-name: fct-rise;');
    // fct-rise must exist as a keyframe target (the swap is inert if it does not).
    expect(hudCss).toContain('@keyframes fct-rise {');
  });
});

describe('applier - the diff-guarded, debounced, matchMedia-driven DOM host', () => {
  it('owns the OS prefers-reduced-motion channel with a change listener', () => {
    expect(applier).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(applier).toContain("addEventListener?.('change', this.applyNow)");
  });

  it('diff-guards on the pure uiEffectsProfilesEqual so a no-op never re-stamps', () => {
    expect(applier).toContain('uiEffectsProfilesEqual');
    expect(applier).toContain('if (uiEffectsProfilesEqual(this.last, profile)) return;');
  });

  it('debounces the effectsQuality apply at 180ms', () => {
    expect(applier).toContain('EFFECTS_QUALITY_DEBOUNCE_MS = 180');
  });

  it('stamps data-fx-level from the tier (internal, no t()) + loops the --fx-* tokens onto :root', () => {
    expect(applier).toContain('root.dataset.fxLevel = profile.tier;');
    expect(applier).toContain('root.style.setProperty(name, tokens[name])');
    expect(applier).not.toMatch(/\bt\(['"]/); // no i18n call: data-fx-level + --fx-* are internal
  });
});

describe('main.ts - boot + reduce-motion single source + the three setting dispatches', () => {
  it('constructs the applier and stamps the initial profile at boot', () => {
    expect(main).toContain('new UiEffectsApplier({');
    expect(main).toContain('uiEffectsApplier.applyNow();');
  });

  it('feeds reduce-motion from a single source: OS matchMedia OR the in-game setting', () => {
    expect(main).toContain("reduceMotion: osReducedMotion || settings.get('reduceMotion')");
  });

  it('keeps body.reduce-motion as the CSS hook and also re-publishes the profile (no second flag)', () => {
    expect(main).toContain("document.body.classList.toggle('reduce-motion'");
  });

  it('routes graphicsPreset immediately and the effectsQuality slider debounced', () => {
    expect(main).toContain("case 'graphicsPreset':");
    expect(main).toContain("case 'effectsQuality':");
    expect(main).toContain('uiEffectsApplier.applyDebounced();');
  });
});
