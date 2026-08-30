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
import { stripComments } from './helpers/strip_comments';
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
// Through the shared order-safe helper (the block-first two-pass shape this
// used to hand-roll opens a false block on a bare /* inside a line comment).
const read = (rel: string): string =>
  stripComments(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));

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
    // Removal belongs to the entity-loop hysteresis cull
    // (characterViewOutsideHysteresis) and the off-screen presentation skip;
    // the shed may only thin the drift. (The far-LOD swap does not stop this
    // emitter: the motes are world-space pooled particles, not rig children.)
    for (const distanceSq of [CHARACTER_LOD_RANGE_SQ, CHARACTER_LOD_RANGE_SQ * 1.001, 400 * 400]) {
      expect(legendaryRegaliaEmitScale(distanceSq)).toBeCloseTo(0.4, 5);
    }
    for (let d = 0; d <= 400; d += 1) {
      expect(legendaryRegaliaEmitScale(d * d)).toBeGreaterThan(0);
    }
  });

  it('keeps a visible emission under the pool quality floor at the shed floor', () => {
    // emitCount scales rates by floor + span * quality; the floor is SCRAPED
    // from vfx.ts and then PINNED to 0.35 below, so the scrape's job is
    // anchoring (proving the pinned value really is emitCount's own floor,
    // not a sibling's): a legitimate retune of the emitCount floor is
    // EXPECTED to red this line and be re-judged by hand, not silently
    // re-priced (the Phase 16 QA trued this comment; the pin itself is the
    // fix round's deliberate anchored-scrape shape).
    // Worst case must stay a spark every few seconds, never a silent removal.
    // Anchor the scrape INSIDE emitCount's body: scaledCount above it carries
    // its own floor + span * quality expression with a DIFFERENT floor, and an
    // unanchored match reads that one first (the fix-round reader proved it).
    const vfxSource = read('src/render/vfx.ts');
    const emitCountAt = vfxSource.indexOf('private emitCount(');
    expect(emitCountAt, 'emitCount is missing from vfx.ts').toBeGreaterThan(-1);
    const m = vfxSource.slice(emitCountAt).match(/([\d.]+) \+ ([\d.]+) \* this\.quality/);
    expect(m, 'the emitCount quality-floor expression is missing from vfx.ts').not.toBeNull();
    const poolFloor = Number((m as RegExpMatchArray)[1]);
    expect(poolFloor, 'the scrape must land on the 0.35 emit floor, not a sibling').toBe(0.35);
    expect(poolFloor).toBeGreaterThan(0);
    const shedFloor = legendaryRegaliaEmitScale(CHARACTER_LOD_RANGE_SQ);
    expect(LEGENDARY_REGALIA_RATE_PER_SEC * shedFloor * poolFloor).toBeGreaterThan(0.2);
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
    const assigns = [...game.matchAll(/pub\.(\w+) = inst\.(\w+);/g)];
    // no cross-wire: every projected field copies from ITS OWN source field
    for (const m of assigns) expect(m[2], `cross-wired eqi projection: ${m[0]}`).toBe(m[1]);
    const projected = assigns.map((m) => m[1]).sort();
    expect(projected).toEqual(['enchant', 'name', 'rolled', 'signer']);
    // The pub block itself carries exactly the four assignment-shaped writes
    // and no spread, so a widened wire SHAPE (a spread, a conditional copy in
    // another form) reds this alarm instead of slipping past the scrape above.
    const pubAt = game.indexOf('let eqi: Record<string, unknown> | undefined;');
    expect(pubAt, 'the eqi projection block is missing').toBeGreaterThan(-1);
    const pubEnd = game.indexOf('if (eqi) out.eqi = eqi;', pubAt);
    expect(pubEnd).toBeGreaterThan(pubAt);
    const pubBlock = game.slice(pubAt, pubEnd);
    expect([...pubBlock.matchAll(/pub\.(\w+) = inst\.(\w+);/g)]).toHaveLength(4);
    expect(pubBlock.match(/\bpub\.\w+\s*=/g) ?? []).toHaveLength(4);
    expect(pubBlock).not.toContain('...');
    // ... and none of the KNOWN non-dotted write shapes either (the Phase 16
    // QA): Object.assign, Reflect writes, defineProperty, a cast that opens
    // computed keys ('pub as'), or a direct pub[...] index all evade the
    // 4-count and spread bans above. A blocklist, not completeness: a wholly
    // novel write shape is the reviewer's to catch, and the dotted 4-count
    // stays the positive arm.
    expect(pubBlock).not.toMatch(/Object\.assign|Reflect\.|defineProperty|\bpub\s+as\b|pub\[/);
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
    // allocation-free emit: the color pair rides the composer-keyed module
    // cache (the projectileSchoolColors shape), so the body allocates nothing
    expect(body).not.toMatch(/new THREE\./);
    expect(body).toContain('legendaryRegaliaColors()');
    expect(body).toContain('this.emitCount(LEGENDARY_REGALIA_RATE_PER_SEC, dt)');
    expect(body).toContain('this.anchor(entityId');
    expect(body).toContain('this.spawn(');
    expect(body).toContain('SPR.sparkBurst');
    expect(body).toContain('SPR.star');
    // the cache still applies the HDR multipliers, keyed on GFX.composer so a
    // tier flip rebuilds the pair rather than serving stale non-HDR colors
    const cacheAt = vfx.indexOf('function legendaryRegaliaColors()');
    expect(cacheAt, 'the regalia color cache is missing').toBeGreaterThan(-1);
    const cacheBody = vfx.slice(cacheAt, vfx.indexOf('\n}', cacheAt));
    expect(cacheBody).toContain('GFX.composer');
    expect(cacheBody).toContain('multiplyScalar(hdr(');
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
    // inside the ref-diff guard, so the per-frame cost is one pointer compare.
    // NESTING, not source order (the Phase 16 QA): an unconditional recompute
    // moved BELOW the guard would still satisfy an index comparison, so walk
    // the guard's braces and require the recompute inside its span.
    const refGuardAt = slice.indexOf('if (v.legendaryRegaliaRef !== e.equippedInstances)');
    const recomputeAt = slice.indexOf(
      'v.legendaryRegalia = legendaryRegaliaActive(e.equippedInstances);',
    );
    expect(refGuardAt).toBeGreaterThan(-1);
    expect(recomputeAt).toBeGreaterThan(refGuardAt);
    const guardOpenAt = slice.indexOf('{', refGuardAt);
    let guardDepth = 0;
    let guardCloseAt = -1;
    for (let i = guardOpenAt; i < slice.length; i++) {
      if (slice[i] === '{') guardDepth++;
      else if (slice[i] === '}') {
        guardDepth--;
        if (guardDepth === 0) {
          guardCloseAt = i;
          break;
        }
      }
    }
    expect(guardCloseAt, 'the ref-diff guard block never closes').toBeGreaterThan(guardOpenAt);
    expect(
      recomputeAt > guardOpenAt && recomputeAt < guardCloseAt,
      'the predicate recompute must sit INSIDE the ref-diff guard braces',
    ).toBe(true);
    // ... and exactly ONCE: indexOf finds only the first occurrence, so a
    // second unconditional recompute duplicated below the guard would pass a
    // first-occurrence check while defeating the one-pointer-compare claim.
    expect(
      slice.split('v.legendaryRegalia = legendaryRegaliaActive(e.equippedInstances);'),
      'the recompute must appear exactly once in the wiring slice',
    ).toHaveLength(2);
    // the emit is suppressed for a reduced-motion viewer (the lich-aura
    // precedent; an accessibility choice by the viewer, never a graphics shed;
    // the fairness doc's regalia bullet names this arm)
    expect(slice).toContain('if (v.legendaryRegalia && !this.reducedMotion())');
    expect(slice).not.toMatch(/Object\.(entries|values|keys)/);
    expect(slice).not.toMatch(/\.visible\s*=/);
    expect(slice).not.toMatch(/new THREE\.PointLight/);
    // no actionable or host-forking read may enter the wiring slice either
    // (the core's own token ban only covers legendary_regalia_core.ts): a
    // condition inserted here gating the glow on hp, target, casting, aura,
    // or Perfecting state, or re-tying it to the live governor, must red this
    // scan. reducedMotion is the one sanctioned extra read (above).
    // Prefix forms, not whole-word, wherever the live identifiers are
    // camelCase compounds: \btarget\b never matches targetId (the entity's
    // real field), \bcasting\b never matches castingAbility (the spelling
    // a few dozen lines above the gate), and \bgovernor\b matches none of
    // renderBudgetGovernor/autoGovernor.
    for (const banned of [
      /\bperfected\b/,
      /\bperfecting\b/,
      /\bhpFrac\b/,
      /\bhp\b/,
      /\bmaxHp\b/,
      /\btarget\w*/,
      /\bauras\b/,
      /\bcasting\w*/,
      /\bappliedBudgetLevels\b/,
      /governor/i,
      /renderBudget/i,
      /graphicsBucket/i,
    ]) {
      expect(banned.test(slice), `wiring slice must not read ${banned}`).toBe(false);
    }
    // the emit rides the same ambient !e.dead block as the form auras (a
    // corpse must not smolder), under runCharacterPresentation. NESTING, not
    // source order: walk brace depth from the dead guard's open brace to its
    // MATCHING close, and require the whole regalia gate INSIDE that span, so
    // a regalia block moved past the guard's closing brace fails here.
    const deadGuardAt = renderer.lastIndexOf('if (!e.dead) {', gateAt);
    expect(deadGuardAt).toBeGreaterThan(-1);
    const openAt = renderer.indexOf('{', deadGuardAt + 'if (!e.dead)'.length);
    let depth = 0;
    let closeAt = -1;
    for (let i = openAt; i < renderer.length; i++) {
      if (renderer[i] === '{') depth++;
      else if (renderer[i] === '}') {
        depth--;
        if (depth === 0) {
          closeAt = i;
          break;
        }
      }
    }
    expect(closeAt, 'the dead-guard block never closes').toBeGreaterThan(openAt);
    const deadBlock = renderer.slice(openAt, closeAt);
    expect(deadBlock).toContain('formAura');
    // No condition may be WRAPPED around the regalia gate either: the span
    // from the dead-guard open to the gate carries exactly the form-aura
    // chain's four ifs, so an inserted gating wrapper (one line above the
    // pinned gate, outside the banned-token slice) raises this count and is
    // re-judged by hand.
    expect(
      renderer.slice(openAt, gateAt).match(/if \(/g) ?? [],
      'an unexpected condition sits between the dead guard and the regalia gate',
    ).toHaveLength(4);
    expect(gateAt, 'the regalia gate must open inside the dead guard').toBeGreaterThan(openAt);
    expect(emitAt, 'the regalia emit must land inside the dead guard').toBeLessThan(closeAt);
    // the cached pair lives on the view
    expect(renderer).toContain('legendaryRegalia?: boolean;');
    expect(renderer).toContain('legendaryRegaliaRef?: unknown;');
  });
});
