import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const POKER_SOURCE = join(import.meta.dirname, '..', 'src', 'sim', 'poker');

function typescriptSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typescriptSources(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('poker host-neutral architecture', () => {
  it('stays ESM-only and excludes Node assert and crypto randomness', () => {
    const source = typescriptSources(POKER_SOURCE)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/\brequire\s*\(|\bmodule\.exports\b|\bexports\.\w+\b/);
    expect(source).not.toMatch(
      /from\s+['"](?:node:)?assert['"]|from\s+['"](?:node:)?crypto['"]|randomInt|Math\.random/,
    );
  });
});
