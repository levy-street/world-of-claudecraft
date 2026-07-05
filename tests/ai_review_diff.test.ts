// Unit tests for the AI reviewer's diff filtering/capping helpers. Pure Node module, no
// CLI or network.
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain Node ESM script, no types
import { capDiff, filterReviewDiff } from '../scripts/ai_review_diff.mjs';

function section(path: string, body = '+x\n') {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}`;
}

describe('filterReviewDiff', () => {
  it('keeps hand-written code sections untouched', () => {
    const diff = section('src/sim/spirit.ts') + section('server/game.ts');
    const out = filterReviewDiff(diff);
    expect(out.diff).toBe(diff);
    expect(out.dropped).toEqual([]);
  });

  it('drops generated i18n tables, goldens, and lockfiles, reporting what it dropped', () => {
    const keep = section('src/ui/hud.ts');
    const diff =
      keep +
      section('src/ui/i18n.resolved.generated/es.ts') +
      section('tests/parity/golden/solo_warrior.json') +
      section('package-lock.json') +
      section('src/ui/i18n.status.summary.json');
    const out = filterReviewDiff(diff);
    expect(out.diff).toBe(keep);
    expect(out.dropped).toEqual([
      'src/ui/i18n.resolved.generated/es.ts',
      'tests/parity/golden/solo_warrior.json',
      'package-lock.json',
      'src/ui/i18n.status.summary.json',
    ]);
  });

  it('drops binary asset sections', () => {
    const keep = section('src/render/renderer.ts');
    const out = filterReviewDiff(keep + section('public/icons/sword.png'));
    expect(out.diff).toBe(keep);
    expect(out.dropped).toEqual(['public/icons/sword.png']);
  });

  it('handles an empty diff', () => {
    expect(filterReviewDiff('')).toEqual({ diff: '', dropped: [] });
  });
});

describe('capDiff', () => {
  it('returns the diff unchanged when under the cap', () => {
    const diff = section('src/a.ts');
    expect(capDiff(diff, 10000)).toEqual({ diff, truncated: false });
  });

  it('cuts on a file-section boundary when over the cap', () => {
    const a = section('src/a.ts', '+aaaa\n'.repeat(50));
    const b = section('src/b.ts', '+bbbb\n'.repeat(50));
    const out = capDiff(a + b, a.length + 40);
    expect(out.truncated).toBe(true);
    // The partial second section is dropped entirely, never half a hunk.
    expect(out.diff).toBe(a);
  });

  it('falls back to a hard cut when there is no boundary inside the cap', () => {
    const a = section('src/a.ts', '+aaaa\n'.repeat(200));
    const out = capDiff(a, 100);
    expect(out.truncated).toBe(true);
    expect(out.diff.length).toBe(100);
  });
});
