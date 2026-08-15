// The Thornhollow Fields flag/rune per-frame visual core (src/render/battleground_fx_core.ts):
// the transition classifier that picks celebration bursts, and the carried-lean /
// rune-gem pose math the thin Three consumer (battleground_fx.ts) applies.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BG_CARRY_BACK,
  BG_CARRY_RAISE,
  BG_CARRY_TILT,
  BG_RUNE_BOB_AMP,
  classifyFlagTransition,
  runeGemPose,
} from '../src/render/battleground_fx_core';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('classifyFlagTransition', () => {
  it('maps every state pair to exactly the right burst', () => {
    // First sighting is never a burst: the change was not observed.
    expect(classifyFlagTransition(null, 'home')).toBeNull();
    expect(classifyFlagTransition(null, 'carried')).toBeNull();
    expect(classifyFlagTransition(null, 'dropped')).toBeNull();
    // No-change frames are silent.
    expect(classifyFlagTransition('home', 'home')).toBeNull();
    expect(classifyFlagTransition('carried', 'carried')).toBeNull();
    expect(classifyFlagTransition('dropped', 'dropped')).toBeNull();
    // Into carried: a pickup from the stand or from the ground.
    expect(classifyFlagTransition('home', 'carried')).toBe('pickup');
    expect(classifyFlagTransition('dropped', 'carried')).toBe('pickup');
    // Into home: only a capture ends a carry, only a return ends a drop.
    expect(classifyFlagTransition('carried', 'home')).toBe('capture');
    expect(classifyFlagTransition('dropped', 'home')).toBe('return');
    // A drop plays no burst (the banner + the grounded flag carry the beat).
    expect(classifyFlagTransition('carried', 'dropped')).toBeNull();
    // home -> dropped cannot happen in the sim; the classifier stays silent.
    expect(classifyFlagTransition('home', 'dropped')).toBeNull();
  });
});

describe('pose math', () => {
  it('carried mount: a real tilt and a real back offset, no bob constants', () => {
    // A real lean, but a SHALLOW one: past roughly 25 degrees the standard
    // reads as a pike carried across the body rather than slung over a
    // shoulder, which is what the first pass at 0.6 looked like.
    expect(BG_CARRY_TILT).toBeGreaterThan(0.15);
    expect(BG_CARRY_TILT).toBeLessThan(0.45);
    expect(BG_CARRY_BACK).toBeGreaterThan(0);
    // Lifted enough that a full-length pole's butt clears the ground.
    expect(BG_CARRY_RAISE).toBeGreaterThan(0.3);
  });

  it('rune gem: spin advances monotonically, hover stays bounded', () => {
    let prevSpin = Number.NEGATIVE_INFINITY;
    for (const t of [0, 0.5, 1, 2, 5, 30]) {
      const pose = runeGemPose(t);
      expect(pose.spin).toBeGreaterThan(prevSpin);
      prevSpin = pose.spin;
      expect(Math.abs(pose.bob)).toBeLessThanOrEqual(BG_RUNE_BOB_AMP + 1e-9);
    }
  });
});

// The pose math above is only ever seen if the per-frame consumer can FIND the
// handles it drives. battleground_props.ts writes them to `userData.bg` on the
// body it builds; battleground_fx.ts reads them off `view.group.userData.bg`;
// and Renderer.createView puts that body inside a wrapper group of its own and
// registers the WRAPPER as view.group. So the renderer has to hoist the refs
// across that one level, and when it did not, every rune and flag silently
// skipped its whole animation, no spin, no bob, no light pulse, no shard
// orbit, no carrier ring, while looking perfectly correct on screen because
// the pads' other effects are GPU-driven off the shared clock and kept moving.
//
// The seam lives inside Renderer, which a unit test cannot construct, so this
// pins it at the source. It is deliberately narrow: it asserts only that the
// battleground branch assigns userData.bg onto the view group.
describe('the renderer hoists the fx handles onto the view group', () => {
  it('assigns userData.bg in the bg_ object branch', () => {
    const src = readFileSync(join(repoRoot, 'src/render/renderer.ts'), 'utf8');
    const branch = src.indexOf("e.templateId?.startsWith('bg_')");
    expect(branch, 'the bg_ object branch moved; re-point this test').toBeGreaterThan(0);
    // Look only inside that branch, up to the next `} else if`.
    const end = src.indexOf('} else if', branch);
    const body = src.slice(branch, end > 0 ? end : branch + 2000);
    expect(
      /group\.userData\.bg\s*=/.test(body),
      'Renderer.createView must hoist built.group.userData.bg onto the view group, ' +
        'or battleground_fx.ts finds nothing and every rune and flag stops animating',
    ).toBe(true);
  });

  it('still reads those handles off the view group in the fx pass', () => {
    const fx = readFileSync(join(repoRoot, 'src/render/battleground_fx.ts'), 'utf8');
    expect(fx).toContain('view.group.userData.bg');
  });
});
