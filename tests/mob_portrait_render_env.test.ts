// The render-environment fingerprint on the portrait manifest acceptance.
//
// The gap it closes: the renderer fingerprint says WHAT produced the committed
// bytes and cannot say WHERE. Portrait WebPs are deterministic per machine but
// not across GL stacks, so a re-bake on a second machine moves every committed
// row while every render input stays byte-identical, and the acceptance can only
// read that as content drift. These tests pin the three halves of the fix: the
// fingerprint itself, the drift classifier's `environmentOnly` verdict, and the
// write guard's refusal, plus the compatibility property the whole design rests
// on (an unrecorded environment concludes nothing and changes no behavior).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describeManifestDrift } from '../scripts/lib/mob_portrait_manifest_diff.mjs';
import { assertManifestWriteAuthorized } from '../scripts/lib/mob_portrait_manifest_guard.mjs';
import type { RecordedRenderEnv } from '../scripts/lib/mob_portrait_render_env.mjs';
import {
  browserMajorOf,
  describeRenderEnvDrift,
  normalizeRenderEnv,
  RENDER_ENV_FIELDS,
  recordRenderEnv,
  renderEnvFingerprint,
} from '../scripts/lib/mob_portrait_render_env.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(
  repoRoot,
  'docs/achievements/placeholder-art-completion-2026-08-09/mob-portrait-source-manifest.json',
);

const MAC_SWIFTSHADER = {
  platform: 'darwin',
  arch: 'arm64',
  gpuVendor: 'Google Inc. (Google)',
  gpuRenderer:
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)',
  browserVersion: 'Chrome/151.0.7922.175',
  requestedBackend: 'swiftshader',
};
const MAC_METAL = {
  ...MAC_SWIFTSHADER,
  gpuVendor: 'Apple',
  gpuRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)',
  requestedBackend: 'metal',
};
const LINUX_CI = {
  ...MAC_SWIFTSHADER,
  platform: 'linux',
  arch: 'x64',
};

interface TestManifest {
  schemaVersion: number;
  rendererFingerprint: string;
  portraitCount: number;
  renderEnv?: RecordedRenderEnv;
  renderer: {
    trackedFiles: { path: string; bytes: number; sha256: string }[];
    browserBundle: { entry: string; bytes: number; sha256: string };
  };
  portraits: { id: string; sourceFingerprint: string; output: { bytes: number; sha256: string } }[];
}

function manifest(overrides: Record<string, unknown> = {}): TestManifest {
  return {
    schemaVersion: 2,
    rendererFingerprint: 'renderer-a',
    portraitCount: 2,
    renderer: {
      trackedFiles: [{ path: 'scripts/render_finder_portraits.mjs', bytes: 10, sha256: 'tf' }],
      browserBundle: { entry: 'e', bytes: 5, sha256: 'bundle-a' },
    },
    portraits: [
      { id: 'alpha', sourceFingerprint: 'src-alpha', output: { bytes: 100, sha256: 'out-alpha' } },
      { id: 'beta', sourceFingerprint: 'src-beta', output: { bytes: 200, sha256: 'out-beta' } },
    ],
    ...overrides,
  };
}

/** A re-bake: same inputs, different output bytes. This is exactly the shape a
 *  cross-environment render produces, and exactly the shape a real art change
 *  does NOT (a real change moves sourceFingerprint too). */
function reBaked(base: TestManifest, overrides: Record<string, unknown> = {}): TestManifest {
  return {
    ...base,
    portraits: base.portraits.map((row) => ({
      ...row,
      output: { ...row.output, sha256: `${row.output.sha256}-rebaked` },
    })),
    ...overrides,
  };
}

function receiptFor(next: TestManifest) {
  return {
    schemaVersion: 1,
    generatedBy: 'scripts/render_finder_portraits.mjs',
    rendererFingerprint: next.rendererFingerprint,
    renderEnv: next.renderEnv,
    portraits: next.portraits,
  };
}

