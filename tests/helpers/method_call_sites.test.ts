import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeCondition, readMethodCallSites } from './method_call_sites';

// The paired test for the source walk `tests/hud_update_drive.test.ts` runs on.
//
// It exists for the reason `scan_guard_self_audit.test.ts` states: production source never
// exercises a guard's helper into its corners, so an arm can be deleted with the whole suite
// green (#2499, #2502). Every case below is a SYNTHETIC source, never `src/ui/hud.ts`: the
// walker takes a string precisely so its branches can be reached from a fixture, and a test
// that drove it over the real coordinator would only ever prove the tree it already passes on.
//
// The fixture list is pinned against the type guards the walker actually calls, so an arm
// added without a case fails here rather than shipping unexercised.

const wrap = (body: string, name = 'update'): string =>
  `export class Widget {\n  ${name}(): void {\n${body}\n  }\n}\n`;

const callsIn = (body: string): string[] =>
  readMethodCallSites('w.ts', wrap(body), 'Widget', 'update').sites.map((s) => s.call);

const sitesIn = (body: string) => readMethodCallSites('w.ts', wrap(body), 'Widget', 'update').sites;

/**
 * One case per walker arm. The label is the `ts.is*` guard it drives, which is what the
 * completeness pin at the bottom matches against the helper's own source.
 */
const ARM_FIXTURES: ReadonlyArray<readonly [string, string, string[]]> = [
  ['isClassDeclaration', 'this.a();', ['this.a']],
  ['isMethodDeclaration', 'this.a();', ['this.a']],
  ['isExpressionStatement', 'this.a();\nfreeFn();', ['this.a', 'freeFn']],
  ['isBlock', '{\n  this.a();\n}', ['this.a']],
  ['isIfStatement', 'if (open) this.a();', ['this.a']],
  ['isForStatement', 'for (let i = 0; i < 3; i++) this.a();', ['this.a']],
  ['isForOfStatement', 'for (const e of list) this.a();', ['this.a']],
  ['isForInStatement', 'for (const k in map) this.a();', ['this.a']],
  ['isWhileStatement', 'while (go) this.a();', ['this.a']],
  ['isDoStatement', 'do { this.doOnce(); } while (go);', ['this.doOnce']],
  ['isLabeledStatement', 'outer: { this.a(); }', ['this.a']],
  [
    'isTryStatement',
    'try { this.a(); } catch (e) { this.b(); } finally { this.c(); }',
    ['this.a', 'this.b', 'this.c'],
  ],
  [
    'isSwitchStatement',
    'switch (k) {\n  case 1:\n    this.a();\n    break;\n  default:\n    this.b();\n}',
    ['this.a', 'this.b'],
  ],
  ['isVariableStatement', 'const v = this.build();', ['this.build']],
  ['isReturnStatement', 'return this.build();', ['this.build']],
  ['isThrowStatement', 'throw this.buildError();', ['this.buildError']],
  ['isBinaryExpression', 'this.last = this.marker.mark(x);', ['this.marker.mark']],
  ['isConditionalExpression', 'const v = ok ? this.a() : this.b();', ['this.a', 'this.b']],
  ['isIdentifier', 'freeFunction();', ['freeFunction']],
  ['isPropertyAccessExpression', 'this.win.render();', ['this.win.render']],
  ['isElementAccessExpression', "this.rows['first'].paint();", ['this.rows[].paint']],
  [
    'isCallExpression',
    "document.getElementById('x').classList.toggle('on');",
    ['document.getElementById().classList.toggle'],
  ],
  ['isNonNullExpression', 'this.win!.render();', ['this.win.render']],
  ['isParenthesizedExpression', '(this.win).render();', ['this.win.render']],
  ['isAwaitExpression', 'await this.save();', ['this.save']],
  ['isVoidExpression', 'void this.probe();', ['this.probe']],
  ['isAsExpression', 'const v = this.build() as string;', ['this.build']],
  ['isSatisfiesExpression', 'const v = this.build() satisfies string;', ['this.build']],
  // Not a `ts.is*` call in the helper (the root is matched on SyntaxKind), so it is listed
  // in ROOT_ARMS below and pinned the same way.
  ['ThisKeyword', 'this.a();', ['this.a']],
];

