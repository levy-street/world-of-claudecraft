// Source pin for the Duskfall Passage gate meshes (src/render/hollow_gates.ts):
// the two cave-mouth models are wide enough that an arriving player's own
// camera can render embedded in their unfaded rock (issue: "stuck in the
// ground" after using the Duskfall portal), so they must consume the same
// occluder-fade family every other large static prop uses. `buildHollowGates`
// itself can't be driven headless (its GLB scenes load only via the deferred
// preload lane), so this mirrors battleground_render.test.ts's minimum bar: a
// source-scan pinning the consumption and the renderer wiring, so a future
// edit cannot silently drop either.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('hollow_gates occluder-fade wiring (source pin)', () => {
  it('consumes the shared occluder-fade core, not a bespoke fade', () => {
    const src = readFileSync(`${ROOT}src/render/hollow_gates.ts`, 'utf8');
    expect(src).toContain("from './occluder_fade_core'");
    expect(src).toContain('occluderSegmentHitsObb(');
    expect(src).toContain('occluderFadeSettled(');
    expect(src).toContain('stepOccluderFade(');
    expect(src).toContain("from './occluder_fade'");
    expect(src).toContain('applyOccluderFade(');
    expect(src).toContain('occluderFadeMat(');
    // The hook-preserving clone, so a ghosted gate keeps its opaque program
    // and doesn't link a fresh one the first time a portal arrival crosses it.
    expect(src).toContain('cloneMaterialWithHooks(');
  });

  it('the renderer drives HollowGatesView.update with the live camera pose every frame', () => {
    const renderer = readFileSync(`${ROOT}src/render/renderer.ts`, 'utf8');
    const start = renderer.indexOf('this.hollowGates.update(');
    expect(start, 'the renderer never drives the hollow-gate fade').toBeGreaterThan(-1);
    const call = renderer.slice(start, renderer.indexOf(');', start));
    expect(call).toContain('camX');
    expect(call).toContain('camY');
    expect(call).toContain('camZ');
    expect(call).toContain('eyeX');
    expect(call).toContain('eyeY');
    expect(call).toContain('eyeZ');
    expect(call).toContain('this.reducedMotion()');
  });
});
