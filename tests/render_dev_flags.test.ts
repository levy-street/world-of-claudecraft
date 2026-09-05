import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

// render_dev_flags reads location ONCE at module load (layer gating is
// build/compile-time), so every case re-imports the module behind a stubbed
// location rather than mutating a live flag.
async function loadFlags(search: string | null) {
  vi.resetModules();
  if (search === null) vi.stubGlobal('location', undefined);
  else vi.stubGlobal('location', { search });
  return import('../src/render/render_dev_flags');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('render dev flags: layer kill switches', () => {
  it('disables exactly the layers named with =off', async () => {
    const { renderLayerDisabled } = await loadFlags('?n8ao=off&zonehaze=off');
    expect(renderLayerDisabled('n8ao')).toBe(true);
    expect(renderLayerDisabled('zonehaze')).toBe(true);
    expect(renderLayerDisabled('bladegrass')).toBe(false);
  });

  it('ignores a flag whose value is not the off token', async () => {
    const { renderLayerDisabled } = await loadFlags('?n8ao=1&bladegrass=');
    expect(renderLayerDisabled('n8ao')).toBe(false);
    expect(renderLayerDisabled('bladegrass')).toBe(false);
  });

  it('keeps every layer on in a headless host with no location', async () => {
    const { renderLayerDisabled } = await loadFlags(null);
    expect(renderLayerDisabled('n8ao')).toBe(false);
  });
});

describe('render dev flags: the character cull A/B arm', () => {
  // ?charcull=off has to restore the WHOLE pre-cull submission, not just the
  // renderer's group cull: a skinned caster that keeps three's frustum test on
  // its padded sphere is still culled, and the A/B arm would measure nothing.
  function skinnedRig() {
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    root.add(mesh);
    return { root, mesh };
  }

  it('names the flag the renderer and the caster bounds both read', async () => {
    const { renderLayerDisabled } = await loadFlags('?charcull=off');
    expect(renderLayerDisabled('charcull')).toBe(true);
  });

  it("leaves a skinned caster exempt from three's frustum test under ?charcull=off", async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '?charcull=off' });
    const { applySkinnedCullBounds } = await import('../src/render/characters/skinned_cull_bounds');
    const { root, mesh } = skinnedRig();
    applySkinnedCullBounds(mesh, root, 1.8);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.boundingSphere).toBeNull();
  });

  it('pads the sphere and lets three cull by default', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '' });
    const { applySkinnedCullBounds } = await import('../src/render/characters/skinned_cull_bounds');
    const { root, mesh } = skinnedRig();
    applySkinnedCullBounds(mesh, root, 1.8);
    expect(mesh.frustumCulled).toBe(true);
    expect(mesh.boundingSphere?.radius).toBeGreaterThan(0);
  });
});

describe('render dev flags: the GPU-preparation mode switch', () => {
  it('runs the adaptive scheduler by default', async () => {
    const { gpuPrepMode } = await loadFlags('');
    expect(gpuPrepMode()).toBe('adaptive');
  });

  it('selects legacy under ?prep=legacy', async () => {
    const { gpuPrepMode } = await loadFlags('?prep=legacy');
    expect(gpuPrepMode()).toBe('legacy');
  });

  it('stays adaptive for any other prep value, so a typo cannot silently roll back', async () => {
    for (const search of ['?prep=', '?prep=adaptive', '?prep=off', '?prep=LEGACY', '?legacy=1']) {
      const { gpuPrepMode } = await loadFlags(search);
      expect(gpuPrepMode(), search).toBe('adaptive');
    }
  });

  it('is adaptive in a headless host with no location', async () => {
    const { gpuPrepMode } = await loadFlags(null);
    expect(gpuPrepMode()).toBe('adaptive');
  });

  it('is independent of the =off layer switches', async () => {
    // ?prep=legacy is a MODE, not a layer: it must not read as a disabled
    // layer, and a disabled layer must not flip the mode.
    const { gpuPrepMode, renderLayerDisabled } = await loadFlags('?prep=legacy&n8ao=off');
    expect(gpuPrepMode()).toBe('legacy');
    expect(renderLayerDisabled('prep')).toBe(false);
    expect(renderLayerDisabled('n8ao')).toBe(true);
  });
});

describe('render dev flags: the blade-grass sector split', () => {
  it('splits four ways per axis by default', async () => {
    const { bladeSectorAxis, BLADE_SECTOR_AXIS_DEFAULT } = await loadFlags('');
    expect(BLADE_SECTOR_AXIS_DEFAULT).toBe(4);
    expect(bladeSectorAxis()).toBe(4);
  });

  it('restores the single uncullable mesh per pool at ?bladesectors=1', async () => {
    const { bladeSectorAxis } = await loadFlags('?bladesectors=1');
    expect(bladeSectorAxis()).toBe(1);
  });

  it('takes any other A/B arm the flag names, bounded', async () => {
    for (const [search, axis] of [
      ['?bladesectors=2', 2],
      ['?bladesectors=6', 6],
      ['?bladesectors=99', 16],
    ] as const) {
      const { bladeSectorAxis } = await loadFlags(search);
      expect(bladeSectorAxis(), search).toBe(axis);
    }
  });

  it('falls back to the default for a missing, empty or nonsense value', async () => {
    for (const search of ['', '?bladesectors=', '?bladesectors=off', '?bladesectors=0', null]) {
      const { bladeSectorAxis } = await loadFlags(search);
      expect(bladeSectorAxis(), String(search)).toBe(4);
    }
  });
});
