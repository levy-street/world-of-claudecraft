// Fast pins for the symbol census extractors (scripts/merge_audit/symbol_census.mjs,
// Phase 11d unit 5). Inline fixtures only: no git, no repo walk, so the suite stays
// cheap enough for the selective gate while pinning the exact lexing rules the census
// leans on (comment and string stripping, `as` renames, dotted i18n paths, literal
// content ids, SimEvent discriminant literals, and the positive floor guard).
import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  extractContentIds,
  extractExports,
  extractI18nKeys,
  extractSimEventEmits,
  extractSimEventUnion,
  FLOORS,
  parseDeletionList,
} from '../scripts/merge_audit/symbol_census.mjs';

describe('extractExports', () => {
  const fixture = [
    'export const alpha = 1;',
    'const beta = 2;',
    'const gamma = 3;',
    'export {',
    '  beta as bravo,',
    '  gamma,',
    '};',
    '// export const commentedOut = 4;',
    "const s = 'export const inString = 5;';",
    'export function delta() {',
    '  return s;',
    '}',
  ].join('\n');

  it('collects declaration and export-list names, honoring as renames', () => {
    const { names } = extractExports(fixture);
    expect(names).toContain('alpha');
    expect(names).toContain('bravo');
    expect(names).toContain('gamma');
    expect(names).toContain('delta');
    expect(names).toHaveLength(4);
  });

  it('the multi-line export list exports the renamed name, not the local one', () => {
    const { names } = extractExports(fixture);
    expect(names).not.toContain('beta');
  });

  it('a commented-out export is not counted', () => {
    const { names } = extractExports(fixture);
    expect(names).not.toContain('commentedOut');
  });

  it('an export inside a string literal is not counted', () => {
    const { names } = extractExports(fixture);
    expect(names).not.toContain('inString');
  });

  it('re-exporting an imported binding is present by name but marked a re-export', () => {
    const src = ["import { ext as extLocal } from './mod';", 'export { extLocal };'].join('\n');
    const { names, reexports } = extractExports(src);
    expect(names).toEqual(['extLocal']);
    expect(reexports).toEqual(['extLocal']);
  });
});

describe('extractI18nKeys', () => {
  it('a nested object produces dotted leaf paths in walk order', () => {
    const src = [
      'export const CATALOG = {',
      '  itemUi: {',
      '    tooltip: {',
      "      wellFed: 'Well Fed line',",
      "      restore: 'Restores {value}',",
      '    },',
      "    label: 'Item',",
      '  },',
      '};',
    ].join('\n');
    const { keys, roots } = extractI18nKeys(src);
    expect(keys).toEqual(['itemUi.tooltip.wellFed', 'itemUi.tooltip.restore', 'itemUi.label']);
    expect(roots).toBe(1);
  });

  it('spread members are counted as blind spots, never silently dropped', () => {
    const src = ['export const C = {', '  ...shared,', "  leaf: 'x',", '};'].join('\n');
    const res = extractI18nKeys(src);
    expect(res.keys).toEqual(['leaf']);
    expect(res.spread).toBe(1);
  });
});

describe('extractContentIds', () => {
  it('collects literal ids (quoted and substitution-free template) and counts the rest', () => {
    const src = [
      'export const ITEMS = [',
      '  {',
      "    id: 'compost',",
      "    name: 'Compost',",
      '  },',
      '  { id: `growth_tonic` },',
      '  { id: someVar },',
      '];',
    ].join('\n');
    const { ids, nonLiteral } = extractContentIds(src);
    expect(ids).toEqual(['compost', 'growth_tonic']);
    expect(nonLiteral).toBe(1);
  });
});

describe('extractSimEventUnion', () => {
  it('collects discriminant literals through a bare alias member', () => {
    const src = [
      'export type SimEvent =',
      "  | { type: 'xp'; amount: number }",
      "  | { type: 'levelup'; level: number }",
      '  | UnstuckEvent;',
      "type UnstuckEvent = { type: 'unstuck' };",
    ].join('\n');
    const res = extractSimEventUnion(src, 'SimEvent');
    expect(res.kinds).toEqual(['xp', 'levelup', 'unstuck']);
    expect(res.resolvedAliases).toEqual(['UnstuckEvent']);
    expect(res.unresolvedAliases).toEqual([]);
  });
});

describe('extractSimEventEmits', () => {
  it('collects emit-site type literals and separates declarations and non-literals', () => {
    const src = [
      "ctx.emit({ type: 'deedUnlocked', deed: id });",
      'this.ctx.emit({',
      "  type: 'levelup',",
      '  level: 5,',
      '});',
      'ctx.emit({ type: kindVar });',
      'function emit(ev: SimEvent) {}',
    ].join('\n');
    const res = extractSimEventEmits(src);
    expect(res.kinds).toEqual(['deedUnlocked', 'levelup']);
    expect(res.sites).toBe(3);
    expect(res.nonLiteral).toBe(1);
    expect(res.declarations).toBe(1);
  });
});

describe('parseDeletionList', () => {
  it('a reason saying only deleted is a defect; a full row parses with its class', () => {
    const md = [
      '| Class | Old name | New name | Phase | Ruling | Reason |',
      '|---|---|---|---|---|---|',
      '| export | `oldName` | `newName` | 11c | 11c-D-2 | renamed at the one mint |',
      '| export | `badRow` | | 11c | 11c-D-2 | deleted |',
    ].join('\n');
    const { rows, defects } = parseDeletionList(md);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ cls: 'exports', oldName: 'oldName', newName: 'newName' });
    expect(defects).toHaveLength(1);
    expect(defects[0]).toContain('deleted');
  });
});

describe('FLOORS', () => {
  it('every class floor is a positive integer for every parent', () => {
    expect(CLASSES.length).toBe(5);
    for (const cls of CLASSES) {
      for (const side of ['ours', 'theirs', 'release'] as const) {
        const floor = FLOORS[cls][side];
        expect(Number.isInteger(floor)).toBe(true);
        expect(floor).toBeGreaterThan(0);
      }
    }
  });
});