/** Arms the helper matches by `SyntaxKind` rather than through a `ts.is*` guard. */
function rootArms(helperSource: string): string[] {
  // The `node.kind === ts.SyntaxKind.X` shape specifically, which is how a callee-chain arm
  // gets matched without a `ts.is*` guard and so without needing a fixture. A bare
  // `ts.SyntaxKind.X` is a different thing (an operator kind compared against
  // `operatorToken.kind`, or a member of the ASSIGNMENT_OPS set), and those arms have their
  // own cases below rather than an entry in this list.
  return [
    ...new Set([...helperSource.matchAll(/\.kind === ts\.SyntaxKind\.(\w+)/g)].map((m) => m[1])),
  ];
}

/**
 * The bodies every fixture shares because EVERY case exercises them: a class, a method and
 * the `this` root. Any OTHER two arms sharing a body means one of them is not being driven,
 * which is what let a fixture be replaced by a copy-paste and stay green.
 */
const STRUCTURAL_ARMS = ['isClassDeclaration', 'isMethodDeclaration', 'ThisKeyword'];

describe('readMethodCallSites: statement position', () => {
  it('records the statement head and NOT the calls nested inside it', () => {
    // The distinction the whole registry rests on: this is ONE drive, not two. The inner
    // tick() is an argument the painter consumes, on the painter's cadence, not a second
    // thing `update()` drives.
    expect(callsIn('this.painter.paint(this.view.tick({ a: 1 }));')).toEqual([
      'this.painter.paint',
    ]);
  });

  it('does not descend into a callback body', () => {
    // A one-shot the callback owns is not a per-frame drive. Recording `this.hide` here
    // would be a lie about cadence, and it is exactly the shape `update()` contains.
    expect(callsIn('window.setTimeout(() => this.hide(), 8000);')).toEqual(['window.setTimeout']);
    expect(callsIn('list.forEach(function (e) {\n  this.paint(e);\n});')).toEqual(['list.forEach']);
  });

  it('ignores a statement that evaluates no call', () => {
    expect(
      callsIn(
        ['this.lastZone = zone.id;', "this.el.innerHTML = '';", 'let n = 1;', 'return;'].join('\n'),
      ),
    ).toEqual([]);
  });

  it('ignores a callee that is not a plain member chain', () => {
    // Returning nothing beats guessing a name: a registry keyed on a guess would pair the
    // wrong row with the wrong call and read as if it had checked something.
    expect(callsIn('(cond ? this.a : this.b)();')).toEqual([]);
  });

  it('normalizes an optional link and keeps an intermediate call visible', () => {
    expect(callsIn("document.getElementById('x')?.classList.toggle('on', v);")).toEqual([
      'document.getElementById().classList.toggle',
    ]);
    expect(callsIn('this.win?.render();')).toEqual(['this.win.render']);
  });

  it('reports 1-based lines in the WHOLE file, not in the extracted body', () => {
    const src = wrap('\nthis.a();');
    const [only] = readMethodCallSites('w.ts', src, 'Widget', 'update').sites;
    expect(only.line).toBe(4);
    expect(src.split('\n')[only.line - 1]).toContain('this.a();');
  });
});

