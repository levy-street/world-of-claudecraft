// The repeatable-marker style contract across surfaces (phase 23): the four
// surfaces render ONE marker over two channels that must each agree
// everywhere they are stated. The GLYPH channel (nameplate marks, gossip
// '!', both canvas painters) carries the rare-blue anchor and the 0.55
// cooldown dim; the TEXT channel (the map tooltip's tag prose) lifts to an
// accessible blue at full opacity, because #0070dd reads 4.07:1 over the
// panel gradient (under the 4.5:1 AA floor for 13.5px text) and a 0.55 dim
// about 2:1. Deleting any of these blocks previously reddened nothing
// (css_corpus is section-level), which is exactly how a surface silently
// falls out of agreement.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUALITY_COLOR } from '../src/ui/icons';
import {
  MIN_TEXT_CONTRAST,
  PRESET_ORDER,
  resolveTheme,
  THEME_PRESETS,
  themeCssVars,
} from '../src/ui/theme';

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
// The CSS goes through the SAME comment strip as the painters: a pin a
// commented-out rule satisfies is not a pin (the mutation round proved the
// raw read green with the live .np-marker.repeat block commented out).
const tokensCss = stripComments(
  readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8'),
);
const hudCss = stripComments(
  readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8'),
);
const minimapPainter = stripComments(
  readFileSync(new URL('../src/ui/minimap_painter.ts', import.meta.url), 'utf8'),
);
const mapPainter = stripComments(
  readFileSync(new URL('../src/ui/map_window_painter.ts', import.meta.url), 'utf8'),
);
const baseCss = stripComments(
  readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8'),
);
const nameplateCanvas = stripComments(
  readFileSync(new URL('../src/render/nameplate_canvas.ts', import.meta.url), 'utf8'),
);

// The one blue and the one dim, stated here as the cross-surface contract.
// The blue is DERIVED from its stated design anchor (the rare item quality
// color), so a rare-quality retune reddens every marker pin instead of
// silently detaching the markers from the classic anchor; the literal beside
// it pins the anchor itself against a drive-by edit.
const RARE_BLUE = QUALITY_COLOR.rare;
const COOLDOWN_ALPHA = '0.55';
// The TEXT channel's accessible blue (the same 211-degree hue lifted for
// prose): the tokens.css DEFAULT behind --color-quest-tag-text, which the
// theme system re-emits per preset (the theme arm below holds every preset
// to the same floor). The panel-bg gradient stops are pinned against the
// real declaration below so these literals cannot drift.
const TAG_TEXT_BLUE = '#3d9bff';
const PANEL_STOPS = ['#15151f', '#0b0b12', '#08080d'] as const;

