import { describe, expect, it } from 'vitest';
import {
  BLOCK_HEADS,
  BLOCK_MODIFIERS,
  duplicateSiblingBlocks,
  testBlockCalls,
} from './test_block_calls';

// The paired test for the block walk behind tests/duplicate_test_blocks.test.ts.
//
// It carries the whole contract, because the real tree cannot: `tests/` passes
// every case below by construction, so nothing the guard asserts over it would
// change if the sibling rule, the outer-call rule or the modifier allowlist
// broke. Only planted sources reach those arms.

describe('testBlockCalls', () => {
  it('names every vitest head and modifier, pinned to literals', () => {
    // The lists themselves, before anything iterates them. A sweep `for (const
    // head of BLOCK_HEADS)` cannot notice a name LEAVING the list, it just runs
    // one case fewer and stays green: the mutation battery for this guard
    // dropped `suite` and nothing failed. That is the constant-self-comparison
    // trap, and only literals close it.
    //
    // Losing a head or a modifier is a silent narrowing, not a crash: the calls
    // it used to resolve stop being blocks, leave the duplicate scan, and take
    // their duplicates with them.
    expect([...BLOCK_HEADS]).toEqual(['describe', 'it', 'test', 'suite']);
    expect([...BLOCK_MODIFIERS]).toEqual([
      'concurrent',
      'each',
      'extend',
      'fails',
      'for',
      'only',
      'runIf',
      'scoped',
      'sequential',
      'skip',
      'skipIf',
      'todo',
    ]);
  });

  it('resolves every head and modifier it claims to', () => {
    // Each element of both exported lists put to a source that uses it, so a
    // name added to either list without a real spelling behind it fails here.
    // The literal pin above is what makes this sweep decisive in the other
    // direction, by fixing the list it walks.
    for (const head of BLOCK_HEADS) {
      const { blocks } = testBlockCalls(`${head}('x', () => {\n  expect(1).toBe(1);\n});\n`);
      expect(
        blocks.map((b) => b.head),
        head,
      ).toEqual([head]);
    }
    for (const modifier of BLOCK_MODIFIERS) {
      const { blocks, unresolved } = testBlockCalls(
        `it.${modifier}('x', () => {\n  expect(1).toBe(1);\n});\n`,
      );
      expect(unresolved, modifier).toEqual([]);
      expect(
        blocks.map((b) => b.chain.join('.')),
        modifier,
      ).toEqual([modifier]);
    }
  });

  it('records the outer call of a TAGGED-TEMPLATE each, the other spelling of a table', () => {
    // `describe.each` and `it.each` also take a template-literal table, and that
    // spelling reaches two arms nothing else here does: the tagged-template arm
    // of the head resolver, and the tagged-template arm of the callee-link test.
    // Both are deletable while the whole suite is green today, because the repo
    // happens to use only the array form. It is the same false-positive shape as
    // the array case one door over: two blocks sharing a table are identical up
    // to the closing backtick, so a walk that recorded the TAG instead of the
    // call would report them as duplicates of each other.
    const source = [
      'describe.each`',
      '  a    | b',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the table row is the fixture
      '  ${1} | ${2}',
      "`('first $a', ({ a }) => {",
      '  expect(a).toBe(1);',
      '});',
      'describe.each`',
      '  a    | b',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the table row is the fixture
      '  ${1} | ${2}',
      "`('second $a', ({ a }) => {",
      '  expect(a).toBe(1);',
      '});',
    ].join('\n');
    const { blocks } = testBlockCalls(source);
    expect(blocks.map((b) => `${b.head}.${b.chain.join('.')} ${b.line}-${b.endLine}`)).toEqual([
      'describe.each 1-6',
      'describe.each 7-12',
    ]);
    expect(duplicateSiblingBlocks(source)).toEqual([]);
    // ...and the same block twice, table and all, is still caught.
    const lines = source.split('\n').slice(0, 6);
    expect(
      duplicateSiblingBlocks(`${lines.join('\n')}\n${lines.join('\n')}`).map((d) => d.repeat),
    ).toEqual(['7-12']);
  });

  it('records a block whose result is used, not the property access on it', () => {
    // The third callee-link arm: a call whose PARENT is a property access. It
    // matters more since the walk started threading the parent by hand instead of
    // reading `node.parent`, because the arm now depends on this module passing
    // the right node rather than on the compiler having set one.
    const source = [
      "const handle = describe('outer', () => {",
      "  it('inner', () => {",
      '    expect(1).toBe(1);',
      '  });',
      '}).id;',
    ].join('\n');
    const { blocks } = testBlockCalls(source);
    // The describe is still one block spanning its whole call, and the `.id`
    // access does not turn it into a link that gets skipped.
    expect(blocks.map((b) => `${b.head} ${b.line}-${b.endLine}`)).toEqual([
      'describe 1-5',
      'it 2-4',
    ]);
    expect(blocks[1].parent).not.toBe('root');
  });

  it('records the OUTER call of a modifier chain, never the inner one', () => {
    // `it.each(table)('name', fn)` holds two CallExpressions. Recording the inner
    // one reads `it.each([0, 2])` as the whole block, so two cases that merely
    // share a table look byte-identical while their bodies differ completely.
    // That single mistake produced 45 of the 47 findings the first cut of this
    // scan reported, every one of them false.
    const source = [
      "it.each([0, 2])('first %i', (n) => {",
      '  expect(n).toBeLessThan(3);',
      '});',
      "it.each([0, 2])('second %i', (n) => {",
      '  expect(n).toBeGreaterThan(-1);',
      '});',
    ].join('\n');
    const { blocks } = testBlockCalls(source);
    expect(blocks.map((b) => `${b.head}.${b.chain.join('.')} ${b.line}-${b.endLine}`)).toEqual([
      'it.each 1-3',
      'it.each 4-6',
    ]);
    expect(duplicateSiblingBlocks(source)).toEqual([]);
    // ...and a genuinely repeated each-block is still caught, so the case above
    // is not passing because modifier chains are simply skipped.
    const lines = source.split('\n').slice(0, 3);
    expect(
      duplicateSiblingBlocks(`${lines.join('\n')}\n${lines.join('\n')}`).map((d) => d.repeat),
    ).toEqual(['4-6']);
  });

  it('ignores a local rig bound to a block name, at any chain depth', () => {
    // The reason BLOCK_MODIFIERS is an allowlist rather than "walk to the root
    // identifier". Ten controller suites in this repo bind `test` to a rig
    // object, and repeated accessor calls on one are ordinary and correct.
    const source = [
      "it('drives the controller', () => {",
      '  const test = makeRig();',
      '  test.controller.update();',
      '  test.controller.update();',
      '  expect(test.attachTooltip.mock.calls.find((c) => c)).toBe(1);',
      '});',
    ].join('\n');
    const { blocks, unresolved } = testBlockCalls(source);
    expect(blocks.map((b) => b.head)).toEqual(['it']);
    expect(duplicateSiblingBlocks(source)).toEqual([]);
    // The nested accessor takes a callback, so it DOES reach the diagnostic, and
    // its chain reads back in source order rather than resolution order.
    expect(unresolved.map((u) => `${u.head}.${u.chain}`)).toEqual([
      'test.attachTooltip.mock.calls.find',
    ]);
  });

  it('reports a callback-taking chain it cannot resolve, so a new modifier is loud', () => {
    // The escape hatch tests/duplicate_test_blocks.test.ts watches over the real
    // tree. A modifier missing from BLOCK_MODIFIERS does not throw, it silently
    // stops resolving and takes its blocks out of the scan, so it has to surface
    // somewhere.
    const { blocks, unresolved } = testBlockCalls(
      "it.unheardOf('x', () => {\n  expect(1).toBe(1);\n});\n",
    );
    expect(blocks).toEqual([]);
    expect(unresolved).toEqual([{ head: 'it', chain: 'unheardOf', line: 1 }]);
  });

  it('groups a nested block under its own parent, not the file root', () => {
    // What makes the sibling comparison meaningful: two `it`s in different
    // describes must not share a bucket.
    const { blocks } = testBlockCalls(
      [
        "describe('outer', () => {",
        "  it('inner', () => {",
        '    expect(1).toBe(1);',
        '  });',
        '});',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.head)).toEqual(['describe', 'it']);
    expect(blocks[0].parent).toBe('root');
    expect(blocks[1].parent).not.toBe('root');
  });
});

