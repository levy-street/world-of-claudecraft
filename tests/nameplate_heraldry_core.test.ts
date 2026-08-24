import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createNameplateHeraldry,
  NAMEPLATE_HERALDRY_EXTRA_LIFT,
  NAMEPLATE_HERALDRY_NAME_BASELINE_FROM_CENTER,
  NAMEPLATE_HERALDRY_PLAQUE_PAD_X,
  NAMEPLATE_HERALDRY_PLAQUE_PAD_Y,
  NAMEPLATE_HERALDRY_SEAL_SIZE,
  NAMEPLATE_HERALDRY_TITLE_BASELINE,
  NAMEPLATE_HERALDRY_TITLE_STEP,
  NAMEPLATE_HERALDRY_WELL_ALPHA,
  NAMEPLATE_HERALDRY_WELL_FILL,
  type NameplateHeraldryInput,
  nameplateHeraldryInto,
} from '../src/render/nameplate_heraldry_core';
import {
  BORDER_ACCENT_SLUGS,
  type BorderMotifKind,
  borderAccent,
  borderMotifPrimitives,
} from '../src/ui/deed_border_view';
import { scanReachableHotPath } from './helpers/hot_path_allocations';
import { assertAllocationStable } from './util/alloc_probe';

const CORE_PATH = 'src/render/nameplate_heraldry_core.ts';
const RETIRED_CORE_PATH = 'src/render/nameplate_cartouche_core.ts';

const read = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

function input(over: Partial<NameplateHeraldryInput> = {}): NameplateHeraldryInput {
  return {
    screenX: 320,
    nameRowBottomY: 200,
    nameRowWidth: 70,
    nameRowHeight: 16,
    slug: 'deepward',
    ...over,
  };
}

function layout(over: Partial<NameplateHeraldryInput> = {}) {
  return nameplateHeraldryInto(createNameplateHeraldry(), input(over));
}

describe('nameplate heraldry named constants', () => {
  it('pins the accepted plaque CSS-pixel measurements to literals', () => {
    expect(NAMEPLATE_HERALDRY_PLAQUE_PAD_X).toBe(7);
    expect(NAMEPLATE_HERALDRY_PLAQUE_PAD_Y).toBe(1);
    expect(NAMEPLATE_HERALDRY_WELL_ALPHA).toBe(0.62);
    expect(NAMEPLATE_HERALDRY_WELL_FILL).toBe('#14110c');
    expect(NAMEPLATE_HERALDRY_SEAL_SIZE).toBe(18);
    expect(NAMEPLATE_HERALDRY_EXTRA_LIFT).toBe(8);
    expect(NAMEPLATE_HERALDRY_TITLE_STEP).toBe(11);
    expect(NAMEPLATE_HERALDRY_TITLE_BASELINE).toBe(9);
    expect(NAMEPLATE_HERALDRY_NAME_BASELINE_FROM_CENTER).toBe(5);
  });

  it('keeps the shared midnight well distinct from every deed metal color', () => {
    for (const slug of BORDER_ACCENT_SLUGS) {
      const accent = borderAccent(slug);
      expect(accent, slug).not.toBeNull();
      expect(NAMEPLATE_HERALDRY_WELL_FILL, `${slug} frame`).not.toBe(accent?.frame);
      expect(NAMEPLATE_HERALDRY_WELL_FILL, `${slug} edge`).not.toBe(accent?.edge);
      expect(NAMEPLATE_HERALDRY_WELL_FILL, `${slug} glow`).not.toBe(accent?.glow);
    }
  });
});

