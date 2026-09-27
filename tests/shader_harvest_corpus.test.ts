import { describe, expect, it } from 'vitest';
import {
  classifySites,
  corpusIndex,
  createCorpus,
  foldDrain,
  materialKindOf,
  programHash,
  shaderNameOf,
  shaderTokensOf,
} from '../scripts/lib/shader_harvest_corpus.mjs';

const VERT = '#define SHADER_NAME village:Plaster\nvoid main() { gl_Position = vec4(0.0); }';
const FRAG_A =
  '#define SHADER_NAME village:Plaster\n#define LAMBERT\nuniform float uWornTile;\nvoid main() {}';
const FRAG_B = '#define STANDARD\nuniform float uBladeRadius;\nvoid main() {}';

function drain(programs: { key: number; vertex: string; fragment: string; index0?: string }[]) {
  return {
    programs: programs.map((p) => ({ index0: '', ...p })),
    meta: programs.map((p) => ({ key: p.key, links: 1, steps: ['boot'], contexts: [0] })),
  };
}

describe('shader harvest corpus', () => {
  it('identifies a program by its text and location-0 attribute, never by a page key', () => {
    expect(programHash(VERT, FRAG_A, '')).toBe(programHash(VERT, FRAG_A, ''));
    expect(programHash(VERT, FRAG_A, '')).not.toBe(programHash(VERT, FRAG_B, ''));
    expect(programHash(VERT, FRAG_A, '')).not.toBe(programHash(VERT, FRAG_A, 'position'));
  });

  it('shares one shader text between the programs that use it', () => {
    const corpus = createCorpus();
    const added = foldDrain(
      corpus,
      'low',
      drain([
        { key: 0, vertex: VERT, fragment: FRAG_A },
        { key: 1, vertex: VERT, fragment: FRAG_B },
      ]),
    );
    expect(added).toBe(2);
    expect(corpus.programs.size).toBe(2);
    expect(corpus.shaders.size).toBe(3);
  });

  it('merges a second profile into the same program instead of duplicating it', () => {
    const corpus = createCorpus();
    foldDrain(corpus, 'low', drain([{ key: 0, vertex: VERT, fragment: FRAG_A }]));
    // The second page numbers its records from zero again: the page key must
    // not leak across profiles.
    const added = foldDrain(
      corpus,
      'ultra',
      drain([
        { key: 0, vertex: VERT, fragment: FRAG_B },
        { key: 1, vertex: VERT, fragment: FRAG_A },
      ]),
    );
    expect(added).toBe(1);
    const shared = corpus.programs.get(programHash(VERT, FRAG_A, ''));
    expect(Object.keys(shared?.seen ?? {}).sort()).toEqual(['low', 'ultra']);
    const ultraOnly = corpus.programs.get(programHash(VERT, FRAG_B, ''));
    expect(Object.keys(ultraOnly?.seen ?? {})).toEqual(['ultra']);
  });

  it('keeps the latest provenance a drain reports for a program', () => {
    const corpus = createCorpus();
    const first = drain([{ key: 0, vertex: VERT, fragment: FRAG_A }]);
    foldDrain(corpus, 'low', first);
    foldDrain(corpus, 'low', {
      programs: [],
      meta: [{ key: 0, links: 4, steps: ['boot', 'zone:a'], contexts: [0, 2] }],
    });
    const program = corpus.programs.get(programHash(VERT, FRAG_A, ''));
    expect(program?.seen.low).toEqual({ links: 4, steps: ['boot', 'zone:a'], contexts: [0, 2] });
  });

  it('reads the name and the lighting model out of the text', () => {
    expect(shaderNameOf(FRAG_A)).toBe('village:Plaster');
    expect(shaderNameOf(FRAG_B)).toBe('');
    expect(materialKindOf(FRAG_A)).toBe('LAMBERT');
    expect(materialKindOf(FRAG_B)).toBe('STANDARD');
    expect(materialKindOf('void main() {}')).toBe('');
  });

  it('indexes sizes without shipping the texts', () => {
    const corpus = createCorpus();
    foldDrain(corpus, 'low', drain([{ key: 0, vertex: VERT, fragment: FRAG_A }]));
    const index = corpusIndex(corpus, { gitSha: 'abc' });
    expect(index.programCount).toBe(1);
    expect(index.shaderCount).toBe(2);
    expect(index.shaders.every((s) => s.bytes > 0 && !('text' in s))).toBe(true);
    expect(index.gitSha).toBe('abc');
  });

  it('takes declared names as tokens and leaves prose and stock names out', () => {
    const source = [
      '// the values live in their own table; nothing in here shapes out results;',
      'const frag = `',
      '  uniform float uWornTile;',
      '  uniform vec3 uTints[4];',
      '  varying highp vec3 vWornWorldPos;',
      '  uniform vec3 diffuse;',
      '  uniform float uK;',
      '`;',
    ].join('\n');
    expect(shaderTokensOf(source).sort()).toEqual(['uTints', 'uWornTile', 'vWornWorldPos']);
  });

  it('judges a file only on tokens no other file declares', () => {
    const corpus = createCorpus();
    foldDrain(corpus, 'low', drain([{ key: 0, vertex: VERT, fragment: FRAG_A }]));
    const { seen, unseen, undetermined } = classifySites(corpus, [
      { file: 'worn_stone.ts', tokens: ['uWornTile', 'uShared'] },
      { file: 'blade_grass.ts', tokens: ['uBladeRadius', 'uShared'] },
      // Its only token is shared, and harvested through worn_stone's text:
      // that proves nothing about this file.
      { file: 'shared_only.ts', tokens: ['uShared'] },
      { file: 'helper.ts', tokens: [] },
    ]);
    expect(seen.map((s) => s.file)).toEqual(['worn_stone.ts']);
    expect(unseen.map((s) => s.file)).toEqual(['blade_grass.ts']);
    expect(unseen[0].own).toEqual(['uBladeRadius']);
    expect(undetermined.map((s) => s.file)).toEqual(['shared_only.ts']);
  });
});
