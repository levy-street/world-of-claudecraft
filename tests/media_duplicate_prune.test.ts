// Shipping bundles carried every hashed media asset twice: `emit` copies
// public/<logical> to dist/media/<name>.<hash><ext> and leaves the source, while
// vite copies all of public/ into dist/ separately. That duplication pushed the
// Play base module past its 500 MB compressed download ceiling.
//
// planMediaDuplicatePrune decides which originals may go. The rule that matters
// is the refusal: an original with no hashed twin on disk is the ONLY copy and
// must survive, because assetUrl() falls back to the original path for anything
// the manifest does not carry.
import { describe, expect, it } from 'vitest';
import { planMediaDuplicatePrune } from '../scripts/build_media_manifest.mjs';

const ENTRIES: Record<string, string> = {
  'env/amber_sunset_2k.hdr': '/media/env/amber_sunset_2k.bc457362165a.hdr',
  'models/props/farm_crate.glb': '/media/models/props/farm_crate.0b9724332a2d.glb',
  'textures/terrain/grass.jpg': '/media/textures/terrain/grass.3d8343ec47c0.jpg',
  'vfx/spark_04.png': '/media/vfx/spark_04.1b495e2b31b8.png',
};

/** fs probe stub: the given hashed urls exist under dist/, nothing else does. */
const existing = (present: readonly string[]) => (url: string) => present.includes(url);

describe('planMediaDuplicatePrune', () => {
  it('drops every original whose hashed copy is on disk', () => {
    const { drop, kept } = planMediaDuplicatePrune(ENTRIES, existing(Object.values(ENTRIES)));
    expect(drop).toEqual([
      'env/amber_sunset_2k.hdr',
      'models/props/farm_crate.glb',
      'textures/terrain/grass.jpg',
      'vfx/spark_04.png',
    ]);
    expect(kept).toEqual([]);
  });

  it('KEEPS an original when its hashed copy is missing (never delete the only copy)', () => {
    // Only the env twin was emitted; the other three originals are load-bearing.
    const { drop, kept } = planMediaDuplicatePrune(
      ENTRIES,
      existing(['/media/env/amber_sunset_2k.bc457362165a.hdr']),
    );
    expect(drop).toEqual(['env/amber_sunset_2k.hdr']);
    expect(kept.map((k) => k.logical)).toEqual([
      'models/props/farm_crate.glb',
      'textures/terrain/grass.jpg',
      'vfx/spark_04.png',
    ]);
  });

  it('probes the HASHED url, not the logical path', () => {
    // A plan that tested the wrong side of the mapping would find nothing on
    // disk under dist/media and either delete every only-copy or nothing at all.
    const asked: string[] = [];
    planMediaDuplicatePrune(ENTRIES, (url) => {
      asked.push(url);
      return true;
    });
    expect(asked).toEqual(
      Object.keys(ENTRIES)
        .sort()
        .map((k) => ENTRIES[k]),
    );
    expect(asked.every((u) => u.startsWith('/media/'))).toBe(true);
  });

  it('drops nothing when emit never ran, so the caller can fail the build', () => {
    const { drop, kept } = planMediaDuplicatePrune(ENTRIES, () => false);
    expect(drop).toEqual([]);
    expect(kept).toHaveLength(Object.keys(ENTRIES).length);
  });

  it('carries the hashed url alongside each kept original for the warning', () => {
    const { kept } = planMediaDuplicatePrune(ENTRIES, () => false);
    expect(kept).toContainEqual({
      logical: 'env/amber_sunset_2k.hdr',
      hashed: '/media/env/amber_sunset_2k.bc457362165a.hdr',
    });
  });

  it('is deterministic and sorted regardless of manifest key order', () => {
    const shuffled: Record<string, string> = {
      'vfx/spark_04.png': ENTRIES['vfx/spark_04.png'],
      'env/amber_sunset_2k.hdr': ENTRIES['env/amber_sunset_2k.hdr'],
      'textures/terrain/grass.jpg': ENTRIES['textures/terrain/grass.jpg'],
      'models/props/farm_crate.glb': ENTRIES['models/props/farm_crate.glb'],
    };
    const a = planMediaDuplicatePrune(ENTRIES, existing(Object.values(ENTRIES)));
    const b = planMediaDuplicatePrune(shuffled, existing(Object.values(shuffled)));
    expect(b.drop).toEqual(a.drop);
  });

  it('handles an empty manifest without inventing work', () => {
    expect(planMediaDuplicatePrune({}, () => true)).toEqual({ drop: [], kept: [] });
  });
});

describe('shipping build wiring', () => {
  it('prunes duplicate originals in the shared web bundle used by Render and native', async () => {
    const pkg = (await import('../package.json')) as unknown as {
      default: { scripts: Record<string, string> };
    };
    const scripts = pkg.default.scripts;
    const bundle = scripts['build:bundle'];
    expect(bundle).toContain('build_media_manifest.mjs emit');
    expect(bundle).toContain('build_media_manifest.mjs prune');
    // Order matters: prune reads the hashed twins that emit creates.
    expect(bundle.indexOf('build_media_manifest.mjs emit')).toBeLessThan(
      bundle.indexOf('build_media_manifest.mjs prune'),
    );
    // Native delegates to the same shipping build instead of running a second,
    // redundant prune after the originals are already gone.
    expect(scripts['build:native']).toContain('npm run build');
    expect(scripts['build:native']).not.toContain('build_media_manifest.mjs prune');
  });
});