describe('E37 world silhouette: one seal attached to one shallow name plaque', () => {
  it('emits only the heraldry geometry surface and retires the cartouche core', () => {
    const out = layout({ slug: 'deepward' });
    expect(Object.keys(out).sort()).toEqual([
      'active',
      'extraLift',
      'joint',
      'motifCenterX',
      'motifCenterY',
      'motifKind',
      'motifScale',
      'nameBaseline',
      'nameRowLeft',
      'nameRowTop',
      'plaque',
      'plaqueNotchX',
      'plaqueShoulderX',
      'rivets',
      'seal',
      'titleBaseline',
      'titleCenterX',
    ]);
    expect(out.active).toBe(true);
    expect(out.plaque.w).toBeGreaterThan(out.plaque.h * 3);
    expect(out.plaqueShoulderX).toBe(out.plaque.x + out.plaque.w - 8);
    expect(out.plaqueNotchX).toBe(out.plaque.x + 4);
    expect(out.seal.size).toBe(18);
    expect(out.plaque.x - (out.seal.x + out.seal.size)).toBe(2);
    expect(out.joint.w).toBeGreaterThan(0);
    expect(out.joint.h).toBeGreaterThan(0);
    expect(out.joint.x).toBeLessThan(out.seal.x + out.seal.size);
    expect(out.joint.x + out.joint.w).toBeGreaterThan(out.plaque.x);
    expect(out.rivets).toHaveLength(2);
    for (const rivet of out.rivets) {
      expect(rivet.x).toBeGreaterThanOrEqual(out.joint.x);
      expect(rivet.x).toBeLessThanOrEqual(out.joint.x + out.joint.w);
      expect(rivet.y).toBeGreaterThanOrEqual(out.joint.y);
      expect(rivet.y).toBeLessThanOrEqual(out.joint.y + out.joint.h);
    }
    expect(out.rivets[0]).not.toEqual(out.rivets[1]);
    expect(out.motifCenterX).toBe(out.seal.x + out.seal.size / 2);
    expect(out.motifCenterY).toBe(out.seal.y + out.seal.size / 2);
    expect(out.motifScale).toBeGreaterThan(0);
    expect(out.motifScale).toBeLessThanOrEqual(out.seal.size / 2);
    expect(existsSync(new URL(`../${RETIRED_CORE_PATH}`, import.meta.url))).toBe(false);
  });
});

describe('E38 name and secondary title geometry', () => {
  it('pins the normal seal, plaque, name, and outside-title positions', () => {
    const out = layout({
      screenX: 320,
      nameRowBottomY: 200,
      nameRowWidth: 70,
      nameRowHeight: 16,
      slug: 'deepward',
    });
    expect(out.active).toBe(true);
    expect(out.nameRowLeft).toBe(285);
    expect(out.nameRowTop).toBe(184);
    expect(out.nameBaseline).toBe(197);
    expect(out.plaque).toEqual({ x: 278, y: 183, w: 92, h: 18 });
    expect(out.plaqueShoulderX).toBe(362);
    expect(out.plaqueNotchX).toBe(282);
    expect(out.seal).toEqual({ x: 258, y: 183, size: 18 });
    expect(out.seal.x + out.seal.size).toBe(276);
    expect(out.nameRowLeft - (out.seal.x + out.seal.size)).toBe(9);
    expect(out.titleBaseline).toBe(209);
    expect(out.titleCenterX).toBe(320);
    expect(out.titleBaseline).toBeGreaterThan(out.plaque.y + out.plaque.h);
    expect(out.titleBaseline - (out.plaque.y + out.plaque.h)).toBe(8);
  });

  it('does not accept title width, so a wide title cannot widen the name plaque', () => {
    const source = read(CORE_PATH);
    const inputBody = source.match(/export interface NameplateHeraldryInput\s*\{([^}]*)\}/)?.[1];
    expect(inputBody).toBeDefined();
    const fields = [...(inputBody ?? '').matchAll(/(?:readonly\s+)?(\w+)\s*:/g)].map(
      (match) => match[1],
    );
    expect(fields).toEqual(['screenX', 'nameRowBottomY', 'nameRowWidth', 'nameRowHeight', 'slug']);
    expect(source).not.toContain('titleWidth');
  });
});

describe('E39 measured name-row variants stay centered and clear the seal', () => {
  it.each([
    { label: '15px badge in the 16px row', rowWidth: 154, rowHeight: 16 },
    { label: 'long Unicode, AFK/role, chips, and 24px portrait', rowWidth: 222, rowHeight: 24 },
  ])('$label', ({ rowWidth, rowHeight }) => {
    const out = layout({
      screenX: 411,
      nameRowBottomY: 250,
      nameRowWidth: rowWidth,
      nameRowHeight: rowHeight,
      slug: 'prestige_laurels',
    });
    expect(out.nameRowLeft + rowWidth / 2).toBe(411);
    expect(out.plaque.x).toBe(out.nameRowLeft - 7);
    expect(out.plaque.w).toBe(rowWidth + 22);
    expect(out.plaque.y).toBe(out.nameRowTop - 1);
    expect(out.plaque.h).toBe(rowHeight + 2);
    expect(out.nameRowLeft - (out.seal.x + out.seal.size)).toBe(9);
    expect(out.plaque.x - (out.seal.x + out.seal.size)).toBe(2);
    expect(out.nameBaseline).toBeGreaterThan(out.plaque.y);
    expect(out.nameBaseline).toBeLessThan(out.plaque.y + out.plaque.h);
    expect(out.titleCenterX).toBe(411);
  });
});

