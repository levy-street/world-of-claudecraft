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
import { BORDER_ACCENT_SLUGS, borderAccent, deedBorderSlug } from '../src/ui/deed_border_view';
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
  'src/render/nameplate_painter.ts',
  'src/ui/unit_frame.ts',
  'src/ui/unit_frame_painter.ts',
  // Phase 20: the inspect card's header accent, the third surface of the same
  // identity. It resolves the slug and palette in the pure core and hands the
  // painter resolved values, so BOTH files join the single-source scan.
  'src/ui/inspect_view.ts',
  'src/ui/inspect_window.ts',
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

  it('pins the forced-palette mapping the nameplate cartouche already had', () => {
    // Recorded at Phase 19 QA and closed in Phase 20. The three accent custom
    // properties are never missing (paintPortraitBorder writes them together
    // with the data-border slug the rule gates on), so the `transparent`
    // fallbacks cannot engage; what forced-colors does is replace the computed
    // colors with the system palette. The arm is worth pinning for the CHOICE of
    // replacement, three things: the same system pair the cartouche
    // (nameplate_canvas.ts drawBorderAccent) already restated, the outline
    // remapped so the edge contour does not flatten onto the frame line, and the
    // decorative bloom dropped explicitly. The two surfaces must agree on WHICH
    // system colors, or one identity reads two ways under high contrast.
    const forced = HUD_CSS.match(
      /@media \(forced-colors: active\) \{\s*\.portrait-wrap\[data-border\]:not\(\[data-border=""\]\)::after \{([^}]*)\}/,
    )?.[1];
    expect(forced, 'the portrait ring has no forced-colors arm in hud.css').toBeTruthy();
    // The frame line is the one that must stay visible; the edge contour drops
    // to the background color, exactly as the canvas does.
    expect(forced).toContain('border-color: CanvasText;');
    expect(forced).toContain('outline-color: Canvas;');
    // The bloom is stripped by forced-colors anyway; dropping it explicitly
    // keeps the rule honest rather than leaving a dead declaration that reads
    // load-bearing.
    expect(forced).toContain('box-shadow: none;');

    // The canvas half of the family, read from its own source so the two cannot
    // drift: same two system colors, same roles.
    const canvas = read('src/render/nameplate_canvas.ts');
    const cartouche = canvas.slice(canvas.indexOf('private drawBorderAccent('));
    const body = cartouche.slice(0, cartouche.indexOf('private drawHealth('));
    expect(body).toContain("forcedColors ? 'CanvasText' : accent.frame");
    expect(body).toContain("forcedColors ? 'Canvas' : accent.edge");
  });

  it('gives the inspect header accent the same forced-colors arm', () => {
    // The third surface of the identity joins the family in the same change,
    // rather than inheriting the gap the ring just closed.
    const shell = read('src/styles/shell.css');
    const forced = shell.match(
      /@media \(forced-colors: active\) \{\s*\.inspect-name\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
    )?.[1];
    expect(forced, 'the inspect header accent has no forced-colors arm').toBeTruthy();
    expect(forced).toContain('border-color: CanvasText;');
    expect(forced).toContain('outline-color: Canvas;');
    expect(forced).toContain('box-shadow: none;');
  });

  it('the inspect header rule gates on a NON-EMPTY slug and holds no color', () => {
    const shell = read('src/styles/shell.css');
    const rule = shell.match(
      /\n {2}\.inspect-name\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
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

  it('the inspect painter writes the ring attribute and property NAMES verbatim', () => {
    // The card spells the four literals inline (it must not import a per-frame
    // painter for four strings), so this is what keeps them equal to the
    // constants the stylesheet family is written against.
    const painter = read('src/ui/inspect_window.ts');
    expect(painter).toContain(`${PORTRAIT_BORDER_ATTR}="\${esc(border.slug)}"`);
    for (const prop of [
      PORTRAIT_BORDER_FRAME_PROP,
      PORTRAIT_BORDER_EDGE_PROP,
      PORTRAIT_BORDER_GLOW_PROP,
    ]) {
      // The esc() wrapper is pinned with the name: the style attribute is the
      // one place a future palette source could inject through, so dropping the
      // escape must red this test, not just reordering the property names.
      expect(painter, `the inspect card must write ${prop}`).toContain(`${prop}:\${esc(border.`);
    }
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
  ];

  it('reads no effects profile, tier knob, or FPS governor anywhere on the path', () => {
    for (const rel of ACCENT_PATH) {
      const source = read(rel);
      for (const token of PROFILE_TOKENS) {
        expect(source.includes(token), `${rel} must not read ${token}`).toBe(false);
      }
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

  it('resolves borderSlug at the hud.ts call sites without a tier read', () => {
    // Both slug reads (self playerFrame, target targetFrame) live in hud.ts,
    // which the ACCENT_PATH scan cannot include because hud.ts legitimately reads
    // fxTier everywhere else. Scan a small window around each `borderSlug =`
    // assignment so a future edit that gated it behind a tier (inline or a
    // wrapping if) is caught without whole-file false positives.
    const hud = read('src/ui/hud.ts').split('\n');
    const sites = hud.reduce<number[]>((acc, line, i) => {
      if (line.includes('borderSlug = deedBorderSlug')) acc.push(i);
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
