import { describe, expect, it } from 'vitest';
import { codeWithoutLineComments } from './code_without_line_comments';

// The helper every source-scan pin in the suite now reads through. Pinned here
// rather than only through those consumers: each of them asserts on the code it
// names, so a helper that quietly returned its input unchanged would leave all
// of them green while the thing they exist to catch (a commented-out line
// satisfying the pin) came back.
describe('codeWithoutLineComments', () => {
  it('drops a full-line comment so it cannot satisfy a pin', () => {
    const source = ['const a = 1;', '// const b = 2;', 'const c = 3;'].join('\n');
    expect(codeWithoutLineComments(source)).toBe(['const a = 1;', 'const c = 3;'].join('\n'));
  });

  it('drops an indented comment too, which is where commented-out code lives', () => {
    const source = ['function f() {', '    // this.fireLights.push(light);', '}'].join('\n');
    expect(codeWithoutLineComments(source)).not.toContain('fireLights.push');
  });

  it('keeps the statement in front of a trailing comment', () => {
    // Full lines only, deliberately: a pin matches the statement, and stripping
    // from the first `//` anywhere would cut real code out of any line that
    // contains one (a URL in a string, for instance).
    expect(codeWithoutLineComments('const a = 1; // why')).toBe('const a = 1; // why');
    expect(codeWithoutLineComments("const url = 'https://example.test/';")).toBe(
      "const url = 'https://example.test/';",
    );
  });

  it('leaves line structure otherwise intact so index-ordering pins still hold', () => {
    // Several consumers compare indexOf positions, so the surviving lines must
    // keep their order and their newlines.
    const source = ['a', '// x', 'b', '', 'c'].join('\n');
    expect(codeWithoutLineComments(source).split('\n')).toEqual(['a', 'b', '', 'c']);
  });
});
