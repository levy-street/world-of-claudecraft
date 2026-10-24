// The Spell Lab is a dev tool: its runtime must never reach a production bundle.
// The production bundler only drops the dynamic import when the boot module's own
// condition names `import.meta.env.DEV` literally (a flag read from another module
// is not folded, and the dead runtime chunk then ships in dist/).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const boot = readFileSync(
  new URL('../src/render/spell_lab/spell_lab_boot.ts', import.meta.url),
  'utf8',
);
const code = boot
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n');

describe('spell lab boot (src/render/spell_lab/spell_lab_boot.ts)', () => {
  it('gates every runtime import behind a literal import.meta.env.DEV', () => {
    const gate = code.indexOf('if (import.meta.env.DEV && ');
    expect(gate).toBeGreaterThanOrEqual(0);
    const imports = [...code.matchAll(/import\('\.\/spell_lab_runtime'\)/g)];
    expect(imports.length).toBeGreaterThan(0);
    for (const m of imports) expect(m.index).toBeGreaterThan(gate);
  });

  it('leaves the shortcut alone while the player types in a field', () => {
    expect(code).toMatch(/tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT'/);
  });
});
