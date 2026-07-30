import ts from 'typescript';

// The other half of #2498's rule, and the thing a granted driver allowance was missing:
// given one module source, resolve WHAT ACTUALLY RUNS on each tick of a repeating driver
// it arms (`setInterval`, `requestAnimationFrame`, `requestIdleCallback`).
//
// WHY A CALLBACK BODY IS NOT THE ANSWER, measured rather than assumed. The obvious reading
// of the rule is "scan the body of the callback", and over this tree that scan is VACUOUS:
// all three live driver callbacks contain zero writes and zero queries, because each one is
// a guard plus a call to a method. `lockpick_window`'s clock, the defect that motivated the
// rule, reads in full as
//
//     window.setInterval(() => {
//       if (gen !== this.timerGen) return;
//       const remaining = Math.max(0, (end - performance.now()) / 1000);
//       this.paintTimer(remaining, seconds);
//       if (remaining <= 0) this.stopTimer();
//     }, 100);
//
// and every one of the three `querySelector` walks and the unelided `classList.toggle` the
// issue is about lived in `paintTimer`, one call away. A body-only scan would have been
// green on the exact source that motivated writing it. So the unit here is the callback body
// PLUS the body of every same-module function it can reach, transitively.
//
// THE REACHABILITY RULE, and how it deliberately differs from `method_call_sites.ts`. That
// walk answers "what does `Hud.update()` DRIVE", so it declines call arguments (a producer
// feeding a painter is not a second drive) and declines nested function bodies (a callback
// registered inside `update()` runs on someone else's cadence). This walk answers a different
// question, "what CODE does one tick execute", so it follows every callee it can see:
//   - a call in an argument position IS evaluated on the tick, so it is followed;
//   - a callee named inside a nested arrow IS followed, because the alternative hands anyone
//     a one-line way out of the scan (`rows.forEach(() => this.write(el))` would otherwise
//     put every write behind a callback the walk refuses to enter);
//   - a property access on `this` is followed as a possible GETTER, since `if (this.isOpen)`
//     runs `get isOpen()`'s body, `style` read and all;
//   - a LOCAL BOUND TO `this` OR TO AN OBJECT LITERAL reads like `this` (`const self = this;
//     self.paintTimer()`, `const ui = { paint() {} }; ui.paint()`), and the
//     `['paintTimer']()` spelling reads as the `.paintTimer()` one, because both are the same
//     same-module call wearing a shape a narrower walk cannot see. The computed form matters
//     most: every matcher family in the consuming gate carries a `['computed']` arm to close
//     exactly that escape for property writes, so leaving it open for CALLEES would let a
//     write hop behind `this['paintTimer']()` and out of a gate that catches `el['style']`;
//   - a name resolving to more than one body (two classes in one file with the same method
//     name) pulls in ALL of them, since guessing between them would silently scan the wrong
//     one.
// Every one of those is the OVER-approximating direction: a handler registered during a tick
// is scanned as though the tick ran it. That is the safe direction for a budget, and it is
// the same trade the `getUiScale` proxy token in `tests/hud_perf_budget.test.ts` already
// makes.
//
// WHAT IT DOES NOT REACH, stated rather than implied, because a resolver that shrugs is the
// failure mode this file exists to avoid. FIRST, another MODULE: `this.deps.root()` and an
// imported helper are out of range, exactly as the per-file scans in that gate are, and a
// write moved behind one is invisible here. SECOND, a callee reached through a value this walk
// cannot name: a method plucked into a local (`const paint = obj.paint; paint()` resolves only
// if some same-module body happens to be named `paint`), a dynamic `this[key]()`, or a call on
// an object handed in from outside. The asymmetry with the CALLBACK resolver is deliberate and
// is the honest reading of the anti-vacuity rule: an unresolvable callback means the tick is
// wholly unknown, so it THROWS; an unresolvable callee inside a known tick means one branch of
// it is unknown, which no source walk can rule out in general, so the walk records what it can
// and this paragraph says what it cannot.
//
// THE CUT, and why it is declarable. A driver whose callback calls the module's ordinary
// full-render entry point reaches the whole module, and counting that would re-litigate the
// question the cold bucket already settled: a COUNT over a render path fails on every
// ordinary edit while the hazard it is meant to catch moves no count at all. So `stopAt`
// names the methods where the walk stops, the caller records WHY next to the name, and the
// gate fails a cut that turns out to be dead. What survives the cut is the tick's own work,
// which is the thing the driver is actually responsible for.
//
// It takes a STRING rather than a path and knows about no particular module, so the paired
// test drives it over synthetic sources with planted shapes. This repo's standing lesson
// about scan guards (#2497, #2499, #2502) is that a producer resolving its own input can
// only ever be proven against the tree it already passes on.

