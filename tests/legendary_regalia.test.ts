// The orange (promoted legendary) world-space identity: the wire-field
// predicate and distance shed (legendary_regalia_core.ts), the pooled forge-mote
// emitter (vfx.ts legendaryRegalia), and the renderer's cached wiring.
//
// The load-bearing claims here:
//   - the predicate is a pure function of the four allowlisted eqi wire fields
//     and keys on rolled.quality alone, so it renders identically offline,
//     online, self, and peer (the perfected host-parity trap stays out);
//   - the shed is the weapon_vfx_shed_core distance arm: anchored to the FIXED
//     CHARACTER_LOD_RANGE_SQ, eased, quantized, floored, never 0;
//   - the palette is the legendary quality orange, single-sourced;
//   - fairness for a SHEDDABLE prestige cosmetic (the weapon-vfx doctrine, not
//     the border accent's preset-identical one): the core reads no preset,
//     tier, governor, or actionable state, and the feature's renderer/vfx
//     slices hide nothing and mint no light.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHARACTER_LOD_RANGE_SQ } from '../src/render/crowd_lod';
import {
  LEGENDARY_REGALIA_COLOR,
  LEGENDARY_REGALIA_GOLD,
  LEGENDARY_REGALIA_RATE_PER_SEC,
  legendaryRegaliaActive,
  legendaryRegaliaEmitScale,
} from '../src/render/legendary_regalia_core';
import { TIERS } from '../src/render/weapon_vfx';
import type { ItemInstancePayload } from '../src/sim/types';
import { QUALITY_COLOR } from '../src/ui/icons';

// Comments stripped before scanning (the architecture-test rule): prose that
// NAMES the invariant must never satisfy or trip the scan that enforces it.
const read = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('legendaryRegaliaActive: the four-field wire predicate', () => {
  const worn = (inst: ItemInstancePayload): Partial<Record<string, ItemInstancePayload>> => ({
    chest: inst,
  });

  it('answers true for a promoted copy (legendary roll plus the stamped name)', () => {
    expect(
      legendaryRegaliaActive(worn({ rolled: { quality: 'legendary' }, name: 'Dawnbreaker' })),
    ).toBe(true);
  });

  it('answers true for a legacy masterwork-bumped legendary roll', () => {
    // D13-4's display doctrine (2026-08-29): display follows the honest roll,
    // so legacy masterwork bumps that wrote rolled.quality glow exactly as the
    // bags window already colors those names orange.
    expect(
      legendaryRegaliaActive(
        worn({ rolled: { quality: 'legendary', stats: { str: 5 }, masterwork: true } }),
      ),
    ).toBe(true);
  });

  it('answers true for a moderation name-stripped promoted copy', () => {
    // D13-5: a stripped copy is a PERMANENTLY nameless legendary; the honest
    // roll survives the strip, so the identity does too.
    expect(legendaryRegaliaActive(worn({ rolled: { quality: 'legendary' } }))).toBe(true);
  });

  it('answers true when any one worn slot qualifies among others that do not', () => {
    expect(
      legendaryRegaliaActive({
        mainhand: { enchant: 'fiery' },
        chest: { rolled: { quality: 'legendary' }, name: 'Dawnbreaker' },
      }),
    ).toBe(true);
  });

  it('answers false for an epic roll', () => {
    expect(legendaryRegaliaActive(worn({ rolled: { quality: 'epic' } }))).toBe(false);
  });

  it('answers false for a masterwork-only roll (no quality bump)', () => {
    expect(legendaryRegaliaActive(worn({ rolled: { stats: { sta: 3 }, masterwork: true } }))).toBe(
      false,
    );
  });

  it('answers false for an enchant-only payload', () => {
    expect(legendaryRegaliaActive(worn({ enchant: 'fiery' }))).toBe(false);
  });

  it('answers false for an empty set and an empty payload', () => {
    expect(legendaryRegaliaActive({})).toBe(false);
    expect(legendaryRegaliaActive(worn({}))).toBe(false);
  });
});

