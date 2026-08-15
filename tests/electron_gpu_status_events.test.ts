import { describe, expect, it } from 'vitest';
import { gpuStatusPayload } from '../electron/gpu_status_events.cjs';

describe('gpuStatusPayload (renderer-facing whitelist)', () => {
  it('passes only the three whitelisted fields, never the raw GPU inventory', () => {
    expect(
      gpuStatusPayload({
        softwareRendering: false,
        glRenderer: 'ANGLE (NVIDIA GeForce RTX 5090)',
        glVendor: 'Google Inc. (NVIDIA)',
        discreteInactive: true,
        softwareVerdict: false,
        gpuDevice: [{ vendorId: 4318, deviceId: 10035, driverVersion: '580.42' }],
      }),
    ).toEqual({
      softwareRendering: false,
      discreteInactive: true,
      adapter: 'ANGLE (NVIDIA GeForce RTX 5090)',
    });
  });

  it('reports software rendering from EITHER the aux flag or the feature-status verdict', () => {
    const base = { glRenderer: 'llvmpipe', discreteInactive: false };
    expect(gpuStatusPayload({ ...base, softwareRendering: true, softwareVerdict: false })).toEqual({
      softwareRendering: true,
      discreteInactive: false,
      adapter: 'llvmpipe',
    });
    expect(gpuStatusPayload({ ...base, softwareRendering: false, softwareVerdict: true })).toEqual({
      softwareRendering: true,
      discreteInactive: false,
      adapter: 'llvmpipe',
    });
    expect(
      gpuStatusPayload({ ...base, softwareRendering: false, softwareVerdict: false })
        .softwareRendering,
    ).toBe(false);
  });

  it('coerces booleans strictly: a truthy non-true value is NOT a verdict', () => {
    // Chromium's auxAttributes are not a typed contract; a 1 or a 'yes' must not
    // reach the renderer as a warning the player cannot dismiss.
    expect(gpuStatusPayload({ softwareRendering: 1 }).softwareRendering).toBe(false);
    expect(gpuStatusPayload({ softwareRendering: 'yes' }).softwareRendering).toBe(false);
    expect(gpuStatusPayload({ softwareVerdict: 'true' }).softwareRendering).toBe(false);
    expect(gpuStatusPayload({ discreteInactive: 1 }).discreteInactive).toBe(false);
    expect(gpuStatusPayload({ discreteInactive: 'true' }).discreteInactive).toBe(false);
    expect(gpuStatusPayload({ discreteInactive: {} }).discreteInactive).toBe(false);
  });

  it('caps the adapter string at exactly 64 characters', () => {
    const long = 'a'.repeat(65);
    const capped = gpuStatusPayload({ glRenderer: long }).adapter;
    expect(capped.length).toBe(64);
    expect(capped).toBe('a'.repeat(64));
    expect(gpuStatusPayload({ glRenderer: 'b'.repeat(64) }).adapter.length).toBe(64);
    expect(gpuStatusPayload({ glRenderer: 'short' }).adapter).toBe('short');
  });

  it('empties a non-string adapter rather than passing the value through', () => {
    expect(gpuStatusPayload({ glRenderer: 42 }).adapter).toBe('');
    expect(gpuStatusPayload({ glRenderer: null }).adapter).toBe('');
    expect(gpuStatusPayload({ glRenderer: { name: 'x' } }).adapter).toBe('');
    expect(gpuStatusPayload({ glRenderer: ['x'] }).adapter).toBe('');
  });

  it('returns a complete safe payload for missing or garbage input', () => {
    const empty = { softwareRendering: false, discreteInactive: false, adapter: '' };
    expect(gpuStatusPayload(undefined)).toEqual(empty);
    expect(gpuStatusPayload(null)).toEqual(empty);
    expect(gpuStatusPayload({})).toEqual(empty);
    expect(gpuStatusPayload(7)).toEqual(empty);
    expect(gpuStatusPayload('nope')).toEqual(empty);
  });
});