/** One resolved repeating-driver call site and everything one of its ticks can reach. */
export interface DriverCallback {
  /** The driver armed, spelled as the source spells it: `setInterval`, ... */
  readonly driver: string;
  /** 1-based line of the driver call. Consumed by the gate's failure messages, never pinned
   * against the real tree (a line number rots); the paired test pins it on synthetic input. */
  readonly line: number;
  /**
   * The cadence argument as a number: a literal (`100`, `15_000`) or a module-level `const`
   * holding one, else null. `requestAnimationFrame` / `requestIdleCallback` take no delay, so
   * they are always null. A caller pins this, which is what makes a declared cadence
   * load-bearing rather than a comment that can drift away from the number beside it.
   */
  readonly delayMs: number | null;
  /** Names of the same-module bodies pulled in, sorted. Empty when the tick calls nothing. */
  readonly reached: readonly string[];
  /** The `stopAt` names this callback actually ran into, sorted. A cut not listed here is dead. */
  readonly stopped: readonly string[];
  /** The callback body plus every reached body, joined. Comments are NOT stripped. */
  readonly code: string;
}

/** Index of every named function body in one module: name -> one or more bodies. */
type BodyIndex = ReadonlyMap<string, readonly ts.Node[]>;

/** What one module offers the walk: its named bodies, its `this` aliases, its number consts. */
interface ModuleIndex {
  readonly bodies: BodyIndex;
  /**
   * Locals whose member calls are same-module code: a binding of `this` (`const self = this`)
   * or of an object literal (`const ui = { paint() {} }`). A call on either is one this walk
   * can resolve, and neither is a `this.` chain or a bare identifier, so without them both
   * `self.paintTimer()` and `ui.paint()` reach nothing.
   */
  readonly selfLike: ReadonlySet<string>;
  /** Module-level `const TICK_MS = 100`, so a hoisted cadence still resolves to its number. */
  readonly numbers: ReadonlyMap<string, number>;
}

function addBody(index: Map<string, ts.Node[]>, name: string, body: ts.Node): void {
  const existing = index.get(name);
  if (existing) existing.push(body);
  else index.set(name, [body]);
}