describe('E40 four normalized seal identities', () => {
  const EXPECTED_KIND: Record<string, BorderMotifKind> = {
    curators_gilt: 'catalogue',
    reliquary_gilt: 'vault',
    deepward: 'ward',
    prestige_laurels: 'laurel',
  };

  const fingerprint = (kind: BorderMotifKind): string =>
    borderMotifPrimitives(kind)
      .map((line) => `${line.x1},${line.y1},${line.x2},${line.y2}`)
      .join('|');

  it('returns frozen, stable, colorless line sets in normalized seal space', () => {
    for (const kind of Object.values(EXPECTED_KIND)) {
      const first = borderMotifPrimitives(kind);
      const second = borderMotifPrimitives(kind);
      expect(second, kind).toBe(first);
      expect(Object.isFrozen(first), `${kind} line set`).toBe(true);
      expect(first.length, kind).toBeGreaterThanOrEqual(3);
      const coords: number[] = [];
      for (const line of first) {
        expect(Object.isFrozen(line), `${kind} line`).toBe(true);
        expect(Object.keys(line).sort()).toEqual(['x1', 'x2', 'y1', 'y2']);
        const values = [line.x1, line.y1, line.x2, line.y2];
        for (const value of values) {
          expect(Number.isFinite(value), `${kind} coordinate`).toBe(true);
          expect(value, `${kind} normalized minimum`).toBeGreaterThanOrEqual(-1);
          expect(value, `${kind} normalized maximum`).toBeLessThanOrEqual(1);
          coords.push(value);
        }
      }
      expect(Math.min(...coords), `${kind} must cross the normalized center`).toBeLessThan(0);
      expect(Math.max(...coords), `${kind} must cross the normalized center`).toBeGreaterThan(0);
    }
  });

  it('maps the four slugs to four distinct silhouettes without using color', () => {
    const prints: string[] = [];
    for (const slug of BORDER_ACCENT_SLUGS) {
      const kind = EXPECTED_KIND[slug];
      const out = layout({ slug });
      expect(out.motifKind, slug).toBe(kind);
      expect(borderAccent(slug)?.motif, slug).toBe(kind);
      prints.push(fingerprint(kind));
    }
    expect(new Set(prints).size).toBe(4);
  });
});

describe('E42 borderless, stale, removed, and title-reward ids reset inactive state', () => {
  it.each(['', 'retired_border_slug', 'prog_veteran'])(
    'clears every heraldry primitive for %j while retaining ordinary text origins',
    (slug) => {
      const out = createNameplateHeraldry();
      const refs = {
        plaque: out.plaque,
        seal: out.seal,
        joint: out.joint,
        rivets: out.rivets,
        rivet0: out.rivets[0],
        rivet1: out.rivets[1],
      };
      nameplateHeraldryInto(out, input({ slug: 'deepward' }));
      expect(out.active).toBe(true);
      nameplateHeraldryInto(out, input({ slug }));
      expect(out.active).toBe(false);
      expect(out.extraLift).toBe(0);
      expect(out.plaqueShoulderX).toBe(0);
      expect(out.plaqueNotchX).toBe(0);
      expect(out.plaque).toEqual({ x: 0, y: 0, w: 0, h: 0 });
      expect(out.seal).toEqual({ x: 0, y: 0, size: 0 });
      expect(out.joint).toEqual({ x: 0, y: 0, w: 0, h: 0 });
      expect(out.rivets[0]).toEqual({ x: 0, y: 0 });
      expect(out.rivets[1]).toEqual({ x: 0, y: 0 });
      expect(out.motifKind).toBe('');
      expect(out.motifCenterX).toBe(0);
      expect(out.motifCenterY).toBe(0);
      expect(out.motifScale).toBe(0);
      expect(out.nameRowLeft).toBe(285);
      expect(out.nameRowTop).toBe(184);
      expect(out.nameBaseline).toBe(197);
      expect(out.titleBaseline).toBe(209);
      expect(out.titleCenterX).toBe(320);
      expect(out.plaque).toBe(refs.plaque);
      expect(out.seal).toBe(refs.seal);
      expect(out.joint).toBe(refs.joint);
      expect(out.rivets).toBe(refs.rivets);
      expect(out.rivets[0]).toBe(refs.rivet0);
      expect(out.rivets[1]).toBe(refs.rivet1);
    },
  );
});

