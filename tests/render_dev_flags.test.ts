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