describe('legendaryRegaliaEmitScale: the distance shed', () => {
  const anchor = Math.sqrt(CHARACTER_LOD_RANGE_SQ);

  it('emits at full rate in close, then fades to its floor by the anchor', () => {
    expect(legendaryRegaliaEmitScale(0)).toBe(1);
    expect(legendaryRegaliaEmitScale((anchor * 0.4) ** 2)).toBe(1);
    const mid = legendaryRegaliaEmitScale((anchor * 0.7) ** 2);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.4);
    expect(legendaryRegaliaEmitScale(CHARACTER_LOD_RANGE_SQ)).toBeCloseTo(0.4, 5);
  });

  it('never increases as the wearer gets further away', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let d = 0; d <= 200; d += 0.5) {
      const scale = legendaryRegaliaEmitScale(d * d);
      expect(scale).toBeLessThanOrEqual(previous);
      previous = scale;
    }
  });

  it('advances in quantized steps too small to read', () => {
    let previous = legendaryRegaliaEmitScale(0);
    for (let d = 1; d <= 120; d++) {
      const scale = legendaryRegaliaEmitScale(d * d);
      expect(previous - scale).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(Math.round(scale * 20)).toBeCloseTo(scale * 20, 9);
      previous = scale;
    }
  });

  it('holds its floor past the anchor and never reaches zero: a fade, not a cull', () => {
    // Removal belongs to the far-LOD swap and the off-screen presentation
    // skip; the shed may only thin the drift.
    for (const distanceSq of [CHARACTER_LOD_RANGE_SQ, CHARACTER_LOD_RANGE_SQ * 1.001, 400 * 400]) {
      expect(legendaryRegaliaEmitScale(distanceSq)).toBeCloseTo(0.4, 5);
    }
    for (let d = 0; d <= 400; d += 1) {
      expect(legendaryRegaliaEmitScale(d * d)).toBeGreaterThan(0);
    }
  });

  it('keeps a visible emission under the pool quality floor at the shed floor', () => {
    // emitCount scales rates by 0.35 + 0.65 * quality, so the worst case a
    // governor can produce is rate * 0.4 * 0.35: still a spark every few
    // seconds, never a silent removal.
    expect(LEGENDARY_REGALIA_RATE_PER_SEC * 0.4 * 0.35).toBeGreaterThan(0.2);
  });

  it('treats nonsense distance as in close, matching the copied shed arm', () => {
    expect(legendaryRegaliaEmitScale(Number.NaN)).toBe(1);
    expect(legendaryRegaliaEmitScale(-1)).toBe(1);
  });

  it('is sparse: an identity drift, far below the formAura ambients', () => {
    expect(LEGENDARY_REGALIA_RATE_PER_SEC).toBeGreaterThanOrEqual(1);
    expect(LEGENDARY_REGALIA_RATE_PER_SEC).toBeLessThanOrEqual(2);
  });
});

describe('palette lockstep: the one legendary orange', () => {
  it('matches QUALITY_COLOR.legendary and TIERS.legendary.hex exactly', () => {
    expect(QUALITY_COLOR.legendary).toBe('#ff8000');
    expect(LEGENDARY_REGALIA_COLOR).toBe(Number.parseInt(QUALITY_COLOR.legendary.slice(1), 16));
    expect(TIERS.legendary.hex).toBe(QUALITY_COLOR.legendary);
  });

  it('matches the weapon-vfx molten gold (STAR.gold) for the secondary mote', () => {
    expect(LEGENDARY_REGALIA_GOLD).toBe(0xffb347);
    expect(read('src/render/weapon_vfx.ts')).toContain('gold: 0xffb347');
  });
});

