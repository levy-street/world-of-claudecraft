import ts from 'typescript';

// The source-discovery half of professions_blob_growth.test.ts's classification scrape:
// what top-level CharacterState keys does Sim.serializeCharacter's `state` object literal
// actually write, reading the REAL source rather than a hand-kept inventory.
//
// Two kinds of member need two different resolutions. A plain key, a `cond && {k}` guard,
// a `cond ? {a} : {b}` ternary, or an immediately invoked closure wrapping one of those, is
// fully resolvable from sim.ts alone: `stateLiteralSpreadKeys` walks it in place. A bare
// `...someSaveFragment(...)` spread is NOT: the call site carries no key literal at all,
// only an identifier, so the key lives in a DIFFERENT module's return shape.
// `resolveNamedImportSpecifier` + `saveFragmentReturnKeys` are the other half of that case,
// used together by the growth test after this file's resolver reports which names to chase.
//
// WHAT THIS SCANNER DOES NOT DO, ON PURPOSE (keep it small, no generic framework):
//   - It resolves the CALLEE shape, never the call's ARGUMENTS: a helper's own inputs are
//     irrelevant to what keys it can return.
//   - Only a bare identifier call or an IIFE (an inline arrow/function expression invoked
//     with zero arguments) is resolved as a value-producing call. A namespace or property
//     access call (`vaultMod.foo()`, `this.foo()`) is UNSUPPORTED and throws rather than
//     silently contributing zero keys, because a scan that treats "cannot resolve" the same
//     as "resolves to nothing" would let a real helper call hide behind one.
//   - A spread NESTED inside an already-resolved branch's object literal (a conditional's
//     `{ ..., ...(cond2 ? {k2} : {}) }`) is not walked a second level down: this producer
//     answers "what does the TOP-LEVEL state literal spread", the same scope the growth
//     test's classification scrape has always covered, not a full recursive expression
//     evaluator.
//   - Import resolution covers ONE hop: a named import (optionally aliased) declared
//     directly in the scanned source. A default import, a namespace import used bare
//     (`...vaultMod`), a re-export chain, or a name with no matching import at all all
//     refuse explicitly (return undefined / throw) rather than guessing.

function stripParens(expr: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expr) ? stripParens(expr.expression) : expr;
}

/** One named import's target: which module declares it, and under what name it is
 *  ACTUALLY exported there (an aliased `import { foo as bar }` binds the local name `bar`
 *  to the export `foo`; a helper lookup in the target module must search for `foo`, not
 *  the call site's `bar`, or an aliased helper falsely reads as "not declared"). */
export interface ResolvedNamedImport {
  readonly modulePath: string;
  readonly exportedName: string;
}

/**
 * Resolve a bare identifier's named import: which module it comes from, and its real
 * exported name once any alias is unwound. Reads every `import { ... } from '...'` in
 * `source` (sim.ts spreads its named imports across many such statements), so a helper
 * imported anywhere in the file resolves regardless of which import statement carries it.
 * Returns undefined for a namespace import, a default import, or a name with no import at
 * all: each is an explicit "not this" the caller must handle, never a guessed match.
 */
export function resolveNamedImportSpecifier(
  source: string,
  fileName: string,
  localName: string,
): ResolvedNamedImport | undefined {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if (el.name.text === localName) {
        return {
          modulePath: stmt.moduleSpecifier.text,
          exportedName: (el.propertyName ?? el.name).text,
        };
      }
    }
  }
  return undefined;
}

/** Every top-level key an expression spread into the state literal can produce,
 *  unwrapping the ternary/parenthesis shapes a save-fragment helper's `return` can take
 *  (`cond ? { a } : {}`, `x ? y : {}`). Stops at the first object literal on each branch: a
 *  save-fragment helper's contract is a FLAT sparse fragment, so a key's own value is never
 *  walked for nested keys. */
function collectObjectLiteralKeys(expr: ts.Expression, sf: ts.SourceFile, out: Set<string>): void {
  const inner = stripParens(expr);
  if (ts.isConditionalExpression(inner)) {
    collectObjectLiteralKeys(inner.whenTrue, sf, out);
    collectObjectLiteralKeys(inner.whenFalse, sf, out);
    return;
  }
  if (ts.isObjectLiteralExpression(inner)) {
    for (const prop of inner.properties) {
      if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
        out.add(prop.name.getText(sf));
      }
    }
  }
}

/**
 * The top-level keys a save-fragment helper function can write, resolved from its OWN
 * declaration rather than assumed from its call site. Reads two sources and unions them,
 * since either alone can under-report: the declared return type (`{ reliquary?: X }`,
 * every current helper's shape) names every key even on a branch the body never actually
 * returns, while walking the body's `return` statements also covers a helper with no
 * type-literal annotation. `fnName` must be the helper's REAL EXPORTED name (see
 * `ResolvedNamedImport.exportedName`), not a local call-site alias. Throws when `fnName`
 * is not a function declared in `source`, or when neither source names a single key: a
 * save-fragment helper this cannot read is exactly the case the growth test's
 * classification sweep must fail loudly on, not skip.
 */
