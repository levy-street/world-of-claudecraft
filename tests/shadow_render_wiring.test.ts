import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-scan guard for the renderer WIRING of the two shadow features whose
// logic lives in pure cores (shadow_texel_snap_core.ts, shadow_cadence_core.ts).
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

  it('derives the texel size from the same ortho extent and the REAL clamped map size', () => {
    expect(rendererSource).toContain('this.shadowTexelWorld = shadowTexelWorldSize(');
    expect(rendererSource).toContain(
      'Math.min(GFX.shadowMap, this.webgl.capabilities.maxTextureSize)',
    );
    // The ortho extent argument is the same `2 * S` that sizes the camera box.
    expect(rendererSource).toMatch(
      /shadowTexelWorldSize\(\s*2 \* S,\s*Math\.min\(GFX\.shadowMap, this\.webgl\.capabilities\.maxTextureSize\),?\s*\)/,
    );
  });

  it('keeps both shadow cores dependency-free (preset, tier, and host blind)', () => {
    // The fairness judgment rests on the cadence reading ONLY the governor's
    // pressure/enabled plus dt, and the snap reading only geometry: neither
    // core may import anything (no GFX, no profile, no three, no DOM).
    for (const core of ['shadow_cadence_core.ts', 'shadow_texel_snap_core.ts']) {
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
    const apply = methodBody('private applyShadowCadence');
    expect(apply).toContain('const autoUpdate = !this.shadowCadence.halfRate');
    expect(apply).toContain(
      'if (!autoUpdate && this.shadowCadence.renderThisFrame) shadowMap.needsUpdate = true',
    );
    // The shed writes ONLY the two shadowMap flags: never a caster's
    // visibility or castShadow (that would be a removal, not a cadence).
    const applyBody = apply.slice(0, apply.indexOf('\n  }'));
    expect(applyBody).not.toMatch(/\.visible\s*=/);
    expect(applyBody).not.toMatch(/\.castShadow\s*=/);
    // setRenderScale resets the whole governor; the cadence resets with it.
    const setScale = methodBody('setRenderScale(scale: number)');
    expect(setScale).toContain('resetShadowCadence(this.shadowCadence)');
    expect(setScale).toContain('this.applyShadowCadence()');
  });
});