describe('readMethodCallSites: value slots', () => {
  it('records a call the statement stores, not only one it makes for effect', () => {
    // The hole that shipped in the first cut of this walk: `const musicState =
    // this.instanceMusic.update({...})` in Hud.update() is a real drive, and a head-only
    // walk saw nothing. So is `this.lastFoo = this.someWindow.render()`, which is how a
    // repaint sneaks past a registry that only reads statement heads.
    expect(callsIn('const music = this.music.update({ now: 1 });')).toEqual(['this.music.update']);
    expect(callsIn('this.lastText = this.marker.mark(text);')).toEqual(['this.marker.mark']);
    expect(callsIn('return this.win.render();')).toEqual(['this.win.render']);
  });

  it('records ONLY a call on `this` in a value slot', () => {
    // A bare producer in a value slot is the same shape as an argument, which this walk
    // already declines: registering `xpBarView({...})` and `zoneAt(z)` would bury the
    // question the registry exists to answer under two dozen rows of formatters. A call on
    // `this` in that same slot is the coordinator doing something, which IS the question.
    expect(callsIn('const bar = xpBarView({ level: 1 });')).toEqual([]);
    expect(callsIn('const zone = zoneAt(p.pos.z);')).toEqual([]);
    expect(callsIn('const e = sim.entities.get(id);')).toEqual([]);
    expect(callsIn('const t = this.fxTier();')).toEqual(['this.fxTier']);
    // ...but a statement whose whole purpose IS the call is a side effect whatever its
    // callee, so the effect slot keeps the wider rule.
    expect(callsIn("document.body.classList.toggle('x', on);")).toEqual([
      'document.body.classList.toggle',
    ]);
  });

  it('adds a short-circuit or ternary test to the condition chain', () => {
    // `&&` / `||` / `??` / `?:` decide WHETHER the call runs, exactly as an enclosing `if`
    // does, so they belong in the chain rather than being flattened away. Without this,
    // `open && this.win.render()` would register as an unconditional per-frame repaint.
    expect(sitesIn('open && this.win.render();')[0].conditions).toEqual(['open']);
    expect(sitesIn('cached || this.win.render();')[0].conditions).toEqual(['!(cached)']);
    expect(sitesIn('const v = cached ?? this.win.render();')[0].conditions).toEqual([
      'cached == null',
    ]);
    expect(sitesIn('if (slowHud) open && this.win.render();')[0].conditions).toEqual([
      'slowHud',
      'open',
    ]);
    const both = sitesIn('ok ? this.a() : this.b();');
    expect(both.map((s) => [s.call, s.conditions])).toEqual([
      ['this.a', ['ok']],
      ['this.b', ['!(ok)']],
    ]);
  });

  it('does not follow a call argument, a comparison operand, or a loop header', () => {
    expect(callsIn('this.painter.paint(this.view.tick(x));')).toEqual(['this.painter.paint']);
    expect(callsIn('const changed = this.sigOf(a) !== this.last;')).toEqual([]);
    expect(callsIn('for (const e of this.sim.entities.values()) this.paint(e);')).toEqual([
      'this.paint',
    ]);
    // An `if` header is not a gap: it is already pinned verbatim in the condition chain of
    // everything it guards, so recording it again would double-count it.
    expect(sitesIn('if (this.isOpen()) this.win.render();')).toEqual([
      { call: 'this.win.render', line: 3, conditions: ['this.isOpen()'] },
    ]);
  });
});