// WCAG 2.2 relative-luminance contrast, so the accessible-blue pin is a
// working floor rather than a frozen hex: the hue may move as long as the
// tag text keeps AA against both panel stops.
const srgbLuminance = (hex: string): number => {
  const chan = (i: number) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5);
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [srgbLuminance(a), srgbLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('quest marker style agreement across surfaces', () => {
  it('anchors on the real rare-item blue', () => {
    expect(RARE_BLUE).toBe('#0070dd');
  });

  it('declares both repeat tokens at the rare-item blue', () => {
    expect(tokensCss).toMatch(new RegExp(`--color-map-npc-quest-repeat:\\s*${RARE_BLUE};`));
    expect(tokensCss).toMatch(new RegExp(`--color-minimap-npc-quest-repeat:\\s*${RARE_BLUE};`));
  });

  it('styles the nameplate repeat and cooldown marks in the same blue', () => {
    expect(hudCss).toMatch(
      new RegExp(`\\.np-marker\\.repeat\\s*\\{[^}]*color:\\s*${RARE_BLUE}`, 's'),
    );
    // The glow halo is the ninth statement of the blue (RARE_BLUE + alpha).
    expect(hudCss).toMatch(new RegExp(`\\.np-marker\\.repeat\\s*\\{[^}]*${RARE_BLUE}88`, 's'));
    expect(hudCss).toMatch(
      new RegExp(`\\.np-marker\\.cooldown\\s*\\{[^}]*color:\\s*${RARE_BLUE}`, 's'),
    );
    expect(hudCss).toMatch(
      new RegExp(
        `\\.np-marker\\.cooldown\\s*\\{[^}]*opacity:\\s*${COOLDOWN_ALPHA.replace('.', '\\.')}`,
        's',
      ),
    );
  });

  it('paints the batched canvas nameplate marks in the same blue and dim', () => {
    // The batched canvas surface replaced the DOM plates, so the LIVE
    // nameplate glyph channel is nameplate_canvas.ts, pinned here the same
    // way as the two src/ui canvas painters below; the .np-marker CSS blocks
    // above are the legacy DOM surface, kept until their cleanup lands.
    expect(nameplateCanvas).toContain(`'${RARE_BLUE}'`);
    expect(nameplateCanvas).toContain(`* ${COOLDOWN_ALPHA}`);
  });

  it('keeps the gossip glyph on the anchor blue and lifts BOTH tooltip tags to the tag token', () => {
    // Glyph channel: the gossip row's '!' span stays on the anchor.
    expect(hudCss).toMatch(new RegExp(`\\.quest-repeat\\s*\\{[^}]*color:\\s*${RARE_BLUE}`, 's'));
    // Text channel: one grouped rule routes BOTH tooltip tag spans through
    // the theme-repaired token (with the tokens.css default as fallback).
    // Both arms are #tooltip-scoped deliberately: a future reuse of a tag
    // class outside the tooltip must make its own channel decision instead
    // of silently inheriting the text lift. The #tooltip .quest-repeat arm
    // is a cascade override of the glyph rule above; both sides are pinned
    // so the suite states the full cascade story.
    expect(hudCss).toMatch(
      new RegExp(
        '#tooltip \\.quest-cooldown,\\s*#tooltip \\.quest-repeat\\s*\\{[^}]*' +
          'color:\\s*var\\(--color-quest-tag-text, #3d9bff\\)',
        's',
      ),
    );
    // The tokens.css default IS the pinned accessible blue.
    expect(tokensCss).toMatch(new RegExp(`--color-quest-tag-text:\\s*${TAG_TEXT_BLUE};`));
    // The old 0.55 dim on the cooldown TAG must not come back: dimmed prose
    // read about 2:1 over the panel. The dim belongs to the glyph channel.
    expect(hudCss).not.toMatch(/\.quest-cooldown[^}]*opacity/s);
  });

  it('keeps the tag text at WCAG AA and the glyphs above the component floor', () => {
    // The stops are pinned against the real --panel-bg declaration (all
    // three, in order, with the f2 alpha suffix) so the literals here
    // cannot silently drift from the sheet.
    expect(tokensCss).toMatch(
      new RegExp(
        `--panel-bg:[^;]*${PANEL_STOPS[0]}f2[^;]*${PANEL_STOPS[1]}f2[^;]*${PANEL_STOPS[2]}f2`,
      ),
    );
    for (const stop of PANEL_STOPS) {
      // 13.5px tooltip prose needs 4.5:1 (WCAG 2.2 AA, normal text).
      expect(contrast(TAG_TEXT_BLUE, stop)).toBeGreaterThanOrEqual(4.5);
      // The glyph channel is a non-text component: 3:1 floor.
      expect(contrast(RARE_BLUE, stop)).toBeGreaterThanOrEqual(3);
    }
  });

  it('holds EVERY theme preset to the text tier for the tag token', () => {
    // --color-quest-tag-text is re-emitted per preset through ensureReadable
    // (the --color-gold precedent): the raw default reads about 2.2:1 on the
    // light Parchment panel, so the repair is what makes the AA claim true
    // beyond the default palette. Held against BOTH the preset panel and the
    // emitted gradient edge.
    for (const preset of PRESET_ORDER) {
      const vars = themeCssVars(resolveTheme({ preset, custom: {} }));
      const tag = vars['--color-quest-tag-text'];
      expect(tag, preset).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(tag, THEME_PRESETS[preset].panel), preset).toBeGreaterThanOrEqual(
        MIN_TEXT_CONTRAST,
      );
      expect(contrast(tag, vars['--panel-edge']), preset).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it('carries the repeat-vs-gold distinction through forced-colors on the nameplate', () => {
    // The forced palette strips color, so the DOM nameplate (the one surface
    // with neither canvas pixels nor a text tag) needs a redundant non-color
    // cue: underline for repeat, dotted for cooldown (the #tf-name.hostile
    // precedent). The block is extracted by BALANCED BRACES, not by slicing
    // to the next media query: a rule parked between the block's closing
    // brace and the print reset would satisfy a slice-based pin while
    // applying in normal mode.
    const marker = '@media (forced-colors: active)';
    const start = baseCss.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const open = baseCss.indexOf('{', start);
    let depth = 1;
    let end = open + 1;
    while (end < baseCss.length && depth > 0) {
      if (baseCss[end] === '{') depth++;
      else if (baseCss[end] === '}') depth--;
      end++;
    }
    const forcedBlock = baseCss.slice(start, end);
    expect(forcedBlock).toMatch(/\.np-marker\.repeat\s*\{[^}]*text-decoration:\s*underline;/s);
    expect(forcedBlock).toMatch(
      /\.np-marker\.cooldown\s*\{[^}]*text-decoration:\s*underline dotted;/s,
    );
    // The cues exist ONLY there: normal mode carries no np-marker
    // text-decoration in either sheet.
    const outsideBlock = baseCss.slice(0, start) + baseCss.slice(end);
    expect(outsideBlock).not.toMatch(/\.np-marker[^}]*text-decoration/s);
    expect(hudCss).not.toMatch(/\.np-marker[^}]*text-decoration/s);
  });

  it('dims both canvas painters at the CSS alpha', () => {
    // Comments are stripped above, so these match the live assignments, not
    // prose; the painters share the CSS value so all four surfaces dim
    // identically (each painter test pins the blit-time behavior itself).
    expect(minimapPainter).toContain(`NPC_GLYPH_COOLDOWN_ALPHA = ${COOLDOWN_ALPHA}`);
    expect(mapPainter).toContain(`NPC_GLYPH_COOLDOWN_ALPHA = ${COOLDOWN_ALPHA}`);
  });
});
