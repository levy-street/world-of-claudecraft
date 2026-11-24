import { describe, expect, it } from 'vitest';
import { findGlbReferences } from '../scripts/asset_pipeline/lib/glb_source_references.mjs';

describe('asset inventory GLB source references', () => {
  it('finds literal references and preserves suffix overlap and longer URLs', () => {
    const source = "'/models/long_sword.glb?v=2'; // unused.glb.backup\n'fox.glb'";
    expect(
      findGlbReferences(source, [
        'sword.glb',
        'long_sword.glb',
        'unused.glb',
        'fox.glb',
        'ox.glb',
        'absent.glb',
      ]),
    ).toEqual(new Set(['sword.glb', 'long_sword.glb', 'unused.glb', 'fox.glb', 'ox.glb']));
  });

  it('preserves case, punctuation, whitespace, and Unicode matching', () => {
    expect(
      findGlbReferences('"café fox.glb" "tower.v2.glb" "Fox.GLB" "line\nbreak.glb"', [
        'café fox.glb',
        'tower.v2.glb',
        'Fox.glb',
        'line\nbreak.glb',
      ]),
    ).toEqual(new Set(['café fox.glb', 'tower.v2.glb', 'line\nbreak.glb']));
  });

  it('does not infer dynamic filenames or combine separated fragments', () => {
    expect(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text fixture, not interpolation.
      findGlbReferences("'fox' + '.glb'; `wolf${variant}.glb`; cat\n.glb", [
        'fox.glb',
        'wolf.glb',
        'cat.glb',
      ]),
    ).toEqual(new Set());
  });

  it('deduplicates repeated references and candidate names', () => {
    expect(findGlbReferences('fox.glb fox.glb', ['fox.glb', 'fox.glb'])).toEqual(
      new Set(['fox.glb']),
    );
    expect(findGlbReferences('', ['fox.glb'])).toEqual(new Set());
    expect(findGlbReferences('fox.glb', [])).toEqual(new Set());
  });

  it('matches the previous includes rule for every candidate in a bounded corpus', () => {
    const names = [
      '.glb',
      'a.glb',
      'aa.glb',
      'a.glb.glb',
      'b.glb',
      'long-name.glb',
      'two words.glb',
    ];
    const fragments = ['', ...names, 'prefixaa.glb.backup', 'A.GLB', 'a\n.glb', 'other.glb'];
    for (const left of fragments) {
      for (const right of fragments) {
        const source = `${left}\n${right}`;
        expect(findGlbReferences(source, names)).toEqual(
          new Set(names.filter((name) => source.includes(name))),
        );
      }
    }
  });
});