describe('E44 CSS pixels and caller-owned reference stability', () => {
  it('fills and returns the same record without replacing any nested geometry', () => {
    const out = createNameplateHeraldry();
    const refs = {
      plaque: out.plaque,
      seal: out.seal,
      joint: out.joint,
      rivets: out.rivets,
      rivet0: out.rivets[0],
      rivet1: out.rivets[1],
    };
    const first = input({ nameRowWidth: 40, slug: 'deepward' });
    const second = input({ nameRowWidth: 220, nameRowHeight: 24, slug: 'reliquary_gilt' });
    let flip = false;
    assertAllocationStable(
      () => {
        flip = !flip;
        return nameplateHeraldryInto(out, flip ? first : second);
      },
      64,
      'nameplate heraldry core',
    );
    expect(nameplateHeraldryInto(out, first)).toBe(out);
    expect(out.plaque).toBe(refs.plaque);
    expect(out.seal).toBe(refs.seal);
    expect(out.joint).toBe(refs.joint);
    expect(out.rivets).toBe(refs.rivets);
    expect(out.rivets[0]).toBe(refs.rivet0);
    expect(out.rivets[1]).toBe(refs.rivet1);

    const other = createNameplateHeraldry();
    expect(other).not.toBe(out);
    expect(other.plaque).not.toBe(out.plaque);
    expect(other.seal).not.toBe(out.seal);
    expect(other.joint).not.toBe(out.joint);
    expect(other.rivets).not.toBe(out.rivets);
    expect(other.rivets[0]).not.toBe(out.rivets[0]);
    expect(other.rivets[1]).not.toBe(out.rivets[1]);
  });

  it('ignores rogue scale and tier properties and reports the same 8 CSS-pixel lift', () => {
    const normal = layout();
    const rogueInput = {
      ...input(),
      dpr: 3,
      uiScale: 1.75,
      gfxTier: 'low',
      governor: { pressure: 1 },
    } as NameplateHeraldryInput;
    const rogue = nameplateHeraldryInto(createNameplateHeraldry(), rogueInput);
    expect(rogue).toEqual(normal);
    expect(normal.extraLift).toBe(8);
    expect(layout({ nameRowHeight: 24 }).extraLift).toBe(8);
    expect(layout({ slug: '' }).extraLift).toBe(0);
  });
});

describe('E46 allocation, raster, and tier fairness guards', () => {
  it('proves the reachable-allocation scan catches planted helper and syntax escapes', () => {
    const planted = scanReachableHotPath(
      [
        {
          fileName: 'planted.ts',
          source: `
            function hidden() {
              const values = Object.values({ value: 1 });
              return values.concat(JSON.parse('[2]'));
            }
            function hot(provider: { allocate(): unknown }) {
              const local = [];
              const closure = () => local;
              hidden();
              provider.allocate();
              return closure();
            }
          `,
        },
      ],
      ['hot'],
    );
    const allocations = planted.allocations.join('\n');
    expect(planted.visited).toEqual(['hidden', 'hot']);
    expect(allocations).toContain('Object.values call');
    expect(allocations).toContain('.concat call');
    expect(allocations).toContain('JSON.parse call');
    expect(allocations).toContain('object literal');
    expect(allocations).toContain('array literal');
    expect(allocations).toContain('arrow function');
    expect(planted.unresolvedCalls.join('\n')).toContain('unresolved closure');
    expect(planted.unresolvedCalls.join('\n')).toContain('unresolved provider.allocate');
  });

  it('scans the hot fill and its complete named-helper call graph', () => {
    const scan = scanReachableHotPath(
      [
        { fileName: CORE_PATH, source: read(CORE_PATH) },
        { fileName: 'src/ui/deed_border_view.ts', source: read('src/ui/deed_border_view.ts') },
      ],
      ['nameplateHeraldryInto'],
    );
    expect(scan.visited).toEqual([
      'borderAccent',
      'nameplateHeraldryInto',
      'writeRect',
      'zeroHeraldry',
    ]);
    expect(scan.allocations).toEqual([]);
    expect(scan.unresolvedCalls).toEqual([]);
  });

  it('takes no DPR, title-width, tier, governor, gradient, filter, or raster dependency', () => {
    const source = read(CORE_PATH).toLowerCase();
    for (const token of [
      'titlewidth',
      'dpr',
      'devicepixelratio',
      'pixelratio',
      'uiscale',
      'gfxtier',
      'fxtier',
      'renderbudget',
      'governor',
      'ui_effects_profile',
      'ui_tier_knobs',
      'render_budget',
      'createlineargradient',
      'createradialgradient',
      '.filter(',
      'raster',
      'sprite',
      'imagebitmap',
      'offscreencanvas',
      'document.',
      'window.',
      'math.random',
      'performance.',
    ]) {
      expect(source.includes(token), `pure core must not contain ${token}`).toBe(false);
    }
    expect(source).not.toContain('nameplate_cartouche_core');
  });
});
