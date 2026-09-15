// The shader warm worker's beacon block (src/game/perf_shader_warm_core.ts):
// the bounded projection of the client's snapshot that rides the perf beacon.
// Every field is bounded here rather than at the reporter, so a snapshot that
// grew a long token or a nonsense count cannot ship one.

import { describe, expect, it } from 'vitest';
import {
  SHADER_WARM_BEACON_TEXT_MAX,
  type ShaderWarmBeaconInput,
  shaderWarmBeaconSummary,
} from '../src/game/perf_shader_warm_core';

const READY: ShaderWarmBeaconInput = {
  worker: 'ready',
  refusal: null,
  mode: 'all',
  setting: 'auto',
  backend: 'd3d11',
  warmed: 12,
  held: 5,
  heldTimedOut: 1,
  holdMs: 5_400,
  holdWallMs: 1_900,
  releases: 1,
  abArm: 'on',
};

describe('the shader warm beacon block', () => {
  it('passes a healthy block through whole, and reads the worker active', () => {
    expect(shaderWarmBeaconSummary(READY)).toEqual({ ...READY, active: true });
  });

  it('reads active off the WORKER state, never the mode or the setting', () => {
    // A session whose worker was retired at second four still carries mode
    // `all`: reading the setting as if it were the worker is what would make
    // the fleet numbers say the opposite of the truth.
    for (const worker of ['idle', 'starting', 'failed', 'retired']) {
      expect(shaderWarmBeaconSummary({ ...READY, worker }).active).toBe(false);
    }
    expect(shaderWarmBeaconSummary({ ...READY, worker: 'ready' }).active).toBe(true);
  });

  it('cuts an over-long token at the bound the server accepts', () => {
    const long = 'x'.repeat(SHADER_WARM_BEACON_TEXT_MAX + 40);
    const cut = shaderWarmBeaconSummary({
      ...READY,
      worker: long,
      refusal: long,
      mode: long,
      setting: long,
      backend: long,
    });
    for (const value of [cut.worker, cut.refusal, cut.mode, cut.setting, cut.backend]) {
      expect(value).toBe('x'.repeat(SHADER_WARM_BEACON_TEXT_MAX));
    }
    // The longest refusal the client really mints reaches the fleet whole.
    const drift = 'extension-drift:webgl_compressed_texture_s3tc_srgb';
    expect(drift.length).toBeLessThanOrEqual(SHADER_WARM_BEACON_TEXT_MAX);
    expect(shaderWarmBeaconSummary({ ...READY, refusal: drift }).refusal).toBe(drift);
  });

  it('keeps a null refusal and a null backend null rather than minting a token', () => {
    // Null is the honest reading (nothing refused it, the backend is not known
    // yet); an empty string would read as a token the fleet cannot group by.
    const summary = shaderWarmBeaconSummary({ ...READY, refusal: null, backend: null });
    expect(summary.refusal).toBeNull();
    expect(summary.backend).toBeNull();
  });

  it('floors a NaN, an infinite or a negative count at zero, and truncates a fraction', () => {
    const summary = shaderWarmBeaconSummary({
      ...READY,
      warmed: Number.NaN,
      held: -7,
      heldTimedOut: 3.9,
    });
    expect(summary).toMatchObject({ warmed: 0, held: 0, heldTimedOut: 3 });
    expect(shaderWarmBeaconSummary({ ...READY, warmed: Number.POSITIVE_INFINITY }).warmed).toBe(0);
  });

  it('ships the A/B cost fields: hold time summed and on the wall, releases, the arm', () => {
    // The checkpoint weighs the hold's wall time against the long tasks the
    // worker saves; the sum counts simultaneous holds once each, so both ride.
    expect(shaderWarmBeaconSummary(READY)).toMatchObject({
      holdMs: 5_400,
      holdWallMs: 1_900,
      releases: 1,
      abArm: 'on',
    });
    expect(shaderWarmBeaconSummary({ ...READY, abArm: 'off' }).abArm).toBe('off');
    expect(shaderWarmBeaconSummary({ ...READY, abArm: null }).abArm).toBeNull();
  });

  it('rounds the hold milliseconds, floors them at zero, and reads a bad arm as no draw', () => {
    const summary = shaderWarmBeaconSummary({
      ...READY,
      holdMs: 1234.6,
      holdWallMs: -40,
      releases: 2.9,
      abArm: 'maybe' as unknown as 'on',
    });
    expect(summary).toMatchObject({ holdMs: 1235, holdWallMs: 0, releases: 2, abArm: null });
    const garbage = shaderWarmBeaconSummary({
      ...READY,
      holdMs: Number.NaN,
      holdWallMs: Number.POSITIVE_INFINITY,
      releases: Number.NaN,
    });
    expect(garbage).toMatchObject({ holdMs: 0, holdWallMs: 0, releases: 0 });
  });

  it('pins the text bound to the token bound the server accepts', () => {
    // server/perf_report_entry_blocks.ts SHADER_WARM_TOKEN_MAX: a longer value
    // would be cut into a token the server then drops on charset.
    expect(SHADER_WARM_BEACON_TEXT_MAX).toBe(64);
  });
});