describe('readMethodCallSites: the condition chain', () => {
  it('carries enclosing conditions outermost first', () => {
    expect(sitesIn('if (slowHud) {\n  if (open) this.render();\n}')[0].conditions).toEqual([
      'slowHud',
      'open',
    ]);
  });

  it('records an else arm as the negation, so the two arms never merge', () => {
    const sites = sitesIn('if (target) {\n  this.paint();\n} else {\n  this.hide();\n}');
    expect(sites.map((s) => [s.call, s.conditions])).toEqual([
      ['this.paint', ['target']],
      ['this.hide', ['!(target)']],
    ]);
  });

  it('threads an else-if chain', () => {
    const sites = sitesIn(
      [
        'if (a) {',
        '  this.x();',
        '} else if (b) {',
        '  this.y();',
        '} else {',
        '  this.z();',
        '}',
      ].join('\n'),
    );
    expect(sites.map((s) => s.conditions)).toEqual([['a'], ['!(a)', 'b'], ['!(a)', '!(b)']]);
  });

  it('leaves a loop or try header out of the chain', () => {
    expect(sitesIn('for (const e of list) {\n  this.paint(e);\n}')[0].conditions).toEqual([]);
    expect(sitesIn('try {\n  this.paint();\n} catch (e) {}')[0].conditions).toEqual([]);
  });

  it('normalizes a condition biome reflowed, and strips a comment inside it', () => {
    // biome breaks a long condition across lines the moment it grows a character, and adds a
    // trailing comma to the argument list it broke. A key that kept either would flip on a
    // reformat, so both are normalized away.
    const inline = sitesIn('if (sigOf(a, b) !== this.last) this.render();')[0].conditions;
    const broken = sitesIn(
      'if (\n  sigOf(\n    a,\n    b,\n  ) !== this.last\n)\n  this.render();',
    )[0].conditions;
    expect(broken).toEqual(inline);
    expect(broken).toEqual(['sigOf(a, b) !== this.last']);
    expect(sitesIn('if (a /* why */ && b) this.render();')[0].conditions).toEqual(['a && b']);
    // The BRACKET halves of the two padding rules, and the trailing-comma rule, match nothing
    // in the live tree, so each could be deleted with everything green.
    expect(normalizeCondition('rows[\n  i,\n] && f(\n  a ,\n)')).toBe('rows[i] && f(a)');
  });

  it('normalizeCondition leaves a URL protocol alone', () => {
    // The line-comment strip this repo has already shipped wrong once (#2499): a bare
    // `//` rule eats the rest of the line starting at `https://`.
    expect(normalizeCondition("u === 'https://example.com/a' // note")).toBe(
      "u === 'https://example.com/a'",
    );
  });
});

describe('readMethodCallSites: refusals and counts', () => {
  const missing = (fn: () => unknown, re: RegExp): void => expect(fn).toThrow(re);

  it('THROWS on a missing class or method rather than returning an empty scan', () => {
    // The load-bearing refusal. The hazard #2498 named is `update()` being extracted behind a
    // controller, and a resolver that answered "no calls" would hand the gate a clean, empty,
    // passing scan of nothing.
    missing(
      () => readMethodCallSites('w.ts', wrap('this.a();'), 'Gone', 'update'),
      /class Gone not found/,
    );
    missing(
      () => readMethodCallSites('w.ts', wrap('this.a();'), 'Widget', 'tick'),
      /Widget\.tick\(\) not found/,
    );
    missing(
      () =>
        readMethodCallSites(
          'w.ts',
          'export class Widget {\n  update(): void;\n}\n',
          'Widget',
          'update',
        ),
      /has no body/,
    );
    // Both messages tell the reader what to do, which is the difference between a refusal and
    // a wall.
    missing(
      () => readMethodCallSites('w.ts', wrap('this.a();'), 'Widget', 'tick'),
      /renamed or extracted/,
    );
  });

  it('counts class members exactly, template literals included', () => {
    const src = [
      'export class Widget {',
      '  private a = 1;',
      '  private b: string | null = null;',
      '  private c = `',
      '  width: 100%;',
      '  height: 100%;',
      '  `;',
      '  private d: Map<string, number> = new Map();',
      '  get e(): number { return 1; }',
      '  set f(v: number) { void v; }',
      '  constructor() {}',
      '  update(): void { this.g(); }',
      '  private g(): void {}',
      '}',
    ].join('\n');
    // The indentation-and-regex counter this replaced read the two CSS lines inside the
    // template literal as fields, and the `;` inside `Map<string, number>` as a member break.
    expect(readMethodCallSites('w.ts', src, 'Widget', 'update').classMembers).toBe(9);
  });

  it('measures the body span in lines', () => {
    expect(
      readMethodCallSites('w.ts', wrap('this.a();\nthis.b();'), 'Widget', 'update').bodyLines,
    ).toBe(4);
    expect(readMethodCallSites('w.ts', wrap('this.a();'), 'Widget', 'update').bodyLines).toBe(3);
  });

  it('walks a body holding regex literals with quotes and escaped slashes', () => {
    // The case that decided this module is an AST walk rather than a lexer: `src/ui/hud.ts`
    // holds about a hundred of these in its server-text matchers, and a hand-rolled scan has
    // to guess regex-versus-division from the preceding token to get past them.
    expect(
      callsIn(
        [
          "const m = /^You can't do that in (Bruin|Wolf) Form\\.$/.exec(text);",
          'const n = /^Unknown command: (.+?)\\. Try \\/.*$/.exec(text);',
          'const ratio = a.hp / Math.max(1, a.maxHp);',
          'this.paint(ratio, m, n);',
        ].join('\n'),
      ),
    ).toEqual(['this.paint']);
  });
});

