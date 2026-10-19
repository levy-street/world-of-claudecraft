// Thatchbound's visual plan (src/render/thatchbound_fx_core.ts): the eyes sit at the
// puppet's head facing forward, the swirl wraps its body and never rises over its head
// (owner note 2026-10-18: no marionette strings, no control bar above the puppet), the
// read never fades while it is held, and the ids match the sim's.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as core from '../src/render/thatchbound_fx_core';
import {
  CROW_PUPPET_AURA,
  castGrow,
  eyeSize,
  PUPPET_ABILITY,
  PUPPET_AURA_IDS,
  puppetBody,
  puppetEyes,
  STRAWLING_PUPPET_AURA,
  SWIRL_TOP,
  shockwave,
  sigilState,
  swirlPoint,
  swirlRate,
} from '../src/render/thatchbound_fx_core';
import {
  THATCHBOUND_AURA_IDS,
  THATCHGRIN_PUPPET_ABILITY,
} from '../src/sim/content/gourdlight_eve_scarecrow';

describe('thatchbound fx core', () => {
  it('names the same ids and cue the sim emits', () => {
    expect([...PUPPET_AURA_IDS].sort()).toEqual([...THATCHBOUND_AURA_IDS].sort());
    expect(PUPPET_ABILITY).toBe(THATCHGRIN_PUPPET_ABILITY);
  });

  it('hangs nothing above the puppet: no strings, no control bar', () => {
    const exported = Object.keys(core);
    for (const gone of ['puppetStrings', 'puppetBars', 'barSway', 'BAR_HEIGHT', 'stringGlow'])
      expect(exported, gone).not.toContain(gone);
    // the painter owns no string or bar pool either
    const painter = readFileSync('src/render/thatchbound_fx.ts', 'utf8');
    expect(painter).not.toMatch(/thatchbound-strings|CylinderGeometry|puppetStrings|puppetBars/);
    // the swirl wraps the body up to the shoulders, both bands, never over the head
    const pos = { x: 10, y: 2, z: -4 };
    for (const id of [STRAWLING_PUPPET_AURA, CROW_PUPPET_AURA]) {
      const head = puppetBody(id).head;
      expect(SWIRL_TOP + 0.15).toBeLessThanOrEqual(head + 0.35);
      for (const spin of [1, -1]) {
        for (let k = 0; k < 200; k++) {
          const p = swirlPoint(pos, k * 0.13, k, spin);
          expect(p.y).toBeGreaterThanOrEqual(pos.y);
          expect(p.y).toBeLessThanOrEqual(pos.y + SWIRL_TOP + 0.15 + 1e-9);
          expect(Math.hypot(p.x - pos.x, p.z - pos.z)).toBeLessThan(1.3);
        }
      }
    }
  });

  it('puts the eyes in front of the head, a hand apart', () => {
    const pos = { x: 0, y: 0, z: 0 };
    const body = puppetBody(STRAWLING_PUPPET_AURA);
    const [a, b] = puppetEyes(pos, 0, body);
    // facing 0 looks along +z
    expect(a.z).toBeGreaterThan(0);
    expect(b.z).toBeGreaterThan(0);
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(0.1);
    expect(a.y).toBeCloseTo(body.head - 0.05, 9);
    expect(eyeSize(1, 0)).toBeGreaterThan(0.1);
  });

  it('never fades the read while held; only the swirl thins under reduced motion', () => {
    for (let t = 0.3; t < 10; t += 0.7) expect(sigilState(t, 0.4).glow).toBeGreaterThan(0.5);
    expect(swirlRate(true)).toBeGreaterThan(0);
    expect(swirlRate(true)).toBeLessThan(swirlRate(false));
    // denser than the old 26 a second, now that it carries the curse's weight alone
    expect(swirlRate(false)).toBeGreaterThanOrEqual(40);
  });

  it('grows the cast sigil over the cast and rolls the shockwave out and away', () => {
    expect(castGrow(0, 2.5)).toBe(0);
    expect(castGrow(1.25, 2.5)).toBeGreaterThan(0.5);
    expect(castGrow(2.5, 2.5)).toBe(1);
    expect(shockwave(0).glow).toBe(1);
    expect(shockwave(10).glow).toBe(0);
    expect(shockwave(0.8).radius).toBeGreaterThan(shockwave(0.1).radius);
  });
});
