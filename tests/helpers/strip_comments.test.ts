import { describe, expect, it } from 'vitest';
import { stripComments } from './strip_comments';

// The helper is load-bearing for every consumer's negative sweep: a
// regression that returned the input unchanged, or that re-introduced the
// block-first ordering, would soften many pins at once with nothing going
// red. Each case below pins one clause of the contract.
describe('strip_comments helper', () => {
  it('strips a line comment containing a bare /* WITHOUT opening a phantom block', () => {
    const src = [
      'const before = 1;',
      '// routes under /api/claudium/* are described here',
      'const mustSurvive = 2;',
      '/* a real block */',
      'const after = 3;',
    ].join('\n');
    const out = stripComments(src);
    // The block-first ordering swallows mustSurvive (the bare /* opens a
    // bogus block closed only by the real block's closer). Line-first or
    // single-pass keeps it.
    expect(out).toContain('const mustSurvive = 2;');
    expect(out).toContain('const after = 3;');
    expect(out).not.toContain('routes under');
  });

  it('a // inside a block comment cannot eat the block closer (the mirrored trap)', () => {
    const src = 'const a = 1; /* note // still a block */ const b = 2;';
    const out = stripComments(src);
    expect(out).toContain('const a = 1;');
    expect(out).toContain('const b = 2;');
    expect(out).not.toContain('still a block');
  });

  it('removes commented-out code in both comment forms', () => {
    const src = [
      '// const dead1 = encode();',
      '/* const dead2 = encode(); */',
      'const live = 1;',
    ].join('\n');
    const out = stripComments(src);
    expect(out).not.toContain('dead1');
    expect(out).not.toContain('dead2');
    expect(out).toContain('const live = 1;');
  });

  it('strips a line comment that immediately follows a block closing marker', () => {
    // The consuming-guard form (^|[^:]) needs one unclaimed character before
    // the //, and the block arm has already eaten the terminator's slash, so
    // the trailing line comment survived and its text could satisfy a
    // positive source pin. The lookbehind guard closes exactly this.
    const src = 'const a = 1; /* b *///  phantomPinToken';
    const out = stripComments(src);
    expect(out).toContain('const a = 1;');
    expect(out).not.toContain('phantomPinToken');
  });

  it('keeps protocol strings intact (the #2499 colon guard)', () => {
    const src = "const url = 'https://example.test/path'; // trailing note";
    const out = stripComments(src);
    expect(out).toContain("const url = 'https://example.test/path';");
    expect(out).not.toContain('trailing note');
  });

  it('preserves line count and blanks block comments to spaces (offset safety)', () => {
    const src = 'a();\n/* two\nline block */\nb(); // tail';
    const out = stripComments(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    // The block bytes are blanked, not deleted, so following columns hold.
    expect(out.split('\n')[1]).toBe('      ');
    expect(out).toContain('b();');
    expect(out).not.toContain('tail');
  });
});
