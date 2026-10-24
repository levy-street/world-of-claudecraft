import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/editor/styles.css', import.meta.url), 'utf8');

describe('ClaudeCraft Studio visual system', () => {
  it('keeps editor chrome gradient-free', () => {
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient\s*\(/i);
  });

  it('uses the shared flat neutral control palette', () => {
    expect(css).toContain('--ed-panel: #1f1f1f;');
    expect(css).toContain('--ed-accent: #d0d0d0;');
    expect(css).toContain('button.primary {');
    expect(css).toContain('box-shadow: none;');
  });
});
