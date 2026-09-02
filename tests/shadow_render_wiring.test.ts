import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-scan guard for the renderer WIRING of the shadow features whose
// logic lives in pure cores (shadow_texel_snap_core.ts, shadow_cadence_core.ts,
// shadow_extent_core.ts).
// The cores are Node-tested directly; renderer.ts is not Node-testable, and
// each pin below is a single, quietly reversible line whose regression every
// core test would survive. Scans are anchored to exported symbols and call
// shapes, not line numbers.
const rendererSource = readFileSync(
  path.join(__dirname, '..', 'src', 'render', 'renderer.ts'),
  'utf8',
);

function methodBody(search: string): string {
  const start = rendererSource.indexOf(search);
  expect(start, `renderer.ts should still define ${search}`).toBeGreaterThan(-1);
  // Slice far past any body in play; the assertions below only need
  // "appears inside this method, not elsewhere".
  return rendererSource.slice(start, start + 4000);
}

describe('shadow feature renderer wiring', () => {
  it('feeds the foliage shadow volume the SNAPPED anchor, never the raw player position', () => {
    // The volume culls casters against the shadow camera's ortho box; if it
    // reverts to the raw `pp` it silently desynchronizes from the snapped
    // frustum while every pure-core test stays green.
    expect(rendererSource).toContain(
      'setFoliageShadowVolume(this.lightDir, anchor, this.sun.shadow.camera, SUN_TRAVEL_DISTANCE)',
    );
    expect(rendererSource).not.toMatch(/setFoliageShadowVolume\(this\.lightDir,\s*pp[,)]/);
  });

  it('snaps the anchor in updateKeyLight and aims the sun target at it', () => {
    const body = methodBody('private updateKeyLight(');
    expect(body).toContain('snapShadowAnchor(');
    expect(body).toContain('this.sun.target.position.set(anchor.x, anchor.y, anchor.z)');
    // The raw-position write must not survive anywhere in the method.
    expect(body).not.toContain('this.sun.target.position.set(pp.x, pp.y, pp.z)');
  });

  it('derives the texel size from the LIVE ortho extent and the REAL clamped map size', () => {
    expect(rendererSource).toContain(
      'this.shadowMapTexels = Math.min(GFX.shadowMap, this.webgl.capabilities.maxTextureSize)',
    );
    // The ortho extent argument is the same live `extent` that sizes the
    // camera box in the very same block, never the unshrunk base: a snap
    // quantized to a stale grid loses the anti-swimming property outright.
    const shed = methodBody('private applyShadowShed');
    expect(shed).toContain(
      'this.shadowTexelWorld = shadowTexelWorldSize(2 * extent, this.shadowMapTexels)',
    );
    expect(shed).not.toMatch(/shadowTexelWorldSize\(\s*2 \* this\.shadowBaseExtent/);
  });

  it('writes the live ortho box from the base times the governor shed scale', () => {
    const shed = methodBody('private applyShadowShed');
    expect(shed).toContain('const extent = this.shadowBaseExtent * this.shadowExtent.scale');
    // All four planes and the projection matrix, or the box three culls
    // against and the box every consumer reads would disagree.
    for (const write of [
      'cam.left = -extent;',
      'cam.right = extent;',
      'cam.top = extent;',
      'cam.bottom = -extent;',
      'cam.updateProjectionMatrix();',
    ]) {
      expect(shed).toContain(write);
    }
    // The base is never written onto the camera directly: that would pin the
    // box at full extent and make the shed a no-op.
    expect(rendererSource).not.toMatch(
      /camera\.(top|left|right|bottom) = [-]?this\.shadowBaseExtent/,
    );
    // The live consumer reads the CAMERA, so it follows the shed for free; a
    // copy of the base here would silently desynchronize it.
    expect(rendererSource).toContain(
      'setFoliageShadowVolume(this.lightDir, anchor, this.sun.shadow.camera, SUN_TRAVEL_DISTANCE)',
    );
  });

  it('applies the extent shed before the sun is first used, and resets it with the governor', () => {
    // The constructor write: without it the camera keeps three's default
    // ortho box until the first governor frame.
    expect(rendererSource).toContain('this.sun = sun;\n    this.applyShadowShed();');
    expect(rendererSource).toContain(
      'updateShadowExtent(this.shadowExtent, dt, state.pressure, state.enabled)',
    );
    const setScale = methodBody('setRenderScale(scale: number)');
    expect(setScale).toContain('resetShadowExtent(this.shadowExtent)');
  });

  it('keeps both shadow cores dependency-free (preset, tier, and host blind)', () => {
    // The fairness judgment rests on the cadence reading ONLY the governor's
    // pressure/enabled plus dt, and the snap reading only geometry: neither
    // core may import anything (no GFX, no profile, no three, no DOM).
    for (const core of [
      'shadow_cadence_core.ts',
      'shadow_extent_core.ts',
      'shadow_texel_snap_core.ts',
    ]) {
      const source = readFileSync(path.join(__dirname, '..', 'src', 'render', core), 'utf8');
      expect(source, `${core} must import nothing`).not.toMatch(/^import /m);
    }
  });

  it('applies the cadence plan each frame and resets it with the governor', () => {
    // The per-frame path: governor update, then cadence update, then the flag
    // application (which is what makes the prewarm/census save-restore
    // self-healing).
    expect(rendererSource).toContain(
      'updateShadowCadence(this.shadowCadence, dt, state.pressure, state.enabled)',
    );
    const apply = methodBody('private applyShadowShed');
    expect(apply).toContain('const autoUpdate = !this.shadowCadence.halfRate');
    expect(apply).toContain(
      'if (!autoUpdate && this.shadowCadence.renderThisFrame) shadowMap.needsUpdate = true',
    );
    // The shed writes ONLY the two shadowMap flags and the ortho box: never a
    // caster's visibility or castShadow (that would be a removal, not a shed).
    const applyBody = apply.slice(0, apply.indexOf('\n  }'));
    expect(applyBody).not.toMatch(/\.visible\s*=/);
    expect(applyBody).not.toMatch(/\.castShadow\s*=/);
    // setRenderScale resets the whole governor; the cadence resets with it.
    const setScale = methodBody('setRenderScale(scale: number)');
    expect(setScale).toContain('resetShadowCadence(this.shadowCadence)');
    expect(setScale).toContain('this.applyShadowShed()');
  });
});