describe('duplicateSiblingBlocks', () => {
  it('treats a repeat under a DIFFERENT parent as ordinary, not a duplicate', () => {
    // The load-bearing half of the sibling rule. Two describes can legitimately
    // run the same assertion body against different fixtures, and a file-wide
    // comparison would report every one of them.
    const source = [
      "describe('alpha', () => {",
      '  beforeEach(() => setUpAlpha());',
      "  it('holds', () => {",
      '    expect(subject()).toBe(1);',
      '  });',
      '});',
      "describe('beta', () => {",
      '  beforeEach(() => setUpBeta());',
      "  it('holds', () => {",
      '    expect(subject()).toBe(1);',
      '  });',
      '});',
    ].join('\n');
    expect(duplicateSiblingBlocks(source)).toEqual([]);
    // The same two `it` bodies under ONE parent is the defect, so the case above
    // is not passing merely because nothing in it matches.
    const sameParent = [
      "describe('alpha', () => {",
      "  it('holds', () => {",
      '    expect(subject()).toBe(1);',
      '  });',
      "  it('holds', () => {",
      '    expect(subject()).toBe(1);',
      '  });',
      '});',
    ].join('\n');
    expect(
      duplicateSiblingBlocks(sameParent).map((d) => `${d.head} ${d.first} ${d.repeat}`),
    ).toEqual(['it 2-4 5-7']);
  });

  it('compares source text, so identical bodies under different titles are distinct', () => {
    // Byte-identical is the rule, and the title is part of the text. Two blocks
    // that share a body but not a name are two tests, however much they overlap.
    expect(
      duplicateSiblingBlocks(
        [
          "describe('first name', () => {",
          "  it('x', () => {",
          '    expect(1).toBe(1);',
          '  });',
          '});',
          "describe('second name', () => {",
          "  it('x', () => {",
          '    expect(1).toBe(1);',
          '  });',
          '});',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('is byte-identical, so a one-character edit is not a duplicate', () => {
    // The other side of the same rule, and the reason this is not a similarity
    // measure: the defect it detects is a merge re-inserting a block VERBATIM,
    // and anything looser starts reporting blocks a person wrote on purpose.
    expect(
      duplicateSiblingBlocks(
        [
          "describe('a', () => {",
          "  it('one', () => {",
          '    expect(1).toBe(1);',
          '  });',
          '});',
          "describe('a', () => {",
          "  it('one', () => {",
          '    expect(1).toBe(2);',
          '  });',
          '});',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('reports the FIRST copy and the repeat, in that order, with a greppable title', () => {
    // The failure message is the whole product of this guard: it has to name the
    // file, both ranges and enough of the block for a reader to find it.
    const block = ["describe('the tradeoff (#1142)', () => {", '  body();', '});'].join('\n');
    expect(duplicateSiblingBlocks(`${block}\n\n${block}\n`)).toEqual([
      {
        head: 'describe',
        title: "describe('the tradeoff (#1142)', () => {",
        first: '1-3',
        repeat: '5-7',
      },
    ]);
  });

  it('reports a third copy against the first, so every repeat is listed', () => {
    // A file that gained the same block twice must not report one duplicate and
    // hide the other behind it.
    const block = ["describe('a', () => {", '  body();', '});'].join('\n');
    expect(duplicateSiblingBlocks([block, block, block].join('\n'))).toEqual([
      { head: 'describe', title: "describe('a', () => {", first: '1-3', repeat: '4-6' },
      { head: 'describe', title: "describe('a', () => {", first: '1-3', repeat: '7-9' },
    ]);
  });

  it('survives the shapes a hand-rolled scan gets wrong', () => {
    // Why this walks the AST (#2516). A lexer has to guess regex-versus-division
    // and mis-tracks apostrophes and braces inside strings; all three appear in
    // this repo's real test sources, and none of the errors is visible from a
    // green result. Here they are planted around a real duplicate: a scan that
    // desynchronized on any of them would report the wrong range, or nothing.
    const source = [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the fixture
      "describe('quotes: the mob\\'s tap, a / b, `${x}`', () => {",
      "  it('matches /a{2}\\\\/b/ and { unbalanced', () => {",
      '    expect(`a } b`.replace(/x{1}/g, "}")).toBe(9 / 3);',
      '  });',
      '});',
      '',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the fixture
      "describe('quotes: the mob\\'s tap, a / b, `${x}`', () => {",
      "  it('matches /a{2}\\\\/b/ and { unbalanced', () => {",
      '    expect(`a } b`.replace(/x{1}/g, "}")).toBe(9 / 3);',
      '  });',
      '});',
    ].join('\n');
    expect(duplicateSiblingBlocks(source).map((d) => `${d.first} ${d.repeat}`)).toEqual([
      '1-5 7-11',
    ]);
  });

  it('is empty for a source with no blocks at all, rather than throwing', () => {
    expect(duplicateSiblingBlocks('export const x = 1;\n')).toEqual([]);
    expect(testBlockCalls('export const x = 1;\n')).toEqual({ blocks: [], unresolved: [] });
  });
});
