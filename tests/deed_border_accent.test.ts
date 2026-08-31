// The Book of Deeds BORDER channel: the id -> slug -> palette resolution
// (deed_border_view.ts) and the two surfaces that consume it (the overhead
// nameplate's canvas shapes and the unit-frame portrait ring).
//
// The load-bearing claims here:
//   - one palette table is the single source of truth: the four content slugs
//     each resolve, and neither hud.css nor any consumer duplicates a color;
//   - every no-accent case answers '' / null rather than guessing (a persisted
//     id whose content record was removed, a title-reward deed, an unknown slug);
//   - the accent is IDENTITY, so it is graphics-preset-identical: nothing on the
//     path reads the effects profile, the tier knobs, or the FPS governor, and
//     the nameplate resolves it UNCONDITIONALLY in the player branch, on the same
//     cadenced pass as the name and title.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { charSheetRefreshSig } from '../src/ui/char_sheet_sig_core';
import {
  BORDER_ACCENT_SLUGS,
  type BorderMotifKind,
  borderAccent,
  borderMotifPath,
  borderMotifPrimitives,
  DEED_HERALDRY_ATTR,
  DEED_HERALDRY_WELL_FILL,
  deedBorderSlug,
  deedHeraldryMotifSvg,
  deedTargetBorderSlug,
} from '../src/ui/deed_border_view';
import { contrastRatio, mixHex, PRESET_ORDER, THEME_PRESETS, themeCssVars } from '../src/ui/theme';
import {
  PORTRAIT_BORDER_ATTR,
  PORTRAIT_BORDER_EDGE_PROP,
  PORTRAIT_BORDER_FRAME_PROP,
  PORTRAIT_BORDER_GLOW_PROP,
} from '../src/ui/unit_frame_painter';

// Comments stripped before scanning (the architecture-test rule): prose that
// NAMES the invariant must never satisfy or trip the scan that enforces it.
const read = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const HUD_CSS = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
// The portrait ring rule, captured once: the palette describe reads it for the
// no-duplicate-color claim and the fairness describe for the tier-coupling one.
const RING_RULE = HUD_CSS.match(
  /\.portrait-wrap\[data-border\]:not\(\[data-border=""\]\)::after \{[^}]*\}/,
)?.[0];

// Every module the accent travels through: the table, the two nameplate files,
// and the two unit-frame files. Read by the fairness scan and the
// single-source color scan below.
const ACCENT_PATH = [
  'src/ui/deed_border_view.ts',
  'src/render/nameplate_canvas.ts',
  'src/render/nameplate_heraldry_core.ts',
  'src/render/nameplate_painter.ts',
  'src/ui/unit_frame.ts',
  'src/ui/unit_frame_painter.ts',
  // Phase 20: the inspect card's header accent, the third surface of the same
  // identity. It resolves the slug and palette in the pure core and hands the
  // painter resolved values, so BOTH files join the single-source scan.
  'src/ui/inspect_view.ts',
  'src/ui/inspect_window.ts',
  'src/ui/deeds_window.ts',
];

describe('deedBorderSlug: deed id -> border slug', () => {
  it('resolves each border deed in the catalog to its exact slug', () => {
    expect(deedBorderSlug('prog_prestige_10')).toBe('prestige_laurels');
    expect(deedBorderSlug('dgn_deepward')).toBe('deepward');
    expect(deedBorderSlug('col_discovery_250')).toBe('curators_gilt');
    expect(deedBorderSlug('col_reliquary_rank_5')).toBe('reliquary_gilt');
  });

  it('answers empty for every no-border case', () => {
    expect(deedBorderSlug(null)).toBe('');
    expect(deedBorderSlug(undefined)).toBe('');
    expect(deedBorderSlug('')).toBe('');
    // A save outliving its content record: a persisted id the catalog dropped.
    expect(deedBorderSlug('deed_that_no_longer_exists')).toBe('');
    // A prototype key must not resolve through the plain-object DEEDS table.
    expect(deedBorderSlug('__proto__')).toBe('');
    expect(deedBorderSlug('constructor')).toBe('');
  });

  it('answers empty for a TITLE-reward deed and a reward-less deed', () => {
    // The two rewards share one field; reading the slug off a title deed would
    // hand back undefined and paint an accent nobody earned.
    expect(DEEDS.prog_veteran?.reward?.kind).toBe('title');
    expect(deedBorderSlug('prog_veteran')).toBe('');
    expect(DEEDS.prog_first_steps?.reward).toBeUndefined();
    expect(deedBorderSlug('prog_first_steps')).toBe('');
  });

  it('E48: only a player target may resolve a target-frame heraldry slug', () => {
    expect(deedTargetBorderSlug('player', 'dgn_deepward')).toBe('deepward');
    for (const kind of ['mob', 'npc', 'object', 'pet']) {
      expect(deedTargetBorderSlug(kind, 'dgn_deepward'), kind).toBe('');
    }
  });
});

describe('borderAccent: slug -> palette', () => {
  it('covers every registered slug with three distinct colors', () => {
    for (const slug of BORDER_ACCENT_SLUGS) {
      const accent = borderAccent(slug);
      expect(accent, `no palette for ${slug}`).not.toBeNull();
      const colors = [accent?.frame, accent?.edge, accent?.glow];
      for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/);
      expect(new Set(colors).size, `${slug} must not reuse one color`).toBe(3);
    }
  });

  it('gives every slug a frame line no other slug uses (the four read apart)', () => {
    const frames = BORDER_ACCENT_SLUGS.map((slug) => borderAccent(slug)?.frame);
    expect(new Set(frames).size).toBe(BORDER_ACCENT_SLUGS.length);
  });

  it('gives every slug a distinct motif kind', () => {
    const kinds = BORDER_ACCENT_SLUGS.map((slug) => borderAccent(slug)?.motif);
    expect(kinds).toEqual(['catalogue', 'ward', 'laurel', 'vault']);
    expect(new Set(kinds).size).toBe(BORDER_ACCENT_SLUGS.length);
  });

  it('answers null for no border and for an unknown slug', () => {
    expect(borderAccent('')).toBeNull();
    expect(borderAccent('slug_with_no_palette')).toBeNull();
    expect(borderAccent('__proto__')).toBeNull();
  });

  it('returns the stored record itself, so a per-frame caller allocates nothing', () => {
    expect(borderAccent('deepward')).toBe(borderAccent('deepward'));
  });

  it('freezes each palette record so a stray runtime write cannot repaint every plate', () => {
    // Both surfaces hand the SAME record straight to a canvas strokeStyle and to
    // CSS custom properties; Readonly is compile-time only, so the runtime freeze
    // is what makes an accidental `accent.frame = ...` throw in strict mode
    // instead of silently repainting every plate and ring of that slug.
    for (const slug of BORDER_ACCENT_SLUGS) {
      expect(Object.isFrozen(borderAccent(slug)), `${slug} record must be frozen`).toBe(true);
    }
  });

  it('pins the registered slug set, sorted', () => {
    expect(BORDER_ACCENT_SLUGS).toEqual([
      'curators_gilt',
      'deepward',
      'prestige_laurels',
      'reliquary_gilt',
    ]);
  });

  it('covers the live content catalog exactly (a new border deed owes a palette)', () => {
    const contentSlugs = Object.values(DEEDS)
      .map((def) => (def.reward?.kind === 'border' ? def.reward.slug : ''))
      .filter((slug) => slug !== '')
      .sort();
    expect(contentSlugs).toEqual([...BORDER_ACCENT_SLUGS]);
  });
});

