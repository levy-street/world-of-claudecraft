import { describe, expect, it } from 'vitest';
import {
  CREST_OVERSCAN,
  crestIdForEntity,
  MAX_PORTRAIT_DPR,
  overscanRect,
  PORTRAIT_CSS_SIZE,
  portraitBackingPx,
  UnitPortraitPlanCache,
  unitPortraitPlan,
} from '../src/ui/unit_portrait';

describe('portraitBackingPx', () => {
  it('pins the larger AAA unit-frame portrait content box', () => {
    expect(PORTRAIT_CSS_SIZE).toBe(58);
  });

  it('matches the CSS size at dpr 1', () => {
    expect(portraitBackingPx(54, 1)).toBe(54);
  });

  it('scales the backing store up for HiDPI (the crispness fix)', () => {
    expect(portraitBackingPx(54, 2)).toBe(108);
    expect(portraitBackingPx(54, 2.5)).toBe(135);
  });

  it('rounds to whole device pixels', () => {
    // 54 * 1.5 = 81 exactly; 54 * 1.333.. rounds.
    expect(portraitBackingPx(54, 1.5)).toBe(81);
    expect(portraitBackingPx(50, 1.333)).toBe(67); // 66.65 -> 67
  });

  it('clamps the scale to [1, MAX_PORTRAIT_DPR]', () => {
    expect(portraitBackingPx(54, 0.5)).toBe(54); // never downscale below 1x
    expect(portraitBackingPx(54, 8)).toBe(54 * MAX_PORTRAIT_DPR);
  });

  it('falls back to 1x for non-finite / non-positive dpr', () => {
    expect(portraitBackingPx(54, NaN)).toBe(54);
    expect(portraitBackingPx(54, Infinity)).toBe(54);
    expect(portraitBackingPx(54, 0)).toBe(54);
    expect(portraitBackingPx(54, -2)).toBe(54);
  });

  it('never returns less than one pixel', () => {
    expect(portraitBackingPx(0, 1)).toBe(1);
  });
});

describe('overscanRect', () => {
  it('is the identity rect at overscan 1', () => {
    expect(overscanRect(54, 1)).toEqual({ dx: 0, dy: 0, dw: 54, dh: 54 });
  });

  it('centres an oversized draw (negative offsets) so the rim lands off-canvas', () => {
    const r = overscanRect(100, 1.2);
    expect(r.dw).toBe(120);
    expect(r.dh).toBe(120);
    expect(r.dx).toBe(-10);
    expect(r.dy).toBe(-10);
    // Symmetric: the drawn image is centred in the canvas.
    expect(r.dx + r.dw).toBe(110);
  });

  it('keeps the centre fixed regardless of overscan', () => {
    const size = 54;
    for (const k of [1, 1.1, CREST_OVERSCAN, 1.5]) {
      const r = overscanRect(size, k);
      expect(r.dx + r.dw / 2).toBeCloseTo(size / 2, 9);
      expect(r.dy + r.dh / 2).toBeCloseTo(size / 2, 9);
    }
  });

  it('CREST_OVERSCAN actually zooms in (fills the circular clip)', () => {
    expect(CREST_OVERSCAN).toBeGreaterThan(1);
    const r = overscanRect(PORTRAIT_CSS_SIZE, CREST_OVERSCAN);
    expect(r.dw).toBeGreaterThan(PORTRAIT_CSS_SIZE);
    expect(r.dx).toBeLessThan(0);
  });
});

describe('crestIdForEntity', () => {
  it('maps NPCs to the status emblem', () => {
    expect(crestIdForEntity('npc', undefined)).toBe('status_npc');
    // Family is irrelevant for NPCs.
    expect(crestIdForEntity('npc', 'beast')).toBe('status_npc');
  });

  it('maps mobs to their creature-family crest', () => {
    expect(crestIdForEntity('mob', 'beast')).toBe('family_beast'); // the Wild Boar case
    expect(crestIdForEntity('mob', 'undead')).toBe('family_undead');
  });

  it('falls back to humanoid when a mob family is unknown', () => {
    expect(crestIdForEntity('mob', undefined)).toBe('family_humanoid');
  });
});

describe('unitPortraitPlan: contextual player portraits', () => {
  const player = (over: Partial<Parameters<typeof unitPortraitPlan>[0]> = {}) => ({
    kind: 'player',
    templateId: 'druid',
    skin: 2,
    skinCatalog: 'class',
    dead: false,
    ghost: false,
    auras: [] as { id: string; kind: string }[],
    ...over,
  });

  it('uses the equipped class or mech body and includes it in the repaint identity', () => {
    expect(unitPortraitPlan(player())).toMatchObject({
      visualKey: 'player_druid',
      skin: 2,
      context: 'normal',
      identityKey: 'player_druid:2:normal',
    });
    expect(unitPortraitPlan(player({ skinCatalog: 'mech', skin: 4 }))).toMatchObject({
      visualKey: 'player_mech',
      skin: 4,
      context: 'mech',
    });
  });

  it('matches renderer form precedence and exposes ghost/dead material states', () => {
    expect(unitPortraitPlan(player({ auras: [{ id: 'bear', kind: 'form_bear' }] }))).toMatchObject({
      visualKey: 'form_bear',
      context: 'form',
    });
    expect(
      unitPortraitPlan(
        player({
          auras: [
            { id: 'bear', kind: 'form_bear' },
            { id: 'sheep', kind: 'polymorph' },
          ],
        }),
      ),
    ).toMatchObject({ visualKey: 'form_sheep', context: 'polymorph' });
    expect(unitPortraitPlan(player({ dead: true }))).toMatchObject({ context: 'dead' });
    expect(unitPortraitPlan(player({ dead: true, ghost: true }))).toMatchObject({
      context: 'ghost',
    });
  });

  it('marks shader-only transformations without replacing the class model', () => {
    expect(
      unitPortraitPlan(player({ auras: [{ id: 'meta', kind: 'form_metamorph' }] })),
    ).toMatchObject({ visualKey: 'player_druid', context: 'transformed' });
  });

  it('returns null for non-player subjects', () => {
    expect(unitPortraitPlan(player({ kind: 'mob' }))).toBeNull();
  });

  it('reuses a cached plan until a portrait-relevant field changes', () => {
    const cache = new UnitPortraitPlanCache();
    const auras: { id: string; kind: string }[] = [];
    const subject = player({ auras });
    const first = cache.plan(subject);
    expect(cache.plan(subject)).toBe(first);

    subject.dead = true;
    const dead = cache.plan(subject);
    expect(dead).not.toBe(first);
    expect(dead).toMatchObject({ context: 'dead' });

    auras.push({ id: 'bear', kind: 'form_bear' });
    const bear = cache.plan(subject);
    expect(bear).not.toBe(dead);
    expect(bear).toMatchObject({ visualKey: 'form_bear' });
    expect(cache.plan(subject)).toBe(bear);
  });
});
