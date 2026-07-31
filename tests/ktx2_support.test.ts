// Behavioral coverage for src/render/assets/ktx2_support.ts: the shared KTX2
// transcoder that loader.ts attaches to the one GLTFLoader. The highest
// consequence branch is the no-context fallback (a DOM-less or context
// exhausted host must still get a loader that parses KTX2, transcoding to
// plain RGBA, instead of failing every model parse for the session).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ktx2InternalsForTest, ktx2Loader } from '../src/render/assets/ktx2_support';

afterEach(() => {
  ktx2InternalsForTest.reset();
  vi.restoreAllMocks();
});

describe('ktx2 transcoder support', () => {
  it('memoizes one loader instance across calls', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = ktx2Loader();
    expect(ktx2Loader()).toBe(first);
  });

  it('falls back to an all-false workerConfig on a DOM-less host, with a warning', () => {
    // Plain Node has no document: the probe throws and the fallback arm runs.
    expect(typeof document).toBe('undefined');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = ktx2Loader();
    // All-false support flags force the RGBA transcode target, the one every
    // WebGL implementation accepts; parse keeps working instead of throwing
    // "Missing initialization with .detectSupport".
    expect(loader.workerConfig).toMatchObject({
      astcSupported: false,
      etc1Supported: false,
      etc2Supported: false,
      dxtSupported: false,
      bptcSupported: false,
      pvrtcSupported: false,
    });
    // The fallback silently restores the decoded-bitmap footprint the KTX2
    // conversion exists to remove, so it must announce itself.
    expect(warn).toHaveBeenCalledWith('[ktx2] no probe context; transcoding to uncompressed RGBA');
  });

  it('points the transcoder at the shipped /basis/ files', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(ktx2Loader().transcoderPath).toBe('/basis/');
  });

  it('reset() forgets the memoized instance', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = ktx2Loader();
    ktx2InternalsForTest.reset();
    expect(ktx2Loader()).not.toBe(first);
  });
});
