// Fast pins for the symbol census extractors (scripts/merge_audit/symbol_census.mjs,
// Phase 11d unit 5). Inline fixtures only: no git, no repo walk, so the suite stays
// cheap enough for the selective gate while pinning the exact lexing rules the census
// leans on (comment and string stripping, `as` renames, dotted i18n paths, literal
// content ids, SimEvent discriminant literals, and the positive floor guard).
import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  censusTree,
  compareCensus,
  extractContentIds,
  extractExports,
  extractI18nKeys,
  extractSimEventEmits,
  extractSimEventUnion,
  FLOORS,
  parseDeletionList,
  SIM_EVENT_UNION_ONLY,
  simEventVerdict,
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

  // The two INDIRECT shapes (Phase 11d QA). Before these were resolved, four
  // SimEvent types in src/sim/professions/ reached no class at all, so a hunk
  // dropping the emit CALL while leaving the union arm and the exported helper
  // passed the whole census. Both arms below died when the audit disabled the
  // resolution, which is what makes them the pin for it.
  it('resolves a fanout helper whose builder returns the event literal', () => {
    const src = "emitToZonePlayers(ctx, zoneId, (pid) => ({ type: 'masterworkZone', pid }));";
    expect(extractSimEventEmits(src).kinds).toEqual(['masterworkZone']);
  });

  it('resolves a ternary of two event literals, collapsing the duplicate kind', () => {
    const src = [
      'ctx.emit(',
      "  withered > 0 ? { type: 'farmReady', ready, withered } : { type: 'farmReady', ready },",
      ');',
    ].join('\n');
    expect(extractSimEventEmits(src).kinds).toEqual(['farmReady']);
  });

  it('keeps the plain shape precise: a nested type is not a second kind', () => {
    // The plain path reads its literal at depth 0 of the event object, so an
    // inner object carrying its own `type` cannot mint one.
    const src = "ctx.emit({ type: 'levelup', meta: { type: 'innerPlain' } });";
    expect(extractSimEventEmits(src).kinds).toEqual(['levelup']);
  });
});

describe('simEventVerdict: the declared-but-unseen pin and the resolver backstop', () => {
  // These four lines used to live inside runCensus(), which no test calls, so the
  // Phase 11d QA pin audit disabled each condition in turn and the suite stayed
  // green every time. Extracted to a pure function for exactly that reason.
  const sets = (names: string[]) => new Set(names);

  it('passes when the unseen set matches the pin exactly', () => {
    const union = sets(['levelup', 'motdResult']);
    const emits = sets(['levelup']);
    const v = simEventVerdict(union, emits, ['motdResult']);
    expect(v.unionOnly).toEqual(['motdResult']);
    expect(v.drift).toEqual({ added: [], removed: [] });
    expect(v.failed).toBe(false);
  });

  it('FAILS on a name ADDED to the blind spot (a new indirection nothing follows)', () => {
    const union = sets(['levelup', 'motdResult']);
    // levelup stopped being visible to the emits extractor.
    const v = simEventVerdict(union, sets([]), ['motdResult']);
    expect(v.drift.added).toEqual(['levelup']);
    expect(v.failed).toBe(true);
  });

  it('FAILS on a name REMOVED from it (it became visible, or stopped being emitted)', () => {
    const union = sets(['levelup', 'motdResult']);
    const v = simEventVerdict(union, sets(['levelup', 'motdResult']), ['motdResult']);
    expect(v.drift.removed).toEqual(['motdResult']);
    expect(v.failed).toBe(true);
  });

  it('FAILS on an emitted kind that is not a declared union member', () => {
    // The backstop on the indirect resolver: the ternary and fanout shapes scan a
    // whole call region, so a `type:` on a nested non-event object could mint a
    // bogus kind. It is named here rather than surfacing as a confusing EXTRA.
    const v = simEventVerdict(sets(['levelup']), sets(['levelup', 'notAnEvent']), []);
    expect(v.emitsOutsideUnion).toEqual(['notAnEvent']);
    expect(v.failed).toBe(true);
  });

  it('pins the shipped list as the server-side set, non-empty and sorted', () => {
    expect(SIM_EVENT_UNION_ONLY).toEqual([
      'calendarResult',
      'deedBroadcast',
      'guildInvite',
      'guildInviteCancelled',
      'guildRenamed',
      'motdResult',
      'reliquaryIlluminationBroadcast',
    ]);
  });
});

describe('contentIdRows: the reused-id blind spot the class exists to close', () => {
  // Phase 11d QA pin audit: the CLASSES.length 5-to-6 pin below covers the class
  // NAME only. Deleting the row collection, or degrading its key from `file:id`
  // back to the bare `id`, left every other arm green and silently reopened the
  // hole. These arms pin the BEHAVIOUR, over the exact shape that produced it:
  // farm_crops.ts and items.ts both define 'bog_beet'.
  const CROPS = 'src/sim/content/farm_crops.ts';
  const ITEMS = 'src/sim/content/items.ts';
  const tree = (cropRow: string) =>
    censusTree([
      [CROPS, `export const FARM_CROPS = [\n  { ${cropRow} },\n];`],
      [ITEMS, "export const ITEMS = [\n  { id: 'bog_beet' },\n  { id: 'iron_bar' },\n];"],
    ]);

  it('keys rows by file:id, so one reused id is TWO rows and one bare name', () => {
    const t = tree("id: 'bog_beet'");
    // The bare-name class collapses the two definitions into one member...
    expect([...t.sets.contentIds.keys()].sort()).toEqual(['bog_beet', 'iron_bar']);
    // ...while the row class keeps them apart. This is the whole difference; a
    // key degraded to the bare id makes these two assertions the same set.
    expect([...t.sets.contentIdRows.keys()].sort()).toEqual([
      `${CROPS}:bog_beet`,
      `${ITEMS}:bog_beet`,
      `${ITEMS}:iron_bar`,
    ]);
  });

  it('reports a DROPPED row that the bare-name class cannot see', () => {
    const parent = tree("id: 'bog_beet'");
    // The merge drops the CROP row; the item row of the same id survives.
    const merged = tree('id: someVar');
    const cmp = compareCensus({
      ours: parent,
      theirs: parent,
      merged,
      deletionRows: [],
      releases: [],
      base: null,
    });
    // The bare name is still present via items.ts, so the old class is blind...
    expect(cmp.perClass.contentIds.missing).toEqual([]);
    // ...and the row class names the exact row that went missing.
    expect(cmp.perClass.contentIdRows.missing.map((m: { name: string }) => m.name)).toEqual([
      `${CROPS}:bog_beet`,
    ]);
    expect(cmp.failed).toBe(true);
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
    // Six since the Phase 11d QA gate review: contentIdRows joined the five,
    // keyed file:id, because the bare-name contentIds class cannot see a
    // dropped table ROW when the id is reused in another table.
    expect(CLASSES.length).toBe(6);
    expect(CLASSES).toContain('contentIdRows');
    for (const cls of CLASSES) {
      for (const side of ['ours', 'theirs', 'release'] as const) {
        const floor = FLOORS[cls][side];
        expect(Number.isInteger(floor)).toBe(true);
        expect(floor).toBeGreaterThan(0);
      }
    }
  });
});
