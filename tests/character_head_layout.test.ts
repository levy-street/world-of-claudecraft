import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/shell.css', import.meta.url), 'utf8');

describe('desktop character head-control layout', () => {
  it('docks the online picker explicitly inside the absolute create stage', () => {
    expect(css).toMatch(
      /body:not\(\.mobile-touch\) #charcreate-panel\.cs-wow #charcreate-head-row\s*\{[^}]*position:\s*absolute;[^}]*left:\s*102px;[^}]*top:\s*130px;[^}]*bottom:\s*140px;/s,
    );
  });

  it('keeps offline face and chroma controls in separate narrow-desktop columns', () => {
    expect(css).toMatch(
      /@media \(max-width: 1040px\), \(max-height: 520px\)[\s\S]*?#offline-select\.cs-wow #offline-chroma-group\s*\{[^}]*right:\s*auto;[^}]*left:\s*410px;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 1040px\), \(max-height: 520px\)[\s\S]*?#offline-select\.cs-wow \.head-group-face,[\s\S]*?\.head-group-hair\s*\{[^}]*left:\s*170px;/,
    );
  });
});