describe('E40: four normalized seal identities have one static primitive owner', () => {
  const kinds: readonly BorderMotifKind[] = ['catalogue', 'vault', 'ward', 'laurel'];
  const fingerprint = (kind: BorderMotifKind): string =>
    borderMotifPrimitives(kind)
      .map((prim) => `${prim.x1},${prim.y1},${prim.x2},${prim.y2}`)
      .join('|');

  it('returns one deeply frozen primitive set with stable identities for each kind', () => {
    for (const kind of kinds) {
      const primitives = borderMotifPrimitives(kind);
      expect(primitives.length, `${kind} must have a readable seal silhouette`).toBeGreaterThan(0);
      expect(Object.isFrozen(primitives), `${kind} primitive array must be frozen`).toBe(true);
      expect(borderMotifPrimitives(kind), `${kind} must reuse its static primitive array`).toBe(
        primitives,
      );
      for (let i = 0; i < primitives.length; i++) {
        const primitive = primitives[i];
        expect(Object.isFrozen(primitive), `${kind}[${i}] must be frozen`).toBe(true);
        expect(borderMotifPrimitives(kind)[i], `${kind}[${i}] identity must stay stable`).toBe(
          primitive,
        );
        for (const coordinate of [primitive.x1, primitive.y1, primitive.x2, primitive.y2]) {
          expect(Number.isFinite(coordinate), `${kind}[${i}] coordinate must be finite`).toBe(true);
          expect(
            coordinate,
            `${kind}[${i}] must stay in normalized seal space`,
          ).toBeGreaterThanOrEqual(-1);
          expect(
            coordinate,
            `${kind}[${i}] must stay in normalized seal space`,
          ).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('gives all four kinds distinct nonempty coordinate fingerprints without using color', () => {
    const fingerprints = kinds.map(fingerprint);
    for (const value of fingerprints) expect(value).not.toBe('');
    expect(new Set(fingerprints).size).toBe(kinds.length);

    const paletteKinds = BORDER_ACCENT_SLUGS.map((slug) => borderAccent(slug)?.motif).sort();
    expect(paletteKinds).toEqual([...kinds].sort());
  });
});

describe('E55: every DOM seal derives from the canonical normalized primitives', () => {
  const kinds: readonly BorderMotifKind[] = ['catalogue', 'vault', 'ward', 'laurel'];

  it('prebuilds one stable SVG path per motif without a second coordinate table', () => {
    for (const kind of kinds) {
      const path = borderMotifPath(kind);
      expect(path).toMatch(/^M/);
      expect(path).toContain('L');
      expect(borderMotifPath(kind)).toBe(path);
      const svg = deedHeraldryMotifSvg(kind, 'deed-heraldry-seal-art');
      expect(svg).toContain('class="deed-heraldry-seal-art"');
      expect(svg).toContain(`d="${path}"`);
      expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
    const source = read('src/ui/deed_border_view.ts');
    const primitiveTable = source.slice(
      source.indexOf('const BORDER_MOTIF_PRIMITIVES'),
      source.indexOf('export function borderMotifPrimitives'),
    );
    expect(primitiveTable.match(/x1:/g)).toHaveLength(
      kinds.flatMap((kind) => borderMotifPrimitives(kind)).length,
    );
    expect(source).not.toContain('M12');
  });

  it('stores the derived path on the same frozen per-slug record as palette and motif', () => {
    for (const slug of BORDER_ACCENT_SLUGS) {
      const accent = borderAccent(slug);
      expect(accent?.motifPath).toBe(borderMotifPath(accent?.motif as BorderMotifKind));
    }
  });
});

describe('the portrait ring consumes the palette table, and holds no colors of its own', () => {
  const rule = RING_RULE;

  it('gates the ring on a NON-EMPTY value of the attribute the painter writes', () => {
    // A bare [data-border] would match the cleared '' the painter writes for a
    // borderless unit, ringing every portrait in transparent chrome.
    expect(PORTRAIT_BORDER_ATTR).toBe('data-border');
    expect(rule, 'the portrait ring rule is missing from hud.css').toBeTruthy();
  });

  it('reads all three custom properties the painter writes', () => {
    for (const prop of [
      PORTRAIT_BORDER_FRAME_PROP,
      PORTRAIT_BORDER_EDGE_PROP,
      PORTRAIT_BORDER_GLOW_PROP,
    ]) {
      expect(rule, `the ring must consume ${prop}`).toContain(`var(${prop},`);
    }
  });

  it('centers the ring on the portrait DISC, not on the wrap around it', () => {
    // Derivation, pinned with the two sizes it comes from: the 60x60 .portrait
    // sits at the top-left of the 64x64 .portrait-wrap, so its center is
    // (30,30) while the wrap's is (32,32). A uniform inset rings the WRAP and
    // lands visibly off-center; this asymmetric one keeps the same 72px ring
    // concentric with the disc. Resizing either box must re-derive it, which
    // is why both sizes are pinned here beside the inset.
    expect(rule).toContain('inset: -6px -2px -2px -6px;');
    expect(HUD_CSS).toMatch(
      /\n {2}\.portrait-wrap \{\s*position: relative;\s*width: 64px;\s*height: 64px;/,
    );
    expect(HUD_CSS).toMatch(/\n {2}\.portrait \{\s*width: 60px;\s*height: 60px;/);
  });

  it('sits under the level chip and the combat flash (identity never covers a value)', () => {
    expect(rule).toContain('z-index: 2;');
    expect(rule).toContain('pointer-events: none;');
    // The ring geometrically overlaps the level chip (inset -6px left, -2px
    // bottom vs the chip at bottom -3px / left -3px), and the chip carries the
    // unit LEVEL, which IS actionable. Pin the two siblings' z-index so deleting
    // either would red this test rather than silently letting a cosmetic ring
    // cover the level number. The bare (unprefixed) rules are the base-frame ones.
    expect(HUD_CSS, 'the level chip must sit above the ring').toMatch(
      /\n {2}\.level-chip \{[^}]*z-index: 3;/,
    );
    expect(HUD_CSS, 'the combat flash must sit above the ring').toMatch(
      /\n {2}\.combat-flash \{[^}]*z-index: 4;/,
    );
  });

  it('pins the forced-palette mapping the world Deed Heraldry already had', () => {
    // Recorded at Phase 19 QA and closed in Phase 20. The three accent custom
    // properties are never missing (paintPortraitBorder writes them together
    // with the data-border slug the rule gates on), so the `transparent`
    // fallbacks cannot engage; what forced-colors does is replace the computed
    // colors with the system palette. The arm is worth pinning for the CHOICE of
    // replacement, three things: the same system pair the world heraldry
    // (nameplate_canvas.ts drawDeedHeraldry) already restated, the outline
    // remapped so the edge contour does not flatten onto the frame line, and the
    // decorative bloom dropped explicitly. The two surfaces must agree on WHICH
    // system colors, or one identity reads two ways under high contrast.
    const forced = HUD_CSS.match(
      /@media \(forced-colors: active\) \{\s*\.portrait-wrap\[data-border\]:not\(\[data-border=""\]\)::after \{([^}]*)\}/,
    )?.[1];
    expect(forced, 'the portrait ring has no forced-colors arm in hud.css').toBeTruthy();
    // Both CSS contours stay visible in the system foreground color. The world
    // canvas keeps its own Canvas edge because it paints a filled ribbon well.
    expect(forced).toContain('border-color: CanvasText;');
    expect(forced).toContain('outline-color: CanvasText;');
    // The bloom is stripped by forced-colors anyway; dropping it explicitly
    // keeps the rule honest rather than leaving a dead declaration that reads
    // load-bearing.
    expect(forced).toContain('box-shadow: none;');

    // The canvas half of the family, read from its own source so the two cannot
    // drift: same two system colors, same roles.
    const canvas = read('src/render/nameplate_canvas.ts');
    const drawStart = canvas.indexOf('private drawDeedHeraldry(');
    const healthStart = canvas.indexOf('private drawHealth(', drawStart);
    expect(drawStart, 'drawDeedHeraldry definition missing').toBeGreaterThan(-1);
    expect(
      healthStart,
      'drawDeedHeraldry source window has no drawHealth boundary',
    ).toBeGreaterThan(drawStart);
    const body = canvas.slice(drawStart, healthStart);
    expect(body).toContain("forcedColors ? 'CanvasText' : accent.frame");
    expect(body).toContain("forcedColors ? 'Canvas' : accent.edge");
    expect(body).toContain("forcedColors ? 'Canvas' : NAMEPLATE_HERALDRY_WELL_FILL");
    expect(body).toContain("forcedColors ? 'Canvas' : accent.glow");
  });

  it('gives the inspect banner accent the same forced-colors arm', () => {
    // The third surface of the identity joins the family in the same change,
    // rather than inheriting the gap the ring just closed.
    const shell = read('src/styles/shell.css');
    const forced = shell.match(
      /@media \(forced-colors: active\) \{\s*\.inspect-heraldry-face\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
    )?.[1];
    expect(forced, 'the inspect header accent has no forced-colors arm').toBeTruthy();
    expect(forced).toContain('border-color: CanvasText;');
    expect(forced).toContain('outline-color: CanvasText;');
    expect(forced).toContain('box-shadow: none;');
    expect(forced).toContain('background-color: CanvasText;');
    const forcedStart = shell.indexOf(
      '@media (forced-colors: active)',
      shell.indexOf('.inspect-heraldry-deed'),
    );
    const forcedFamily = shell.slice(
      forcedStart,
      shell.indexOf('\n  .inspect-title {', forcedStart),
    );
    const forcedSeal = forcedFamily.match(
      /\n {4}\.inspect-heraldry-banner \.deed-heraldry-seal \{([^}]*)\}/,
    )?.[1];
    const forcedPattern = forcedFamily.match(
      /\n {4}\.inspect-heraldry-face \.deed-heraldry-pattern \{([^}]*)\}/,
    )?.[1];
    const forcedCollar = forcedFamily.match(
      /\n {4}\.inspect-heraldry-banner::before \{([^}]*)\}/,
    )?.[1];
    const forcedDeed = forcedFamily.match(/\n {4}\.inspect-heraldry-deed \{([^}]*)\}/)?.[1];
    const forcedRail = forcedFamily.match(/\n {4}\.inspect-honor-rail::before \{([^}]*)\}/)?.[1];
    const forcedHonor = forcedFamily.match(
      /\n {4}\.inspect-honor-rail \.inspect-holder \{([^}]*)\}/,
    )?.[1];
    expect(forcedSeal, 'the inspect seal has no forced-colors arm').toContain(
      'background-color: Canvas;',
    );
    expect(forcedSeal).toContain('border-color: CanvasText;');
    expect(forcedSeal).toContain('box-shadow: none;');
    expect(forcedPattern, 'the inspect motif has no forced-colors arm').toContain(
      'stroke: CanvasText;',
    );
    expect(forcedCollar, 'the inspect medallion collar has no forced-colors arm').toContain(
      'background: Canvas;',
    );
    expect(forcedCollar).toContain('border-color: CanvasText;');
    expect(forcedDeed, 'the inspect deed tab has no forced-colors arm').toContain(
      'color: CanvasText;',
    );
    expect(forcedDeed).toContain('background-color: CanvasText;');
    expect(forcedRail, 'the inspect honor rail has no forced-colors arm').toContain(
      'background: CanvasText;',
    );
    expect(forcedHonor, 'the inspect honor rail has no forced-colors arm').toContain(
      'background: Canvas;',
    );
    expect(forcedHonor).toContain('border-color: CanvasText;');
    expect(forcedHonor).toContain('box-shadow: none;');
  });

  it('the inspect banner rule gates on a NON-EMPTY slug and holds no color', () => {
    const shell = read('src/styles/shell.css');
    const rule = shell.match(
      /\n {2}\.inspect-heraldry-face\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
    )?.[1];
    expect(rule, 'the inspect header accent rule is missing from shell.css').toBeTruthy();
    // Every color arrives through the painter's custom properties, and the
    // property NAMES are the ring's, so one convention spans both surfaces.
    for (const prop of [
      PORTRAIT_BORDER_FRAME_PROP,
      PORTRAIT_BORDER_EDGE_PROP,
      PORTRAIT_BORDER_GLOW_PROP,
    ]) {
      expect(rule, `the inspect accent must consume ${prop}`).toContain(`var(${prop},`);
    }
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rule).not.toMatch(/\brgba?\s*\(/);
    // Identity, so only the decorative bloom may scale with the effects tier.
    const tiered = rule?.split(';').filter((d) => d.includes('var(--fx-shadow')) ?? [];
    expect(tiered).toHaveLength(1);
    expect(tiered[0]).toContain('box-shadow');
  });

  it('the inspect painter uses the one canonical attribute and style builder', () => {
    const painter = read('src/ui/inspect_window.ts');
    expect(PORTRAIT_BORDER_ATTR).toBe(DEED_HERALDRY_ATTR);
    expect(painter).toMatch(/\$\{DEED_HERALDRY_ATTR\}="\$\{esc\(border\.slug\)\}"/);
    expect(painter).toMatch(/\$\{DEED_HERALDRY_MOTIF_ATTR\}="\$\{border\.motif\}"/);
    expect(painter).toContain('esc(deedHeraldryStyle(border))');
  });

  it('duplicates no slug and no palette color into CSS (one source of truth)', () => {
    // The ring rule carries no color literal at all (every color arrives through
    // the painter's custom properties), and no slug is styled anywhere in the
    // sheet, so a fifth border deed needs a palette row and nothing else.
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rule).not.toMatch(/\brgba?\s*\(/);
    for (const slug of BORDER_ACCENT_SLUGS) {
      expect(HUD_CSS, `${slug} must not be styled per-slug in CSS`).not.toContain(slug);
      const accent = borderAccent(slug);
      for (const color of [accent?.frame, accent?.edge, accent?.glow]) {
        expect(rule, `${color} belongs to the palette table only`).not.toContain(String(color));
      }
    }
  });
});

// The single-source claim, widened past the ring rule: no consumer on the
// accent path and neither HUD stylesheet may carry an accent color of its own,
// in any spelling. The scan is deliberately bounded to the files that actually
// paint the accent plus the two sheets; a color copied anywhere else would not
// reach a border and is not what this guards.
describe('the palette table is the only home of the accent colors', () => {
  // Every live HUD sheet, not just the two the ring rule lives in: the mobile
  // overrides and the token sheet are where a "matching" accent literal would
  // most plausibly be pasted next.
  const SCANNED = [
    ...ACCENT_PATH,
    'src/styles/hud.css',
    'src/styles/components.css',
    'src/styles/hud.mobile.css',
    'src/styles/tokens.css',
    // Phase 20: the sheet the inspect card's accent rule lives in, now that a
    // third surface consumes the palette.
    'src/styles/shell.css',
  ];
  const TABLE = 'src/ui/deed_border_view.ts';

  // Hex (with or without an alpha pair) and the rgb()/rgba() spelling of the
  // same color, so a copy cannot hide behind a different notation.
  const COLOR_LITERAL =
    /#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?\b|rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/g;
  const canonical = (m: RegExpMatchArray): string =>
    m[1] !== undefined
      ? `#${m[1].toLowerCase()}`
      : `#${[m[2], m[3], m[4]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;

  // No allowlist, which makes the claim stronger than "nobody copied an
  // accent": a palette value must not collide with ANY color already on the
  // scanned path. A second occurrence is therefore one of two faults, and the
  // failure message names both, because the fix differs: a consumer
  // hardcoding an accent instead of reading the table, or a new palette value
  // chosen to equal a pre-existing unrelated color (the classic elite/quest
  // gold #f2c84b is exactly that trap, which is why reliquary_gilt sits a
  // step off it).
  it('holds each accent color once in the table and nowhere else on the path', () => {
    const palette = BORDER_ACCENT_SLUGS.flatMap((slug) => {
      const accent = borderAccent(slug);
      return [accent?.frame, accent?.edge, accent?.glow].map((color) => String(color));
    });
    expect(palette.length).toBe(BORDER_ACCENT_SLUGS.length * 3);
    const counts = new Map<string, Record<string, number>>();
    for (const rel of SCANNED) {
      for (const m of read(rel).matchAll(COLOR_LITERAL)) {
        const color = canonical(m);
        if (!palette.includes(color)) continue;
        const perFile = counts.get(color) ?? {};
        perFile[rel] = (perFile[rel] ?? 0) + 1;
        counts.set(color, perFile);
      }
    }
    for (const color of palette) {
      const perFile = counts.get(color) ?? {};
      const { [TABLE]: inTable, ...elsewhere } = perFile;
      expect(inTable, `${color} must be declared exactly once in ${TABLE}`).toBe(1);
      expect(
        elsewhere,
        `${color} also appears outside the palette table: either a consumer hardcoded the accent instead of reading the table, or this palette value collides with a pre-existing color already on the scanned path (pick a value no scanned file uses)`,
      ).toEqual({});
    }
  });
});

describe('border accent graphics fairness (cosmetic identity, preset-identical)', () => {
  // The two spellings a profile / tier-knob / governor read would arrive
  // through, matching tests/professions_graphics_fairness.test.ts: an import
  // specifier, or the governor's real module and class name.
  const PROFILE_TOKENS = [
    'ui_effects_profile',
    'ui_tier_knobs',
    'render_budget',
    'RenderBudgetGovernor',
    '--fx-shadow',
    'GFX',
    'gfxTier',
    'fxTier',
    'graphicsPreset',
    'data-fx-level',
    '.animate(',
  ];

  it('reads no effects profile, tier knob, or FPS governor anywhere on the path', () => {
    for (const rel of ACCENT_PATH) {
      const source = read(rel);
      for (const token of PROFILE_TOKENS) {
        expect(source.includes(token), `${rel} must not read ${token}`).toBe(false);
      }
    }
  });

  it('E46: the world seal and ribbon source has no raster, shed, filter, or motion path', () => {
    const core = read('src/render/nameplate_heraldry_core.ts');
    const canvas = read('src/render/nameplate_canvas.ts');
    const drawStart = canvas.indexOf('private drawDeedHeraldry(');
    const healthStart = canvas.indexOf('private drawHealth(', drawStart);
    expect(drawStart, 'drawDeedHeraldry definition missing').toBeGreaterThan(-1);
    expect(
      healthStart,
      'drawDeedHeraldry source window has no drawHealth boundary',
    ).toBeGreaterThan(drawStart);
    const source = `${core}\n${canvas.slice(drawStart, healthStart)}`;
    const forbidden: ReadonlyArray<readonly [string, RegExp]> = [
      ['sprite', /\bsprite\b/i],
      ['raster image', /\b(?:raster|drawImage)\b/i],
      [
        'gradient',
        /\b(?:gradient|createLinearGradient|createRadialGradient|createConicGradient)\b/i,
      ],
      ['filter', /\bfilter\b/i],
      [
        'tier or governor',
        /\b(?:gfx|gfxTier|fxTier|graphicsPreset|tier|ui_effects_profile|ui_tier_knobs|render_budget|RenderBudgetGovernor)\b/i,
      ],
      [
        'animation',
        /\b(?:animate|animation|requestAnimationFrame|setInterval|setTimeout|transition|keyframes)\b/i,
      ],
    ];
    for (const [label, pattern] of forbidden) {
      expect(source, `world Deed Heraldry must not add a ${label} path`).not.toMatch(pattern);
    }
  });

  it('resolves the nameplate slug UNCONDITIONALLY in the player branch', () => {
    // Beside the title line, on the same cadenced resolveContent pass: not behind
    // a tier, preset, or distance conditional, so two players standing together
    // on different graphics settings see the same accent.
    const painter = read('src/render/nameplate_painter.ts');
    expect(painter).toContain("state.title = entity.title ? deedTitleText(entity.title) : '';");
    expect(painter).toContain('state.border = deedBorderSlug(entity.border);');
    // And the reset blanks it, so no plate inherits a stale slug.
    expect(painter).toContain("state.border = '';");
  });

  it('keeps the ring identity lines off every tier knob, with only the bloom scaled', () => {
    // The CSS arm of the same fairness claim: the TypeScript scan above cannot
    // see a tier-coupled declaration, so a later edit could multiply the ring
    // itself by --fx-shadow (or a motion scale) and leave this suite green
    // while low-preset players got a thinner or absent identity line.
    expect(RING_RULE, 'the portrait ring rule is missing from hud.css').toBeTruthy();
    const body = String(RING_RULE).slice(
      String(RING_RULE).indexOf('{') + 1,
      String(RING_RULE).lastIndexOf('}'),
    );
    const declarations = body
      .split(';')
      .map((decl) => decl.trim())
      .filter((decl) => decl !== '');
    const property = (decl: string): string => decl.slice(0, decl.indexOf(':')).trim();

    // The two lines that CARRY the identity render at every tier, unscaled.
    const identity = declarations.filter(
      (decl) => property(decl) === 'border' || property(decl) === 'outline',
    );
    expect(identity.length, 'the ring must declare both its border and its outline').toBe(2);
    for (const decl of identity) {
      expect(decl, 'an identity line must not read a tier knob').not.toContain('var(--fx-');
      expect(decl, 'an identity line must not read a motion scale').not.toContain(
        'var(--motion-scale',
      );
    }

    // Exactly one declaration may scale with the effects tier: the decorative
    // outer bloom.
    const tiered = declarations.filter((decl) => decl.includes('var(--fx-shadow'));
    expect(tiered.length, 'only the outer bloom may scale with --fx-shadow').toBe(1);
    expect(property(tiered[0])).toBe('box-shadow');
  });

  it('has no tier-scoped selector that could hide the identity ring at a low preset', () => {
    // RING_RULE captures only the ONE universal rule; the declaration scan above
    // is blind to a LATER override like
    // `:root[data-fx-level="low"] .portrait-wrap::after { display: none }`, which
    // would hide the identity ring on the low preset with every assertion above
    // still green. Scan the three sheets for any data-fx-level selector that also
    // names the ring surface. Selectors carry no { } or ; so this survives
    // @layer / @media nesting.
    for (const rel of [
      'src/styles/hud.css',
      'src/styles/hud.mobile.css',
      'src/styles/tokens.css',
    ]) {
      const css = read(rel);
      for (const selector of css.match(/[^{};]*data-fx-level[^{}]*\{/g) ?? []) {
        expect(
          /portrait-wrap|border-accent|\[data-border/.test(selector),
          `a data-fx-level selector must not target the identity ring: ${selector.trim()}`,
        ).toBe(false);
      }
    }
  });

  it('E56: canvas and social-surface metal stay independent of every theme', () => {
    expect(PRESET_ORDER).toEqual(['classic', 'fancyGold', 'midnight', 'parchment', 'highContrast']);
    expect(THEME_PRESETS.parchment.panel).toBe('#ece0c4');
    const themeSource = read('src/ui/theme.ts');
    expect(themeSource).not.toContain('--border-accent-frame');
    expect(themeSource).not.toContain('--border-accent-edge');
    expect(themeSource).not.toContain('--border-accent-glow');
    const vars = Object.keys(themeCssVars(THEME_PRESETS.parchment));
    expect(vars.some((name) => name.startsWith('--border-accent-'))).toBe(false);
    expect(vars.some((name) => name.startsWith('--deed-heraldry-'))).toBe(false);
    const canvas = read('src/render/nameplate_canvas.ts');
    expect(canvas).not.toContain('themeCssVars');
    expect(canvas).not.toContain('THEME_PRESETS');
    expect(canvas).not.toContain('parchment');
    const inspectRule = read('src/styles/shell.css').match(
      /\n {2}\.inspect-heraldry-face\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
    )?.[1];
    expect(inspectRule, 'inspect banner rule missing').toBeTruthy();
    expect(inspectRule).toContain('var(--border-accent-frame');
    expect(inspectRule).toContain('var(--border-accent-edge');
    expect(inspectRule).toContain('var(--border-accent-glow');
    expect(inspectRule).toContain('var(--deed-heraldry-well');
    expect(inspectRule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const swatch = read('src/styles/components.css').match(
      /\n {2}\.deed-border-swatch \{([^}]*)\}/,
    )?.[1];
    expect(swatch, 'picker swatch rule missing').toBeTruthy();
    expect(swatch).toContain('var(--border-accent-frame');
    expect(swatch).toContain('var(--border-accent-edge');
    expect(swatch).toContain('var(--border-accent-glow');
    expect(swatch).toContain('var(--deed-heraldry-well');
    expect(swatch).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const components = read('src/styles/components.css');
    const heraldryStart = components.indexOf('.deed-heraldry-seal {');
    const forcedComponents = components.slice(
      components.indexOf('@media (forced-colors: active) {', heraldryStart),
      components.indexOf('body.mobile-touch .deed-heraldry-preview {', heraldryStart),
    );
    expect(forcedComponents, 'picker and preview forced-colors arm missing').toBeTruthy();
    expect(forcedComponents).toContain('.deed-heraldry-seal');
    expect(forcedComponents).toContain('.deed-border-swatch');
    expect(forcedComponents).toContain('.deed-heraldry-preview-portrait');
    expect(forcedComponents).toContain('.deed-heraldry-preview[data-border]:not([data-border=""])');
    expect(forcedComponents).toContain('border-color: CanvasText;');
    expect(forcedComponents).toContain('outline-color: CanvasText;');
    expect(forcedComponents).toContain('stroke: CanvasText;');
    expect(forcedComponents).toContain('box-shadow: none;');
    expect(forcedComponents).toMatch(
      /\.deed-heraldry-seal::after \{[^}]*border-color: CanvasText;/,
    );
    const forcedHudStart = HUD_CSS.indexOf(
      '@media (forced-colors: active) {',
      HUD_CSS.indexOf('> .deed-heraldry-seal'),
    );
    const forcedHud = HUD_CSS.slice(
      forcedHudStart,
      HUD_CSS.indexOf('.level-chip {', forcedHudStart),
    );
    expect(forcedHud, 'unit-frame forced-colors arm missing').toBeTruthy();
    expect(forcedHud).toContain('> .deed-heraldry-seal');
    expect(forcedHud).toContain('.uf-name-header[data-border]');
    expect(forcedHud).toContain('.deed-heraldry-pattern');
  });

  it('E56: Parchment keeps all copy on fixed dark heraldry surfaces AA-readable', () => {
    const components = read('src/styles/components.css');
    const shell = read('src/styles/shell.css');
    const option = components.match(/\n {2}\.deed-title-option \{([^}]*)\}/)?.[1];
    const optionHover = components.match(/\n {2}\.deed-title-option:hover \{([^}]*)\}/)?.[1];
    const preview = components.match(
      /\n {2}\.deed-heraldry-preview\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
    )?.[1];
    const previewRibbon = components.match(/\n {2}\.deed-heraldry-preview-ribbon \{([^}]*)\}/)?.[1];
    const previewName = components.match(/\n {2}\.deed-heraldry-preview-name \{([^}]*)\}/)?.[1];
    const previewDeedStart = components.lastIndexOf('\n  .deed-heraldry-preview-deed {');
    const previewDeed = components.slice(
      previewDeedStart,
      components.indexOf('}', previewDeedStart),
    );
    const inspectTitle = shell.match(
      /\n {2}\.inspect-heraldry-banner \.inspect-title \{([^}]*)\}/,
    )?.[1];
    const inspectBanner = shell.match(
      /\n {2}\.inspect-heraldry-face\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
    )?.[1];
    const inspectDeed = shell.match(/\n {2}\.inspect-heraldry-deed \{([^}]*)\}/)?.[1];
    const inspectHonorSub = shell.match(
      /\n {2}\.inspect-honor-rail \.inspect-holder-sub \{([^}]*)\}/,
    )?.[1];
    const inspectHonor = shell.match(/\n {2}\.inspect-holder \{([^}]*)\}/)?.[1];
    expect(option).toContain('color: var(--color-text-overlay);');
    expect(optionHover).toContain('color: var(--color-deed-banner-text);');
    expect(previewRibbon).toContain('color: var(--color-text-overlay);');
    expect(previewName).toContain('color: var(--color-text-overlay);');
    expect(previewDeed).toContain('color: var(--color-text-overlay);');
    expect(inspectTitle).toContain('color: var(--color-text-overlay);');
    expect(inspectDeed).toContain('color: var(--color-text-overlay);');
    expect(inspectHonorSub).toContain('var(--color-text-overlay) 72%');
    expect(inspectHonor).toContain(
      'background: color-mix(in srgb, var(--panel-base) 28%, #08080d);',
    );
    expect(option).toContain('background: linear-gradient(160deg, #17130c, #0c0a07);');
    expect(preview).toContain('var(--deed-heraldry-well, transparent) 74%');
    expect(inspectBanner).toContain('var(--deed-heraldry-well, transparent) 94%');
    expect(inspectBanner).toContain('var(--deed-heraldry-well, transparent) 90%');
    expect(inspectBanner).toContain('var(--border-accent-frame, transparent)');
    expect(inspectBanner).toContain('var(--deed-heraldry-well, transparent) 88%');
    expect(inspectBanner).toContain('var(--border-accent-edge, transparent)');
    expect(inspectDeed).toContain('var(--deed-heraldry-well, transparent) 92%');
    expect(inspectDeed).toContain('var(--border-accent-edge, transparent)');

    const vars = themeCssVars(THEME_PRESETS.parchment);
    const overlayText = vars['--color-text-overlay'];
    const panel = vars['--panel-base'];
    const well = DEED_HERALDRY_WELL_FILL;
    const honorBackground = mixHex(panel, '#08080d', 0.72);
    const honorSub = mixHex(overlayText, honorBackground, 0.28);
    const optionBackgrounds = ['#17130c', '#0c0a07'];
    const translucentHeraldryBackgrounds = [mixHex(well, panel, 0.18), mixHex(well, panel, 0.26)];
    for (const background of [well, ...optionBackgrounds, ...translucentHeraldryBackgrounds]) {
      expect(
        contrastRatio(overlayText, background),
        `Parchment overlay text on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    for (const slug of BORDER_ACCENT_SLUGS) {
      const accent = borderAccent(slug);
      expect(accent, `${slug} accent missing`).not.toBeNull();
      const inspectSurfaces = [
        mixHex(well, String(accent?.frame), 0.1),
        mixHex(well, String(accent?.edge), 0.06),
        mixHex(well, String(accent?.edge), 0.12),
        mixHex(well, String(accent?.edge), 0.08),
      ];
      for (const background of inspectSurfaces) {
        expect(
          contrastRatio(overlayText, background),
          `Parchment ${slug} overlay text on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(
      contrastRatio(honorSub, honorBackground),
      `Parchment honor sub-line ${honorSub} on ${honorBackground}`,
    ).toBeGreaterThanOrEqual(4.5);

    const tokens = read('src/styles/tokens.css');
    const hoverText = tokens.match(/--color-deed-banner-text:\s*(#[0-9a-fA-F]{6});/)?.[1];
    expect(hoverText, 'fixed dark-surface hover token missing').toBeTruthy();
    for (const background of optionBackgrounds) {
      expect(
        contrastRatio(String(hoverText), background),
        `Parchment option hover on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('E49/E50: portraits stay circular, gameplay overlays win, and the hollow clasp is gone', () => {
    expect(RING_RULE, 'the portrait ring rule is missing from hud.css').toBeTruthy();
    expect(RING_RULE).toContain('border-radius: 50%;');
    expect(RING_RULE).toContain('z-index: 2;');
    const clasp = HUD_CSS.match(
      /\.portrait-wrap\[data-border\]:not\(\[data-border=""\]\)::before \{([^}]*)\}/,
    )?.[1];
    expect(clasp, 'the 12 o clock checkbox clasp must be removed').toBeUndefined();
    const seal = HUD_CSS.match(
      /\.portrait-wrap\[data-border\]:not\(\[data-border=""\]\) > \.deed-heraldry-seal \{([^}]*)\}/,
    )?.[1];
    expect(seal, 'portrait/name joint seal rule missing').toBeTruthy();
    expect(seal).toContain('display: grid;');
    expect(seal).toContain('z-index: 3;');
    const targetSeal = HUD_CSS.match(
      /#target-frame > \.portrait-wrap\[data-border\]:not\(\[data-border=""\]\) > \.deed-heraldry-seal \{([^}]*)\}/,
    )?.[1];
    expect(targetSeal, 'target portrait seal mirror rule missing').toBeTruthy();
    expect(targetSeal).toContain('left: -7px;');
    expect(targetSeal).toContain('right: auto;');
    expect(HUD_CSS, 'the level chip must sit above the ring').toMatch(
      /\n {2}\.level-chip \{[^}]*z-index: 3;/,
    );
    expect(HUD_CSS, 'the combat flash must sit above the ring').toMatch(
      /\n {2}\.combat-flash \{[^}]*z-index: 4;/,
    );
    // The existing boss dragon-emblem pseudo-element is gameplay rank chrome,
    // not the removed heraldry clasp, and remains target-only.
    expect(HUD_CSS).toContain('#target-frame.boss > .portrait-wrap::before {');
    expect(HUD_CSS).not.toContain('--cartouche-clasp');
  });

  it('E47/E48: only player and target documents expose the joint seal and header pattern hosts', () => {
    for (const rel of ['index.html', 'play.html']) {
      const html = read(rel);
      for (const prefix of ['pf', 'tf']) {
        expect(html).toContain(`id="${prefix}-name-header"`);
        expect(html).toContain(`id="${prefix}-heraldry-seal-motif"`);
        expect(html).toContain(`id="${prefix}-heraldry-pattern-motif"`);
        const portraitStart = html.indexOf(`id="${prefix}-portrait-wrap"`);
        const barsStart = html.indexOf('<div class="uf-bars">', portraitStart);
        const headerStart = html.indexOf(`id="${prefix}-name-header"`, barsStart);
        const firstBarStart = html.indexOf('<div class="bar', headerStart);
        expect(html.slice(portraitStart, barsStart)).toContain(
          `id="${prefix}-heraldry-seal-motif"`,
        );
        expect(html.slice(headerStart, firstBarStart)).toContain(
          `id="${prefix}-heraldry-pattern-motif"`,
        );
        expect(html.slice(headerStart, firstBarStart)).toContain(`id="${prefix}-name"`);
      }
      for (const prefix of ['petf', 'totf']) {
        expect(html).not.toContain(`${prefix}-heraldry`);
      }
      expect(html.match(/class="deed-heraldry-seal"/g)).toHaveLength(2);
      expect(html.match(/class="deed-heraldry-pattern"/g)).toHaveLength(2);
    }
    const hud = read('src/ui/hud.ts');
    expect(hud).toContain('targetFrame.borderSlug = deedTargetBorderSlug(');
    expect(hud.match(/heraldry:\s*\{/g)).toHaveLength(2);
    expect(hud.slice(hud.indexOf('private readonly totFramePainter'))).not.toContain(
      'totf-heraldry',
    );
  });

  it('E33: Catalogue brass does not collide with Eternal Spoils gold or elite gold', () => {
    const catalogue = borderAccent('curators_gilt');
    const spoils = borderAccent('reliquary_gilt');
    expect(catalogue?.frame).toBe('#c9b17a');
    expect(catalogue?.edge).toBe('#2a2214');
    expect(catalogue?.glow).toBe('#f3ebcf');
    expect(catalogue?.motif).toBe('catalogue');
    expect(spoils?.frame).toBe('#f4ca43');
    const eliteGold = '#f2c84b';
    for (const color of [catalogue?.frame, catalogue?.edge, catalogue?.glow]) {
      expect(color).not.toBe(spoils?.frame);
      expect(color).not.toBe(spoils?.edge);
      expect(color).not.toBe(spoils?.glow);
      expect(color).not.toBe(eliteGold);
    }
  });

  it('E57: social heraldry adds no continuous motion', () => {
    const inspectRule = read('src/styles/shell.css').match(
      /\n {2}\.inspect-heraldry-face\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
    )?.[1];
    const header = HUD_CSS.match(
      /\n {2}\.uf-name-header\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
    )?.[1];
    const components = read('src/styles/components.css');
    const swatch = components.match(/\n {2}\.deed-border-swatch \{([^}]*)\}/)?.[1];
    const preview = components.match(
      /\n {2}\.deed-heraldry-preview\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
    )?.[1];
    for (const [name, body] of [
      ['inspect', inspectRule],
      ['unit header', header],
      ['picker swatch', swatch],
      ['picker preview', preview],
    ] as const) {
      expect(body, `${name} rule missing`).toBeTruthy();
      expect(body, `${name} must not animate`).not.toMatch(/animation|@keyframes|transition/);
    }
    for (const rel of ['src/styles/components.css', 'src/styles/hud.css', 'src/styles/shell.css']) {
      for (const rule of read(rel).matchAll(
        /\.(?:deed-heraldry|deed-border|uf-name-header)[^{]*\{([^}]*)\}/g,
      )) {
        expect(rule[1], `${rel} shared heraldry rule must not animate`).not.toMatch(
          /animation|@keyframes|transition/,
        );
      }
    }
    const core = read('src/render/nameplate_heraldry_core.ts');
    expect(core).not.toMatch(/requestAnimationFrame|setInterval|@keyframes/);
    expect(read('src/ui/deeds_window.ts')).not.toMatch(
      /requestAnimationFrame|setInterval|@keyframes/,
    );
  });

  it('E52/E53/E57: mobile stacks previews without hiding identity, and tiers scale bloom only', () => {
    const mobile = read('src/styles/hud.mobile.css');
    const shell = read('src/styles/shell.css');
    expect(mobile).not.toMatch(
      /(?:deed-heraldry|uf-name-header|portrait-wrap\[data-border)[^}]*display:\s*none/,
    );
    const components = read('src/styles/components.css');
    const mobilePreview = components.match(
      /body\.mobile-touch \.deed-heraldry-preview \{([^}]*)\}/,
    )?.[1];
    expect(mobilePreview, 'mobile preview stack rule missing').toBeTruthy();
    expect(mobilePreview).toContain('grid-template-columns: 1fr;');
    const inspectCard = mobile.match(
      /\n {2}body\.mobile-touch #inspect-window \.inspect-card \{([^}]*)\}/,
    )?.[1];
    expect(inspectCard, 'mobile inspect card composition missing').toBeTruthy();
    expect(inspectCard).toContain('flex-direction: column;');
    expect(inspectCard).toContain('align-items: center;');
    const inspectWidths = mobile.match(
      /\n {2}body\.mobile-touch #inspect-window \.inspect-heraldry-banner,\n {2}body\.mobile-touch #inspect-window \.inspect-standing-row \{([^}]*)\}/,
    )?.[1];
    expect(inspectWidths, 'mobile mantle width group missing').toContain('width: 100%;');
    const mobileInspectStart = mobile.indexOf('body.mobile-touch #inspect-window {');
    const mobileInspectEnd = mobile.indexOf('body.mobile-touch #social-window', mobileInspectStart);
    expect(mobileInspectStart, 'mobile inspect section missing').toBeGreaterThan(-1);
    expect(mobileInspectEnd, 'mobile inspect section end missing').toBeGreaterThan(
      mobileInspectStart,
    );
    const mobileHonorRules = [
      ...mobile.matchAll(/([^{}]*\.inspect-honor-rail[^{}]*)\{([^{}]*)\}/g),
    ];
    expect(mobileHonorRules.length, 'mobile Inspect honor-rail rule missing').toBeGreaterThan(0);
    for (const rule of mobileHonorRules) {
      expect(
        rule[2],
        `tablet Inspect must retain the base 620px honor-rail cap: ${rule[1].trim()}`,
      ).not.toMatch(
        /(?:^|;)\s*(?:display|width|min-width|max-width|inline-size|min-inline-size|max-inline-size|grid(?!-template-columns\b)[a-z-]*)\s*:/,
      );
    }
    const mobileHonorGridDeclarations = mobileHonorRules.flatMap((rule) =>
      rule[2]
        .split(';')
        .map((declaration) => declaration.trim())
        .filter((declaration) => declaration.startsWith('grid-template-columns:')),
    );
    expect(
      mobileHonorGridDeclarations,
      'only the narrow-phone one-column override may replace the capped desktop 2x2 rail',
    ).toEqual(['grid-template-columns: minmax(0, 300px)']);
    const baseHonorRail = shell.match(/\n {2}\.inspect-honor-rail \{([^}]*)\}/)?.[1];
    expect(baseHonorRail, 'base Inspect honor rail rule missing').toContain(
      'width: min(100%, 620px);',
    );
    const narrowInspectAt = mobile.indexOf(
      '@media (max-width: 520px)',
      mobile.indexOf('body.mobile-touch #inspect-window .inspect-model-panel'),
    );
    const narrowInspect = mobile.slice(
      narrowInspectAt,
      mobile.indexOf('body.mobile-touch #social-window', narrowInspectAt),
    );
    expect(narrowInspectAt, 'narrow inspect media query missing').toBeGreaterThan(-1);
    expect(narrowInspect).toContain('padding-left: 38px;');
    expect(narrowInspect).toContain('width: 52px;');
    expect(narrowInspect).toContain('height: 52px;');
    expect(narrowInspect).toContain('padding-right: 52px;');
    expect(narrowInspect).toContain('padding-left: 52px;');
    expect(narrowInspect).toContain('right: 14px;');
    expect(narrowInspect).toContain('width: 38px;');
    expect(narrowInspect).toContain('height: 38px;');
    expect(narrowInspect).toContain('left: calc(50% + 19px);');
    expect(narrowInspect).toContain('width: min(64%, 220px);');
    expect(narrowInspect).toMatch(
      /body\.mobile-touch #inspect-window \.inspect-honor-rail \{[^}]*grid-template-columns: minmax\(0, 300px\);/,
    );
    const honorRail = shell.match(/\n {2}\.inspect-honor-rail::before \{([^}]*)\}/)?.[1];
    expect(honorRail, 'inspect honor rail connector missing').toBeTruthy();
    expect(honorRail).toContain('position: absolute;');
    expect(honorRail).toContain('top: 50%;');
    expect(honorRail).toContain('left: 50%;');
    expect(honorRail).toContain('z-index: 0;');
    expect(honorRail).toContain('width: min(76%, 360px);');
    expect(honorRail).toContain('height: 1px;');
    expect(honorRail).toContain(
      'background: color-mix(in srgb, var(--color-border-showcase) 46%, transparent);',
    );
    expect(honorRail).toContain('transform: translate(-50%, -50%);');

    for (const rel of [
      'src/styles/hud.css',
      'src/styles/hud.mobile.css',
      'src/styles/components.css',
      'src/styles/shell.css',
      'src/styles/tokens.css',
    ]) {
      const css = read(rel);
      for (const selector of css.match(/[^{};]*data-fx-level[^{}]*\{/g) ?? []) {
        expect(
          /deed-heraldry|uf-name-header|portrait-wrap\[data-border|deed-border-swatch/.test(
            selector,
          ),
          `a data-fx-level selector must not target social identity: ${selector.trim()}`,
        ).toBe(false);
      }
    }

    for (const [name, body] of [
      ['shared seal', components.match(/\n {2}\.deed-heraldry-seal \{([^}]*)\}/)?.[1]],
      [
        'portrait ring',
        String(RING_RULE).slice(
          String(RING_RULE).indexOf('{') + 1,
          String(RING_RULE).lastIndexOf('}'),
        ),
      ],
      [
        'unit header',
        HUD_CSS.match(
          /\n {2}\.uf-name-header\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
        )?.[1],
      ],
      [
        'inspect banner',
        read('src/styles/shell.css').match(
          /\n {2}\.inspect-heraldry-face\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
        )?.[1],
      ],
      ['picker swatch', components.match(/\n {2}\.deed-border-swatch \{([^}]*)\}/)?.[1]],
      [
        'picker preview',
        components.match(
          /\n {2}\.deed-heraldry-preview\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
        )?.[1],
      ],
    ] as const) {
      expect(body, `${name} rule missing`).toBeTruthy();
      expect(body?.match(/var\(--fx-shadow/g) ?? []).toHaveLength(1);
      expect(body).toMatch(/box-shadow:[^;]*var\(--fx-shadow/s);
      for (const declaration of body?.split(';') ?? []) {
        if (!declaration.includes('var(--fx-shadow')) continue;
        expect(declaration.trim().startsWith('box-shadow:')).toBe(true);
      }
    }

    const tieredHeraldryDeclarations: string[] = [];
    for (const rel of [
      'src/styles/components.css',
      'src/styles/hud.css',
      'src/styles/hud.mobile.css',
      'src/styles/shell.css',
      'src/styles/tokens.css',
    ]) {
      for (const rule of read(rel).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (
          !/(?:deed-heraldry|deed-border|inspect-heraldry|uf-name-header|portrait-wrap\[data-border|\[\s*data-border\b)/.test(
            rule[1],
          )
        ) {
          continue;
        }
        for (const declaration of rule[2].split(';')) {
          if (!declaration.includes('var(--fx-shadow')) continue;
          tieredHeraldryDeclarations.push(declaration.trim());
          expect(
            declaration.trim(),
            `${rel} may scale only heraldry bloom with --fx-shadow: ${rule[1].trim()}`,
          ).toMatch(/^box-shadow\s*:/);
        }
      }
    }
    expect(
      tieredHeraldryDeclarations,
      'the six intended heraldry blooms stay tier-scaled',
    ).toHaveLength(6);

    const allTierShadowDeclarations: string[] = [];
    for (const rel of [
      'src/styles/components.css',
      'src/styles/hud.css',
      'src/styles/hud.mobile.css',
      'src/styles/shell.css',
      'src/styles/tokens.css',
    ]) {
      for (const rule of read(rel).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        for (const declaration of rule[2].split(';')) {
          if (!declaration.includes('var(--fx-shadow')) continue;
          const normalized = declaration.trim();
          const tierUses = normalized.match(/var\(--fx-shadow/g) ?? [];
          allTierShadowDeclarations.push(...tierUses.map(() => normalized));
          const property = normalized.slice(0, normalized.indexOf(':')).trim();
          expect(
            ['box-shadow', 'filter', '--art-shadow-sm', '--art-shadow-lg'],
            `${rel} has an identity-affecting --fx-shadow property: ${rule[1].trim()}`,
          ).toContain(property);
          if (property === 'filter') {
            expect(normalized, `${rel} may use --fx-shadow filters only for bloom`).toMatch(
              /^filter\s*:\s*drop-shadow\(/,
            );
            let useAt = normalized.indexOf('var(--fx-shadow');
            while (useAt >= 0) {
              const functionStack: string[] = [];
              for (let index = 0; index < useAt; index += 1) {
                if (normalized[index] === '(') {
                  const functionName = normalized.slice(0, index).match(/([a-z-]+)\s*$/)?.[1];
                  if (functionName) functionStack.push(functionName);
                } else if (normalized[index] === ')') {
                  functionStack.pop();
                }
              }
              expect(
                functionStack,
                `${rel} must keep every --fx-shadow filter use inside drop-shadow()`,
              ).toContain('drop-shadow');
              useAt = normalized.indexOf('var(--fx-shadow', useAt + 1);
            }
          }
        }
      }
    }
    expect(
      allTierShadowDeclarations,
      'the style graph owns 30 reviewed tier-shadow uses',
    ).toHaveLength(30);

    for (const [name, body] of [
      [
        'shared plaque rivets and grain',
        components.match(
          /\.deed-heraldry-plaque\[data-border\]:not\(\[data-border=""\]\)::before,[\s\S]*?\{([^}]*)\}/,
        )?.[1],
      ],
      [
        'shared plaque keyline',
        components.match(
          /\.deed-heraldry-plaque\[data-border\]:not\(\[data-border=""\]\)::after,[\s\S]*?\{([^}]*)\}/,
        )?.[1],
      ],
      [
        'shared seal finishing ring',
        components.match(/\n {2}\.deed-heraldry-seal::after \{([^}]*)\}/)?.[1],
      ],
    ] as const) {
      expect(body, `${name} rule missing`).toBeTruthy();
      expect(body).not.toContain('var(--fx-shadow');
      expect(body).not.toMatch(/data-fx-level|animation:|transition:/);
    }
  });

  it('E35: changing activeBorder busts the character sheet refresh signature', () => {
    const base = {
      activeTitle: null as string | null,
      activeBorder: null as string | null,
      deedsEarned: 1,
      itemsDiscovered: 0,
      marks: 0,
      mounts: 0,
    };
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, activeBorder: 'col_reliquary_rank_5' }),
    );
    expect(charSheetRefreshSig({ ...base, activeBorder: 'col_discovery_250' })).not.toBe(
      charSheetRefreshSig({ ...base, activeBorder: 'col_reliquary_rank_5' }),
    );
    expect(read('src/ui/char_sheet_sig_core.ts')).toContain('parts.activeBorder');
  });

  it('E58: worn slug still rides activeBorder/entity.border with one explicit picker command', () => {
    expect(deedBorderSlug('prog_prestige_10')).toBe('prestige_laurels');
    expect(deedBorderSlug('col_discovery_250')).toBe('curators_gilt');
    const painter = read('src/render/nameplate_painter.ts');
    expect(painter).toContain('state.border = deedBorderSlug(entity.border);');
    const view = read('src/ui/deed_border_view.ts');
    expect(view).not.toContain('world_api');
    expect(read('src/render/nameplate_heraldry_core.ts')).not.toContain('world_api');
    const picker = read('src/ui/deeds_window.ts');
    expect(picker.match(/\.setActiveBorder\(/g)).toHaveLength(1);
    const click = picker.slice(
      picker.indexOf("for (const btn of el.querySelectorAll<HTMLElement>('[data-border-pick]'))"),
    );
    expect(click.slice(0, click.indexOf('\n    }'))).toContain(
      "this.deps.world().setActiveBorder(id === '' ? null : id);",
    );
  });

  it('resolves borderSlug at the hud.ts call sites without a tier read', () => {
    // Both slug reads (self playerFrame, target targetFrame) live in hud.ts,
    // which the ACCENT_PATH scan cannot include because hud.ts legitimately reads
    // fxTier everywhere else. Scan a small window around each `borderSlug =`
    // assignment so a future edit that gated it behind a tier (inline or a
    // wrapping if) is caught without whole-file false positives.
    const hud = read('src/ui/hud.ts').split('\n');
    const sites = hud.reduce<number[]>((acc, line, i) => {
      if (line.includes('Frame.borderSlug = deed')) acc.push(i);
      return acc;
    }, []);
    expect(sites.length, 'expected both borderSlug assignments (self + target)').toBe(2);
    for (const i of sites) {
      const window = hud.slice(Math.max(0, i - 3), i + 2).join('\n');
      for (const token of [...PROFILE_TOKENS, 'fxTier']) {
        expect(
          window.includes(token),
          `the borderSlug assignment near hud.ts line ${i + 1} must not read ${token}`,
        ).toBe(false);
      }
    }
  });
});
