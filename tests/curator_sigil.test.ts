// The Curator sigil: the Reliquary's rank-5 honor mark on the click-inspect card.
//
// Mirrors the shape pins tests/holder_tier.test.ts gives the $WOC ladder art,
// because the sigil ships through the same three contracts: it is a self-contained
// SVG data URL an <img> can load, it is font-free and filter-free (a <filter>
// would not survive the badge's own CSS drop-shadow stack and is what the family
// forbids), and the class helper is the single place the CSS hook is spelled.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURATOR_RANK_DEFS } from '../src/sim/reliquary';
import * as sigilModule from '../src/ui/curator_sigil';
import {
  CURATOR_SIGIL_GLOW,
  curatorSigilBadgeClass,
  curatorSigilDataUrl,
} from '../src/ui/curator_sigil';

const decode = (px?: number): string =>
  decodeURIComponent(
    (px === undefined ? curatorSigilDataUrl() : curatorSigilDataUrl(px)).slice(
      'data:image/svg+xml,'.length,
    ),
  );

describe('curatorSigilDataUrl: a self-contained 64-viewBox SVG data URL', () => {
  it('carries the data-URL prefix and a 0 0 64 64 viewBox', () => {
    const url = curatorSigilDataUrl();
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    const svg = decode();
    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain('</svg>');
  });

  it('sizes the raster box from px while the viewBox stays fixed', () => {
    // The two are independent on purpose: the art scales crisply because only
    // the pixel box moves.
    expect(decode(32)).toContain('width="32" height="32"');
    expect(decode(32)).toContain('viewBox="0 0 64 64"');
    expect(decode(256)).toContain('width="256" height="256"');
    // The default is the same 128 box the sibling badges default to.
    expect(decode()).toContain('width="128" height="128"');
  });

  it('emits no SVG <filter>, in the decoded OR the encoded form', () => {
    expect(decode()).not.toContain('<filter');
    // Guard the URI-encoded string the browser actually parses too: the word
    // appears nowhere legitimately, so any occurrence is the smell.
    expect(curatorSigilDataUrl(64).toLowerCase()).not.toContain('filter');
  });

  it('is font-free: no text, no font, no glyph anywhere in the art', () => {
    const svg = decode().toLowerCase();
    for (const token of ['<text', 'font-', 'font=', '<tspan']) {
      expect(svg, `the badge must not carry ${token}`).not.toContain(token);
    }
  });

  it('draws with gradients and strokes only, under the static m / f gradient ids', () => {
    const svg = decode();
    expect(svg).toContain('<linearGradient id="m"');
    expect(svg).toContain('<radialGradient id="f"');
    expect(svg).toContain('fill="url(#m)"');
    expect(svg).toContain('fill="url(#f)"');
  });

  it('is URI-encoded, so the raw URL carries no unescaped markup delimiters', () => {
    // An unencoded < or " in an <img src> is what breaks a data URL in a real
    // browser while every decoded assertion above stays green.
    const url = curatorSigilDataUrl();
    const payload = url.slice('data:image/svg+xml,'.length);
    for (const ch of ['<', '>', '"', '#']) {
      expect(payload, `the encoded payload must escape ${ch}`).not.toContain(ch);
    }
  });

  it('is deterministic: the same px always yields byte-identical art', () => {
    expect(curatorSigilDataUrl(64)).toBe(curatorSigilDataUrl(64));
  });
});

describe('curatorSigilBadgeClass: the CSS hook, spelled once', () => {
  it('is exactly the shared badge box plus the sigil halo opt-in', () => {
    // The exact string, because the stylesheet rule is written against BOTH
    // class names as a compound selector; dropping either silently unstyles the
    // badge while every render test still finds an <img>.
    expect(curatorSigilBadgeClass()).toBe('inspect-holder-badge inspect-curator-halo');
  });

  it('the halo rule the class names actually REACHES it in shell.css', () => {
    // Class presence proves the painter wrote the hook, never that any rule
    // selects it. Read the real stylesheet: pin the compound selector AND the
    // declaration in its body, so a family rule scoped to a sibling surface
    // cannot leave the sigil unstyled with the suite green.
    const shell = readFileSync(new URL('../src/styles/shell.css', import.meta.url), 'utf8');
    const rule = shell.match(/\.inspect-holder-badge\.inspect-curator-halo \{([^}]*)\}/)?.[1];
    expect(rule, 'no .inspect-holder-badge.inspect-curator-halo rule in shell.css').toBeTruthy();
    expect(rule).toContain('var(--curator-glow, transparent)');
    // The shared strength tunable, not a bespoke blur: the four badges must
    // glow at one strength.
    expect(rule).toContain('var(--holder-halo)');
  });

  it('the glow constant is a plain hex the painter can hand to a custom property', () => {
    expect(CURATOR_SIGIL_GLOW).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('the sigil is one rung, and that rung is the ladder top', () => {
  it('exposes exactly one mark: no tier table, no per-rank art, no rung lookup', () => {
    // The whole public surface, pinned as a set. A ladder would arrive here as a
    // *_TIERS table or a byIndex/forRank builder, which is exactly the
    // exclusivity this phase locked; the honor's gate lives in inspect_view and
    // there is nothing in this module for it to vary.
    expect(Object.keys(sigilModule).sort()).toEqual([
      'CURATOR_SIGIL_GLOW',
      'curatorSigilBadgeClass',
      'curatorSigilDataUrl',
    ]);
  });

  it('the honor it stands for is the ladder top rung (100 unique relics)', () => {
    const top = CURATOR_RANK_DEFS.at(-1);
    expect(top?.rank).toBe(5);
    expect(top?.threshold).toBe(100);
    // sealId 'eternal' is the chrome id the rank already carried; the art's
    // struck-seal motif is named for it, so a re-themed rank reds here.
    expect(top?.sealId).toBe('eternal');
  });
});