/** A numeric literal, with `_` separators removed. `15_000` reads as 15000. */
function numberOf(node: ts.Node): number | null {
  if (!ts.isNumericLiteral(node)) return null;
  const value = Number(node.text.replace(/_/g, ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * Everything the walk needs out of one module, in one pass.
 *
 * BODIES: class methods and get accessors, class properties initialized to a function,
 * module-level function declarations, and `const f = () => {}`. Indexed by BARE name, because
 * that is all a call site gives: `this.paintTimer(...)` and `paintTimer(...)` both resolve here.
 *
 * THIS ALIASES: `const self = this` is a same-module call that neither a `this.` chain nor a
 * bare identifier can see, so `self.paintTimer()` would reach nothing and a NEW driver written
 * that way would pass with an empty allowance and an unscanned tick. Collecting the alias names
 * closes it. Any local bound to `this` counts, wherever it is declared, which over-approximates
 * across scopes in the safe direction: a second unrelated `self` would only pull in MORE bodies.
 *
 * NUMBERS: module-level `const TICK_MS = 100`, so hoisting a cadence out of the call does not
 * turn a pinned cadence into an unpinnable `null`. `src/ui/reconnect_overlay.ts` already writes
 * `window.setInterval(render, TICK_MS)`, so this is the live shape rather than a hypothetical.
 */
function indexModule(sf: ts.SourceFile): ModuleIndex {
  const index = new Map<string, ts.Node[]>();
  const selfLike = new Set<string>();
  const numbers = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const bound = node.initializer;
      if (bound.kind === ts.SyntaxKind.ThisKeyword || ts.isObjectLiteralExpression(bound)) {
        selfLike.add(node.name.text);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = numberOf(node.initializer);
      if (value !== null) numbers.set(node.name.text, value);
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      for (const member of node.members) {
        if (
          (ts.isMethodDeclaration(member) ||
            ts.isGetAccessorDeclaration(member) ||
            ts.isSetAccessorDeclaration(member)) &&
          member.body
        ) {
          addBody(index, member.name.getText(sf), member.body);
        }
        if (
          ts.isPropertyDeclaration(member) &&
          member.initializer &&
          (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
        ) {
          addBody(index, member.name.getText(sf), member.initializer.body);
        }
      }
    }
    // An object-literal method (`const ui = { paint() { ... } }`) is a same-module body too,
    // and `ui.paint()` is not a call on `this`, so without this arm it resolves to nothing.
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isMethodDeclaration(property) && property.body) {
          addBody(index, property.name.getText(sf), property.body);
        }
        if (
          ts.isPropertyAssignment(property) &&
          (ts.isArrowFunction(property.initializer) ||
            ts.isFunctionExpression(property.initializer))
        ) {
          addBody(index, property.name.getText(sf), property.initializer.body);
        }
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      addBody(index, node.name.text, node.body);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        addBody(index, node.name.text, init.body);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { bodies: index, selfLike, numbers };
}

/** The driver name this call arms, or null: `setInterval(...)` and `window.setInterval(...)`. */
function armedDriver(call: ts.CallExpression, drivers: ReadonlySet<string>): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return drivers.has(callee.text) ? callee.text : null;
  if (ts.isPropertyAccessExpression(callee)) {
    return drivers.has(callee.name.text) ? callee.name.text : null;
  }
  return null;
}

/**
 * The callback body, plus the name it was resolved THROUGH when it came from a reference
 * rather than an inline function (so the walk does not re-enter it as a callee of itself).
 *
 * Throws rather than returning null when the argument is a shape it cannot follow. That is
 * the standing anti-vacuity rule for a source guard: a resolver that shrugged would hand the
 * gate an empty, passing scan the day someone writes `setInterval(makeTick(this), 100)`.
 */
function resolveCallback(
  arg: ts.Expression | undefined,
  index: BodyIndex,
  where: string,
): { bodies: readonly ts.Node[]; seedName: string | null } {
  if (!arg) {
    throw new Error(
      `${where}: the repeating driver was armed with no callback argument, so nothing can be scanned. A driver whose callback cannot be resolved must be a red test, never a quiet zero.`,
    );
  }
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    return { bodies: [arg.body], seedName: null };
  }
  // `setInterval(this.tick.bind(this), 100)` is the same callback one wrapper out.
  if (
    ts.isCallExpression(arg) &&
    ts.isPropertyAccessExpression(arg.expression) &&
    arg.expression.name.text === 'bind'
  ) {
    return resolveCallback(arg.expression.expression, index, where);
  }
  const name = ts.isIdentifier(arg)
    ? arg.text
    : ts.isPropertyAccessExpression(arg)
      ? arg.name.text
      : ts.isElementAccessExpression(arg) && ts.isStringLiteralLike(arg.argumentExpression)
        ? arg.argumentExpression.text
        : null;
  const bodies = name === null ? undefined : index.get(name);
  if (!name || !bodies || bodies.length === 0) {
    throw new Error(
      `${where}: the repeating driver's callback (\`${arg.getText(arg.getSourceFile())}\`) does not resolve to a function in this module, so its per-tick work cannot be scanned. Inline the callback, point it at a same-module function, or move the driver somewhere this gate can see it.`,
    );
  }
  // A name with two bodies is scanned as BOTH, the same rule the reachability walk follows for
  // an ambiguous callee: picking one would silently scan the wrong tick. The seed name keeps
  // the walk from re-adding them as a callee of themselves.
  return { bodies, seedName: name };
}

/**
 * The cadence argument as a number: a literal (`100`, `15_000`), or a module-level `const`
 * holding one. Null when it is neither, and for a driver that takes no delay at all.
 *
 * THE CONST ARM IS NOT A CONVENIENCE. Without it the cadence pin is escapable by hoisting:
 * `window.setInterval(render, TICK_MS)` would resolve to `null`, an entry could then declare
 * `everyMs: null`, and re-tuning that constant would move no gate. `src/ui/reconnect_overlay.ts`
 * already writes exactly that shape.
 */
function delayOf(call: ts.CallExpression, numbers: ReadonlyMap<string, number>): number | null {
  const arg = call.arguments[1];
  if (!arg) return null;
  const literal = numberOf(arg);
  if (literal !== null) return literal;
  return ts.isIdentifier(arg) ? (numbers.get(arg.text) ?? null) : null;
}

/**
 * Whether a member call on this expression is same-module code the walk can resolve: `this`,
 * a local bound to it (`const self = this`), or a local bound to an object literal.
 *
 * Deliberately NOT "any object": `this.deps.repaint()` must stay out of reach, because `deps`
 * is another module's surface and a same-named method here would be the wrong body entirely.
 */
function isSelfLike(expr: ts.Expression, selfLike: ReadonlySet<string>): boolean {
  if (expr.kind === ts.SyntaxKind.ThisKeyword) return true;
  return ts.isIdentifier(expr) && selfLike.has(expr.text);
}

/** The member name a `.foo` or a `['foo']` access reads, or null for a computed one. */
function memberName(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
}

/**
 * Every callee name the node mentions: a call on `this` (or on a local bound to it), a bare
 * call, and a property access on `this` (a possible getter). Descends through nested function
 * bodies on purpose; see the reachability rule at the top of this file.
 *
 * BOTH the `.foo` and the `['foo']` spelling count, which is the same computed-access escape
 * every matcher family in `tests/hud_perf_budget.test.ts` carries a `['computed']` arm for. A
 * walk that saw only the dot form would let a write move behind `this['paintTimer']()` and out
 * of a gate that catches `el['style']` one layer up.
 */
function calleeNames(node: ts.Node, selfLike: ReadonlySet<string>): string[] {
  const names: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee)) {
        names.push(callee.text);
      } else if (
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
        isSelfLike(callee.expression, selfLike)
      ) {
        const name = memberName(callee);
        if (name !== null) names.push(name);
      }
    } else if (
      (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) &&
      isSelfLike(n.expression, selfLike)
    ) {
      const name = memberName(n);
      if (name !== null) names.push(name);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/**
 * Resolve every repeating-driver call site in one module, with the code one of its ticks can
 * reach.
 *
 * @param driverNames the driver globals to look for, e.g. `['setInterval']`.
 * @param stopAt same-module names where the reachability walk stops.
 */
export function readDriverCallbacks(
  fileName: string,
  source: string,
  driverNames: readonly string[],
  stopAt: readonly string[] = [],
): DriverCallback[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const drivers = new Set(driverNames);
  const cuts = new Set(stopAt);
  const index = indexModule(sf);

  const calls: ts.CallExpression[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && armedDriver(node, drivers) !== null) calls.push(node);
    ts.forEachChild(node, collect);
  };
  collect(sf);

  return calls.map((call) => {
    const driver = armedDriver(call, drivers) as string;
    const line = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
    const where = `${fileName}:${line}`;
    const resolvedCallback = resolveCallback(call.arguments[0], index.bodies, where);
    const seedName = resolvedCallback.seedName;

    const seen = new Set<string>(seedName ? [seedName] : []);
    const stopped = new Set<string>();
    const bodies: ts.Node[] = [...resolvedCallback.bodies];
    const queue: ts.Node[] = [...resolvedCallback.bodies];
    while (queue.length) {
      const current = queue.shift() as ts.Node;
      for (const name of calleeNames(current, index.selfLike)) {
        if (cuts.has(name)) {
          stopped.add(name);
          continue;
        }
        if (seen.has(name)) continue;
        const found = index.bodies.get(name);
        if (!found || found.length === 0) continue;
        seen.add(name);
        for (const reachedBody of found) {
          bodies.push(reachedBody);
          queue.push(reachedBody);
        }
      }
    }
    if (seedName) seen.delete(seedName);
    return {
      driver,
      line,
      delayMs: delayOf(call, index.numbers),
      reached: [...seen].sort(),
      stopped: [...stopped].sort(),
      code: bodies.map((b) => b.getText(sf)).join('\n'),
    };
  });
}