describe('render environment fingerprint', () => {
  it('separates the render stacks that actually produce different bytes', () => {
    const swiftshader = renderEnvFingerprint(MAC_SWIFTSHADER);
    expect(renderEnvFingerprint(MAC_METAL)).not.toBe(swiftshader);
    expect(renderEnvFingerprint(LINUX_CI)).not.toBe(swiftshader);
    expect(renderEnvFingerprint(MAC_METAL)).not.toBe(renderEnvFingerprint(LINUX_CI));
  });

  it('is stable for the same environment and hashes every declared field', () => {
    expect(renderEnvFingerprint(MAC_SWIFTSHADER)).toBe(
      renderEnvFingerprint({ ...MAC_SWIFTSHADER }),
    );
    // Per-dimension: moving ANY hashed field alone must move the fingerprint, so
    // the hash cannot silently ignore one of them. browserMajor is DERIVED, so
    // it is moved through the input that feeds it (browserVersion wins over a
    // directly supplied major by design); driving it any other way would test
    // the test rather than the hash.
    const moveInput = (field: string) =>
      field === 'browserMajor'
        ? { browserVersion: 'Chrome/152.0.1.1' }
        : { [field]: 'moved-value' };
    for (const field of RENDER_ENV_FIELDS) {
      expect(
        renderEnvFingerprint({ ...MAC_SWIFTSHADER, ...moveInput(field) }),
        `${field} is declared hashed but does not move the fingerprint`,
      ).not.toBe(renderEnvFingerprint(MAC_SWIFTSHADER));
    }
  });

  it('ignores the browser PATCH build and the requested backend, which move no pixel', () => {
    // A weekly Chrome patch must not mark every capture as environment drift, or
    // the record becomes noise an operator learns to ignore.
    expect(browserMajorOf('Chrome/151.0.7922.175')).toBe('151');
    expect(
      renderEnvFingerprint({ ...MAC_SWIFTSHADER, browserVersion: 'Chrome/151.0.9999.1' }),
    ).toBe(renderEnvFingerprint(MAC_SWIFTSHADER));
    // The backend actually used already shows up inside gpuRenderer; hashing the
    // launch REQUEST too would double-count it and make a flag edit read as a
    // machine change.
    expect(renderEnvFingerprint({ ...MAC_SWIFTSHADER, requestedBackend: 'anything' })).toBe(
      renderEnvFingerprint(MAC_SWIFTSHADER),
    );
    // ...but it is still RECORDED, so a human reading the manifest sees it.
    expect(normalizeRenderEnv(MAC_METAL).requestedBackend).toBe('metal');
    expect(normalizeRenderEnv(MAC_SWIFTSHADER).browserVersion).toBe('Chrome/151.0.7922.175');
  });

  it('hashes a partially observed environment deterministically instead of throwing', () => {
    expect(renderEnvFingerprint({ platform: 'linux' })).toBe(
      renderEnvFingerprint({ platform: 'linux' }),
    );
    expect(renderEnvFingerprint({})).not.toBe(renderEnvFingerprint({ platform: 'linux' }));
    expect(recordRenderEnv(null).fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reports an unrecorded environment as UNKNOWN, never as a match or as drift', () => {
    expect(describeRenderEnvDrift(null, recordRenderEnv(MAC_METAL))).toEqual({
      known: false,
      moved: false,
      fields: [],
    });
    expect(describeRenderEnvDrift(recordRenderEnv(MAC_METAL), null).known).toBe(false);
  });

  it('names which fields moved', () => {
    const drift = describeRenderEnvDrift(
      recordRenderEnv(MAC_SWIFTSHADER),
      recordRenderEnv(LINUX_CI),
    );
    expect(drift.known).toBe(true);
    expect(drift.moved).toBe(true);
    expect(drift.fields.map((f) => f.field).sort()).toEqual(['arch', 'platform']);
  });
});

describe('describeManifestDrift environmentOnly verdict', () => {
  it('names a same-input re-bake in a moved environment as environment drift', () => {
    const previous = manifest({ renderEnv: recordRenderEnv(MAC_SWIFTSHADER) });
    const next = reBaked(previous, { renderEnv: recordRenderEnv(MAC_METAL) });
    const drift = describeManifestDrift(previous, next);
    expect(drift.environmentOnly).toBe(true);
    expect(drift.changedRows.every((row) => row.outputChanged && !row.sourceChanged)).toBe(true);
    expect(drift.renderEnv.moved).toBe(true);
  });

  it('refuses the verdict when a render INPUT moved too (that is a content change)', () => {
    const previous = manifest({ renderEnv: recordRenderEnv(MAC_SWIFTSHADER) });
    const next = {
      ...reBaked(previous, { renderEnv: recordRenderEnv(MAC_METAL) }),
      portraits: [
        { id: 'alpha', sourceFingerprint: 'src-alpha-NEW', output: { bytes: 100, sha256: 'x' } },
        { id: 'beta', sourceFingerprint: 'src-beta', output: { bytes: 200, sha256: 'out-beta-r' } },
      ],
    };
    expect(describeManifestDrift(previous, next).environmentOnly).toBe(false);
  });

  it('refuses the verdict when the environment is unrecorded on either side', () => {
    const previous = manifest();
    const next = reBaked(previous, { renderEnv: recordRenderEnv(MAC_METAL) });
    expect(describeManifestDrift(previous, next).environmentOnly).toBe(false);
    const previousKnown = manifest({ renderEnv: recordRenderEnv(MAC_METAL) });
    expect(describeManifestDrift(previousKnown, reBaked(previousKnown)).environmentOnly).toBe(
      false,
    );
  });

  it('refuses the verdict when the environment HELD (that is a real art change)', () => {
    const previous = manifest({ renderEnv: recordRenderEnv(MAC_SWIFTSHADER) });
    const next = reBaked(previous, { renderEnv: recordRenderEnv(MAC_SWIFTSHADER) });
    const drift = describeManifestDrift(previous, next);
    expect(drift.renderEnv.moved).toBe(false);
    expect(drift.environmentOnly).toBe(false);
  });

  it('is distinct from bookkeepingOnly, which needs zero row drift', () => {
    const previous = manifest({ renderEnv: recordRenderEnv(MAC_SWIFTSHADER) });
    const next = reBaked(previous, { renderEnv: recordRenderEnv(MAC_METAL) });
    expect(describeManifestDrift(previous, next).bookkeepingOnly).toBe(false);
  });
});

describe('assertManifestWriteAuthorized environment arm', () => {
  it('refuses a receipt-backed cross-environment re-bake by default', () => {
    const previous = manifest({ renderEnv: recordRenderEnv(MAC_SWIFTSHADER) });
    const next = reBaked(previous, { renderEnv: recordRenderEnv(MAC_METAL) });
    expect(() =>
      assertManifestWriteAuthorized({ previous, next, receipt: receiptFor(next) }),
    ).toThrow(/DIFFERENT render environment/);
  });

  it('accepts it only on the deliberate opt-in', () => {
    const previous = manifest({ renderEnv: recordRenderEnv(MAC_SWIFTSHADER) });
    const next = reBaked(previous, { renderEnv: recordRenderEnv(MAC_METAL) });
    expect(() =>
      assertManifestWriteAuthorized({
        previous,
        next,
        receipt: receiptFor(next),
        allowEnvironmentRemint: true,
      }),
    ).not.toThrow();
  });

  it('still accepts a same-environment re-render, which the receipt already proves', () => {
    const previous = manifest({ renderEnv: recordRenderEnv(MAC_SWIFTSHADER) });
    const next = reBaked(previous, { renderEnv: recordRenderEnv(MAC_SWIFTSHADER) });
    expect(() =>
      assertManifestWriteAuthorized({ previous, next, receipt: receiptFor(next) }),
    ).not.toThrow();
  });

  it('changes nothing when the environment is unrecorded (the pre-existing manifests)', () => {
    const previous = manifest();
    const next = reBaked(previous);
    expect(() =>
      assertManifestWriteAuthorized({ previous, next, receipt: receiptFor(next) }),
    ).not.toThrow();
  });

  it('refuses a receipt whose environment disagrees with the manifest it authorizes', () => {
    // The receipt is the ONLY witness to the environment, so a receipt claiming
    // one machine while the manifest records another is incoherent, whatever the
    // rows say.
    const previous = manifest({ renderEnv: recordRenderEnv(MAC_SWIFTSHADER) });
    const next = reBaked(previous, { renderEnv: recordRenderEnv(MAC_SWIFTSHADER) });
    const receipt = { ...receiptFor(next), renderEnv: recordRenderEnv(MAC_METAL) };
    expect(() => assertManifestWriteAuthorized({ previous, next, receipt })).toThrow(
      /does not match the recorded render environment/,
    );
  });

  it('does not weaken the pre-existing no-receipt refusal', () => {
    const previous = manifest({ renderEnv: recordRenderEnv(MAC_SWIFTSHADER) });
    const next = reBaked(previous, { renderEnv: recordRenderEnv(MAC_METAL) });
    expect(() => assertManifestWriteAuthorized({ previous, next, receipt: null })).toThrow(
      /without a renderer receipt/,
    );
  });
});

describe('the committed manifest', () => {
  it('records the render environment its committed bytes were baked in', () => {
    const committed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(committed.renderEnv).toBeTruthy();
    expect(committed.renderEnv.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    // The fingerprint must be the one its own recorded fields hash to, so a
    // hand-edited field cannot ride along under a stale hash.
    expect(committed.renderEnv.fingerprint).toBe(renderEnvFingerprint(committed.renderEnv));
    // The shipping portraits are rendered under software rasterization on
    // purpose (scripts/render_finder_portraits.mjs defaults to
    // --use-angle=swiftshader), which is what makes the committed bytes
    // reproducible off one machine at all. A committed manifest recorded from a
    // REAL_GPU run would be the drift this whole field exists to catch.
    expect(committed.renderEnv.gpuRenderer).toMatch(/SwiftShader/i);
    expect(committed.renderEnv.requestedBackend).toBe('swiftshader');
  });
});
