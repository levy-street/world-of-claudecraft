// The `#studio` seam: the public tree must resolve the specifier to the stub, keep
// the private clone path out of git, and mirror the resolution in every place
// `#bot-detector` is mirrored (vite config for the bundle, tsconfig paths for tsc).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { studioBoot } from '../src/editor/studio_stub';

const repoRoot = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

describe('#studio seam', () => {
  it('the public stub exposes no boot function', () => {
    expect(studioBoot).toBeNull();
  });

  it('the private clone path is gitignored', () => {
    const ignore = read('.gitignore').split('\n');
    expect(ignore).toContain('src/studio/');
  });

  it('vite and tsc resolve #studio to the private clone first, then the stub', () => {
    const vite = read('vite.config.ts');
    expect(vite).toContain("'src/studio/index.ts'");
    expect(vite).toContain("'src/editor/studio_stub.ts'");
    expect(vite).toMatch(/'#studio':\s*studioImpl/);
    const tsconfig = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    expect(tsconfig.compilerOptions.paths['#studio']).toEqual([
      './src/studio/index.ts',
      './src/editor/studio_stub.ts',
    ]);
  });

  it('the editor entry boots Studio when the seam provides it', () => {
    const entry = read('src/editor/main.ts');
    expect(entry).toContain("from '#studio'");
    expect(entry).toMatch(/if \(studioBoot\)/);
  });

  it('a public checkout carries no Studio clone', () => {
    // The clone is a per-developer mount; CI and the shipped bundle must never see one.
    expect(existsSync(join(repoRoot, 'src/studio/index.ts'))).toBe(false);
  });
});