describe('legendary regalia graphics fairness (sheddable prestige cosmetic)', () => {
  const CORE = 'src/render/legendary_regalia_core.ts';

  it('the core reads no preset, tier knob, device profile, or FPS governor', () => {
    const source = read(CORE);
    for (const token of [
      'GFX',
      'gfxTier',
      'ui_effects_profile',
      'ui_tier_knobs',
      'render_budget',
      'RenderBudgetGovernor',
      'isMobile',
    ]) {
      expect(source.includes(token), `${CORE} must not read ${token}`).toBe(false);
    }
    // one distance input, no governor or tier parameter
    expect(legendaryRegaliaEmitScale.length).toBe(1);
  });

  it('the core fades against the fixed LOD anchor, never the live crowd band', () => {
    const source = read(CORE);
    expect(source).toContain('CHARACTER_LOD_RANGE_SQ');
    expect(source).not.toMatch(/staticRangeSq|characterLodBands|crowdLodScaleSq|visibleRigs/);
  });

  it('the core reads no actionable or non-wire state', () => {
    // `perfected` is the load-bearing token: offline entity mirrors carry it,
    // the peer wire does not, so one read here forks the treatment per host.
    const source = read(CORE);
    for (const token of [
      'perfected',
      'perfecting',
      'boundTo',
      'charges',
      'hp',
      'auras',
      'casting',
      'cooldown',
      'target',
      'dead',
    ]) {
      expect(new RegExp(`\\b${token}\\b`).test(source), `${CORE} must not read ${token}`).toBe(
        false,
      );
    }
  });

  it('matches the eqi wire allowlist in server/game.ts and reads only rolled', () => {
    // Source-scrape the eqi projection loop (the item_instance_transfer.test.ts
    // cross-pin) so widening the wire without re-judging this predicate reds.
    const game = read('server/game.ts');
    const projected = [...game.matchAll(/pub\.(\w+) = inst\.(\w+);/g)].map((m) => m[1]).sort();
    expect(projected).toEqual(['enchant', 'name', 'rolled', 'signer']);
    const core = read(CORE);
    expect(core).toContain(".rolled?.quality === 'legendary'");
    for (const field of ['signer', 'enchant', 'craftedRecipeId', 'bindOnTrade', 'locked']) {
      expect(new RegExp(`\\b${field}\\b`).test(core), `core must not read ${field}`).toBe(false);
    }
    expect(/\.name\b/.test(core), 'core must not key on the strippable name').toBe(false);
  });

  it('the vfx emitter rides the pooled cloud: no visibility write, no light, no material', () => {
    const vfx = read('src/render/vfx.ts');
    const start = vfx.indexOf('legendaryRegalia(entityId: number, dt: number)');
    expect(start, 'vfx.ts legendaryRegalia emitter missing').toBeGreaterThan(-1);
    const body = vfx.slice(start, vfx.indexOf('\n  }', start));
    expect(body).not.toMatch(/\.visible\s*=/);
    expect(body).not.toMatch(/new THREE\.PointLight/);
    // pooled spawn only: the sole allocation is the hdr color pair
    expect(body).not.toMatch(/new THREE\.(?!Color\b)/);
    expect(body).toContain('this.emitCount(LEGENDARY_REGALIA_RATE_PER_SEC, dt)');
    expect(body).toContain('this.anchor(entityId');
    expect(body).toContain('this.spawn(');
    expect(body).toContain('SPR.sparkBurst');
    expect(body).toContain('SPR.star');
    expect(body).toContain('hdr(');
  });

  it('the renderer wiring is cached, players-only, preset-gated, and shed by d2', () => {
    const renderer = read('src/render/renderer.ts');
    const gateAt = renderer.indexOf(
      "if (e.kind === 'player' && gfxTierAtLeast(GFX.effectsTier, 'medium'))",
    );
    expect(gateAt, 'the emit gate is missing from renderer.ts').toBeGreaterThan(-1);
    const emitAt = renderer.indexOf(
      'this.vfx.legendaryRegalia(e.id, dt * legendaryRegaliaEmitScale(d2));',
    );
    expect(emitAt, 'the shed emit call is missing').toBeGreaterThan(gateAt);
    const slice = renderer.slice(gateAt, emitAt + 80);
    // recomputed ONLY on reference identity change: the predicate call sits
    // inside the ref-diff guard, so the per-frame cost is one pointer compare
    const refGuardAt = slice.indexOf('if (v.legendaryRegaliaRef !== e.equippedInstances)');
    const recomputeAt = slice.indexOf(
      'v.legendaryRegalia = legendaryRegaliaActive(e.equippedInstances);',
    );
    expect(refGuardAt).toBeGreaterThan(-1);
    expect(recomputeAt).toBeGreaterThan(refGuardAt);
    expect(slice).not.toMatch(/Object\.(entries|values|keys)/);
    expect(slice).not.toMatch(/\.visible\s*=/);
    expect(slice).not.toMatch(/new THREE\.PointLight/);
    // the emit rides the same ambient !e.dead block as the form auras (a
    // corpse must not smolder), under runCharacterPresentation
    const deadGuardAt = renderer.lastIndexOf('if (!e.dead) {', gateAt);
    expect(deadGuardAt).toBeGreaterThan(-1);
    expect(renderer.slice(deadGuardAt, gateAt)).toContain('formAura');
    // the cached pair lives on the view
    expect(renderer).toContain('legendaryRegalia?: boolean;');
    expect(renderer).toContain('legendaryRegaliaRef?: unknown;');
  });
});