export function saveFragmentReturnKeys(fnName: string, source: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fn = sf.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fnName,
  );
  if (!fn) {
    throw new Error(
      `save-fragment helper "${fnName}" is not declared as a top-level function in ${fileName}; ` +
        'a spread-called helper must resolve to one so the growth guard can classify its keys',
    );
  }
  const keys = new Set<string>();
  if (fn.type && ts.isTypeLiteralNode(fn.type)) {
    for (const member of fn.type.members) {
      if (ts.isPropertySignature(member) && member.name) keys.add(member.name.getText(sf));
    }
  }
  if (fn.body) {
    const visit = (node: ts.Node): void => {
      if (ts.isReturnStatement(node) && node.expression) {
        collectObjectLiteralKeys(node.expression, sf, keys);
      }
      ts.forEachChild(node, visit);
    };
    visit(fn.body);
  }
  if (keys.size === 0) {
    throw new Error(
      `save-fragment helper "${fnName}" in ${fileName} names no discoverable return key: ` +
        'give it an object-typed return annotation or an object-literal return',
    );
  }
  return [...keys].sort();
}

/** What `stateLiteralSpreadKeys` found in one method's `const state = {...}` literal:
 *  every key written directly (a plain property, or resolved through a `&&`/ternary guard
 *  or an IIFE wrapping one), plus the bare NAMES of every helper call the literal spreads
 *  that this scanner cannot resolve on its own (that half is `resolveNamedImportSpecifier`
 *  + `saveFragmentReturnKeys`, run by the caller once per name). */
export interface StateLiteralSpreadKeys {
  readonly literalKeys: readonly string[];
  readonly helperCallNames: readonly string[];
}

function resolveSpreadKeys(
  expr: ts.Expression,
  sf: ts.SourceFile,
  literalKeys: Set<string>,
  helperCallNames: Set<string>,
): void {
  const inner = stripParens(expr);
  if (ts.isObjectLiteralExpression(inner)) {
    for (const prop of inner.properties) {
      if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
        literalKeys.add(prop.name.getText(sf));
      }
      // A spread nested a level deeper (inside this already-resolved branch) is
      // deliberately not walked further; see the module header's stated limit.
    }
    return;
  }
  if (ts.isConditionalExpression(inner)) {
    resolveSpreadKeys(inner.whenTrue, sf, literalKeys, helperCallNames);
    resolveSpreadKeys(inner.whenFalse, sf, literalKeys, helperCallNames);
    return;
  }
  if (
    ts.isBinaryExpression(inner) &&
    inner.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    resolveSpreadKeys(inner.right, sf, literalKeys, helperCallNames);
    return;
  }
  if (ts.isCallExpression(inner)) {
    const callee = stripParens(inner.expression);
    if (ts.isIdentifier(callee)) {
      helperCallNames.add(callee.text);
      return;
    }
    if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
      const body = callee.body;
      if (ts.isBlock(body)) {
        for (const stmt of body.statements) {
          if (ts.isReturnStatement(stmt) && stmt.expression) {
            resolveSpreadKeys(stmt.expression, sf, literalKeys, helperCallNames);
          }
        }
      } else {
        resolveSpreadKeys(body, sf, literalKeys, helperCallNames);
      }
      return;
    }
    throw new Error(
      `unsupported spread-call shape "${inner.getText(sf)}" in the state literal: only a ` +
        'bare identifier call (a save-fragment helper) or an immediately invoked function ' +
        'expression is resolved, never a namespace/property/method call',
    );
  }
  throw new Error(`unsupported spread shape "${inner.getText(sf)}" in the state literal`);
}

/**
 * Every top-level member of `<className>.<methodName>`'s `const state = {...}` object
 * literal, split into keys this file can resolve on its own and the bare names of helper
 * calls it cannot (see `StateLiteralSpreadKeys`). Throws on a member this scanner has no
 * resolution rule for at all (see the module header): a call form silently skipped here
 * would make a real save-fragment helper invisible to the growth test's classification
 * sweep, which is exactly the defect this producer exists to prevent.
 */
export function stateLiteralSpreadKeys(
  source: string,
  fileName: string,
  className: string,
  methodName: string,
): StateLiteralSpreadKeys {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cls = sf.statements.find(
    (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === className,
  );
  if (!cls) {
    throw new Error(`class ${className} not found in ${fileName}`);
  }
  const method = cls.members.find(
    (m): m is ts.MethodDeclaration =>
      ts.isMethodDeclaration(m) && m.name.getText(sf) === methodName,
  );
  if (!method?.body) {
    throw new Error(`${className}.${methodName}() not found (or has no body) in ${fileName}`);
  }
  let literal: ts.ObjectLiteralExpression | undefined;
  for (const stmt of method.body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === 'state' &&
        decl.initializer &&
        ts.isObjectLiteralExpression(decl.initializer)
      ) {
        literal = decl.initializer;
      }
    }
  }
  if (!literal) {
    throw new Error(
      `${className}.${methodName}() has no top-level "const state = {...}" object literal ` +
        `in ${fileName}; the save-key scrape needs it to find every top-level write`,
    );
  }
  const literalKeys = new Set<string>();
  const helperCallNames = new Set<string>();
  for (const prop of literal.properties) {
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      literalKeys.add(prop.name.getText(sf));
      continue;
    }
    if (!ts.isSpreadAssignment(prop)) {
      throw new Error(
        `unsupported member "${prop.getText(sf)}" in the ${className}.${methodName}() state ` +
          'literal: only a plain key or a spread is resolved',
      );
    }
    resolveSpreadKeys(prop.expression, sf, literalKeys, helperCallNames);
  }
  return { literalKeys: [...literalKeys].sort(), helperCallNames: [...helperCallNames].sort() };
}