describe('the fixture list covers every walker arm', () => {
  it('drives each arm and gets the call it names', () => {
    for (const [label, body, expected] of ARM_FIXTURES) {
      expect(callsIn(body), `the ${label} arm`).toEqual(expected);
    }
  });

  it('has a fixture for every type guard the walker calls', () => {
    // Without this, an arm added later is pinned by nothing: every other assertion here names
    // its own case, so a new branch simply goes unvisited (#2497's unfixtured-matcher hole,
    // one file over). Reading the helper's OWN source is what makes the list two-directional.
    const helper = readFileSync(
      fileURLToPath(new URL('./method_call_sites.ts', import.meta.url)),
      'utf8',
    );
    // Comments stripped FIRST: a doc comment that names a guard the walker deliberately
    // does NOT call would otherwise demand a fixture for an arm that does not exist, and a
    // guard mentioned only in prose would satisfy the pin with no arm behind it. This repo
    // has shipped the un-stripped version of that pin before (#2499).
    const guards = [...normalizeCondition(helper).matchAll(/ts\.is([A-Za-z]+)\(/g)].map(
      (m) => `is${m[1]}`,
    );
    expect(
      guards.length,
      'the walker stopped using ts.is* guards: re-derive this pin',
    ).toBeGreaterThan(15);
    expect([...new Set([...guards, ...rootArms(normalizeCondition(helper))])].sort()).toEqual(
      [...new Set(ARM_FIXTURES.map(([label]) => label))].sort(),
    );
  });

  it("gives each arm its OWN fixture body, not a copy of another arm's", () => {
    // The label-to-body binding is otherwise decorative: swap the `isDoStatement` body for
    // `this.a();`, keep the label, and the completeness pin above still passes while the arm
    // goes unexercised. Same class as a matcher pinned by label rather than by identity.
    const bodies = ARM_FIXTURES.filter(([label]) => !STRUCTURAL_ARMS.includes(label)).map(
      ([, body]) => body,
    );
    expect(new Set(bodies).size, 'two arms share a fixture body: one of them is not driven').toBe(
      bodies.length,
    );
    // ...and the three allowed to share are pinned by name, so the exemption cannot widen.
    expect(
      ARM_FIXTURES.filter(([label]) => STRUCTURAL_ARMS.includes(label)).map(([label]) => label),
    ).toEqual(STRUCTURAL_ARMS);
  });

  it('records the right side of EVERY assignment operator it lists', () => {
    // Eight of the nine ASSIGNMENT_OPS entries match nothing in the live tree, so the set
    // could be cut to `=` alone with everything green, and a repaint written as
    // `this.total += this.paintAndCount()` would leave the registry entirely.
    const operators = ['=', '+=', '-=', '*=', '/=', '%=', '&&=', '||=', '??='];
    for (const op of operators) {
      expect(callsIn(`this.n ${op} this.compute();`), `the ${op} arm`).toEqual(['this.compute']);
    }
    // The comma arm is the same shape and equally unexercised by the live tree: without a
    // case, deleting it loses the second call of a sequence expression silently.
    expect(callsIn('this.a(), this.b();')).toEqual(['this.a', 'this.b']);
    const helper = readFileSync(
      fileURLToPath(new URL('./method_call_sites.ts', import.meta.url)),
      'utf8',
    );
    const from = helper.indexOf('ASSIGNMENT_OPS = new Set');
    const listed = helper.slice(from, helper.indexOf(']);', from));
    expect(
      (listed.match(/ts\.SyntaxKind\./g) ?? []).length,
      'ASSIGNMENT_OPS grew or shrank: give every operator in it a case above',
    ).toBe(operators.length);
  });
});
